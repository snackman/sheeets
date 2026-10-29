import { NextRequest, NextResponse } from 'next/server';
import { z, ZodSchema } from 'zod';

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns { data } on success or { error: NextResponse } on failure.
 */
export async function parseBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>
): Promise<{ data: T; error?: never } | { data?: never; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      error: NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 }
      ),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    return {
      error: NextResponse.json(
        { error: messages.join('; ') },
        { status: 400 }
      ),
    };
  }

  return { data: result.data };
}

/* ------------------------------------------------------------------ */
/* Batch parsing (tracking beacons)                                    */
/* ------------------------------------------------------------------ */

/** Max items accepted per tracking request. Keep in sync with tracking-queue. */
export const MAX_BATCH_ITEMS = 50;

export type BatchParseResult<T> =
  | { items: T[]; dropped: number; error?: never }
  | { items?: never; dropped?: never; error: { status: number; message: string } };

/**
 * Parse a tracking payload that is EITHER a single object (legacy) OR
 * `{ events: [...] }` (batched, up to MAX_BATCH_ITEMS).
 *
 * - Single object: must be valid, else 400 (backwards compatible).
 * - Batch: invalid items are dropped; valid ones are returned.
 * - Batch larger than `max`: 413.
 */
export function parseBatch<T>(
  raw: unknown,
  schema: ZodSchema<T>,
  max: number = MAX_BATCH_ITEMS
): BatchParseResult<T> {
  const isBatch =
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    Array.isArray((raw as { events?: unknown }).events);

  if (!isBatch) {
    const result = schema.safeParse(raw);
    if (!result.success) {
      const messages = result.error.issues.map(
        (i) => `${i.path.join('.')}: ${i.message}`
      );
      return { error: { status: 400, message: messages.join('; ') } };
    }
    return { items: [result.data], dropped: 0 };
  }

  const events = (raw as { events: unknown[] }).events;
  if (events.length > max) {
    return { error: { status: 413, message: `Too many events (max ${max})` } };
  }

  const items: T[] = [];
  for (const e of events) {
    const result = schema.safeParse(e);
    if (result.success) items.push(result.data);
  }
  return { items, dropped: events.length - items.length };
}

/**
 * Read the request body (works for sendBeacon Blobs too — req.json() ignores
 * the content-type) and run parseBatch. Returns { items } or { error }.
 */
export async function parseBatchBody<T>(
  req: NextRequest,
  schema: ZodSchema<T>,
  max: number = MAX_BATCH_ITEMS
): Promise<{ items: T[]; dropped: number; error?: never } | { items?: never; error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }

  const result = parseBatch(raw, schema, max);
  if (result.error) {
    return {
      error: NextResponse.json(
        { error: result.error.message },
        { status: result.error.status }
      ),
    };
  }
  return { items: result.items, dropped: result.dropped };
}

// ---------------------------------------------------------------------------
// Shared Zod schemas for API routes
// ---------------------------------------------------------------------------

/** Schema for POST /api/submit-event */
export const SubmitEventSchema = z.object({
  conference: z.string().min(1, 'Conference is required').max(200),
  coords: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).optional().nullable(),
  event: z.object({
    name: z.string().min(1, 'Event name is required').max(200),
    date: z.string().min(1, 'Event date is required').max(50),
    startTime: z.string().max(50).optional().default(''),
    endTime: z.string().max(50).optional().default(''),
    organizer: z.string().max(200).optional().default(''),
    address: z.string().max(300).optional().default(''),
    cost: z.string().max(100).optional().default('Free'),
    tags: z.string().max(300).optional().default(''),
    link: z.string().max(2000).optional().default(''),
    food: z.boolean().optional().default(false),
    bar: z.boolean().optional().default(false),
    note: z.string().max(2000).optional().default(''),
  }),
  /** Cloudflare Turnstile response token (enforced only when configured). */
  turnstileToken: z.string().max(4000).optional(),
});

/** Schema for POST /api/admin/toggle-featured */
export const ToggleFeaturedSchema = z.object({
  password: z.string().max(500),
  conference: z.string().min(1),
  eventName: z.string().min(1),
  featured: z.boolean(),
});

