import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchEventsMock = vi.fn(async (..._a: unknown[]) => [{ id: 'a' }]);
vi.mock('@/lib/fetch-events', () => ({ fetchEvents: (...a: unknown[]) => fetchEventsMock(...a) }));

import { runWithSheetMemo, fetchSheetEventsMemo, invalidateSheetMemo } from '@/lib/ingest/sheet-memo';
import type { TabConfig } from '@/lib/conferences';

const tabA = { gid: 1, name: 'A' } as TabConfig;
const tabB = { gid: 2, name: 'B' } as TabConfig;

beforeEach(() => fetchEventsMock.mockClear());

describe('sheet memo', () => {
  it('fetches each tab once within a run scope', async () => {
    await runWithSheetMemo(async () => {
      await Promise.all([fetchSheetEventsMemo(tabA), fetchSheetEventsMemo(tabA)]);
      await fetchSheetEventsMemo(tabA);
      await fetchSheetEventsMemo(tabB);
    });
    expect(fetchEventsMock).toHaveBeenCalledTimes(2);
  });

  it('does not memoize outside a scope or across runs', async () => {
    await fetchSheetEventsMemo(tabA);
    await fetchSheetEventsMemo(tabA);
    expect(fetchEventsMock).toHaveBeenCalledTimes(2);
    await runWithSheetMemo(() => fetchSheetEventsMemo(tabA));
    await runWithSheetMemo(() => fetchSheetEventsMemo(tabA));
    expect(fetchEventsMock).toHaveBeenCalledTimes(4);
  });

  it('re-reads fresh after invalidate (post-publish)', async () => {
    await runWithSheetMemo(async () => {
      await fetchSheetEventsMemo(tabA);
      invalidateSheetMemo(tabA);
      await fetchSheetEventsMemo(tabA);
    });
    expect(fetchEventsMock).toHaveBeenCalledTimes(2);
  });

  it('never memoizes a failure', async () => {
    fetchEventsMock.mockRejectedValueOnce(new Error('boom'));
    await runWithSheetMemo(async () => {
      await expect(fetchSheetEventsMemo(tabA)).rejects.toThrow('boom');
      await new Promise((r) => setTimeout(r, 0));
      await fetchSheetEventsMemo(tabA);
    });
    expect(fetchEventsMock).toHaveBeenCalledTimes(2);
  });
});
