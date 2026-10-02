import { describe, expect, it } from 'vitest';
import { parseNpmLs, parseNpmOutdated } from '../../src/scanners/npm.js';
import { parsePnpmLs } from '../../src/scanners/pnpm.js';
import { parseUvToolList } from '../../src/scanners/uv.js';
import { parsePipxList } from '../../src/scanners/pipx.js';
import { parseCargoList } from '../../src/scanners/cargo.js';
import { pypiGithubRepo } from '../../src/scanners/common.js';

describe('npm', () => {
  it('ls 跳过 corepack，保留 npm 自身', () => {
    const out = parseNpmLs(
      JSON.stringify({ dependencies: { npm: { version: '11.0.0' }, corepack: { version: '0.30.0' }, pm2: { version: '7.0.4' } } }),
    );
    expect(out.map((x) => x.name)).toEqual(['npm', 'pm2']);
  });

  it('outdated（退出码 1 时的 stdout）照常解析，数组形态取第一项', () => {
    const stdout = JSON.stringify({
      'eas-cli': { current: '24.7.0', wanted: '24.8.0', latest: '24.8.0', location: '/x' },
      pm2: [{ current: '7.0.3', latest: '7.0.4' }],
    });
    const m = parseNpmOutdated(stdout);
    expect(m.get('eas-cli')).toMatchObject({ current: '24.7.0', latest: '24.8.0' });
    expect(m.get('pm2')?.latest).toBe('7.0.4');
    expect(parseNpmOutdated('').size).toBe(0);
  });
});

describe('pnpm', () => {
  it('合并数组各项 dependencies，跳过 link:', () => {
    const out = parsePnpmLs(
      JSON.stringify([{ path: '/g', dependencies: { a: { version: '1.0.0' }, b: { version: 'link:../b' } } }]),
    );
    expect(out).toEqual([{ name: 'a', version: '1.0.0' }]);
  });
});

describe('uv', () => {
  it('tool list 跳过可执行文件行', () => {
    expect(parseUvToolList('browser-use v0.13.10\n- browser\n- bu\nruff v0.9.1\n- ruff\n')).toEqual([
      { name: 'browser-use', version: '0.13.10' },
      { name: 'ruff', version: '0.9.1' },
    ]);
  });

  it('--outdated 行解析出 latest，不带 [latest] 的视为最新', () => {
    expect(parseUvToolList('browser-use v0.13.8 [latest: 0.13.10]\n- browser-use\nruff v0.9.1\n')).toEqual([
      { name: 'browser-use', version: '0.13.8', latest: '0.13.10' },
      { name: 'ruff', version: '0.9.1' },
    ]);
  });
});

describe('pipx', () => {
  it('取 main_package 的包名与版本', () => {
    const out = parsePipxList(
      JSON.stringify({
        venvs: { 'black-dev': { metadata: { main_package: { package: 'black', package_version: '24.1.0' } } } },
      }),
    );
    expect(out).toEqual([{ name: 'black-dev', pkg: 'black', version: '24.1.0' }]);
  });

  it('PyPI project_urls 中找 GitHub 链接', () => {
    expect(
      pypiGithubRepo({
        home_page: null,
        project_urls: { Documentation: 'https://docs.x.io', Source: 'https://github.com/browser-use/browser-use' },
      }),
    ).toBe('browser-use/browser-use');
  });
});

describe('cargo', () => {
  it('解析 install --list，缩进二进制行跳过，记录非 crates.io 来源', () => {
    const stdout = [
      'ripgrep v14.1.0:',
      '    rg',
      'foo v0.1.0 (/Users/me/foo):',
      '    foo',
      'bar v0.2.0 (https://github.com/x/bar#abc123):',
      '    bar',
      '',
    ].join('\n');
    expect(parseCargoList(stdout)).toEqual([
      { name: 'ripgrep', version: '14.1.0' },
      { name: 'foo', version: '0.1.0', source: '/Users/me/foo' },
      { name: 'bar', version: '0.2.0', source: 'https://github.com/x/bar#abc123' },
    ]);
  });
});
