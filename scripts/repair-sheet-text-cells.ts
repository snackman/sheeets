/**
 * One-off repair for the "ingested events invisible on the site" bug.
 *
 * Root cause (see `src/lib/google-sheets.ts#forceSheetText`/
 * `#mainSectionRowValues` and `src/lib/fetch-events.ts#findHeaderIndex` for
 * the full writeup): the ingest publisher used to write Start Time/End Time
 * as plain text like "12:00 PM" under valueInputOption=USER_ENTERED. Sheets
 * parses that as a REAL time value and stores it that way. Once a tab's
 * Start/End Time columns hold even one real time value, gviz (which
 * `fetchEvents` reads) infers the WHOLE column as `datetime` — and then the
 * literal "Start Time"/"End Time" header cells, which can't be coerced to
 * that type, come back as `v: null` with no `f` either. That breaks
 * `findHeaderIndex`, so the whole tab reads as zero events.
 *
 * This script repairs already-written rows in one affected tab:
 *   - Columns B (Start Time) / C (End Time): rewritten as literal TEXT in
 *     the curated format ("9:00a") — valueInputOption=RAW, so Sheets/gviz
 *     can never re-type these cells as a time value again.
 *   - Column A (Date): rewritten as a REAL Sheets date (an unambiguous ISO
 *     value, valueInputOption=USER_ENTERED), with its number format set to
 *     the curated `ddd", "mmmm" "d` pattern (e.g. "Mon, October 5") via a
 *     `spreadsheets.batchUpdate` `repeatCell` request. The curated tabs'
 *     column A IS a real date (verified live against "Token2049 2026"/gid
 *     357353145) — a TEXT value in that date-typed column comes back
 *     `v: null`/`f: null` from gviz, and `fetchEvents`' carry-forward
 *     `currentDate` logic would silently give the row the PREVIOUS row's
 *     date. Column A in the broken Devcon tab is already a real date (the
 *     bug never touched it), just with the wrong number format — writing
 *     the ISO value again is a no-op for rows where it's already correct,
 *     and this script doesn't need to special-case that.
 *
 * It reads with FORMATTED_VALUE (the `readRange` helper's default) so it
 * sees exactly what's displayed ("12:00 PM", "Oct 31"), not a raw
 * date/time serial number.
 *
 * Finding the header: this tab's header row is wherever column E (0-indexed
 * 4) reads "Event Name" (case-insensitive) — the one column that's always
 * a plain string no matter how gviz has typed B/C (see `findHeaderIndex`'s
 * comment in fetch-events.ts for why B/C alone aren't reliable here).
 *
 * Idempotent: re-parses whatever text is currently displayed in each cell
 * (whether it's still the old broken style or already the curated style)
 * and reformats/rewrites it the same way every time, so running this twice
 * is a no-op the second time. A blank cell is left blank (never fabricates
 * a date/time that wasn't there).
 *
 * Usage:
 *   npx tsx scripts/repair-sheet-text-cells.ts --gid <gid> [--dry-run]
 *
 * Required env: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (the conference's
 *   year is looked up from Supabase `admin_config` key "conferences", matched
 *   by gid — the sheet has no year of its own, so there is no other source
 *   of truth for it; e.g. Devcon 8's rows are all 2026).
 *
 * --dry-run prints the planned per-row changes and writes nothing. ALWAYS
 * run with --dry-run first and review the output before running for real.
 */
import { getSheetTitle, readRange, writeValuesBatch, setDateColumnFormat } from '../src/lib/google-sheets';
import { getIngestSupabase } from '../src/lib/ingest/db';
import type { ConferenceConfig } from '../src/lib/types';

const SHEET_MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_LOOKUP: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const SHEET_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseArgs(argv: string[]) {
  const gidIdx = argv.indexOf('--gid');
  if (gidIdx === -1 || !argv[gidIdx + 1]) {
    throw new Error('Usage: npx tsx scripts/repair-sheet-text-cells.ts --gid <gid> [--dry-run]');
  }
  const gid = Number(argv[gidIdx + 1]);
  if (!Number.isFinite(gid)) {
    throw new Error(`--gid must be a number, got "${argv[gidIdx + 1]}"`);
  }
  return { gid, dryRun: argv.includes('--dry-run') };
}

/** Look up the conference's year from Supabase `admin_config.conferences`,
 *  matched by gid — the only source of truth for a sheet tab's year (the
 *  cells themselves never carry one, by design, to stay short). */
