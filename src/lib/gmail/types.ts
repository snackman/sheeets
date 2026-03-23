/** Represents a normalized Gmail message ready for parsing */
export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  bodyText: string;
  bodyHtml: string;
  attachments: GmailAttachment[];
}

/** A decoded attachment from a Gmail message */
export interface GmailAttachment {
  filename: string;
  mimeType: string;
  data: string; // decoded content
}

/** Parsed fields from an ICS calendar attachment */
export interface ICSEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  dtstart: string;
  dtend: string;
  url: string;
}

/** Message type classification for Luma emails */
export type LumaMessageType =
  | 'rsvp_confirmation'
  | 'approval'
  | 'reminder'
  | 'calendar_invite'
  | 'waitlist'
  | 'cancellation'
  | 'unknown';

/** A candidate event extracted from one email */
export interface CandidateEvent {
  externalEventKey: string;
  eventName: string;
  eventStartAt: string | null;
  eventEndAt: string | null;
  locationRaw: string | null;
  eventUrl: string | null;
  status: 'approved' | 'rsvp' | 'waitlist' | 'unknown';
  parseConfidence: number;
  messageType: LumaMessageType;
  source: {
    gmailMessageId: string;
    gmailThreadId: string;
    sender: string;
    subject: string;
    receivedAt: string;
    hadIcs: boolean;
  };
}

/** A deduplicated canonical event with merged sources */
export interface DeduplicatedEvent {
  externalEventKey: string;
  eventName: string;
  eventStartAt: string | null;
  eventEndAt: string | null;
  locationRaw: string | null;
  eventUrl: string | null;
  status: 'approved' | 'rsvp' | 'waitlist' | 'unknown';
  parseConfidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sources: CandidateEvent['source'][];
  messageTypes: LumaMessageType[];
}

/** Shape of an event sent from the client for import */
export interface ImportEventPayload {
  externalEventKey: string;
  eventName: string;
  eventStartAt: string | null;
  eventEndAt: string | null;
  locationRaw: string | null;
  eventUrl: string | null;
  status: string;
  parseConfidence: number;
  firstSeenAt: string;
  lastSeenAt: string;
  sources: CandidateEvent['source'][];
}
