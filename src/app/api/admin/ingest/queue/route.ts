// Admin Ingest review queue (§9.2). Modeled on /api/admin/claims: password
// auth, zod-validated body, service-role Supabase access.
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { isAdminPassword } from '@/lib/admin-auth';
import { parseBody, IngestQueueActionSchema } from '@/lib/api-validation';
import { getAllConferenceTabs } from '@/lib/get-conferences';
import { getSheetTitle, deleteSheetRow, readRange } from '@/lib/google-sheets';
import { normalizeEventLink } from '@/lib/luma';
import { generateEventId } from '@/lib/fetch-events';
import { invalidateEventsCache } from '@/lib/fetch-events-cached';
import {
  listCandidates,
  getCandidate,
  updateCandidate,
  insertLabel,
  getProfile,
  upsertProfile,
  profileRowToThemeProfile,
} from '@/lib/ingest/db';
import { toEventRow, ThrottledSheetPublisher } from '@/lib/ingest/publish';
import { scoreCandidate } from '@/lib/ingest/scoring';
import { THEME_REJECT_REASONS } from '@/lib/ingest/types';
import type { CandidateStatus, NormalizedEvent, TrustedHostEntry } from '@/lib/ingest/types';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get('password');
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = req.nextUrl.searchParams.get('status');
  const conference = req.nextUrl.searchParams.get('conference') || undefined;
  const source = req.nextUrl.searchParams.get('source') || undefined;
  const minScoreRaw = req.nextUrl.searchParams.get('minScore');
  const minScore = minScoreRaw ? Number(minScoreRaw) : undefined;

  const statuses: CandidateStatus[] | undefined = status && status !== 'all' ? [status as CandidateStatus] : undefined;

  try {
    const candidates = await listCandidates({ conference, status: statuses, sourceId: source, minScore, limit: 300 });
    return NextResponse.json({ candidates });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load queue' }, { status: 500 });
  }
}

function hostEntries(event: NormalizedEvent): TrustedHostEntry[] {
  const entries: TrustedHostEntry[] = event.hosts.map((h) => ({
    kind: 'luma_host' as const,
    id: h.apiId,
    name: h.name,
  }));
  if (event.organizer && !entries.some((e) => e.name.toLowerCase() === event.organizer.toLowerCase())) {
    entries.push({ kind: 'organizer', name: event.organizer });
  }
  return entries;
}

