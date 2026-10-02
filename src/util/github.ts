import { run } from './exec.js';
import { fetchJson } from './retry.js';

let cachedToken: string | null | undefined;

/**
 * GitHub token：GITHUB_TOKEN / GH_TOKEN 环境变量优先，其次 `gh auth token`。
 * 拿不到就匿名访问（60 次/小时，共享出口 IP 时可能被限流）。
 */
export async function githubToken(): Promise<string | undefined> {
  if (cachedToken !== undefined) return cachedToken ?? undefined;
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) {
    cachedToken = env;
    return env;
  }
  const r = await run('gh', ['auth', 'token'], { timeoutMs: 10_000 });
  cachedToken = r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  return cachedToken ?? undefined;
}

export async function githubApi<T = unknown>(path: string): Promise<T> {
  const token = await githubToken();
  return fetchJson<T>(`https://api.github.com/${path.replace(/^\//, '')}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'toolbell',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
}

/** 从各种 URL 形态里解析 GitHub owner/repo（git+https、git@、archive 下载地址、homepage） */
export function parseGithubRepo(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const m = url.match(/github\.com[:/]([^/\s]+)\/([^/\s#?]+)/);
  if (!m) return undefined;
  const owner = m[1]!;
  const repo = m[2]!.replace(/\.git$/, '');
  return `${owner}/${repo}`;
}
