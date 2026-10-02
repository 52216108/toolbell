import * as p from '@clack/prompts';
import pc from 'picocolors';
import { homedir } from 'node:os';
import { discoverAll } from './check.js';
import { configPath, defaultConfig, loadConfig, parseTime, saveConfig } from './config.js';
import { findGitRepoCandidates } from './scanners/git.js';
import { installSchedule, isEphemeralInstall } from './schedule.js';
import type { AiConfig, ChannelConfig, ChannelType, Config, Tool } from './types.js';
import { toolKey } from './types.js';
import { AI_PRESETS, CHANNEL_LABEL, WEBHOOK_PATTERN } from './presets.js';

/** 用户按 Ctrl+C 取消时直接退出，不留半截配置 */
function must<T>(v: T | symbol): T {
  if (p.isCancel(v)) {
    p.cancel('已取消，配置未保存');
    process.exit(0);
  }
  return v as T;
}

export async function runInit(): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' toolbell 初始化 ')));

  const existing = await loadConfig();
  if (existing) {
    const go = must(
      await p.confirm({ message: `已存在配置（${configPath()}），重新配置会覆盖它，继续吗？`, initialValue: true }),
    );
    if (!go) return p.outro('未做任何修改');
  }
  const config: Config = { ...defaultConfig(), ...(existing ?? {}) };

  // ---------- 1. 扫描本机工具 ----------
  const spin = p.spinner();
  spin.start('正在扫描本机已安装的工具…');
  const found = await discoverAll({ dryRun: true, log: () => {}, config });
  const total = [...found.values()].reduce((n, t) => n + t.length, 0);
  spin.stop(`扫描完成：${found.size} 个来源，共 ${total} 项`);

  if (total > 0) {
    const groups: Record<string, { value: string; label: string; hint?: string }[]> = {};
    const allKeys: string[] = [];
    for (const [scanner, tools] of found) {
      if (tools.length === 0) continue;
      groups[scanner.label] = tools.map((t: Tool) => {
        allKeys.push(toolKey(t));
        return { value: toolKey(t), label: t.name, hint: t.installed };
      });
    }
    const excluded = new Set(config.exclude);
    const picked = must(
      await p.groupMultiselect({
        message: '要跟踪哪些工具？（空格勾选/取消，回车确认；以后新装的工具会自动纳入）',
        options: groups,
        initialValues: allKeys.filter((k) => !excluded.has(k)),
        required: false,
      }),
    ) as string[];
    const pickedSet = new Set(picked);
    // 只记录本次取消勾选的；之前排除、但这次没扫到的条目保留
    config.exclude = [
      ...config.exclude.filter((k) => !allKeys.includes(k)),
      ...allKeys.filter((k) => !pickedSet.has(k)),
    ];
  }

  // ---------- 2. 本地 git 克隆 ----------
  const wantGit = must(
    await p.confirm({ message: '要跟踪家目录下 clone 的 GitHub 仓库吗？（只检测落后，不会 pull）', initialValue: false }),
  );
  if (wantGit) {
    spin.start('正在查找 GitHub 仓库…');
    const candidates = await findGitRepoCandidates([homedir()], 2);
    spin.stop(`找到 ${candidates.length} 个`);
    if (candidates.length > 0) {
      const tracked = new Set(config.gitRepos.map((r) => r.path));
      const picked = must(
        await p.multiselect({
          message: '选择要跟踪的仓库',
          options: candidates.map((c) => ({ value: c.path, label: c.path.replace(homedir(), '~'), hint: c.remote })),
          initialValues: candidates.map((c) => c.path).filter((path) => tracked.has(path)),
          required: false,
        }),
      ) as string[];
      const keep = config.gitRepos.filter((r) => picked.includes(r.path));
      const added = picked.filter((path) => !keep.some((r) => r.path === path)).map((path) => ({ path }));
      config.gitRepos = [...keep, ...added];
    }
  }

  // ---------- 3. 通知渠道 ----------
  config.channels = await askChannels(config.channels);

  // ---------- 4. AI 总结 ----------
  config.ai = await askAi(config.ai);

  // ---------- 5. 定时 ----------
  const time = must(
    await p.text({
      message: '每天几点检测？（HH:MM，本地时间）',
      defaultValue: config.schedule?.time ?? '09:30',
      placeholder: config.schedule?.time ?? '09:30',
      validate: (v) => (!v || parseTime(v) ? undefined : '格式应为 HH:MM，例如 09:30'),
    }),
  ) as string;
  config.schedule = { time: time || config.schedule?.time || '09:30' };

  await saveConfig(config);
  p.log.success(`配置已保存：${configPath()}（权限 600）`);

  if (await isEphemeralInstall()) {
    p.log.warn(
      '当前通过 npx 临时运行，定时任务指向的文件可能被清理。建议先全局安装：npm i -g toolbell，再运行 toolbell schedule',
    );
  } else {
    try {
      p.log.success(await installSchedule(config.schedule.time));
    } catch (err) {
      p.log.error(`定时任务注册失败：${(err as Error).message}`);
    }
  }

  p.note(
    [
      `${pc.cyan('toolbell check')}          立即检测一次并推送`,
      `${pc.cyan('toolbell check --dry-run')} 只在终端预览，不推送`,
      `${pc.cyan('toolbell test-notify')}    给已配置的渠道发一条测试消息`,
      `${pc.cyan('toolbell status')}         查看定时任务与最近一次结果`,
    ].join('\n'),
    '接下来',
  );
  p.outro('完成 🔔');
}

