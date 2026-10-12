import { describe, it, expect } from 'vitest';
import { isAllowlistedEventLink, allowlistedPlatformFor } from '../ingest/allowlist';

describe('isAllowlistedEventLink (Phase 3 §3.2/§10)', () => {
  it('allows Luma links (both lu.ma and luma.com)', () => {
    expect(isAllowlistedEventLink('https://lu.ma/ethcc-mixer')).toBe(true);
    expect(isAllowlistedEventLink('https://luma.com/event/evt-ABC123')).toBe(true);
  });

  it('allows Partiful links', () => {
    expect(isAllowlistedEventLink('https://partiful.com/e/abc123xyz')).toBe(true);
  });

  it('allows Eventbrite links across TLDs/subdomains', () => {
    expect(isAllowlistedEventLink('https://www.eventbrite.com/e/side-event-123')).toBe(true);
    expect(isAllowlistedEventLink('https://eventbrite.co.uk/e/side-event-123')).toBe(true);
  });

  it('allows Meetup links', () => {
    expect(isAllowlistedEventLink('https://www.meetup.com/some-group/events/123456/')).toBe(true);
  });

  it('allows Posh links', () => {
    expect(isAllowlistedEventLink('https://posh.vip/e/some-event')).toBe(true);
  });

  it('rejects a random blog/social link', () => {
    expect(isAllowlistedEventLink('https://example-blog.com/post/123')).toBe(false);
    expect(isAllowlistedEventLink('https://twitter.com/someone/status/123')).toBe(false);
    expect(isAllowlistedEventLink('https://x.com/someone/status/123')).toBe(false);
  });

  it('rejects a non-http(s) URL and an unparseable string', () => {
    expect(isAllowlistedEventLink('javascript:alert(1)')).toBe(false);
    expect(isAllowlistedEventLink('not a url')).toBe(false);
    expect(isAllowlistedEventLink('')).toBe(false);
  });

  it('rejects a private/internal-looking host outright (never fetched to find out)', () => {
    expect(isAllowlistedEventLink('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isAllowlistedEventLink('http://localhost:3000/admin')).toBe(false);
    expect(isAllowlistedEventLink('http://10.0.0.5/internal')).toBe(false);
  });

  it('rejects a lookalike host that merely CONTAINS an allowlisted name', () => {
    expect(isAllowlistedEventLink('https://notluma.com/event/evt-ABC123')).toBe(false);
    expect(isAllowlistedEventLink('https://lu.ma.evil.com/phish')).toBe(false);
  });
});

describe('allowlistedPlatformFor', () => {
  it('returns the matched platform name', () => {
    expect(allowlistedPlatformFor('https://lu.ma/abc')).toBe('luma');
    expect(allowlistedPlatformFor('https://partiful.com/e/abc')).toBe('partiful');
  });

  it('returns null for a non-allowlisted link', () => {
    expect(allowlistedPlatformFor('https://example.com')).toBeNull();
  });
});
