// 本地 git 克隆：只 fetch 后比对 HEAD 与上游，绝不 pull / merge / stash——用户的工作区不归我们动。
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CheckResult, Scanner, Tool } from '../types.js';
import { hasCommand, run } from '../util/exec.js';
import { parseGithubRepo } from '../util/github.js';
import { retry } from '../util/retry.js';
import { briefError, errMsg, errorResult, expandHome, mapLimit } from './common.js';

function git(dir: string, args: string[], timeoutMs = 30_000) {
  // 禁止弹凭证提示：私有仓库没登录时 fetch 会卡在交互输入上直到超时
  return run('git', ['-C', dir, ...args], { timeoutMs, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

async function gitOut(dir: string, args: string[]): Promise<string | undefined> {
  const r = await git(dir, args);
  return r.code === 0 ? r.stdout.trim() : undefined;
}

export const DIRTY_NOTE = '工作区有未提交改动，更新前先 commit/stash';

/** 只看已跟踪文件：未跟踪文件不影响 pull --ff-only，算进来会让大部分仓库天天带 note */
async function isDirty(dir: string): Promise<boolean> {
  const [wt, idx] = await Promise.all([git(dir, ['diff', '--quiet']), git(dir, ['diff', '--cached', '--quiet'])]);
  return wt.code !== 0 || idx.code !== 0;
}

async function checkRepo(t: Tool, ctx: Parameters<Scanner['check']>[1]): Promise<CheckResult> {
  const dir = t.meta?.path ?? expandHome(t.name);
  const updateCommand = t.meta?.updateCommand || `git -C ${t.name} pull --ff-only`;
  const fail = (msg: string) => errorResult(t, msg, { updateCommand });

  const head = await gitOut(dir, ['rev-parse', '--short', 'HEAD']);
  if (!head) return fail(`不是 git 仓库或路径不存在：${dir}`);
  const branch = await gitOut(dir, ['symbolic-ref', '--short', 'HEAD']);
  if (!branch) return fail('当前处于 detached HEAD，没有可比对的上游分支');
  if (!(await gitOut(dir, ['rev-parse', '--abbrev-ref', '@{u}']))) {
    return fail(`分支 ${branch} 没有上游分支（git branch -u 设置后才能比对）`);
  }
  const remote = (await gitOut(dir, ['config', '--get', `branch.${branch}.remote`])) ?? 'origin';
  const remoteUrl = await gitOut(dir, ['remote', 'get-url', remote]);
  const repo = parseGithubRepo(remoteUrl);

  if (!ctx.dryRun) {
    try {
      // 挂代理时偶发 Connection reset，单次失败不算数
      await retry(async () => {
        const r = await git(dir, ['fetch', '--quiet', remote], 120_000);
        if (r.code !== 0) throw new Error(briefError(r.stderr, 'git fetch 失败'));
      });
    } catch (err) {
      return fail(`git fetch 失败：${errMsg(err)}`);
    }
  }

  const upstream = await gitOut(dir, ['rev-parse', '--short', '@{u}']);
  const behindStr = await gitOut(dir, ['rev-list', '--count', 'HEAD..@{u}']);
  if (!upstream || behindStr === undefined) return fail('读取上游提交失败');
  const behind = Number(behindStr);
  const dirty = await isDirty(dir);

  return {
    tool: { ...t, installed: head },
    status: behind > 0 ? 'outdated' : 'latest',
    latest: upstream,
    repo,
    updateCommand,
    ...(behind > 0 ? { commitsBehind: behind } : {}),
    // 即使已最新也带上：提醒用户这个仓库有改动没落盘
    ...(dirty ? { note: DIRTY_NOTE } : {}),
  };
}

export const gitScanner: Scanner = {
  id: 'git',
  label: 'Git 仓库',
  available: () => hasCommand('git'),

  // 只跟踪 config 里登记的仓库：自动扫家目录慢且侵入，候选扫描交给 init（findGitRepoCandidates）
  async discover(ctx) {
    return Promise.all(
      ctx.config.gitRepos.map(async (e): Promise<Tool> => {
        const path = expandHome(e.path);
        const head = await gitOut(path, ['rev-parse', '--short', 'HEAD']);
        return {
          source: 'git',
          name: e.path,
          installed: head ?? '',
          meta: { path, ...(e.updateCommand ? { updateCommand: e.updateCommand } : {}) },
        };
      }),
    );
  },

  check(tools, ctx) {
    return mapLimit(tools, 4, (t) => checkRepo(t, ctx).catch((err) => errorResult(t, errMsg(err))));
  },
};

// 家目录下这些目录要么巨大要么不是用户项目，扫进去只会拖慢 init
const SKIP_DIRS = new Set([
  'node_modules',
  '.Trash',
  'Library',
  'Applications',
  'Pictures',
  'Music',
  'Movies',
  'Public',
  'vendor',
  'Pods',
  'DerivedData',
  'build',
  'dist',
  'target',
]);

/**
 * 给 init 用：在 roots 下找 origin 指向 GitHub 的仓库，最多下钻 maxDepth 层，
 * 命中仓库后不再进入其子目录。隐藏目录一律跳过（.cache / .npm 之类）。
 */
export async function findGitRepoCandidates(
  roots: string[],
  maxDepth = 2,
): Promise<{ path: string; remote: string }[]> {
  const repos: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // 无权限（macOS TCC 保护目录）等，静默跳过
    }
    if (entries.some((e) => e.name === '.git')) {
      repos.push(dir);
      return;
    }
    if (depth >= maxDepth) return;
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
        .map((e) => walk(join(dir, e.name), depth + 1)),
    );
  };
  await Promise.all(roots.map((r) => walk(expandHome(r), 0)));

  const found = await mapLimit(repos, 8, async (path) => {
    const remote = await gitOut(path, ['config', '--get', 'remote.origin.url']);
    return remote && parseGithubRepo(remote) ? { path, remote } : undefined;
  });
  return found.filter((x): x is { path: string; remote: string } => !!x).sort((a, b) => a.path.localeCompare(b.path));
}
