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
} from '@/lib/ingest/db';
import { resolveLumaCalendar, fetchLumaIcalFeed, toIcalCandidates } from '@/lib/ingest/sources/luma-ical';
import { isPastEvent } from '@/lib/ingest/filters';
import { evaluateAutoPublishEnableGate } from '@/lib/ingest/gate';
import type { IngestProfileRow, TrustedHostEntry } from '@/lib/ingest/types';

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
    return NextResponse.json({ profiles, sources, gate });
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
      // Review finding, CRITICAL item 3 ("gate bypass via ... discovery-
      // trust"): a `discovery` source never auto-publishes (§10 item 4,
      // capped at review regardless of score) — upgrading it to
      // 'curated'/'host' while auto-publish is enabled for its conference
      // would be a second way around the same gate the publish-threshold
      // check in PUT protects against. Same response: reject outright.
      const source = await getSource(id);
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
