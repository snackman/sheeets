import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/gmail/server-auth';
import { getGoogleAuthUrl, getGmailConnection } from '@/lib/gmail';

export async function GET(req: NextRequest) {
  try {
    const { user, error } = await getAuthenticatedUser(req);
    if (error) return error;

    // Check if already connected
    const existing = await getGmailConnection(user!.id);
    if (existing) {
      return NextResponse.json({
        connected: true,
        email: existing.google_account_email,
        connectedAt: existing.connected_at,
      });
    }

    // Generate OAuth URL
    const authUrl = getGoogleAuthUrl(user!.id);
    return NextResponse.json({ authUrl });
  } catch (err) {
    console.error('Gmail connect error:', err);
    return NextResponse.json(
      { error: 'Failed to initiate Gmail connection' },
      { status: 500 }
    );
  }
}
