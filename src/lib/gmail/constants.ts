/** Known Luma email senders */
export const LUMA_SENDERS = [
  'notifications@luma.email',
  'hi@lu.ma',
  'hello@lu.ma',
  'noreply@lu.ma',
];

/** Known Luma email domains */
export const LUMA_DOMAINS = ['luma.email', 'lu.ma'];

/**
 * Gmail search queries to find Luma-related emails.
 * Each query is run separately; results are merged and deduplicated by message ID.
 */
export const GMAIL_SEARCH_QUERIES = [
  'from:(notifications@luma.email OR hi@lu.ma OR hello@lu.ma OR noreply@lu.ma)',
  '("lu.ma" OR "luma") AND ("RSVP" OR "approved" OR "confirmed" OR "invited")',
];

/** OAuth scopes requested from Google */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

/** Maximum number of Gmail messages to fetch per sync */
export const MAX_MESSAGES_PER_SYNC = 200;

/** Confidence scoring weights */
export const CONFIDENCE_WEIGHTS = {
  KNOWN_SENDER: 0.35,
  ICS_PARSED: 0.25,
  EVENT_NAME_FOUND: 0.20,
  DATE_FOUND: 0.10,
  LOCATION_FOUND: 0.10,
} as const;

/** Confidence scoring penalties */
export const CONFIDENCE_PENALTIES = {
  UNKNOWN_SENDER: -0.20,
  WEAK_REGEX_ONLY: -0.15,
  MISSING_TITLE: -0.15,
} as const;

/** Confidence thresholds for UI display */
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.7,
  MEDIUM: 0.4,
} as const;
