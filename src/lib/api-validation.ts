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

// ---------------------------------------------------------------------------
// Shared Zod schemas for API routes
// ---------------------------------------------------------------------------

/** Schema for POST /api/submit-event */
export const SubmitEventSchema = z.object({
  conference: z.string().min(1, 'Conference is required'),
  coords: z.object({ lat: z.number(), lng: z.number() }).optional().nullable(),
  event: z.object({
    name: z.string().min(1, 'Event name is required'),
    date: z.string().min(1, 'Event date is required'),
    startTime: z.string().optional().default(''),
    endTime: z.string().optional().default(''),
    organizer: z.string().optional().default(''),
    address: z.string().optional().default(''),
    cost: z.string().optional().default('Free'),
    tags: z.string().optional().default(''),
    link: z.string().optional().default(''),
    food: z.boolean().optional().default(false),
    bar: z.boolean().optional().default(false),
    note: z.string().optional().default(''),
  }),
});

/** Schema for POST /api/admin/toggle-featured */
export const ToggleFeaturedSchema = z.object({
  password: z.string(),
  conference: z.string().min(1),
  eventName: z.string().min(1),
  featured: z.boolean(),
});

/** Schema for POST /api/admin/config */
export const AdminConfigSchema = z.object({
  password: z.string(),
  key: z.string().min(1, 'Key is required'),
  value: z.unknown(),
});

/** Schema for POST /api/geocode */
export const GeocodeSchema = z.object({
  addresses: z.array(
    z.object({
      normalized: z.string(),
      raw: z.string(),
      conference: z.string(),
    })
  ),
});

/** Schema for GET /api/og (query params parsed separately) */
export const OgBatchSchema = z.object({
  items: z
    .array(
      z.object({
        eventId: z.string(),
        url: z.string(),
      })
    )
    .min(1),
});

/** Schema for POST /api/luma */
export const LumaSchema = z.object({
  url: z.string().min(1, 'URL is required'),
});

/** Schema for POST /api/fetch-event */
export const FetchEventSchema = z.object({
  url: z.string().min(1, 'URL is required'),
});

/** Schema for POST /api/ab/track */
export const ABTrackEventSchema = z.object({
  test_id: z.string().min(1, 'test_id is required'),
  variant_id: z.string().min(1, 'variant_id is required'),
  visitor_id: z.string().min(1, 'visitor_id is required'),
  event_type: z.enum(['impression', 'click', 'conversion']),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
