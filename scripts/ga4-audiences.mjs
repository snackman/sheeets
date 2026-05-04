#!/usr/bin/env node

/**
 * GA4 Audiences Script
 *
 * Creates GA4 Audiences via the Admin API (v1alpha).
 * Uses OAuth2 refresh token stored at ~/.claude/ga4-tokens.json.
 *
 * Usage: node scripts/ga4-audiences.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROPERTY_ID = '524531628';
const TOKEN_PATH = join(homedir(), '.claude', 'ga4-tokens.json');

// Audiences API is only available in v1alpha
const ADMIN_BASE = `https://analyticsadmin.googleapis.com/v1alpha/properties/${PROPERTY_ID}`;

// ---------- Audience definitions ----------

const AUDIENCES = [
  {
    displayName: 'Power Users',
    description: 'Users who added 3+ events to itinerary or checked in',
    membershipDurationDays: 30,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: {
        scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
        filterExpression: {
          orGroup: {
            filterExpressions: [
              {
                andGroup: {
                  filterExpressions: [{
                    dimensionOrMetricFilter: {
                      fieldName: 'eventName',
                      stringFilter: {
                        matchType: 'EXACT',
                        value: 'itinerary',
                      },
                    },
                  }],
                },
              },
              {
                andGroup: {
                  filterExpressions: [{
                    dimensionOrMetricFilter: {
                      fieldName: 'eventName',
                      stringFilter: {
                        matchType: 'EXACT',
                        value: 'check_in',
                      },
                    },
                  }],
                },
              },
            ],
          },
        },
      },
    }],
    eventTrigger: {
      eventName: 'itinerary',
      logCondition: 'LOG_CONDITION_UNSPECIFIED',
    },
  },
  {
    displayName: 'Onboarding Dropoffs',
    description: 'Users who started onboarding but did not complete it',
    membershipDurationDays: 30,
    filterClauses: [
      {
        clauseType: 'INCLUDE',
        simpleFilter: {
          scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
          filterExpression: {
            andGroup: {
              filterExpressions: [{
                dimensionOrMetricFilter: {
                  fieldName: 'eventName',
                  stringFilter: {
                    matchType: 'EXACT',
                    value: 'onboarding_start',
                  },
                },
              }],
            },
          },
        },
      },
      {
        clauseType: 'EXCLUDE',
        simpleFilter: {
          scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
          filterExpression: {
            andGroup: {
              filterExpressions: [{
                dimensionOrMetricFilter: {
                  fieldName: 'eventName',
                  stringFilter: {
                    matchType: 'EXACT',
                    value: 'onboarding_complete',
                  },
                },
              }],
            },
          },
        },
      },
    ],
  },
  {
    displayName: 'Engaged Unauthenticated',
    description: 'Users who clicked 3+ events but never authenticated',
    membershipDurationDays: 30,
    filterClauses: [
      {
        clauseType: 'INCLUDE',
        simpleFilter: {
          scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
          filterExpression: {
            andGroup: {
              filterExpressions: [{
                dimensionOrMetricFilter: {
                  fieldName: 'eventName',
                  stringFilter: {
                    matchType: 'EXACT',
                    value: 'event_click',
                  },
                },
              }],
            },
          },
        },
      },
      {
        clauseType: 'EXCLUDE',
        simpleFilter: {
          scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
          filterExpression: {
            andGroup: {
              filterExpressions: [{
                dimensionOrMetricFilter: {
                  fieldName: 'eventName',
                  stringFilter: {
                    matchType: 'EXACT',
                    value: 'auth_success',
                  },
                },
              }],
            },
          },
        },
      },
    ],
  },
  {
    displayName: 'Active Planners',
    description: 'Users who added to itinerary in last 7 days',
    membershipDurationDays: 7,
    filterClauses: [{
      clauseType: 'INCLUDE',
      simpleFilter: {
        scope: 'AUDIENCE_FILTER_SCOPE_ACROSS_ALL_SESSIONS',
        filterExpression: {
          andGroup: {
            filterExpressions: [{
              dimensionOrMetricFilter: {
                fieldName: 'eventName',
                stringFilter: {
                  matchType: 'EXACT',
                  value: 'itinerary',
                },
              },
            }],
          },
        },
      },
    }],
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

async function createAudience(accessToken, audience) {
  const res = await fetch(`${ADMIN_BASE}/audiences`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(audience),
  });

  if (res.status === 409) {
    console.log(`  [skip] ${audience.displayName} (already exists)`);
    return;
  }

  if (!res.ok) {
    const err = await res.text();
    console.error(`  [error] ${audience.displayName}: ${res.status} ${err}`);
    return;
  }

  const result = await res.json();
  console.log(`  [created] ${audience.displayName} (${result.name})`);
}

// ---------- Main ----------

async function main() {
  console.log('Refreshing access token...');
  const accessToken = await refreshAccessToken();
  console.log('Token refreshed.\n');

  console.log(`Creating ${AUDIENCES.length} audiences...\n`);
  for (const audience of AUDIENCES) {
    await createAudience(accessToken, audience);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
