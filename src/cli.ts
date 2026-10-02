import { Command } from 'commander';
import pc from 'picocolors';
import { readFile } from 'node:fs/promises';
import { discoverAll, runCheck } from './check.js';
import { configPath, defaultConfig, lastRunPath, loadConfig, logPath, saveConfig } from './config.js';
import { runInit } from './init.js';
import { renderMarkdown } from './render.js';
import { installSchedule, isEphemeralInstall, scheduleStatus, uninstallSchedule } from './schedule.js';
import type { Config } from './types.js';
import { toolKey } from './types.js';

const program = new Command();

program
  .name('toolbell')
  .description('扫描本机开发工具，每天检测更新并推送到飞书 / 企业微信 / 钉钉（只提醒，不自动升级）')
  .version('0.1.0');

async function requireConfig(): Promise<Config> {
  const c = await loadConfig();
  if (!c) {
    console.error(pc.yellow(`还没有配置，先运行 ${pc.cyan('toolbell init')}`));
    process.exit(1);
  }
  return c;
}

program
  .command('init')
  .description('交互式配置：扫描工具、选择通知渠道、AI 解读、定时时间')
  .action(runInit);

program
  .command('check')
  .description('立即检测一次，有更新时推送到已配置渠道')
  .option('--dry-run', '只在终端预览：不刷新包管理器索引、不 git fetch、不推送')
  .option('--no-notify', '正常检测但不推送')
  .option('--json', '以 JSON 输出检测结果')
  .option('-v, --verbose', '打印过程日志')
  .action(async (opts: { dryRun?: boolean; notify: boolean; json?: boolean; verbose?: boolean }) => {
    // 没配置也允许检测（终端自查），只是不会推送
    const config = (await loadConfig()) ?? defaultConfig();
    const report = await runCheck(config, { dryRun: !!opts.dryRun, notify: opts.notify, verbose: !!opts.verbose });
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
    } else if (process.stdout.isTTY || opts.dryRun) {
      // 定时任务里 stdout 进日志文件，不重复打印整份报告
      console.log(renderMarkdown(report));
    }
  });

program
  .command('list')
  .description('列出本机发现的工具及是否被跟踪')
  .action(async () => {
    const config = (await loadConfig()) ?? defaultConfig();
    const excluded = new Set(config.exclude);
    const found = await discoverAll({ dryRun: true, log: () => {}, config });
    for (const [scanner, tools] of found) {
      if (tools.length === 0) continue;
      console.log(pc.bold(`\n${scanner.label}（${tools.length}）`));
      for (const t of tools) {
        const key = toolKey(t);
        const mark = excluded.has(key) ? pc.dim('✗ 已排除') : pc.green('✓');
        console.log(`  ${mark} ${t.name} ${pc.dim(t.installed)}  ${pc.dim(key)}`);
      }
    }
    console.log(pc.dim(`\n排除/恢复：toolbell ignore <key> / toolbell unignore <key>`));
  });

program
  .command('ignore <key>')
  .description('不再跟踪某个工具，key 形如 brew:cocoapods（见 toolbell list）')
  .action(async (key: string) => {
    const config = await requireConfig();
    if (!config.exclude.includes(key)) config.exclude.push(key);
    await saveConfig(config);
    console.log(`已排除 ${key}`);
  });

program
  .command('unignore <key>')
  .description('恢复跟踪某个工具')
  .action(async (key: string) => {
    const config = await requireConfig();
    config.exclude = config.exclude.filter((k) => k !== key);
    await saveConfig(config);
    console.log(`已恢复跟踪 ${key}`);
  });

program
  .command('schedule [time]')
  .description('设置每天检测时间（HH:MM）；不带参数按配置重新注册；--off 取消')
  .option('--off', '取消定时任务')
  .action(async (time: string | undefined, opts: { off?: boolean }) => {
    if (opts.off) return console.log(await uninstallSchedule());
    const config = await requireConfig();
    const t = time ?? config.schedule?.time ?? '09:30';
    if (await isEphemeralInstall()) {
      console.error(pc.yellow('当前通过 npx 临时运行，定时任务指向的文件可能被清理。请先 npm i -g toolbell'));
      process.exit(1);
    }
    console.log(await installSchedule(t));
    config.schedule = { time: t };
    await saveConfig(config);
  });

program
  .command('test-notify')
  .description('真实检测一次并推送（即使全部最新也发），用来确认渠道配置可用；不调用 AI')
  .action(async () => {
    const config = await requireConfig();
    if (config.channels.length === 0) {
      console.error(pc.yellow('还没有配置通知渠道，先运行 toolbell init'));
      process.exit(1);
    }
    await runCheck({ ...config, notifyWhenUpToDate: true, ai: undefined }, { verbose: true });
    console.log(pc.dim(`详细日志：${logPath()}`));
  });

program
  .command('status')
  .description('查看配置位置、定时任务与最近一次检测结果')
  .action(async () => {
    const config = await loadConfig();
    console.log(`配置：${config ? configPath() : pc.yellow('未配置（toolbell init）')}`);
    if (config) {
      const ch = config.channels.map((c) => c.type).join('、') || '无';
      console.log(`渠道：${ch}　AI 解读：${config.ai?.enabled ? config.ai.model : '关闭'}　排除：${config.exclude.length} 项`);
    }
    console.log(`定时：${(await scheduleStatus()).detail}`);
    console.log(`日志：${logPath()}`);
    try {
      const last = JSON.parse(await readFile(lastRunPath(), 'utf8')) as {
        startedAt: string;
        outdated: { key: string; installed: string; latest?: string }[];
        errors: { key: string; error?: string }[];
        latestCount: number;
      };
      console.log(
        `最近一次：${new Date(last.startedAt).toLocaleString('zh-CN')}，可更新 ${last.outdated.length}，失败 ${last.errors.length}，最新 ${last.latestCount}`,
      );
      for (const o of last.outdated) console.log(`  ⚠️ ${o.key} ${o.installed} → ${o.latest}`);
      for (const e of last.errors) console.log(`  ❌ ${e.key} ${pc.dim(e.error ?? '')}`);
    } catch {
      console.log('最近一次：暂无');
    }
  });

program.parseAsync().catch((err: unknown) => {
  console.error(pc.red((err as Error).message));
  process.exit(1);
});
