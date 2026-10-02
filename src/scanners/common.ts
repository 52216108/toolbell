// 扫描器共用的小工具：错误结果、并发限制、~ 展开、npm / PyPI 元数据查询。
import { homedir } from 'node:os';
import type { CheckResult, Tool } from '../types.js';
import { compareVersions, sameVersion } from '../util/version.js';
import { fetchJson } from '../util/retry.js';
import { parseGithubRepo } from '../util/github.js';

export function errorResult(tool: Tool, error: string, extra: Partial<CheckResult> = {}): CheckResult {
  return { tool, status: 'error', error, ...extra };
}

/** 命令失败时的简短原因：stderr 第一条非空行，避免把整屏堆栈塞进通知 */
export function briefError(stderr: string, fallback = '命令执行失败'): string {
  const line = stderr
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '');
  return (line ?? fallback).slice(0, 300);
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 按顺序返回结果的并发限制 map；fn 抛出会传播，调用方自己兜成 error 结果 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return homedir() + p.slice(1);
  return p;
}

/**
 * latest 是否比 installed 新。不相等但 latest 反而更旧时（装了预发布版、本地索引滞后）
 * 不算落后——提醒「降级」只会是噪音。
 */
export function isNewer(latest: string, installed: string): boolean {
  if (sameVersion(latest, installed)) return false;
  return compareVersions(latest, installed) > 0;
}

/** scoped 包名的斜杠要编码，否则 registry 当成路径 */
export function npmRegistryUrl(pkg: string): string {
  return `https://registry.npmjs.org/${pkg.replace('/', '%2f')}/latest`;
}

interface NpmLatest {
  version: string;
  repository?: string | { url?: string };
  homepage?: string;
}

export async function npmLatest(pkg: string): Promise<{ version: string; repo?: string }> {
  const j = await fetchJson<NpmLatest>(npmRegistryUrl(pkg));
  const repoUrl = typeof j.repository === 'string' ? j.repository : j.repository?.url;
  // repository 可能写成简写 `github:owner/repo` 或 `owner/repo`
  let repo = parseGithubRepo(repoUrl) ?? parseGithubRepo(j.homepage);
  if (!repo && repoUrl) {
    const m = repoUrl.match(/^(?:github:)?([\w.-]+)\/([\w.-]+)$/);
    if (m) repo = `${m[1]}/${m[2]}`;
  }
  return { version: j.version, repo };
}

export interface PypiInfo {
  version: string;
  home_page?: string | null;
  project_urls?: Record<string, string> | null;
}

/** PyPI 的 project_urls 键名五花八门（Source / Repository / Homepage / Changelog…），找到第一个 GitHub 链接即可 */
export function pypiGithubRepo(info: Pick<PypiInfo, 'home_page' | 'project_urls'>): string | undefined {
  const urls = info.project_urls ?? {};
  const preferred = ['source', 'source code', 'repository', 'code', 'homepage', 'changelog'];
  const entries = Object.entries(urls);
  entries.sort(([a], [b]) => {
    const ia = preferred.indexOf(a.toLowerCase());
    const ib = preferred.indexOf(b.toLowerCase());
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  for (const [, url] of entries) {
    const r = parseGithubRepo(url);
    if (r) return r;
  }
  return parseGithubRepo(info.home_page);
}

export async function pypiInfo(name: string): Promise<PypiInfo> {
  const j = await fetchJson<{ info: PypiInfo }>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  return j.info;
}
