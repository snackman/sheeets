import crypto from 'crypto';
import { SHEET_ID } from '@/lib/constants';
import { parseDateToISO } from './utils';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

/** Base64url encode (no padding) */
function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Create a signed JWT for Google service account auth */
function createJWT(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim().replace(/\\n/g, '\n');

  if (!email || !privateKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars');
  }

  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPES,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);

  return `${signingInput}.${base64url(signature)}`;
}

/** Get a valid access token, using cache when possible (~55 min TTL) */
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const jwt = createJWT();

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    // Cache for 55 minutes (token is valid for 60)
    expiresAt: Date.now() + 55 * 60 * 1000,
  };

  return cachedToken.token;
}

// Cache for sheet titles by gid
const sheetTitleCache = new Map<number, { title: string; expiresAt: number }>();

/** Resolve a sheet tab's actual title from its gid (numeric sheet ID). */
export async function getSheetTitle(gid: number): Promise<string> {
  const cached = sheetTitleCache.get(gid);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.title;
  }

  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets.properties`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to fetch sheet metadata: ${res.status} ${text}`);
  }

  const data = await res.json();
  const sheets: { properties: { sheetId: number; title: string } }[] = data.sheets || [];

  // Cache all sheets from this response
  for (const s of sheets) {
    sheetTitleCache.set(s.properties.sheetId, {
      title: s.properties.title,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  }

  const match = sheets.find((s) => s.properties.sheetId === gid);
  if (!match) {
    throw new Error(`No sheet found with gid ${gid}`);
  }

  return match.properties.title;
}

/**
 * Find the next empty row in the "Add Events Here" section of a sheet tab.
 * Scans column A for the cell containing "Add Events Here", then looks for
 * the header row below it (col B = "Start Time"), and returns the first
 * empty row after that header.
 */
export async function findNextEmptyRow(sheetName: string): Promise<number> {
  const token = await getAccessToken();
  const range = encodeURIComponent(`'${sheetName}'!A1:E`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to read sheet: ${res.status} ${text}`);
  }

  const data = await res.json();
  const rows: string[][] = data.values || [];

  // Find the "Add Events Here" marker row
  let addEventsRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const cellA = (rows[i]?.[0] || '').trim();
    if (cellA.includes('Add Events Here')) {
      addEventsRow = i;
      break;
    }
  }

  // Find the header row after the marker (col B = "Start Time")
  let headerRow = addEventsRow >= 0 ? addEventsRow + 1 : -1;
  if (addEventsRow >= 0) {
    for (let i = addEventsRow + 1; i < rows.length; i++) {
      const colB = (rows[i]?.[1] || '').trim().toLowerCase();
      if (colB === 'start time') {
        headerRow = i;
        break;
      }
    }
  }

  // Start scanning for empty rows after the header
  const startIdx = headerRow >= 0 ? headerRow + 1 : 13; // fallback to row 14

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i] || [];
    const cellDate = (row[0] || '').trim();
    const startTime = (row[1] || '').trim();
    const name = (row[4] || '').trim();

    if (!cellDate && !startTime && !name) {
      return i + 1; // Convert to 1-based sheet row
    }
  }

  // If no empty row found, append after last row
  return rows.length + 1;
}

/** Read a range from a sheet tab. Returns a 2D array of strings. */
export async function readRange(sheetName: string, range: string): Promise<string[][]> {
  const token = await getAccessToken();
  const fullRange = encodeURIComponent(`'${sheetName}'!${range}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${fullRange}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to read sheet: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.values || [];
}

/** Write a single value to a specific cell. */
export async function writeCell(sheetName: string, cell: string, value: string): Promise<void> {
  const token = await getAccessToken();
  const range = encodeURIComponent(`'${sheetName}'!${cell}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values: [[value]] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to write cell: ${res.status} ${text}`);
  }
}

/**
 * Write several ranges in one `values.batchUpdate` call (one HTTP request
 * covering every range in `data`). Used by one-off repair scripts that need
 * to rewrite many rows across a tab without one PUT per row.
 *
 * Defaults to `valueInputOption=RAW` — unlike the event-row writers above,
 * callers here are expected to pass already-final literal text (e.g. a
 * repaired "Mon, October 5" date string), so there's no USER_ENTERED
 * formula/boolean coercion to opt into, and RAW guarantees Sheets/gviz can
 * never re-type the written cells as a date/time/number value.
 */
export async function writeValuesBatch(
  data: { range: string; values: string[][] }[],
  valueInputOption: 'RAW' | 'USER_ENTERED' = 'RAW'
): Promise<void> {
  if (data.length === 0) return;
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values:batchUpdate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ valueInputOption, data }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to batch-write values: ${res.status} ${text}`);
  }
}

export interface EventRow {
  date: string;
  /** The event's real calendar date, "YYYY-MM-DD", when the caller already
   *  has one (e.g. the ingest pipeline's `NormalizedEvent.dateISO`). Lets
   *  `mainSectionRowValues` write a real Sheets date without re-deriving
   *  the year by re-parsing `date`'s display text (which would silently
   *  assume a hardcoded year — see `parseDateToISO`). Callers that only
   *  have the display text (e.g. an admin-approve edit) can omit this. */
  dateISO?: string;
  startTime: string;
  endTime: string;
  organizer: string;
  name: string;
  address: string;
  cost: string;
  tags: string;
  link: string;
  food: boolean;
  bar: boolean;
  note: string;
}

/**
 * Neutralize spreadsheet formula injection in user-supplied text.
 *
 * Event rows are written with valueInputOption=USER_ENTERED (not RAW) on
 * purpose: "TRUE"/"FALSE" need to become real checkbox booleans for
 * Food/Bar, and user-supplied text should keep normal Sheets autocorrect
 * (e.g. smart quotes). Any value that would otherwise be interpreted as a
 * formula is prefixed with an apostrophe, which Sheets treats as "literal
 * text" and hides.
 *
 * Date/Start Time/End Time/Cost are handled separately by
 * `forceSheetText` below — they must NEVER be allowed to parse as a real
 * Sheets date/time/number value (see that function's comment for why).
 */
export function escapeSheetValue(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Force a cell to be stored as plain TEXT, never a real Sheets date, time,
 * or (for "$20"-style costs) currency number.
 *
 * Bug history: the event-row Date/Start Time/End Time columns used to be
 * written as plain text like "Oct 31" / "12:00 PM" under
 * valueInputOption=USER_ENTERED. Sheets happily parses those as real
 * date/time values and stores them that way — which is exactly what broke
 * `fetchEvents` for ingest-published tabs: gviz infers a column's type
 * (`date`/`datetime`) from the sheet's stored values, and once it decides a
 * column is typed, a literal text cell that can't be coerced to that type
 * (e.g. the "Start Time" header text, sitting in a column gviz now thinks
 * is `datetime`) comes back as `v: null` with no `f` either — so
 * `findHeaderIndex` can never find the header row and the whole tab reads
 * as zero events.
 *
 * The curated tabs avoid this because their Date/Start/End/Cost cells are
 * already plain text (verified live against "Token2049 2026"/gid
 * 357353145: column A has cells with real `Date(...)` values matched by a
 * `ddd", "mmmm" "d` pattern, but columns B/C/G are typed `string` with bare
 * text like "9:00a"/"Free" — no number format at all). A leading apostrophe
 * forces the same "always literal text" behavior under USER_ENTERED,
 * regardless of what the text looks like.
 */
export function forceSheetText(value: string): string {
  if (!value) return value;
  return value.startsWith("'") ? value : `'${value}`;
}

