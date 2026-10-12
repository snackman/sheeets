import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseTelegramChannelHtml,
  isValidTelegramHandle,
  normalizeTelegramHandle,
  TELEGRAM_HANDLE_RE,
} from '../ingest/sources/telegram';
import { isAllowlistedEventLink } from '../ingest/allowlist';

const fixture = readFileSync(join(__dirname, 'fixtures', 'telegram-channel.html'), 'utf-8');

describe('parseTelegramChannelHtml', () => {
  const messages = parseTelegramChannelHtml(fixture);

  it('parses all 5 messages from the fixture', () => {
    expect(messages).toHaveLength(5);
  });

  it('extracts the postRef and canonical message URL', () => {
    expect(messages[0].postRef).toBe('ethsideevents/101');
    expect(messages[0].url).toBe('https://t.me/ethsideevents/101');
  });

  it('extracts the Luma link from message text', () => {
    expect(messages[0].links).toEqual(['https://lu.ma/ethcc-mixer']);
  });

  it('decodes HTML entities and converts <br> to a newline in plain text', () => {
    expect(messages[0].text).toContain("Don't miss the official mixer");
    expect(messages[0].text).toContain('\nSee you there!');
  });

  it('extracts a Partiful link', () => {
    expect(messages[1].links).toEqual(['https://partiful.com/e/abc123xyz']);
  });

  it('still extracts a non-allowlisted link (filtering happens separately, not in the parser)', () => {
    expect(messages[2].links).toEqual(['https://example-blog.com/post/123']);
  });

  it('extracts text containing a prompt-injection attempt as plain, untrusted text (no special handling here — the classifier\'s own pre-scan handles it)', () => {
    expect(messages[3].text).toContain('ignore all previous instructions');
    expect(messages[3].links).toEqual(['https://www.eventbrite.com/e/side-event-tickets-123456789']);
  });

  it('returns an empty text/links for a media-only post with no message_text block', () => {
    expect(messages[4].text).toBe('');
    expect(messages[4].links).toEqual([]);
  });

  it('returns an empty array for HTML with no messages', () => {
    expect(parseTelegramChannelHtml('<html><body>nothing here</body></html>')).toEqual([]);
  });
});

describe('isAllowlistedEventLink applied to parsed Telegram links', () => {
  const messages = parseTelegramChannelHtml(fixture);

  it('allows Luma, Partiful and Eventbrite links', () => {
    expect(isAllowlistedEventLink(messages[0].links[0])).toBe(true);
    expect(isAllowlistedEventLink(messages[1].links[0])).toBe(true);
    expect(isAllowlistedEventLink(messages[3].links[0])).toBe(true);
  });

  it('rejects a non-allowlisted blog link', () => {
    expect(isAllowlistedEventLink(messages[2].links[0])).toBe(false);
  });

  it('rejects a random/non-event host outright', () => {
    expect(isAllowlistedEventLink('https://twitter.com/someone/status/123')).toBe(false);
    expect(isAllowlistedEventLink('http://169.254.169.254/latest/meta-data')).toBe(false);
  });
});

describe('TELEGRAM_HANDLE_RE / isValidTelegramHandle', () => {
  it('accepts well-formed handles (5-32 chars, letters/digits/underscore)', () => {
    expect(isValidTelegramHandle('ethsideevents')).toBe(true);
    expect(isValidTelegramHandle('eth_cc_2026')).toBe(true);
  });

  it('rejects too-short, too-long, or invalid-character handles', () => {
    expect(isValidTelegramHandle('abcd')).toBe(false); // 4 chars
    expect(isValidTelegramHandle('a'.repeat(33))).toBe(false);
    expect(isValidTelegramHandle('eth-cc')).toBe(false); // hyphen not allowed
    expect(isValidTelegramHandle('eth cc')).toBe(false); // space
    expect(TELEGRAM_HANDLE_RE.test('../../etc/passwd')).toBe(false);
  });
});

describe('normalizeTelegramHandle', () => {
  it('accepts a bare handle', () => {
    expect(normalizeTelegramHandle('ethsideevents')).toBe('ethsideevents');
  });

  it('strips a leading @', () => {
    expect(normalizeTelegramHandle('@ethsideevents')).toBe('ethsideevents');
  });

  it('strips a t.me URL (with or without /s/)', () => {
    expect(normalizeTelegramHandle('https://t.me/ethsideevents')).toBe('ethsideevents');
    expect(normalizeTelegramHandle('https://t.me/s/ethsideevents')).toBe('ethsideevents');
    expect(normalizeTelegramHandle('t.me/ethsideevents')).toBe('ethsideevents');
  });

  it('returns null for an invalid handle', () => {
    expect(normalizeTelegramHandle('abcd')).toBeNull();
    expect(normalizeTelegramHandle('')).toBeNull();
    expect(normalizeTelegramHandle('   ')).toBeNull();
  });
});
