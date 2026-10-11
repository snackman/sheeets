// Build a `NormalizedEvent` (§5.1) from a parsed Luma iCal VEVENT, optionally
// enriched with the full Luma event payload (`fetchLumaEvent`). Phase 1b only
// has one source (Luma iCal), but this module's shape is source-agnostic so
// later phases (Telegram/X links, sponsor pages) can reuse it.
import { createHash } from 'node:crypto';
import { formatCost } from '../event-format';
import { sheetDateShort, sheetDateShortFromISODate, sheetTime12Hour } from '../event-format';
import { extractMirrorText, normalizeHandle, type LumaEventPayload } from '../luma';
import type { VEvent } from './ical';
import type { NormalizedEvent } from './types';

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Content hash (§5.5 "re-classify only when content_hash changes"): name +
 *  description + hosts + date. Anything else changing (e.g. a typo fix in
 *  the venue) doesn't need a fresh LLM call. */
export function computeContentHash(event: Pick<NormalizedEvent, 'name' | 'descriptionText' | 'dateISO'> & { hosts: { name: string }[] }): string {
  const hostsKey = event.hosts.map((h) => h.name.toLowerCase()).sort().join(',');
  return sha256Hex(`${event.name.trim().toLowerCase()}|${event.descriptionText.trim().toLowerCase()}|${hostsKey}|${event.dateISO}`);
}

export interface NormalizeLumaOptions {
  vevent: VEvent;
  timezone: string;
  /** Full Luma event payload, if enrichment succeeded (§5.1, §5.3). */
  enrichment?: LumaEventPayload | null;
  calendar?: { apiId: string; name: string } | null;
  /** Fallback slug parsed from the iCal DESCRIPTION stub, used only to build
   *  a canonical link when enrichment didn't return one. */
  fallbackSlug?: string | null;
}

function priceCentsFromTicketTypes(payload: LumaEventPayload): number | null {
  const types = (payload as { ticket_types?: { cost?: number | null; price?: number | null }[] }).ticket_types;
  if (!types || types.length === 0) return null;
  const prices = types.map((t) => (typeof t.cost === 'number' ? t.cost : typeof t.price === 'number' ? t.price : null));
  const numeric = prices.filter((p): p is number => p !== null);
  if (numeric.length === 0) return null;
  return Math.min(...numeric);
}

/** Normalize a Luma iCal VEVENT (optionally enriched) into a `NormalizedEvent`. */
export function normalizeLumaEvent(opts: NormalizeLumaOptions): NormalizedEvent {
  const { vevent, timezone, enrichment, calendar } = opts;

  const name = (enrichment?.event?.name || vevent.summary || '').trim();
  const isAllDay = vevent.dtstartIsDateOnly;
  const startAt = isAllDay ? `${vevent.dtstart}T00:00:00.000Z` : vevent.dtstart;
  const endAt = vevent.dtend ?? null;

  const dateISO = isAllDay ? vevent.dtstart : startAt.slice(0, 10);
  const sheetDate = isAllDay ? sheetDateShortFromISODate(vevent.dtstart) : sheetDateShort(startAt, timezone);
  const startTime = isAllDay ? 'All Day' : sheetTime12Hour(startAt, timezone);
  const endTime = !isAllDay && endAt ? sheetTime12Hour(endAt, timezone) : '';

  const hosts = (enrichment?.hosts ?? [])
    .filter((h) => h && typeof h.api_id === 'string')
    .map((h) => ({
      apiId: h.api_id,
      name: h.name || h.username || h.api_id,
      username: h.username ?? null,
      twitter: normalizeHandle(h.twitter_handle),
    }));

  const organizer = hosts[0]?.name || calendar?.name || '';

  const descriptionFromMirror = enrichment?.description_mirror ? extractMirrorText(enrichment.description_mirror) : '';
  const descriptionFromIcal = vevent.description || '';
  const descriptionText = (descriptionFromMirror || descriptionFromIcal).slice(0, 4000);

  const priceCents = enrichment ? priceCentsFromTicketTypes(enrichment) : null;
  const cost = priceCents !== null ? formatCost(priceCents) : 'Free';

  const apiId = enrichment?.event?.api_id || enrichment?.api_id || null;
  const link = apiId
    ? `https://luma.com/event/${apiId}`
    : vevent.location || (opts.fallbackSlug ? `https://luma.com/${opts.fallbackSlug}` : '');

  const geo = vevent.geo;

  return {
    name,
    startAt,
    endAt,
    timezone,
    dateISO,
    sheetDate,
    startTime,
    endTime,
    address: '', // Luma's payload doesn't expose a plain address string reliably; geo is used for the radius filter instead.
    lat: geo?.lat ?? null,
    lng: geo?.lng ?? null,
    isOnline: !geo && !vevent.location,
    organizer,
    hosts,
    calendar: calendar ?? null,
    cost,
    link,
    descriptionText,
    imageUrl: null,
    platform: 'luma',
  };
}
