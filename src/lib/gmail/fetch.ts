import { google } from 'googleapis';
import { GMAIL_SEARCH_QUERIES, MAX_MESSAGES_PER_SYNC } from './constants';
import type { GmailMessage, GmailAttachment } from './types';

/**
 * Fetch Luma-related messages from Gmail using the provided access token.
 * Runs multiple search queries, deduplicates by message ID, and fetches full content.
 */
export async function fetchLumaMessages(
  accessToken: string
): Promise<GmailMessage[]> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const gmail = google.gmail({ version: 'v1', auth });

  // Collect unique message IDs from all queries
  const messageIds = new Set<string>();

  for (const query of GMAIL_SEARCH_QUERIES) {
    let pageToken: string | undefined;
    let fetched = 0;

    do {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
        pageToken,
      });

      const messages = res.data.messages || [];
      for (const msg of messages) {
        if (msg.id) messageIds.add(msg.id);
      }

      fetched += messages.length;
      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken && fetched < MAX_MESSAGES_PER_SYNC);
  }

  // Fetch full message content for each unique ID
  const fullMessages: GmailMessage[] = [];

  // Batch in groups of 20 to avoid rate limits
  const ids = Array.from(messageIds).slice(0, MAX_MESSAGES_PER_SYNC);
  const batchSize = 20;

  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map((id) =>
        gmail.users.messages
          .get({
            userId: 'me',
            id,
            format: 'full',
          })
          .then((res) => res.data)
          .catch(() => null)
      )
    );

    for (const msg of results) {
      if (!msg || !msg.id) continue;

      const parsed = parseGmailMessage(msg);
      if (parsed) fullMessages.push(parsed);
    }
  }

  return fullMessages;
}

/** Extract headers, body, and attachments from a Gmail API message */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseGmailMessage(msg: any): GmailMessage | null {
  const headers = msg.payload?.headers || [];
  const getHeader = (name: string): string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const h = headers.find((h: any) => h.name?.toLowerCase() === name.toLowerCase());
    return h?.value || '';
  };

  const from = getHeader('From');
  const subject = getHeader('Subject');
  const date = getHeader('Date');

  let bodyText = '';
  let bodyHtml = '';
  const attachments: GmailAttachment[] = [];

  // Recursively walk the MIME parts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walkParts(parts: any[]) {
    for (const part of parts) {
      const mimeType = part.mimeType || '';

      if (mimeType === 'text/plain' && part.body?.data) {
        bodyText += decodeBase64Url(part.body.data);
      } else if (mimeType === 'text/html' && part.body?.data) {
        bodyHtml += decodeBase64Url(part.body.data);
      } else if (
        mimeType === 'text/calendar' ||
        (part.filename && part.filename.endsWith('.ics'))
      ) {
        // ICS attachment — may be inline or have data directly
        if (part.body?.data) {
          attachments.push({
            filename: part.filename || 'invite.ics',
            mimeType,
            data: decodeBase64Url(part.body.data),
          });
        }
      }

      if (part.parts) {
        walkParts(part.parts);
      }
    }
  }

  if (msg.payload) {
    // Single-part message
    if (msg.payload.body?.data) {
      const mimeType = msg.payload.mimeType || '';
      if (mimeType === 'text/plain') {
        bodyText = decodeBase64Url(msg.payload.body.data);
      } else if (mimeType === 'text/html') {
        bodyHtml = decodeBase64Url(msg.payload.body.data);
      }
    }

    // Multi-part message
    if (msg.payload.parts) {
      walkParts(msg.payload.parts);
    }
  }

  return {
    id: msg.id!,
    threadId: msg.threadId || msg.id!,
    from,
    subject,
    date,
    bodyText,
    bodyHtml,
    attachments,
  };
}

/** Decode Gmail's URL-safe base64 encoding */
function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}
