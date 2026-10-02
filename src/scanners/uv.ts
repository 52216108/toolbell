// uv tool：一次 `uv tool list --outdated` 拿全部过期信息（uv 自己查索引，只读）。
import type { CheckResult, Scanner, Tool } from '../types.js';
import { hasCommand, run } from '../util/exec.js';
import { briefError, errorResult, mapLimit, pypiGithubRepo, pypiInfo } from './common.js';

export interface UvToolLine {
  name: string;
  version: string;
  /** 只有 --outdated 输出里才有 */
  latest?: string;
}

/**
 * 解析 `uv tool list [--outdated]`：
 *   browser-use v0.13.8 [latest: 0.13.10]
 *   - browser-use        ← 可执行文件行，跳过
 */
export function parseUvToolList(stdout: string): UvToolLine[] {
  const out: UvToolLine[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('-')) continue;
    const m = line.match(/^(\S+)\s+v?(\d\S*)(.*)$/);
    if (!m) continue;
    const latest = m[3]!.match(/\[latest:\s*v?([^\]\s]+)\s*\]/)?.[1];
    out.push({ name: m[1]!, version: m[2]!, ...(latest ? { latest } : {}) });
  }
  return out;
}

export const uvScanner: Scanner = {
  id: 'uv',
  label: 'uv tool',
  available: () => hasCommand('uv'),

  async discover() {
    const r = await run('uv', ['tool', 'list']);
    if (r.code !== 0) throw new Error(`uv tool list 失败：${briefError(r.stderr)}`);
    return parseUvToolList(r.stdout).map((t): Tool => ({ source: 'uv', name: t.name, installed: t.version }));
  },

  async check(tools) {
    if (tools.length === 0) return [];
    const r = await run('uv', ['tool', 'list', '--outdated']);
    if (r.code !== 0) {
      return tools.map((t) => errorResult(t, `uv tool list --outdated 失败：${briefError(r.stderr)}`));
    }
    const rows = new Map(parseUvToolList(r.stdout).map((x) => [x.name, x]));
    return mapLimit(tools, 6, async (t): Promise<CheckResult> => {
      const updateCommand = `uv tool upgrade ${t.name}`;
      const row = rows.get(t.name);
      // 不在输出里或不带 [latest: ...] 即最新
      if (!row?.latest) return { tool: t, status: 'latest', latest: row?.version ?? t.installed, updateCommand };
      // repo 只为拉 changelog，查不到不影响结论
      const repo = await pypiInfo(t.name).then(pypiGithubRepo, () => undefined);
      return { tool: { ...t, installed: row.version }, status: 'outdated', latest: row.latest, repo, updateCommand };
    });
  },
};
