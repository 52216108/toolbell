import { describe, expect, it } from 'vitest';
import { fairShare, formatReleases, selectReleaseRange, tagVersion } from '../src/changelog.js';
import type { GithubRelease } from '../src/util/github.js';

const rel = (tag: string, extra: Partial<GithubRelease> = {}): GithubRelease => ({
  tag_name: tag,
  name: tag,
  body: `notes of ${tag}`,
  draft: false,
  prerelease: false,
  published_at: '2026-09-01T00:00:00Z',
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  ...extra,
});
const tags = (x: { releases: GithubRelease[] }) => x.releases.map((r) => r.tag_name);

// GitHub 返回顺序：新 → 旧
const list = [
  rel('v5.10.0'),
  rel('v5.9.1'),
  rel('v5.9.0'),
  rel('v5.9.0-rc.1', { prerelease: true }),
  rel('v5.8.0'),
  rel('v5.7.0', { draft: true }),
  rel('v5.2.0'),
  rel('v5.1.0'),
  rel('v5.0.0'),
];

describe('selectReleaseRange', () => {
  it('精确定位已装 tag，取区间内全部版本（含中间版本，去掉 draft/prerelease，不超过 latest）', () => {
    const r = selectReleaseRange(list, '5.1.0', '5.9.1');
    expect(r.mode).toBe('exact');
    expect(tags(r)).toEqual(['v5.9.1', 'v5.9.0', 'v5.8.0', 'v5.2.0']);
  });

  it('Homebrew 修订号与 v 前缀对齐', () => {
    const r = selectReleaseRange(list, '5.1.0_2', 'v5.9.1');
    expect(r.mode).toBe('exact');
    expect(tags(r)[0]).toBe('v5.9.1');
    expect(tags(r)).not.toContain('v5.1.0');
  });

  it('找不到已装 tag 时退化为版本比较', () => {
    const r = selectReleaseRange(list, '5.1.5', '5.9.1');
    expect(r.mode).toBe('compare');
    expect(tags(r)).toEqual(['v5.9.1', 'v5.9.0', 'v5.8.0', 'v5.2.0']);
  });

  it('tag 无法解析版本时只取最新 3 条', () => {
    const odd = [rel('nightly-c'), rel('nightly-b'), rel('nightly-a'), rel('nightly-0')];
    const r = selectReleaseRange(odd, 'abc1234', 'def5678');
    expect(r.mode).toBe('fallback');
    expect(tags(r)).toEqual(['nightly-c', 'nightly-b', 'nightly-a']);
    expect(formatReleases(r)).toContain('仅为最新 3 条');
  });

  it('维护分支补丁排在前面也不计入', () => {
    const l = [rel('v4.9.9'), rel('v5.2.0'), rel('v5.1.0')];
    expect(tags(selectReleaseRange(l, '5.1.0', '5.2.0'))).toEqual(['v5.2.0']);
  });

  it('不带 v 前缀与 monorepo 风格 tag', () => {
    expect(tagVersion('2.46.0')).toBe('2.46.0');
    expect(tagVersion('cli@1.2.3')).toBe('1.2.3');
    expect(tagVersion('rust-v0.5.0')).toBe('0.5.0');
    expect(tagVersion('nightly')).toBeUndefined();
    const l = [rel('2.47.0'), rel('2.46.1'), rel('2.46.0')];
    expect(tags(selectReleaseRange(l, 'v2.46.0', '2.47.0'))).toEqual(['2.47.0', '2.46.1']);
  });
});

describe('fairShare / formatReleases', () => {
  it('短的拿足，剩余平均给长的', () => {
    expect(fairShare([10, 1000, 1000], 610)).toEqual([10, 300, 300]);
    expect(fairShare([5, 5], 100)).toEqual([5, 5]);
  });

  it('单工具总长约束在上限内，且每个版本都有内容', () => {
    const big = Array.from({ length: 8 }, (_, i) => rel(`v1.${8 - i}.0`, { body: 'x'.repeat(5000) }));
    const md = formatReleases({ releases: big, mode: 'exact' }, 6000);
    expect(md.length).toBeLessThanOrEqual(6000);
    for (const r of big) expect(md).toContain(`#### ${r.tag_name}`);
  });
});
