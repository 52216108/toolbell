// cargo install 的二进制：latest 查 crates.io。
import type { CheckResult, Scanner, Tool } from '../types.js';
import { hasCommand, run } from '../util/exec.js';
import { parseGithubRepo } from '../util/github.js';
import { fetchJson } from '../util/retry.js';
import { briefError, errMsg, errorResult, isNewer, mapLimit } from './common.js';

export interface CargoInstalled {
  name: string;
  version: string;
  /** 非 crates.io 来源（本地路径 / git），括号里的原文 */
  source?: string;
}

/**
 * 解析 `cargo install --list`：
 *   ripgrep v14.1.0:
 *       rg                       ← 缩进的是二进制名，跳过
 *   foo v0.1.0 (/path/to/foo):   ← 本地路径来源
 *   bar v0.2.0 (https://github.com/x/bar#abc123):
 */
export function parseCargoList(stdout: string): CargoInstalled[] {
  const out: CargoInstalled[] = [];
  for (const line of stdout.split('\n')) {
    if (!line || /^\s/.test(line)) continue;
    const m = line.match(/^(\S+) v(\S+?)(?: \((.+)\))?:$/);
    if (!m) continue;
    out.push({ name: m[1]!, version: m[2]!, ...(m[3] ? { source: m[3] } : {}) });
  }
  return out;
}

interface CratesResp {
  crate: { max_stable_version: string | null; max_version: string; repository: string | null };
}

export const cargoScanner: Scanner = {
  id: 'cargo',
  label: 'cargo install',
  available: () => hasCommand('cargo'),

  async discover(ctx) {
    const r = await run('cargo', ['install', '--list']);
    if (r.code !== 0) throw new Error(`cargo install --list 失败：${briefError(r.stderr)}`);
    const tools: Tool[] = [];
    for (const c of parseCargoList(r.stdout)) {
      // 本地路径 / git 来源没有 crates.io 版本可比，每天报 error 是噪音，直接不纳入
      if (c.source) {
        ctx.log(`cargo：${c.name} 来自 ${c.source}，非 crates.io 安装，暂不支持检测`);
        continue;
      }
      tools.push({ source: 'cargo', name: c.name, installed: c.version });
    }
    return tools;
  },

  // crates.io 爬虫策略要求带 User-Agent 且限速，并发压低
  check(tools) {
    return mapLimit(tools, 2, async (t): Promise<CheckResult> => {
      const updateCommand = `cargo install ${t.name}`;
      try {
        const { crate } = await fetchJson<CratesResp>(`https://crates.io/api/v1/crates/${encodeURIComponent(t.name)}`, {
          headers: { 'User-Agent': 'toolbell (https://github.com/toolbell)' },
        });
        const latest = crate.max_stable_version ?? crate.max_version;
        return {
          tool: t,
          status: isNewer(latest, t.installed) ? 'outdated' : 'latest',
          latest,
          repo: parseGithubRepo(crate.repository),
          updateCommand,
        };
      } catch (err) {
        return errorResult(t, `查询 crates.io 失败：${errMsg(err)}`, { updateCommand });
      }
    });
  },
};
