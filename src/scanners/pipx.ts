// pipx：版本取 venv 元数据里的 main_package，latest 查 PyPI。
import type { CheckResult, Scanner, Tool } from '../types.js';
import { hasCommand, run } from '../util/exec.js';
import { briefError, errMsg, errorResult, isNewer, mapLimit, pypiGithubRepo, pypiInfo } from './common.js';

interface PipxListJson {
  venvs?: Record<string, { metadata?: { main_package?: { package?: string; package_version?: string } } }>;
}

/** venv 名可能和 PyPI 包名不同（pipx install --suffix），查 PyPI 用 main_package.package */
export function parsePipxList(stdout: string): { name: string; pkg: string; version: string }[] {
  const j = JSON.parse(stdout || '{}') as PipxListJson;
  const out: { name: string; pkg: string; version: string }[] = [];
  for (const [name, v] of Object.entries(j.venvs ?? {})) {
    const main = v.metadata?.main_package;
    if (!main?.package_version) continue;
    out.push({ name, pkg: main.package ?? name, version: main.package_version });
  }
  return out;
}

export const pipxScanner: Scanner = {
  id: 'pipx',
  label: 'pipx',
  available: () => hasCommand('pipx'),

  async discover() {
    const r = await run('pipx', ['list', '--json']);
    if (r.code !== 0) throw new Error(`pipx list 失败：${briefError(r.stderr)}`);
    return parsePipxList(r.stdout).map(
      (p): Tool => ({ source: 'pipx', name: p.name, installed: p.version, meta: { package: p.pkg } }),
    );
  },

  check(tools) {
    return mapLimit(tools, 6, async (t): Promise<CheckResult> => {
      const updateCommand = `pipx upgrade ${t.name}`;
      try {
        const info = await pypiInfo(t.meta?.package ?? t.name);
        return {
          tool: t,
          status: isNewer(info.version, t.installed) ? 'outdated' : 'latest',
          latest: info.version,
          repo: pypiGithubRepo(info),
          updateCommand,
        };
      } catch (err) {
        return errorResult(t, `查询 PyPI 失败：${errMsg(err)}`, { updateCommand });
      }
    });
  },
};