/** Schema for POST /api/admin/config */
export const AdminConfigSchema = z.object({
  password: z.string().max(500),
  key: z.string().min(1, 'Key is required'),
  value: z.unknown(),
});

/** Free-form tracking metadata: bounded by serialized size so a client can't stuff huge blobs. */
const metadataSchema = z
  .record(z.string(), z.unknown())
  .refine((m) => JSON.stringify(m).length <= 4000, 'metadata too large')
  .optional();

/** Schema for POST /api/geocode */
export const GeocodeSchema = z.object({
  addresses: z.array(
    z.object({
      normalized: z.string().max(500),
      raw: z.string().max(500),
      conference: z.string().max(200),
    })
  ).max(50),
});

/** Schema for GET /api/og (query params parsed separately) */
export const OgBatchSchema = z.object({
  items: z
    .array(
      z.object({
        eventId: z.string().max(100),
        url: z.string().max(2000),
      })
    )
    .min(1)
    .max(100),
});

/** Schema for POST /api/luma */
export const LumaSchema = z.object({
  url: z.string().min(1, 'URL is required').max(2000),
});

/** Schema for POST /api/fetch-event */
export const FetchEventSchema = z.object({
  url: z.string().min(1, 'URL is required').max(2000),
});

/** Schema for POST /api/ab/track */
export const ABTrackEventSchema = z.object({
  test_id: z.string().min(1, 'test_id is required').max(100),
  variant_id: z.string().min(1, 'variant_id is required').max(100),
  visitor_id: z.string().min(1, 'visitor_id is required').max(100),
  event_type: z.enum(['impression', 'click', 'conversion']),
  metadata: metadataSchema,
});

/** Schema for one item of POST /api/events/track */
export const EventTrackSchema = z.object({
  event_id: z.string().min(1, 'event_id is required').max(100),
  event_name: z.string().max(300).optional(),
  event_type: z.enum(['click', 'impression', 'pin-click']),
  conference: z.string().max(200).optional(),
  visitor_id: z.string().max(100).optional(),
  url: z.string().max(2000).optional(),
  source: z.string().max(100).optional(),
  metadata: metadataSchema,
});

/** Schema for one item of POST /api/ads/track */
export const AdTrackSchema = z.object({
  ad_id: z.string().min(1, 'ad_id is required').max(100),
  ad_name: z.string().max(300).optional(),
  placement: z.string().min(1, 'placement is required').max(100),
  event_type: z.enum(['impression', 'click']),
  conference: z.string().max(200).optional(),
  visitor_id: z.string().max(100).optional(),
  url: z.string().max(2000).optional(),
  metadata: metadataSchema,
});

/**
 * Schema for one item of POST /api/errors. Over-long strings are truncated
 * (not rejected) so a huge stack never loses the whole report.
 */
const truncStr = (max: number) =>
  z.string().transform((s) => (s.length > max ? s.slice(0, max) : s));

export const ClientErrorSchema = z.object({
  message: z.string().min(1, 'message is required').transform((s) => s.slice(0, 500)),
  stack: truncStr(4000).nullish(),
  url: truncStr(500).nullish(),
  route: truncStr(300).nullish(),
  userAgent: truncStr(300).nullish(),
  kind: z.enum(['error', 'unhandledrejection', 'boundary']).optional(),
  digest: truncStr(100).optional(),
});

/** Schema for POST /api/admin/errors */
export const AdminErrorActionSchema = z.object({
  password: z.string().max(500),
  ids: z.array(z.string().uuid()).min(1).max(200),
  resolved: z.boolean().default(true),
});

/** Schema for POST /api/admin/submissions */
export const SubmissionActionSchema = z.object({
  password: z.string().max(500),
  action: z.enum(['approve', 'reject']),
  id: z.string().uuid(),
  rejection_reason: z.string().optional(),
  edits: z.object({
    event_name: z.string().optional(),
    event_date: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    organizer: z.string().optional(),
    address: z.string().optional(),
    cost: z.string().optional(),
    tags: z.string().optional(),
    link: z.string().optional(),
    has_food: z.boolean().optional(),
    has_bar: z.boolean().optional(),
    note: z.string().optional(),
  }).optional(),
});

