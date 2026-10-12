import { describe, it, expect } from 'vitest';
import { dateWindowFilter, geoFilter, isPastEvent } from '../ingest/filters';

describe('dateWindowFilter', () => {
  const conference = { startDate: '2026-04-11', endDate: '2026-04-17' };
  const profile = { window_pre_days: 3, window_post_days: 1 };

  it('passes a date inside the conference window', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-14' }, conference, profile)).toEqual({ pass: true });
  });

  it('passes a date exactly at the pre-window edge', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-08' }, conference, profile).pass).toBe(true);
  });

  it('fails a date one day before the pre-window edge', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-07' }, conference, profile).pass).toBe(false);
  });

  it('passes a date exactly at the post-window edge', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-18' }, conference, profile).pass).toBe(true);
  });

  it('fails a date one day after the post-window edge', () => {
    expect(dateWindowFilter({ dateISO: '2026-04-19' }, conference, profile).pass).toBe(false);
  });
});

describe('geoFilter', () => {
  const center = { lat: 43.5528, lng: 7.0174 }; // Cannes
  const profile = { radius_km: 40, allow_online: false };

  it('passes an event at the center', () => {
    expect(geoFilter({ lat: center.lat, lng: center.lng, isOnline: false }, center, profile)).toEqual({ pass: true });
  });

  it('fails an event far outside the radius', () => {
    const result = geoFilter({ lat: 48.8566, lng: 2.3522, isOnline: false }, center, profile); // Paris
    expect(result.pass).toBe(false);
  });

  it('returns no_geo when lat/lng are missing', () => {
    expect(geoFilter({ lat: null, lng: null, isOnline: false }, center, profile)).toEqual({ pass: 'no_geo' });
  });

  it('rejects an online event when allow_online is false', () => {
    const result = geoFilter({ lat: null, lng: null, isOnline: true }, center, profile);
    expect(result.pass).toBe(false);
  });

  it('passes an online event when allow_online is true', () => {
    const result = geoFilter({ lat: null, lng: null, isOnline: true }, center, { ...profile, allow_online: true });
    expect(result.pass).toBe(true);
  });
});

describe('isPastEvent', () => {
  it('is true for a startAt before now', () => {
    expect(isPastEvent({ startAt: '2020-01-01T00:00:00.000Z' })).toBe(true);
  });

  it('is false for a startAt in the future', () => {
    expect(isPastEvent({ startAt: '2099-01-01T00:00:00.000Z' })).toBe(false);
  });

  it('respects an injected `now`', () => {
    expect(isPastEvent({ startAt: '2026-06-01T00:00:00.000Z' }, new Date('2026-01-01T00:00:00.000Z'))).toBe(false);
  });
});
