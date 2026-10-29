// Abbreviations Intl doesn't produce for en-US/en-GB (it falls back to "GMT+x").
const ABBREVIATIONS: Record<string, string> = {
  'Asia/Kolkata': 'IST',
  'Asia/Calcutta': 'IST',
  'Asia/Dubai': 'GST',
  'Asia/Singapore': 'SGT',
  'Asia/Tokyo': 'JST',
  'Asia/Seoul': 'KST',
  'Asia/Bangkok': 'ICT',
  'Asia/Hong_Kong': 'HKT',
};

function part(date: Date, timeZone: string, locale: string, timeZoneName: 'short' | 'shortOffset'): string | undefined {
  return new Intl.DateTimeFormat(locale, { timeZone, timeZoneName })
    .formatToParts(date)
    .find((p) => p.type === 'timeZoneName')?.value;
}

/** "UTC+5:30" / "UTC-7" / "UTC" for an IANA zone at a given moment. */
export function formatUtcOffset(timeZone: string, date: Date = new Date()): string {
  const raw = part(date, timeZone, 'en-US', 'shortOffset') ?? 'GMT';
  const m = raw.match(/^(?:GMT|UTC)([+-]\d{1,2}(?::\d{2})?)?$/);
  return m && m[1] && !/^[+-]0+(?::00)?$/.test(m[1]) ? `UTC${m[1]}` : 'UTC';
}

/**
 * "IST (UTC+5:30)" style label for an IANA time zone, or null if the zone is
 * missing/invalid. Pass a date inside the conference so DST is right.
 */
export function formatTimeZoneLabel(timeZone: string | undefined, date: Date = new Date()): string | null {
  if (!timeZone) return null;
  try {
    const offset = formatUtcOffset(timeZone, date);
    let abbr: string | undefined = ABBREVIATIONS[timeZone];
    if (!abbr) {
      for (const locale of ['en-US', 'en-GB']) {
        const short = part(date, timeZone, locale, 'short');
        if (short && !/^(GMT|UTC)[+-]/.test(short)) {
          abbr = short;
          break;
        }
      }
    }
    return abbr ? `${abbr} (${offset})` : offset;
  } catch {
    return null;
  }
}

/** Label for a conference tab, anchored to its first date (noon UTC) for correct DST. */
export function conferenceTimeZoneLabel(tab: { timezone?: string; dates?: string[] } | undefined): string | null {
  if (!tab?.timezone) return null;
  const first = tab.dates?.[0];
  const anchor = first && /^\d{4}-\d{2}-\d{2}$/.test(first) ? new Date(`${first}T12:00:00Z`) : new Date();
  return formatTimeZoneLabel(tab.timezone, anchor);
}
