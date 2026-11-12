import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useEvents } from '../useEvents';
import type { ETHDenverEvent } from '@/lib/types';

const ev = (id: string, conference: string) => ({ id, conference }) as unknown as ETHDenverEvent;

describe('useEvents retry', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it('reload() recovers from a failed initial load in place', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [ev('a', 'X')] });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useEvents());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.events).toEqual([]);

    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.events).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a failed on-demand conference load and clears it on retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => [ev('b', 'Y')] });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const initial = [ev('a', 'X')];
    const { result, rerender } = renderHook(({ conf }) => useEvents(initial, conf), { initialProps: { conf: 'X' } });
    rerender({ conf: 'Y' }); // user switches to a conference we don't hold yet
    await waitFor(() => expect(result.current.failedConference).toBe('Y'));

    await act(async () => {
      await result.current.retryConference('Y');
    });
    expect(result.current.failedConference).toBeNull();
    expect(result.current.events.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });
});
