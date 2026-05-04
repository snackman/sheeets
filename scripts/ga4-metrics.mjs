#!/usr/bin/env node

/**
 * GA4 Custom Metrics Script
 *
 * Registers custom metrics in GA4 via the Admin API.
 * Uses OAuth2 refresh token stored at ~/.claude/ga4-tokens.json.
 *
 * Usage: node scripts/ga4-metrics.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROPERTY_ID = '524531628';
const TOKEN_PATH = join(homedir(), '.claude', 'ga4-tokens.json');

const ADMIN_BASE = `https://analyticsadmin.googleapis.com/v1beta/properties/${PROPERTY_ID}`;

// ---------- Custom metrics to register ----------

const CUSTOM_METRICS = [
  {
    parameterName: 'itinerary_count',
    displayName: 'Itinerary Count',
    measurementUnit: 'STANDARD',
    scope: 'EVENT',
  },
  {
    parameterName: 'tag_count',
    displayName: 'Tag Count',
    measurementUnit: 'STANDARD',
    scope: 'EVENT',
  },
  {
    parameterName: 'search_count',
    displayName: 'Search Count',
    measurementUnit: 'STANDARD',
    scope: 'EVENT',
  },
];

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

// ---------- API helper ----------

async function createCustomMetric(accessToken, metric) {
  const res = await fetch(`${ADMIN_BASE}/customMetrics`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metric),
  });

  if (res.status === 409) {
    console.log(`  [skip] ${metric.parameterName} (already exists)`);
    return;
  }

  if (!res.ok) {
    const err = await res.text();
    console.error(`  [error] ${metric.parameterName}: ${res.status} ${err}`);
    return;
  }

  const result = await res.json();
  console.log(`  [created] ${metric.parameterName} (${result.name})`);
}

// ---------- Main ----------

async function main() {
  console.log('Refreshing access token...');
  const accessToken = await refreshAccessToken();
  console.log('Token refreshed.\n');

  console.log(`Registering ${CUSTOM_METRICS.length} custom metrics...\n`);
  for (const metric of CUSTOM_METRICS) {
    await createCustomMetric(accessToken, metric);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
