// 钉钉自定义机器人：markdown 消息（title + text）。
// 文档：https://open.dingtalk.com/document/orgapp/customize-robot-security-settings
// 机器人若设置了「自定义关键词」，消息必须包含关键词（否则 errcode 310000）——标题与正文都固定带 toolbell。

import { createHmac } from 'node:crypto';
import { countByStatus, renderMarkdown } from '../render.js';
import type { ChannelConfig, Notifier, Report } from '../types.js';
import { maskWebhook, postWebhook } from './shared.js';

/** 官方上限 20000，按字节计更保守，同时给标题留余量 */
const MAX_TEXT_BYTES = 18_000;

/**
 * 钉钉签名：以 secret 作为 HMAC 的 key，对 `timestamp + "\n" + secret` 签名后 base64（未 urlEncode）。
 * 和飞书正好相反。timestamp 单位为毫秒，与服务器时间相差超过 1 小时会被拒。
 */
export function signDingtalk(timestampMs: number, secret: string): string {
  return createHmac('sha256', secret).update(`${timestampMs}\n${secret}`).digest('base64');
}

/** webhook 自带 ?access_token=，签名参数追加在后面；sign 必须 urlEncode（base64 里的 + / = 会被吞） */
export function buildDingtalkUrl(webhook: string, secret: string | undefined, now = Date.now()): string {
  if (!secret) return webhook;
  const sign = encodeURIComponent(signDingtalk(now, secret));
  return `${webhook}${webhook.includes('?') ? '&' : '?'}timestamp=${now}&sign=${sign}`;
}

/** 钉钉 markdown 单个换行会被吞：非空行之间的换行改成「两空格 + 换行」的硬换行，空行保持不变 */
export function toDingtalkMarkdown(md: string): string {
  return md.replace(/([^\n])\n(?!\n)/g, '$1  \n');
}

export function buildDingtalkBody(report: Report) {
  const { outdated, error } = countByStatus(report);
  const title =
    outdated > 0 ? `toolbell：${outdated} 项可更新` : error > 0 ? `toolbell：${error} 项检测失败` : 'toolbell：全部最新';
  const text = renderMarkdown(report, { unit: 'byte', maxLength: MAX_TEXT_BYTES, transform: toDingtalkMarkdown });
  return { msgtype: 'markdown', markdown: { title, text } };
}

export const dingtalkNotifier: Notifier = {
  type: 'dingtalk',
  async send(report: Report, channel: ChannelConfig) {
    const label = `钉钉(${maskWebhook(channel.webhook)})`;
    const body = buildDingtalkBody(report);
    const json = await postWebhook(() => ({ url: buildDingtalkUrl(channel.webhook, channel.secret), body }), label);
    if (json.errcode !== 0) throw new Error(`${label} 返回错误 ${String(json.errcode)}：${String(json.errmsg ?? '')}`);
  },
};