// ---------------------------------------------------------------------------
// Host claims (plans/host-analytics.md)
// ---------------------------------------------------------------------------

/** Sheet event id: `evt-{base36 hash}` with an optional `-N` duplicate suffix. */
export const EventIdSchema = z
  .string()
  .regex(/^evt-[a-z0-9]{1,20}(-\d{1,4})?$/, 'Invalid event id');

export const ClaimIdSchema = z.string().uuid('Invalid claim id');

const claimNote = z
  .string()
  .trim()
  .min(1, 'Please add a short note')
  .max(1000, 'Note must be 1000 characters or fewer');

/** Schema for POST /api/host/claims */
export const ClaimCreateSchema = z.object({
  eventId: EventIdSchema,
  /** Request manual review straight away (required for non-Luma events). */
  manual: z.boolean().optional().default(false),
  note: claimNote.optional(),
});

/** Schema for POST /api/host/claims/[id]/manual */
export const ClaimManualSchema = z.object({
  note: claimNote,
});

// ---------------------------------------------------------------------------
// Event ingestion (plans/event-ingestion.md, Phase 1b)
// ---------------------------------------------------------------------------

/** Schema for POST /api/admin/ingest/run */
export const IngestRunActionSchema = z
  .object({
    password: z.string().max(500),
    sourceId: z.string().uuid().optional(),
    conference: z.string().min(1).optional(),
    dryRun: z.boolean().optional().default(false),
  })
  .refine((d) => !!d.sourceId || !!d.conference, {
    message: 'sourceId or conference is required',
    path: ['sourceId'],
  });

const IngestCandidateIdSchema = z.string().uuid('Invalid candidate id');

export const IngestRejectReasonSchema = z.enum([
  'off_theme',
  'wrong_city',
  'wrong_dates',
  'duplicate',
  'private_or_invite_only',
  'spam',
  'online',
  'lodging',
  'sales_1on1',
  'residency',
  'pre_event',
  'other',
]);

/** Schema for POST /api/admin/ingest/queue */
export const IngestQueueActionSchema = z.object({
  password: z.string().max(500),
  action: z.enum(['approve', 'reject', 'restore', 'rescore', 'unpublish', 'trust_host', 'block_host']),
  ids: z.array(IngestCandidateIdSchema).min(1).max(100),
  reason: IngestRejectReasonSchema.optional(),
  note: z.string().trim().max(1000).optional(),
  edits: z
    .object({
      name: z.string().optional(),
      date: z.string().optional(),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
      organizer: z.string().optional(),
      address: z.string().optional(),
      cost: z.string().optional(),
      tags: z.array(z.string()).optional(),
      food: z.boolean().optional(),
      bar: z.boolean().optional(),
      note: z.string().optional(),
    })
    .optional(),
});

/** Schema for PUT /api/admin/ingest/config (profile upsert) */
export const IngestProfileUpsertSchema = z.object({
  password: z.string().max(500),
  conference: z.string().min(1),
  theme_key: z.enum(['crypto', 'ai', 'gaming', 'art', 'music', 'tech', 'custom']),
  theme_description: z.string().max(2000).optional(),
  include_keywords: z.array(z.string()).optional(),
  exclude_keywords: z.array(z.string()).optional(),
  trusted_hosts: z.array(z.object({ kind: z.enum(['luma_host', 'luma_calendar', 'organizer']), id: z.string().optional(), name: z.string() })).optional(),
  blocked_hosts: z.array(z.object({ kind: z.enum(['luma_host', 'luma_calendar', 'organizer']), id: z.string().optional(), name: z.string() })).optional(),
  publish_threshold: z.number().int().min(0).max(100).optional(),
  review_threshold: z.number().int().min(0).max(100).optional(),
  auto_publish_enabled: z.boolean().optional(),
  radius_km: z.number().positive().optional(),
  window_pre_days: z.number().int().min(0).optional(),
  window_post_days: z.number().int().min(0).optional(),
  allow_online: z.boolean().optional(),
  max_llm_calls_per_run: z.number().int().positive().optional(),
  max_publish_per_run: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
});

