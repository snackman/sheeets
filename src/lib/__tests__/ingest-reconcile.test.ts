import { describe, it, expect, vi, beforeEach } from 'vitest';

const listCandidatesMock = vi.fn();
const updateCandidateMock = vi.fn();
const insertLabelMock = vi.fn();

vi.mock('../ingest/db', () => ({
  listCandidates: (...args: unknown[]) => listCandidatesMock(...args),
  updateCandidate: (...args: unknown[]) => updateCandidateMock(...args),
  insertLabel: (...args: unknown[]) => insertLabelMock(...args),
}));

import { reconcileConference } from '../ingest/reconcile';
import { buildSheetLinkIndex } from '../ingest/dedupe';

const tab = { gid: 1, name: 'Test Conf', slug: 'test', timezone: 'UTC', dates: ['2027-03-10'], center: { lat: 0, lng: 0 } };

function candidate(overrides: Partial<{ id: string; event: { link: string; name: string; hosts: { name: string }[] }; published_event_id: string | null }>) {
  return {
    id: 'cand-1',
    conference: 'Test Conf',
    status: 'auto_published',
    published_event_id: null,
    llm_score: 80,
    route: 'publish',
    event: { link: 'https://luma.com/event/evt-abc123def456', name: 'ETH Mixer', hosts: [{ name: 'Alice' }] },
    ...overrides,
  };
}

beforeEach(() => {
  listCandidatesMock.mockReset();
  updateCandidateMock.mockReset();
  insertLabelMock.mockReset();
});

describe('reconcileConference: skip guards (MEDIUM item 8)', () => {
  it('skips when the sheet read returned 0 events', async () => {
    listCandidatesMock.mockResolvedValue([candidate({})]);
    const linkIndex = await buildSheetLinkIndex([]);
    const result = await reconcileConference(tab, 'crypto', [], linkIndex);
    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toMatch(/0 events/);
    expect(updateCandidateMock).not.toHaveBeenCalled();
  });

  it('skips when the sheet read is suspiciously small vs. already-published candidates', async () => {
    const manyPublished = Array.from({ length: 10 }, (_, i) => candidate({ id: `cand-${i}`, event: { link: `https://luma.com/event/evt-${i}`, name: `Event ${i}`, hosts: [] } }));
    listCandidatesMock.mockResolvedValue(manyPublished);
    // Only 2 sheet events read back for 10 published candidates — suspicious.
    const sheetEvents = [{ id: 'e1', link: 'https://luma.com/event/evt-0' }, { id: 'e2', link: 'https://luma.com/event/evt-1' }];
    const linkIndex = await buildSheetLinkIndex(sheetEvents);
    const result = await reconcileConference(tab, 'crypto', sheetEvents, linkIndex);
    expect(result.skipped).toBe(true);
    expect(result.skippedReason).toMatch(/suspiciously small/);
    expect(updateCandidateMock).not.toHaveBeenCalled();
  });

  it('does NOT skip when the sheet read is a reasonable size vs. published candidates', async () => {
    listCandidatesMock.mockResolvedValue([candidate({})]);
    const sheetEvents = [{ id: 'evt-1', link: 'https://luma.com/event/evt-abc123def456' }];
    const linkIndex = await buildSheetLinkIndex(sheetEvents);
    const result = await reconcileConference(tab, 'crypto', sheetEvents, linkIndex);
    expect(result.skipped).toBe(false);
  });
});

describe('reconcileConference: link matching', () => {
  it('fills in published_event_id when found by link', async () => {
    listCandidatesMock.mockResolvedValue([candidate({ published_event_id: null })]);
    const sheetEvents = [{ id: 'evt-sheet-1', link: 'https://luma.com/event/evt-abc123def456' }];
    const linkIndex = await buildSheetLinkIndex(sheetEvents);
    const result = await reconcileConference(tab, 'crypto', sheetEvents, linkIndex);
    expect(result.linked).toBe(1);
    expect(updateCandidateMock).toHaveBeenCalledWith('cand-1', { published_event_id: 'evt-sheet-1' });
  });

  it('never flags a candidate whose link has no resolvable canonical key', async () => {
    listCandidatesMock.mockResolvedValue([candidate({ event: { link: '', name: 'No Link Event', hosts: [] } })]);
    const sheetEvents = [{ id: 'evt-sheet-1', link: 'https://luma.com/event/evt-other' }];
    const linkIndex = await buildSheetLinkIndex(sheetEvents);
    const result = await reconcileConference(tab, 'crypto', sheetEvents, linkIndex);
    expect(result.unpublishedExternal).toBe(0); // skipped, not flagged as removed
    expect(updateCandidateMock).not.toHaveBeenCalled();
    expect(insertLabelMock).not.toHaveBeenCalled();
  });

  it('marks a genuinely-removed candidate unpublished_external and writes an excluded-from-fewshot label', async () => {
    listCandidatesMock.mockResolvedValue([candidate({})]);
    const sheetEvents = [{ id: 'evt-sheet-1', link: 'https://luma.com/event/evt-totallydifferent999' }];
    const linkIndex = await buildSheetLinkIndex(sheetEvents);
    const result = await reconcileConference(tab, 'crypto', sheetEvents, linkIndex);
    expect(result.unpublishedExternal).toBe(1);
    expect(updateCandidateMock).toHaveBeenCalledWith('cand-1', { status: 'unpublished_external' });
    expect(insertLabelMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'sheet_removed', excluded_from_fewshot: true, label: 'off_theme' })
    );
  });
});

describe('reconcileConference: snapshot freshness', () => {
  it('does not unpublish a candidate approved/published after the sheet snapshot', async () => {
    const snapshotAt = new Date('2027-03-10T12:00:00Z');
    const late = { ...candidate({ id: 'cand-late' }), published_at: '2027-03-10T12:00:30Z', reviewed_at: '2027-03-10T12:00:30Z' };
    const early = { ...candidate({ id: 'cand-early', event: { link: 'https://luma.com/event/evt-gone999999', name: 'Gone', hosts: [] } }), published_at: '2027-03-10T11:00:00Z', reviewed_at: null };
    listCandidatesMock.mockResolvedValue([late, early]);
    // sheet has some other event only; both candidates are "absent"
    const sheetEvents = [{ id: 'evt-x', link: 'https://luma.com/event/evt-other111111' }];
    const linkIndex = await buildSheetLinkIndex(sheetEvents);
    const result = await reconcileConference(tab, 'crypto', sheetEvents, linkIndex, snapshotAt);
    expect(result.unpublishedExternal).toBe(1);
    expect(updateCandidateMock).toHaveBeenCalledTimes(1);
    expect(updateCandidateMock).toHaveBeenCalledWith('cand-early', { status: 'unpublished_external' });
    expect(insertLabelMock).toHaveBeenCalledTimes(1);
  });
});
