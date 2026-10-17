// Admin "Proposed sources" (plan item 3, §9.1): list calendar
// auto-discovery proposals for a conference, and accept/dismiss one.
// Accepting creates the real curated `luma_ical` source (same effective
// trust logic as adding one by hand — `config/route.ts#POST`); dismissing
// only ever flips `status`, so `db.ts#upsertSourceProposal` never
// re-proposes it again, no matter how many future daily runs still find it
// eligible.
import { NextRequest, NextResponse } from 'next/server';
import { isAdminPassword, getAdminPassword } from '@/lib/admin-auth';
import { parseBody, IngestSourceProposalDecisionSchema } from '@/lib/api-validation';
import { listSourceProposals, getSourceProposalById, decideSourceProposal, createLumaIcalSourceIdempotent, getProfile, updateSource } from '@/lib/ingest/db';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const password = getAdminPassword(req);
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const conference = req.nextUrl.searchParams.get('conference');
  if (!conference) {
    return NextResponse.json({ error: 'conference is required' }, { status: 400 });
  }
  try {
    const proposals = await listSourceProposals(conference, 'proposed');
    return NextResponse.json({ proposals });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to load proposals' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { data, error: parseError } = await parseBody(req, IngestSourceProposalDecisionSchema);
  if (parseError) return parseError;
  const { password, id, decision } = data;
  if (!isAdminPassword(password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const proposal = await getSourceProposalById(id);
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }
    if (proposal.status !== 'proposed') {
      return NextResponse.json({ error: `This proposal was already ${proposal.status}.` }, { status: 400 });
    }

    let reenabled = false;
    if (decision === 'accepted') {
      // Same "a brand-new source with no track record never bypasses the
      // auto-publish gate" posture as `config/route.ts#POST`'s Luma-calendar
      // branch: if auto-publish is already on for this conference, the new
      // source is forced to `discovery` trust rather than refused outright.
      const profile = await getProfile(proposal.conference);
      const trust = profile?.auto_publish_enabled ? 'discovery' : 'curated';
      // Review finding, LOW item 5: this calendar may already exist as a
      // source (an admin added it by hand between the proposal's creation
      // and this Accept click, or a prior Accept attempt created the
      // source but failed before `decideSourceProposal` below) —
      // idempotent, so that's a no-op success, not a 500.
      const source = await createLumaIcalSourceIdempotent({
        conference: proposal.conference,
        label: proposal.calendar_name || proposal.calendar_api_id,
        calendar_api_id: proposal.calendar_api_id,
        calendar_name: proposal.calendar_name,
        trust,
        added_by: 'admin',
      });
      // Minor review finding: the existing source Accept just resolved to
      // (the idempotent-duplicate case above) might be DISABLED — an
      // admin turned it off at some point, or a prior partial Accept left
      // it that way. Accepting a proposal means "I want this calendar
      // running," so re-enable it rather than silently leaving it off
      // (the admin would otherwise see "accepted" and reasonably assume
      // it's live).
      if (!source.enabled) {
        await updateSource(source.id, { enabled: true });
        reenabled = true;
      }
    }

    await decideSourceProposal(id, decision, 'admin');
    return NextResponse.json({ success: true, ...(reenabled ? { reenabled: true } : {}) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to update proposal' }, { status: 500 });
  }
}
