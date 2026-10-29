import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  insertEventRowSorted,
  buildInsertEventRowRequests,
  toUserEnteredCell,
  isoDateToSheetSerial,
  SheetInsertUnverifiedError,
  CURATED_DATE_PATTERN,
  type EventRow,
} from '../google-sheets';

// A tiny in-memory Google Sheet behind a fake `fetch`, so the insert flow
// (read -> ONE atomic batchUpdate -> verify) is exercised end to end.

type Cell = string;
interface FakeSheet {
  rows: Cell[][];
  calls: { method: string; url: string; body?: unknown }[];
  /** Called right after a batchUpdate applies (simulate concurrent edits). */
  afterBatch?: () => void;
  /** Apply only these request kinds from a batch (simulate a broken API). */
  applyOnly?: string[];
  /** Throw a network error AFTER applying the batch. */
  networkErrorAfterBatch?: boolean;
  /** Grid row count (metadata), tracked through inserts/deletes. */
  gridRows: number;
  /** Answer every values GET after the insert batch with a 429. */
  failReadsAfterBatch?: boolean;
  /** Fail the (separate) date-format batchUpdate. */
  failFormat?: boolean;
  batched?: boolean;
}

let sheet: FakeSheet;

function a1ToRange(a1: string): { r0: number; r1: number | null; c0: number; c1: number } {
  const m = /^([A-Z]+)(\d+)?:([A-Z]+)(\d+)?$/.exec(a1)!;
  const col = (s: string) => s.charCodeAt(0) - 65;
  return { c0: col(m[1]), r0: m[2] ? Number(m[2]) - 1 : 0, c1: col(m[3]), r1: m[4] ? Number(m[4]) - 1 : null };
}

function cellText(cd: { userEnteredValue?: Record<string, unknown> }): string {
  const v = cd.userEnteredValue;
  if (!v) return '';
  if ('stringValue' in v) return String(v.stringValue);
  if ('boolValue' in v) return v.boolValue ? 'TRUE' : 'FALSE';
  if ('numberValue' in v) return `#${v.numberValue}`;
  return '';
}

interface FakeReq {
  insertDimension?: { range: { sheetId: number; startIndex: number; endIndex: number }; inheritFromBefore?: boolean };
  updateCells?: { start: { sheetId: number; rowIndex: number; columnIndex: number }; rows: { values: { userEnteredValue?: Record<string, unknown> }[] }[] };
  deleteDimension?: { range: { startIndex: number } };
  repeatCell?: { cell: { userEnteredFormat: { numberFormat: { pattern: string } } } };
}

function applyBatch(requests: FakeReq[]) {
  for (const req of requests) {
    const kind = Object.keys(req)[0];
    if (sheet.applyOnly && !sheet.applyOnly.includes(kind)) continue;
    if (req.insertDimension) {
      sheet.rows.splice(req.insertDimension.range.startIndex, 0, []);
      sheet.gridRows++;
    } else if (req.updateCells) {
      const { rowIndex, columnIndex } = req.updateCells.start;
      const values = req.updateCells.rows[0].values.map(cellText);
      const row = sheet.rows[rowIndex] ?? [];
      values.forEach((v: string, i: number) => (row[columnIndex + i] = v));
      sheet.rows[rowIndex] = row;
    } else if (req.deleteDimension) {
      sheet.rows.splice(req.deleteDimension.range.startIndex, 1);
      sheet.gridRows--;
    }
  }
}

const fakeFetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  if (url.includes('oauth2.googleapis.com')) {
    return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });
  }
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  sheet.calls.push({ method, url, body });
  if (url.endsWith(':batchUpdate') && method === 'POST') {
    if ((body.requests as FakeReq[]).some((r) => r.repeatCell)) {
      return sheet.failFormat ? new Response('format boom', { status: 500 }) : new Response('{}', { status: 200 });
    }
    sheet.batched = true;
    applyBatch(body.requests);
    sheet.afterBatch?.();
    if (sheet.networkErrorAfterBatch) throw new TypeError('fetch failed');
    return new Response('{}', { status: 200 });
  }
  if (url.includes('?fields=sheets') && method === 'GET') {
    return new Response(JSON.stringify({ sheets: [{ properties: { sheetId: 7, gridProperties: { rowCount: sheet.gridRows } } }] }), { status: 200 });
  }
  if (url.includes('/values/') && method === 'GET') {
    if (sheet.failReadsAfterBatch && sheet.batched) return new Response('Quota exceeded 429', { status: 429 });
    const a1 = decodeURIComponent(url.split('/values/')[1]).split('!')[1];
    const { r0, r1, c0, c1 } = a1ToRange(a1);
    const last = r1 ?? sheet.rows.length - 1;
    const values: string[][] = [];
    for (let r = r0; r <= last; r++) values.push((sheet.rows[r] ?? []).slice(c0, c1 + 1).map((v) => v ?? ''));
    return new Response(JSON.stringify({ values }), { status: 200 });
  }
  return new Response('unexpected', { status: 500 });
});