async function askChannels(current: ChannelConfig[]): Promise<ChannelConfig[]> {
  if (current.length > 0) {
    const keep = must(
      await p.confirm({
        message: `保留现有通知渠道（${current.map((c) => CHANNEL_LABEL[c.type]).join('、')}）？`,
        initialValue: true,
      }),
    );
    if (keep) return current;
  }
  const types = must(
    await p.multiselect({
      message: '推送到哪些渠道？（可多选，也可都不选、只在终端用）',
      options: (Object.keys(CHANNEL_LABEL) as ChannelType[]).map((t) => ({ value: t, label: CHANNEL_LABEL[t] })),
      required: false,
    }),
  ) as ChannelType[];

  const channels: ChannelConfig[] = [];
  for (const type of types) {
    const webhook = must(
      await p.text({
        message: `${CHANNEL_LABEL[type]}机器人 webhook 地址`,
        validate: (v) => (v && WEBHOOK_PATTERN[type].test(v.trim()) ? undefined : `不像${CHANNEL_LABEL[type]}机器人的 webhook 地址`),
      }),
    ) as string;
    let secret: string | undefined;
    if (type !== 'wecom') {
      const s = must(
        await p.password({
          message: `${CHANNEL_LABEL[type]}机器人「加签」密钥（没开加签直接回车）`,
          mask: '*',
        }),
      ) as string | undefined;
      secret = s?.trim() || undefined;
      if (type === 'dingtalk' && !secret) {
        p.log.info('钉钉若用「自定义关键词」安全设置，请把关键词设为 toolbell');
      }
    }
    channels.push({ type, webhook: webhook.trim(), ...(secret ? { secret } : {}) });
  }
  return channels;
}

async function askAi(current: AiConfig | undefined): Promise<AiConfig | undefined> {
  const enable = must(
    await p.confirm({
      message: '开启 AI 解读 changelog 吗？（需要你自己的大模型 API Key，按「对你的影响」分档）',
      initialValue: current?.enabled ?? false,
    }),
  );
  if (!enable) return current ? { ...current, enabled: false } : undefined;

  const presetId = must(
    await p.select({
      message: '用哪家的模型？（OpenAI 兼容接口）',
      options: AI_PRESETS.map((x) => ({ value: x.value, label: x.label })),
    }),
  ) as string;
  const preset = AI_PRESETS.find((x) => x.value === presetId)!;

  const baseURL = preset.baseURL
    ? preset.baseURL
    : (must(
        await p.text({
          message: '接口地址（到 /v1 这一级）',
          defaultValue: current?.baseURL,
          placeholder: current?.baseURL ?? 'https://example.com/v1',
          validate: (v) => (v && /^https?:\/\//.test(v) ? undefined : '需要 http(s) 地址'),
        }),
      ) as string);
  const apiKey = must(
    await p.password({
      message: 'API Key（仅保存在本机配置文件）',
      mask: '*',
      validate: (v) => (v ? undefined : '必填'),
    }),
  ) as string;
  const model = must(
    await p.text({
      message: preset.value === 'ark' ? '模型名或推理接入点 ID（ep-…）' : '模型名',
      defaultValue: preset.model || current?.model,
      placeholder: preset.model || current?.model || '',
      validate: (v) => (v || preset.model || current?.model ? undefined : '必填'),
    }),
  ) as string;
  const profile = must(
    await p.text({
      message: '简单介绍你的技术栈 / 在做的项目（可选，让 AI 判断影响更准）',
      defaultValue: current?.profile ?? '',
      placeholder: current?.profile ?? '例如：React Native + Laravel，用 Claude Code 开发',
    }),
  ) as string;

  return {
    enabled: true,
    baseURL: baseURL.trim().replace(/\/+$/, ''),
    apiKey: apiKey.trim(),
    model: (model || preset.model || current?.model || '').trim(),
    ...(profile?.trim() ? { profile: profile.trim() } : {}),
  };
}
