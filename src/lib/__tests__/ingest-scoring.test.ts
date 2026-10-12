import { describe, it, expect, vi } from 'vitest';
import { scoreCandidate } from '../ingest/scoring';
import { DEFAULT_THEME_PROFILES } from '../ingest/profiles';

function mockClient(score: number, isEvent = true) {
  return {
    chat: {
      completions: {
        parse: vi.fn(async () => ({
          choices: [
            {
              message: {
                parsed: {
                  is_event: isEvent,
                  theme_score: score,
                  data_quality: 'sufficient',
                  reason: 'ok',
                  suggested_tags: [],
                  flags: [],
                },
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        })),
      },
    },
  } as unknown as import('openai').default;
}

const profile = DEFAULT_THEME_PROFILES.crypto;
const conference = { name: 'Consensus Miami' };
const baseOpts = {
  profile,
  conference,
  event: { name: 'ETH Builders Mixer', descriptionText: 'Builders mixer' },
  isTrustedCalendarSource: false,
  isTrustedHost: false,
  isBlockedHost: false,
  includeKeywords: [],
  excludeKeywords: [],
  publishThreshold: 85,
  reviewThreshold: 40,
};

describe('scoreCandidate', () => {
  it('routes a high score from a curated source straight to publish', async () => {
    const result = await scoreCandidate({ ...baseOpts, client: mockClient(95), sourceTrust: 'curated' });
    expect(result.route).toBe('publish');
    expect(result.shadowRoute).toBe('publish');
  });

  it('caps a discovery-source candidate at review even with a publish-level score (§10 item 4)', async () => {
    const result = await scoreCandidate({ ...baseOpts, client: mockClient(95), sourceTrust: 'discovery' });
    expect(result.shadowRoute).toBe('publish'); // what the model/signals alone would do
    expect(result.route).toBe('review'); // what actually happens, capped by source trust
  });

  it('a host-source candidate is also eligible to publish (only discovery is capped)', async () => {
    const result = await scoreCandidate({ ...baseOpts, client: mockClient(95), sourceTrust: 'host' });
    expect(result.route).toBe('publish');
  });

  it('a discovery-source candidate that would route to review anyway is unaffected by the cap', async () => {
    const result = await scoreCandidate({ ...baseOpts, client: mockClient(50), sourceTrust: 'discovery' });
    expect(result.route).toBe('review');
    expect(result.shadowRoute).toBe('review');
  });

  it('is_event=false still rejects regardless of source trust', async () => {
    const result = await scoreCandidate({ ...baseOpts, client: mockClient(95, false), sourceTrust: 'curated' });
    expect(result.route).toBe('reject');
  });

  it('final score combines the llm score with signals', async () => {
    const result = await scoreCandidate({
      ...baseOpts,
      client: mockClient(70),
      sourceTrust: 'curated',
      isTrustedHost: true, // +20
    });
    expect(result.finalScore).toBe(90);
  });
});
