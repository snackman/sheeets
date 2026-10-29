// Per-run memo for the curated-tab sheet fetch. A cron invocation runs many
// sources, several of which target the same conference tab; each used to
// re-fetch the whole tab (gviz) just to build its link index. Inside a
// `runWithSheetMemo` scope the first fetch per tab is shared by later
// sources; outside a scope every call is a plain uncached `fetchEvents`.
//
// Freshness: the memo lives only for one invocation (never across runs), and
// the pipeline calls `invalidateSheetMemo(tab)` after every sheet write so a
// later source never dedupes against a snapshot that predates a row this run
// published. The publish path itself (`insertEventRowSorted`) reads the live
// sheet and is unaffected.
import { AsyncLocalStorage } from 'node:async_hooks';
import { fetchEvents } from '../fetch-events';
import type { TabConfig } from '../conferences';
import type { ETHDenverEvent } from '../types';

export type SheetMemo = Map<string, Promise<ETHDenverEvent[]>>;

const storage = new AsyncLocalStorage<SheetMemo>();

function keyFor(tab: TabConfig): string {
  return `${tab.gid}:${tab.name}`;
}

export function runWithSheetMemo<T>(fn: () => Promise<T>, memo: SheetMemo = new Map()): Promise<T> {
  return storage.run(memo, fn);
}

export function fetchSheetEventsMemo(tab: TabConfig): Promise<ETHDenverEvent[]> {
  const memo = storage.getStore();
  if (!memo) return fetchEvents(undefined, [tab]);
  const key = keyFor(tab);
  let p = memo.get(key);
  if (!p) {
    p = fetchEvents(undefined, [tab]);
    memo.set(key, p);
    // Never memoize a failure.
    p.catch(() => {
      if (memo.get(key) === p) memo.delete(key);
    });
  }
  return p;
}

/** Drop the memoized snapshot for a tab (call after writing to its sheet). */
export function invalidateSheetMemo(tab: TabConfig): void {
  storage.getStore()?.delete(keyFor(tab));
}
