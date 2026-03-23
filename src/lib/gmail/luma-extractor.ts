import { normalizeEmailBody } from './normalize';
import { parseICS } from './ics-parser';
import {
  LUMA_SENDERS,
  LUMA_DOMAINS,
  CONFIDENCE_WEIGHTS,
  CONFIDENCE_PENALTIES,
} from './constants';
import type {
  GmailMessage,
  CandidateEvent,
  LumaMessageType,
  ICSEvent,
} from './types';

/**
 * Extract a candidate Luma event from a Gmail message.
 * Returns null if the message doesn't appear to contain event data.
 */
export function extractLumaEvent(message: GmailMessage): CandidateEvent | null {
  const normalizedBody = message.bodyHtml
    ? normalizeEmailBody(message.bodyHtml)
    : message.bodyText;

  const combinedText = `${message.subject}\n${normalizedBody}`;

  // Parse ICS attachments
  let icsEvent: ICSEvent | null = null;
  for (const attachment of message.attachments) {
    if (
      attachment.mimeType === 'text/calendar' ||
      attachment.filename.endsWith('.ics')
    ) {
      icsEvent = parseICS(attachment.data);
      if (icsEvent) break;
    }
  }

  // Classify message type
  const messageType = classifyMessageType(message.subject, normalizedBody, !!icsEvent);

  // Extract event name (priority: ICS > structured header > subject)
  const eventName = extractEventName(icsEvent, message.subject, normalizedBody);
  if (!eventName) return null;

  // Extract dates
  const { startAt, endAt } = extractDates(icsEvent, normalizedBody);

  // Extract location
  const locationRaw = extractLocation(icsEvent, normalizedBody);

  // Extract Luma event URL
  const eventUrl = extractLumaUrl(combinedText);

  // Determine RSVP status
  const status = inferStatus(messageType, normalizedBody);

  // Generate a dedup key
  const externalEventKey = generateEventKey(eventUrl, icsEvent, eventName, startAt);

  // Compute confidence score
  const parseConfidence = computeConfidence(message.from, icsEvent, eventName, startAt, locationRaw);

  return {
    externalEventKey,
    eventName,
    eventStartAt: startAt,
    eventEndAt: endAt,
    locationRaw,
    eventUrl,
    status,
    parseConfidence,
    messageType,
    source: {
      gmailMessageId: message.id,
      gmailThreadId: message.threadId,
      sender: message.from,
      subject: message.subject,
      receivedAt: message.date,
      hadIcs: !!icsEvent,
    },
  };
}

/** Classify the type of Luma email */
function classifyMessageType(
  subject: string,
  body: string,
  hasIcs: boolean
): LumaMessageType {
  const text = `${subject}\n${body}`.toLowerCase();

  if (hasIcs) return 'calendar_invite';
  if (/cancel{1,2}ed|event cancel/i.test(text)) return 'cancellation';
  if (/waitlist|wait list|waiting list/i.test(text)) return 'waitlist';
  if (/\bapproved\b|you['']?re approved|application accepted/i.test(text)) return 'approval';
  if (/you['']?re going|you['']?re in|rsvp confirmed|registration confirmed|successfully registered/i.test(text)) return 'rsvp_confirmation';
  if (/starts? soon|tomorrow|reminder|don['']?t forget|happening/i.test(text)) return 'reminder';

  return 'unknown';
}

/** Extract event name with priority: ICS SUMMARY > structured header > subject */
function extractEventName(
  icsEvent: ICSEvent | null,
  subject: string,
  body: string
): string | null {
  // 1. ICS SUMMARY
  if (icsEvent?.summary) return icsEvent.summary.trim();

  // 2. Look for a prominent event name in the body
  // Luma emails often have the event name as a standalone line near the top
  const bodyLines = body.split('\n').filter((l) => l.trim());
  for (let i = 0; i < Math.min(bodyLines.length, 10); i++) {
    const line = bodyLines[i].trim();
    // Skip common header/footer patterns
    if (
      line.length > 10 &&
      line.length < 200 &&
      !/^(hi |hey |hello |dear |from:|to:|date:|subject:)/i.test(line) &&
      !/unsubscribe|privacy|terms|view in browser/i.test(line) &&
      !/^\d+\s*(event|ticket|attendee)/i.test(line)
    ) {
      // Check if it looks like a title (often preceded by confirmation text)
      if (i > 0 && /rsvp|approved|confirmed|going|registered/i.test(bodyLines[i - 1])) {
        return line;
      }
    }
  }

  // 3. Extract from subject line (remove common prefixes)
  if (subject) {
    let cleaned = subject
      .replace(/^(re:\s*|fwd:\s*|fw:\s*)/gi, '')
      .replace(/^(you['']?re going to |you['']?re approved for |reminder:\s*|rsvp confirmed:\s*)/gi, '')
      .replace(/\s*\|.*$/, '') // Remove " | Luma" suffix
      .replace(/\s*[-–—]\s*luma$/i, '')
      .trim();

    if (cleaned) return cleaned;
  }

  return null;
}

