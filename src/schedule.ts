import { chmod, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { homedir, platform, userInfo } from 'node:os';
import { join } from 'node:path';
import { configDir, logPath, parseTime } from './config.js';
import { run } from './util/exec.js';

// 定时任务：macOS 用 launchd（用户级 LaunchAgent），Linux 用用户 crontab。
// 关键坑：launchd / cron 的 PATH 只有 /usr/bin:/bin，找不到 brew、npm、cargo，
// 所以安装时把当前 shell 的 PATH 原样写进任务环境。

const LABEL = 'dev.toolbell.check';
const CRON_MARK = '# toolbell-schedule';

const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

/**
 * 定时任务要执行的入口：直接用全局 bin 链接（如 /opt/homebrew/bin/toolbell），靠 shebang 经 PATH 找 node。
 * 不写死 process.execPath / 真实路径：Homebrew 的 node 真实路径带版本号（Cellar/node@22/22.22.3），
 * 升级 node 或 toolbell 后旧路径消失，定时任务会静默失败。
 */
const entryPath = () => process.argv[1] ?? '';

/** 从 npx 临时缓存运行时，入口文件随时可能被清理，定时任务会失效 */
export async function isEphemeralInstall(): Promise<boolean> {
  const real = await realpath(entryPath()).catch(() => entryPath());
  return /[/\\]_npx[/\\]|[/\\]dlx-|pnpm[/\\]dlx/.test(real);
}

/**
 * 写进定时任务的 PATH：fnm 给每个终端会话生成临时目录（fnm_multishells/<pid>_<ts>/bin），
 * 会话结束即失效，换成 fnm 的默认版本目录；其余条目原样保留并去重。
 */
export function stablePath(path: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const fnmDir = env.FNM_DIR || join(home, '.local', 'share', 'fnm');
  const out: string[] = [];
  for (const raw of path.split(':')) {
    const entry = /fnm_multishells[/\\][^/\\]+[/\\]bin$/.test(raw) ? join(fnmDir, 'aliases', 'default', 'bin') : raw;
    if (entry && !out.includes(entry)) out.push(entry);
  }
  return out.join(':');
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 定时环境只有极少的环境变量，需要把影响 toolbell 行为的变量带过去，否则定时任务会「成功运行但读错配置」：
 * XDG_CONFIG_HOME 不带 → 读不到 init 写的配置、永远不推送；代理不带 → 国内网络下每天 fetch 失败；
 * 镜像源（HOMEBREW_*、npm/pip/uv 源）不带 → 和终端里结果不一致。
 * plist 与 crontab 不是加密存储，名字像密钥的变量一律不写（GitHub 认证可走 gh auth token 读钥匙串）。
 */
const PASSTHROUGH_ENV = [
  'XDG_CONFIG_HOME',
  'CLAUDE_CONFIG_DIR',
  'FNM_DIR',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'NPM_CONFIG_REGISTRY',
  'npm_config_registry',
  'UV_INDEX_URL',
  'UV_DEFAULT_INDEX',
  'PIP_INDEX_URL',
  'CARGO_HOME',
  'RUSTUP_HOME',
];
const SECRET_LIKE = /TOKEN|SECRET|PASSWORD|PASSWD|KEY|CREDENTIAL|AUTH/i;

export function passthroughEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    // 值里带凭证的（如 http://user:pass@proxy）同样不落盘
    if (!v || SECRET_LIKE.test(k) || /:\/\/[^/\s:@]+:[^/\s@]+@/.test(v)) continue;
    if (PASSTHROUGH_ENV.includes(k) || k.startsWith('HOMEBREW_')) out[k] = v;
  }
  return out;
}

