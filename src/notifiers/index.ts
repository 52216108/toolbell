import type { ChannelConfig, ChannelType, Notifier, Report } from '../types.js';
import { dingtalkNotifier } from './dingtalk.js';
import { feishuNotifier } from './feishu.js';
import { maskWebhook, scrubSecrets } from './shared.js';
import { wecomNotifier } from './wecom.js';

export const notifiers: Record<ChannelType, Notifier> = {
  feishu: feishuNotifier,
  wecom: wecomNotifier,
  dingtalk: dingtalkNotifier,
};

export interface SendResult {
  type: ChannelType;
  ok: boolean;
  error?: string;
}

/** 并发发往所有渠道；单个渠道失败只记录，不影响其他渠道，也不抛出 */
export async function sendAll(report: Report, channels: ChannelConfig[], log: (msg: string) => void): Promise<SendResult[]> {
  return Promise.all(
    channels.map(async (ch): Promise<SendResult> => {
      const where = `${ch.type}(${maskWebhook(ch.webhook)})`;
      try {
        const n = notifiers[ch.type];
        if (!n) throw new Error(`不支持的渠道类型：${String(ch.type)}`);
        await n.send(report, ch);
        log(`通知已发送：${where}`);
        return { type: ch.type, ok: true };
      } catch (err) {
        // 兜底再脱敏一次，防止某条错误路径把 webhook / secret 带出来
        const msg = scrubSecrets(err instanceof Error ? err.message : String(err), [ch.webhook, ch.secret]);
        log(`通知发送失败：${where}：${msg}`);
        return { type: ch.type, ok: false, error: msg };
      }
    }),
  );
}
