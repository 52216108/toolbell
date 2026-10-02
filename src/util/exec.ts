import { execFile } from 'node:child_process';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * 执行外部命令，永不抛出：命令不存在 / 超时 / 非零退出都体现在 code 上（不存在时 code=127）。
 * 扫描器只用它调包管理器，单个命令失败不应拖垮整次检测。
 */
export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeoutMs ?? 120_000,
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        maxBuffer: 64 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
        const e = err as NodeJS.ErrnoException & { code?: number | string };
        const code = e.code === 'ENOENT' ? 127 : typeof e.code === 'number' ? e.code : 1;
        resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || e.message });
      },
    );
  });
}

/** 通过 shell 执行一整条命令字符串（用于用户配置的 versionCommand 等） */
export function runShell(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return run('/bin/sh', ['-c', command], opts);
}

/** 命令是否存在于 PATH */
export async function hasCommand(cmd: string): Promise<boolean> {
  const r = await run('/bin/sh', ['-c', `command -v ${cmd}`], { timeoutMs: 5_000 });
  return r.code === 0 && r.stdout.trim() !== '';
}
