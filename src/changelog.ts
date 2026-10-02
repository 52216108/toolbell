// 拉取「已装版本 → 最新版本」之间的 release notes，供 AI 总结。
// 坑：日更项目一次可能跨十几个版本，只取首尾两个 release 会漏掉中间的破坏性变更，所以取整个区间。

import { homedir } from 'node:os';
import { toolKey, type CheckResult } from './types.js';
import { run } from './util/exec.js';
import { githubApi, type GithubRelease } from './util/github.js';
import { compareVersions, normalizeVersion, stripBrewRevision } from './util/version.js';

const PER_TOOL_MAX_CHARS = 6_000;
const CONCURRENCY = 4;
const GIT_LOG_LIMIT = 30;
const FALLBACK_COUNT = 3;

/**
 * 从 tag 里取版本号：`v1.2.3` → `1.2.3`；monorepo 风格 `pkg@1.2.3` / `cli-v1.2.3` 取末尾的版本段。
 * 取不到返回 undefined（这类 tag 不参与版本比较）。
 */
export function tagVersion(tag: string): string | undefined {
  const n = normalizeVersion(tag);
  if (/^\d/.test(n)) return n;
  const m = tag.match(/(?:^|[@/_-])[vV]?(\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?)$/);
  return m?.[1];
}

export type RangeMode = 'exact' | 'compare' | 'fallback';

export interface ReleaseRange {
  releases: GithubRelease[];
  /** exact = 找到了已装版本对应的 tag；compare = 按版本号比较；fallback = 都不行，只取最新几条 */
  mode: RangeMode;
}

/**
 * 选出 (installed, latest] 区间内的 release，按 GitHub 返回顺序（新 → 旧）。
 * - 跳过 draft；已装与最新都是正式版时跳过 prerelease（beta/rc 的内容会在正式版里重复出现）
 * - latest 之后更新的 release 不要：brew 等渠道可能落后上游，用户升级后拿到的是 latest
 */
export function selectReleaseRange(list: GithubRelease[], installed: string, latest?: string): ReleaseRange {
  const inst = normalizeVersion(stripBrewRevision(installed));
  const lat = latest ? normalizeVersion(stripBrewRevision(latest)) : undefined;
  const wantPre = /-/.test(inst) || (lat !== undefined && /-/.test(lat));
  const all = list.filter((r) => !r.draft);
  const candidates = all.filter((r) => wantPre || !r.prerelease || (lat !== undefined && tagVersion(r.tag_name) === lat));

  // 上界：不超过 latest。能找到 latest 对应 tag 就按位置截，否则按版本比较
  const latIdx = lat === undefined ? -1 : candidates.findIndex((r) => tagVersion(r.tag_name) === lat);
  const notAboveLatest = (r: GithubRelease, i: number) => {
    if (lat === undefined) return true;
    if (latIdx >= 0) return i >= latIdx;
    const v = tagVersion(r.tag_name);
    return v === undefined || compareVersions(v, lat) <= 0;
  };

  // 在全部（含 prerelease）里找已装版本的位置：用户可能装的就是某个 rc
  const instTag = all.find((r) => tagVersion(r.tag_name) === inst);
  if (instTag) {
    // GitHub 按创建时间新 → 旧返回，排在已装 tag 前面的就是更新的版本
    const instPos = all.indexOf(instTag);
    // 再排除版本号不高于已装的：维护分支（如 4.x 补丁）可能晚于 5.x 发布、排在前面
    const releases = candidates.filter((r, i) => {
      const v = tagVersion(r.tag_name);
      return all.indexOf(r) < instPos && notAboveLatest(r, i) && (v === undefined || compareVersions(v, inst) > 0);
    });
    return { releases, mode: 'exact' };
  }

  const newer = candidates.filter((r, i) => {
    const v = tagVersion(r.tag_name);
    return v !== undefined && compareVersions(v, inst) > 0 && notAboveLatest(r, i);
  });
  if (newer.length) return { releases: newer, mode: 'compare' };

  return { releases: candidates.slice(0, FALLBACK_COUNT), mode: 'fallback' };
}