async function getConferenceYear(gid: number): Promise<number> {
  const supabase = getIngestSupabase();
  const { data, error } = await supabase
    .from('admin_config')
    .select('value')
    .eq('key', 'conferences')
    .single();

  if (error) throw new Error(`Failed to read admin_config.conferences: ${error.message}`);
  const configs = (data?.value ?? []) as ConferenceConfig[];
  const match = configs.find((c) => c.gid === gid);
  if (!match) {
    throw new Error(
      `No conference config found for gid ${gid} in admin_config.conferences. ` +
      `Known gids: ${configs.map((c) => c.gid).join(', ')}`
    );
  }
  const year = Number(match.startDate.slice(0, 4));
  if (!Number.isFinite(year)) {
    throw new Error(`Could not parse a year out of startDate "${match.startDate}" for gid ${gid}.`);
  }
  return year;
}

/** Find the header row (0-indexed within `rows`) — column E == "Event Name". */
function findHeaderRowIndex(rows: string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const colE = (rows[i]?.[4] || '').trim().toLowerCase();
    if (colE === 'event name') return i;
  }
  return -1;
}

/**
 * Parse a date cell's current display text — either the old broken
 * "Oct 31" style or the already-curated "Mon, October 5" style — into a
 * {month, day} pair. Returns null if it doesn't look like a date at all
 * (leaves ambiguous/garbage cells untouched rather than guessing).
 */
function parseDateCell(raw: string): { month: number; day: number } | null {
  const match = raw.match(/([A-Za-z]+)\s+(\d{1,2})\b/);
  if (!match) return null;
  const month = MONTH_LOOKUP[match[1].slice(0, 3).toLowerCase()];
  if (month === undefined) return null;
  const day = Number(match[2]);
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;
  return { month, day };
}

/** The real ISO date value to write, plus the curated display text it's
 *  expected to render as once `setDateColumnFormat` is applied. */
interface RepairedDate {
  iso: string; // "2026-10-31" — written via USER_ENTERED as a real date
  display: string; // "Sat, October 31" — for logging / idempotency only
}

/** Reformat a date cell given the conference's year (for computing the ISO
 *  value and the weekday). Returns null if the cell is blank, unparseable,
 *  OR already displaying the curated text (no-op — nothing to repair). */
function repairDateCell(raw: string, year: number): RepairedDate | null {
  if (!raw.trim()) return null; // leave blank cells blank
  const parsed = parseDateCell(raw);
  if (!parsed) return null; // not a recognizable date — leave untouched
  const { month, day } = parsed;
  const d = new Date(Date.UTC(year, month, day));
  const weekday = SHEET_WEEKDAYS[d.getUTCDay()];
  const display = `${weekday}, ${SHEET_MONTHS_FULL[month]} ${day}`;
  if (display === raw.trim()) return null; // already correct — no-op
  const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso, display };
}

/**
 * Parse a time cell's current display text — "12:00 PM", "6:00 AM",
 * "12:00p", "All Day", etc. — into minutes since midnight. Returns null for
 * anything that isn't a clock time (so "All Day"/"TBD"/blank are left
 * untouched).
 */
