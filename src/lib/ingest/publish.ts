// Throttled publisher (§4 publish rules, §8). Reuses `insertEventRowSorted`
// exactly like submission approval — same ID scheme, same main-section
// insert, same `escapeSheetValue` guard (applied inside google-sheets.ts).
import { insertEventRowSorted, type EventRow } from '../google-sheets';
import type { NormalizedEvent } from './types';
import { sanitizeSheetTags } from './sheet-tags';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  return err instanceof Error && /\b429\b/.test(err.message);
}

/** Map a normalized event + suggested tags into the sheet's `EventRow`.
 *  Provenance stays in Supabase only (§17.4 decision) — nothing is written
 *  to the Note column. */
export function toEventRow(event: NormalizedEvent, tags: string[]): EventRow {
  return {
    date: event.sheetDate,
    // The real calendar date, so `insertEventRowSorted` can write column A
    // as a real Sheets date without re-deriving the year by re-parsing
    // `sheetDate`'s display text (see `EventRow.dateISO`/`parseDateToISO`).
    dateISO: event.dateISO,
    startTime: event.startTime,
    endTime: event.endTime,
    organizer: event.organizer,
    name: event.name,
    address: event.address,
    cost: event.cost,
    tags: sanitizeSheetTags(tags).join(', '),
    link: event.link,
    food: false,
    bar: false,
    note: '',
  };
}

export interface PublishOptions {
  /** <= 10/min default (§4: "serialized, <= 10 inserts per minute"). */
  minIntervalMs?: number;
  maxPerRun: number;
  maxRetries?: number;
}

export class ThrottledSheetPublisher {
  private publishedCount = 0;
  private lastCallAt = 0;

  constructor(
    private readonly sheetName: string,
    private readonly gid: number,
    private readonly opts: PublishOptions
  ) {}

  get published(): number {
    return this.publishedCount;
  }

  get capReached(): boolean {
    return this.publishedCount >= this.opts.maxPerRun;
  }

  /** Insert one event row, respecting the per-run cap, a minimum interval
   *  between calls, and exponential backoff on a 429. Throws if the cap is
   *  already reached — callers should check `capReached` first so the
   *  candidate can be left `queued` instead of erroring the run. */
  async publish(row: EventRow): Promise<number> {
    if (this.capReached) {
      throw new Error('max_publish_per_run reached');
    }
    await this.throttle();
    const sheetRow = await this.publishWithRetry(row, 0);
    this.publishedCount++;
    return sheetRow;
  }

  private async throttle(): Promise<void> {
    const minInterval = this.opts.minIntervalMs ?? 6000; // 10/min
    const now = Date.now();
    const wait = this.lastCallAt ? Math.max(0, this.lastCallAt + minInterval - now) : 0;
    if (wait > 0) await sleep(wait);
    this.lastCallAt = Date.now();
  }

  private async publishWithRetry(row: EventRow, attempt: number): Promise<number> {
    const maxRetries = this.opts.maxRetries ?? 3;
    try {
      return await insertEventRowSorted(this.sheetName, this.gid, row);
    } catch (err) {
      if (attempt < maxRetries && isRateLimitError(err)) {
        await sleep(2 ** attempt * 1000);
        return this.publishWithRetry(row, attempt + 1);
      }
      throw err;
    }
  }
}
