import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '@/lib/gmail/server-auth';
import {
  getValidAccessToken,
  fetchLumaMessages,
  extractLumaEvent,
  deduplicateEvents,
} from '@/lib/gmail';

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(req);
    if (error) return error;

    const userId = user!.id;

    // Get a valid access token
    const accessToken = await getValidAccessToken(userId);

    // Fetch Luma messages from Gmail
    const messages = await fetchLumaMessages(accessToken);

    // Extract candidate events from each message
    const candidates = messages
      .map((msg) => extractLumaEvent(msg))
      .filter((c): c is NonNullable<typeof c> => c !== null);

    // Deduplicate
    const events = deduplicateEvents(candidates);

    // Update last_sync_at
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    await supabase
      .from('gmail_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('status', 'active');

    return NextResponse.json({
      events,
      totalMessages: messages.length,
      totalCandidates: candidates.length,
      totalEvents: events.length,
    });
  } catch (err) {
    console.error('Gmail sync error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Sync failed: ${message}` },
      { status: 500 }
    );
  }
}
