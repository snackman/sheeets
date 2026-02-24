import crypto from 'crypto';
import { SHEET_ID } from '@/lib/constants';

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Token cache
let cachedToken: { token: string; expiresAt: number } | null = null;

/** Base64url encode (no padding) */
function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Create a signed JWT for Google service account auth */
function createJWT(): string {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (!email || !privateKey) {
    throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY env vars');
  }

  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPES,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey);

  return `${signingInput}.${base64url(signature)}`;
}

/** Get a valid access token, using cache when possible (~55 min TTL) */
async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) {
    return cachedToken.token;
  }

  const jwt = createJWT();

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    // Cache for 55 minutes (token is valid for 60)
    expiresAt: Date.now() + 55 * 60 * 1000,
  };

  return cachedToken.token;
}

/**
 * Find the next empty row in the "Add Events Here" section of a sheet tab.
 * Scans column A for the cell containing "Add Events Here", then looks for
 * the header row below it (col B = "Start Time"), and returns the first
 * empty row after that header.
 */
export async function findNextEmptyRow(sheetName: string): Promise<number> {
  const token = await getAccessToken();
  const range = encodeURIComponent(`'${sheetName}'!A1:E`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to read sheet: ${res.status} ${text}`);
  }

  const data = await res.json();
  const rows: string[][] = data.values || [];

  // Find the "Add Events Here" marker row
  let addEventsRow = -1;
  for (let i = 0; i < rows.length; i++) {
    const cellA = (rows[i]?.[0] || '').trim();
    if (cellA.includes('Add Events Here')) {
      addEventsRow = i;
      break;
    }
  }

  // Find the header row after the marker (col B = "Start Time")
  let headerRow = addEventsRow >= 0 ? addEventsRow + 1 : -1;
  if (addEventsRow >= 0) {
    for (let i = addEventsRow + 1; i < rows.length; i++) {
      const colB = (rows[i]?.[1] || '').trim().toLowerCase();
      if (colB === 'start time') {
        headerRow = i;
        break;
      }
    }
  }

  // Start scanning for empty rows after the header
  const startIdx = headerRow >= 0 ? headerRow + 1 : 13; // fallback to row 14

  for (let i = startIdx; i < rows.length; i++) {
    const row = rows[i] || [];
    const cellDate = (row[0] || '').trim();
    const startTime = (row[1] || '').trim();
    const name = (row[4] || '').trim();

    if (!cellDate && !startTime && !name) {
      return i + 1; // Convert to 1-based sheet row
    }
  }

  // If no empty row found, append after last row
  return rows.length + 1;
}

export interface EventRow {
  date: string;
  startTime: string;
  endTime: string;
  organizer: string;
  name: string;
  address: string;
  cost: string;
  tags: string;
  link: string;
  food: boolean;
  bar: boolean;
  note: string;
}

/**
 * Write an event row to the sheet.
 * Columns A:L map to: Date, Start Time, End Time, Organizer, Event Name, Address, Cost, Tags, Link, Food, Bar, Note
 * Returns the row number written.
 */
export async function appendEventRow(sheetName: string, event: EventRow): Promise<number> {
  const row = await findNextEmptyRow(sheetName);
  const token = await getAccessToken();

  const range = encodeURIComponent(`'${sheetName}'!A${row}:L${row}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?valueInputOption=USER_ENTERED`;

  const values = [
    [
      event.date,
      event.startTime,
      event.endTime,
      event.organizer,
      event.name,
      event.address,
      event.cost,
      event.tags,
      event.link,
      event.food ? 'TRUE' : 'FALSE',
      event.bar ? 'TRUE' : 'FALSE',
      event.note,
    ],
  ];

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ values }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to write to sheet: ${res.status} ${text}`);
  }

  return row;
}
