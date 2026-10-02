// pnpm 全局包：pnpm 没有好用的 `outdated -g --json`，直接并发查 registry。
import type { CheckResult, Scanner, Tool } from '../types.js';
import { hasCommand, run } from '../util/exec.js';
import { briefError, errMsg, errorResult, isNewer, mapLimit, npmLatest } from './common.js';

type PnpmDeps = Record<string, { version?: string }>;

/** `pnpm ls -g --json` 输出是数组（每个全局目录一项），合并各项的 dependencies */
export function parsePnpmLs(stdout: string): { name: string; version: string }[] {
  const arr = JSON.parse(stdout || '[]') as { dependencies?: PnpmDeps; devDependencies?: PnpmDeps }[];
  const out = new Map<string, string>();
  for (const item of Array.isArray(arr) ? arr : [arr]) {
    for (const [name, d] of Object.entries({ ...item.dependencies, ...item.devDependencies })) {
      // link: / file: 安装的是本地目录，没有 registry 版本可比
      if (d.version && !/^(link|file):/.test(d.version)) out.set(name, d.version);
    }
  }
  return [...out].map(([name, version]) => ({ name, version }));
}

export const pnpmScanner: Scanner = {
  id: 'pnpm',
  label: 'pnpm 全局包',
  available: () => hasCommand('pnpm'),

  async discover() {
    const r = await run('pnpm', ['ls', '-g', '--json', '--depth=0']);
    if (r.code !== 0) throw new Error(`pnpm ls 失败：${briefError(r.stderr)}`);
    return parsePnpmLs(r.stdout).map((p): Tool => ({ source: 'pnpm', name: p.name, installed: p.version }));
  },

  check(tools) {
    return mapLimit(tools, 6, async (t): Promise<CheckResult> => {
      const updateCommand = `pnpm add -g ${t.name}@latest`;
      try {
        const { version, repo } = await npmLatest(t.name);
        return { tool: t, status: isNewer(version, t.installed) ? 'outdated' : 'latest', latest: version, repo, updateCommand };
      } catch (err) {
        return errorResult(t, `查询 npm registry 失败：${errMsg(err)}`, { updateCommand });
      }
    });
  },
};
