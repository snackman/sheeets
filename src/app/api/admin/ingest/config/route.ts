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
import { listProfiles, getProfile, upsertProfile, seedProfileRow, listSources, createSource, updateSource, deleteSource } from '@/lib/ingest/db';
import { resolveLumaCalendar, fetchLumaIcalFeed, toIcalCandidates } from '@/lib/ingest/sources/luma-ical';
import { isPastEvent } from '@/lib/ingest/filters';
import { evaluateAutoPublishEnableGate } from '@/lib/ingest/gate';
import type { IngestProfileRow } from '@/lib/ingest/types';

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
    const base = existing ?? seedProfileRow(conference, patch.theme_key);

    // Phase 2 auto-publish gate, enforced server-side (plans/
    // event-ingestion.md §13.2): only a false -> true transition is
    // gated — saving other fields while it's already on (or saving it as
    // false) never needs to pass this. Re-enabling after the kill switch
    // fired clears the kill-switch record, same as a fresh enable.
    let gatedPatch: Partial<IngestProfileRow> = patch;
    if (patch.auto_publish_enabled === true && !existing?.auto_publish_enabled) {
      const gate = await evaluateAutoPublishEnableGate(conference);
      if (!gate.eligible) {
        return NextResponse.json(
          { error: `Cannot enable auto-publish yet: ${gate.reason}`, gate },
          { status: 400 }
        );
      }
      gatedPatch = { ...patch, auto_publish_killed_at: null, auto_publish_kill_reason: null };
    }

    const row = await upsertProfile({ ...base, ...gatedPatch, conference });
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
    const resolved = await resolveLumaCalendar(input);
    const source = await createSource({
      conference,
      kind,
      label: label || resolved.name || resolved.apiId,
      config: { calendar_api_id: resolved.apiId, calendar_slug: resolved.slug, calendar_name: resolved.name },
      trust: trust ?? 'curated',
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
