import { describe, expect, it } from 'vitest';
import { briefDigestError } from '../src/digest.js';

describe('briefDigestError', () => {
  it('从服务商 JSON 报错里只取状态码与错误码', () => {
    const detail =
      'HTTP 400：{"error":{"code":"InvalidEndpoint.ClosedEndpoint","message":"The request targeted an endpoint that is currently closed","param":"","type":"Bad Request"}}';
    expect(briefDigestError(detail)).toBe('HTTP 400 InvalidEndpoint.ClosedEndpoint');
  });

  it('非 JSON 响应只报状态码，超时单独说明', () => {
    expect(briefDigestError('HTTP 502：<html>Bad Gateway</html>')).toBe('HTTP 502');
    expect(briefDigestError('The operation was aborted due to timeout')).toBe('请求超时');
    expect(briefDigestError('HTTP 401：{"error":{"code":"bad key sk-abc http://x"}}')).toBe('HTTP 401');
  });

  it('其他错误不透出原文（可能含带凭证的接口地址）', () => {
    expect(briefDigestError('fetch failed: getaddrinfo ENOTFOUND u:p@api.example.com')).toBe('域名解析失败');
    expect(briefDigestError('fetch failed: connect ECONNREFUSED https://u:p@x/v1?token=1')).toBe('网络请求失败');
  });
});
