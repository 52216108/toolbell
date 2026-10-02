// Homebrew cask。auto_updates 的 App 自己会更新，brew 记录的版本常年滞后，提醒全是噪音，直接不纳入。
import type { CheckResult, Scanner, Tool } from '../types.js';
import { hasCommand } from '../util/exec.js';
import { parseGithubRepo } from '../util/github.js';
import { brewInfoInstalled, ensureBrewUpdated, type BrewCaskJson } from './brew.js';
import { errMsg, errorResult } from './common.js';

/** 是否应跟踪：auto_updates 与 version=latest（无版本号可比）的跳过 */
export function shouldTrackCask(c: BrewCaskJson): boolean {
  return !c.auto_updates && c.version !== 'latest' && !!c.installed;
}

export function caskResult(tool: Tool, c: BrewCaskJson): CheckResult {
  const installed = c.installed ?? '';
  return {
    tool: { ...tool, installed },
    // cask 版本常带逗号构建号（7.1.0,710），比大小不可靠，与 brew 一致按「不同即落后」
    status: installed === c.version ? 'latest' : 'outdated',
    latest: c.version,
    repo: parseGithubRepo(c.url) ?? parseGithubRepo(c.homepage),
    updateCommand: `brew upgrade --cask ${c.full_token}`,
  };
}

function indexByToken(casks: BrewCaskJson[]): Map<string, BrewCaskJson> {
  const m = new Map<string, BrewCaskJson>();
  for (const c of casks) {
    m.set(c.full_token, c);
    if (!m.has(c.token)) m.set(c.token, c);
  }
  return m;
}

export const brewCaskScanner: Scanner = {
  id: 'brew-cask',
  label: 'Homebrew Cask',
  available: () => hasCommand('brew'),

  async discover() {
    const { casks } = await brewInfoInstalled();
    return casks
      .filter(shouldTrackCask)
      .map((c): Tool => ({ source: 'brew-cask', name: c.full_token, installed: c.installed ?? '' }));
  },

  async check(tools, ctx) {
    if (tools.length === 0) return [];
    await ensureBrewUpdated(ctx);
    let index: Map<string, BrewCaskJson>;
    try {
      index = indexByToken((await brewInfoInstalled()).casks);
    } catch (err) {
      return tools.map((t) => errorResult(t, errMsg(err)));
    }
    return tools.map((t) => {
      const c = index.get(t.name);
      if (!c) return errorResult(t, 'brew info 未返回该 cask（可能已卸载）');
      return caskResult(t, c);
    });
  },
};
