import { describe, expect, it } from 'vitest';
import { buildPlist, stablePath } from '../src/schedule.js';

describe('stablePath', () => {
  it('把 fnm 会话临时目录换成默认版本目录并去重', () => {
    const path = '/Users/a/.local/state/fnm_multishells/123_456/bin:/opt/homebrew/bin:/usr/bin:/opt/homebrew/bin';
    expect(stablePath(path, {}, '/Users/a')).toBe(
      '/Users/a/.local/share/fnm/aliases/default/bin:/opt/homebrew/bin:/usr/bin',
    );
  });

  it('尊重 FNM_DIR', () => {
    expect(stablePath('/tmp/fnm_multishells/9_9/bin', { FNM_DIR: '/x/fnm' }, '/h')).toBe('/x/fnm/aliases/default/bin');
  });
});

describe('buildPlist', () => {
  it('直接调用 bin 链接，不写死 node 路径，并转义 XML', () => {
    const xml = buildPlist({ cli: '/opt/homebrew/bin/toolbell', hour: 9, minute: 30, path: '/a&b', home: '/h', log: '/l' });
    expect(xml).toContain('<array><string>/opt/homebrew/bin/toolbell</string><string>check</string></array>');
    expect(xml).toContain('<integer>9</integer>');
    expect(xml).toContain('<integer>30</integer>');
    expect(xml).toContain('/a&amp;b');
  });
});
