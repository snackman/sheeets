import type { ICSEvent } from './types';

/**
 * Parse an ICS (iCalendar) file content and extract event fields.
 * Handles line folding (RFC 5545 Section 3.1) and escaped characters.
 */
export function parseICS(icsContent: string): ICSEvent | null {
  if (!icsContent) return null;

  // Unfold lines: lines starting with a space or tab are continuations
  const unfolded = icsContent.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);

  let inEvent = false;
  const fields: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === 'BEGIN:VEVENT') {
      inEvent = true;
      continue;
    }
    if (trimmed === 'END:VEVENT') {
      break; // Only parse the first VEVENT
    }

    if (!inEvent) continue;

    // Parse property: handle both PROP:VALUE and PROP;PARAMS:VALUE
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const propPart = trimmed.substring(0, colonIdx);
    const value = trimmed.substring(colonIdx + 1);

    // Get the property name (strip parameters like DTSTART;TZID=...)
    const semicolonIdx = propPart.indexOf(';');
    const propName = (semicolonIdx === -1 ? propPart : propPart.substring(0, semicolonIdx)).toUpperCase();

    // Unescape ICS values
    fields[propName] = unescapeICS(value);
  }

  if (!fields.SUMMARY && !fields.DTSTART && !fields.LOCATION) {
    return null; // Not enough data
  }

  return {
    uid: fields.UID || '',
    summary: fields.SUMMARY || '',
    description: fields.DESCRIPTION || '',
    location: fields.LOCATION || '',
    dtstart: parseICSDate(fields.DTSTART || ''),
    dtend: parseICSDate(fields.DTEND || ''),
    url: fields.URL || '',
  };
}

/** Unescape ICS escaped characters */
function unescapeICS(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/**
 * Parse an ICS date string into an ISO 8601 string.
 * Handles formats like:
 * - 20260315T190000Z (UTC)
 * - 20260315T190000 (local)
 * - 20260315 (date only)
 */
function parseICSDate(value: string): string {
  if (!value) return '';

  // Remove any trailing Z for parsing, we'll add it back
  const isUTC = value.endsWith('Z');
  const clean = value.replace('Z', '').trim();

  if (clean.length === 8) {
    // Date only: YYYYMMDD
    const year = clean.substring(0, 4);
    const month = clean.substring(4, 6);
    const day = clean.substring(6, 8);
    return `${year}-${month}-${day}`;
  }

  if (clean.length >= 15) {
    // DateTime: YYYYMMDDTHHMMSS
    const year = clean.substring(0, 4);
    const month = clean.substring(4, 6);
    const day = clean.substring(6, 8);
    const hour = clean.substring(9, 11);
    const minute = clean.substring(11, 13);
    const second = clean.substring(13, 15);
    return `${year}-${month}-${day}T${hour}:${minute}:${second}${isUTC ? 'Z' : ''}`;
  }

  // Fallback: return as-is
  return value;
}