/** Build the A:L cell values for an event row (user text escaped; Date/Start
 *  Time/End Time/Cost forced to literal text so Sheets/gviz never re-types
 *  them as a date, time, or currency number — see `forceSheetText`).
 *
 *  This is the right behavior for the "Add Events Here" REVIEW section
 *  (written by `appendEventRow`) — `fetchEvents` never reads that section
 *  at all, and forcing Date to text there keeps its displayed text
 *  (and therefore `findReviewRow`'s plain string match against
 *  `event_submissions.event_date`) unchanged from before this fix.
 *
 *  The MAIN section (what `fetchEvents`/gviz actually reads) needs the
 *  OPPOSITE treatment for column A — see `mainSectionRowValues` below. */
export function eventRowValues(event: EventRow): string[] {
  return [
    forceSheetText(event.date),
    forceSheetText(event.startTime),
    forceSheetText(event.endTime),
    escapeSheetValue(event.organizer),
    escapeSheetValue(event.name),
    escapeSheetValue(event.address),
    forceSheetText(event.cost),
    escapeSheetValue(event.tags),
    escapeSheetValue(event.link),
    event.food ? 'TRUE' : 'FALSE',
    event.bar ? 'TRUE' : 'FALSE',
    escapeSheetValue(event.note),
  ];
}

