import { describe, expect, it } from 'vitest';
import { formulaResult, parseBrewFormula, parseLeaves } from '../../src/scanners/brew.js';
import { shouldTrackCask } from '../../src/scanners/brew-cask.js';

const formula = (over: Record<string, unknown> = {}) => ({
  name: 'cocoapods',
  full_name: 'cocoapods',
  versions: { stable: '1.16.2' },
  revision: 2,
  installed: [{ version: '1.16.2_2' }],
  linked_keg: '1.16.2_2',
  pinned: false,
  urls: { stable: { url: 'https://github.com/CocoaPods/CocoaPods/archive/refs/tags/1.16.2.tar.gz' } },
  homepage: 'https://cocoapods.org/',
  ...over,
});
const tool = { source: 'brew' as const, name: 'cocoapods', installed: '1.16.2_2' };

describe('brew formula', () => {
  it('拼回修订号后与已装版本一致，不误报', () => {
    const s = parseBrewFormula(formula())!;
    expect(s.latest).toBe('1.16.2_2');
    expect(s.repo).toBe('CocoaPods/CocoaPods');
    expect(formulaResult(tool, s).status).toBe('latest');
  });

  it('只 bump 修订号也算落后', () => {
    const s = parseBrewFormula(formula({ revision: 3 }))!;
    const r = formulaResult(tool, s);
    expect(r.status).toBe('outdated');
    expect(r.latest).toBe('1.16.2_3');
  });

  it('revision 为 0 时不拼后缀；新版本判为落后', () => {
    const s = parseBrewFormula(
      formula({ versions: { stable: '5.9.1' }, revision: 0, installed: [{ version: '5.8.1' }], linked_keg: '5.8.1' }),
    )!;
    expect(formulaResult({ ...tool, installed: '5.8.1' }, s)).toMatchObject({ status: 'outdated', latest: '5.9.1' });
  });

  it('pinned 带说明，升级命令用 tap 全名', () => {
    const s = parseBrewFormula(
      formula({ name: 'axe', full_name: 'cameroncooke/axe/axe', revision: 0, linked_keg: '1.16.2', pinned: true }),
    )!;
    const r = formulaResult(tool, s);
    expect(r.note).toContain('pin');
    expect(r.updateCommand).toBe('brew upgrade cameroncooke/axe/axe');
  });

  it('leaves 输出按行拆分', () => {
    expect(parseLeaves('asc\ncameroncooke/axe/axe\n\nxcodegen\n')).toEqual(['asc', 'cameroncooke/axe/axe', 'xcodegen']);
  });
});

describe('brew cask', () => {
  const cask = { token: 'x', full_token: 'x', installed: '1.0', version: '1.1', auto_updates: null };
  it('auto_updates 与 version=latest 的不跟踪', () => {
    expect(shouldTrackCask(cask)).toBe(true);
    expect(shouldTrackCask({ ...cask, auto_updates: true })).toBe(false);
    expect(shouldTrackCask({ ...cask, version: 'latest' })).toBe(false);
  });
});
