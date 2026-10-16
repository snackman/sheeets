import { describe, it, expect, vi, beforeEach } from 'vitest';

const insertEventRowSorted = vi.fn();

vi.mock('../google-sheets', () => ({
  insertEventRowSorted: (...args: unknown[]) => insertEventRowSorted(...args),
}));

import { ThrottledSheetPublisher, toEventRow } from '../ingest/publish';
import type { NormalizedEvent } from '../ingest/types';

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    name: 'ETH Builders Mixer',
    startAt: '2026-03-10T18:00:00.000Z',
    endAt: '2026-03-10T21:00:00.000Z',
    timezone: 'Europe/Paris',
    dateISO: '2026-03-10',
    sheetDate: 'Mar 10',
    startTime: '6:00 PM',
    endTime: '9:00 PM',
    address: '',
    lat: 43.5528,
    lng: 7.0174,
    isOnline: false,
    organizer: 'Alice',
    hosts: [{ name: 'Alice' }],
    calendar: null,
    cost: 'Free',
    link: 'https://luma.com/event/evt-abc123',
    descriptionText: '',
    imageUrl: null,
    platform: 'luma',
    ...overrides,
  };
}

beforeEach(() => {
  insertEventRowSorted.mockReset();
});

describe('toEventRow', () => {
  it('maps a NormalizedEvent to the sheet EventRow shape, joining tags and leaving Note blank (provenance stays out of the sheet)', () => {
    const row = toEventRow(makeEvent(), ['ETH', 'Networking']);
    expect(row).toEqual({
      date: 'Mar 10',
      dateISO: '2026-03-10',
      startTime: '6:00 PM',
      endTime: '9:00 PM',
      organizer: 'Alice',
      name: 'ETH Builders Mixer',
      address: '',
      cost: 'Free',
      tags: 'ETH, Networking',
      link: 'https://luma.com/event/evt-abc123',
      food: false,
      bar: false,
      note: '',
    });
  });
});

describe('ThrottledSheetPublisher', () => {
  it('publishes and increments the count on success', async () => {
    insertEventRowSorted.mockResolvedValueOnce(5);
    const publisher = new ThrottledSheetPublisher('Sheet', 123, { maxPerRun: 10, minIntervalMs: 0 });
    const row = await publisher.publish(toEventRow(makeEvent(), []));
    expect(row).toBe(5);
    expect(publisher.published).toBe(1);
    expect(insertEventRowSorted).toHaveBeenCalledWith('Sheet', 123, expect.objectContaining({ name: 'ETH Builders Mixer' }));
  });

  it('throws once the per-run cap is reached, without calling insertEventRowSorted again', async () => {
    insertEventRowSorted.mockResolvedValue(1);
    const publisher = new ThrottledSheetPublisher('Sheet', 123, { maxPerRun: 1, minIntervalMs: 0 });
    await publisher.publish(toEventRow(makeEvent(), []));
    expect(publisher.capReached).toBe(true);
    await expect(publisher.publish(toEventRow(makeEvent(), []))).rejects.toThrow(/max_publish_per_run/);
    expect(insertEventRowSorted).toHaveBeenCalledTimes(1);
  });

  it('serializes calls at least minIntervalMs apart', async () => {
    insertEventRowSorted.mockResolvedValue(1);
    const publisher = new ThrottledSheetPublisher('Sheet', 123, { maxPerRun: 10, minIntervalMs: 50 });
    const start = Date.now();
    await publisher.publish(toEventRow(makeEvent(), []));
    await publisher.publish(toEventRow(makeEvent(), []));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45); // allow a little slack
  });

  it('retries with backoff on a 429 and eventually succeeds', async () => {
    insertEventRowSorted
      .mockRejectedValueOnce(new Error('Failed to write to sheet: 429 rate limited'))
      .mockResolvedValueOnce(7);
    const publisher = new ThrottledSheetPublisher('Sheet', 123, { maxPerRun: 10, minIntervalMs: 0, maxRetries: 2 });
    const row = await publisher.publish(toEventRow(makeEvent(), []));
    expect(row).toBe(7);
    expect(insertEventRowSorted).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries on repeated 429s', async () => {
    insertEventRowSorted.mockRejectedValue(new Error('429'));
    const publisher = new ThrottledSheetPublisher('Sheet', 123, { maxPerRun: 10, minIntervalMs: 0, maxRetries: 1 });
    await expect(publisher.publish(toEventRow(makeEvent(), []))).rejects.toThrow();
    expect(insertEventRowSorted).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it('does not retry a non-429 failure', async () => {
    insertEventRowSorted.mockRejectedValue(new Error('Failed to write to sheet: 500 server error'));
    const publisher = new ThrottledSheetPublisher('Sheet', 123, { maxPerRun: 10, minIntervalMs: 0, maxRetries: 3 });
    await expect(publisher.publish(toEventRow(makeEvent(), []))).rejects.toThrow();
    expect(insertEventRowSorted).toHaveBeenCalledTimes(1);
  });
});
