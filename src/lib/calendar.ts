import type { ETHDenverEvent } from './types';

export function parseTime(t: string): { hour: number; minute: number } | null {
  if (!t) return null;
  const normalized = t.toLowerCase().trim();
  if (normalized === 'all day' || normalized === 'tbd') return null;

  const match = normalized.match(/(\d{1,2}):?(\d{2})?\s*(am?|pm?)?/i);
  if (!match) return null;

  let hour = parseInt(match[1]);
  const minute = match[2] ? parseInt(match[2]) : 0;
  const isPM = match[3] && match[3].startsWith('p');
  const isAM = match[3] && match[3].startsWith('a');

  if (isPM && hour !== 12) hour += 12;
  if (isAM && hour === 12) hour = 0;

  return { hour, minute };
}

export function toCalendarDateTime(dateISO: string, time: { hour: number; minute: number }): string {
  const date = dateISO.replace(/-/g, '');
  const h = time.hour.toString().padStart(2, '0');
  const m = time.minute.toString().padStart(2, '0');
  return `${date}T${h}${m}00`;
}

/** Add whole days to a YYYY-MM-DD string (pure UTC math, no local-tz drift). */
export function addDaysISO(dateISO: string, days: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

interface LocalDateTime {
  dateISO: string;
  hour: number;
  minute: number;
}

/**
 * Resolve an event's local start/end wall-clock times. An end at or before the
 * start (overnight events) rolls to the next day; a missing end defaults to
 * start + 1h, rolling over midnight properly (never hour 24).
 */
export function resolveEventRange(
  dateISO: string,
  startTime: { hour: number; minute: number },
  endTime: { hour: number; minute: number } | null,
): { start: LocalDateTime; end: LocalDateTime } {
  const startMin = startTime.hour * 60 + startTime.minute;
  let endMin = endTime ? endTime.hour * 60 + endTime.minute : startMin + 60;
  if (endTime && endMin <= startMin) endMin += 24 * 60;
  const dayOffset = Math.floor(endMin / (24 * 60));
  const inDay = endMin % (24 * 60);
  return {
    start: { dateISO, ...startTime },
    end: { dateISO: addDaysISO(dateISO, dayOffset), hour: Math.floor(inDay / 60), minute: inDay % 60 },
  };
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convert a wall-clock time in an IANA zone to a UTC Date. */
export function zonedToUtc(dt: LocalDateTime, timeZone: string): Date {
  const [y, m, d] = dt.dateISO.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, dt.hour, dt.minute);
  let utc = guess - tzOffsetMs(guess, timeZone);
  // Second pass settles times near a DST transition.
  utc = guess - tzOffsetMs(utc, timeZone);
  return new Date(utc);
}

function isValidTimeZone(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * `timeZone` is the conference's IANA zone (e.g. Asia/Kolkata). Pass it so the
 * link carries `ctz=` and the times land at the right moment for any viewer.
 */
export function getGoogleCalendarUrl(event: ETHDenverEvent, timeZone?: string): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.name);

  if (event.isAllDay && event.dateISO) {
    const start = event.dateISO.replace(/-/g, '');
    const end = addDaysISO(event.dateISO, 1).replace(/-/g, '');
    params.set('dates', `${start}/${end}`);
  } else if (event.dateISO) {
    const startTime = parseTime(event.startTime);
    if (startTime) {
      const { start, end } = resolveEventRange(event.dateISO, startTime, parseTime(event.endTime));
      params.set('dates', `${toCalendarDateTime(start.dateISO, start)}/${toCalendarDateTime(end.dateISO, end)}`);
      if (isValidTimeZone(timeZone)) params.set('ctz', timeZone);
    }
  }

  if (event.address) params.set('location', event.address);

  const details: string[] = [];
  if (event.organizer) details.push(`Organized by: ${event.organizer}`);
  if (event.link) details.push(`RSVP: ${event.link}`);
  if (event.cost && !event.isFree) details.push(`Cost: ${event.cost}`);
  if (event.isFree) details.push('Free event');
  if (details.length > 0) params.set('details', details.join('\n'));

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function escapeICS(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function generateICS(events: ETHDenverEvent[], timeZone?: string): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//sheeets.xyz//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`SUMMARY:${escapeICS(event.name)}`);
    lines.push(`UID:${event.id}@sheeets.xyz`);
    lines.push(`DTSTAMP:${formatICSDate(new Date())}`);

    if (event.isAllDay && event.dateISO) {
      lines.push(`DTSTART;VALUE=DATE:${event.dateISO.replace(/-/g, '')}`);
      lines.push(`DTEND;VALUE=DATE:${addDaysISO(event.dateISO, 1).replace(/-/g, '')}`);
    } else if (event.dateISO) {
      const startTime = parseTime(event.startTime);
      if (startTime) {
        const { start, end } = resolveEventRange(event.dateISO, startTime, parseTime(event.endTime));
        if (isValidTimeZone(timeZone)) {
          // UTC with Z: unambiguous for every calendar app.
          lines.push(`DTSTART:${formatICSDate(zonedToUtc(start, timeZone))}`);
          lines.push(`DTEND:${formatICSDate(zonedToUtc(end, timeZone))}`);
        } else {
          // No zone known: floating local time (legacy behaviour).
          lines.push(`DTSTART:${toCalendarDateTime(start.dateISO, start)}`);
          lines.push(`DTEND:${toCalendarDateTime(end.dateISO, end)}`);
        }
      }
    }

    if (event.address) lines.push(`LOCATION:${escapeICS(event.address)}`);

    const desc: string[] = [];
    if (event.organizer) desc.push(`Organized by: ${event.organizer}`);
    if (event.link) desc.push(`RSVP: ${event.link}`);
    if (desc.length > 0) lines.push(`DESCRIPTION:${escapeICS(desc.join('\\n'))}`);

    if (event.link) lines.push(`URL:${event.link}`);

    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function downloadICS(events: ETHDenverEvent[], filename = 'plan-wtf-itinerary.ics', timeZone?: string) {
  const content = generateICS(events, timeZone);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
