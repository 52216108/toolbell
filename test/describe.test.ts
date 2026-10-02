import { describe, expect, it } from 'vitest';
import { dictKey, lookupZh } from '../src/describe/dict-zh.js';

describe('中文简介词典', () => {
  it('第三方 tap 取最后一段、去掉 Homebrew 版本后缀', () => {
    expect(lookupZh('cameroncooke/axe/axe')).toContain('iOS 模拟器');
    expect(lookupZh('node@22')).toContain('Node.js');
    expect(lookupZh('mysql@8.0')).toContain('MySQL');
  });

  it('scoped npm 包保持原名匹配，不会被截成最后一段', () => {
    expect(dictKey('@ant-design/cli')).toEqual(['@ant-design/cli']);
    expect(lookupZh('@ant-design/cli')).toContain('Ant Design');
  });

  it('不认识的工具返回 undefined，交给英文简介兜底', () => {
    expect(lookupZh('some-unknown-tool-xyz')).toBeUndefined();
  });
});
