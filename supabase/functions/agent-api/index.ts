import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// --- Constants ----------------------------------------------------------------

const SHEET_ID = "1xWmIHyEyOmPHfkYuZkucPRlLGWbb9CF6Oqvfl8FUV6k";
const EVENT_TABS = [
  { gid: 356217373, name: "ETH Denver 2026" },
  { gid: 377806756, name: "Consensus Hong Kong 2026" },
];

const TAG_ALIASES: Record<string, string> = {
  "Fitness/Wellness": "Wellness",
};

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// --- CORS ---------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, apikey, x-client-info",
};

function corsResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorResponse(message: string, status = 400) {
  return corsResponse({ error: message }, status);
}

// --- Supabase Admin Client ----------------------------------------------------

function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey);
}

// --- GViz Parser (ported from src/lib/gviz.ts) --------------------------------

interface GVizCell {
  v: string | number | boolean | null;
  f?: string;
}

interface GVizRow {
  c: (GVizCell | null)[];
}

interface GVizTable {
  cols: { id: string; label: string; type: string }[];
  rows: GVizRow[];
}

function parseGVizResponse(response: string): GVizTable {
  let jsonStr = response;
  if (jsonStr.startsWith("/*")) {
    const commentEnd = jsonStr.indexOf("*/");
    if (commentEnd !== -1) jsonStr = jsonStr.substring(commentEnd + 2).trim();
  }
  const fn = "google.visualization.Query.setResponse(";
  if (jsonStr.startsWith(fn)) {
    jsonStr = jsonStr.substring(fn.length);
  }
  if (jsonStr.endsWith(");")) jsonStr = jsonStr.slice(0, -2);
  else if (jsonStr.endsWith(")")) jsonStr = jsonStr.slice(0, -1);
  const parsed = JSON.parse(jsonStr);
  if (parsed.status !== "ok") {
    throw new Error(`GViz query failed: ${parsed.status}`);
  }
  return parsed.table;
}

function getCellValue(cell: GVizCell | null): string {
  if (!cell) return "";
  if (cell.f !== undefined && cell.f !== null) return String(cell.f);
  if (cell.v !== undefined && cell.v !== null) return String(cell.v);
  return "";
}

function getCellBool(cell: GVizCell | null): boolean {
  if (!cell || !cell.v) return false;
  const val = String(cell.v).toLowerCase().trim();
  return ["true", "yes", "1", "y", "x", "\u2713", "\u2714"].includes(val);
}

// --- Event Parsing (ported from src/lib/fetch-events.ts) ----------------------

interface CachedEvent {
  id: string;
  conference: string;
  date_iso: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  organizer: string;
  name: string;
  address: string;
  cost: string;
  is_free: boolean;
  tags: string[];
  link: string;
  has_food: boolean;
  has_bar: boolean;
  note: string;
  lat: number | null;
  lng: number | null;
  cached_at?: string;
}

function parseDateToISO(dateStr: string): string {
  if (!dateStr) return "";
  const months: Record<string, string> = {
    Jan: "01",
    Feb: "02",
    Mar: "03",
    Apr: "04",
    May: "05",
    Jun: "06",
    Jul: "07",
    Aug: "08",
    Sep: "09",
    Oct: "10",
    Nov: "11",
    Dec: "12",
  };
  const match = dateStr.match(/(\w+)\s+(\d+)/);
  if (!match) return "";
  const month =
    months[match[1]] || months[dateStr.split(",")[1]?.trim().split(" ")[0]];
  if (!month) return "";
  const day = match[2].padStart(2, "0");
  return `2026-${month}-${day}`;
}

function isFreeEvent(cost: string): boolean {
  if (!cost) return true;
  const lower = cost.toLowerCase().trim();
  return lower === "free" || lower === "" || lower === "0" || lower === "$0";
}

function parseTags(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => TAG_ALIASES[t] || t);
}

function generateEventId(
  conference: string,
  date: string,
  startTime: string,
  name: string,
): string {
  const input = `${conference}|${date}|${startTime}|${name}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  const positiveHash = (hash >>> 0).toString(36);
  return `evt-${positiveHash}`;
}

function findHeaderIndex(rows: GVizRow[]): number {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.c) continue;
    const colB = getCellValue(row.c[1]).toLowerCase().trim();
    if (colB === "start time") return i;
  }
  return -1;
}

function isEmptyRow(row: GVizRow): boolean {
  if (!row.c) return true;
  const name = getCellValue(row.c[4]);
  const date = getCellValue(row.c[0]);
  const startTime = getCellValue(row.c[1]);
  return !name && !date && !startTime;
}

async function fetchPage(gid: number, offset: number): Promise<string> {
  const tq = encodeURIComponent(`select * limit 500 offset ${offset}`);
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&gid=${gid}&headers=1&tq=${tq}`;
  const response = await fetch(url);
  return response.text();
}

