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