function mergeHostLists(existing: TrustedHostEntry[], toAdd: TrustedHostEntry[]): TrustedHostEntry[] {
  const seen = new Set(existing.map((e) => `${e.kind}:${(e.id || e.name).toLowerCase()}`));
  const merged = [...existing];
  for (const entry of toAdd) {
    const key = `${entry.kind}:${(entry.id || entry.name).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, IngestQueueActionSchema);
  if (parseError) return parseError;

  const { password, action, ids, reason, note, edits } = data;
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: { id: string; ok: boolean; error?: string }[] = [];
  let sheetChanged = false;

  for (const id of ids) {
    try {
      const candidate = await getCandidate(id);
      if (!candidate) {
        results.push({ id, ok: false, error: 'Not found' });
        continue;
      }

      if (action === 'approve') {
        const tabs = await getAllConferenceTabs();
        const tab = tabs.find((t) => t.name === candidate.conference);
        if (!tab) throw new Error(`No conference tab for "${candidate.conference}".`);
        const sheetTitle = await getSheetTitle(tab.gid);

        const event: NormalizedEvent =
          ids.length === 1 && edits
            ? {
                ...candidate.event,
                name: edits.name ?? candidate.event.name,
                sheetDate: edits.date ?? candidate.event.sheetDate,
                startTime: edits.startTime ?? candidate.event.startTime,
                endTime: edits.endTime ?? candidate.event.endTime,
                organizer: edits.organizer ?? candidate.event.organizer,
                address: edits.address ?? candidate.event.address,
                cost: edits.cost ?? candidate.event.cost,
              }
            : candidate.event;
        const tags = ids.length === 1 && edits?.tags ? edits.tags : candidate.llm_tags ?? [];

        const publisher = new ThrottledSheetPublisher(sheetTitle, tab.gid, { maxPerRun: 1, minIntervalMs: 0 });
        const sheetRow = await publisher.publish(toEventRow(event, tags));
        sheetChanged = true;

        const publishedEventId = generateEventId(candidate.conference, event.sheetDate, event.startTime, event.name);

        await updateCandidate(id, {
          status: 'approved' as CandidateStatus,
          sheet_row: sheetRow,
          published_event_id: publishedEventId,
          published_at: new Date().toISOString(),
          review_note: note ?? null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: 'admin',
          edits: ids.length === 1 && edits ? edits : null,
        });

        const profile = await getProfile(candidate.conference);
        await insertLabel({
          candidate_id: id,
          conference: candidate.conference,
          theme_key: profile?.theme_key ?? 'custom',
          label: 'on_theme',
          label_kind: 'theme',
          source: 'admin_review',
          reason: note ?? null,
          example: { name: event.name, hosts: event.hosts.map((h) => h.name) },
          model_score: candidate.llm_score,
          model_route: candidate.route,
        });
      } else if (action === 'reject') {
        if (!reason) throw new Error('reason is required to reject');
        await updateCandidate(id, {
          status: 'rejected' as CandidateStatus,
          reject_reason: reason,
          review_note: note ?? null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: 'admin',
        });

        const profile = await getProfile(candidate.conference);
        await insertLabel({
          candidate_id: id,
          conference: candidate.conference,
          theme_key: profile?.theme_key ?? 'custom',
          label: 'off_theme',
          label_kind: THEME_REJECT_REASONS.includes(reason) ? 'theme' : 'non_theme',
          source: 'admin_review',
          reason,
          example: { name: candidate.event.name, hosts: candidate.event.hosts.map((h) => h.name) },
          model_score: candidate.llm_score,
          model_route: candidate.route,
        });
      } else if (action === 'restore') {
        await updateCandidate(id, { status: 'queued' as CandidateStatus, reject_reason: null, reviewed_at: null, reviewed_by: null });
      } else if (action === 'rescore') {
        const profile = await getProfile(candidate.conference);
        if (!profile) throw new Error('No ingest profile for this conference.');
        const themeProfile = profileRowToThemeProfile(profile);
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const tabs = await getAllConferenceTabs();
        const tab = tabs.find((t) => t.name === candidate.conference);
        const startDate = tab?.dates?.[0] ?? candidate.event.dateISO;
        const endDate = tab?.dates?.[tab.dates.length - 1] ?? candidate.event.dateISO;

        const scoreResult = await scoreCandidate({
          client,
          profile: themeProfile,
          conference: { name: candidate.conference, startDate, endDate },
          event: {
            name: candidate.event.name,
            hosts: candidate.event.hosts.map((h) => h.name),
            calendarName: candidate.event.calendar?.name ?? null,
            organizer: candidate.event.organizer,
            venue: candidate.event.address || null,
            dateISO: candidate.event.dateISO,
            startTime: candidate.event.startTime,
            cost: candidate.event.cost,
            platform: candidate.event.platform,
            descriptionText: candidate.event.descriptionText,
          },
          isTrustedCalendarSource: false,
          isTrustedHost: false,
          isBlockedHost: false,
          sponsorMatch: null,
          includeKeywords: profile.include_keywords,
          excludeKeywords: profile.exclude_keywords,
          possibleDuplicate: !!candidate.possible_duplicate_of,
          noGeo: candidate.event.lat == null,
          sourceTrust: 'curated',
          publishThreshold: profile.publish_threshold,
          reviewThreshold: profile.review_threshold,
        });

        await updateCandidate(id, {
          status: scoreResult.route === 'reject' ? 'auto_rejected' : 'queued',
          llm_score: scoreResult.classifier.output.theme_score,
          llm_reason: scoreResult.classifier.output.reason,
          llm_tags: scoreResult.classifier.output.suggested_tags,
          llm_flags: scoreResult.classifier.output.flags,
          is_event: scoreResult.classifier.output.is_event,
          data_quality: scoreResult.classifier.output.data_quality,
          signal_breakdown: scoreResult.signals.breakdown,
          final_score: scoreResult.finalScore,
          route: scoreResult.route,
          shadow_route: scoreResult.shadowRoute,
          model: scoreResult.classifier.model,
          prompt_version: scoreResult.classifier.promptVersion,
          classified_at: new Date().toISOString(),
          classify_attempts: candidate.classify_attempts + 1,
        });
      } else if (action === 'unpublish') {
        if (!candidate.published_event_id && candidate.status !== 'auto_published' && candidate.status !== 'approved') {
          throw new Error('Candidate was not published.');
        }
        const tabs = await getAllConferenceTabs();
        const tab = tabs.find((t) => t.name === candidate.conference);
        if (!tab) throw new Error(`No conference tab for "${candidate.conference}".`);
        const sheetTitle = await getSheetTitle(tab.gid);
        const rows = await readRange(sheetTitle, 'A1:L');
        const linkKey = normalizeEventLink(candidate.event.link);
        const rowIdx = rows.findIndex((r) => normalizeEventLink(r[8] || '') === linkKey);
        if (rowIdx >= 0) {
          await deleteSheetRow(tab.gid, rowIdx);
          sheetChanged = true;
        }
        await updateCandidate(id, { status: 'unpublished' as CandidateStatus, reviewed_at: new Date().toISOString(), reviewed_by: 'admin' });

        const profile = await getProfile(candidate.conference);
        await insertLabel({
          candidate_id: id,
          conference: candidate.conference,
          theme_key: profile?.theme_key ?? 'custom',
          label: 'off_theme',
          label_kind: 'theme',
          source: 'admin_unpublish',
          reason: note ?? null,
          example: { name: candidate.event.name, hosts: candidate.event.hosts.map((h) => h.name) },
          model_score: candidate.llm_score,
          model_route: candidate.route,
        });
      } else if (action === 'trust_host' || action === 'block_host') {
        const profile = await getProfile(candidate.conference);
        const entries = hostEntries(candidate.event);
        if (action === 'trust_host') {
          await upsertProfile({ conference: candidate.conference, trusted_hosts: mergeHostLists(profile?.trusted_hosts ?? [], entries) });
        } else {
          await upsertProfile({ conference: candidate.conference, blocked_hosts: mergeHostLists(profile?.blocked_hosts ?? [], entries) });
        }
      }

      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
    }
  }

  if (sheetChanged) invalidateEventsCache();

  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ success: allOk, results });
}
