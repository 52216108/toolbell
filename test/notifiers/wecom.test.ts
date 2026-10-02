import { describe, expect, it } from 'vitest';
import { buildWecomBody, WECOM_MAX_BYTES } from '../../src/notifiers/wecom.js';
import { truncateUtf8 } from '../../src/render.js';
import type { CheckResult, Report } from '../../src/types.js';

describe('truncateUtf8', () => {
  it('不切在多字节字符中间', () => {
    const s = '中文😀abc'; // 中=3 文=3 😀=4
    expect(truncateUtf8(s, 5)).toBe('中');
    expect(truncateUtf8(s, 6)).toBe('中文');
    expect(truncateUtf8(s, 9)).toBe('中文');
    expect(truncateUtf8(s, 10)).toBe('中文😀');
    expect(truncateUtf8(s, 100)).toBe(s);
    for (let n = 0; n <= Buffer.byteLength(s); n++) {
      const out = truncateUtf8(s, n);
      expect(Buffer.byteLength(out)).toBeLessThanOrEqual(n);
      expect(out).not.toContain('�');
      expect(s.startsWith(out)).toBe(true);
    }
  });
});

describe('企微消息体', () => {
  it('大量中文内容时 content 不超过 4096 字节且可更新列表保留', () => {
    const results: CheckResult[] = Array.from({ length: 20 }, (_, i) => ({
      tool: { source: 'npm', name: `包${i}`, installed: '1.0.0' },
      status: 'outdated',
      latest: '2.0.0',
      updateCommand: `npm i -g 包${i}`,
    }));
    const report: Report = {
      hostname: 'mac',
      startedAt: new Date(2026, 9, 2, 9, 0),
      durationMs: 1234,
      results,
      digest: '影响评估内容很长。'.repeat(1000),
    };
    const body = buildWecomBody(report);
    const content = body.markdown.content;
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(WECOM_MAX_BYTES);
    expect(content).toContain('包19');
    expect(content).toContain('<font color="warning">20</font>');
    expect(content).toContain('…（内容过长已截断）');
    expect(content).toContain('⏱️ 耗时 1.2s');
  });
});