async function fetchEventsFromSheets(): Promise<CachedEvent[]> {
  const events: CachedEvent[] = [];
  const seenIds = new Map<string, number>();

  for (const tab of EVENT_TABS) {
    let allRows: GVizRow[] = [];
    for (let offset = 0; offset < 5000; offset += 500) {
      const text = await fetchPage(tab.gid, offset);
      const table = parseGVizResponse(text);
      if (table.rows.length === 0) break;
      allRows = allRows.concat(table.rows);
      if (table.rows.length < 500) break;
    }

    const headerIdx = findHeaderIndex(allRows);
    if (headerIdx === -1) continue;

    let currentDate = "";

    for (let i = headerIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (isEmptyRow(row)) break;

      const dateVal = getCellValue(row.c[0]);
      if (dateVal) currentDate = dateVal;

      const name = getCellValue(row.c[4]);
      if (!name) continue;

      const startTime = getCellValue(row.c[1]);
      const endTime = getCellValue(row.c[2]);
      const cost = getCellValue(row.c[6]);
      const isAllDay =
        !startTime || startTime.toLowerCase().includes("all day");

      const rawTags = parseTags(getCellValue(row.c[7]));
      const costVal = getCellValue(row.c[6]);
      const foodBool = getCellBool(row.c[9]);
      const barBool = getCellBool(row.c[10]);

      const syntheticTags: string[] = [];
      if (!isFreeEvent(costVal)) syntheticTags.push("$$");
      if (foodBool) syntheticTags.push("\ud83c\udf55 Food");
      if (barBool) syntheticTags.push("\ud83c\udf7a Bar");
      const tags = [...rawTags, ...syntheticTags];

      let id = generateEventId(tab.name, currentDate, startTime, name);
      const count = seenIds.get(id) ?? 0;
      seenIds.set(id, count + 1);
      if (count > 0) id = `${id}-${count}`;

      events.push({
        id,
        conference: tab.name,
        date_iso: parseDateToISO(currentDate),
        start_time: isAllDay ? "All Day" : startTime,
        end_time: endTime || "",
        is_all_day: isAllDay,
        organizer: getCellValue(row.c[3]),
        name,
        address: getCellValue(row.c[5]),
        cost,
        is_free: isFreeEvent(cost),
        tags,
        link: getCellValue(row.c[8]),
        has_food: foodBool,
        has_bar: barBool,
        note: getCellValue(row.c[11]),
        lat: null,
        lng: null,
      });
    }
  }

  return events;
}

// --- Events Cache Layer -------------------------------------------------------

async function getEvents(): Promise<CachedEvent[]> {
  const admin = getAdminClient();

  // Check if cache is fresh (any row with cached_at within TTL)
  const { data: sample } = await admin
    .from("events_cache")
    .select("cached_at")
    .order("cached_at", { ascending: false })
    .limit(1)
    .single();

  const now = Date.now();
  const cacheAge = sample
    ? now - new Date(sample.cached_at).getTime()
    : Infinity;

  if (cacheAge < CACHE_TTL_MS) {
    // Serve from cache
    const { data, error } = await admin
      .from("events_cache")
      .select("*")
      .order("date_iso", { ascending: true });
    if (error) throw new Error(`Cache read failed: ${error.message}`);
    return data as CachedEvent[];
  }

  // Cache is stale or empty -- refresh from Google Sheets
  const events = await fetchEventsFromSheets();

  // Upsert all events into cache
  const cachedAt = new Date().toISOString();
  const rows = events.map((e) => ({ ...e, cached_at: cachedAt }));

  if (rows.length > 0) {
    // Clear old cache and insert fresh data
    await admin.from("events_cache").delete().neq("id", "");

    // Insert in batches of 500
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await admin
        .from("events_cache")
        .upsert(batch, { onConflict: "id" });
      if (error) {
        console.error(`Cache upsert batch ${i} failed:`, error.message);
      }
    }
  }

  return events;
}

// --- "Now" filter helper (ported from src/lib/filters.ts) ---------------------

