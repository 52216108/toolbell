// 把一次检测的 Report 渲染成各渠道共用的 Markdown。
// 渠道差异（飞书不认 # 标题、钉钉要两空格换行、企微按字节限长）由 notifiers 通过 transform / unit 注入，
// 这样截断时量的是「最终发出去的文本」，不会因为转换后变长而超限。

import type { CheckResult, Report, SourceId } from './types.js';

/** 来源展示名与分组顺序（按这里的顺序输出） */
export const SOURCE_LABELS: Record<SourceId, string> = {
  brew: 'Homebrew',
  'brew-cask': 'Homebrew Cask',
  npm: 'npm 全局包',
  pnpm: 'pnpm 全局包',
  uv: 'uv 工具',
  pipx: 'pipx',
  cargo: 'Cargo',
  git: 'Git 仓库',
  'github-release': 'GitHub Release',
  'claude-plugin': 'Claude Code 插件',
};

export const TRUNCATED_NOTICE = '…（内容过长已截断）';

export type LengthUnit = 'char' | 'byte';

export interface RenderOptions {
  /** 最终文本长度上限（按 unit 计）；不传不截断 */
  maxLength?: number;
  /** 长度单位：char = UTF-16 长度；byte = UTF-8 字节（企微/飞书按字节限长） */
  unit?: LengthUnit;
  /** 是否在正文开头输出 `# 标题`；飞书卡片有 header，传 false 避免重复 */
  includeTitle?: boolean;
  /** 渠道方言转换，必须是逐行的纯函数（截断按转换后的长度计算） */
  transform?: (md: string) => string;
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatTime(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function countByStatus(report: Report) {
  let outdated = 0;
  let error = 0;
  let latest = 0;
  for (const r of report.results) {
    if (r.status === 'outdated') outdated++;
    else if (r.status === 'error') error++;
    else latest++;
  }
  return { outdated, error, latest };
}

export function renderTitle(report: Report): string {
  const { outdated, error } = countByStatus(report);
  const tail = `${report.hostname} · ${formatTime(report.startedAt)}`;
  if (outdated > 0) return `🔔 toolbell 更新提醒 · ${tail}`;
  if (error > 0) return `⚠️ toolbell 检测异常 · ${tail}`;
  return `✅ toolbell 全部最新 · ${tail}`;
}

/** 单行化：错误信息常带多行 stderr，原样输出会打乱列表结构 */
function oneLine(s: string, max = 200): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function sourceLabel(id: SourceId): string {
  return SOURCE_LABELS[id] ?? id;
}

function groupBySource(results: CheckResult[]): [SourceId, CheckResult[]][] {
  const order = Object.keys(SOURCE_LABELS) as SourceId[];
  const map = new Map<SourceId, CheckResult[]>();
  for (const r of results) {
    const list = map.get(r.tool.source) ?? [];
    list.push(r);
    map.set(r.tool.source, list);
  }
  const rank = (s: SourceId) => {
    const i = order.indexOf(s);
    return i < 0 ? order.length : i;
  };
  return [...map.entries()].sort((a, b) => rank(a[0]) - rank(b[0]));
}

function renderOutdated(list: CheckResult[]): string {
  const lines = [`## ⚠️ 有 ${list.length} 项可更新`];
  for (const [source, items] of groupBySource(list)) {
    // 组名与列表之间空一行：钉钉等渲染器不一定允许列表直接打断段落
    lines.push('', `**${sourceLabel(source)}**`, '');
    for (const r of items) {
      let head = `- **${r.tool.name}** ${r.tool.installed} → ${r.latest ?? '?'}`;
      if (r.commitsBehind !== undefined) head += `（落后 ${r.commitsBehind} 个提交）`;
      lines.push(head);
      if (r.updateCommand) lines.push(`  \`${r.updateCommand}\``);
      if (r.note) lines.push(`  💬 ${oneLine(r.note)}`);
    }
  }
  return lines.join('\n');
}

function renderErrors(list: CheckResult[]): string {
  const lines = [`## ❌ 检测失败 ${list.length} 项`, ''];
  for (const r of list) {
    lines.push(`- **${r.tool.name}**（${sourceLabel(r.tool.source)}）：${oneLine(r.error ?? '未知错误')}`);
  }
  return lines.join('\n');
}

function renderTips(list: CheckResult[]): string {
  const lines = ['## 💡 提示', ''];
  for (const r of list) lines.push(`- **${r.tool.name}**：${oneLine(r.note ?? '')}`);
  return lines.join('\n');
}

export function measure(s: string, unit: LengthUnit = 'char'): number {
  return unit === 'byte' ? Buffer.byteLength(s, 'utf8') : s.length;
}

/** 按 UTF-8 字节截断，保证不切在多字节字符中间（企微按字节计 4096 上限，中文 3 字节、emoji 4 字节） */
export function truncateUtf8(s: string, maxBytes: number): string {
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return s;
  let bytes = 0;
  let out = '';
  // for..of 按码点迭代，不会把 emoji 的代理对拆开
  for (const ch of s) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > maxBytes) break;
    bytes += b;
    out += ch;
  }
  return out;
}

