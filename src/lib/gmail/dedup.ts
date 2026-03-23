import type { CandidateEvent, DeduplicatedEvent } from './types';

/**
 * Deduplicate candidate events from multiple emails into canonical records.
 * Groups by external_event_key and merges fields using best-available data.
 */
export function deduplicateEvents(
  candidates: CandidateEvent[]
): DeduplicatedEvent[] {
  const groups = new Map<string, CandidateEvent[]>();

  for (const candidate of candidates) {
    const key = candidate.externalEventKey;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(candidate);
  }

  const deduped: DeduplicatedEvent[] = [];

  for (const [key, group] of groups) {
    // Also check for fuzzy matches within the remaining ungrouped events
    // For now we rely on the key-based grouping which covers URL, ICS UID, and name+date

    const merged = mergeGroup(key, group);
    deduped.push(merged);
  }

  // Sort by event date (newest first), then by confidence
  deduped.sort((a, b) => {
    if (a.eventStartAt && b.eventStartAt) {
      return new Date(b.eventStartAt).getTime() - new Date(a.eventStartAt).getTime();
    }
    if (a.eventStartAt) return -1;
    if (b.eventStartAt) return 1;
    return b.parseConfidence - a.parseConfidence;
  });

  return deduped;
}

/** Merge a group of candidates for the same event into one canonical record */
function mergeGroup(
  key: string,
  group: CandidateEvent[]
): DeduplicatedEvent {
  // Sort by confidence descending so we prefer the best data
  const sorted = [...group].sort((a, b) => b.parseConfidence - a.parseConfidence);

  // Best event name: prefer the longest non-empty name (likely most complete)
  const eventName = sorted
    .map((c) => c.eventName)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || sorted[0].eventName;

  // Best dates: prefer ICS-derived dates (calendar_invite type)
  const withDates = sorted.filter((c) => c.eventStartAt);
  const icsCandidate = withDates.find((c) => c.messageType === 'calendar_invite');
  const bestDateCandidate = icsCandidate || withDates[0] || sorted[0];

  // Best location: prefer the longest location string (most detailed)
  const locationRaw = sorted
    .map((c) => c.locationRaw)
    .filter((l): l is string => !!l)
    .sort((a, b) => b.length - a.length)[0] || null;

  // Best event URL
  const eventUrl = sorted.find((c) => c.eventUrl)?.eventUrl || null;

  // Best status: priority order: approved > rsvp > waitlist > unknown
  const statusPriority: Record<string, number> = {
    approved: 3,
    rsvp: 2,
    waitlist: 1,
    unknown: 0,
  };
  const status = sorted.reduce((best, c) => {
    return (statusPriority[c.status] || 0) > (statusPriority[best] || 0)
      ? c.status
      : best;
  }, sorted[0].status);

  // Highest confidence
  const parseConfidence = Math.max(...sorted.map((c) => c.parseConfidence));

  // Date range
  const receivedDates = sorted
    .map((c) => c.source.receivedAt)
    .filter(Boolean)
    .map((d) => new Date(d).getTime())
    .filter((t) => !isNaN(t));

  const firstSeenAt = receivedDates.length
    ? new Date(Math.min(...receivedDates)).toISOString()
    : new Date().toISOString();

  const lastSeenAt = receivedDates.length
    ? new Date(Math.max(...receivedDates)).toISOString()
    : new Date().toISOString();

  // Collect all source references
  const sources = sorted.map((c) => c.source);
  const messageTypes = [...new Set(sorted.map((c) => c.messageType))];

  return {
    externalEventKey: key,
    eventName,
    eventStartAt: bestDateCandidate.eventStartAt,
    eventEndAt: bestDateCandidate.eventEndAt,
    locationRaw,
    eventUrl,
    status,
    parseConfidence,
    firstSeenAt,
    lastSeenAt,
    sources,
    messageTypes,
  };
}