function parseTimeToMinutes(t: string): number | null {
  if (!t) return null;
  const s = t.toLowerCase().trim();
  if (s === "all day" || s === "tbd") return null;
  const m = s.match(/(\d{1,2}):?(\d{2})?\s*(am?|pm?)?/i);
  if (!m) return null;
  let h = parseInt(m[1]);
  const min = m[2] ? parseInt(m[2]) : 0;
  const isPM = m[3] && m[3].startsWith("p");
  const isAM = m[3] && m[3].startsWith("a");
  if (isPM && h !== 12) h += 12;
  if (isAM && h === 12) h = 0;
  return h * 60 + min;
}

function passesNowFilter(event: CachedEvent, now: Date): boolean {
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (event.date_iso !== todayISO) return false;
  if (event.is_all_day) return true;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = parseTimeToMinutes(event.start_time);
  if (startMinutes === null) return true;
  const endMinutes = parseTimeToMinutes(event.end_time);

  if (startMinutes <= nowMinutes) {
    if (endMinutes === null) return nowMinutes <= startMinutes + 120;
    if (endMinutes >= nowMinutes) return true;
    return false;
  }
  if (startMinutes > nowMinutes && startMinutes <= nowMinutes + 60) return true;
  return false;
}

// --- Event Filtering ----------------------------------------------------------

function filterEvents(
  events: CachedEvent[],
  params: URLSearchParams,
): CachedEvent[] {
  let filtered = events;

  const conference = params.get("conference");
  if (conference) {
    filtered = filtered.filter(
      (e) => e.conference.toLowerCase() === conference.toLowerCase(),
    );
  }

  const date = params.get("date");
  if (date) {
    filtered = filtered.filter((e) => e.date_iso === date);
  }

  const tags = params.get("tags");
  if (tags) {
    const tagList = tags
      .split(",")
      .map((t) => t.trim().toLowerCase());
    filtered = filtered.filter((e) =>
      tagList.every((tag) => e.tags.some((et) => et.toLowerCase() === tag)),
    );
  }

  const search = params.get("search");
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((e) => {
      const searchable = [
        e.name,
        e.organizer,
        e.address,
        e.note,
        e.conference,
        ...e.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(q);
    });
  }

  const free = params.get("free");
  if (free === "true") {
    filtered = filtered.filter((e) => e.is_free);
  }

  const nowParam = params.get("now");
  if (nowParam === "true") {
    const now = new Date();
    filtered = filtered.filter((e) => passesNowFilter(e, now));
  }

  return filtered;
}

// --- Response Formatters ------------------------------------------------------

function formatEvent(e: CachedEvent) {
  return {
    id: e.id,
    conference: e.conference,
    dateISO: e.date_iso,
    startTime: e.start_time,
    endTime: e.end_time,
    isAllDay: e.is_all_day,
    organizer: e.organizer,
    name: e.name,
    address: e.address,
    cost: e.cost,
    isFree: e.is_free,
    tags: e.tags,
    link: e.link,
    hasFood: e.has_food,
    hasBar: e.has_bar,
    note: e.note,
    lat: e.lat,
    lng: e.lng,
  };
}

// --- Auth Module: JWT Auth (for key management from web app) -----------------

interface JwtAuthResult {
  userId: string;
}

async function authenticateJwt(
  req: Request,
): Promise<JwtAuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return errorResponse(
      "Missing or invalid token. Expected: Authorization: Bearer <jwt>",
      401,
    );
  }

  const token = authHeader.replace("Bearer ", "");

  // JWT tokens should NOT start with shts_ (those are API keys)
  if (token.startsWith("shts_")) {
    return errorResponse(
      "API keys cannot be used for key management. Use a Supabase JWT.",
      401,
    );
  }

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);

  if (error || !user) {
    return errorResponse("Invalid or expired JWT", 401);
  }

  return { userId: user.id };
}

// --- Auth Module: API Key Auth (for authenticated API endpoints) -------------

interface ApiKeyAuthResult {
  userId: string;
  scopes: string[];
}

// deno-lint-ignore no-unused-vars
async function authenticateApiKey(
  req: Request,
): Promise<ApiKeyAuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer shts_")) {
    return errorResponse(
      "Missing or invalid API key. Expected: Authorization: Bearer shts_...",
      401,
    );
  }

  const apiKey = authHeader.replace("Bearer ", "");

  // SHA-256 hash the key
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(apiKey),
  );
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const admin = getAdminClient();

  // Look up key
  const { data: keyRecord, error } = await admin
    .from("api_keys")
    .select("*")
    .eq("key_hash", keyHash)
    .is("revoked_at", null)
    .single();

  if (error || !keyRecord) {
    return errorResponse("Invalid API key", 401);
  }

  // Check if expired
  if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
    return errorResponse("API key has expired", 401);
  }

  // Check rate limit
  const { data: allowed } = await admin.rpc("check_rate_limit", {
    p_key_hash: keyHash,
  });
  if (!allowed) {
    return errorResponse(
      "Rate limit exceeded. Max 60 requests per minute.",
      429,
    );
  }

  // Update last_used_at (fire and forget)
  admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRecord.id)
    .then(() => {});

  return {
    userId: keyRecord.user_id,
    scopes: keyRecord.scopes,
  };
}