/** Schema for POST /api/admin/ingest/config (add a Luma calendar, Telegram
 *  channel, X account, Meetup search, sponsor event-page, Mira series or
 *  sheet-tracker source — Phase 3 added `telegram_channel`, Phase 4 added
 *  three more, and this round added `mira_series`/`sheet_tracker`). */
export const IngestSourceCreateSchema = z.object({
  password: z.string().max(500),
  conference: z.string().min(1),
  kind: z.enum(['luma_ical', 'telegram_channel', 'x_account', 'meetup_search', 'sponsor_pages', 'mira_series', 'sheet_tracker']),
  /** Luma: a `luma.com/<slug>` calendar URL or raw `cal-…` id. Telegram: a
   *  handle, `@handle`, or `t.me/<handle>` URL. X: a handle, `@handle`, or
   *  `x.com/<handle>` URL. Meetup: a free-text topic query. Sponsor pages:
   *  one or more event-page URLs, one per line or comma-separated. Mira: a
   *  series slug or `miragather.com/<slug>` URL. Sheet tracker: a sheet id,
   *  or a full `docs.google.com/spreadsheets/d/<id>/...` URL (optionally
   *  with `gid=`). */
  input: z.string().min(1, 'A source identifier is required'),
  label: z.string().max(200).optional(),
  trust: z.enum(['curated', 'host', 'discovery']).optional(),
});

/** Schema for PATCH /api/admin/ingest/config (toggle/update a source) */
export const IngestSourceUpdateSchema = z.object({
  password: z.string().max(500),
  id: z.string().uuid(),
  enabled: z.boolean().optional(),
  trust: z.enum(['curated', 'host', 'discovery']).optional(),
  label: z.string().max(200).optional(),
});

/** Schema for DELETE /api/admin/ingest/config */
export const IngestSourceDeleteSchema = z.object({
  password: z.string().max(500),
  id: z.string().uuid(),
});

/** Schema for POST /api/admin/ingest/source-proposals (accept/dismiss a
 *  calendar auto-discovery proposal — plan item 3). */
export const IngestSourceProposalDecisionSchema = z.object({
  password: z.string().max(500),
  id: z.string().uuid(),
  decision: z.enum(['accepted', 'dismissed']),
});

// ---------------------------------------------------------------------------
// Host submission page (plans/event-ingestion.md, Phase 3 §3.5)
// ---------------------------------------------------------------------------

/** Schema for POST /api/host/submissions — a public (no admin password)
 *  endpoint, so validation here is the first anti-abuse layer: a real
 *  http(s) URL and a non-empty conference name. The ALLOWLIST check
 *  (Luma/Partiful/Eventbrite/Meetup/Posh only) happens after parsing,
 *  in the route itself, so the rejection message can be specific
 *  ("not a supported event platform" vs. "not a URL"). Rate limiting is a
 *  separate, IP-based layer, also in the route (not expressible in zod). */
export const HostSubmissionSchema = z.object({
  conference: z.string().min(1, 'Conference is required').max(200),
  url: z.string().trim().min(1, 'An event link is required').max(2000),
  // Review finding, LOW item 7: no `note` field — nothing in
  // `ingest_candidates` or the submission-attempts ledger has anywhere to
  // store a free-text note today, and `SubmitSourceForm.tsx` never
  // collected one, so it was dead weight in the schema. Add it back (with
  // real storage) if the form grows a note field later.
  /** Cloudflare Turnstile response token, sent only when the page has it
   *  configured (`NEXT_PUBLIC_TURNSTILE_SITE_KEY` set — see
   *  `SubmitSourceForm.tsx`). The server only enforces it when both the
   *  site key and `TURNSTILE_SECRET_KEY` are configured. */
  turnstileToken: z.string().max(4000).optional(),
});

/** Schema for POST /api/admin/claims/[id] */
export const AdminClaimActionSchema = z
  .object({
    password: z.string().max(500),
    action: z.enum(['approve', 'reject', 'revoke', 'relink']),
    note: z.string().trim().max(1000).optional(),
    eventId: EventIdSchema.optional(),
  })
  .refine((d) => d.action !== 'relink' || !!d.eventId, {
    message: 'eventId is required for relink',
    path: ['eventId'],
  });
