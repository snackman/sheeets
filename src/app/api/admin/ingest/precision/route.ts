// Admin Ingest Precision sub-tab data (Phase 2, plans/event-ingestion.md
// §11): per-conference precision at the publish threshold (shadow, pre-
// auto-publish), the real rolling auto-publish precision (post-enable),
// the review-queue approval rate, volume per source, LLM spend vs the
// monthly cap, and recent false positives/negatives for spot-checking.
import { NextRequest, NextResponse } from 'next/server';
import { isAdminPassword } from '@/lib/admin-auth';
import {
  getPrecisionRows,
  getRecentAutoPublishOutcomes,
  getCandidateVolumeBySource,
  getRunCostBySourceKind,
  listRecentLabelMismatches,
  getProfile,
} from '@/lib/ingest/db';
import { checkMonthlyBudget, checkMonthlyXBudget } from '@/lib/ingest/budget';
import {
  evaluateGate,
  summarizeShadowSample,
  summarizeRealOutcomeSample,
  summarizeReviewApproval,
  AUTO_PUBLISH_MIN_SAMPLE_SIZE,
} from '@/lib/ingest/gate';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const password = req.nextUrl.searchParams.get('password');
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const conference = req.nextUrl.searchParams.get('conference');
  if (!conference) {
    return NextResponse.json({ error: 'conference is required' }, { status: 400 });
  }

  try {
    // Fetched first (not in the Promise.all below) because the "live"
    // rolling sample needs to know the CURRENT enable window
    // (`auto_publish_enabled_at`) — same scoping the kill switch itself
    // uses, so the dashboard and the kill switch always agree (review
    // finding, HIGH item 2).
    const profile = await getProfile(conference);

    const [precisionRows, liveOutcomes, volumeBySource, costByKind, budget, xBudget, mismatches] = await Promise.all([
      getPrecisionRows(conference),
      getRecentAutoPublishOutcomes(conference, {
        limit: AUTO_PUBLISH_MIN_SAMPLE_SIZE,
        sinceIso: profile?.auto_publish_enabled_at ?? null,
      }),
      getCandidateVolumeBySource(conference),
      // Phase 4 (§9.1 item 4 / §11): "break out volume and cost per source
      // type" — [] if the Phase 4 migration hasn't been applied yet.
      getRunCostBySourceKind(conference),
      checkMonthlyBudget(),
      checkMonthlyXBudget(),
      listRecentLabelMismatches(conference, 10),
    ]);

    const shadow = summarizeShadowSample(precisionRows);
    const live = summarizeRealOutcomeSample(liveOutcomes);
    const review = summarizeReviewApproval(precisionRows);
    const gate = evaluateGate(shadow);

    return NextResponse.json({
      conference,
      gate,
      shadow,
      live,
      review,
      volumeBySource,
      costByKind,
      budget,
      xBudget,
      falsePositives: mismatches.falsePositives,
      falseNegatives: mismatches.falseNegatives,
      profile,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load precision data' }, { status: 500 });
  }
}
