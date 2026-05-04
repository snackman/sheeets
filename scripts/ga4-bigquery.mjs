#!/usr/bin/env node

/**
 * GA4 BigQuery Export Script
 *
 * Enables BigQuery daily export for the GA4 property via the Admin API (v1alpha).
 * Uses OAuth2 refresh token stored at ~/.claude/ga4-tokens.json.
 *
 * Prerequisites:
 *   - BigQuery API must be enabled on the GCP project (planwtf)
 *   - The GA4 service account needs BigQuery Editor role on the project
 *
 * Usage: node scripts/ga4-bigquery.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROPERTY_ID = '524531628';
const TOKEN_PATH = join(homedir(), '.claude', 'ga4-tokens.json');

// BigQuery links API is only available in v1alpha
const ADMIN_BASE = `https://analyticsadmin.googleapis.com/v1alpha/properties/${PROPERTY_ID}`;

const BIGQUERY_LINK = {
  project: 'planwtf',
  dailyExportEnabled: true,
  streamingExportEnabled: false,
  freshDailyExportEnabled: true,
  includeAdvertisingId: false,
  exportStreams: [],
};

// ---------- Token refresh ----------

async function refreshAccessToken() {
  const tokens = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));

  const clientId = process.env.GA4_CLIENT_ID || tokens.client_id;
  const clientSecret = process.env.GA4_CLIENT_SECRET || tokens.client_secret;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing client credentials. Set GA4_CLIENT_ID/GA4_CLIENT_SECRET env vars ' +
      'or add client_id/client_secret to ' + TOKEN_PATH
    );
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  const updated = { ...tokens, ...data };
  writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
  return data.access_token;
}

// ---------- Main ----------

async function main() {
  console.log('Refreshing access token...');
  const accessToken = await refreshAccessToken();
  console.log('Token refreshed.\n');

  console.log('Creating BigQuery link for project "planwtf"...\n');

  const res = await fetch(`${ADMIN_BASE}/bigQueryLinks`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(BIGQUERY_LINK),
  });

  if (res.status === 409) {
    console.log('[skip] BigQuery link already exists for this property.');
    console.log('Done.');
    return;
  }

  if (!res.ok) {
    const err = await res.text();
    console.error(`[error] BigQuery link creation failed: ${res.status}`);
    console.error(err);

    // Provide helpful guidance for common errors
    if (res.status === 403) {
      console.error('\nPermission denied. Make sure:');
      console.error('  1. The OAuth user has Editor access on the GA4 property');
      console.error('  2. The BigQuery API is enabled on GCP project "planwtf"');
      console.error('     -> https://console.cloud.google.com/apis/library/bigquery.googleapis.com?project=planwtf');
      console.error('  3. The user has BigQuery Admin role on the GCP project');
    } else if (res.status === 400) {
      console.error('\nBad request. Possible causes:');
      console.error('  1. BigQuery API not enabled on GCP project "planwtf"');
      console.error('     -> https://console.cloud.google.com/apis/library/bigquery.googleapis.com?project=planwtf');
      console.error('  2. The GCP project ID "planwtf" may be incorrect');
    } else if (res.status === 404) {
      console.error('\nProperty not found. Make sure property ID 524531628 is correct.');
    }

    process.exit(1);
  }

  const result = await res.json();
  console.log(`[created] BigQuery link: ${result.name}`);
  console.log(`  Project: ${result.project}`);
  console.log(`  Daily export: ${result.dailyExportEnabled}`);
  console.log(`  Streaming export: ${result.streamingExportEnabled}`);
  console.log(`  Fresh daily export: ${result.freshDailyExportEnabled}`);
  console.log('\nBigQuery export will start within 24 hours.');
  console.log('Data will appear in dataset: analytics_524531628');
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
