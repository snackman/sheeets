// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isBlockedIp, parsePublicHttpUrl, safeFetch, stripHeaderCI, stripCrossOriginAuthHeaders, shouldDowngradeToGet } from '../safe-fetch';

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '::ffff:a9fe:a9fe',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%lo0',
    'ff02::1',
    '64:ff9b::a00:1',
    '2002:7f00:1::',
    'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
    '64:ff9b::808:808',
  ])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

describe('parsePublicHttpUrl', () => {
  it('accepts http(s) URLs', () => {
    expect(parsePublicHttpUrl('https://lu.ma/abc').hostname).toBe('lu.ma');
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com',
    'gopher://example.com',
    'javascript:alert(1)',
    'http://user:pass@example.com',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => parsePublicHttpUrl(url)).toThrow();
  });
});

describe('safeFetch', () => {
  it('refuses hostnames resolving to loopback', async () => {
    await expect(safeFetch('http://localhost:1/')).rejects.toThrow(
      /private or reserved/
    );
  });
});

// Re-review item 3: redirect header-stripping / method-downgrade logic.
// `safeFetch` deliberately refuses loopback connections (the whole point
// of the SSRF guard above), so these can't be exercised end-to-end against
// a real local HTTP server — the redirect-handling rules are pure
// functions precisely so they're testable directly instead.
describe('stripHeaderCI', () => {
  it('removes a header case-insensitively without mutating the input', () => {
    const headers = { Authorization: 'Bearer x', 'Content-Type': 'application/json' };
    const stripped = stripHeaderCI(headers, 'authorization');
    expect(stripped).toEqual({ 'Content-Type': 'application/json' });
    expect(headers).toEqual({ Authorization: 'Bearer x', 'Content-Type': 'application/json' }); // original untouched
  });

  it('is a no-op when the header is absent', () => {
    expect(stripHeaderCI({ Accept: 'text/html' }, 'Authorization')).toEqual({ Accept: 'text/html' });
  });
});

describe('stripCrossOriginAuthHeaders (re-review item 3)', () => {
  it('strips Authorization and Cookie on a cross-origin redirect', () => {
    const headers = { Authorization: 'Bearer secret', Cookie: 'session=abc', Accept: 'application/json' };
    const result = stripCrossOriginAuthHeaders(headers, 'https://api.x.com', 'https://evil.example.com');
    expect(result).toEqual({ Accept: 'application/json' });
  });

  it('keeps Authorization and Cookie on a same-origin redirect', () => {
    const headers = { Authorization: 'Bearer secret', Cookie: 'session=abc' };
    const result = stripCrossOriginAuthHeaders(headers, 'https://api.x.com', 'https://api.x.com');
    expect(result).toEqual(headers);
  });

  it('strips on a scheme-only change to the same host (still a different origin)', () => {
    const headers = { Authorization: 'Bearer secret' };
    const result = stripCrossOriginAuthHeaders(headers, 'http://example.com', 'https://example.com');
    expect(result).toEqual({});
  });
});

describe('shouldDowngradeToGet (re-review item 3)', () => {
  it('always downgrades on a 303, regardless of method', () => {
    expect(shouldDowngradeToGet(303, 'POST')).toBe(true);
    expect(shouldDowngradeToGet(303, 'GET')).toBe(true);
  });

  it('downgrades a POST on 301 or 302', () => {
    expect(shouldDowngradeToGet(301, 'POST')).toBe(true);
    expect(shouldDowngradeToGet(302, 'POST')).toBe(true);
  });

  it('does not downgrade a GET on 301 or 302 (nothing to downgrade)', () => {
    expect(shouldDowngradeToGet(301, 'GET')).toBe(false);
    expect(shouldDowngradeToGet(302, 'GET')).toBe(false);
  });

  it('does not downgrade on other redirect statuses (e.g. 307/308, which preserve method/body by design)', () => {
    expect(shouldDowngradeToGet(307, 'POST')).toBe(false);
    expect(shouldDowngradeToGet(308, 'POST')).toBe(false);
  });
});
