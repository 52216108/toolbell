import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { configDir, expandHome } from '../config.js';
import { scrub } from '../digest.js';
import type { AiConfig, Tool } from '../types.js';
import { toolKey } from '../types.js';
import { run } from '../util/exec.js';
import { githubApi, parseGithubRepo } from '../util/github.js';
import { fetchJson, retry } from '../util/retry.js';
import { lookupZh } from './dict-zh.js';

// 工具简介：让用户一眼看懂「这是干啥的」。优先级：内置中文词典 → AI 生成的中文缓存 → 官方英文简介。
// 只服务于展示（ui / list），不参与检测，任何一步失败都静默降级。

export interface ToolDesc {
  zh?: string;
  en?: string;
}

const cachePath = () => join(configDir(), 'descriptions.json');

async function readCache(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await readFile(cachePath(), 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeCache(cache: Record<string, string>): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(cachePath(), `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
}

async function readJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** Python 包 METADATA 里的 Summary 行 */
async function pythonSummary(sitePackagesParent: string, pkg: string): Promise<string | undefined> {
  const norm = pkg.toLowerCase().replace(/[-.]+/g, '_');
  try {
    const libDirs = (await readdir(sitePackagesParent)).filter((d) => d.startsWith('python'));
    for (const py of libDirs) {
      const sp = join(sitePackagesParent, py, 'site-packages');
      const info = (await readdir(sp)).find((d) => d.toLowerCase().startsWith(`${norm}-`) && d.endsWith('.dist-info'));
      if (!info) continue;
      const meta = await readFile(join(sp, info, 'METADATA'), 'utf8');
      return meta.match(/^Summary:\s*(.+)$/m)?.[1]?.trim();
    }
  } catch {
    /* 目录结构不符就算了 */
  }
  return undefined;
}

/** 本机就能读到的英文简介（不联网） */
async function localEnglish(tools: Tool[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const bySource = (s: Tool['source']) => tools.filter((t) => t.source === s);

  const brewTools = [...bySource('brew'), ...bySource('brew-cask')];
  if (brewTools.length > 0) {
    const r = await run('brew', ['info', '--json=v2', '--installed'], {
      env: { ...process.env, HOMEBREW_NO_AUTO_UPDATE: '1' },
      timeoutMs: 60_000,
    });
    if (r.code === 0) {
      try {
        const info = JSON.parse(r.stdout) as {
          formulae?: { name: string; full_name: string; desc?: string }[];
          casks?: { token: string; full_token: string; desc?: string; name?: string[] }[];
        };
        const m = new Map<string, string>();
        for (const f of info.formulae ?? []) if (f.desc) [f.name, f.full_name].forEach((n) => m.set(`brew:${n}`, f.desc!));
        for (const c of info.casks ?? []) {
          const d = c.desc ?? c.name?.[0];
          if (d) [c.token, c.full_token].forEach((n) => m.set(`brew-cask:${n}`, d));
        }
        for (const t of brewTools) {
          const d = m.get(toolKey(t));
          if (d) out.set(toolKey(t), d);
        }
      } catch {
        /* 解析失败就不要英文简介 */
      }
    }
  }

  const npmTools = bySource('npm');
  if (npmTools.length > 0) {
    const root = (await run('npm', ['root', '-g'], { timeoutMs: 20_000 })).stdout.trim();
    if (root) {
      await Promise.all(
        npmTools.map(async (t) => {
          const pj = await readJsonFile<{ description?: string }>(join(root, t.name, 'package.json'));
          if (pj?.description) out.set(toolKey(t), pj.description);
        }),
      );
    }
  }

  const uvTools = bySource('uv');
  if (uvTools.length > 0) {
    const dir = (await run('uv', ['tool', 'dir'], { timeoutMs: 10_000 })).stdout.trim();
    if (dir) {
      await Promise.all(
        uvTools.map(async (t) => {
          const d = await pythonSummary(join(dir, t.name, 'lib'), t.name);
          if (d) out.set(toolKey(t), d);
        }),
      );
    }
  }

  const pipxTools = bySource('pipx');
  if (pipxTools.length > 0) {
    const dir = (await run('pipx', ['environment', '--value', 'PIPX_LOCAL_VENVS'], { timeoutMs: 10_000 })).stdout.trim();
    if (dir) {
      await Promise.all(
        pipxTools.map(async (t) => {
          const d = await pythonSummary(join(dir, t.name, 'lib'), t.meta?.package ?? t.name);
          if (d) out.set(toolKey(t), d);
        }),
      );
    }
  }

  const plugins = bySource('claude-plugin');
  if (plugins.length > 0) {
    const claude = process.env.CLAUDE_CONFIG_DIR ? expandHome(process.env.CLAUDE_CONFIG_DIR) : join(homedir(), '.claude');
    const known =
      (await readJsonFile<Record<string, { installLocation?: string }>>(join(claude, 'plugins', 'known_marketplaces.json'))) ?? {};
    await Promise.all(
      plugins.map(async (t) => {
        const [plugin, mp] = t.name.split('@');
        if (!plugin || !mp) return;
        const dir = known[mp]?.installLocation ?? join(claude, 'plugins', 'marketplaces', mp);
        const manifest =
          (await readJsonFile<{ plugins?: { name: string; description?: string }[] }>(join(dir, '.claude-plugin', 'marketplace.json'))) ??
          (await readJsonFile<{ plugins?: { name: string; description?: string }[] }>(join(dir, 'marketplace.json')));
        const d = manifest?.plugins?.find((p) => p.name === plugin)?.description;
        if (d) out.set(toolKey(t), d);
      }),
    );
  }

  return out;
}

/** 汇总每个工具的简介（不联网、不调 AI） */
export async function describeTools(tools: Tool[]): Promise<Map<string, ToolDesc>> {
  const [cache, en] = await Promise.all([readCache(), localEnglish(tools).catch(() => new Map<string, string>())]);
  const out = new Map<string, ToolDesc>();
  for (const t of tools) {
    const key = toolKey(t);
    const zh = lookupZh(t.name) ?? cache[key];
    out.set(key, { ...(zh ? { zh } : {}), ...(en.get(key) ? { en: en.get(key) } : {}) });
  }
  return out;
}

/** 本地读不到英文简介的，联网查官方描述（npm / PyPI / crates / GitHub），供 AI 翻译时参考 */
async function remoteEnglish(t: Tool): Promise<string | undefined> {
  try {
    switch (t.source) {
      case 'npm':
      case 'pnpm':
        return (
          await fetchJson<{ description?: string }>(
            `https://registry.npmjs.org/${t.name.replace('/', '%2f')}/latest`,
            { tries: 1, timeoutMs: 10_000 },
          )
        ).description;
      case 'uv':
      case 'pipx':
        return (
          await fetchJson<{ info?: { summary?: string } }>(`https://pypi.org/pypi/${t.meta?.package ?? t.name}/json`, {
            tries: 1,
            timeoutMs: 10_000,
          })
        ).info?.summary;
      case 'cargo':
        return (
          await fetchJson<{ crate?: { description?: string } }>(`https://crates.io/api/v1/crates/${t.name}`, {
            tries: 1,
            timeoutMs: 10_000,
            headers: { 'User-Agent': 'toolbell (https://github.com/52216108/toolbell)' },
          })
        ).crate?.description;
      case 'github-release':
      case 'git': {
        let repo = t.meta?.repo;
        if (!repo && t.meta?.path) {
          repo = parseGithubRepo((await run('git', ['-C', t.meta.path, 'remote', 'get-url', 'origin'], { timeoutMs: 5_000 })).stdout.trim());
        }
        if (!repo) return undefined;
        return (await githubApi<{ description?: string | null }>(`repos/${repo}`)).description ?? undefined;
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * 对还没有中文简介的工具，调用用户配置的大模型生成一句话中文简介并写入缓存。
 * 返回新补全的数量。只依据给出的英文描述生成，没有描述的不让模型凭名字猜。
 */
export async function fillChineseWithAi(
  tools: Tool[],
  ai: AiConfig,
  log: (msg: string) => void,
): Promise<number> {
  if (!ai.baseURL || !ai.apiKey || !ai.model) throw new Error('AI 配置不完整，请先填写接口地址、模型与 API Key');
  const descs = await describeTools(tools);
  const missing = tools.filter((t) => !descs.get(toolKey(t))?.zh);
  if (missing.length === 0) return 0;

  const items: { key: string; name: string; en: string }[] = [];
  await Promise.all(
    missing.map(async (t) => {
      const key = toolKey(t);
      const en = descs.get(key)?.en ?? (await remoteEnglish(t));
      if (en) items.push({ key, name: t.name, en: en.slice(0, 300) });
    }),
  );
  if (items.length === 0) return 0;

  const prompt = [
    '下面是一些开发工具的名称与官方英文描述。请为每个工具写一句中文简介（不超过 25 个字），说明它是做什么用的，方便中文开发者一眼看懂。',
    '要求：只依据给出的英文描述，不要编造；专有名词（产品名、命令名）保留英文；不要加句号。',
    '只输出一个 JSON 对象，键为 key，值为中文简介，不要输出任何其他内容。',
    '',
    JSON.stringify(items.slice(0, 120)),
  ].join('\n');

  const url = `${ai.baseURL.replace(/\/+$/, '')}/chat/completions`;
  let content: string | undefined;
  try {
    const json = await retry(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
          body: JSON.stringify({ model: ai.model, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
          signal: AbortSignal.timeout(120_000),
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`);
        return JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
      },
      { tries: 2, gapMs: 3_000 },
    );
    content = json.choices?.[0]?.message?.content ?? undefined;
  } catch (err) {
    throw new Error(`AI 调用失败：${scrub((err as Error).message, ai.apiKey)}`);
  }

  // 模型可能包代码块或带思考内容，取第一个 { 到最后一个 } 之间解析
  const raw = content?.replace(/<think>[\s\S]*?<\/think>/g, '') ?? '';
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error('AI 返回的内容不是合法 JSON，请重试');
  }

  const cache = await readCache();
  const valid = new Set(items.map((i) => i.key));
  let n = 0;
  for (const [k, v] of Object.entries(parsed)) {
    if (!valid.has(k) || typeof v !== 'string' || !v.trim()) continue;
    cache[k] = v.trim().slice(0, 60);
    n++;
  }
  await writeCache(cache);
  log(`AI 补全中文简介 ${n} 条`);
  return n;
}
