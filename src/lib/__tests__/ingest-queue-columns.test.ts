import { describe, it, expect } from 'vitest';
import { QUEUE_LIST_COLUMNS } from '@/lib/ingest/db';

// Every top-level field operator scripts (gs/fetch-queues.sh) and the admin
// queue UI (IngestCandidateClient) read must stay in the default projection.
describe('QUEUE_LIST_COLUMNS', () => {
  const cols = QUEUE_LIST_COLUMNS.split(',');
  it.each([
    'id', 'event', 'final_score', 'llm_flags', 'possible_duplicate_of', // fetch-queues.sh
    'conference', 'canonical_key', 'source_kind', 'status', 'filter_reason', 'duplicate_of', 'llm_score',
    'llm_reason', 'llm_tags', 'data_quality', 'signal_breakdown', 'route', 'shadow_route',
    'published_event_id', 'first_seen_at', // IngestCandidateClient
  ])('includes %s', (c) => {
    expect(cols).toContain(c);
  });
  it('drops heavy internal columns', () => {
    for (const c of ['sources', 'alt_keys', 'content_hash', 'ical_hash']) expect(cols).not.toContain(c);
  });
});
