import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { platform } from 'node:os';
import { discoverAll, runCheck } from '../check.js';
import { describeTools, fillChineseWithAi } from '../describe/index.js';
import { defaultConfig, lastRunPath, loadConfig, saveConfig } from '../config.js';
import { sendAll } from '../notifiers/index.js';
import { renderMarkdown } from '../render.js';
import { installSchedule, isEphemeralInstall, scheduleStatus } from '../schedule.js';
import type { Config } from '../types.js';
import { toolKey } from '../types.js';
import { run } from '../util/exec.js';
import { PAGE_HTML } from './page.js';
import { aiPresets, applyPatch, channelLabels, PatchError, publicConfig, type ConfigPatch } from './state.js';

// 本地网页配置服务。威胁模型：同机其他网页（CSRF / DNS rebinding）和其他用户进程不能读写配置。
// - 只监听 127.0.0.1
// - 校验 Host 头只能是 127.0.0.1:<port> / localhost:<port>（挡 DNS rebinding）
// - 每次启动生成随机 token，页面与所有 API 都要带上（挡跨站请求）
// - 凭证不下发给页面（见 state.ts）

const IDLE_MS = 30 * 60_000;
const MAX_BODY = 1024 * 1024;

export interface UiOptions {
  port?: number;
  open?: boolean;
}

export async function startUi(opts: UiOptions = {}): Promise<void> {
  const token = randomBytes(24).toString('hex');
  let idleTimer: NodeJS.Timeout | undefined;
  let port = 0;

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      const msg = err instanceof PatchError ? err.message : `内部错误：${(err as Error).message}`;
      json(res, err instanceof PatchError ? 400 : 500, { error: msg });
    });
  });

  const shutdown = (reason: string) => {
    console.log(reason);
    server.close();
    process.exit(0);
  };
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => shutdown('30 分钟无操作，配置页已自动关闭'), IDLE_MS);
  };

  const authorized = (req: IncomingMessage, url: URL): boolean => {
    const host = req.headers.host ?? '';
    // 浏览器访问默认端口时 Host 不带端口号
    const allowed = [`127.0.0.1:${port}`, `localhost:${port}`];
    if (port === 80) allowed.push('127.0.0.1', 'localhost');
    if (!allowed.includes(host)) return false;
    const given = String(req.headers['x-toolbell-token'] ?? url.searchParams.get('t') ?? '');
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  };

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (!authorized(req, url)) return json(res, 403, { error: '链接无效或已过期，请重新运行 toolbell ui' });
    // 只有通过鉴权的请求才算「有操作」，否则同机任意网页反复探测就能让服务常驻
    resetIdle();

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'",
        'Referrer-Policy': 'no-referrer',
      });
      return void res.end(PAGE_HTML);
    }

    if (req.method === 'GET' && url.pathname === '/api/state') return json(res, 200, await state());

    if (req.method !== 'POST') return json(res, 404, { error: '未知接口' });
    const body = (await readBody(req)) as Record<string, unknown>;

    switch (url.pathname) {
      case '/api/config': {
        const current = (await loadConfig()) ?? defaultConfig();
        const next = applyPatch(current, body as ConfigPatch);
        await saveConfig(next);
        let scheduleMsg: string | undefined;
        if (body.installSchedule === true && next.schedule) {
          scheduleMsg = (await isEphemeralInstall())
            ? '当前通过 npx 临时运行，未注册定时任务。请先全局安装 toolbell'
            : await installSchedule(next.schedule.time).catch((e: Error) => `定时任务注册失败：${e.message}`);
        }
        return json(res, 200, { ok: true, scheduleMsg, state: await state() });
      }
      case '/api/preview': {
        // 预览不调 AI（省费用、快），不推送
        const config = (await loadConfig()) ?? defaultConfig();
        const report = await runCheck({ ...config, ai: undefined }, { dryRun: true, notify: false });
        return json(res, 200, { markdown: renderMarkdown(report) });
      }
      case '/api/test-notify': {
        const config = (await loadConfig()) ?? defaultConfig();
        if (config.channels.length === 0) throw new PatchError('还没有配置通知渠道');
        const report = await runCheck({ ...config, ai: undefined }, { notify: false });
        const logs: string[] = [];
        const sent = await sendAll(report, config.channels, (m) => logs.push(m));
        return json(res, 200, { sent: sent.map((s) => ({ type: s.type, ok: s.ok, error: s.error })) });
      }
      case '/api/describe-ai': {
        const config = (await loadConfig()) ?? defaultConfig();
        if (!config.ai?.apiKey) throw new PatchError('请先在「AI 解读」里填写接口、模型与 API Key 并保存');
        const found = await discoverAll({ dryRun: true, log: () => {}, config: { ...config, scanners: {} } });
        const n = await fillChineseWithAi([...found.values()].flat(), config.ai, () => {}).catch((e: Error) => {
          throw new PatchError(e.message);
        });
        return json(res, 200, { filled: n, state: await state() });
      }
      case '/api/shutdown': {
        json(res, 200, { ok: true });
        setTimeout(() => shutdown('配置页已关闭'), 100);
        return;
      }
      default:
        return json(res, 404, { error: '未知接口' });
    }
  }

  async function state() {
    const config: Config = (await loadConfig()) ?? defaultConfig();
    // 发现时忽略「来源开关」，让关掉的来源也能在页面上看到并重新打开
    const found = await discoverAll({ dryRun: true, log: () => {}, config: { ...config, scanners: {} } });
    const lastRun = await readFile(lastRunPath(), 'utf8')
      .then((s) => JSON.parse(s) as { startedAt: string; outdated: { key: string; latest?: string }[] })
      .catch(() => undefined);
    const outdated = Object.fromEntries((lastRun?.outdated ?? []).map((o) => [o.key, o.latest ?? '']));
    const descs = await describeTools([...found.values()].flat());
    return {
      config: publicConfig(config),
      sources: [...found].map(([s, tools]) => ({
        id: s.id,
        label: s.label,
        tools: tools.map((t) => ({
          key: toolKey(t),
          name: t.name,
          installed: t.installed,
          latest: outdated[toolKey(t)],
          zh: descs.get(toolKey(t))?.zh,
          en: descs.get(toolKey(t))?.en,
        })),
      })),
      lastRunAt: lastRun?.startedAt,
      schedule: (await scheduleStatus()).detail,
      presets: aiPresets,
      channelLabels,
    };
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  port = typeof addr === 'object' && addr ? addr.port : 0;
  const link = `http://127.0.0.1:${port}/?t=${token}`;
  resetIdle();

  console.log(`toolbell 配置页已启动：\n\n  ${link}\n\n在浏览器打开上面的地址进行配置；完成后点页面右上角「完成」或按 Ctrl+C 退出。`);
  // Linux 上 xdg-open 可能把带 token 的链接留在浏览器进程参数里，同机其他用户 ps 可见，默认不自动打开
  const autoOpen = opts.open ?? platform() === 'darwin';
  if (autoOpen) {
    const opener = platform() === 'darwin' ? 'open' : platform() === 'win32' ? 'explorer' : 'xdg-open';
    void run(opener, [link], { timeoutMs: 10_000 });
  }
  process.on('SIGINT', () => shutdown('\n配置页已关闭'));
}

function json(res: ServerResponse, status: number, data: unknown): void {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new PatchError('请求过大');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new PatchError('请求格式错误');
  }
}
