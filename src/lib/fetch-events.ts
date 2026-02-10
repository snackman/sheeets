import { parseGVizResponse, getCellValue, getCellBool } from './gviz';
import { ETHDenverEvent } from './types';
import { GVIZ_URL } from './constants';
import { parseDateToISO, getTimeOfDay, isFreeEvent } from './utils';

export async function fetchEvents(): Promise<ETHDenverEvent[]> {
  const response = await fetch(GVIZ_URL);
  const text = await response.text();
  const table = parseGVizResponse(text);

  let currentDate = '';
  const events: ETHDenverEvent[] = [];
  let eventIndex = 0;

  for (const row of table.rows) {
    if (!row.c) continue;

    // Column A: Date - may be set for first event of a day, then blank for subsequent
    const dateVal = getCellValue(row.c[0]);
    if (dateVal) currentDate = dateVal;

    // Column E: Event Name - required
    const name = getCellValue(row.c[4]);
    if (!name) continue;

    const startTime = getCellValue(row.c[1]);
    const endTime = getCellValue(row.c[2]);
    const cost = getCellValue(row.c[6]);
    const isAllDay = !startTime || startTime.toLowerCase().includes('all day');

    events.push({
      id: `event-${eventIndex++}`,
      date: currentDate,
      dateISO: parseDateToISO(currentDate),
      startTime: isAllDay ? 'All Day' : startTime,
      endTime: endTime,
      isAllDay,
      organizer: getCellValue(row.c[3]),
      name,
      address: getCellValue(row.c[5]),
      cost,
      isFree: isFreeEvent(cost),
      vibe: getCellValue(row.c[7]),
      link: getCellValue(row.c[8]),
      hasFood: getCellBool(row.c[9]),
      hasBar: getCellBool(row.c[10]),
      note: getCellValue(row.c[11]),
      timeOfDay: isAllDay ? 'all-day' : getTimeOfDay(startTime),
    });
  }

  return events;
}
