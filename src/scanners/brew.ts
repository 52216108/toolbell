// Homebrew formula：只跟踪 `brew leaves --installed-on-request`（用户主动装的），
// 全量 installed 有 100+ 项依赖库，提醒全是噪音。
import type { CheckContext, CheckResult, Scanner, Tool } from '../types.js';
import { hasCommand, run, type ExecResult } from '../util/exec.js';
import { parseGithubRepo } from '../util/github.js';
import { briefError, errMsg, errorResult } from './common.js';

/** 禁止 brew 每条命令都顺手 auto-update：慢，而且 dry-run 下不该改本地索引 */
export const brewEnv = { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_ENV_HINTS: '1' };

export function brew(args: string[], timeoutMs = 180_000): Promise<ExecResult> {
  return run('brew', args, { env: brewEnv, timeoutMs });
}

let updateOnce: Promise<void> | undefined;

/**
 * check 前刷新索引（formula 与 cask 共用，一次进程只跑一次）。
 * 不刷新会拿旧索引误判为最新——真实踩过：本地索引停在 asc 5.8.1 而上游已 5.9.1。
 * `brew update` 只更新 tap 索引，不动已装的包。失败只记日志，继续用本地索引。
 */
export function ensureBrewUpdated(ctx: CheckContext): Promise<void> {
  if (ctx.dryRun) return Promise.resolve();
  updateOnce ??= run('brew', ['update', '--quiet'], { timeoutMs: 300_000 }).then((r) => {
    if (r.code !== 0) ctx.log(`brew update 失败，沿用本地索引：${briefError(r.stderr)}`);
  });
  return updateOnce;
}

interface BrewFormulaJson {
  name: string;
  full_name: string;
  versions: { stable: string | null };
  revision: number;
  installed: { version: string }[];
  linked_keg: string | null;
  pinned: boolean;
  urls?: { stable?: { url?: string }; head?: { url?: string } };
  homepage?: string;
}

export interface BrewCaskJson {
  token: string;
  full_token: string;
  installed: string | null;
  version: string;
  auto_updates: boolean | null;
  url?: string;
  homepage?: string;
}

export interface BrewInfoJson {
  formulae: BrewFormulaJson[];
  casks: BrewCaskJson[];
}

/** 一次拿全部已装 formula + cask 的信息，避免逐个起进程 */
export async function brewInfoInstalled(): Promise<BrewInfoJson> {
  const r = await brew(['info', '--json=v2', '--installed']);
  if (r.code !== 0) throw new Error(`brew info 失败：${briefError(r.stderr)}`);
  return JSON.parse(r.stdout) as BrewInfoJson;
}

export interface BrewFormulaState {
  fullName: string;
  name: string;
  installed: string;
  latest: string;
  pinned: boolean;
  repo?: string;
}

/**
 * 解析单个 formula。已装版本带修订号（cocoapods 1.16.2_2），versions.stable 不带，
 * 必须把 revision 拼回去再比，否则修订号一 bump 就永远误报（或反过来漏报）。
 */
export function parseBrewFormula(f: BrewFormulaJson): BrewFormulaState | undefined {
  const stable = f.versions.stable;
  // 多版本共存时以当前 link 的为准；keg-only 未 link 时取最后装的
  const installed = f.linked_keg ?? f.installed.at(-1)?.version;
  if (!stable || !installed) return undefined;
  const latest = f.revision > 0 ? `${stable}_${f.revision}` : stable;
  const repo =
    parseGithubRepo(f.urls?.stable?.url) ?? parseGithubRepo(f.homepage) ?? parseGithubRepo(f.urls?.head?.url);
  return { fullName: f.full_name, name: f.name, installed, latest, pinned: f.pinned, repo };
}

/** brew leaves 输出：core 是短名，第三方 tap 是全名（cameroncooke/axe/axe） */
export function parseLeaves(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
}

export function formulaResult(tool: Tool, s: BrewFormulaState): CheckResult {
  const base = { tool, latest: s.latest, repo: s.repo, updateCommand: `brew upgrade ${s.fullName}` };
  // --HEAD 安装的版本形如 HEAD-abc1234，和 stable 永远不等；brew 自己也要 --fetch-HEAD 才判断，这里不比对
  if (s.installed.startsWith('HEAD')) {
    // 不加 note：note 会进推送的「提示」区，HEAD 安装是用户有意为之，每天提示是噪音
    return { ...base, status: 'latest', latest: s.installed };
  }
  // 和 brew 自己的判断一致：版本串不同即落后（brew 的版本号格式太杂，比大小不可靠）
  const outdated = s.installed !== s.latest;
  const note = s.pinned ? '已 pin（brew pin），brew upgrade 会跳过它，需先 brew unpin' : undefined;
  return { ...base, status: outdated ? 'outdated' : 'latest', ...(note ? { note } : {}) };
}

function indexByName(info: BrewInfoJson): Map<string, BrewFormulaJson> {
  const m = new Map<string, BrewFormulaJson>();
  for (const f of info.formulae) {
    m.set(f.full_name, f);
    if (!m.has(f.name)) m.set(f.name, f);
  }
  return m;
}

export const brewScanner: Scanner = {
  id: 'brew',
  label: 'Homebrew',
  available: () => hasCommand('brew'),

  async discover(ctx) {
    const leaves = await brew(['leaves', '--installed-on-request']);
    if (leaves.code !== 0) throw new Error(`brew leaves 失败：${briefError(leaves.stderr)}`);
    const index = indexByName(await brewInfoInstalled());
    const tools: Tool[] = [];
    for (const name of parseLeaves(leaves.stdout)) {
      const f = index.get(name);
      const s = f && parseBrewFormula(f);
      if (!s) {
        ctx.log(`brew：${name} 取不到版本信息，跳过`);
        continue;
      }
      tools.push({ source: 'brew', name: s.fullName, installed: s.installed });
    }
    return tools;
  },

  async check(tools, ctx) {
    if (tools.length === 0) return [];
    await ensureBrewUpdated(ctx);
    let index: Map<string, BrewFormulaJson>;
    try {
      index = indexByName(await brewInfoInstalled());
    } catch (err) {
      return tools.map((t) => errorResult(t, errMsg(err)));
    }
    return tools.map((t) => {
      const f = index.get(t.name);
      const s = f && parseBrewFormula(f);
      if (!s) return errorResult(t, 'brew info 未返回该 formula（可能已卸载或 tap 已移除）');
      return formulaResult({ ...t, installed: s.installed }, s);
    });
  },
};
