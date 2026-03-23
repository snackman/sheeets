import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { encrypt, decrypt } from './crypto';
import { GOOGLE_SCOPES } from './constants';

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/**
 * Generate the Google OAuth consent URL.
 * The state parameter carries the user ID so the callback can associate tokens.
 */
export function getGoogleAuthUrl(userId: string): string {
  const client = getOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    state: userId,
  });
}

/**
 * Exchange the authorization code for tokens and store them encrypted in Supabase.
 */
export async function handleGoogleCallback(
  code: string,
  userId: string
): Promise<{ email: string }> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Missing access or refresh token from Google');
  }

  // Get the user's Google email
  client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: client });
  const userInfo = await oauth2.userinfo.get();
  const email = userInfo.data.email || 'unknown';

  const supabase = getSupabase();

  // Deactivate any existing connections for this user
  await supabase
    .from('gmail_connections')
    .update({ status: 'disconnected' })
    .eq('user_id', userId)
    .eq('status', 'active');

  // Insert new connection
  const { error } = await supabase.from('gmail_connections').insert({
    user_id: userId,
    google_account_email: email,
    access_token_encrypted: encrypt(tokens.access_token),
    refresh_token_encrypted: encrypt(tokens.refresh_token),
    scope: tokens.scope || GOOGLE_SCOPES.join(' '),
    status: 'active',
  });

  if (error) throw new Error(`Failed to save Gmail connection: ${error.message}`);

  return { email };
}

/**
 * Get a valid access token for the user, refreshing if needed.
 */
export async function getValidAccessToken(userId: string): Promise<string> {
  const supabase = getSupabase();

  const { data: connection, error } = await supabase
    .from('gmail_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (error || !connection) {
    throw new Error('No active Gmail connection found');
  }

  const refreshToken = decrypt(connection.refresh_token_encrypted);

  const client = getOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });

  // Force a token refresh to always get a valid access token
  const { credentials } = await client.refreshAccessToken();

  if (!credentials.access_token) {
    throw new Error('Failed to refresh Google access token');
  }

  // Update the stored access token
  await supabase
    .from('gmail_connections')
    .update({
      access_token_encrypted: encrypt(credentials.access_token),
    })
    .eq('id', connection.id);

  return credentials.access_token;
}

/**
 * Disconnect Gmail: revoke token and mark connection as disconnected.
 */
export async function disconnectGmail(userId: string): Promise<void> {
  const supabase = getSupabase();

  const { data: connection } = await supabase
    .from('gmail_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  if (connection) {
    // Try to revoke the token with Google
    try {
      const accessToken = decrypt(connection.access_token_encrypted);
      const client = getOAuth2Client();
      await client.revokeToken(accessToken);
    } catch {
      // Token may already be invalid — continue with disconnect
    }

    await supabase
      .from('gmail_connections')
      .update({ status: 'disconnected' })
      .eq('id', connection.id);
  }
}

/**
 * Check if a user has an active Gmail connection.
 */
export async function getGmailConnection(userId: string) {
  const supabase = getSupabase();

  const { data } = await supabase
    .from('gmail_connections')
    .select('id, google_account_email, connected_at, last_sync_at, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .single();

  return data;
}
