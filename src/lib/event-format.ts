// Date/time/cost formatting helpers shared by the event extractors
// (`event-extractors.ts`) and, eventually, the ingestion normalizer.
// Moved verbatim out of `src/app/api/fetch-event/route.ts` — no behavior change.

/** Format an ISO date string as "YYYY-MM-DD" in the given timezone */
export function formatDateISO(isoDate: string, timezone: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '';
    const parts = d.toLocaleDateString('en-CA', { timeZone: timezone }).split('-');
    return parts.join('-');
  } catch {
    return '';
  }
}

/** Format an ISO date string as "HH:mm" (24h) in the given timezone */
export function formatTime24(isoDate: string, timezone: string): string {
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: timezone,
    });
  } catch {
    return '';
  }
}

/** Parse cost from cents integer */
export function formatCost(priceCents: number | null | undefined): string {
  if (!priceCents || priceCents === 0) return 'Free';
  const dollars = priceCents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`;
}

/** Try to guess a timezone from an ISO 8601 offset like "+05:30" or "-06:00".
 *  Returns a representative IANA timezone or the provided default. */
export function guessTimezoneFromOffset(isoDate: string, fallback: string): string {
  // Common offset -> IANA timezone mapping (covers major US/EU/Asia offsets)
  const offsetMap: Record<string, string> = {
    '-12:00': 'Etc/GMT+12',
    '-11:00': 'Pacific/Pago_Pago',
    '-10:00': 'Pacific/Honolulu',
    '-09:00': 'America/Anchorage',
    '-08:00': 'America/Los_Angeles',
    '-07:00': 'America/Denver',
    '-06:00': 'America/Chicago',
    '-05:00': 'America/New_York',
    '-04:00': 'America/Santiago',
    '-03:00': 'America/Sao_Paulo',
    '-02:00': 'Etc/GMT+2',
    '-01:00': 'Atlantic/Azores',
    '+00:00': 'UTC',
    '+01:00': 'Europe/Paris',
    '+02:00': 'Europe/Helsinki',
    '+03:00': 'Europe/Moscow',
    '+04:00': 'Asia/Dubai',
    '+05:00': 'Asia/Karachi',
    '+05:30': 'Asia/Kolkata',
    '+06:00': 'Asia/Dhaka',
    '+07:00': 'Asia/Bangkok',
    '+08:00': 'Asia/Singapore',
    '+09:00': 'Asia/Tokyo',
    '+10:00': 'Australia/Sydney',
    '+11:00': 'Pacific/Guadalcanal',
    '+12:00': 'Pacific/Auckland',
  };

  const m = isoDate.match(/([+-]\d{2}:\d{2})$/);
  if (m) {
    return offsetMap[m[1]] || fallback;
  }
  // Z means UTC
  if (isoDate.endsWith('Z')) return 'UTC';
  return fallback;
}

const SHEET_MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHEET_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Format a UTC ISO instant as the sheet's curated date style in the given
 * timezone, e.g. "Mon, October 5" — matches the live curated tabs' actual
 * cell format (verified against "Token2049 2026"/gid 357353145, whose
 * column A number-format pattern is literally `ddd", "mmmm" "d`). This
 * value is written as plain TEXT (see `forceSheetText` in
 * `google-sheets.ts`), not a real Sheets date value — a real date/time
 * value is what broke `fetchEvents`'s header-row detection for
 * ingest-published tabs (gviz infers the whole column as `date`/`datetime`
 * once any row holds one, which makes the literal "Start Time"/"End Time"
 * header cells in that column come back `null` instead of text).
 * `insertEventRowSorted`'s `parseSheetDate` still parses this format fine.
 */
export function sheetDateShort(isoInstant: string, timezone: string): string {
  const d = new Date(isoInstant);
  if (isNaN(d.getTime())) return '';
  const iso = formatDateISO(isoInstant, timezone); // "YYYY-MM-DD"
  return sheetDateShortFromISODate(iso);
}

/** Same output as `sheetDateShort`, but from an already-local "YYYY-MM-DD"
 *  (no timezone conversion) — for all-day / `VALUE=DATE` events, where
 *  converting through a UTC instant could shift the date by a day. */
export function sheetDateShortFromISODate(isoDate: string): string {
  const [y, m, day] = isoDate.split('-').map(Number);
  if (!y || !m || !day) return '';
  const d = new Date(Date.UTC(y, m - 1, day));
  if (isNaN(d.getTime())) return '';
  const weekday = SHEET_WEEKDAYS[d.getUTCDay()];
  return `${weekday}, ${SHEET_MONTHS_FULL[m - 1]} ${day}`;
}

/**
 * Convert a 24h "HH:mm" string to "6:00p" — matches the live curated tabs'
 * actual time cell text (verified against "Token2049 2026"/gid 357353145,
 * whose Start/End Time columns are plain TEXT, e.g. "9:00a"/"11:30a", not a
 * real Sheets time value). Pulled out of `sheetTime12Hour` (Phase 3,
 * plans/event-ingestion.md §7) so discovery sources that only have a local
 * 24h time string (no UTC instant to re-derive it from — e.g. a Telegram-
 * discovered Eventbrite/Partiful/Meetup/Posh link's `EventResult.startTime24`,
 * already computed by `event-extractors.ts` in the event's own guessed
 * timezone) can reuse the exact same 12h formatting without a UTC instant.
 */
export function time12FromTime24(time24: string): string {
  const [hoursStr, minutes] = time24.split(':');
  if (!minutes) return '';
  const hours = Number(hoursStr);
  if (!Number.isFinite(hours)) return '';
  const period = hours >= 12 ? 'p' : 'a';
  const h12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  return `${h12}:${minutes}${period}`;
}

/**
 * Format a UTC ISO instant as "6:00p" in the given timezone — the curated
 * tabs' plain-text time style (see `time12FromTime24`) applied to a 24h
 * "HH:mm" string.
 */
export function sheetTime12Hour(isoInstant: string, timezone: string): string {
  return time12FromTime24(formatTime24(isoInstant, timezone));
}