/** The curated tabs' own Date-column number format, e.g. "Mon, October 5"
 *  — verified live against "Token2049 2026" (gid 357353145), whose column
 *  A number-format pattern is literally this string. */
export const CURATED_DATE_PATTERN = 'ddd", "mmmm" "d';

/**
 * Resolve the ISO date ("YYYY-MM-DD") to write as column A's real Sheets
 * date value for a MAIN-SECTION row. Prefers `event.dateISO` (exact, when
 * the caller has one) over re-parsing `event.date`'s display text — that
 * fallback (`parseDateToISO`) hardcodes a single year, so it's only a
 * reasonable guess, not something to prefer when the real date is known.
 * Returns '' if neither is available/parseable.
 */
function resolveMainSectionDateISO(event: EventRow): string {
  if (event.dateISO) return event.dateISO;
  if (!event.date) return '';
  return parseDateToISO(event.date);
}

/**
 * Build the A:L cell values for a row in the MAIN section — the section
 * `fetchEvents`/gviz actually reads, and the one this bug is about.
 *
 * Unlike `eventRowValues` (used for the review section), column A (Date)
 * here is written as a REAL Sheets date (an unambiguous ISO value, e.g.
 * "2026-10-31", via valueInputOption=USER_ENTERED) instead of forced text.
 * This matters because the curated tabs' column A IS a real date (verified
 * live: "Token2049 2026"/gid 357353145 has `Date(...)` values with number
 * format `ddd", "mmmm" "d`) — if an ingest-published row instead stores a
 * TEXT value in that date-typed column, gviz returns `v: null`/`f: null`
 * for it, and `fetchEvents`' carry-forward `currentDate` logic silently
 * gives the row the PREVIOUS row's date (same class of bug this PR fixes
 * for the Start/End Time columns, just the opposite direction — those
 * needed to stay text, this one needs to stay a real date).
 *
 * Returns whether column A ended up a real date, so the caller knows
 * whether it's worth also calling `setDateColumnFormat` (no point for the
 * "couldn't resolve an ISO date, fell back to forced text" case).
 */
export function mainSectionRowValues(event: EventRow): { values: string[]; dateIsRealDate: boolean } {
  const values = eventRowValues(event);
  const iso = resolveMainSectionDateISO(event);
  values[0] = iso || forceSheetText(event.date);
  return { values, dateIsRealDate: Boolean(iso) };
}

/** Exported only for testing the exact repeatCell request shape without a
 *  live Sheets API call (see `setDateColumnFormat`). */