// deno-lint-ignore no-unused-vars
function hasScope(auth: ApiKeyAuthResult, scope: string): boolean {
  return auth.scopes.includes(scope);
}

// --- Auth Helpers -------------------------------------------------------------

const VALID_SCOPES = [
  "itinerary:read",
  "itinerary:write",
  "friends:read",
  "rsvps:read",
  "rsvps:write",
  "recommendations:read",
];

const DEFAULT_SCOPES = [...VALID_SCOPES];

const MAX_KEYS_PER_USER = 5;

async function sha256Hex(input: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `shts_${hex}`;
}

// --- Route Handlers -----------------------------------------------------------

async function handleGetEvents(params: URLSearchParams): Promise<Response> {
  const events = await getEvents();
  const filtered = filterEvents(events, params);
  return corsResponse({
    data: filtered.map(formatEvent),
    count: filtered.length,
  });
}

async function handleGetEventById(id: string): Promise<Response> {
  const events = await getEvents();
  const event = events.find((e) => e.id === id);
  if (!event) {
    return errorResponse("Event not found", 404);
  }
  return corsResponse({ data: formatEvent(event) });
}

async function handleGetConferences(): Promise<Response> {
  const events = await getEvents();
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.conference, (counts.get(e.conference) || 0) + 1);
  }
  const conferences = Array.from(counts.entries()).map(([name, count]) => ({
    name,
    count,
  }));
  return corsResponse({ data: conferences });
}

