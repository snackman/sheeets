import type { ETHDenverEvent } from './types';

function parseTime(t: string): { hour: number; minute: number } | null {
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

function toCalendarDateTime(dateISO: string, time: { hour: number; minute: number }): string {
  const date = dateISO.replace(/-/g, '');
  const h = time.hour.toString().padStart(2, '0');
  const m = time.minute.toString().padStart(2, '0');
  return `${date}T${h}${m}00`;
}

export function getGoogleCalendarUrl(event: ETHDenverEvent): string {
  const params = new URLSearchParams();
  params.set('action', 'TEMPLATE');
  params.set('text', event.name);

  if (event.isAllDay && event.dateISO) {
    const start = event.dateISO.replace(/-/g, '');
    const nextDay = new Date(event.dateISO);
    nextDay.setDate(nextDay.getDate() + 1);
    const end = nextDay.toISOString().slice(0, 10).replace(/-/g, '');
    params.set('dates', `${start}/${end}`);
  } else if (event.dateISO) {
    const startTime = parseTime(event.startTime);
    if (startTime) {
      const start = toCalendarDateTime(event.dateISO, startTime);
      const endTime = parseTime(event.endTime);
      const end = endTime
        ? toCalendarDateTime(event.dateISO, endTime)
        : toCalendarDateTime(event.dateISO, { hour: startTime.hour + 1, minute: startTime.minute });
      params.set('dates', `${start}/${end}`);
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

export function generateICS(events: ETHDenverEvent[]): string {
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
      const nextDay = new Date(event.dateISO);
      nextDay.setDate(nextDay.getDate() + 1);
      lines.push(`DTEND;VALUE=DATE:${nextDay.toISOString().slice(0, 10).replace(/-/g, '')}`);
    } else if (event.dateISO) {
      const startTime = parseTime(event.startTime);
      if (startTime) {
        lines.push(`DTSTART:${toCalendarDateTime(event.dateISO, startTime)}`);
        const endTime = parseTime(event.endTime);
        const end = endTime
          ? toCalendarDateTime(event.dateISO, endTime)
          : toCalendarDateTime(event.dateISO, { hour: startTime.hour + 1, minute: startTime.minute });
        lines.push(`DTEND:${end}`);
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

export function downloadICS(events: ETHDenverEvent[], filename = 'sheeets-itinerary.ics') {
  const content = generateICS(events);
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