export function dateColumnFormatRequest(gid: number, rowIndex0: number) {
  return {
    repeatCell: {
      range: {
        sheetId: gid,
        startRowIndex: rowIndex0,
        endRowIndex: rowIndex0 + 1,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      cell: {
        userEnteredFormat: {
          numberFormat: { type: 'DATE', pattern: CURATED_DATE_PATTERN },
        },
      },
      fields: 'userEnteredFormat.numberFormat',
    },
  };
}

/**
 * Apply the curated Date-column number format to column A of one or more
 * (0-based) row indexes, in one `spreadsheets.batchUpdate` call. Called
 * after writing a real date value via `mainSectionRowValues` so the cell
 * displays "Mon, October 5" instead of whatever default/inherited date
 * format Sheets would otherwise use — explicit rather than relying on
 * `insertDimension`'s `inheritFromBefore`, which only works once there's
 * already a correctly-formatted row directly above the insertion point.
 */
export async function setDateColumnFormat(gid: number, rowIndexes0: number[]): Promise<void> {
  if (rowIndexes0.length === 0) return;
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests: rowIndexes0.map((r) => dateColumnFormatRequest(gid, r)) }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to set date column format: ${res.status} ${text}`);
  }
}

/**
 * Write an event row to the sheet.
 * Columns A:L map to: Date, Start Time, End Time, Organizer, Event Name, Address, Cost, Tags, Link, Food, Bar, Note
 * Returns the row number written.
 */
export async function appendEventRow(sheetName: string, event: EventRow): Promise<number> {
  const row = await findNextEmptyRow(sheetName);
  const token = await getAccessToken();

  const range = encodeURIComponent(`'${sheetName}'!A${row}:L${row}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;

  const values = [eventRowValues(event)];

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to write to sheet: ${res.status} ${text}`);
  }

  return row;
}

const MONTH_MAP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Parse a sheet date like "May 5", "Tue, May 5" → sortable number (month*100+day). */
function parseSheetDate(raw: string): number | null {
  const match = raw.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{1,2})\b/i);
  if (!match) return null;
  const month = MONTH_MAP[match[1].toLowerCase().slice(0, 3)];
  const day = parseInt(match[2], 10);
  if (month === undefined || isNaN(day)) return null;
  return month * 100 + day;
}

/** Parse a sheet time like "12:00p", "6:00 PM", "9:30 AM" → minutes since midnight. */
function parseSheetTime(raw: string): number | null {
  const match = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm|a|p)?/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const ampm = match[3]?.toLowerCase();
  if (ampm) {
    if (ampm.startsWith('p') && hours !== 12) hours += 12;
    if (ampm.startsWith('a') && hours === 12) hours = 0;
  }
  return hours * 60 + minutes;
}

/**
 * Insert an event row into the main section of a sheet tab (before the "Add Events Here" area).
 * Uses the Sheets batchUpdate API to insert a blank row, then writes the event data.
 * Inserts at the chronologically correct position by date/time.
 * Returns the 1-based row number where the event was inserted.
 */
export async function insertEventRowSorted(sheetName: string, gid: number, event: EventRow): Promise<number> {
  const token = await getAccessToken();

  // 1. Read columns A:B to find the main section boundaries
  const range = encodeURIComponent(`'${sheetName}'!A1:E`);
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;
  const readRes = await fetch(readUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!readRes.ok) {
    const text = await readRes.text();
    throw new Error(`Failed to read sheet: ${readRes.status} ${text}`);
  }
  const readData = await readRes.json();
  const rows: string[][] = readData.values || [];

  // 2. Find the first header row (col B = "Start Time") — this is the main section header
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const colB = (rows[i]?.[1] || '').trim().toLowerCase();
    if (colB === 'start time') {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    // Can't find main section header — fall back to appendEventRow
    return appendEventRow(sheetName, event);
  }

  // 3. Find the end of the main events section:
  //    first empty row or "Add Events Here" marker after the header
  let mainSectionEnd = rows.length;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cellA = (rows[i]?.[0] || '').trim();
    const cellB = (rows[i]?.[1] || '').trim();
    const cellE = (rows[i]?.[4] || '').trim();

    // "Add Events Here" marker — stop before it
    if (cellA.includes('Add Events Here')) {
      mainSectionEnd = i;
      break;
    }

    // Empty row (no date, no start time, no name) — end of main section
    if (!cellA && !cellB && !cellE) {
      mainSectionEnd = i;
      break;
    }
  }

  // Find chronologically correct insertion point
  const newDate = parseSheetDate(event.date);
  const newTime = parseSheetTime(event.startTime);

  let insertIdx = mainSectionEnd; // default: end of section
  if (newDate !== null) {
    for (let i = headerIdx + 1; i < mainSectionEnd; i++) {
      const rowDate = parseSheetDate((rows[i]?.[0] || '').trim());
      if (rowDate === null) continue;

      if (rowDate > newDate) {
        insertIdx = i;
        break;
      }
      if (rowDate === newDate) {
        const rowTime = parseSheetTime((rows[i]?.[1] || '').trim());
        if (rowTime !== null && newTime !== null && rowTime > newTime) {
          insertIdx = i;
          break;
        }
      }
    }
  }
  // 4. Insert the row AND write its cells in ONE spreadsheets.batchUpdate
  //    (insertDimension + updateCells). A batchUpdate is atomic — all
  //    requests apply or none do — so there is no window where a blank
  //    inserted row exists, and no second request that could land on a row
  //    that shifted in between (the old insert-then-PUT-values flow had both
  //    problems). The cosmetic date format is a separate, non-fatal call
  //    afterwards (step 6) so it can never fail the insert itself.
  const { requests, dateIsRealDate, expected } = buildInsertEventRowRequests(gid, insertIdx, event);
  // Grid row count before the insert: lets verification positively confirm
  // that exactly one row was added before it would ever delete anything.
  const rowCountBefore = await getGridRowCount(token, gid).catch(() => null);
  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`;
  let batchRes: Response;
  try {
    batchRes = await fetch(batchUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    });
  } catch (err) {
    // Network failure: the batch may or may not have applied. If our row
    // is there, report it (so the caller records it as published instead
    // of retrying into a duplicate); if we can't tell, never let the caller
    // blindly retry.
    let found: number | null;
    try {
      found = await locateInsertedRow(token, sheetName, expected, insertIdx);
    } catch {
      throw new SheetInsertUnverifiedError(`Insert on '${sheetName}' hit a network error and could not be verified: ${err instanceof Error ? err.message : err}`);
    }
    if (found !== null) return found + 1;
    throw err;
  }

  if (!batchRes.ok) {
    // Atomic: nothing was inserted, so this (incl. a 429) is safe to retry.
    const text = await batchRes.text();
    throw new Error(`Failed to insert event row: ${batchRes.status} ${text}`);
  }

  // 5. Verify. From here on the row IS (very likely) on the sheet, so no
  //    error may ever be retryable — a retry would double-insert. A
  //    verification failure is logged and the expected row returned;
  //    only a POSITIVELY confirmed blank inserted row is removed (and that
  //    throws a non-retryable error).
  let rowIdx = insertIdx;
  try {
    rowIdx = await verifyInsertedRow(token, sheetName, gid, insertIdx, expected, rowCountBefore);
  } catch (err) {
    if (err instanceof SheetInsertUnverifiedError) throw err;
    console.warn(`[insertEventRowSorted] '${sheetName}': verification failed (treating row ${insertIdx + 1} as inserted): ${err instanceof Error ? err.message : err}`);
  }

  // 6. Curated date display ("Mon, October 5"). Non-fatal: the row is
  //    already published and correctly typed for gviz either way.
  if (dateIsRealDate) {
    try {
      await setDateColumnFormat(gid, [rowIdx]);
    } catch (err) {
      console.warn(`Failed to set date column format for row ${rowIdx + 1}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return rowIdx + 1;
}

/** Thrown once a row insert has (or may have) reached the sheet but could
 *  not be verified/undone. Callers must NOT retry it — see
 *  `publish.ts#isRetryableInsertError`. */
export class SheetInsertUnverifiedError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = 'SheetInsertUnverifiedError';
  }
}

/** Days since the Sheets epoch (1899-12-30) for an ISO "YYYY-MM-DD" — the
 *  serial number USER_ENTERED would have stored for that text. */
export function isoDateToSheetSerial(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(ms)) return null;
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** The literal text a cell holds after a USER_ENTERED write of `value`
 *  (a leading apostrophe means "literal text" and is not stored). */
function storedText(value: string): string {
  return value.startsWith("'") ? value.slice(1) : value;
}

/**
 * Translate one `mainSectionRowValues` cell into `updateCells` CellData,
 * reproducing what valueInputOption=USER_ENTERED did for the values this
 * writer produces:
 *  - "'text" (escapeSheetValue / forceSheetText) -> literal string "text"
 *  - "TRUE"/"FALSE" (Food/Bar) -> real booleans (checkboxes)
 *  - column A ISO date -> real date serial (display format applied by
 *    `setDateColumnFormat` right after the insert)
 *  - anything else -> a plain string. (USER_ENTERED could additionally
 *    have coerced number-/date-looking free text into a number; storing it
 *    as text is strictly safer for gviz's column typing.) A string value is
 *    never evaluated as a formula.
 */
export function toUserEnteredCell(value: string, columnIndex: number): { userEnteredValue?: Record<string, unknown> } {
  if (value === '') return {};
  if (value.startsWith("'")) return { userEnteredValue: { stringValue: value.slice(1) } };
  if (value === 'TRUE' || value === 'FALSE') return { userEnteredValue: { boolValue: value === 'TRUE' } };
  if (columnIndex === 0) {
    const serial = isoDateToSheetSerial(value);
    if (serial !== null) return { userEnteredValue: { numberValue: serial } };
  }
  return { userEnteredValue: { stringValue: value } };
}

/** What identifies OUR inserted row: link + name + date (a multi-day event
 *  shares one Luma link across several rows, so link alone is ambiguous). */
export interface InsertedRowIdentity {
  link: string;
  name: string;
  /** month*100+day (see `parseSheetDate`), or null if unparseable. */
  dateKey: number | null;
}

/** The exact atomic `spreadsheets.batchUpdate` request list for a sorted
 *  insert (insertDimension + updateCells). Exported for tests. */
export function buildInsertEventRowRequests(gid: number, insertIdx: number, event: EventRow) {
  const { values: rowValues, dateIsRealDate } = mainSectionRowValues(event);
  const requests: Record<string, unknown>[] = [
    {
      insertDimension: {
        range: { sheetId: gid, dimension: 'ROWS', startIndex: insertIdx, endIndex: insertIdx + 1 },
        inheritFromBefore: true,
      },
    },
    {
      updateCells: {
        start: { sheetId: gid, rowIndex: insertIdx, columnIndex: 0 },
        rows: [{ values: rowValues.map((v, i) => toUserEnteredCell(v, i)) }],
        fields: 'userEnteredValue',
      },
    },
  ];
  const expected: InsertedRowIdentity = {
    link: storedText(rowValues[8] ?? '').trim(),
    name: storedText(rowValues[4] ?? '').trim(),
    dateKey: parseSheetDate(event.date) ?? (event.dateISO ? parseSheetDate(isoToMonthDay(event.dateISO)) : null),
  };
  return { requests, dateIsRealDate, expected };
}

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function isoToMonthDay(iso: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${MONTH_ABBR[Number(m[1]) - 1]} ${Number(m[2])}` : '';
}

function rowMatchesIdentity(row: string[], expected: InsertedRowIdentity): boolean {
  const cell = (i: number) => (row[i] || '').trim();
  if (expected.link && cell(8) !== expected.link) return false;
  if (cell(4) !== expected.name) return false;
  if (expected.dateKey !== null) {
    const rowDate = parseSheetDate(cell(0));
    if (rowDate !== null && rowDate !== expected.dateKey) return false;
  }
  return true;
}

async function readValues(token: string, sheetName: string, a1: string): Promise<string[][]> {
  const range = encodeURIComponent(`'${sheetName}'!${a1}`);
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to read sheet: ${res.status} ${text}`);
  }
  const data = await res.json();
  return data.values || [];
}

