// 网络操作重试：本机挂代理时偶发 Connection reset，单次尝试会把瞬时抖动记成失败。

export async function retry<T>(
  fn: () => Promise<T>,
  { tries = 3, gapMs = 3_000 }: { tries?: number; gapMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < tries) await new Promise((r) => setTimeout(r, gapMs));
    }
  }
  throw lastErr;
}

/** 带超时与重试的 fetch，非 2xx 视为失败抛出 */
export async function fetchJson<T = unknown>(
  url: string,
  init: RequestInit & { timeoutMs?: number; tries?: number } = {},
): Promise<T> {
  const { timeoutMs = 20_000, tries = 3, ...rest } = init;
  return retry(
    async () => {
      const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${url}: ${body.slice(0, 200)}`);
      }
      return (await res.json()) as T;
    },
    { tries },
  );
}
