import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDingtalkUrl, signDingtalk } from '../../src/notifiers/dingtalk.js';
import { signFeishu } from '../../src/notifiers/feishu.js';

const secret = 'SECtest_secret_123';

describe('飞书加签', () => {
  it('以 timestamp\\nsecret 为 key、对空串签名（秒级时间戳）', () => {
    const ts = 1_700_000_000;
    // 官方文档：HmacSHA256(key = timestamp + "\n" + secret, data = "")
    const expected = createHmac('sha256', Buffer.from(`${ts}\n${secret}`, 'utf8')).update(Buffer.alloc(0)).digest('base64');
    expect(signFeishu(ts, secret)).toBe(expected);
    // key/message 位置反了会得到不同结果——防止把钉钉的写法抄过来
    const swapped = createHmac('sha256', secret).update(`${ts}\n${secret}`).digest('base64');
    expect(signFeishu(ts, secret)).not.toBe(swapped);
  });
});

describe('钉钉加签', () => {
  const ts = 1_700_000_000_123;
  // 官方文档：HmacSHA256(key = secret, data = timestamp + "\n" + secret)，base64 后 urlEncode
  const expected = createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(`${ts}\n${secret}`, 'utf8')).digest('base64');

  it('以 secret 为 key、对 timestamp\\nsecret 签名（毫秒级时间戳）', () => {
    expect(signDingtalk(ts, secret)).toBe(expected);
    const swapped = createHmac('sha256', `${ts}\n${secret}`).update('').digest('base64');
    expect(signDingtalk(ts, secret)).not.toBe(swapped);
  });

  it('签名 urlEncode 后追加到带 access_token 的 webhook', () => {
    const url = buildDingtalkUrl('https://oapi.dingtalk.com/robot/send?access_token=abc', secret, ts);
    expect(url).toBe(`https://oapi.dingtalk.com/robot/send?access_token=abc&timestamp=${ts}&sign=${encodeURIComponent(expected)}`);
    // 解码回来与原签名一致，且 + / = 不以明文出现在 query 中
    const u = new URL(url);
    expect(u.searchParams.get('sign')).toBe(expected);
    expect(url.split('sign=')[1]).not.toMatch(/[+/=]/);
  });

  it('未配置 secret 时不加签', () => {
    expect(buildDingtalkUrl('https://x/robot/send?access_token=abc', undefined, ts)).toBe('https://x/robot/send?access_token=abc');
  });
});
