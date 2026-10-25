// AI 影响评估：把今天的更新 + changelog 原文交给 OpenAI 兼容接口，按「对用户有没有影响」分级。
// 这是锦上添花的功能：任何失败都只记日志并返回简短原因，绝不能让通知发不出去。

import { fairShare } from './changelog.js';
import { toolKey, type AiConfig, type CheckResult } from './types.js';
import { retry } from './util/retry.js';

const CHANGELOG_BUDGET = 40_000;
const TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT = `你是一名资深开发工程师，帮用户评估本机开发工具的版本更新对他的实际影响。
要求：
- 输出 Markdown，不要输出一级标题（#），不要用代码块包裹整个回答，小节标题用「### 」。
- 严格按以下结构输出：
  ### 一句话总结
  ### 🔴 高影响
  （对用户技术栈 / 工作流有直接影响的变更，每条写清是哪个工具、什么变化、给出具体行动建议）
  ### 🟡 中影响
  ### ⚪ 低影响 / 无影响
  （每个工具一句话说明即可）
- 某一级没有内容时写「无」。
- 诚实、不夸大：只依据给出的 changelog 判断，没写的不要臆测；与用户技术栈无关的变更明确归入低影响。
- 安全修复、破坏性变更（breaking change）、默认行为变化、废弃/移除的功能要重点指出。
- 全文控制在 1500 字以内。`;

/** 错误信息里去掉 API Key：部分服务商 401 时会回显（半遮挡的）key */
export function scrub(msg: string, apiKey: string): string {
  let out = apiKey ? msg.split(apiKey).join('***') : msg;
  out = out.replace(/\b(sk|ak|key)-[A-Za-z0-9*_\-.]{6,}/gi, '$1-***');
  return out.replace(/Bearer\s+\S+/gi, 'Bearer ***');
}

export function buildDigestPrompt(results: CheckResult[], changelogs: Map<string, string>, profile?: string): string {
  const outdated = results.filter((r) => r.status === 'outdated');
  const withLog = outdated.filter((r) => changelogs.has(toolKey(r.tool)));
  const shares = fairShare(
    withLog.map((r) => changelogs.get(toolKey(r.tool))!.length),
    CHANGELOG_BUDGET,
  );
  const budget = new Map(withLog.map((r, i) => [toolKey(r.tool), shares[i]!]));

  const lines = [`## 用户背景\n\n${profile?.trim() || '未提供'}`, `## 今天检测到 ${outdated.length} 项可更新`];
  for (const r of outdated) {
    const extra = r.commitsBehind !== undefined ? `，落后 ${r.commitsBehind} 个提交` : '';
    lines.push(`- ${r.tool.name}（来源 ${r.tool.source}${r.repo ? `，仓库 ${r.repo}` : ''}）：${r.tool.installed} → ${r.latest ?? '?'}${extra}`);
  }
  lines.push('## 各工具 changelog 原文');
  for (const r of outdated) {
    const key = toolKey(r.tool);
    const log = changelogs.get(key);
    if (!log) {
      lines.push(`### ${r.tool.name}\n\n（未获取到 changelog，只能根据版本跨度判断）`);
      continue;
    }
    const n = budget.get(key) ?? 0;
    lines.push(`### ${r.tool.name}\n\n${n >= log.length ? log : `${log.slice(0, n)}\n…（已截断）`}`);
  }
  return lines.join('\n\n');
}

/** 模型偶尔不守格式：去掉推理模型的 <think>、整体代码块包裹，把 H1 降级 */
export function cleanDigest(text: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fenced = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  if (fenced) t = fenced[1]!.trim();
  return t.replace(/^# (?=\S)/gm, '### ');
}

/** 通知里展示的失败原因：只留 HTTP 状态 + 服务商错误码，原始报文太长且可能夹带敏感信息 */
export function briefDigestError(detail: string): string {
  const http = detail.match(/^HTTP (\d{3})：([\s\S]*)$/);
  if (http) {
    let code = '';
    try {
      const body = JSON.parse(http[2]!) as { error?: { code?: unknown; type?: unknown } | string };
      const e = body.error;
      code = typeof e === 'object' && e ? String(e.code ?? e.type ?? '') : typeof e === 'string' ? e : '';
    } catch {
      // 非 JSON 响应（网关 HTML 等）：只报状态码
    }
    // 错误码只放行常见字符，防止服务商回显的内容（含 URL、Key 片段）混进通知
    const safeCode = /^[\w.\-]{1,80}$/.test(code) ? ` ${code}` : '';
    return `HTTP ${http[1]}${safeCode}`;
  }
  // 非 HTTP 错误的原文可能带接口地址（含凭证/查询串），只映射成固定文案
  if (/timeout|aborted/i.test(detail)) return '请求超时';
  if (/ENOTFOUND|EAI_AGAIN/i.test(detail)) return '域名解析失败';
  if (/Invalid URL|ERR_INVALID_URL/i.test(detail)) return '接口地址无效';
  if (/JSON/i.test(detail)) return '接口返回格式异常';
  return '网络请求失败';
}

export interface DigestOutcome {
  text?: string;
  /** 已开启 AI 却没拿到评估时的简短原因 */
  error?: string;
}

export async function generateDigest(
  results: CheckResult[],
  changelogs: Map<string, string>,
  ai: AiConfig,
  log: (msg: string) => void,
): Promise<DigestOutcome> {
  if (!ai.enabled) return {};
  if (!results.some((r) => r.status === 'outdated')) return {};
  if (!ai.baseURL || !ai.apiKey || !ai.model) {
    log('AI 总结：配置不完整（baseURL / apiKey / model），已跳过');
    return { error: '配置不完整（接口地址 / API Key / 模型）' };
  }
  const url = `${ai.baseURL.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: ai.model,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildDigestPrompt(results, changelogs, ai.profile) },
    ],
  };
  try {
    const json = await retry(
      async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const text = await res.text().catch(() => '');
        if (!res.ok) throw new Error(`HTTP ${res.status}：${text.slice(0, 300)}`);
        return JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
      },
      { tries: 2, gapMs: 5_000 },
    );
    const content = json.choices?.[0]?.message?.content;
    if (!content?.trim()) {
      log('AI 总结：接口返回内容为空，已跳过');
      return { error: '接口返回内容为空' };
    }
    return { text: cleanDigest(content) };
  } catch (err) {
    const e = err as Error & { cause?: { message?: string } };
    const detail = e.cause?.message ? `${e.message}: ${e.cause.message}` : (e?.message ?? String(err));
    const safe = scrub(detail, ai.apiKey);
    log(`AI 总结失败（${ai.model}）：${safe}`);
    return { error: scrub(briefDigestError(safe), ai.apiKey) };
  }
}