/**
 * 公平分配字符预算（注水算法）：短的先拿走自己需要的，剩下的平均给长的。
 * 比「新的在前、超了就截」更不容易把中间版本整段丢掉。
 */
export function fairShare(lengths: number[], budget: number): number[] {
  const out = new Array<number>(lengths.length).fill(0);
  const order = lengths.map((len, i) => ({ len, i })).sort((a, b) => a.len - b.len);
  let remaining = budget;
  let left = order.length;
  for (const { len, i } of order) {
    const share = Math.floor(remaining / left);
    const take = Math.max(0, Math.min(len, share));
    out[i] = take;
    remaining -= take;
    left--;
  }
  return out;
}

function cleanBody(body: string | null): string {
  return (body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function formatReleases(range: ReleaseRange, maxChars = PER_TOOL_MAX_CHARS): string {
  const { releases, mode } = range;
  const header =
    mode === 'fallback' ? `> 未能定位已装版本对应的 release，以下仅为最新 ${releases.length} 条，可能不完整\n\n` : '';
  const heads = releases.map((r) => {
    const date = r.published_at ? ` (${r.published_at.slice(0, 10)})` : '';
    return `#### ${r.tag_name}${date}\n`;
  });
  const bodies = releases.map((r) => cleanBody(r.body) || '（无说明）');
  // 每条预留截断后缀「…（已截断）」的长度，保证总长不超上限
  const headLen = heads.reduce((n, h) => n + h.length + 2 + 7, header.length);
  const shares = fairShare(
    bodies.map((b) => b.length),
    Math.max(0, maxChars - headLen),
  );
  const parts = releases.map((_, i) => {
    const b = bodies[i]!;
    const n = shares[i]!;
    return heads[i]! + (n >= b.length ? b : `${b.slice(0, n).trimEnd()}…（已截断）`);
  });
  return header + parts.join('\n\n');
}

function expandHome(p: string): string {
  return p.startsWith('~') ? homedir() + p.slice(1) : p;
}

async function gitLog(r: CheckResult): Promise<string | undefined> {
  // git 扫描器把绝对路径放在 meta.path，Tool.name 是用户配置的原始路径（可能带 ~）
  const path = r.tool.meta?.path ?? r.tool.name;
  // run 不经 shell，%s 与 @{u} 原样传给 git
  const res = await run(
    'git',
    ['-C', expandHome(path), 'log', '--no-merges', '--pretty=format:- %s', `-n`, String(GIT_LOG_LIMIT), 'HEAD..@{u}'],
    { timeoutMs: 30_000 },
  );
  if (res.code !== 0) throw new Error(res.stderr.trim() || `git log 退出码 ${res.code}`);
  const out = res.stdout.trim();
  if (!out) return undefined;
  const lines = out.split('\n').length;
  const more =
    r.commitsBehind !== undefined && r.commitsBehind > lines ? `\n\n（仅列出最近 ${lines} 条，共落后 ${r.commitsBehind} 个提交）` : '';
  return out + more;
}

async function releaseNotes(r: CheckResult): Promise<string | undefined> {
  const list = await githubApi<GithubRelease[]>(`repos/${r.repo}/releases?per_page=30`);
  const range = selectReleaseRange(list, r.tool.installed, r.latest);
  if (!range.releases.length) return undefined;
  return formatReleases(range);
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** 只处理可更新且能拿到变更来源的项；单项失败只记日志并跳过 */
export async function collectChangelogs(results: CheckResult[], log: (msg: string) => void): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const targets = results.filter((r) => r.status === 'outdated' && (r.tool.source === 'git' || r.repo));
  await pool(targets, CONCURRENCY, async (r) => {
    const key = toolKey(r.tool);
    try {
      const md = r.tool.source === 'git' ? await gitLog(r) : await releaseNotes(r);
      if (md) map.set(key, md);
      else log(`changelog：${key} 没有找到区间内的变更记录`);
    } catch (err) {
      log(`changelog：${key} 获取失败：${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return map;
}
