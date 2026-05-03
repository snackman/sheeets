/**
 * Server-side utility for inserting events into Google Calendar via REST API.
 * Uses raw fetch — no googleapis npm package needed.
 */

import type { ETHDenverEvent } from './types';
import { parseTime } from './calendar';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface GoogleCalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end: { dateTime?: string; date?: string; timeZone?: string };
  source?: { title: string; url: string };
}

export interface InsertResult {
  inserted: number;
  failed: number;
  errors: Array<{ eventName: string; error: string }>;
}

/**
 * Build a Google Calendar event object from an ETHDenverEvent.
 */
export function buildCalendarEvent(
  event: ETHDenverEvent,
  timezone: string
): GoogleCalendarEvent {
  const calEvent: GoogleCalendarEvent = {
    summary: event.name,
    start: {},
    end: {},
  };

  // Description
  const details: string[] = [];
  if (event.organizer) details.push(`Organized by: ${event.organizer}`);
  if (event.link) details.push(`RSVP: ${event.link}`);
  if (event.cost && !event.isFree) details.push(`Cost: ${event.cost}`);
  if (event.isFree) details.push('Free event');
  if (event.tags?.length) details.push(`Tags: ${event.tags.join(', ')}`);
  if (details.length > 0) calEvent.description = details.join('\n');

  // Location
  if (event.address) calEvent.location = event.address;

  // Source link
  if (event.link) {
    calEvent.source = { title: 'RSVP', url: event.link };
  }

  // Date/time handling
  if (event.isAllDay && event.dateISO) {
    // All-day event: use date-only format
    calEvent.start = { date: event.dateISO };
    const nextDay = new Date(event.dateISO + 'T00:00:00');
    nextDay.setDate(nextDay.getDate() + 1);
    calEvent.end = { date: nextDay.toISOString().slice(0, 10) };
  } else if (event.dateISO) {
    const startTime = parseTime(event.startTime);
    if (startTime) {
      const startISO = formatDateTime(event.dateISO, startTime);
      calEvent.start = { dateTime: startISO, timeZone: timezone };

      const endTime = parseTime(event.endTime);
      const endParsed = endTime || {
        hour: startTime.hour + 1,
        minute: startTime.minute,
      };
      const endISO = formatDateTime(event.dateISO, endParsed);
      calEvent.end = { dateTime: endISO, timeZone: timezone };
    } else {
      // No parseable start time — treat as all-day
      calEvent.start = { date: event.dateISO };
      const nextDay = new Date(event.dateISO + 'T00:00:00');
      nextDay.setDate(nextDay.getDate() + 1);
      calEvent.end = { date: nextDay.toISOString().slice(0, 10) };
    }
  }

  return calEvent;
}

/**
 * Format a dateISO + time into an ISO 8601 datetime string (without timezone offset).
 * Google Calendar will interpret using the provided timeZone.
 */
function formatDateTime(
  dateISO: string,
  time: { hour: number; minute: number }
): string {
  const h = time.hour.toString().padStart(2, '0');
  const m = time.minute.toString().padStart(2, '0');
  return `${dateISO}T${h}:${m}:00`;
}

/**
 * Insert multiple events into the user's primary Google Calendar.
 * Processes events sequentially to avoid rate limits.
 */
export async function insertEvents(
  accessToken: string,
  events: ETHDenverEvent[],
  timezone: string
): Promise<InsertResult> {
  const result: InsertResult = { inserted: 0, failed: 0, errors: [] };

  for (const event of events) {
    const calEvent = buildCalendarEvent(event, timezone);

    try {
      const response = await fetch(CALENDAR_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(calEvent),
      });

      if (response.ok) {
        result.inserted++;
      } else if (response.status === 429) {
        // Rate limited — wait and retry once
        await delay(1000);
        const retry = await fetch(CALENDAR_API, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(calEvent),
        });

        if (retry.ok) {
          result.inserted++;
        } else {
          const errorBody = await retry.text().catch(() => 'Unknown error');
          result.failed++;
          result.errors.push({ eventName: event.name, error: `Rate limited: ${errorBody}` });
        }
      } else {
        const errorBody = await response.text().catch(() => 'Unknown error');
        result.failed++;
        result.errors.push({
          eventName: event.name,
          error: `HTTP ${response.status}: ${errorBody}`,
        });
      }
    } catch (err) {
      result.failed++;
      result.errors.push({
        eventName: event.name,
        error: err instanceof Error ? err.message : 'Network error',
      });
    }
  }

  return result;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
