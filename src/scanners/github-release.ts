// 直接下载 GitHub release 二进制装的工具：没有包管理器记录，只能靠用户登记 versionCommand。
import type { CheckResult, Scanner, Tool } from '../types.js';
import { runShell } from '../util/exec.js';
import { githubApi, type GithubRelease } from '../util/github.js';
import { extractVersion, normalizeVersion } from '../util/version.js';
import { briefError, errMsg, errorResult, isNewer, mapLimit } from './common.js';

/** tag 可能是 v1.2.3 / 1.2.3 / tool-v1.2.3，优先抽 x.y.z */
export function versionFromTag(tag: string): string {
  return extractVersion(tag) ?? normalizeVersion(tag);
}

export const githubReleaseScanner: Scanner = {
  id: 'github-release',
  label: 'GitHub Release',
  available: async () => true,

  discover(ctx) {
    return mapLimit(ctx.config.githubReleases, 4, async (e): Promise<Tool> => {
      const r = await runShell(e.versionCommand, { timeoutMs: 15_000 });
      // 有的工具把版本打到 stderr，或 --version 退出码非零，能抽出版本号就认
      const installed = extractVersion(r.stdout) ?? extractVersion(r.stderr);
      const meta: Record<string, string> = { repo: e.repo };
      if (e.updateCommand) meta.updateCommand = e.updateCommand;
      if (!installed) {
        meta.error =
          r.code === 127 ? `命令不存在：${e.versionCommand}` : `无法从「${e.versionCommand}」输出中解析版本：${briefError(r.stderr || r.stdout, '无输出')}`;
      }
      return { source: 'github-release', name: e.name, installed: installed ?? '', meta };
    });
  },

  check(tools) {
    return mapLimit(tools, 4, async (t): Promise<CheckResult> => {
      const repo = t.meta?.repo;
      const extra = { repo, ...(t.meta?.updateCommand ? { updateCommand: t.meta.updateCommand } : {}) };
      if (t.meta?.error) return errorResult(t, t.meta.error, extra);
      if (!repo) return errorResult(t, '未配置 repo', extra);
      try {
        const rel = await githubApi<GithubRelease>(`repos/${repo}/releases/latest`);
        const latest = versionFromTag(rel.tag_name);
        return { tool: t, status: isNewer(latest, t.installed) ? 'outdated' : 'latest', latest, ...extra };
      } catch (err) {
        return errorResult(t, `查询 GitHub release 失败：${errMsg(err)}`, extra);
      }
    });
  },
};
