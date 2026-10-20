import { describe, it, expect } from 'vitest';
import { sanitizeSheetTags, SHEET_TAGS } from '../ingest/sheet-tags';

describe('sanitizeSheetTags', () => {
  it('keeps canonical values, case-insensitively', () => {
    expect(sanitizeSheetTags(['party', 'DEFI', 'Panel/Talk'])).toEqual(['Party', 'DeFi', 'Panel/Talk']);
  });
  it('maps aliases', () => {
    expect(
      sanitizeSheetTags(['Devs', 'Developers', 'Builders', 'Drinks', 'Happy Hour', 'Bar', 'Panel', 'Talks', 'VCs', 'Investors', 'Jobs', 'Career'])
    ).toEqual(['Devs/Builders', 'Bar/Pub', 'Panel/Talk', 'VCs/Angels', 'Jobs/Hiring']);
  });
  it('drops unknown tags and dedupes preserving order', () => {
    expect(sanitizeSheetTags(['Free', 'AI', 'Party', 'ai', 'Nonsense', 'Art'])).toEqual(['AI', 'Party', 'Art']);
  });
  it('handles null/empty', () => {
    expect(sanitizeSheetTags(null)).toEqual([]);
    expect(sanitizeSheetTags([])).toEqual([]);
  });
  it('allowlist has the 26 dropdown values', () => {
    expect(SHEET_TAGS).toHaveLength(26);
  });
});