const HEADER = ['Date', 'Start Time', 'End Time', 'Organizer', 'Event Name', 'Address', 'Cost', 'Tags', 'Link', 'Food', 'Bar', 'Note'];

function baseRows(): Cell[][] {
  return [
    ['Title'],
    HEADER,
    ['Mon, November 9', '9:00a', '', 'Org A', 'Morning', 'Addr', 'Free', '', 'https://luma.com/a', 'FALSE', 'FALSE', ''],
    ['Tue, November 10', '6:00p', '', 'Org B', 'Evening', 'Addr', 'Free', '', 'https://luma.com/b', 'FALSE', 'FALSE', ''],
    [],
    ['Add Events Here'],
  ];
}

const event: EventRow = {
  date: 'Mon, November 9',
  dateISO: '2026-11-09',
  startTime: '6:00p',
  endTime: '9:00p',
  organizer: 'Org C',
  name: '=HYPERLINK("http://evil")',
  address: 'Shoreditch, London',
  cost: '$20',
  tags: 'Networking',
  link: 'https://luma.com/event/evt-new',
  food: true,
  bar: false,
  note: '',
};

beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'test@example.iam.gserviceaccount.com';
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
});

beforeEach(() => {
  sheet = { rows: baseRows(), calls: [], gridRows: 1000 };
  vi.stubGlobal('fetch', fakeFetch);
  fakeFetch.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('toUserEnteredCell / buildInsertEventRowRequests (USER_ENTERED semantics preserved)', () => {
  it('apostrophe-forced text becomes a literal string (no apostrophe stored), never a formula', () => {
    expect(toUserEnteredCell("'6:00p", 1)).toEqual({ userEnteredValue: { stringValue: '6:00p' } });
    expect(toUserEnteredCell("'=HYPERLINK(1)", 4)).toEqual({ userEnteredValue: { stringValue: '=HYPERLINK(1)' } });
  });
  it('TRUE/FALSE become booleans; empty stays empty; plain text stays a string', () => {
    expect(toUserEnteredCell('TRUE', 9)).toEqual({ userEnteredValue: { boolValue: true } });
    expect(toUserEnteredCell('FALSE', 10)).toEqual({ userEnteredValue: { boolValue: false } });
    expect(toUserEnteredCell('', 11)).toEqual({});
    expect(toUserEnteredCell('2049', 4)).toEqual({ userEnteredValue: { stringValue: '2049' } });
  });
  it('column A ISO date becomes a real date serial', () => {
    expect(isoDateToSheetSerial('1899-12-31')).toBe(1);
    expect(toUserEnteredCell('2026-11-09', 0)).toEqual({ userEnteredValue: { numberValue: isoDateToSheetSerial('2026-11-09') } });
  });
  it('builds insertDimension + updateCells as ONE atomic request list (date format is separate)', () => {
    const { requests, expected, dateIsRealDate } = buildInsertEventRowRequests(42, 3, event);
    expect(requests.map((r) => Object.keys(r)[0])).toEqual(['insertDimension', 'updateCells']);
    expect(dateIsRealDate).toBe(true);
    const reqs = requests as FakeReq[];
    expect(reqs[0].insertDimension).toMatchObject({ range: { sheetId: 42, startIndex: 3, endIndex: 4 }, inheritFromBefore: true });
    expect(reqs[1].updateCells?.start).toEqual({ sheetId: 42, rowIndex: 3, columnIndex: 0 });
    expect(expected).toEqual({ link: 'https://luma.com/event/evt-new', name: '=HYPERLINK("http://evil")', dateKey: 1009 });
  });
});

describe('insertEventRowSorted (atomic batch + verify)', () => {
  it('inserts chronologically with ONE batchUpdate and no separate values write', async () => {
    const row = await insertEventRowSorted('Tab', 7, event);
    expect(row).toBe(4); // after Mon 9:00a, before Tue
    const batches = sheet.calls.filter((c) => c.url.endsWith(':batchUpdate'));
    expect(batches).toHaveLength(2); // atomic insert+write, then the cosmetic date format
    expect(Object.keys((batches[0].body as { requests: FakeReq[] }).requests[1])).toEqual(['updateCells']);
    expect(sheet.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(sheet.rows[3][8]).toBe('https://luma.com/event/evt-new');
    expect(sheet.rows[3][4]).toBe('=HYPERLINK("http://evil")'); // stored as a literal string
    expect(sheet.rows[3][6]).toBe('$20');
    expect(sheet.rows[3][9]).toBe('TRUE');
  });

  it('a concurrent insert above the row after the batch: finds the shifted row, deletes nothing', async () => {
    sheet.afterBatch = () => {
      sheet.rows.splice(2, 0, ['Mon, November 9', '8:00a', '', 'X', 'Hand row', '', '', '', 'https://luma.com/x']);
    };
    const row = await insertEventRowSorted('Tab', 7, event);
    expect(row).toBe(5);
    expect(sheet.calls.some((c) => JSON.stringify(c.body ?? '').includes('deleteDimension'))).toBe(false);
    expect(sheet.rows.filter((r) => r[8] === 'https://luma.com/event/evt-new')).toHaveLength(1);
  });

  it('a blank inserted row is deleted only when the grid provably grew by one, and throws non-retryable', async () => {
    sheet.applyOnly = ['insertDimension', 'deleteDimension']; // cells never landed
    const err = await insertEventRowSorted('Tab', 7, event).catch((e) => e);
    expect(err).toBeInstanceOf(SheetInsertUnverifiedError);
    expect(err.retryable).toBe(false);
    expect(sheet.rows).toEqual(baseRows());
    expect(sheet.gridRows).toBe(1000);
  });

  it('never deletes a blank row it cannot prove it inserted (grid count did not grow by exactly one)', async () => {
    sheet.applyOnly = ['insertDimension'];
    sheet.afterBatch = () => {
      sheet.gridRows += 1; // someone else also added a row concurrently
    };
    expect(await insertEventRowSorted('Tab', 7, event)).toBe(4);
    expect(sheet.calls.some((c) => JSON.stringify(c.body ?? '').includes('deleteDimension'))).toBe(false);
  });

  it('never deletes a NON-blank row on mismatch, and does not throw (row treated as inserted)', async () => {
    sheet.afterBatch = () => {
      // Someone overwrote our row's cells entirely.
      sheet.rows[3] = ['Mon, November 9', '7:00p', '', 'Y', 'Other', '', '', '', 'https://luma.com/other'];
    };
    expect(await insertEventRowSorted('Tab', 7, event)).toBe(4);
    expect(sheet.calls.some((c) => JSON.stringify(c.body ?? '').includes('deleteDimension'))).toBe(false);
    expect(sheet.rows[3][8]).toBe('https://luma.com/other');
  });

  it('a 429 while VERIFYING (after a successful insert) is swallowed: returns the row, never an error a caller could retry', async () => {
    sheet.failReadsAfterBatch = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await insertEventRowSorted('Tab', 7, event)).toBe(4);
    expect(sheet.rows.filter((r) => r[8] === 'https://luma.com/event/evt-new')).toHaveLength(1);
    warn.mockRestore();
  });

  it('a shifted row is located by link + name + date, not link alone (multi-day events share a link)', async () => {
    sheet.afterBatch = () => {
      // A hand row for DAY 2 of the same multi-day event (same link, other date), plus a shift.
      sheet.rows.splice(2, 0, ['Tue, November 10', '8:00a', '', 'X', '=HYPERLINK("http://evil")', '', '', '', 'https://luma.com/event/evt-new']);
    };
    const row = await insertEventRowSorted('Tab', 7, event);
    expect(row).toBe(5);
    expect(sheet.rows[row - 1][0]).toBe('#' + isoDateToSheetSerial('2026-11-09'));
  });

  it('applies the date format as a separate call after the insert; its failure is non-fatal', async () => {
    sheet.failFormat = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await insertEventRowSorted('Tab', 7, event)).toBe(4);
    const batches = sheet.calls.filter((c) => c.url.endsWith(':batchUpdate'));
    expect(batches.map((b) => Object.keys((b.body as { requests: FakeReq[] }).requests[0])[0])).toEqual(['insertDimension', 'repeatCell']);
    expect((batches[1].body as { requests: FakeReq[] }).requests[0].repeatCell?.cell.userEnteredFormat.numberFormat.pattern).toBe(CURATED_DATE_PATTERN);
    warn.mockRestore();
  });

  it('a network error after the batch applied still reports the row (no duplicate retry)', async () => {
    sheet.networkErrorAfterBatch = true;
    const row = await insertEventRowSorted('Tab', 7, event);
    expect(row).toBe(4);
  });

  it('a network error where nothing applied rethrows', async () => {
    sheet.networkErrorAfterBatch = true;
    sheet.applyOnly = [];
    await expect(insertEventRowSorted('Tab', 7, event)).rejects.toThrow(/fetch failed/);
  });

  it('an HTTP error from the batch throws with nothing inserted', async () => {
    const original = fakeFetch.getMockImplementation()!;
    fakeFetch.mockImplementation(async (input, init) => {
      if (String(input).endsWith(':batchUpdate')) return new Response('quota', { status: 429 });
      return original(input, init);
    });
    await expect(insertEventRowSorted('Tab', 7, event)).rejects.toThrow(/429/);
    expect(sheet.rows).toEqual(baseRows());
    fakeFetch.mockImplementation(original);
  });
});