/** Extract event dates */
function extractDates(
  icsEvent: ICSEvent | null,
  body: string
): { startAt: string | null; endAt: string | null } {
  // 1. ICS dates
  if (icsEvent?.dtstart) {
    return {
      startAt: icsEvent.dtstart,
      endAt: icsEvent.dtend || null,
    };
  }

  // 2. Try to find date patterns in body
  // Match common date formats: "March 15, 2026", "Mar 15, 2026", "2026-03-15", "15 March 2026"
  const datePatterns = [
    // "March 15, 2026 at 7:00 PM" or "March 15, 2026, 7:00 PM"
    /(\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}(?:\s*(?:at|,)\s*\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/i,
    // "Mar 15, 2026"
    /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i,
    // "15 March 2026"
    /(\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/i,
    // ISO format
    /(\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?)/,
  ];

  for (const pattern of datePatterns) {
    const match = body.match(pattern);
    if (match) {
      const dateStr = match[1];
      try {
        const parsed = new Date(dateStr);
        if (!isNaN(parsed.getTime())) {
          return { startAt: parsed.toISOString(), endAt: null };
        }
      } catch {
        // Skip invalid dates
      }
    }
  }

  return { startAt: null, endAt: null };
}

/** Extract location from ICS or email body */
function extractLocation(
  icsEvent: ICSEvent | null,
  body: string
): string | null {
  // 1. ICS LOCATION
  if (icsEvent?.location) return icsEvent.location.trim();

  // 2. Look for location patterns in body
  const locationPatterns = [
    // "Location: ..." or "Where: ..." or "Venue: ..." on a line
    /(?:location|where|venue|address)\s*[:]\s*(.+)/i,
    // "📍 Address" or "📍Address"
    /\u{1F4CD}\s*(.+)/u,
    // Google Maps link text
    /(?:google\.com\/maps|maps\.google\.com)[^\s)]+/i,
  ];

  const lines = body.split('\n');
  for (const line of lines) {
    for (const pattern of locationPatterns) {
      const match = line.match(pattern);
      if (match) {
        const loc = match[1]?.trim();
        if (loc && loc.length > 3 && loc.length < 300) {
          return loc;
        }
      }
    }
  }

  return null;
}

/** Extract a Luma event URL from text */
function extractLumaUrl(text: string): string | null {
  // Match lu.ma URLs
  const lumaUrlPattern = /https?:\/\/lu\.ma\/[^\s)>"',]+/i;
  const match = text.match(lumaUrlPattern);
  if (match) return match[0].replace(/[.,;!?]+$/, ''); // Strip trailing punctuation

  // Also check for luma.email tracking links
  const lumaTrackingPattern = /https?:\/\/[^\s]*luma[^\s]*\/[^\s)>"',]+/i;
  const trackingMatch = text.match(lumaTrackingPattern);
  if (trackingMatch) return trackingMatch[0].replace(/[.,;!?]+$/, '');

  return null;
}

/** Infer RSVP status from message type and content */
function inferStatus(
  messageType: LumaMessageType,
  body: string
): 'approved' | 'rsvp' | 'waitlist' | 'unknown' {
  if (messageType === 'approval') return 'approved';
  if (messageType === 'rsvp_confirmation') return 'rsvp';
  if (messageType === 'waitlist') return 'waitlist';

  const lower = body.toLowerCase();
  if (/\bapproved\b/.test(lower)) return 'approved';
  if (/\brsvp|registered|confirmed\b/.test(lower)) return 'rsvp';
  if (/\bwaitlist\b/.test(lower)) return 'waitlist';

  return 'unknown';
}

/** Generate a dedup key for an event */
function generateEventKey(
  eventUrl: string | null,
  icsEvent: ICSEvent | null,
  eventName: string | null,
  startAt: string | null
): string {
  // Prefer Luma URL as the most unique identifier
  if (eventUrl) {
    // Normalize: strip tracking params, lowercase
    const url = new URL(eventUrl);
    return `luma:${url.pathname.toLowerCase()}`;
  }

  // ICS UID
  if (icsEvent?.uid) return `ics:${icsEvent.uid}`;

  // Fallback: name + date
  const nameSlug = (eventName || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .substring(0, 60);
  const dateSlug = startAt
    ? new Date(startAt).toISOString().substring(0, 10)
    : 'nodate';
  return `derived:${nameSlug}:${dateSlug}`;
}

/** Compute confidence score for a parsed event */
function computeConfidence(
  sender: string,
  icsEvent: ICSEvent | null,
  eventName: string | null,
  startAt: string | null,
  location: string | null
): number {
  let confidence = 0;

  // Known sender check
  const senderLower = sender.toLowerCase();
  const isKnownSender =
    LUMA_SENDERS.some((s) => senderLower.includes(s)) ||
    LUMA_DOMAINS.some((d) => senderLower.includes(d));

  if (isKnownSender) {
    confidence += CONFIDENCE_WEIGHTS.KNOWN_SENDER;
  } else {
    confidence += CONFIDENCE_PENALTIES.UNKNOWN_SENDER;
  }

  // ICS parsed
  if (icsEvent) {
    confidence += CONFIDENCE_WEIGHTS.ICS_PARSED;
  }

  // Event name
  if (eventName) {
    confidence += CONFIDENCE_WEIGHTS.EVENT_NAME_FOUND;
  } else {
    confidence += CONFIDENCE_PENALTIES.MISSING_TITLE;
  }

  // Date found
  if (startAt) {
    confidence += CONFIDENCE_WEIGHTS.DATE_FOUND;
  }

  // Location found
  if (location) {
    confidence += CONFIDENCE_WEIGHTS.LOCATION_FOUND;
  }

  // Clamp between 0 and 1
  return Math.max(0, Math.min(1, confidence));
}
