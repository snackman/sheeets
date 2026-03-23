import { NextRequest, NextResponse } from 'next/server';
import { handleGoogleCallback } from '@/lib/gmail';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state'); // userId passed as state
    const error = url.searchParams.get('error');

    if (error) {
      // User denied access or something went wrong
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
      return NextResponse.redirect(`${appUrl}/import?error=access_denied`);
    }

    if (!code || !state) {
      return NextResponse.json(
        { error: 'Missing code or state parameter' },
        { status: 400 }
      );
    }

    // Exchange code for tokens and store them
    await handleGoogleCallback(code, state);

    // Redirect back to the import page
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    return NextResponse.redirect(`${appUrl}/import?connected=true`);
  } catch (err) {
    console.error('Gmail callback error:', err);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    return NextResponse.redirect(`${appUrl}/import?error=callback_failed`);
  }
}
