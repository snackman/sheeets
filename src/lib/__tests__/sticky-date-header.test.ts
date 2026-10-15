import { describe, expect, it } from 'vitest';
import {
  selectStickyDateHeader,
  stickyDateHeaderEquals,
  type DateHeaderOffset,
} from '../sticky-date-header';

const headers: DateHeaderOffset[] = [
  { label: 'Mon, Feb 24', eventCount: 12, start: 0 },
  { label: 'Tue, Feb 25', eventCount: 8, start: 2400 },
  { label: 'Wed, Feb 26', eventCount: 5, start: 4800 },
];

describe('selectStickyDateHeader', () => {
  it('hides at the very top of the list (scrollTop 0)', () => {
    expect(selectStickyDateHeader(headers, 0)).toBeNull();
  });

  it('hides within the hide threshold', () => {
    expect(selectStickyDateHeader(headers, 3)).toBeNull();
  });

  it('shows the first header once scrolled just past the threshold', () => {
    expect(selectStickyDateHeader(headers, 5)).toEqual({
      label: 'Mon, Feb 24',
      eventCount: 12,
    });
  });

  it('shows the last header whose start is at or before scrollTop', () => {
    expect(selectStickyDateHeader(headers, 2500)).toEqual({
      label: 'Tue, Feb 25',
      eventCount: 8,
    });
  });

  it('matches exactly at a header boundary (start === scrollTop)', () => {
    expect(selectStickyDateHeader(headers, 2400)).toEqual({
      label: 'Tue, Feb 25',
      eventCount: 8,
    });
  });

  it('shows the last header once scrolled past every boundary', () => {
    expect(selectStickyDateHeader(headers, 100000)).toEqual({
      label: 'Wed, Feb 26',
      eventCount: 5,
    });
  });

  it('returns null when there are no date headers at all', () => {
    expect(selectStickyDateHeader([], 500)).toBeNull();
  });

  it('respects a custom hide threshold', () => {
    expect(selectStickyDateHeader(headers, 50, 100)).toBeNull();
    expect(selectStickyDateHeader(headers, 150, 100)).toEqual({
      label: 'Mon, Feb 24',
      eventCount: 12,
    });
  });
});

describe('stickyDateHeaderEquals', () => {
  it('treats two nulls as equal', () => {
    expect(stickyDateHeaderEquals(null, null)).toBe(true);
  });

  it('treats null and a value as different', () => {
    expect(stickyDateHeaderEquals(null, { label: 'a', eventCount: 1 })).toBe(false);
    expect(stickyDateHeaderEquals({ label: 'a', eventCount: 1 }, null)).toBe(false);
  });

  it('treats equal label+count as equal, even as distinct objects', () => {
    expect(
      stickyDateHeaderEquals({ label: 'a', eventCount: 1 }, { label: 'a', eventCount: 1 }),
    ).toBe(true);
  });

  it('treats a differing label or count as different', () => {
    expect(
      stickyDateHeaderEquals({ label: 'a', eventCount: 1 }, { label: 'b', eventCount: 1 }),
    ).toBe(false);
    expect(
      stickyDateHeaderEquals({ label: 'a', eventCount: 1 }, { label: 'a', eventCount: 2 }),
    ).toBe(false);
  });
});
