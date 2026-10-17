// Admin Ingest config: profiles + sources CRUD, and resolving a Luma
// calendar URL before saving it as a source (§9.1).
import { NextRequest, NextResponse } from 'next/server';
import { isAdminPassword } from '@/lib/admin-auth';
import {
  parseBody,
  IngestProfileUpsertSchema,
  IngestSourceCreateSchema,
  IngestSourceUpdateSchema,
  IngestSourceDeleteSchema,
} from '@/lib/api-validation';
import {
  listProfiles,
  getProfile,
  upsertProfile,
  updateProfilePatch,
  seedProfileRow,
  listSources,
  createSource,
  updateSource,
  deleteSource,
  getSource,
  recordAdhocXCost,
} from '@/lib/ingest/db';
import { resolveLumaCalendar, fetchLumaIcalFeed, toIcalCandidates } from '@/lib/ingest/sources/luma-ical';
import { normalizeTelegramHandle } from '@/lib/ingest/sources/telegram';
import { normalizeXHandle, resolveXUser, isXConfigured, X_USER_READ_COST_USD } from '@/lib/ingest/sources/x';
import { isMeetupConfigured } from '@/lib/ingest/sources/meetup';
import { normalizeMiraSeriesSlug, fetchMiraSeriesMenu } from '@/lib/ingest/sources/mira';
import { parseSheetTrackerInput } from '@/lib/ingest/sources/sheet-tracker';
import { checkMonthlyXBudget } from '@/lib/ingest/budget';
import { isPastEvent } from '@/lib/ingest/filters';
import { evaluateAutoPublishEnableGate } from '@/lib/ingest/gate';
import type { IngestProfileRow, TrustedHostEntry } from '@/lib/ingest/types';

/** Parse the sponsor_pages "Add" input (one URL per line or comma-separated)
 *  into a deduped list of validated http(s) URLs (§Phase 4 item 2). */
function parseSponsorPageUrls(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of input.split(/[\n,]+/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      const u = new URL(trimmed);
      if (u.protocol === 'http:' || u.protocol === 'https:') seen.add(u.href);
    } catch {
      // Not a valid URL — skip it rather than failing the whole request;
      // if NOTHING parses, the caller below returns a 400.
    }
  }
  return Array.from(seen);
}

/** Admin-facing "is this source kind usable right now" map (§9.1 item 4:
 *  "Each source type shows whether it's configured") — purely env-var based,
 *  so the Config UI can show a "not configured"/"requires Meetup Pro"
 *  banner even before any source of that kind exists yet. */
function sourceAvailability() {
  return {
    luma_ical: true,
    telegram_channel: true,
    x_account: isXConfigured(),
    meetup_search: isMeetupConfigured(),
    sponsor_pages: true,
    mira_series: true,
    sheet_tracker: true,
  };
}

/** True if `next` contains any keyword not already in `existing`
 *  (case-insensitive) — used to tell "only removed items" (safe, always
 *  allowed: a removal only lowers scores) apart from "added items" (needs
 *  the auto-publish guard below — review finding, MEDIUM item 2b). */
function hasAddedKeywords(existing: string[], next: string[]): boolean {
  const existingSet = new Set(existing.map((k) => k.toLowerCase()));
  return next.some((k) => !existingSet.has(k.toLowerCase()));
}

function hostEntryKey(e: Pick<TrustedHostEntry, 'kind' | 'id' | 'name'>): string {
  return `${e.kind}:${(e.id || e.name).toLowerCase()}`;
}

/** Same "added vs. removed" distinction as `hasAddedKeywords`, for the
 *  trusted-hosts list. */
