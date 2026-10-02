import * as p from '@clack/prompts';
import type { Command } from 'commander';
import pc from 'picocolors';
import { resolve } from 'node:path';
import { defaultConfig, expandHome, loadConfig, saveConfig } from './config.js';
import { maskWebhook } from './notifiers/shared.js';
import { AI_PRESETS, CHANNEL_LABEL, WEBHOOK_PATTERN } from './presets.js';
import type { ChannelType, Config } from './types.js';

// 非交互配置命令：交互式 init 需要在终端里选来选去，AI Agent 操作不了；
// 这组命令让 Agent 能一步步完成配置。API Key 例外：只能用户自己在终端输入（toolbell ai key），
// 避免 Key 出现在 Agent 对话记录里。

const ensureConfig = async (): Promise<Config> => (await loadConfig()) ?? defaultConfig();

/** 统一成绝对路径存储：定时任务的工作目录和执行命令时不同，相对路径（如 repo add .）到定时运行时就找不到了 */
const absRepoPath = (p: string) => resolve(expandHome(p));

function fail(msg: string): never {
  console.error(pc.red(msg));
  process.exit(1);
}

const isChannelType = (t: string): t is ChannelType => t in CHANNEL_LABEL;

export function registerConfigCommands(program: Command): void {
  // ---------- 通知渠道 ----------
  const channel = program.command('channel').description('管理通知渠道（飞书 / 企业微信 / 钉钉）');

  channel
    .command('add <type> <webhook>')
    .description('添加渠道，type 为 feishu / wecom / dingtalk')
    .option('--secret <secret>', '飞书 / 钉钉机器人的「加签」密钥')
    .action(async (type: string, webhook: string, opts: { secret?: string }) => {
      if (!isChannelType(type)) fail(`不支持的渠道「${type}」，可选：feishu、wecom、dingtalk`);
      const url = webhook.trim();
      if (!WEBHOOK_PATTERN[type].test(url)) fail(`这不像${CHANNEL_LABEL[type]}机器人的 webhook 地址`);
      if (type === 'wecom' && opts.secret) fail('企业微信群机器人没有加签，不需要 --secret');
      const config = await ensureConfig();
      config.channels = [
        ...config.channels.filter((c) => c.webhook !== url),
        { type, webhook: url, ...(opts.secret ? { secret: opts.secret.trim() } : {}) },
      ];
      await saveConfig(config);
      console.log(`已添加${CHANNEL_LABEL[type]}渠道：${maskWebhook(url)}`);
      if (type === 'dingtalk' && !opts.secret) {
        console.log(pc.dim('钉钉若用「自定义关键词」安全设置，请把关键词设为 toolbell'));
      }
    });

  channel
    .command('list')
    .description('列出已配置的渠道（webhook 已脱敏）')
    .action(async () => {
      const config = await ensureConfig();
      if (config.channels.length === 0) return console.log('还没有配置通知渠道');
      config.channels.forEach((c, i) =>
        console.log(`${i + 1}. ${CHANNEL_LABEL[c.type]}（${c.type}） ${maskWebhook(c.webhook)}${c.secret ? ' 已加签' : ''}`),
      );
    });

  channel
    .command('remove <type>')
    .description('移除某类渠道的全部配置')
    .action(async (type: string) => {
      if (!isChannelType(type)) fail(`不支持的渠道「${type}」，可选：feishu、wecom、dingtalk`);
      const config = await ensureConfig();
      const before = config.channels.length;
      config.channels = config.channels.filter((c) => c.type !== type);
      await saveConfig(config);
      console.log(`已移除 ${before - config.channels.length} 个${CHANNEL_LABEL[type]}渠道`);
    });

  // ---------- AI 解读 ----------
  const ai = program.command('ai').description('配置 AI 解读 changelog（OpenAI 兼容接口）');

  ai.command('set')
    .description('设置接口与模型（不含 API Key，Key 用 toolbell ai key 在终端输入）')
    .option('--provider <id>', `预设：${AI_PRESETS.map((x) => x.value).join(' / ')}`)
    .option('--base-url <url>', '接口地址（到 /v1 这一级），选了 provider 可省略')
    .option('--model <model>', '模型名；火山方舟可填推理接入点 ID（ep-…）')
    .option('--profile <text>', '你的技术栈 / 在做的项目，让 AI 判断影响更准')
    .action(async (opts: { provider?: string; baseUrl?: string; model?: string; profile?: string }) => {
      const preset = opts.provider ? AI_PRESETS.find((x) => x.value === opts.provider) : undefined;
      if (opts.provider && !preset) fail(`未知 provider「${opts.provider}」，可选：${AI_PRESETS.map((x) => x.value).join('、')}`);
      const config = await ensureConfig();
      const cur = config.ai;
      const baseURL = (opts.baseUrl ?? (preset?.baseURL || cur?.baseURL) ?? '').trim().replace(/\/+$/, '');
      const model = (opts.model ?? (preset?.model || cur?.model) ?? '').trim();
      if (!/^https?:\/\//.test(baseURL)) fail('缺少接口地址：用 --provider 选预设，或用 --base-url 指定');
      if (!model) fail('缺少模型名：请用 --model 指定');
      const apiKey = cur?.apiKey ?? '';
      const profile = opts.profile?.trim() ?? cur?.profile;
      // 沿用原开关：用户 ai off 后改模型不应悄悄重新开启付费调用；没有 Key 一律关闭
      const enabled = apiKey !== '' && (cur?.enabled ?? true);
      config.ai = { enabled, baseURL, apiKey, model, ...(profile ? { profile } : {}) };
      await saveConfig(config);
      console.log(`AI 接口已设置：${baseURL}，模型 ${model}（AI 解读：${enabled ? '开启' : '关闭'}）`);
      if (!apiKey) {
        console.log(pc.yellow('还没有 API Key，AI 解读暂未开启。请在你自己的终端运行：toolbell ai key'));
      }
    });

  ai.command('key')
    .description('在终端输入 API Key（带掩码，只保存在本机配置文件）')
    .action(async () => {
      if (!process.stdin.isTTY) {
        fail('API Key 需要在你自己的终端里输入：请打开终端运行 toolbell ai key');
      }
      const config = await ensureConfig();
      if (!config.ai?.baseURL || !config.ai.model) fail('请先运行 toolbell ai set 设置接口与模型');
      const key = await p.password({ message: 'API Key', mask: '*', validate: (v) => (v ? undefined : '必填') });
      if (p.isCancel(key)) fail('已取消');
      config.ai = { ...config.ai, apiKey: String(key).trim(), enabled: true };
      await saveConfig(config);
      console.log('API Key 已保存，AI 解读已开启');
    });

  ai.command('off')
    .description('关闭 AI 解读（保留接口配置）')
    .action(async () => {
      const config = await ensureConfig();
      if (config.ai) config.ai.enabled = false;
      await saveConfig(config);
      console.log('AI 解读已关闭');
    });

  // ---------- 手动登记的来源 ----------
  const repo = program.command('repo').description('管理要跟踪的本地 git 仓库（只检测，不会 pull）');

  repo
    .command('add <path>')
    .description('登记一个本地 clone 的仓库')
    .option('--update-cmd <cmd>', '落后时提示的更新命令，默认 git -C <path> pull --ff-only')
    .action(async (path: string, opts: { updateCmd?: string }) => {
      const config = await ensureConfig();
      const { stat } = await import('node:fs/promises');
      const abs = absRepoPath(path);
      const ok = await stat(`${abs}/.git`).then(
        () => true,
        () => false,
      );
      if (!ok) fail(`${path} 不是 git 仓库`);
      config.gitRepos = [
        ...config.gitRepos.filter((r) => absRepoPath(r.path) !== abs),
        { path: abs, ...(opts.updateCmd ? { updateCommand: opts.updateCmd } : {}) },
      ];
      await saveConfig(config);
      console.log(`已登记仓库 ${abs}`);
    });

  repo
    .command('remove <path>')
    .description('取消跟踪某个仓库')
    .action(async (path: string) => {
      const config = await ensureConfig();
      config.gitRepos = config.gitRepos.filter((r) => absRepoPath(r.path) !== absRepoPath(path));
      await saveConfig(config);
      console.log(`已移除仓库 ${path}`);
    });

  const release = program.command('release').description('管理直接下载 GitHub Release 的二进制工具');

  release
    .command('add <name>')
    .description('登记一个 GitHub Release 二进制')
    .requiredOption('--repo <owner/repo>', 'GitHub 仓库')
    .requiredOption('--version-cmd <cmd>', '取本机版本的命令，输出中第一个 x.y.z 视为版本')
    .option('--update-cmd <cmd>', '落后时提示的更新命令')
    .action(async (name: string, opts: { repo: string; versionCmd: string; updateCmd?: string }) => {
      if (!/^[\w.-]+\/[\w.-]+$/.test(opts.repo)) fail('--repo 格式应为 owner/repo');
      const config = await ensureConfig();
      config.githubReleases = [
        ...config.githubReleases.filter((r) => r.name !== name),
        {
          name,
          repo: opts.repo,
          versionCommand: opts.versionCmd,
          ...(opts.updateCmd ? { updateCommand: opts.updateCmd } : {}),
        },
      ];
      await saveConfig(config);
      console.log(`已登记 ${name}（${opts.repo}）`);
    });

  release
    .command('remove <name>')
    .description('取消跟踪某个 GitHub Release 工具')
    .action(async (name: string) => {
      const config = await ensureConfig();
      config.githubReleases = config.githubReleases.filter((r) => r.name !== name);
      await saveConfig(config);
      console.log(`已移除 ${name}`);
    });
}
