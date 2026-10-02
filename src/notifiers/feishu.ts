// 飞书自定义机器人：interactive 卡片（JSON 1.0 + markdown 元素，自定义机器人兼容性最好）。
// 文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot

import { createHmac } from 'node:crypto';
import { countByStatus, renderMarkdown, renderTitle } from '../render.js';
import type { ChannelConfig, Notifier, Report } from '../types.js';
import { maskWebhook, postWebhook } from './shared.js';

/** 卡片请求体上限约 30KB；正文留出 header 与 JSON 转义的余量 */
const MAX_CONTENT_BYTES = 24_000;

/**
 * 飞书签名：以 `timestamp + "\n" + secret` 作为 HMAC 的 **key**，对空字符串签名后 base64。
 * 和钉钉正好相反（钉钉是 secret 作 key、对 stringToSign 签名），混用会报 19021 sign match fail。
 * timestamp 单位为秒。
 */
export function signFeishu(timestampSec: number, secret: string): string {
  return createHmac('sha256', `${timestampSec}\n${secret}`).update('').digest('base64');
}

/** 飞书卡片 markdown 不支持 # 标题：转成加粗行；< > 会被当成标签解析，按官方转义表转成实体 */
export function toFeishuMarkdown(md: string): string {
  return md
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/^#{1,6}\s+(.+)$/gm, (_, t: string) => `**${t.replace(/\*\*/g, '').trim()}**`);
}

export function buildFeishuCard(report: Report) {
  const { outdated, error } = countByStatus(report);
  const template = error > 0 ? 'red' : outdated > 0 ? 'orange' : 'green';
  const content = renderMarkdown(report, {
    includeTitle: false,
    unit: 'byte',
    maxLength: MAX_CONTENT_BYTES,
    transform: toFeishuMarkdown,
  });
  return {
    config: { wide_screen_mode: true },
    header: { template, title: { tag: 'plain_text', content: renderTitle(report) } },
    elements: [{ tag: 'markdown', content }],
  };
}

export function buildFeishuBody(report: Report, secret?: string, now = Date.now()) {
  const card = buildFeishuCard(report);
  if (!secret) return { msg_type: 'interactive', card };
  const timestamp = Math.floor(now / 1000);
  return { timestamp: String(timestamp), sign: signFeishu(timestamp, secret), msg_type: 'interactive', card };
}

export const feishuNotifier: Notifier = {
  type: 'feishu',
  async send(report: Report, channel: ChannelConfig) {
    const label = `飞书(${maskWebhook(channel.webhook)})`;
    const json = await postWebhook(() => ({ url: channel.webhook, body: buildFeishuBody(report, channel.secret) }), label);
    // 新版返回 {code, msg}，旧版返回 {StatusCode, StatusMessage}
    const code = json.code ?? json.StatusCode;
    if (typeof code === 'number' && code !== 0) {
      throw new Error(`${label} 返回错误 ${code}：${String(json.msg ?? json.StatusMessage ?? '')}`);
    }
  },
};
