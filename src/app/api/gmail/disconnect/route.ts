import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthenticatedUser } from '@/lib/gmail/server-auth';
import { disconnectGmail } from '@/lib/gmail';

export async function POST(req: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(req);
    if (error) return error;

    const userId = user!.id;
    const body = await req.json().catch(() => ({}));
    const deleteData = body.deleteData === true;

    // Disconnect Gmail (revokes token, marks connection as disconnected)
    await disconnectGmail(userId);

    // Optionally delete all imported data
    if (deleteData) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      );

      // Sources are CASCADE deleted when events are deleted
      await supabase
        .from('imported_events')
        .delete()
        .eq('user_id', userId)
        .eq('source', 'gmail_luma');
    }

    return NextResponse.json({
      success: true,
      dataDeleted: deleteData,
    });
  } catch (err) {
    console.error('Gmail disconnect error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      { error: `Disconnect failed: ${message}` },
      { status: 500 }
    );
  }
}