export function buildPlist(opts: {
  cli: string;
  hour: number;
  minute: number;
  path: string;
  home: string;
  log: string;
  env?: Record<string, string>;
}): string {
  const s = (v: string) => `<string>${xmlEscape(v)}</string>`;
  const extra = Object.entries(opts.env ?? {})
    .map(([k, v]) => `<key>${xmlEscape(k)}</key>${s(v)}`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${s(LABEL)}
  <key>ProgramArguments</key>
  <array>${s(opts.cli)}${s('check')}</array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${opts.hour}</integer><key>Minute</key><integer>${opts.minute}</integer></dict>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key>${s(opts.path)}<key>HOME</key>${s(opts.home)}${extra}</dict>
  <key>StandardOutPath</key>${s(opts.log)}
  <key>StandardErrorPath</key>${s(opts.log)}
</dict>
</plist>
`;
}

export interface ScheduleStatus {
  supported: boolean;
  installed: boolean;
  detail: string;
}

export async function installSchedule(time: string): Promise<string> {
  const t = parseTime(time);
  if (!t) throw new Error(`时间格式应为 HH:MM，收到「${time}」`);
  const [hour, minute] = t;
  const cli = entryPath();
  const path = stablePath(process.env.PATH ?? '/usr/bin:/bin');
  const os = platform();

  if (os === 'darwin') {
    const file = plistPath();
    await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    // 600：PATH 与代理地址也算本机隐私，不必让同机其他用户读到
    await writeFile(file, buildPlist({ cli, hour, minute, path, home: homedir(), log: logPath(), env: passthroughEnv() }), {
      mode: 0o600,
    });
    await chmod(file, 0o600);
    const domain = `gui/${userInfo().uid}`;
    // 已加载过先卸载再加载，才能让新时间生效；首次安装时 bootout 报错属正常。
    // bootout 是异步完成的，紧接着 bootstrap 偶发「Bootstrap failed: 5」，稍等重试一次
    await run('launchctl', ['bootout', domain, file]);
    let r = await run('launchctl', ['bootstrap', domain, file]);
    if (r.code !== 0) {
      await new Promise((res) => setTimeout(res, 1_500));
      r = await run('launchctl', ['bootstrap', domain, file]);
    }
    if (r.code !== 0) throw new Error(`launchctl bootstrap 失败：${r.stderr.trim()}`);
    return `已注册 launchd 任务（${LABEL}），每天 ${time} 运行`;
  }

  if (os === 'linux') {
    const envPrefix = Object.entries({ PATH: path, ...passthroughEnv() })
      .map(([k, v]) => `${k}=${shellQuote(v)}`)
      .join(' ');
    // cron 会把命令里的 % 当换行，必须转义
    const command = `${envPrefix} ${shellQuote(cli)} check >> ${shellQuote(logPath())} 2>&1`.replace(/%/g, '\\%');
    const line = `${minute} ${hour} * * * ${command} ${CRON_MARK}`;
    const current = await readCrontab();
    const next = [...current.filter((l) => !l.includes(CRON_MARK)), line].join('\n') + '\n';
    await writeCrontab(next);
    return `已写入用户 crontab，每天 ${time} 运行`;
  }

  throw new Error(`暂不支持 ${os} 的定时任务，可自行用系统计划任务每天执行「toolbell check」`);
}

export async function uninstallSchedule(): Promise<string> {
  const os = platform();
  if (os === 'darwin') {
    const file = plistPath();
    await run('launchctl', ['bootout', `gui/${userInfo().uid}`, file]);
    try {
      await unlink(file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    return '已移除 launchd 定时任务';
  }
  if (os === 'linux') {
    const current = await readCrontab();
    await writeCrontab(current.filter((l) => !l.includes(CRON_MARK)).join('\n') + '\n');
    return '已从 crontab 移除定时任务';
  }
  return `当前系统（${os}）没有由 toolbell 管理的定时任务`;
}

export async function scheduleStatus(): Promise<ScheduleStatus> {
  const os = platform();
  if (os === 'darwin') {
    const r = await run('launchctl', ['print', `gui/${userInfo().uid}/${LABEL}`]);
    if (r.code !== 0) return { supported: true, installed: false, detail: '未注册定时任务' };
    const plist = await readFile(plistPath(), 'utf8').catch(() => '');
    const hour = plist.match(/<key>Hour<\/key><integer>(\d+)/)?.[1];
    const minute = plist.match(/<key>Minute<\/key><integer>(\d+)/)?.[1];
    const when = hour && minute ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : '未知时间';
    return { supported: true, installed: true, detail: `launchd 任务已注册，每天 ${when} 运行` };
  }
  if (os === 'linux') {
    const line = (await readCrontab()).find((l) => l.includes(CRON_MARK));
    if (!line) return { supported: true, installed: false, detail: '未注册定时任务' };
    const [m, h] = line.split(/\s+/);
    return { supported: true, installed: true, detail: `crontab 已注册，每天 ${h}:${m?.padStart(2, '0')} 运行` };
  }
  return { supported: false, installed: false, detail: `暂不支持 ${os}` };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function readCrontab(): Promise<string[]> {
  const r = await run('crontab', ['-l']);
  if (r.code === 0) return r.stdout.split('\n').filter((l) => l.trim() !== '');
  // 只有「本来就没有 crontab」才当空表；其他失败若当空表处理，随后的写入会把用户整张 crontab 覆盖掉
  if (/no crontab for/i.test(r.stderr)) return [];
  throw new Error(`读取 crontab 失败，为避免覆盖已有任务已中止：${r.stderr.trim()}`);
}

async function writeCrontab(content: string): Promise<void> {
  // 覆写前留一份原文，出问题可用 crontab <备份文件> 恢复
  const current = await run('crontab', ['-l']);
  if (current.code === 0) {
    await mkdir(configDir(), { recursive: true, mode: 0o700 });
    await writeFile(join(configDir(), 'crontab.bak'), current.stdout, { mode: 0o600 });
  }
  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const p = spawn('crontab', ['-'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`crontab 写入失败：${err.trim()}`))));
    p.stdin.end(content);
  });
}
