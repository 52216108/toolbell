import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Config } from './types.js';

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return join(xdg && xdg.trim() ? xdg : join(homedir(), '.config'), 'toolbell');
}

export const configPath = () => join(configDir(), 'config.json');
export const logPath = () => join(configDir(), 'toolbell.log');
export const lastRunPath = () => join(configDir(), 'last-run.json');

export function defaultConfig(): Config {
  return {
    version: 1,
    scanners: {},
    exclude: [],
    githubReleases: [],
    gitRepos: [],
    channels: [],
    notifyWhenUpToDate: false,
  };
}

/** 读取配置；不存在返回 undefined（调用方提示先 init） */
export async function loadConfig(): Promise<Config | undefined> {
  let raw: string;
  try {
    raw = await readFile(configPath(), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(raw) as Partial<Config>;
  } catch (err) {
    throw new Error(`配置文件不是合法 JSON：${configPath()}（${(err as Error).message}）`);
  }
  // 缺字段用默认值补齐，兼容手改配置时删掉的数组
  return { ...defaultConfig(), ...parsed, version: 1 };
}

/**
 * 保存配置：目录 700、文件 600（含 webhook 与 API Key，不能让同机其他用户读到）。
 * 先写临时文件再 rename，避免写一半被定时任务读到。
 */
export async function saveConfig(config: Config): Promise<void> {
  const file = configPath();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

/** HH:MM 校验，返回 [时, 分] 或 undefined */
export function parseTime(s: string): [number, number] | undefined {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return undefined;
  return [h, min];
}

export function expandHome(p: string): string {
  return p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}
