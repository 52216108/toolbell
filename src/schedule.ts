import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { homedir, platform, userInfo } from 'node:os';
import { join } from 'node:path';
import { logPath, parseTime } from './config.js';
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

export function buildPlist(opts: {
  cli: string;
  hour: number;
  minute: number;
  path: string;
  home: string;
  log: string;
}): string {
  const s = (v: string) => `<string>${xmlEscape(v)}</string>`;
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
  <dict><key>PATH</key>${s(opts.path)}<key>HOME</key>${s(opts.home)}</dict>
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
    await writeFile(
      file,
      buildPlist({ cli, hour, minute, path, home: homedir(), log: logPath() }),
    );
    const domain = `gui/${userInfo().uid}`;
    // 已加载过先卸载再加载，才能让新时间生效；首次安装时 bootout 报错属正常
    await run('launchctl', ['bootout', domain, file]);
    const r = await run('launchctl', ['bootstrap', domain, file]);
    if (r.code !== 0) throw new Error(`launchctl bootstrap 失败：${r.stderr.trim()}`);
    return `已注册 launchd 任务（${LABEL}），每天 ${time} 运行`;
  }

  if (os === 'linux') {
    const line = `${minute} ${hour} * * * PATH=${shellQuote(path)} ${shellQuote(cli)} check >> ${shellQuote(logPath())} 2>&1 ${CRON_MARK}`;
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
  // 没有 crontab 时退出码非零，视为空
  return r.code === 0 ? r.stdout.split('\n').filter((l) => l.trim() !== '') : [];
}

async function writeCrontab(content: string): Promise<void> {
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
