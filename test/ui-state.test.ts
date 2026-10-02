import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config.js';
import type { Config } from '../src/types.js';
import { applyPatch, PatchError, publicConfig } from '../src/ui/state.js';

const FEISHU = 'https://open.feishu.cn/open-apis/bot/v2/hook/aaaa-bbbb-cccc-1234';

const base = (): Config => ({
  ...defaultConfig(),
  channels: [{ type: 'feishu', webhook: FEISHU, secret: 'sec' }],
  ai: { enabled: true, baseURL: 'https://api.deepseek.com/v1', apiKey: 'sk-old', model: 'deepseek-chat' },
});

describe('publicConfig', () => {
  it('不下发 webhook 全文、密钥与 API Key', () => {
    const json = JSON.stringify(publicConfig(base()));
    expect(json).not.toContain('aaaa-bbbb');
    expect(json).not.toContain('sec"');
    expect(json).not.toContain('sk-old');
    expect(json).toContain('…1234');
  });
});

describe('applyPatch', () => {
  it('ref 指向原渠道且不填 webhook/密钥时沿用原值', () => {
    const next = applyPatch(base(), { channels: [{ ref: 0 }] });
    expect(next.channels).toEqual([{ type: 'feishu', webhook: FEISHU, secret: 'sec' }]);
  });

  it('secret 为 null 时清除', () => {
    const next = applyPatch(base(), { channels: [{ ref: 0, secret: null }] });
    expect(next.channels[0]).toEqual({ type: 'feishu', webhook: FEISHU });
  });

  it('新增渠道校验 webhook 格式', () => {
    expect(() => applyPatch(base(), { channels: [{ type: 'wecom', webhook: 'https://evil.example.com' }] })).toThrow(PatchError);
  });

  it('API Key 不提交时沿用，提交时覆盖', () => {
    expect(applyPatch(base(), { ai: { enabled: true, model: 'deepseek-reasoner' } }).ai).toMatchObject({
      apiKey: 'sk-old',
      model: 'deepseek-reasoner',
    });
    expect(applyPatch(base(), { ai: { apiKey: 'sk-new' } }).ai?.apiKey).toBe('sk-new');
  });

  it('开启 AI 但缺 Key 时拒绝', () => {
    const c = { ...base(), ai: undefined };
    expect(() => applyPatch(c, { ai: { enabled: true, baseURL: 'https://x/v1', model: 'm' } })).toThrow('API Key');
  });

  it('来源开关只记录关闭项，忽略未知来源与非法 exclude', () => {
    const next = applyPatch(base(), {
      scanners: { brew: false, npm: true, evil: false },
      exclude: ['brew:cocoapods', 'brew:cocoapods', 42, 'nocolon'],
    });
    expect(next.scanners).toEqual({ brew: false });
    expect(next.exclude).toEqual(['brew:cocoapods']);
  });

  it('不认识的顶层字段不会写进配置', () => {
    const next = applyPatch(base(), { notifyWhenUpToDate: true, ...({ version: 9, hacked: 1 } as object) });
    expect(next.version).toBe(1);
    expect((next as unknown as Record<string, unknown>).hacked).toBeUndefined();
  });

  it('检测时间格式校验', () => {
    expect(() => applyPatch(base(), { schedule: { time: '25:00' } })).toThrow(PatchError);
    expect(applyPatch(base(), { schedule: { time: '08:45' } }).schedule).toEqual({ time: '08:45' });
  });
});

describe('gitRepos 路径', () => {
  it('相对路径与 ~ 都存成绝对路径', () => {
    const next = applyPatch(base(), { gitRepos: [{ path: '~/a' }, { path: 'rel/b' }] });
    expect(next.gitRepos.every((r) => r.path.startsWith('/'))).toBe(true);
    expect(next.gitRepos[0]!.path.endsWith('/a')).toBe(true);
  });
});
