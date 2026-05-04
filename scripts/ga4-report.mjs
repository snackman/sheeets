#!/usr/bin/env node

/**
 * GA4 Report CLI
 *
 * Query GA4 data via the Data API and Admin API.
 *
 * Usage: node scripts/ga4-report.mjs [traffic|events|funnels|conversions|dimensions]
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROPERTY_ID = '524531628';
const TOKEN_PATH = join(homedir(), '.claude', 'ga4-tokens.json');

// Client credentials are read from the tokens file (client_id, client_secret fields)
// or from GA4_CLIENT_ID / GA4_CLIENT_SECRET env vars.
// To keep secrets out of version control, add to ~/.claude/ga4-tokens.json:
//   "client_id": "<your-client-id>",
//   "client_secret": "<your-client-secret>"

const DATA_BASE = `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}`;
const ADMIN_BASE = `https://analyticsadmin.googleapis.com/v1beta/properties/${PROPERTY_ID}`;

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

// ---------- API helpers ----------

async function runReport(accessToken, body) {
  const res = await fetch(`${DATA_BASE}:runReport`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`runReport failed: ${res.status} ${err}`);
  }

  return res.json();
}

async function adminGet(accessToken, path) {
  const res = await fetch(`${ADMIN_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Admin API failed: ${res.status} ${err}`);
  }

  return res.json();
}

// ---------- Formatters ----------

function printTable(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] || '').length))
  );

  const sep = widths.map((w) => '-'.repeat(w + 2)).join('+');
  const formatRow = (row) =>
    row.map((cell, i) => ` ${String(cell || '').padEnd(widths[i])} `).join('|');

  console.log(formatRow(headers));
  console.log(sep);
  rows.forEach((row) => console.log(formatRow(row)));
  console.log(`\n${rows.length} rows\n`);
}

function extractRows(report) {
  if (!report.rows) return [];
  return report.rows.map((row) => [
    ...row.dimensionValues.map((d) => d.value),
    ...row.metricValues.map((m) => m.value),
  ]);
}

// ---------- Report types ----------

async function reportTraffic(accessToken) {
  console.log('Traffic by Source/Medium (last 30 days)\n');

  const report = await runReport(accessToken, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'sessionSourceMedium' }],
    metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'bounceRate' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 20,
  });

  const rows = extractRows(report);
  printTable(['Source / Medium', 'Sessions', 'Users', 'Bounce Rate'], rows);
}

async function reportEvents(accessToken) {
  console.log('Event Counts (last 30 days)\n');

  const report = await runReport(accessToken, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 50,
  });

  const rows = extractRows(report);
  printTable(['Event Name', 'Count', 'Users'], rows);
}

async function reportFunnels(accessToken) {
  console.log('Key Funnel Metrics (last 30 days)\n');

  const funnelEvents = [
    'session_start',
    'onboarding_start',
    'onboarding_complete',
    'auth_prompt',
    'auth_success',
    'itinerary',
    'check_in',
    'submit_event_open',
    'submit_event_success',
  ];

  const report = await runReport(accessToken, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: { values: funnelEvents },
      },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  });

  const rows = extractRows(report);

  // Sort by funnel order
  const orderMap = Object.fromEntries(funnelEvents.map((e, i) => [e, i]));
  rows.sort((a, b) => (orderMap[a[0]] ?? 99) - (orderMap[b[0]] ?? 99));

  printTable(['Funnel Step', 'Count', 'Users'], rows);
}

async function reportConversions(accessToken) {
  console.log('Key Conversion Events (last 30 days)\n');

  const conversionEvents = [
    'auth_success',
    'itinerary',
    'check_in',
    'submit_event_success',
    'onboarding_complete',
    'ad_click',
    'rsvp_confirm',
  ];

  const report = await runReport(accessToken, {
    dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }, { name: 'totalUsers' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: { values: conversionEvents },
      },
    },
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
  });

  const rows = extractRows(report);
  printTable(['Conversion Event', 'Count', 'Users'], rows);
}

async function reportDimensions(accessToken) {
  console.log('Registered Custom Dimensions\n');

  const data = await adminGet(accessToken, 'customDimensions');
  const dims = data.customDimensions || [];

  const rows = dims.map((d) => [
    d.parameterName,
    d.displayName,
    d.scope,
    d.description || '',
  ]);

  // Sort by scope then name
  rows.sort((a, b) => a[2].localeCompare(b[2]) || a[0].localeCompare(b[0]));

  printTable(['Parameter', 'Display Name', 'Scope', 'Description'], rows);
}

// ---------- Main ----------

const REPORTS = {
  traffic: reportTraffic,
  events: reportEvents,
  funnels: reportFunnels,
  conversions: reportConversions,
  dimensions: reportDimensions,
};

async function main() {
  const reportType = process.argv[2];

  if (!reportType || !REPORTS[reportType]) {
    console.log('Usage: node scripts/ga4-report.mjs [traffic|events|funnels|conversions|dimensions]');
    console.log('\nReport types:');
    console.log('  traffic      Sessions by source/medium (last 30 days)');
    console.log('  events       Event counts (last 30 days)');
    console.log('  funnels      Key funnel metrics (onboarding, auth)');
    console.log('  conversions  Key conversion events');
    console.log('  dimensions   List registered custom dimensions');
    process.exit(1);
  }

  console.log('Refreshing access token...');
  const accessToken = await refreshAccessToken();
  console.log('Token refreshed.\n');

  await REPORTS[reportType](accessToken);
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
