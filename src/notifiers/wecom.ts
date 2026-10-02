// 企业微信群机器人：markdown 消息，content 上限 4096 字节（UTF-8）。无加签。
// 文档：https://developer.work.weixin.qq.com/document/path/91770

import { renderMarkdown, truncateUtf8 } from '../render.js';
import type { ChannelConfig, Notifier, Report } from '../types.js';
import { maskWebhook, postWebhook } from './shared.js';

export const WECOM_MAX_BYTES = 4096;

/** 企微 markdown 支持 <font color>：把数量高亮，扫一眼就知道有没有要处理的 */
export function toWecomMarkdown(md: string): string {
  return md
    .replace(/^(## ⚠️ 有 )(\d+)( 项可更新)$/m, '$1<font color="warning">$2</font>$3')
    .replace(/^(## ❌ 检测失败 )(\d+)( 项)$/m, '$1<font color="warning">$2</font>$3');
}

export function buildWecomBody(report: Report) {
  const content = renderMarkdown(report, { unit: 'byte', maxLength: WECOM_MAX_BYTES, transform: toWecomMarkdown });
  // render 已按字节控长，这里再兜底一次：超限企微会直接拒收整条消息（errcode 40058）
  return { msgtype: 'markdown', markdown: { content: truncateUtf8(content, WECOM_MAX_BYTES) } };
}

export const wecomNotifier: Notifier = {
  type: 'wecom',
  async send(report: Report, channel: ChannelConfig) {
    const label = `企业微信(${maskWebhook(channel.webhook)})`;
    const json = await postWebhook(() => ({ url: channel.webhook, body: buildWecomBody(report) }), label);
    if (json.errcode !== 0) throw new Error(`${label} 返回错误 ${String(json.errcode)}：${String(json.errmsg ?? '')}`);
  },
};
