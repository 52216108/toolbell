import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname } from 'node:path';
import { collectChangelogs } from './changelog.js';
import { configDir, lastRunPath, logPath } from './config.js';
import { generateDigest } from './digest.js';
import { sendAll } from './notifiers/index.js';
import { scanners } from './scanners/index.js';
import type { CheckContext, CheckResult, Config, Report, Scanner, Tool } from './types.js';
import { toolKey } from './types.js';

export interface RunOptions {
  dryRun?: boolean;
  /** false 时只检测不发通知（终端自查用） */
  notify?: boolean;
  /** 终端实时打印日志 */
  verbose?: boolean;
}

export function createLogger(verbose: boolean) {
  const lines: string[] = [];
  const log = (msg: string) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    lines.push(line);
    if (verbose) console.error(line);
  };
  const flush = async () => {
    await mkdir(configDir(), { recursive: true, mode: 0o700 });
    await appendFile(logPath(), `${lines.join('\n')}\n`);
    lines.length = 0;
  };
  return { log, flush };
}

export const enabledScanners = (config: Config): Scanner[] =>
  scanners.filter((s) => config.scanners[s.id] !== false);

/** 发现本机所有可跟踪工具（init / list 用），不做版本检测 */
export async function discoverAll(
  ctx: CheckContext,
  onProgress?: (scanner: Scanner, tools: Tool[] | Error) => void,
): Promise<Map<Scanner, Tool[]>> {
  const active = enabledScanners(ctx.config);
  const found = await Promise.all(
    active.map(async (s): Promise<Tool[] | undefined> => {
      try {
        if (!(await s.available(ctx))) return undefined;
        const tools = await s.discover(ctx);
        onProgress?.(s, tools);
        return tools;
      } catch (err) {
        ctx.log(`${s.id} 发现失败：${(err as Error).message}`);
        onProgress?.(s, err as Error);
        return undefined;
      }
    }),
  );
  // 并行发现，但按扫描器注册顺序输出，保证 list / init 展示顺序稳定
  const out = new Map<Scanner, Tool[]>();
  active.forEach((s, i) => {
    const tools = found[i];
    if (tools) out.set(s, tools);
  });
  return out;
}

async function checkScanner(s: Scanner, ctx: CheckContext): Promise<CheckResult[]> {
  const exclude = new Set(ctx.config.exclude);
  try {
    if (!(await s.available(ctx))) return [];
    const tools = (await s.discover(ctx)).filter((t) => !exclude.has(toolKey(t)));
    if (tools.length === 0) return [];
    ctx.log(`${s.id}: 检测 ${tools.length} 项`);
    const results = await s.check(tools, ctx);
    const outdated = results.filter((r) => r.status === 'outdated').length;
    const errors = results.filter((r) => r.status === 'error').length;
    ctx.log(`${s.id}: 落后 ${outdated}，失败 ${errors}`);
    return results;
  } catch (err) {
    // 扫描器约定不抛，这里兜底：整个来源失败记一条，不影响其他来源
    ctx.log(`${s.id}: 检测失败 ${(err as Error).message}`);
    return [
      {
        tool: { source: s.id, name: s.label, installed: '-' },
        status: 'error',
        error: (err as Error).message,
      },
    ];
  }
}

export async function runCheck(config: Config, opts: RunOptions = {}): Promise<Report> {
  const { dryRun = false, notify = true, verbose = false } = opts;
  const { log, flush } = createLogger(verbose);
  const ctx: CheckContext = { dryRun, log, config };
  const startedAt = new Date();
  log(`=== 开始检测（dryRun=${dryRun}）===`);

  try {
    const active = enabledScanners(config);
    // brew 与 brew-cask 共用 Homebrew 索引：串行，保证 cask 用到 formula 那边刷新过的索引，
    // 也避免两个 brew 进程抢锁；其余来源互不相关，并行
    const brewGroup = active.filter((s) => s.id === 'brew' || s.id === 'brew-cask');
    const others = active.filter((s) => !brewGroup.includes(s));
    const [brewResults, otherResults] = await Promise.all([
      (async () => {
        const all: CheckResult[] = [];
        for (const s of brewGroup) all.push(...(await checkScanner(s, ctx)));
        return all;
      })(),
      Promise.all(others.map((s) => checkScanner(s, ctx))).then((r) => r.flat()),
    ]);

    const report: Report = {
      hostname: hostname().replace(/\.local$/, ''),
      startedAt,
      durationMs: 0,
      results: [...brewResults, ...otherResults],
    };

    const outdated = report.results.filter((r) => r.status === 'outdated');
    const errors = report.results.filter((r) => r.status === 'error');

    if (config.ai?.enabled && outdated.length > 0) {
      log('拉取 changelog 并生成 AI 影响评估');
      const changelogs = await collectChangelogs(report.results, log);
      report.digest = await generateDigest(report.results, changelogs, config.ai, log);
    }

    report.durationMs = Date.now() - startedAt.getTime();

    const worthNotifying = outdated.length > 0 || errors.length > 0 || config.notifyWhenUpToDate;
    if (notify && config.channels.length > 0 && worthNotifying) {
      if (dryRun) {
        log(`[dry-run] 跳过发送（${config.channels.map((c) => c.type).join('、')}）`);
      } else {
        // 每个渠道的成败 sendAll 内部已记日志
        await sendAll(report, config.channels, log);
      }
    } else if (notify && config.channels.length > 0) {
      log('全部最新，按配置不发送通知');
    }

    await saveLastRun(report);
    log(`=== 结束：落后 ${outdated.length}，失败 ${errors.length}，耗时 ${Math.round(report.durationMs / 1000)}s ===`);
    return report;
  } finally {
    await flush().catch(() => {});
  }
}

/** 记录最近一次结果，供 `toolbell status` 查看 */
async function saveLastRun(report: Report): Promise<void> {
  const file = lastRunPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const summary = {
    startedAt: report.startedAt.toISOString(),
    durationMs: report.durationMs,
    outdated: report.results
      .filter((r) => r.status === 'outdated')
      .map((r) => ({ key: toolKey(r.tool), installed: r.tool.installed, latest: r.latest })),
    errors: report.results
      .filter((r) => r.status === 'error')
      .map((r) => ({ key: toolKey(r.tool), error: r.error })),
    latestCount: report.results.filter((r) => r.status === 'latest').length,
  };
  await writeFile(file, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
}
