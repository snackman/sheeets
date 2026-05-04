#!/usr/bin/env node

/**
 * GA4 Setup Script
 *
 * Registers custom dimensions and key events (conversions) in GA4 via the Admin API.
 * Uses OAuth2 refresh token stored at ~/.claude/ga4-tokens.json.
 *
 * Usage: node scripts/ga4-setup.mjs
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

const ADMIN_BASE = `https://analyticsadmin.googleapis.com/v1beta/properties/${PROPERTY_ID}`;

// ---------- Custom dimensions to register ----------

const EVENT_DIMENSIONS = [
  { parameterName: 'view_mode', displayName: 'View Mode', description: 'Map/List/Table/Gallery' },
  { parameterName: 'conference', displayName: 'Conference', description: 'Conference slug' },
  { parameterName: 'tag', displayName: 'Tag', description: 'Filter tag name' },
  { parameterName: 'action', displayName: 'Action', description: 'Add/remove action' },
  { parameterName: 'search_term', displayName: 'Search Term', description: 'Search query' },
  { parameterName: 'event_name', displayName: 'Tracked Event Name', description: 'Name of event clicked' },
  { parameterName: 'trigger', displayName: 'Auth Trigger', description: 'What triggered auth prompt' },
  { parameterName: 'placement', displayName: 'Ad Placement', description: 'Ad placement location' },
  { parameterName: 'step', displayName: 'Onboarding Step', description: 'Which onboarding step' },
  { parameterName: 'modal', displayName: 'Modal Name', description: 'Which modal was dismissed' },
  { parameterName: 'provider', displayName: 'Nav Provider', description: 'Google Maps/Uber/Lyft' },
  { parameterName: 'visibility', displayName: 'Comment Visibility', description: 'Public/friends' },
  { parameterName: 'category', displayName: 'POI Category', description: 'POI category' },
  { parameterName: 'emoji', displayName: 'Reaction Emoji', description: 'Which emoji used' },
  { parameterName: 'test_id', displayName: 'AB Test ID', description: 'A/B test identifier' },
  { parameterName: 'variant_id', displayName: 'AB Variant', description: 'A/B test variant' },
];

const USER_DIMENSIONS = [
  { parameterName: 'conference_slug', displayName: 'User Conference', description: 'User selected conference' },
  { parameterName: 'has_itinerary', displayName: 'Has Itinerary', description: 'Whether user has itinerary items' },
  { parameterName: 'is_authenticated', displayName: 'Is Authenticated', description: 'Whether user is logged in' },
];

const KEY_EVENTS = [
  'auth_success',
  'itinerary',
  'check_in',
  'submit_event_success',
  'onboarding_complete',
  'ad_click',
  'rsvp_confirm',
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
  // Persist the new access token (keep existing refresh_token)
  const updated = { ...tokens, ...data };
  writeFileSync(TOKEN_PATH, JSON.stringify(updated, null, 2));
  return data.access_token;
}

// ---------- API helpers ----------

async function createCustomDimension(accessToken, dimension, scope) {
  const body = {
    parameterName: dimension.parameterName,
    displayName: dimension.displayName,
    description: dimension.description || '',
    scope: scope, // EVENT or USER
  };

  const res = await fetch(`${ADMIN_BASE}/customDimensions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    console.log(`  [skip] ${dimension.parameterName} (already exists)`);
    return;
  }

  if (!res.ok) {
    const err = await res.text();
    console.error(`  [error] ${dimension.parameterName}: ${res.status} ${err}`);
    return;
  }

  console.log(`  [created] ${dimension.parameterName}`);
}

async function createKeyEvent(accessToken, eventName) {
  const body = { eventName };

  const res = await fetch(`${ADMIN_BASE}/keyEvents`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 409) {
    console.log(`  [skip] ${eventName} (already exists)`);
    return;
  }

  if (!res.ok) {
    const err = await res.text();
    console.error(`  [error] ${eventName}: ${res.status} ${err}`);
    return;
  }

  console.log(`  [created] ${eventName}`);
}

// ---------- Main ----------

async function main() {
  console.log('Refreshing access token...');
  const accessToken = await refreshAccessToken();
  console.log('Token refreshed.\n');

  console.log(`Registering ${EVENT_DIMENSIONS.length} event-scoped custom dimensions...`);
  for (const dim of EVENT_DIMENSIONS) {
    await createCustomDimension(accessToken, dim, 'EVENT');
  }

  console.log(`\nRegistering ${USER_DIMENSIONS.length} user-scoped custom dimensions...`);
  for (const dim of USER_DIMENSIONS) {
    await createCustomDimension(accessToken, dim, 'USER');
  }

  console.log(`\nRegistering ${KEY_EVENTS.length} key events (conversions)...`);
  for (const eventName of KEY_EVENTS) {
    await createKeyEvent(accessToken, eventName);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
