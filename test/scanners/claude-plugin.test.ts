import { describe, expect, it } from 'vitest';
import { judgePlugin, parseInstalledPlugins } from '../../src/scanners/claude-plugin.js';

describe('claude-plugin', () => {
  it('sha 不同但声明版本与已装相同 → 视为未发版，不提醒', () => {
    expect(
      judgePlugin({ installedVersion: '2.0.8', installedSha: 'f343ba1', declaredVersion: '2.0.8', latestSha: 'b571b09' }),
    ).toEqual({ status: 'latest', latest: '2.0.8' });
  });

  it('声明版本更新 → 落后', () => {
    expect(judgePlugin({ installedVersion: '6.1.1', installedSha: 'd884ae0', declaredVersion: '6.3.0' })).toEqual({
      status: 'outdated',
      latest: '6.3.0',
    });
  });

  it('marketplace 条目版本比已装还旧（忘了 bump）不算落后', () => {
    expect(judgePlugin({ installedVersion: '2.0.8', installedSha: 'a', declaredVersion: '2.0.7' })).toMatchObject({
      status: 'latest',
    });
  });

  it('无声明版本时按 sha 比对，短 sha 前缀相等视为一致', () => {
    const base = { installedVersion: '18f42357de70-c6c7dcd7', installedSha: '18f42357de7091affbdfbcae51512a8daf89f3bf' };
    expect(judgePlugin({ ...base, latestSha: '18f42357de7091affbdfbcae51512a8daf89f3bf' })).toMatchObject({ status: 'latest' });
    expect(judgePlugin({ ...base, latestSha: 'ecd366e0000' })).toEqual({ status: 'outdated', latest: 'ecd366e' });
    expect(judgePlugin(base)).toHaveProperty('error');
  });

  it('跳过禁用插件与无 gitCommitSha 的插件，多 scope 取 user', () => {
    const out = parseInstalledPlugins(
      {
        plugins: {
          'codex@openai-codex': [
            { scope: 'project', version: '1.0.5', gitCommitSha: 'p' },
            { scope: 'user', version: '1.0.6', gitCommitSha: 'u' },
          ],
          'expo@claude-plugins-official': [{ scope: 'user', version: '1.13.6', gitCommitSha: 'x' }],
          'setup@claude-plugins-official': [{ scope: 'user', version: '1.0.0' }],
        },
      },
      { 'expo@claude-plugins-official': false },
    );
    expect(out).toEqual([{ key: 'codex@openai-codex', name: 'codex', marketplace: 'openai-codex', version: '1.0.6', sha: 'u' }]);
  });
});
