// 各渠道共用的 webhook 发送逻辑。
// webhook URL 本身就是凭证（拿到即可往群里发消息），所以不用 util/retry 的 fetchJson——它的报错会带完整 URL。

import { retry } from '../util/retry.js';

/** 脱敏到只剩 host + 末 4 位，例如 `open.feishu.cn/…a1b2` */
export function maskWebhook(url: string): string {
  try {
    const u = new URL(url);
    const tail = url.replace(/[?#].*$/, '').slice(-4);
    // 钉钉的 token 在 query 里，路径末 4 位是固定的 /send，没有区分度，改取 token 末 4 位
    const token = u.searchParams.get('access_token') ?? u.searchParams.get('key');
    return `${u.host}/…${(token ?? tail).slice(-4)}`;
  } catch {
    return `…${url.slice(-4)}`;
  }
}

/** 把错误信息里可能出现的完整 URL / 密钥替换掉（undici 部分错误会带上请求地址） */
export function scrubSecrets(msg: string, secrets: (string | undefined)[]): string {
  let out = msg;
  for (const s of secrets) {
    if (s && s.length >= 4) out = out.split(s).join('***');
  }
  return out;
}

export interface WebhookRequest {
  url: string;
  body: unknown;
}

/**
 * POST JSON，网络错误 / 非 2xx 重试 3 次；返回解析后的 JSON。
 * build 每次尝试都重新调用：飞书/钉钉签名里带时间戳，重试时重新签更稳妥。
 * 业务错误码（errcode / code）由调用方在重试之外判断——签名错、关键词不匹配之类重试也没用。
 */
export async function postWebhook(
  build: () => WebhookRequest,
  label: string,
  { timeoutMs = 15_000, tries = 3, gapMs = 3_000 }: { timeoutMs?: number; tries?: number; gapMs?: number } = {},
): Promise<Record<string, unknown>> {
  return retry(
    async () => {
      const { url, body } = build();
      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const e = err as Error & { cause?: { message?: string } };
        const detail = e.cause?.message ? `${e.message}: ${e.cause.message}` : e.message;
        throw new Error(`请求 ${label} 失败：${scrubSecrets(detail, [url])}`);
      }
      const text = await res.text().catch(() => '');
      if (!res.ok) throw new Error(`请求 ${label} 失败：HTTP ${res.status} ${scrubSecrets(text.slice(0, 200), [url])}`);
      try {
        return JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error(`请求 ${label} 返回非 JSON：${scrubSecrets(text.slice(0, 200), [url])}`);
      }
    },
    { tries, gapMs },
  );
}