/** 按码点截断到 maxChars（UTF-16 长度），避免切开 emoji 代理对 */
function truncateChars(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  let out = '';
  for (const ch of s) {
    if (out.length + ch.length > maxChars) break;
    out += ch;
  }
  return out;
}

/**
 * 把文本截到 budget 以内，尽量在换行处断开（避免把 `代码` / **加粗** 切成半截导致后文渲染错乱）。
 * 只有在最后一个换行离末尾太远（丢失超过一半内容）时才硬切。
 */
function truncateText(s: string, budget: number, unit: LengthUnit, transform: (x: string) => string): string {
  if (budget <= 0) return '';
  if (measure(transform(s), unit) <= budget) return s;
  // transform 是逐行的，长度膨胀有限；先按原文硬切，再逐步收缩直到转换后也放得下
  let cut = unit === 'byte' ? truncateUtf8(s, budget) : truncateChars(s, budget);
  while (cut && measure(transform(cut), unit) > budget) {
    cut = unit === 'byte' ? truncateUtf8(cut, Math.floor(measure(cut, 'byte') * 0.9)) : truncateChars(cut, Math.floor(cut.length * 0.9));
  }
  const nl = cut.lastIndexOf('\n');
  if (nl > cut.length / 2) cut = cut.slice(0, nl);
  return cut.trimEnd();
}

export function renderMarkdown(report: Report, opts: RenderOptions = {}): string {
  const unit = opts.unit ?? 'char';
  const transform = opts.transform ?? ((x: string) => x);
  const outdated = report.results.filter((r) => r.status === 'outdated');
  const errors = report.results.filter((r) => r.status === 'error');
  const tips = report.results.filter((r) => r.status === 'latest' && r.note);
  const latestCount = report.results.length - outdated.length - errors.length;

  const title = opts.includeTitle === false ? '' : `# ${renderTitle(report)}`;
  // 必保留部分：可更新 + 失败（用户真正要行动的信息）
  const core = [outdated.length ? renderOutdated(outdated) : '', errors.length ? renderErrors(errors) : ''].filter(Boolean);
  const tipsBlock = tips.length ? renderTips(tips) : '';
  let latestLine = '';
  if (latestCount > 0) {
    latestLine = outdated.length || errors.length ? `✅ 其余 ${latestCount} 项已是最新` : `✅ 全部 ${latestCount} 项已是最新`;
  } else if (report.results.length === 0) {
    latestLine = '未发现需要跟踪的工具';
  }
  const digest = report.digest?.trim() ? `## AI 影响评估\n\n${report.digest.trim()}` : '';
  const footer = `⏱️ 耗时 ${(report.durationMs / 1000).toFixed(1)}s`;

  const join = (parts: string[]) => parts.filter(Boolean).join('\n\n');
  const full = join([title, ...core, tipsBlock, latestLine, digest, footer]);
  const max = opts.maxLength;
  if (max === undefined || measure(transform(full), unit) <= max) return transform(full);

  // 超长：可更新/失败 > 已是最新/耗时 > 提示 > AI 评估。块之间用 \n\n 连接，按 2 个单位预留
  const sep = 2;
  const size = (s: string) => (s ? measure(transform(s), unit) + sep : 0);
  const fixed = [title, latestLine, footer, TRUNCATED_NOTICE].reduce((n, s) => n + size(s), 0);
  const coreText = join(core);

  if (size(coreText) + fixed > max) {
    // 连必保留部分都放不下：只能从失败列表尾部开始砍（可更新列表在前，按行截断天然先丢失败项）
    const budget = max - fixed;
    const cut = truncateText(coreText, budget, unit, transform);
    return transform(join([title, cut, TRUNCATED_NOTICE, latestLine, footer]));
  }

  let remaining = max - fixed - size(coreText);
  const keptTips = tipsBlock && size(tipsBlock) <= remaining ? tipsBlock : '';
  remaining -= size(keptTips);

  let keptDigest = '';
  // 剩余空间太小时整段丢弃 AI 评估，避免只剩个标题加半句话
  if (digest && remaining > 80) keptDigest = truncateText(digest, remaining - sep, unit, transform);
  return transform(join([title, ...core, keptTips, latestLine, keptDigest, TRUNCATED_NOTICE, footer]));
}
