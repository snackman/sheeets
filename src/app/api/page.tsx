import type { Metadata } from 'next';
import Link from 'next/link';
import { CodeBlock, InlineCode } from './CodeBlock';

export const metadata: Metadata = {
  title: 'API Documentation - sheeets.xyz',
  description:
    'RESTful API documentation for sheeets.xyz — browse events, manage itineraries, and build AI agent integrations.',
};

const BASE_URL =
  'https://qsiukfwuwbpwyujfahtz.supabase.co/functions/v1/agent-api';

/* ------------------------------------------------------------------ */
/*  Reusable components                                               */
/* ------------------------------------------------------------------ */

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    POST: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    DELETE: 'bg-red-500/20 text-red-400 border-red-500/30',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-bold rounded border ${colors[method] ?? 'bg-stone-800 text-stone-300 border-stone-600'}`}
    >
      {method}
    </span>
  );
}

function AuthBadge({ auth }: { auth: 'Public' | 'API Key' | 'JWT' }) {
  const colors: Record<string, string> = {
    Public: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    'API Key': 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    JWT: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded border ${colors[auth]}`}
    >
      {auth}
    </span>
  );
}

function SectionHeading({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="text-2xl font-bold text-white mt-16 mb-6 scroll-mt-20"
    >
      {children}
    </h2>
  );
}

function SubHeading({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      id={id}
      className="text-lg font-semibold text-white mt-10 mb-4 scroll-mt-20"
    >
      {children}
    </h3>
  );
}

