import { describe, expect, it } from 'vitest';
import { formulaResult } from '../../src/scanners/brew.js';
import { errorResult, scrubUrlCredentials } from '../../src/scanners/common.js';

const tool = { source: 'brew' as const, name: 'foo', installed: 'HEAD-abc1234' };

describe('评审修复', () => {
  it('brew --HEAD 安装不报落后', () => {
    const r = formulaResult(tool, { fullName: 'foo', name: 'foo', installed: 'HEAD-abc1234', latest: '1.0.0', pinned: false });
    expect(r.status).toBe('latest');
  });

  it('错误信息里抹掉 remote 凭证', () => {
    expect(scrubUrlCredentials("unable to access 'https://bob:ghp_abc123@github.com/a/b.git/'")).toBe(
      "unable to access 'https://***@github.com/a/b.git/'",
    );
    expect(scrubUrlCredentials('https://ghp_aaaaaaaaaaaaaaaaaaaaaaaa@github.com/a/b')).toBe('https://***@github.com/a/b');
    expect(errorResult(tool, 'fatal: https://u:p@host/x').error).toBe('fatal: https://***@host/x');
  });
});
