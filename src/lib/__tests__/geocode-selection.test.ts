import { describe, it, expect } from 'vitest';
import { selectAddressesToAttempt, type MissingAddress } from '../geocode-selection';

function makeMissing(count: number, prefix = 'addr'): MissingAddress[] {
  return Array.from({ length: count }, (_, i) => ({
    raw: `${prefix} ${i}`,
    normalized: `${prefix} ${i}`,
    conference: 'Devcon 8',
    center: { lat: 0, lng: 0 },
  }));
}

describe('selectAddressesToAttempt', () => {
  it('caps the number of addresses attempted per run (review finding, HIGH)', () => {
    const missing = makeMissing(100);
    const { attempted, skippedCooldown } = selectAddressesToAttempt(missing, new Set(), 40);

    expect(attempted).toHaveLength(40);
    expect(skippedCooldown).toBe(0);
  });

  it('attempts everything when there are fewer missing addresses than the cap', () => {
    const missing = makeMissing(5);
    const { attempted } = selectAddressesToAttempt(missing, new Set(), 40);
    expect(attempted).toHaveLength(5);
  });

  it('skips addresses in the cooldown set and does not count them toward the cap', () => {
    const missing = makeMissing(3);
    const recentlyFailed = new Set([missing[0].normalized, missing[2].normalized]);
    const { attempted, skippedCooldown } = selectAddressesToAttempt(missing, recentlyFailed, 40);

    expect(skippedCooldown).toBe(2);
    expect(attempted).toEqual([missing[1]]);
  });

  it('applies both the cooldown skip and the cap together', () => {
    const missing = makeMissing(50);
    const recentlyFailed = new Set(missing.slice(0, 20).map((m) => m.normalized));
    const { attempted, skippedCooldown } = selectAddressesToAttempt(missing, recentlyFailed, 10);

    expect(skippedCooldown).toBe(20);
    expect(attempted).toHaveLength(10);
    // Only the non-cooled-down ones (indices 20-49) should be eligible.
    for (const a of attempted) {
      expect(recentlyFailed.has(a.normalized)).toBe(false);
    }
  });
});
