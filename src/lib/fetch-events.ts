import { parseGVizResponse, getCellValue, getCellBool } from './gviz';
import { ETHDenverEvent } from './types';
import { SHEET_ID, EVENT_TABS } from './constants';
import { parseDateToISO, getTimeOfDay, isFreeEvent } from './utils';

const BOGUS_NAMES = new Set([
  'event', 'event name', 'events', 'start', 'end', 'link', 'count',
  'time', 'start time', 'end time', 'date', 'organizer', 'vibe',
  'cost', 'food', 'bar', 'note', 'address', 'header', 'tags',
]);

function isBogusEvent(name: string): boolean {
  return BOGUS_NAMES.has(name.toLowerCase().trim());
}

function parseTags(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

async function fetchPage(gid: number, offset: number): Promise<string> {
  const tq = encodeURIComponent(`select * limit 500 offset ${offset}`);
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}&headers=1&tq=${tq}`;
  const response = await fetch(url);
  return response.text();
}

export async function fetchEvents(): Promise<ETHDenverEvent[]> {
  const events: ETHDenverEvent[] = [];
  let eventIndex = 0;

  for (const tab of EVENT_TABS) {
    // Paginate to get all rows from this tab
    let allRows: ReturnType<typeof parseGVizResponse>['rows'] = [];

    for (let offset = 0; offset < 5000; offset += 500) {
      const text = await fetchPage(tab.gid, offset);
      const table = parseGVizResponse(text);
      if (table.rows.length === 0) break;
      allRows = allRows.concat(table.rows);
      if (table.rows.length < 500) break;
    }

    let currentDate = '';

    for (const row of allRows) {
      if (!row.c) continue;

      // Column A: Date - may be set for first event of a day, then blank for subsequent
      const dateVal = getCellValue(row.c[0]);
      if (dateVal) currentDate = dateVal;

      // Column E: Event Name - required
      const name = getCellValue(row.c[4]);
      if (!name || isBogusEvent(name)) continue;

      const startTime = getCellValue(row.c[1]);
      const endTime = getCellValue(row.c[2]);
      const cost = getCellValue(row.c[6]);
      const isAllDay = !startTime || startTime.toLowerCase().includes('all day');

      // Skip if start time looks like a header value
      if (startTime.toLowerCase() === 'start time') continue;

      const tags = parseTags(getCellValue(row.c[7]));

      events.push({
        id: `event-${eventIndex++}`,
        date: currentDate,
        dateISO: parseDateToISO(currentDate),
        startTime: isAllDay ? 'All Day' : startTime,
        endTime: endTime || '',
        isAllDay,
        organizer: getCellValue(row.c[3]),
        name,
        address: getCellValue(row.c[5]),
        cost,
        isFree: isFreeEvent(cost),
        vibe: tags[0] || '',
        tags,
        conference: tab.name,
        link: getCellValue(row.c[8]),
        hasFood: getCellBool(row.c[9]),
        hasBar: getCellBool(row.c[10]),
        note: getCellValue(row.c[11]),
        timeOfDay: isAllDay ? 'all-day' : getTimeOfDay(startTime),
      });
    }
  }

  return events;
}
