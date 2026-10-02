// npm 全局包：一次 `npm outdated -g --json` 拿全部过期信息，不逐包查 registry。
import type { CheckResult, Scanner, Tool } from '../types.js';
import { hasCommand, run } from '../util/exec.js';
import { briefError, errMsg, errorResult, isNewer, mapLimit, npmLatest } from './common.js';

// corepack 随 Node 发布、不该单独 npm i -g 升级；npm 本身保留（它也是用户工具）
const SKIP = new Set(['corepack']);

const npmEnv = { ...process.env, npm_config_update_notifier: 'false', npm_config_fund: 'false' };

export function parseNpmLs(stdout: string): { name: string; version: string }[] {
  const j = JSON.parse(stdout || '{}') as { dependencies?: Record<string, { version?: string }> };
  return Object.entries(j.dependencies ?? {})
    .filter(([name, d]) => !SKIP.has(name) && !!d.version)
    .map(([name, d]) => ({ name, version: d.version! }));
}

export interface NpmOutdatedEntry {
  current?: string;
  latest?: string;
}

/**
 * 解析 `npm outdated -g --json`。有过期项时 npm 退出码为 1（不是错误），调用方只按 stdout 判断。
 * 同名包装在多处时 npm 会给数组，取第一个。
 */
export function parseNpmOutdated(stdout: string): Map<string, NpmOutdatedEntry> {
  const j = JSON.parse(stdout.trim() || '{}') as Record<string, NpmOutdatedEntry | NpmOutdatedEntry[]>;
  const m = new Map<string, NpmOutdatedEntry>();
  for (const [name, v] of Object.entries(j)) {
    const e = Array.isArray(v) ? v[0] : v;
    if (e) m.set(name, e);
  }
  return m;
}

export const npmScanner: Scanner = {
  id: 'npm',
  label: 'npm 全局包',
  available: () => hasCommand('npm'),

  async discover() {
    // npm ls 遇到 extraneous / invalid 也会非零退出，但 stdout 仍是完整 JSON
    const r = await run('npm', ['ls', '-g', '--depth=0', '--json'], { env: npmEnv });
    if (!r.stdout.trim()) throw new Error(`npm ls 失败：${briefError(r.stderr)}`);
    return parseNpmLs(r.stdout).map((p): Tool => ({ source: 'npm', name: p.name, installed: p.version }));
  },

  async check(tools) {
    if (tools.length === 0) return [];
    const r = await run('npm', ['outdated', '-g', '--json'], { env: npmEnv });
    let outdated: Map<string, NpmOutdatedEntry>;
    try {
      if (r.code !== 0 && r.code !== 1) throw new Error(briefError(r.stderr));
      outdated = parseNpmOutdated(r.stdout);
    } catch (err) {
      return tools.map((t) => errorResult(t, `npm outdated 失败：${errMsg(err)}`));
    }
    return mapLimit(tools, 6, async (t): Promise<CheckResult> => {
      const updateCommand = `npm i -g ${t.name}@latest`;
      const e = outdated.get(t.name);
      // 装了 @next/@beta 等比 latest 更新的版本时 npm outdated 也会列出，按「更新」判断，避免把降级当升级提醒
      if (!e?.latest || !isNewer(e.latest, e.current ?? t.installed)) {
        return { tool: t, status: 'latest', latest: t.installed, updateCommand };
      }
      // repo 只给过期的包查（拉 changelog 用），查不到不影响结论
      const repo = await npmLatest(t.name).then(
        (x) => x.repo,
        () => undefined,
      );
      return {
        tool: { ...t, installed: e.current ?? t.installed },
        status: 'outdated',
        latest: e.latest,
        repo,
        updateCommand,
      };
    });
  },
};
