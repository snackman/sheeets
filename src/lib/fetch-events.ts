import { parseGVizResponse, GVizRow, getCellValue, getCellBool } from './gviz';
import { ETHDenverEvent } from './types';
import { SHEET_ID, EVENT_TABS } from './constants';
import { parseDateToISO, getTimeOfDay, isFreeEvent, normalizeAddress } from './utils';
import geocodedData from '@/data/geocoded-addresses.json';

const TAG_ALIASES: Record<string, string> = {
  'Fitness/Wellness': 'Wellness',
};

function parseTags(raw: string): string[] {
  if (!raw) return [];
  return raw.split(',').map((t) => t.trim()).filter(Boolean).map((t) => TAG_ALIASES[t] || t);
}

/**
 * Generate a stable, deterministic event ID from event properties.
 * Uses a simple string hash converted to base36 for short, readable IDs.
 * Format: evt-{hash} e.g. evt-k8f2m9
 */
export function generateEventId(conference: string, date: string, startTime: string, name: string): string {
  const input = `${conference}|${date}|${startTime}|${name}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0; // Convert to 32-bit integer
  }
  // Make positive and convert to base36 for short alphanumeric ID
  const positiveHash = (hash >>> 0).toString(36);
  return `evt-${positiveHash}`;
}

/** Find the header row index (where col B = "Start Time") */
function findHeaderIndex(rows: GVizRow[]): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.c) continue;
    const colB = getCellValue(row.c[1]).toLowerCase().trim();
    if (colB === 'start time') return i;
  }
  return -1;
}

/** Check if a row is empty (no meaningful content in event columns) */
function isEmptyRow(row: GVizRow): boolean {
  if (!row.c) return true;
  const name = getCellValue(row.c[4]);
  const date = getCellValue(row.c[0]);
  const startTime = getCellValue(row.c[1]);
  return !name && !date && !startTime;
}

async function fetchPage(gid: number, offset: number): Promise<string> {
  const tq = encodeURIComponent(`select * limit 500 offset ${offset}`);
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}&headers=1&tq=${tq}`;
  const response = await fetch(url);
  return response.text();
}

export async function fetchEvents(): Promise<ETHDenverEvent[]> {
  const events: ETHDenverEvent[] = [];
  // Track seen IDs to detect collisions (duplicate data in sheet)
  const seenIds = new Map<string, number>();

  for (const tab of EVENT_TABS) {
    // Paginate to get all rows from this tab
    let allRows: GVizRow[] = [];

    for (let offset = 0; offset < 5000; offset += 500) {
      const text = await fetchPage(tab.gid, offset);
      const table = parseGVizResponse(text);
      if (table.rows.length === 0) break;
      allRows = allRows.concat(table.rows);
      if (table.rows.length < 500) break;
    }

    // Find header row, events start right after
    const headerIdx = findHeaderIndex(allRows);
    if (headerIdx === -1) continue;

    let currentDate = '';

    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];

      // Stop at first empty row
      if (isEmptyRow(row)) break;

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

      const rawTags = parseTags(getCellValue(row.c[7]));
      const costVal = getCellValue(row.c[6]);
      const foodBool = getCellBool(row.c[9]);
      const barBool = getCellBool(row.c[10]);

      // Build synthetic tags for cost, food, and bar
      const syntheticTags: string[] = [];
      if (!isFreeEvent(costVal)) {
        syntheticTags.push('$$');
      }
      if (foodBool) syntheticTags.push('🍕 Food');
      if (barBool) syntheticTags.push('🍺 Bar');

      const tags = [...rawTags, ...syntheticTags];

      const address = getCellValue(row.c[5]);
      const geo = address
        ? (geocodedData.addresses as Record<string, { lat: number; lng: number }>)[normalizeAddress(address)]
        : undefined;

      // Generate ID and flag duplicates (same name/date/time = data error)
      let id = generateEventId(tab.name, currentDate, startTime, name);
      const count = seenIds.get(id) ?? 0;
      seenIds.set(id, count + 1);
      const isDuplicate = count > 0;
      if (isDuplicate) id = `${id}-${count}`;

      events.push({
        id,
        isDuplicate,
        date: currentDate,
        dateISO: parseDateToISO(currentDate),
        startTime: isAllDay ? 'All Day' : startTime,
        endTime: endTime || '',
        isAllDay,
        organizer: getCellValue(row.c[3]),
        name,
        address,
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
        lat: geo?.lat,
        lng: geo?.lng,
      });
    }
  }

  return events;
}