function parseTimeCell(raw: string): number | null {
  const s = raw.trim().toLowerCase();
  if (!s || s === 'all day' || s === 'tbd') return null;
  const match = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm|a|p)$/i);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3].toLowerCase();
  if (period.startsWith('p') && hours !== 12) hours += 12;
  if (period.startsWith('a') && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

/** Reformat a time cell as the curated "9:00a"/"6:00p" text. */
function repairTimeCell(raw: string): string | null {
  if (!raw.trim()) return null; // leave blank cells blank ("All Day" etc. too)
  const minutes = parseTimeCell(raw);
  if (minutes === null) return null; // not a clock time — leave untouched (e.g. "All Day")
  const hours24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const period = hours24 >= 12 ? 'p' : 'a';
  const h12 = hours24 === 0 ? 12 : hours24 > 12 ? hours24 - 12 : hours24;
  const formatted = `${h12}:${String(mins).padStart(2, '0')}${period}`;
  return formatted === raw.trim() ? null : formatted; // no-op if already correct
}

interface RowChange {
  sheetRow: number; // 1-based
  date?: { from: string; to: RepairedDate };
  startTime?: { from: string; to: string };
  endTime?: { from: string; to: string };
}

async function main() {
  const { gid, dryRun } = parseArgs(process.argv.slice(2));

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.');
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const year = await getConferenceYear(gid);
  const sheetName = await getSheetTitle(gid);
  console.log(`Tab "${sheetName}" (gid ${gid}), year ${year}${dryRun ? ' — DRY RUN, nothing will be written' : ''}`);

  const rows = await readRange(sheetName, 'A1:E');
  const headerIdx = findHeaderRowIndex(rows);
  if (headerIdx === -1) {
    throw new Error(`Could not find a header row (column E == "Event Name") in "${sheetName}".`);
  }
  console.log(`Header row found at sheet row ${headerIdx + 1}.`);

  const changes: RowChange[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    const dateRaw = row[0] || '';
    const startRaw = row[1] || '';
    const endRaw = row[2] || '';
    const nameRaw = row[4] || '';

    // Stop at the first fully-empty row (end of the main section) — same
    // convention `insertEventRowSorted`/`fetchEvents` use.
    if (!dateRaw.trim() && !startRaw.trim() && !nameRaw.trim()) break;

    const newDate = repairDateCell(dateRaw, year);
    const newStart = repairTimeCell(startRaw);
    const newEnd = repairTimeCell(endRaw);

    if (newDate === null && newStart === null && newEnd === null) continue;

    const sheetRow = i + 1; // 1-based
    const change: RowChange = { sheetRow };
    if (newDate !== null) change.date = { from: dateRaw, to: newDate };
    if (newStart !== null) change.startTime = { from: startRaw, to: newStart };
    if (newEnd !== null) change.endTime = { from: endRaw, to: newEnd };
    changes.push(change);
  }

  if (changes.length === 0) {
    console.log('No rows need repair — already idempotent/clean.');
    return;
  }

  for (const c of changes) {
    const parts: string[] = [];
    if (c.date) parts.push(`A: "${c.date.from}" -> "${c.date.to.display}" (real date ${c.date.to.iso})`);
    if (c.startTime) parts.push(`B: "${c.startTime.from}" -> "${c.startTime.to}"`);
    if (c.endTime) parts.push(`C: "${c.endTime.from}" -> "${c.endTime.to}"`);
    console.log(`  row ${c.sheetRow}: ${parts.join(', ')}`);
  }
  console.log(`\n${changes.length} row(s) need repair.`);

  const dateRows = changes.filter((c) => c.date);
  if (dateRows.length > 0) {
    console.log(
      `\nAfter repair, column A will be typed "date" (real Sheets dates, curated ` +
      `"${'ddd", "mmmm" "d'}" number format) and columns B/C will stay typed ` +
      `"string" (forced literal text) — matching the curated "Token2049 2026" ` +
      `(gid 357353145) shape [date, string, string, string].`
    );
  }

  if (dryRun) {
    console.log('Dry run — nothing written.');
    return;
  }

  // Column A needs USER_ENTERED (a real date) while B/C need RAW (literal
  // text) — one values.batchUpdate call per valueInputOption, each
  // covering every affected row in one HTTP request. A third
  // spreadsheets.batchUpdate call (also one HTTP request, many `requests`
  // entries) sets column A's curated number format on the rows that got a
  // new date value.
  const dateData = dateRows.map((c) => ({
    range: `'${sheetName}'!A${c.sheetRow}`,
    values: [[c.date!.to.iso]],
  }));
  if (dateData.length > 0) {
    await writeValuesBatch(dateData, 'USER_ENTERED');
  }

  const timeData = changes
    .filter((c) => c.startTime || c.endTime)
    .map((c) => {
      const row = rows[c.sheetRow - 1] || [];
      const startTime = c.startTime ? c.startTime.to : (row[1] || '');
      const endTime = c.endTime ? c.endTime.to : (row[2] || '');
      return {
        range: `'${sheetName}'!B${c.sheetRow}:C${c.sheetRow}`,
        values: [[startTime, endTime]],
      };
    });
  if (timeData.length > 0) {
    await writeValuesBatch(timeData, 'RAW');
  }

  if (dateRows.length > 0) {
    await setDateColumnFormat(gid, dateRows.map((c) => c.sheetRow - 1));
  }

  console.log(`Repaired ${changes.length} row(s) in "${sheetName}".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
