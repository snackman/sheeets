import { describe, it, expect } from 'vitest';
import { getLabelVisibility, LABEL_MIN_ZOOM, FEATURED_LABEL_MIN_ZOOM } from '@/lib/map-labels';

describe('getLabelVisibility', () => {
  it('hides labels below zoom 13', () => {
    expect(getLabelVisibility(12, { hasLabel: true }).showLabel).toBe(false);
    expect(getLabelVisibility(12.9, { hasLabel: true }).showLabel).toBe(false);
    expect(getLabelVisibility(LABEL_MIN_ZOOM, { hasLabel: true }).showLabel).toBe(true);
  });
  it('lets featured labels appear from zoom 12', () => {
    expect(getLabelVisibility(FEATURED_LABEL_MIN_ZOOM, { hasLabel: true, isFeatured: true }).showLabel).toBe(true);
    expect(getLabelVisibility(11.9, { hasLabel: true, isFeatured: true }).showLabel).toBe(false);
  });
  it('never shows a label without text', () => {
    expect(getLabelVisibility(18, { hasLabel: false }).showLabel).toBe(false);
  });
  it('reveals organizer and tag icons progressively', () => {
    const mid = getLabelVisibility(14.5, { hasLabel: true });
    expect(mid).toEqual({ showLabel: true, showOrganizer: true, showTagIcons: false });
    const high = getLabelVisibility(15, { hasLabel: true });
    expect(high.showTagIcons).toBe(true);
  });
});
