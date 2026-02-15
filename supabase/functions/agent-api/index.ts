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
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
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

// --- Auth Module (infrastructure for future authenticated endpoints) ----------

interface AuthResult {
  userId: string;
  scopes: string[];
}

async function authenticateRequest(
  req: Request,
): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer shts_")) {
    return errorResponse(
      "Missing or invalid API key. Expected: Authorization: Bearer shts_...",
      401,
    );
  }

  const apiKey = authHeader.replace("Bearer ", "");

  // SHA-256 hash the key
  const encoder = new TextEncoder();
  const data = encoder.encode(apiKey);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const keyHash = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const admin = getAdminClient();

  // Look up key
  const { data: keyRecord, error } = await admin
    .from("api_keys")
    .select("*")
    .eq("key_hash", keyHash)
    .single();

  if (error || !keyRecord) {
    return errorResponse("Invalid API key", 401);
  }

  // Check if revoked
  if (keyRecord.revoked_at) {
    return errorResponse("API key has been revoked", 401);
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

  // Update last_used_at
  await admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", keyRecord.id);

  return {
    userId: keyRecord.user_id,
    scopes: keyRecord.scopes,
  };
}

// deno-lint-ignore no-unused-vars
function hasScope(auth: AuthResult, scope: string): boolean {
  return auth.scopes.includes(scope);
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
        version: "0.1.0",
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

    // -- 404 -------------------------------------------------------------------

    return errorResponse(`Not found: ${method} ${path}`, 404);
  } catch (err) {
    console.error("Agent API error:", err);
    const message =
      err instanceof Error ? err.message : "Internal server error";
    return errorResponse(message, 500);
  }
});
