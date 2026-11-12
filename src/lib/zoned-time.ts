/**
 * Wall-clock helpers for an IANA time zone, built on Intl.DateTimeFormat#formatToParts
 * (never on re-parsing a toLocaleString() string, which is locale/engine dependent).
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock fields in `timeZone` at the instant `date`. */
export function getZonedParts(timeZone: string, date: Date = new Date()): ZonedParts {
  const out: Record<string, number> = {};
  for (const p of getFormatter(timeZone).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    // Some engines render midnight as 24 even with h23.
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * A Date whose *local* fields equal the wall clock in `timeZone`
 * (the "conference now" convention used by the filters).
 */
export function zonedWallClockDate(timeZone: string, date: Date = new Date()): Date {
  const p = getZonedParts(timeZone, date);
  return new Date(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
}

/** 'YYYY-MM-DD' for the calendar day in `timeZone`, offset by whole days. DST-safe (pure calendar math). */
export function zonedDateISO(timeZone: string, date: Date = new Date(), dayOffset = 0): string {
  const p = getZonedParts(timeZone, date);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 'YYYY-MM-DDTHH:mm' in `timeZone`, with minutes floored to a 30 minute slot. */
export function zonedSlotISO(timeZone: string, date: Date = new Date()): string {
  const p = getZonedParts(timeZone, date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${p.minute < 30 ? '00' : '30'}`;
}
