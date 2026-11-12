import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateShareCode, isUniqueViolation, SHARE_CODE_LENGTH } from '../share-code';
import { isSafeHttpUrl } from '../utils';

describe('generateShareCode', () => {
  it('is at least 12 chars of [a-z0-9]', () => {
    expect(SHARE_CODE_LENGTH).toBeGreaterThanOrEqual(12);
    for (let i = 0; i < 200; i++) {
      expect(generateShareCode()).toMatch(/^[a-z0-9]{16}$/);
    }
  });

  it('produces unique codes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateShareCode());
    expect(seen.size).toBe(5000);
  });

  it('uses all alphabet characters roughly evenly (no modulo bias skew)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 3000; i++) for (const c of generateShareCode()) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(36);
    const vals = [...counts.values()];
    expect(Math.max(...vals) / Math.min(...vals)).toBeLessThan(1.25);
  });

  it('detects unique violations for retry', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: '42501' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});

describe('admin sponsor data links', () => {
  it('isSafeHttpUrl rejects script-ish schemes', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,x')).toBe(false);
    expect(isSafeHttpUrl('https://example.com/x')).toBe(true);
  });

  it('SponsorDataTab wraps both hrefs in isSafeHttpUrl', () => {
    const src = readFileSync('src/components/admin/SponsorDataTab.tsx', 'utf8');
    expect(src).toContain('href={isSafeHttpUrl(d.sponsor_url) ? d.sponsor_url : undefined}');
    expect(src).toContain('href={isSafeHttpUrl(entry.event_url) ? entry.event_url : undefined}');
    expect(src).not.toMatch(/href=\{(d\.sponsor_url|entry\.event_url)\}/);
  });
});
