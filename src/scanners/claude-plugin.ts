// Claude Code 插件：对比已装插件与 marketplace 声明的版本 / 提交。
// 降噪原则：`/plugin update` 按版本号走，sha 变了但声明版本没变时提醒了也装不到新东西，算最新。
import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CheckContext, CheckResult, Scanner, Tool } from '../types.js';
import { run } from '../util/exec.js';
import { parseGithubRepo } from '../util/github.js';
import { fetchJson, retry } from '../util/retry.js';
import { extractVersion, sameVersion } from '../util/version.js';
import { briefError, errMsg, errorResult, expandHome, isNewer, mapLimit } from './common.js';

function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ? expandHome(process.env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude');
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function git(dir: string, args: string[], timeoutMs = 30_000) {
  return run('git', ['-C', dir, ...args], { timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

async function gitOut(dir: string, args: string[]): Promise<string | undefined> {
  const r = await git(dir, args);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

// ---------- 已装插件 ----------

interface InstalledEntry {
  scope?: string;
  version?: string;
  gitCommitSha?: string | null;
}

export interface InstalledPluginsJson {
  plugins?: Record<string, InstalledEntry[]>;
}

export interface InstalledPlugin {
  /** name@marketplace */
  key: string;
  name: string;
  marketplace: string;
  version?: string;
  sha: string;
}

/**
 * 解析 installed_plugins.json。跳过：settings 里显式禁用的（提醒是噪音）、
 * gitCommitSha 为空的（非 git 部署，无从比对）。同一插件多个 scope 时取 user 级。
 */
export function parseInstalledPlugins(
  installed: InstalledPluginsJson,
  enabledPlugins: Record<string, boolean> = {},
): InstalledPlugin[] {
  const out: InstalledPlugin[] = [];
  for (const [key, entries] of Object.entries(installed.plugins ?? {})) {
    if (enabledPlugins[key] === false) continue;
    const at = key.lastIndexOf('@');
    if (at <= 0) continue;
    const e = entries.find((x) => x.scope === 'user') ?? entries[0];
    if (!e?.gitCommitSha) continue;
    out.push({ key, name: key.slice(0, at), marketplace: key.slice(at + 1), version: e.version, sha: e.gitCommitSha });
  }
  return out;
}

// ---------- 判定 ----------

export interface PluginJudgeInput {
  installedVersion?: string;
  installedSha: string;
  /** 上游声明的版本（plugin.json / marketplace 条目），可能没有 */
  declaredVersion?: string;
  /** 上游提交（marketplace 仓库 HEAD / pin 的 sha / ls-remote 结果） */
  latestSha?: string;
}

const looksSemver = (v: string) => extractVersion(v) !== undefined && /^v?\d/.test(v);
const shaEq = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

export function judgePlugin(i: PluginJudgeInput): { status: 'latest' | 'outdated'; latest: string } | { error: string } {
  if (i.declaredVersion && i.installedVersion) {
    if (sameVersion(i.declaredVersion, i.installedVersion)) return { status: 'latest', latest: i.declaredVersion };
    // 声明版本比已装还旧（marketplace 条目没跟着 bump）不算落后；未声明版本时 Claude 会用 sha 派生的版本串，无法比大小
    const outdated =
      looksSemver(i.declaredVersion) && looksSemver(i.installedVersion)
        ? isNewer(i.declaredVersion, i.installedVersion)
        : true;
    return { status: outdated ? 'outdated' : 'latest', latest: i.declaredVersion };
  }
  if (i.latestSha) {
    return { status: shaEq(i.latestSha, i.installedSha) ? 'latest' : 'outdated', latest: i.latestSha.slice(0, 7) };
  }
  return { error: '拿不到上游版本或提交，无法比对' };
}

// ---------- marketplace ----------

type PluginSource =
  | string
  | { source?: string; url?: string; repo?: string; path?: string; ref?: string; sha?: string };

interface MarketplaceManifest {
  metadata?: { pluginRoot?: string };
  plugins?: { name: string; version?: string; source: PluginSource }[];
}

interface KnownMarketplaces {
  [mp: string]: { installLocation?: string; source?: { source?: string; repo?: string; url?: string } };
}

interface MarketplaceState {
  dir: string;
  repo?: string;
  latestSha?: string;
  /** 按上游内容读 marketplace 内文件（JSON），读不到返回 undefined */
  read: <T>(relPath: string) => Promise<T | undefined>;
  manifest?: MarketplaceManifest;
}

async function gitShowJson<T>(dir: string, ref: string, relPath: string): Promise<T | undefined> {
  const r = await git(dir, ['show', `${ref}:${relPath}`]);
  if (r.code !== 0) return undefined;
  try {
    return JSON.parse(r.stdout) as T;
  } catch {
    return undefined;
  }
}

function rawGithubJson<T>(repo: string, sha: string, relPath: string): Promise<T | undefined> {
  return fetchJson<T>(`https://raw.githubusercontent.com/${repo}/${sha}/${relPath}`, { tries: 2, timeoutMs: 15_000 }).then(
    (j) => j,
    () => undefined,
  );
}

/**
 * marketplace 目录不一定是独立 git 仓库：可能是非 git 部署，也可能恰好位于另一个仓库里
 * （真实踩过：~/.claude 本身是 dotfiles 仓库，rev-parse HEAD 拿到的是外层仓库的提交）。
 * 所以必须确认 toplevel 就是该目录；否则改从 GitHub 读上游，最后才退回本地文件。
 */
async function loadMarketplace(mp: string, known: KnownMarketplaces, ctx: CheckContext): Promise<MarketplaceState> {
  const info = known[mp];
  const dir = info?.installLocation ?? join(claudeDir(), 'plugins', 'marketplaces', mp);
  const repo = info?.source?.repo ?? parseGithubRepo(info?.source?.url);
  const readLocal = <T>(rel: string) => readJson<T>(join(dir, rel));
  let state: MarketplaceState = { dir, repo, read: readLocal };

  const top = await gitOut(dir, ['rev-parse', '--show-toplevel']);
  const real = await realpath(dir).catch(() => dir);
  if (top && (await realpath(top).catch(() => top)) === real) {
    if (!ctx.dryRun) {
      // 只更新 remote-tracking 分支，不动 Claude Code 自己的 checkout
      await retry(async () => {
        const r = await git(dir, ['fetch', '--quiet'], 120_000);
        if (r.code !== 0) throw new Error(briefError(r.stderr, 'git fetch 失败'));
      }).catch((err) => ctx.log(`claude-plugin：marketplace ${mp} fetch 失败，沿用本地：${errMsg(err)}`));
    }
    const ref = (await gitOut(dir, ['rev-parse', '--verify', '--quiet', '@{u}'])) ? '@{u}' : 'HEAD';
    state = { dir, repo, latestSha: await gitOut(dir, ['rev-parse', ref]), read: (rel) => gitShowJson(dir, ref, rel) };
  } else if (repo) {
    const sha = await lsRemote(`https://github.com/${repo}.git`, 'HEAD');
    if (sha) state = { dir, repo, latestSha: sha, read: (rel) => rawGithubJson(repo, sha, rel) };
  }

  const manifestOf = async (read: MarketplaceState['read']) =>
    (await read<MarketplaceManifest>('.claude-plugin/marketplace.json')) ?? (await read<MarketplaceManifest>('marketplace.json'));
  let manifest = await manifestOf(state.read);
  if (!manifest && state.read !== readLocal) {
    ctx.log(`claude-plugin：读不到 ${mp} 上游清单，退回本地文件`);
    state = { dir, repo, read: readLocal };
    manifest = await manifestOf(readLocal);
  }
  return { ...state, manifest };
}

async function lsRemote(url: string, ref: string): Promise<string | undefined> {
  try {
    return await retry(
      async () => {
        const r = await run('git', ['ls-remote', url, ref], {
          timeoutMs: 30_000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        if (r.code !== 0) throw new Error(briefError(r.stderr));
        return r.stdout.split(/\s/)[0] || undefined;
      },
      { tries: 2 },
    );
  } catch {
    return undefined;
  }
}

/** GitHub 来源可以直接读指定提交的 plugin.json 拿声明版本，省得 clone */
async function remotePluginVersion(repo: string, sha: string, path?: string): Promise<string | undefined> {
  const sub = path ? `${path.replace(/^\.?\/+|\/+$/g, '')}/` : '';
  return (await rawGithubJson<{ version?: string }>(repo, sha, `${sub}.claude-plugin/plugin.json`))?.version;
}

async function checkPlugin(t: Tool, mp: MarketplaceState): Promise<CheckResult> {
  const key = t.name;
  const updateCommand = `在 Claude Code 中执行 /plugin update ${key}`;
  const name = t.meta?.plugin ?? key.split('@')[0]!;
  const sha = t.meta?.sha ?? '';
  const installedVersion = t.meta?.version;
  if (!mp.manifest) return errorResult(t, `读不到 marketplace 清单：${mp.dir}`, { updateCommand });
  const entry = mp.manifest.plugins?.find((p) => p.name === name);
  if (!entry) return errorResult(t, 'marketplace 清单里已没有该插件（可能已下架或改名）', { updateCommand });

  let declaredVersion: string | undefined;
  let latestSha: string | undefined;
  let repo: string | undefined;
  if (typeof entry.source === 'string') {
    // 仓库内子目录：跟随 marketplace 仓库走，版本以子目录 plugin.json 为准（marketplace 条目的 version 常忘了 bump）
    const root = mp.manifest.metadata?.pluginRoot;
    let rel = entry.source.replace(/^\.\//, '').replace(/\/+$/, '');
    if (root && !entry.source.startsWith('./')) rel = `${root.replace(/^\.\//, '').replace(/\/+$/, '')}/${rel}`;
    const pj = await mp.read<{ version?: string }>(`${rel}/.claude-plugin/plugin.json`);
    declaredVersion = pj?.version ?? entry.version;
    latestSha = mp.latestSha;
    repo = mp.repo;
  } else {
    const s = entry.source;
    const url = s.url ?? (s.repo ? `https://github.com/${s.repo}.git` : undefined);
    repo = parseGithubRepo(url) ?? s.repo;
    latestSha = s.sha ?? (url ? await lsRemote(url, s.ref ?? 'HEAD') : undefined);
    declaredVersion = entry.version ?? (repo && latestSha ? await remotePluginVersion(repo, latestSha, s.path) : undefined);
  }

  const j = judgePlugin({ installedVersion, installedSha: sha, declaredVersion, latestSha });
  if ('error' in j) return errorResult(t, j.error, { updateCommand, repo });
  return { tool: t, status: j.status, latest: j.latest, repo, updateCommand };
}

export const claudePluginScanner: Scanner = {
  id: 'claude-plugin',
  label: 'Claude Code 插件',
  available: async () => (await readJson(join(claudeDir(), 'plugins', 'installed_plugins.json'))) !== undefined,

  async discover() {
    const dir = claudeDir();
    const installed = await readJson<InstalledPluginsJson>(join(dir, 'plugins', 'installed_plugins.json'));
    if (!installed) return [];
    const settings = await readJson<{ enabledPlugins?: Record<string, boolean> }>(join(dir, 'settings.json'));
    return parseInstalledPlugins(installed, settings?.enabledPlugins).map(
      (p): Tool => ({
        source: 'claude-plugin',
        name: p.key,
        installed: p.version ?? p.sha.slice(0, 7),
        meta: { plugin: p.name, marketplace: p.marketplace, sha: p.sha, ...(p.version ? { version: p.version } : {}) },
      }),
    );
  },

  async check(tools, ctx) {
    const known =
      (await readJson<KnownMarketplaces>(join(claudeDir(), 'plugins', 'known_marketplaces.json'))) ?? {};
    // 同一 marketplace 只 fetch / 读清单一次
    const mps = new Map<string, Promise<MarketplaceState>>();
    return mapLimit(tools, 4, async (t) => {
      const mp = t.meta?.marketplace ?? t.name.slice(t.name.lastIndexOf('@') + 1);
      if (!mps.has(mp)) mps.set(mp, loadMarketplace(mp, known, ctx));
      try {
        return await checkPlugin(t, await mps.get(mp)!);
      } catch (err) {
        return errorResult(t, errMsg(err));
      }
    });
  },
};