function hasAddedHostEntries(existing: TrustedHostEntry[], next: TrustedHostEntry[]): boolean {
  const existingKeys = new Set(existing.map(hostEntryKey));
  return next.some((e) => !existingKeys.has(hostEntryKey(e)));
}

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get('password');
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Mira "add a series" dropdown (§9.1): list every series Mira tracks so
  // the admin can pick one instead of hand-typing a slug.
  if (req.nextUrl.searchParams.get('listMiraSeries') != null) {
    try {
      const series = await fetchMiraSeriesMenu();
      return NextResponse.json({ series });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not load Mira series.' }, { status: 502 });
    }
  }

  const resolveInput = req.nextUrl.searchParams.get('resolveCalendar');
  if (resolveInput) {
    try {
      const resolved = await resolveLumaCalendar(resolveInput);
      let upcomingCount: number | null = null;
      try {
        const events = toIcalCandidates(await fetchLumaIcalFeed(resolved.apiId));
        upcomingCount = events.filter(
          (c) => !isPastEvent({ startAt: c.vevent.dtstartIsDateOnly ? `${c.vevent.dtstart}T00:00:00.000Z` : c.vevent.dtstart })
        ).length;
      } catch {
        // Feed fetch failing shouldn't block resolving the calendar id/name.
      }
      return NextResponse.json({ resolved, upcomingCount });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not resolve calendar' }, { status: 400 });
    }
  }

  const conference = req.nextUrl.searchParams.get('conference') || undefined;
  try {
    const [profiles, sources, gate] = await Promise.all([
      listProfiles(),
      listSources(conference),
      // The Phase 2 auto-publish gate (plans/event-ingestion.md §13.2):
      // computed whenever a specific conference is selected, so the Config
      // sub-tab can show the toggle as locked (with why) BEFORE an admin
      // ever tries to flip it — the PUT handler below is the actual
      // enforcement; this is just so the UI doesn't have to guess.
      conference ? evaluateAutoPublishEnableGate(conference) : Promise.resolve(null),
    ]);
    return NextResponse.json({ profiles, sources, gate, sourceAvailability: sourceAvailability() });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load config' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, IngestProfileUpsertSchema);
  if (parseError) return parseError;
  const { password, conference, ...patch } = data;
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const existing = await getProfile(conference);

    // Review finding, CRITICAL item 3 ("gate bypass via threshold"):
    // reject any change to `publish_threshold` while auto-publish is on,
    // OR in the SAME request that turns it on — otherwise an admin could
    // pass the gate at threshold 85, then immediately drop it to 40 (or
    // enable auto-publish and lower the threshold in one request), and
    // every subsequent "publish" decision would be measured against data
    // that was never evaluated at the new, laxer threshold. Rejecting
    // outright (rather than re-running the gate against the new threshold)
    // avoids having to recompute historical shadow routes, which were
    // stored against the OLD threshold, under a different one.
    const autoPublishIsOrWillBeOn = patch.auto_publish_enabled === true || (patch.auto_publish_enabled === undefined && !!existing?.auto_publish_enabled);
    if (
      autoPublishIsOrWillBeOn &&
      existing &&
      patch.publish_threshold !== undefined &&
      patch.publish_threshold !== existing.publish_threshold
    ) {
      return NextResponse.json(
        {
          error:
            'Cannot change the publish threshold while auto-publish is on (or being turned on in this request). ' +
            'Turn auto-publish off first, change the threshold, then re-enable once the gate is met again.',
        },
        { status: 400 }
      );
    }

    // Review finding, MEDIUM item 2b: block ADDING to `include_keywords`
    // or `trusted_hosts` while auto-publish is on (or being turned on in
    // this request) — both only ever RAISE scores (+5/keyword capped at
    // +15, +20 for a trusted host), so an admin could otherwise pass the
    // gate, then quietly pad either list to push borderline candidates
    // over the publish threshold. Picked "block" over "auto-disable and
    // record why" as the simplest option — it reuses the exact same
    // pattern as the publish_threshold guard above, with no new state to
    // track. REMOVING items is always allowed (it only lowers scores,
    // same as `exclude_keywords`/`blocked_hosts` edits, which this does
    // not touch at all).
    if (autoPublishIsOrWillBeOn && existing) {
      if (patch.include_keywords !== undefined && hasAddedKeywords(existing.include_keywords, patch.include_keywords)) {
        return NextResponse.json(
          {
            error:
              'Cannot add include keywords while auto-publish is on (or being turned on in this request) — ' +
              'that would raise scores without re-checking the gate. Removing keywords is fine. Turn auto-publish off first to add new ones.',
          },
          { status: 400 }
        );
      }
      if (patch.trusted_hosts !== undefined && hasAddedHostEntries(existing.trusted_hosts, patch.trusted_hosts)) {
        return NextResponse.json(
          {
            error:
              'Cannot add trusted hosts while auto-publish is on (or being turned on in this request) — ' +
              'that would raise scores without re-checking the gate. Removing trusted hosts is fine. Turn auto-publish off first to add new ones.',
          },
          { status: 400 }
        );
      }
    }

    const base = existing ?? seedProfileRow(conference, patch.theme_key);

    // Phase 2 auto-publish gate, enforced server-side (plans/
    // event-ingestion.md §13.2): only a false -> true transition is
    // gated — saving other fields while it's already on (or saving it as
    // false) never needs to pass this. Re-enabling after the kill switch
    // fired clears the kill-switch record and marks a fresh enable window
    // (review finding, HIGH item 2 — the kill switch only ever looks at
    // outcomes from after this timestamp, so a re-enable is never killed
    // immediately by a prior bad window's history).
    let gatedPatch: Partial<IngestProfileRow> = patch;
    if (patch.auto_publish_enabled === true && !existing?.auto_publish_enabled) {
      const gate = await evaluateAutoPublishEnableGate(conference);
      if (!gate.eligible) {
        return NextResponse.json(
          { error: `Cannot enable auto-publish yet: ${gate.reason}`, gate },
          { status: 400 }
        );
      }
      gatedPatch = {
        ...patch,
        auto_publish_killed_at: null,
        auto_publish_kill_reason: null,
        auto_publish_enabled_at: new Date().toISOString(),
      };
    }

    // Review finding, MEDIUM item 7 ("Config PUT race"): for an EXISTING
    // profile, write ONLY the patched fields — never resend the full row
    // we read above (`{...base, ...gatedPatch}`), which could silently
    // clobber a field changed concurrently (e.g. the kill switch flipping
    // `auto_publish_enabled` off mid-request). A brand-new profile has no
    // prior state to lose, so it still gets the full seeded `base`.
    const row = existing
      ? await updateProfilePatch(conference, gatedPatch)
      : await upsertProfile({ ...base, ...gatedPatch, conference });
    return NextResponse.json({ profile: row });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save profile' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, IngestSourceCreateSchema);
  if (parseError) return parseError;
  const { password, conference, kind, input, label, trust } = data;
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Phase 3: a `telegram_channel` source is ALWAYS `discovery` trust —
    // unlike Luma calendars, this is not conditional on whether
    // auto-publish happens to be on right now (§10 item 4: "discovery
    // sources ... max out at review until precision data justifies
    // otherwise", and the plan is explicit that Telegram never auto-
    // publishes in Phase 3 at all, independent of the gate). The PATCH
    // handler below enforces the same rule on updates.
    if (kind === 'telegram_channel') {
      const handle = normalizeTelegramHandle(input);
      if (!handle) {
        return NextResponse.json({ error: 'Invalid Telegram channel. Use a handle, @handle, or t.me/<handle> link.' }, { status: 400 });
      }
      const source = await createSource({
        conference,
        kind,
        label: label || `@${handle}`,
        config: { handle },
        trust: 'discovery',
        added_by: 'admin',
      });
      return NextResponse.json({ source });
    }

    // Phase 4 item 1 (§3.7/§10 item 4): an `x_account` source is ALWAYS
    // discovery trust, same posture as `telegram_channel` above — never
    // auto-published, independent of whatever `auto_publish_enabled` is
    // for this conference. Disabled unless `X_BEARER_TOKEN` is set (resolve
    // the handle NOW, at add-time, so a typo or an unconfigured token
    // surfaces immediately rather than silently producing a source that
    // can never run).
    if (kind === 'x_account') {
      const handle = normalizeXHandle(input);
      if (!handle) {
        return NextResponse.json({ error: 'Invalid X handle. Use a handle, @handle, or x.com/<handle> link.' }, { status: 400 });
      }
      if (!isXConfigured()) {
        return NextResponse.json({ error: 'X is not configured (X_BEARER_TOKEN is not set).' }, { status: 400 });
      }
      // Re-review item 9: `resolveXUser` is a billable "User: Read"
      // ($0.01) — check the SAME monthly X-spend cap a run checks (§3.7)
      // BEFORE spending it, not just after, and count it once spent.
      const xBudget = await checkMonthlyXBudget();
      if (xBudget.exceeded) {
        return NextResponse.json(
          { error: `X's monthly budget is exceeded ($${xBudget.spentUsd.toFixed(2)} / $${xBudget.capUsd.toFixed(2)}) — cannot resolve a new account until next month, or raise INGEST_X_MONTHLY_USD_CAP.` },
          { status: 400 }
        );
      }
      let resolved;
      try {
        resolved = await resolveXUser(handle);
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not resolve that X account.' }, { status: 400 });
      }
      await recordAdhocXCost(conference, X_USER_READ_COST_USD);
      const source = await createSource({
        conference,
        kind,
        label: label || `@${resolved.username}`,
        config: { handle: resolved.username, userId: resolved.id },
        trust: 'discovery',
        added_by: 'admin',
      });
      return NextResponse.json({ source });
    }

    // Phase 4 item 3 (§3.3/§10 item 4): a `meetup_search` source is ALWAYS
    // discovery trust. Disabled unless Meetup OAuth credentials are set —
    // adding one when they aren't is allowed (so Snax can prepare the
    // search ahead of getting Pro), but the pipeline/cron skip it cleanly
    // ("requires Meetup Pro") until they are.
    if (kind === 'meetup_search') {
      const query = input.trim();
      if (!query) {
        return NextResponse.json({ error: 'A search query is required.' }, { status: 400 });
      }
      const source = await createSource({
        conference,
        kind,
        label: label || query,
        config: { query },
        trust: 'discovery',
        added_by: 'admin',
      });
      return NextResponse.json({ source, warning: isMeetupConfigured() ? undefined : 'Meetup is not configured yet (requires Meetup Pro OAuth credentials) — this source will be skipped until it is.' });
    }

    // Phase 4 item 2 (§3.6/§10 item 4): a `sponsor_pages` source is ALWAYS
    // discovery trust. No credentials needed — accepts one or more URLs,
    // one per line or comma-separated, or an EMPTY input to discover pages
    // from this conference's own sponsors' websites at run time instead
    // (`sources/sponsor-pages.ts#resolveSponsorPageUrls`).
    if (kind === 'sponsor_pages') {
      const urls = parseSponsorPageUrls(input);
      if (urls.length === 0 && input.trim() !== '*') {
        return NextResponse.json(
          { error: 'Enter one or more event-page URLs (one per line), or "*" to discover pages from this conference\'s sponsors automatically.' },
          { status: 400 }
        );
      }
      const source = await createSource({
        conference,
        kind,
        label: label || (urls.length > 0 ? `${urls.length} sponsor page(s)` : 'Discovered from sponsors'),
        config: { urls },
        trust: 'discovery',
        added_by: 'admin',
      });
      return NextResponse.json({ source });
    }

    // A `mira_series` source is ALWAYS discovery trust. Accepts a bare
    // series slug or a `miragather.com/<slug>` URL — see
    // `normalizeMiraSeriesSlug`.
    if (kind === 'mira_series') {
      const seriesSlug = normalizeMiraSeriesSlug(input);
      if (!seriesSlug) {
        return NextResponse.json({ error: 'Invalid Mira series. Use a series slug or a miragather.com/<slug> link.' }, { status: 400 });
      }
      const source = await createSource({
        conference,
        kind,
        label: label || seriesSlug,
        config: { series_slug: seriesSlug },
        trust: 'discovery',
        added_by: 'admin',
      });
      return NextResponse.json({ source });
    }

    // A `sheet_tracker` source is ALWAYS discovery trust. Accepts a bare
    // sheet id or a full spreadsheet URL (optionally with `gid=`) — see
    // `parseSheetTrackerInput`.
    if (kind === 'sheet_tracker') {
      const parsed = parseSheetTrackerInput(input);
      if (!parsed) {
        return NextResponse.json({ error: 'Invalid Google Sheet. Use a sheet id or a docs.google.com/spreadsheets/d/<id>/... link.' }, { status: 400 });
      }
      const source = await createSource({
        conference,
        kind,
        label: label || `Sheet ${parsed.sheetId.slice(0, 8)}…${parsed.gid != null ? ` (gid ${parsed.gid})` : ''}`,
        config: { sheet_id: parsed.sheetId, ...(parsed.gid != null ? { gid: parsed.gid } : {}) },
        trust: 'discovery',
        added_by: 'admin',
      });
      return NextResponse.json({ source });
    }

    const profile = await getProfile(conference);
    // Review finding, MEDIUM item 2a: a brand-new source has no track
    // record of its own. If auto-publish is already on for this
    // conference, force it to 'discovery' trust (capped at review, §10
    // item 4 — never auto-publishes) regardless of what was requested,
    // rather than refusing to add it outright. It can be promoted once
    // auto-publish is off (the PATCH handler below blocks promoting a
    // source's trust while auto-publish is on, so there's no later way
    // around this either).
    const effectiveTrust = profile?.auto_publish_enabled ? 'discovery' : trust ?? 'curated';

    const resolved = await resolveLumaCalendar(input);
    const source = await createSource({
      conference,
      kind,
      label: label || resolved.name || resolved.apiId,
      config: { calendar_api_id: resolved.apiId, calendar_slug: resolved.slug, calendar_name: resolved.name },
      trust: effectiveTrust,
      added_by: 'admin',
    });
    return NextResponse.json({ source });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to add source' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, IngestSourceUpdateSchema);
  if (parseError) return parseError;
  const { password, id, ...patch } = data;
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    if (patch.trust !== undefined) {
      const source = await getSource(id);

      // Phase 3/4 (§10 item 4): a `telegram_channel`, `host_submission`,
      // `x_account`, `meetup_search` or `sponsor_pages` source is ALWAYS
      // `discovery` — this is the one case the PUT/POST "no changing trust
      // while auto-publish is on" guard below doesn't cover, because it
      // needs to hold even while auto-publish is OFF.
      const ALWAYS_DISCOVERY_KINDS = ['telegram_channel', 'host_submission', 'x_account', 'meetup_search', 'sponsor_pages', 'mira_series', 'sheet_tracker'];
      if (source && ALWAYS_DISCOVERY_KINDS.includes(source.kind) && patch.trust !== 'discovery') {
        return NextResponse.json(
          { error: `A ${source.kind} source is always discovery trust and can never auto-publish (plan §10).` },
          { status: 400 }
        );
      }

      // Review finding, CRITICAL item 3 ("gate bypass via ... discovery-
      // trust"): a `discovery` source never auto-publishes (§10 item 4,
      // capped at review regardless of score) — upgrading it to
      // 'curated'/'host' while auto-publish is enabled for its conference
      // would be a second way around the same gate the publish-threshold
      // check in PUT protects against. Same response: reject outright.
      if (source) {
        const profile = await getProfile(source.conference);
        if (profile?.auto_publish_enabled && patch.trust !== source.trust) {
          return NextResponse.json(
            {
              error:
                "Cannot change a source's trust level while auto-publish is enabled for this conference. " +
                'Turn auto-publish off first.',
            },
            { status: 400 }
          );
        }
      }
    }
    await updateSource(id, patch);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update source' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, IngestSourceDeleteSchema);
  if (parseError) return parseError;
  const { password, id } = data;
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await deleteSource(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to delete source' }, { status: 500 });
  }
}
