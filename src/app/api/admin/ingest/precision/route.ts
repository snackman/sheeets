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
  listRecentLabelMismatches,
  getProfile,
} from '@/lib/ingest/db';
import { checkMonthlyBudget } from '@/lib/ingest/budget';
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
    const [precisionRows, liveOutcomes, volumeBySource, budget, mismatches, profile] = await Promise.all([
      getPrecisionRows(conference),
      getRecentAutoPublishOutcomes(conference, AUTO_PUBLISH_MIN_SAMPLE_SIZE),
      getCandidateVolumeBySource(conference),
      checkMonthlyBudget(),
      listRecentLabelMismatches(conference, 10),
      getProfile(conference),
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
      budget,
      falsePositives: mismatches.falsePositives,
      falseNegatives: mismatches.falseNegatives,
      profile,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load precision data' }, { status: 500 });
  }
}
