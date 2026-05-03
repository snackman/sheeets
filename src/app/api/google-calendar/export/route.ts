import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseBody } from '@/lib/api-validation';
import { insertEvents } from '@/lib/google-calendar';

const GoogleCalendarExportSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  events: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        date: z.string(),
        dateISO: z.string(),
        startTime: z.string(),
        endTime: z.string(),
        isAllDay: z.boolean(),
        organizer: z.string(),
        address: z.string(),
        cost: z.string(),
        isFree: z.boolean(),
        vibe: z.string(),
        tags: z.array(z.string()),
        conference: z.string(),
        link: z.string(),
        hasFood: z.boolean(),
        hasBar: z.boolean(),
        note: z.string(),
        timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night', 'all-day']),
        lat: z.number().optional(),
        lng: z.number().optional(),
        matchedAddress: z.string().optional(),
        isDuplicate: z.boolean().optional(),
        isFeatured: z.boolean().optional(),
      })
    )
    .min(1, 'At least one event is required')
    .max(200, 'Too many events (max 200)'),
  timezone: z.string().min(1, 'Timezone is required'),
});

export async function POST(request: NextRequest) {
  try {
    const { data, error } = await parseBody(request, GoogleCalendarExportSchema);
    if (error) return error;

    const { accessToken, events, timezone } = data;

    const result = await insertEvents(accessToken, events, timezone);

    return NextResponse.json(result);
  } catch (err) {
    console.error('Google Calendar export error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Failed to export to Google Calendar: ${message}` },
      { status: 500 }
    );
  }
}