/** The tab's grid row count (metadata), used to positively confirm an
 *  insert added exactly one row. */
async function getGridRowCount(token: string, gid: number): Promise<number | null> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}?fields=sheets(properties(sheetId,gridProperties(rowCount)))`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json();
  const sheets: { properties?: { sheetId?: number; gridProperties?: { rowCount?: number } } }[] = data.sheets || [];
  const count = sheets.find((s) => s.properties?.sheetId === gid)?.properties?.gridProperties?.rowCount;
  return typeof count === 'number' ? count : null;
}

/** 0-based index of the row matching link + name + date, nearest to
 *  `nearIdx`; null when absent. */
async function locateInsertedRow(token: string, sheetName: string, expected: InsertedRowIdentity, nearIdx: number): Promise<number | null> {
  if (!expected.name && !expected.link) return null;
  const rows = await readValues(token, sheetName, 'A1:I');
  let best: number | null = null;
  for (let i = 0; i < rows.length; i++) {
    if (!rowMatchesIdentity(rows[i] ?? [], expected)) continue;
    if (best === null || Math.abs(i - nearIdx) < Math.abs(best - nearIdx)) best = i;
  }
  return best;
}

/**
 * Confirm the inserted row (0-based `insertIdx`) holds our event; returns
 * the 0-based index where it actually is. Never deletes a row unless ALL of:
 * the row at `insertIdx` is fully blank (full width), our event is nowhere
 * on the tab, and the grid grew by exactly one row since before the insert
 * (so the blank row is provably the one we added — never e.g. the separator
 * above "Add Events Here"). That case throws a non-retryable error. Any
 * other unverifiable state throws `SheetInsertUnverifiedError` only when the
 * event is provably absent; otherwise it logs and assumes `insertIdx`.
 */
async function verifyInsertedRow(
  token: string,
  sheetName: string,
  gid: number,
  insertIdx: number,
  expected: InsertedRowIdentity,
  rowCountBefore: number | null
): Promise<number> {
  const insertRow = insertIdx + 1;
  const row = (await readValues(token, sheetName, `A${insertRow}:ZZ${insertRow}`))[0] ?? [];
  if (rowMatchesIdentity(row, expected)) return insertIdx;

  const found = await locateInsertedRow(token, sheetName, expected, insertIdx);
  if (found !== null) {
    console.warn(`[insertEventRowSorted] '${sheetName}': row shifted after insert (expected ${insertRow}, found ${found + 1})`);
    return found;
  }

  const isBlank = row.every((v) => !(v || '').trim());
  if (isBlank && rowCountBefore !== null) {
    const rowCountAfter = await getGridRowCount(token, gid).catch(() => null);
    if (rowCountAfter === rowCountBefore + 1) {
      await deleteSheetRow(gid, insertIdx);
      throw new SheetInsertUnverifiedError(`Insert verification failed on '${sheetName}' row ${insertRow}: inserted row was blank; removed it`);
    }
  }
  console.warn(`[insertEventRowSorted] '${sheetName}': could not verify row ${insertRow}; not deleting anything, treating it as inserted`);
  return insertIdx;
}

/**
 * Find a submitted event row in the review section (below "Add Events Here").
 * Searches by event name (col E, 0-indexed 4) and date (col A, 0-indexed 0).
 * Returns the 0-based row index, or null if not found.
 */
export async function findReviewRow(
  sheetName: string,
  eventName: string,
  eventDate: string
): Promise<number | null> {
  const token = await getAccessToken();
  const range = encodeURIComponent(`'${sheetName}'!A1:M`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to read sheet: ${res.status} ${text}`);
  }

  const data = await res.json();
  const rows: string[][] = data.values || [];

  // Find the "Add Events Here" marker
  let addEventsRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const cellA = (rows[i]?.[0] || '').trim();
    if (cellA.includes('Add Events Here')) {
      addEventsRow = i;
      break;
    }
  }

  if (addEventsRow === -1) return null;

  // Find the review header row (col B = "Start Time") after the marker
  let headerRow = -1;
  for (let i = addEventsRow + 1; i < rows.length; i++) {
    const colB = (rows[i]?.[1] || '').trim().toLowerCase();
    if (colB === 'start time') {
      headerRow = i;
      break;
    }
  }

  if (headerRow === -1) return null;

  // Scan review rows for matching name + date (case-insensitive)
  const targetName = eventName.trim().toLowerCase();
  const targetDate = eventDate.trim().toLowerCase();

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const cellDate = (row[0] || '').trim().toLowerCase();
    const cellName = (row[4] || '').trim().toLowerCase();

    // Skip empty rows
    if (!cellDate && !cellName) continue;

    if (cellName === targetName && cellDate === targetDate) {
      return i; // 0-based row index
    }
  }

  return null;
}

/**
 * Delete a single row from a sheet by 0-based row index.
 * Uses the Sheets batchUpdate API with deleteDimension.
 */
export async function deleteSheetRow(gid: number, rowIndex: number): Promise<void> {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [{
        deleteDimension: {
          range: {
            sheetId: gid,
            dimension: 'ROWS',
            startIndex: rowIndex,
            endIndex: rowIndex + 1,
          },
        },
      }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to delete row: ${res.status} ${text}`);
  }
}
