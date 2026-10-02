import { describe, expect, it } from 'vitest';
import { renderMarkdown, renderTitle, TRUNCATED_NOTICE } from '../src/render.js';
import type { CheckResult, Report } from '../src/types.js';

const r = (x: Partial<CheckResult> & { name: string; source?: CheckResult['tool']['source'] }): CheckResult => ({
  tool: { source: x.source ?? 'brew', name: x.name, installed: '1.0.0' },
  status: x.status ?? 'outdated',
  latest: x.latest ?? '2.0.0',
  updateCommand: x.updateCommand,
  commitsBehind: x.commitsBehind,
  note: x.note,
  error: x.error,
});

const base = (results: CheckResult[], digest?: string): Report => ({
  hostname: 'my-mac',
  startedAt: new Date(2026, 9, 2, 9, 5),
  durationMs: 12_345,
  results,
  digest,
});

describe('renderMarkdown', () => {
  const results = [
    r({ name: 'ruff', source: 'uv', updateCommand: 'uv tool upgrade ruff' }),
    r({ name: 'asc', source: 'brew', updateCommand: 'brew upgrade asc' }),
    r({ name: 'dotfiles', source: 'git', commitsBehind: 7, note: '工作区有未提交改动' }),
    r({ name: 'broken', source: 'npm', status: 'error', error: 'npm ERR!\n  network timeout' }),
    r({ name: 'jq', status: 'latest' }),
    r({ name: 'repo2', source: 'git', status: 'latest', note: '工作区有未提交改动' }),
  ];

  it('按来源分组、失败/提示/最新计数/耗时', () => {
    const md = renderMarkdown(base(results));
    expect(md).toContain('# 🔔 toolbell 更新提醒 · my-mac · 2026-10-02 09:05');
    expect(md).toContain('## ⚠️ 有 3 项可更新');
    // 分组顺序按 SourceId 登记顺序：Homebrew 在 uv 之前，Git 在后
    expect(md.indexOf('**Homebrew**')).toBeLessThan(md.indexOf('**uv 工具**'));
    expect(md.indexOf('**uv 工具**')).toBeLessThan(md.indexOf('**Git 仓库**'));
    expect(md).toContain('- **asc** 1.0.0 → 2.0.0\n  `brew upgrade asc`');
    expect(md).toContain('（落后 7 个提交）');
    expect(md).toContain('## ❌ 检测失败 1 项');
    expect(md).toContain('- **broken**（npm 全局包）：npm ERR! network timeout');
    expect(md).toContain('## 💡 提示\n\n- **repo2**：工作区有未提交改动');
    expect(md).toContain('✅ 其余 2 项已是最新');
    expect(md).not.toContain('**jq**');
    expect(md.trimEnd().endsWith('⏱️ 耗时 12.3s')).toBe(true);
  });

  it('全部最新时标题与计数', () => {
    const rep = base([r({ name: 'jq', status: 'latest' })]);
    expect(renderTitle(rep)).toContain('全部最新');
    expect(renderMarkdown(rep)).toContain('✅ 全部 1 项已是最新');
  });

  it('超长时先截 digest 尾部，保留可更新与失败列表', () => {
    const digest = `### 一句话总结\n\n开头保留\n\n${'很长的影响评估。\n'.repeat(500)}结尾标记`;
    const full = renderMarkdown(base(results, digest));
    const max = 1200;
    const md = renderMarkdown(base(results, digest), { maxLength: max });
    expect(full.length).toBeGreaterThan(max);
    expect(md.length).toBeLessThanOrEqual(max);
    expect(md).toContain('## ⚠️ 有 3 项可更新');
    expect(md).toContain('`uv tool upgrade ruff`');
    expect(md).toContain('## ❌ 检测失败 1 项');
    expect(md).toContain('## AI 影响评估');
    expect(md).toContain('开头保留');
    expect(md).not.toContain('结尾标记');
    expect(md).toContain(TRUNCATED_NOTICE);
    expect(md.trimEnd().endsWith('⏱️ 耗时 12.3s')).toBe(true);
  });

  it('连必保留部分都放不下时按行截断并带截断提示', () => {
    const many = Array.from({ length: 100 }, (_, i) => r({ name: `tool${i}`, updateCommand: `brew upgrade tool${i}` }));
    const md = renderMarkdown(base(many, '评估'), { maxLength: 800 });
    expect(md.length).toBeLessThanOrEqual(800);
    expect(md).toContain('tool0');
    expect(md).not.toContain('tool99');
    expect(md).not.toContain('AI 影响评估');
    expect(md).toContain(TRUNCATED_NOTICE);
  });

  it('按字节计长度时也不超限', () => {
    const digest = '中文评估😀'.repeat(2000);
    const md = renderMarkdown(base(results, digest), { maxLength: 2000, unit: 'byte' });
    expect(Buffer.byteLength(md)).toBeLessThanOrEqual(2000);
    expect(md).not.toContain('�');
  });
});