function EndpointCard({
  method,
  path,
  auth,
  scopes,
  description,
  params,
  body,
  response,
}: {
  method: string;
  path: string;
  auth: 'Public' | 'API Key' | 'JWT';
  scopes?: string;
  description: string;
  params?: { name: string; type: string; description: string }[];
  body?: string;
  response?: string;
}) {
  return (
    <div className="bg-stone-900/50 border border-stone-700 rounded-lg p-5 mb-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <MethodBadge method={method} />
        <code className="text-sm font-mono text-amber-300 break-all">
          {path}
        </code>
        <AuthBadge auth={auth} />
        {scopes && (
          <span className="text-[10px] text-stone-500 font-mono">
            {scopes}
          </span>
        )}
      </div>
      <p className="text-sm text-stone-300 mb-3">{description}</p>
      {params && params.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
            Query Parameters
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-500 text-xs">
                  <th className="pb-1 pr-4 font-medium">Param</th>
                  <th className="pb-1 pr-4 font-medium">Type</th>
                  <th className="pb-1 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {params.map((p) => (
                  <tr key={p.name} className="border-t border-stone-700/50">
                    <td className="py-1.5 pr-4">
                      <code className="text-xs text-amber-300 font-mono">
                        {p.name}
                      </code>
                    </td>
                    <td className="py-1.5 pr-4 text-xs text-stone-400">
                      {p.type}
                    </td>
                    <td className="py-1.5 text-xs text-stone-400">
                      {p.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {body && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
            Request Body
          </p>
          <div className="bg-stone-950 rounded p-3 overflow-x-auto">
            <pre className="text-xs text-stone-300 font-mono whitespace-pre">
              {body}
            </pre>
          </div>
        </div>
      )}
      {response && (
        <div>
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
            Response
          </p>
          <div className="bg-stone-950 rounded p-3 overflow-x-auto">
            <pre className="text-xs text-stone-300 font-mono whitespace-pre">
              {response}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export default function ApiDocsPage() {
  return (
    <div className="min-h-screen bg-stone-950">
      {/* Nav bar */}
      <header className="sticky top-0 z-50 bg-stone-950/95 backdrop-blur-sm border-b border-stone-800">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <Link
            href="/"
            className="text-sm font-bold text-white hover:text-amber-400 transition-colors"
          >
            sheeets.xyz
          </Link>
          <span className="text-xs text-stone-500 font-mono">
            API v0.4.0
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 pb-24">
        {/* ============================================================ */}
        {/*  Hero                                                        */}
        {/* ============================================================ */}
        <div className="mb-12">
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            sheeets API
          </h1>
          <p className="text-lg text-stone-400 max-w-2xl mb-6">
            A RESTful API for browsing crypto conference side events, managing
            itineraries, and building AI agent integrations. All event data is
            public. Authenticated endpoints let agents act on behalf of users.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="#quick-start"
              className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Quick Start
            </a>
            <a
              href="#endpoints"
              className="px-4 py-2 bg-stone-900 hover:bg-stone-800 border border-stone-700 text-stone-300 text-sm font-medium rounded-lg transition-colors"
            >
              Endpoints
            </a>
            <a
              href="#mcp-server"
              className="px-4 py-2 bg-stone-900 hover:bg-stone-800 border border-stone-700 text-stone-300 text-sm font-medium rounded-lg transition-colors"
            >
              MCP Server
            </a>
          </div>
        </div>

        {/* Table of contents */}
        <nav className="mb-12 p-4 bg-stone-900/50 border border-stone-700 rounded-lg">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">
            On this page
          </p>
          <ul className="space-y-1.5 text-sm">
            {[
              ['#quick-start', 'Quick Start'],
              ['#authentication', 'Authentication'],
              ['#events', 'Events (Public)'],
              ['#itinerary', 'Itinerary'],
              ['#friends', 'Friends'],
              ['#rsvps', 'RSVPs'],
              ['#recommendations', 'Recommendations'],
              ['#api-keys', 'API Key Management'],
              ['#scopes', 'Scopes'],
              ['#rate-limits', 'Rate Limits'],
              ['#response-format', 'Response Format'],
              ['#mcp-server', 'MCP Server'],
            ].map(([href, label]) => (
              <li key={href}>
                <a
                  href={href}
                  className="text-stone-400 hover:text-amber-400 transition-colors"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* ============================================================ */}
        {/*  Quick Start                                                 */}
        {/* ============================================================ */}
        <SectionHeading id="quick-start">Quick Start</SectionHeading>

        <p className="text-sm text-stone-300 mb-4">
          The event endpoints are public and require no authentication. Try it
          now:
        </p>

        <CodeBlock
          tabs={[
            {
              label: 'curl',
              language: 'bash',
              code: `curl "${BASE_URL}/events?search=pizza&free=true"`,
            },
            {
              label: 'JavaScript',
              language: 'javascript',
              code: `const res = await fetch(
  "${BASE_URL}/events?search=pizza&free=true"
);
const data = await res.json();
console.log(data.events);`,
            },
            {
              label: 'Python',
              language: 'python',
              code: `import requests

res = requests.get(
    "${BASE_URL}/events",
    params={"search": "pizza", "free": "true"}
)
data = res.json()
print(data["events"])`,
            },
          ]}
        />

        <p className="text-sm text-stone-400 mt-4">
          For authenticated endpoints (itinerary, friends, RSVPs), you need an{' '}
          <a href="#authentication" className="text-amber-400 hover:underline">
            API key
          </a>
          .
        </p>

        {/* ============================================================ */}
        {/*  Authentication                                              */}
        {/* ============================================================ */}
        <SectionHeading id="authentication">Authentication</SectionHeading>

        <p className="text-sm text-stone-300 mb-4">
          The API uses two authentication methods depending on the endpoint:
        </p>

        <div className="grid gap-4 sm:grid-cols-2 mb-6">
          <div className="bg-stone-900/50 border border-stone-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <AuthBadge auth="API Key" />
            </div>
            <p className="text-sm text-stone-300 mb-2">
              For most authenticated endpoints. Create an API key from the
              sheeets app or via the{' '}
              <a href="#api-keys" className="text-amber-400 hover:underline">
                key management endpoints
              </a>
              .
            </p>
            <div className="bg-stone-950 rounded p-3 overflow-x-auto">
              <code className="text-xs text-stone-300 font-mono">
                Authorization: Bearer shts_a1b2c3d4...
              </code>
            </div>
          </div>
          <div className="bg-stone-900/50 border border-stone-700 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <AuthBadge auth="JWT" />
            </div>
            <p className="text-sm text-stone-300 mb-2">
              For API key management only. Use a Supabase session JWT from the
              web app.
            </p>
            <div className="bg-stone-950 rounded p-3 overflow-x-auto">
              <code className="text-xs text-stone-300 font-mono">
                Authorization: Bearer eyJhbGciOi...
              </code>
            </div>
          </div>
        </div>

        <SubHeading id="auth-flow">How API Key Auth Works</SubHeading>

        <ol className="list-decimal list-inside space-y-2 text-sm text-stone-300 mb-6">
          <li>
            API keys have the format{' '}
            <InlineCode>shts_</InlineCode> + 32 hex characters
          </li>
          <li>
            Send the key in the <InlineCode>Authorization: Bearer</InlineCode>{' '}
            header
          </li>
          <li>
            The server SHA-256 hashes the key and looks up the user and scopes
          </li>
          <li>
            A short-lived JWT is minted for the resolved user &mdash; all
            Supabase RLS policies apply automatically
          </li>
        </ol>

        <CodeBlock
          tabs={[
            {
              label: 'curl',
              language: 'bash',
              code: `curl "${BASE_URL}/itinerary" \\
  -H "Authorization: Bearer shts_your_api_key_here"`,
            },
            {
              label: 'JavaScript',
              language: 'javascript',
              code: `const res = await fetch("${BASE_URL}/itinerary", {
  headers: {
    Authorization: "Bearer shts_your_api_key_here",
  },
});
const data = await res.json();
console.log(data);`,
            },
            {
              label: 'Python',
              language: 'python',
              code: `import requests

res = requests.get(
    "${BASE_URL}/itinerary",
    headers={"Authorization": "Bearer shts_your_api_key_here"}
)
data = res.json()
print(data)`,
            },
          ]}
        />

        {/* ============================================================ */}
        {/*  Base URL                                                    */}
        {/* ============================================================ */}
        <SubHeading id="base-url">Base URL</SubHeading>

        <div className="bg-stone-900/50 border border-stone-700 rounded-lg p-4 mb-6">
          <code className="text-sm text-amber-300 font-mono break-all">
            {BASE_URL}
          </code>
        </div>

        <p className="text-sm text-stone-400">
          All endpoint paths below are relative to this base URL.
        </p>

        {/* ============================================================ */}
        {/*  Endpoints                                                   */}
        {/* ============================================================ */}
        <SectionHeading id="endpoints">Endpoints</SectionHeading>

        {/* --- Events ------------------------------------------------ */}
        <SubHeading id="events">Events</SubHeading>
        <p className="text-sm text-stone-400 mb-4">
          All event endpoints are public and require no authentication.
        </p>

        <EndpointCard
          method="GET"
          path="/events"
          auth="Public"
          description="Search and filter events. Returns paginated results."
          params={[
            {
              name: 'conference',
              type: 'string',
              description:
                'Filter by conference name (e.g. "ETH Denver 2026")',
            },
            {
              name: 'date',
              type: 'string',
              description: 'Filter by date (ISO format: 2026-02-16)',
            },
            {
              name: 'tags',
              type: 'string',
              description: 'Comma-separated tag filter (e.g. "AI,DeFi")',
            },
            {
              name: 'search',
              type: 'string',
              description:
                'Full-text search across name, organizer, address, tags',
            },
            {
              name: 'free',
              type: 'boolean',
              description: 'Filter to free events only (free=true)',
            },
            {
              name: 'now',
              type: 'boolean',
              description:
                'Show events happening now or starting within 1 hour',
            },
          ]}
          response={`{
  "events": [
    {
      "id": "evt-ethdenver-42",
      "name": "Pizza Party",
      "organizer": "PizzaDAO",
      "date": "Feb 16",
      "dateISO": "2026-02-16",
      "startTime": "6:00 PM",
      "endTime": "9:00 PM",
      "address": "123 Main St, Denver",
      "cost": "Free",
      "isFree": true,
      "tags": ["Party", "Food"],
      "conference": "ETH Denver 2026",
      "link": "https://lu.ma/pizza-party"
    }
  ],
  "total": 228
}`}
        />

        <EndpointCard
          method="GET"
          path="/events/:id"
          auth="Public"
          description="Get a single event by ID."
          response={`{
  "event": {
    "id": "evt-ethdenver-42",
    "name": "Pizza Party",
    ...
  }
}`}
        />

        <EndpointCard
          method="GET"
          path="/events/conferences"
          auth="Public"
          description="List all available conferences."
          response={`{
  "conferences": [
    "ETH Denver 2026",
    "Consensus Hong Kong 2026"
  ]
}`}
        />

        <EndpointCard
          method="GET"
          path="/events/tags"
          auth="Public"
          description="List all available tags with their event counts."
          response={`{
  "tags": [
    { "tag": "AI", "count": 45 },
    { "tag": "DeFi", "count": 32 },
    ...
  ]
}`}
        />

        <EndpointCard
          method="GET"
          path="/events/dates"
          auth="Public"
          description="List all dates that have events."
          response={`{
  "dates": [
    "2026-02-10",
    "2026-02-11",
    ...
  ]
}`}
        />

        {/* --- Itinerary --------------------------------------------- */}
        <SubHeading id="itinerary">Itinerary</SubHeading>
        <p className="text-sm text-stone-400 mb-4">
          Manage the authenticated user&apos;s starred/saved events.
        </p>

        <EndpointCard
          method="GET"
          path="/itinerary"
          auth="API Key"
          scopes="itinerary:read"
          description="Get the user's saved events with full event data."
          response={`{
  "events": [
    {
      "id": "evt-ethdenver-42",
      "name": "Pizza Party",
      "date": "Feb 16",
      "startTime": "6:00 PM",
      ...
    }
  ],
  "total": 5
}`}
        />

        <EndpointCard
          method="POST"
          path="/itinerary/add"
          auth="API Key"
          scopes="itinerary:write"
          description="Add events to the user's itinerary. Duplicate IDs are silently ignored."
          body={`{
  "eventIds": ["evt-ethdenver-42", "evt-ethdenver-99"]
}`}
          response={`{
  "added": 2,
  "total": 7
}`}
        />

        <EndpointCard
          method="POST"
          path="/itinerary/remove"
          auth="API Key"
          scopes="itinerary:write"
          description="Remove events from the user's itinerary."
          body={`{
  "eventIds": ["evt-ethdenver-42"]
}`}
          response={`{
  "removed": 1,
  "total": 6
}`}
        />

        <EndpointCard
          method="DELETE"
          path="/itinerary"
          auth="API Key"
          scopes="itinerary:write"
          description="Clear all events from the user's itinerary."
          response={`{
  "cleared": true
}`}
        />

        <EndpointCard
          method="GET"
          path="/itinerary/conflicts"
          auth="API Key"
          scopes="itinerary:read"
          description="Detect scheduling conflicts among saved events. Uses 2-hour default duration for events without end times."
          response={`{
  "conflicts": [
    {
      "event_a": "evt-ethdenver-42",
      "event_b": "evt-ethdenver-99",
      "overlap_minutes": 60
    }
  ]
}`}
        />

        <EndpointCard
          method="POST"
          path="/itinerary/share"
          auth="API Key"
          scopes="itinerary:read"
          description="Create a shareable link for the current itinerary. Returns an 8-character short code."
          response={`{
  "url": "https://sheeets.vercel.app/itinerary/s/abc12345",
  "code": "abc12345"
}`}
        />

        <EndpointCard
          method="GET"
          path="/itinerary/export"
          auth="API Key"
          scopes="itinerary:read"
          description="Export the itinerary as JSON. ICS (calendar) format is also supported."
          params={[
            {
              name: 'format',
              type: 'string',
              description: '"json" (default) or "ics"',
            },
          ]}
          response={`{
  "events": [...],
  "exported_at": "2026-02-16T14:30:00Z"
}`}
        />

        {/* --- Friends ----------------------------------------------- */}
        <SubHeading id="friends">Friends</SubHeading>
        <p className="text-sm text-stone-400 mb-4">
          Read-only access to the authenticated user&apos;s friends list.
        </p>

        <EndpointCard
          method="GET"
          path="/friends"
          auth="API Key"
          scopes="friends:read"
          description="List the user's friends with their profile information."
          response={`{
  "friends": [
    {
      "user_id": "uuid-123",
      "display_name": "Alice",
      "x_handle": "@alice_eth"
    }
  ]
}`}
        />

        <EndpointCard
          method="GET"
          path="/friends/going"
          auth="API Key"
          scopes="friends:read"
          description="See which friends are going to a specific event (or all events if no eventId specified)."
          params={[
            {
              name: 'eventId',
              type: 'string',
              description: 'Filter to a specific event ID',
            },
          ]}
          response={`{
  "friends_going": [
    {
      "user_id": "uuid-123",
      "display_name": "Alice",
      "event_ids": ["evt-ethdenver-42"]
    }
  ]
}`}
        />

        {/* --- RSVPs ------------------------------------------------- */}
        <SubHeading id="rsvps">RSVPs</SubHeading>
        <p className="text-sm text-stone-400 mb-4">
          Manage RSVPs for Luma-powered events.
        </p>

        <EndpointCard
          method="GET"
          path="/rsvps"
          auth="API Key"
          scopes="rsvps:read"
          description="List all RSVPs for the authenticated user."
          response={`{
  "rsvps": [
    {
      "event_id": "evt-ethdenver-42",
      "status": "confirmed",
      "method": "api",
      "created_at": "2026-02-15T10:00:00Z"
    }
  ]
}`}
        />

        <EndpointCard
          method="POST"
          path="/rsvps"
          auth="API Key"
          scopes="rsvps:write"
          description="RSVP to an event. Creates a record in the rsvps table."
          body={`{
  "eventId": "evt-ethdenver-42"
}`}
          response={`{
  "rsvp": {
    "event_id": "evt-ethdenver-42",
    "status": "confirmed"
  }
}`}
        />

        {/* --- Recommendations --------------------------------------- */}
        <SubHeading id="recommendations">Recommendations</SubHeading>
        <p className="text-sm text-stone-400 mb-4">
          Get personalized event suggestions based on the user&apos;s itinerary
          tags and friends&apos; attendance.
        </p>

        <EndpointCard
          method="GET"
          path="/recommendations"
          auth="API Key"
          scopes="recommendations:read"
          description="Get personalized event recommendations. Scoring uses tag frequency from the user's itinerary plus a social signal (3 points per friend attending)."
          response={`{
  "recommendations": [
    {
      "event": {
        "id": "evt-ethdenver-55",
        "name": "DeFi Builder Night",
        ...
      },
      "score": 12.5,
      "reasons": ["Matches your tags: DeFi, Networking", "2 friends going"]
    }
  ]
}`}
        />

        {/* --- API Keys ---------------------------------------------- */}
        <SubHeading id="api-keys">API Key Management</SubHeading>
        <p className="text-sm text-stone-400 mb-4">
          Create and manage API keys. These endpoints require JWT authentication
          (Supabase session token), not API key auth.
        </p>

        <EndpointCard
          method="POST"
          path="/keys"
          auth="JWT"
          description="Create a new API key. The raw key is only returned once — store it securely."
          body={`{
  "scopes": [
    "events:read",
    "itinerary:read",
    "itinerary:write",
    "friends:read"
  ],
  "name": "My Claude Agent"
}`}
          response={`{
  "key": "shts_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "id": "uuid-key-123",
  "scopes": ["events:read", "itinerary:read", "itinerary:write", "friends:read"],
  "name": "My Claude Agent",
  "created_at": "2026-02-16T14:30:00Z"
}`}
        />

        <EndpointCard
          method="GET"
          path="/keys"
          auth="JWT"
          description="List all API keys for the authenticated user. The raw key is never returned — only the prefix and metadata."
          response={`{
  "keys": [
    {
      "id": "uuid-key-123",
      "key_prefix": "shts_a1b2",
      "scopes": ["events:read", "itinerary:read"],
      "name": "My Claude Agent",
      "created_at": "2026-02-16T14:30:00Z",
      "last_used_at": "2026-02-16T15:00:00Z"
    }
  ]
}`}
        />

        <EndpointCard
          method="DELETE"
          path="/keys/:id"
          auth="JWT"
          description="Revoke (delete) an API key. This is irreversible."
          response={`{
  "revoked": true
}`}
        />

        {/* ============================================================ */}
        {/*  Scopes                                                      */}
        {/* ============================================================ */}
        <SectionHeading id="scopes">Scopes</SectionHeading>

        <p className="text-sm text-stone-300 mb-4">
          API keys are scoped to limit access. Assign only the scopes your agent
          needs.
        </p>

        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-400 border-b border-stone-700">
                <th className="pb-2 pr-4 font-semibold">Scope</th>
                <th className="pb-2 pr-4 font-semibold">Grants Access To</th>
              </tr>
            </thead>
            <tbody className="text-stone-300">
              {[
                [
                  'events:read',
                  'Search and filter events, list conferences/tags/dates (also public)',
                ],
                [
                  'itinerary:read',
                  'View saved events, detect conflicts, share, export',
                ],
                [
                  'itinerary:write',
                  'Add/remove events from itinerary, clear all',
                ],
                [
                  'friends:read',
                  'List friends, see which friends are attending events',
                ],
                ['rsvps:read', 'List RSVPs'],
                ['rsvps:write', 'RSVP to events'],
                [
                  'recommendations:read',
                  'Get personalized event recommendations',
                ],
              ].map(([scope, desc]) => (
                <tr key={scope} className="border-b border-stone-700/50">
                  <td className="py-2.5 pr-4">
                    <code className="text-xs text-amber-300 font-mono">
                      {scope}
                    </code>
                  </td>
                  <td className="py-2.5 text-stone-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ============================================================ */}
        {/*  Rate Limits                                                 */}
        {/* ============================================================ */}
        <SectionHeading id="rate-limits">Rate Limits</SectionHeading>

        <div className="bg-stone-900/50 border border-stone-700 rounded-lg p-5 mb-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-2xl font-bold text-white">60</p>
              <p className="text-xs text-stone-400">requests per minute</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">Per Key</p>
              <p className="text-xs text-stone-400">rate limit scope</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-white">Atomic</p>
              <p className="text-xs text-stone-400">
                Postgres counter (no race conditions)
              </p>
            </div>
          </div>
        </div>

        <p className="text-sm text-stone-300 mb-4">
          When rate limited, the API returns{' '}
          <InlineCode>429 Too Many Requests</InlineCode> with a{' '}
          <InlineCode>Retry-After</InlineCode> header indicating seconds to
          wait.
        </p>

        <div className="bg-stone-950 border border-stone-700 rounded-lg p-4 overflow-x-auto mb-6">
          <pre className="text-sm text-stone-300 font-mono whitespace-pre">{`HTTP/1.1 429 Too Many Requests
Retry-After: 45
Content-Type: application/json

{
  "error": "Rate limit exceeded",
  "retry_after": 45
}`}</pre>
        </div>

        <p className="text-sm text-stone-400">
          Public endpoints (events) are not rate limited per key but are subject
          to Supabase Edge Function concurrency limits.
        </p>

        {/* ============================================================ */}
        {/*  Response Format                                             */}
        {/* ============================================================ */}
        <SectionHeading id="response-format">Response Format</SectionHeading>

        <p className="text-sm text-stone-300 mb-4">
          All responses are JSON. Successful responses return the requested data
          directly. Errors follow a consistent format:
        </p>

        <div className="grid gap-4 sm:grid-cols-2 mb-6">
          <div>
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
              Success (200)
            </p>
            <div className="bg-stone-950 border border-stone-700 rounded-lg p-4 overflow-x-auto">
              <pre className="text-sm text-stone-300 font-mono whitespace-pre">{`{
  "events": [...],
  "total": 42
}`}</pre>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">
              Error (4xx / 5xx)
            </p>
            <div className="bg-stone-950 border border-stone-700 rounded-lg p-4 overflow-x-auto">
              <pre className="text-sm text-stone-300 font-mono whitespace-pre">{`{
  "error": "Invalid API key",
  "status": 401
}`}</pre>
            </div>
          </div>
        </div>

        <p className="text-sm text-stone-300 mb-4">Common HTTP status codes:</p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="text-left text-stone-400 border-b border-stone-700">
                <th className="pb-2 pr-4 font-semibold">Code</th>
                <th className="pb-2 font-semibold">Meaning</th>
              </tr>
            </thead>
            <tbody className="text-stone-300">
              {[
                ['200', 'Success'],
                ['400', 'Bad request (missing or invalid parameters)'],
                ['401', 'Unauthorized (missing or invalid auth)'],
                ['403', 'Forbidden (insufficient scopes)'],
                ['404', 'Not found'],
                ['429', 'Rate limited'],
                ['500', 'Internal server error'],
              ].map(([code, meaning]) => (
                <tr key={code} className="border-b border-stone-700/50">
                  <td className="py-2 pr-4">
                    <code className="text-xs font-mono text-amber-300">
                      {code}
                    </code>
                  </td>
                  <td className="py-2 text-stone-400">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ============================================================ */}
        {/*  MCP Server                                                  */}
        {/* ============================================================ */}
        <SectionHeading id="mcp-server">MCP Server</SectionHeading>

        <p className="text-sm text-stone-300 mb-4">
          The sheeets MCP server wraps this REST API as{' '}
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-400 hover:underline"
          >
            Model Context Protocol
          </a>{' '}
          tools, so AI assistants like Claude can interact with sheeets
          natively.
        </p>

        <SubHeading id="mcp-install">Installation</SubHeading>

        <CodeBlock
          tabs={[
            {
              label: 'npm',
              language: 'bash',
              code: `npm install @sheeets/mcp-server`,
            },
            {
              label: 'npx',
              language: 'bash',
              code: `npx @sheeets/mcp-server`,
            },
          ]}
        />

        <SubHeading id="mcp-config">Configuration</SubHeading>

        <p className="text-sm text-stone-300 mb-4">
          Add the server to your MCP client config (e.g. Claude Desktop):
        </p>

        <CodeBlock
          tabs={[
            {
              label: 'claude_desktop_config.json',
              language: 'json',
              code: `{
  "mcpServers": {
    "sheeets": {
      "command": "npx",
      "args": ["@sheeets/mcp-server"],
      "env": {
        "SHEEETS_API_KEY": "shts_your_api_key_here"
      }
    }
  }
}`,
            },
          ]}
        />

        <SubHeading id="mcp-tools">Available Tools</SubHeading>

        <p className="text-sm text-stone-300 mb-4">
          The MCP server exposes the following tools to AI assistants:
        </p>

        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-stone-400 border-b border-stone-700">
                <th className="pb-2 pr-4 font-semibold">Tool</th>
                <th className="pb-2 font-semibold">Description</th>
              </tr>
            </thead>
            <tbody className="text-stone-300">
              {[
                ['search_events', 'Search and filter events'],
                ['get_event', 'Get a single event by ID'],
                ['list_conferences', 'List available conferences'],
                ['list_tags', 'List available tags'],
                ['list_dates', 'List event dates'],
                ['get_itinerary', 'Get saved events'],
                ['add_to_itinerary', 'Add events to itinerary'],
                ['remove_from_itinerary', 'Remove events from itinerary'],
                ['clear_itinerary', 'Clear all saved events'],
                ['get_conflicts', 'Detect scheduling conflicts'],
                ['share_itinerary', 'Create a shareable link'],
                ['export_itinerary', 'Export itinerary as JSON or ICS'],
                ['list_friends', 'List friends'],
                ['friends_going', 'See which friends attend an event'],
                ['list_rsvps', 'List RSVPs'],
                ['rsvp_to_event', 'RSVP to an event'],
                ['get_recommendations', 'Get personalized suggestions'],
              ].map(([tool, desc]) => (
                <tr key={tool} className="border-b border-stone-700/50">
                  <td className="py-2 pr-4">
                    <code className="text-xs text-amber-300 font-mono">
                      {tool}
                    </code>
                  </td>
                  <td className="py-2 text-stone-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ============================================================ */}
        {/*  Footer                                                      */}
        {/* ============================================================ */}
        <div className="mt-16 pt-8 border-t border-stone-800">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm text-stone-400">
                Built by{' '}
                <a
                  href="https://sheeets.xyz"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amber-400 hover:underline"
                >
                  sheeets.xyz
                </a>
              </p>
              <p className="text-xs text-stone-500 mt-1">
                API version 0.4.0
              </p>
            </div>
            <div className="flex gap-4">
              <a
                href="https://github.com/snackman/sheeets"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-stone-400 hover:text-amber-400 transition-colors"
              >
                GitHub
              </a>
              <Link
                href="/"
                className="text-sm text-stone-400 hover:text-amber-400 transition-colors"
              >
                Back to App
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
