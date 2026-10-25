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
  });
});