async function handleGetTags(): Promise<Response> {
  const events = await getEvents();
  const tagCounts = new Map<string, number>();
  for (const e of events) {
    for (const tag of e.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  const tags = Array.from(tagCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return corsResponse({ data: tags });
}

async function handleGetDates(): Promise<Response> {
  const events = await getEvents();
  const dateCounts = new Map<string, number>();
  for (const e of events) {
    if (e.date_iso) {
      dateCounts.set(e.date_iso, (dateCounts.get(e.date_iso) || 0) + 1);
    }
  }
  const dates = Array.from(dateCounts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return corsResponse({ data: dates });
}

// --- Key Management Route Handlers -------------------------------------------

async function handleCreateKey(req: Request): Promise<Response> {
  // Authenticate via JWT
  const auth = await authenticateJwt(req);
  if (auth instanceof Response) return auth;

  const admin = getAdminClient();

  // Check key count limit
  const { count, error: countError } = await admin
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", auth.userId)
    .is("revoked_at", null);

  if (countError) {
    return errorResponse("Failed to check key count", 500);
  }

  if ((count ?? 0) >= MAX_KEYS_PER_USER) {
    return errorResponse(
      `Maximum of ${MAX_KEYS_PER_USER} active API keys per user. Revoke an existing key first.`,
      400,
    );
  }

  // Parse request body
  let name = "default";
  let scopes = DEFAULT_SCOPES;

  try {
    const body = await req.json();
    if (body.name && typeof body.name === "string") {
      name = body.name.trim().slice(0, 100); // limit name length
    }
    if (Array.isArray(body.scopes) && body.scopes.length > 0) {
      // Validate all scopes
      const invalidScopes = body.scopes.filter(
        (s: unknown) => typeof s !== "string" || !VALID_SCOPES.includes(s as string),
      );
      if (invalidScopes.length > 0) {
        return errorResponse(
          `Invalid scopes: ${invalidScopes.join(", ")}. Valid scopes: ${VALID_SCOPES.join(", ")}`,
          400,
        );
      }
      scopes = body.scopes;
    }
  } catch {
    // Empty body is fine, use defaults
  }

  // Generate the raw key
  const rawKey = generateApiKey();
  const keyHash = await sha256Hex(rawKey);
  const keyPrefix = rawKey.substring(5, 13); // first 8 chars after "shts_"

  // Insert into database
  const { data: newKey, error: insertError } = await admin
    .from("api_keys")
    .insert({
      user_id: auth.userId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      name,
      scopes,
    })
    .select("id, name, scopes, created_at")
    .single();

  if (insertError) {
    console.error("Failed to create API key:", insertError.message);
    return errorResponse("Failed to create API key", 500);
  }

  // Return the raw key ONCE -- it cannot be retrieved again
  return corsResponse(
    {
      key: rawKey,
      id: newKey.id,
      name: newKey.name,
      scopes: newKey.scopes,
      created_at: newKey.created_at,
    },
    201,
  );
}

async function handleListKeys(req: Request): Promise<Response> {
  // Authenticate via JWT
  const auth = await authenticateJwt(req);
  if (auth instanceof Response) return auth;

  const admin = getAdminClient();

  const { data: keys, error } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, scopes, last_used_at, created_at")
    .eq("user_id", auth.userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to list API keys:", error.message);
    return errorResponse("Failed to list API keys", 500);
  }

  return corsResponse({ data: keys });
}

async function handleRevokeKey(
  req: Request,
  keyId: string,
): Promise<Response> {
  // Authenticate via JWT
  const auth = await authenticateJwt(req);
  if (auth instanceof Response) return auth;

  const admin = getAdminClient();

  // Verify the key belongs to this user and is not already revoked
  const { data: existing, error: lookupError } = await admin
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("id", keyId)
    .single();

  if (lookupError || !existing) {
    return errorResponse("API key not found", 404);
  }

  if (existing.user_id !== auth.userId) {
    return errorResponse("API key not found", 404); // Don't reveal it exists
  }

  if (existing.revoked_at) {
    return errorResponse("API key is already revoked", 400);
  }

  // Soft-delete by setting revoked_at
  const { error: updateError } = await admin
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId);

  if (updateError) {
    console.error("Failed to revoke API key:", updateError.message);
    return errorResponse("Failed to revoke API key", 500);
  }

  return corsResponse({ success: true });
}

// --- Router -------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);
    // Path after /agent-api/ -- handle both /agent-api and /agent-api/
    const fullPath = url.pathname;
    const basePath = "/agent-api";
    let path = fullPath;

    // Strip the base path prefix if present
    if (fullPath.startsWith(basePath)) {
      path = fullPath.substring(basePath.length);
    }
    // Also handle when invoked directly via functions/v1/agent-api
    if (path === "" || path === "/") path = "/";

    // Remove trailing slash (except for root)
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }

    const method = req.method;
    const params = url.searchParams;

    // -- Public Event Routes ---------------------------------------------------

    if (method === "GET" && path === "/") {
      return corsResponse({
        name: "sheeets Agent API",
        version: "0.2.0",
        endpoints: {
          events: {
            "GET /events":
              "List/search events (?conference=, ?date=, ?tags=, ?search=, ?free=true, ?now=true)",
            "GET /events/:id": "Get single event by ID",
            "GET /events/conferences":
              "List conferences with event counts",
            "GET /events/tags": "List all unique tags with counts",
            "GET /events/dates": "List dates with event counts",
          },
          keys: {
            "POST /keys":
              "Create API key (JWT auth) — { name?, scopes? }",
            "GET /keys": "List your API keys (JWT auth, redacted)",
            "DELETE /keys/:id": "Revoke an API key (JWT auth)",
          },
        },
      });
    }

    if (method === "GET" && path === "/events") {
      return await handleGetEvents(params);
    }

    if (method === "GET" && path === "/events/conferences") {
      return await handleGetConferences();
    }

    if (method === "GET" && path === "/events/tags") {
      return await handleGetTags();
    }

    if (method === "GET" && path === "/events/dates") {
      return await handleGetDates();
    }

    // Event by ID -- must come after other /events/* routes
    if (method === "GET" && path.startsWith("/events/")) {
      const id = path.substring("/events/".length);
      if (id) {
        return await handleGetEventById(decodeURIComponent(id));
      }
    }

    // -- Key Management Routes (JWT auth) --------------------------------------

    if (method === "POST" && path === "/keys") {
      return await handleCreateKey(req);
    }

    if (method === "GET" && path === "/keys") {
      return await handleListKeys(req);
    }

    // DELETE /keys/:id
    if (method === "DELETE" && path.startsWith("/keys/")) {
      const keyId = path.substring("/keys/".length);
      if (keyId) {
        return await handleRevokeKey(req, decodeURIComponent(keyId));
      }
    }

    // -- 404 -------------------------------------------------------------------

    return errorResponse(`Not found: ${method} ${path}`, 404);
  } catch (err) {
    console.error("Agent API error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500);
  }
});
