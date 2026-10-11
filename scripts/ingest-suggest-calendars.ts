/**
 * Suggest pilot Luma calendars for a conference (plan §17.7, open decision 7).
 *
 * Rather than hardcoding pilot sources, this looks at an upcoming
 * conference's EXISTING sheet events, finds the ones with a Luma link,
 * resolves each to its hosting calendar (`cal-…` id, read from the full
 * Luma event payload), and ranks calendars by how many of the conference's
 * own events they host. A calendar that already hosts several of the
 * events curators have manually added is a strong candidate for an
 * `ingest_sources` row — curators already trust it.
 *
 * Read-only: prints suggestions, never writes `ingest_sources` or anything
 * else. Needs `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (for the
 * dynamic conference list; falls back to `FALLBACK_TABS` without them) and
 * network access to the sheet + api.lu.ma. No OpenAI key needed.
 *
 *   npx tsx scripts/ingest-suggest-calendars.ts [--conference "Name"] [--top N]
 *
 * Without `--conference`, picks the soonest conference that hasn't ended yet
 * (active or upcoming-hidden) — same selection the task asked for ("the
 * soonest upcoming conference").
 */
import fs from 'node:fs';
import path from 'node:path';

// Minimal .env.local loader so this runs standalone via `npx tsx`, same env
// vars the Next.js app reads (no dotenv dependency added).
function loadEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key] !== undefined) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvLocal();

async function main() {
  const { getAllConferenceTabs } = await import('../src/lib/get-conferences');
  const { fetchEvents } = await import('../src/lib/fetch-events');
  const { getValidLumaSlug, LUMA_EVENT_API_ID_RE } = await import('../src/lib/luma');
  const { fetchLumaEvent, LumaFetchError } = await import('../src/lib/luma-server');

  const args = process.argv.slice(2);
  const conferenceArg = args.includes('--conference') ? args[args.indexOf('--conference') + 1] : null;
  const topN = args.includes('--top') ? Number(args[args.indexOf('--top') + 1]) : 10;

  const tabs = await getAllConferenceTabs();
  const todayISO = new Date().toISOString().slice(0, 10);

  let tab = conferenceArg ? tabs.find((t) => t.name === conferenceArg) : undefined;
  if (!tab) {
    const upcoming = tabs
      .filter((t) => t.dates[t.dates.length - 1] >= todayISO)
      .sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
    tab = upcoming[0];
  }
  if (!tab) {
    console.error('No upcoming conference found.');
    process.exit(1);
  }

  console.log(`Conference: ${tab.name} (${tab.dates[0]} to ${tab.dates[tab.dates.length - 1]})`);

  const events = await fetchEvents(undefined, [tab]);
  const lumaEvents = events.filter((e) => !!getValidLumaSlug(e.link) || LUMA_EVENT_API_ID_RE.test((e.link.match(/event\/(evt-[A-Za-z0-9]+)/) || [])[1] || ''));
  console.log(`${events.length} sheet events, ${lumaEvents.length} with a Luma link.`);

  const calendarCounts = new Map<string, { name: string; count: number; examples: string[] }>();
  let resolved = 0;
  let failed = 0;

  for (const e of lumaEvents) {
    const evtIdMatch = e.link.match(/event\/(evt-[A-Za-z0-9]+)/);
    const ref = evtIdMatch ? { apiId: evtIdMatch[1] } : { slug: getValidLumaSlug(e.link)! };

    try {
      // Rate-limited (1/sec), same policy as the pipeline's enrichment calls (§3.1).
      await new Promise((r) => setTimeout(r, 1000));
      const payload = (await fetchLumaEvent(ref)) as {
        calendar?: { api_id?: string; name?: string };
        calendar_api_id?: string;
      };
      const calApiId = payload.calendar?.api_id || payload.calendar_api_id;
      if (!calApiId) continue;
      resolved++;
      const entry = calendarCounts.get(calApiId) ?? { name: payload.calendar?.name || calApiId, count: 0, examples: [] };
      entry.count++;
      if (entry.examples.length < 3) entry.examples.push(e.name);
      calendarCounts.set(calApiId, entry);
    } catch (err) {
      failed++;
      if (!(err instanceof LumaFetchError)) console.error(`  error on "${e.name}":`, err);
    }
  }

  console.log(`Resolved ${resolved} events to a hosting calendar (${failed} failed/had none).\n`);

  const ranked = Array.from(calendarCounts.entries())
    .map(([apiId, v]) => ({ apiId, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);

  console.log(`Top ${ranked.length} calendar suggestions for "${tab.name}":\n`);
  for (const r of ranked) {
    console.log(`  ${r.count}x  ${r.name}  (${r.apiId})`);
    for (const ex of r.examples) console.log(`        e.g. "${ex}"`);
  }

  if (ranked.length === 0) {
    console.log('  No calendars resolved — this conference may have few/no Luma-linked events in the sheet yet.');
  }

  console.log('\n(Read-only: nothing was written to ingest_sources. Add these from the admin Ingest > Config tab if they look right.)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
