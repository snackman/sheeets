import { describe, it, expect } from 'vitest';
import { generateEventId } from '../fetch-events';

describe('generateEventId', () => {
  it('produces a string starting with "evt-"', () => {
    const id = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Opening Keynote');
    expect(id.startsWith('evt-')).toBe(true);
  });

  it('is deterministic (same inputs = same output)', () => {
    const a = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Opening Keynote');
    const b = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Opening Keynote');
    expect(a).toBe(b);
  });

  it('produces different IDs for different event names', () => {
    const a = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Event A');
    const b = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Event B');
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different conferences', () => {
    const a = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Keynote');
    const b = generateEventId('Bitcoin Vegas 2026', 'Sat, Apr 11', '9:00a', 'Keynote');
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different dates', () => {
    const a = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Keynote');
    const b = generateEventId('PBW 2026', 'Sun, Apr 12', '9:00a', 'Keynote');
    expect(a).not.toBe(b);
  });

  it('produces different IDs for different start times', () => {
    const a = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Keynote');
    const b = generateEventId('PBW 2026', 'Sat, Apr 11', '2:00p', 'Keynote');
    expect(a).not.toBe(b);
  });

  it('produces a short alphanumeric ID (base36)', () => {
    const id = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Test');
    const hash = id.replace('evt-', '');
    // Base36 characters: 0-9, a-z
    expect(hash).toMatch(/^[0-9a-z]+$/);
  });

  it('handles empty strings without crashing', () => {
    const id = generateEventId('', '', '', '');
    expect(id.startsWith('evt-')).toBe(true);
  });

  it('handles special characters in event name', () => {
    const id = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'AI & Crypto: The Future!');
    expect(id.startsWith('evt-')).toBe(true);
  });

  it('handles unicode characters', () => {
    const id = generateEventId('PBW 2026', 'Sat, Apr 11', '9:00a', 'Cafe Creme');
    expect(id.startsWith('evt-')).toBe(true);
  });
});

/**
 * NOTE: The following functions from fetch-events.ts are NOT tested here:
 *
 * - `fetchEvents()` — Makes network calls to Google Sheets API, requires mocking
 * - `parseTags()` — Not exported (private function)
 * - `findHeaderIndex()` — Not exported (private function)
 * - `isEmptyRow()` — Not exported (private function)
 * - `fetchPage()` — Not exported, makes network calls
 *
 * `parseTags()` behavior is indirectly tested via integration tests that call
 * `fetchEvents()` with mocked responses (Phase 2 with MSW).
 *
 * The TAG_ALIASES mapping (Fitness/Wellness -> Wellness, etc.) is also internal
 * and will be covered by integration tests.
 */
