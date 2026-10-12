import { describe, it, expect } from 'vitest';
import { normalizeHostName, hostNameTokens, hostNamesMatch, hostListMatches } from '../ingest/hosts';
import type { TrustedHostEntry } from '../ingest/types';

describe('normalizeHostName', () => {
  it('trims and lowercases', () => {
    expect(normalizeHostName('  DeFi Collective  ')).toBe('defi collective');
  });
});

describe('hostNameTokens (review finding, MEDIUM item 5)', () => {
  it('does NOT strip ordinary event-type words like "party"/"hour" (unlike dedupe.ts\'s event-name tokenizer)', () => {
    const tokens = hostNameTokens('Coinbase Happy Hour Party');
    expect(tokens.has('happy')).toBe(true);
    expect(tokens.has('hour')).toBe(true);
    expect(tokens.has('party')).toBe(true);
    expect(tokens.has('coinbase')).toBe(true);
  });

  it('strips generic org filler words (the/inc/llc/...)', () => {
    expect(hostNameTokens('The DeFi Collective, Inc.')).toEqual(new Set(['defi', 'collective']));
  });

  it('returns an empty set for pure emoji/punctuation (no vacuous tokens)', () => {
    expect(hostNameTokens('🎉🎉🎉').size).toBe(0);
    expect(hostNameTokens('---').size).toBe(0);
  });

  it('tokenizes non-Latin scripts using Unicode letter/number properties, not [a-z0-9]', () => {
    // Chinese "以太坊基金会" (Ethereum Foundation) — must not be stripped to nothing.
    const tokens = hostNameTokens('以太坊基金会');
    expect(tokens.size).toBeGreaterThan(0);
    // Cyrillic.
    expect(hostNameTokens('Крипто Клуб').size).toBeGreaterThan(0);
  });
});

describe('hostNamesMatch', () => {
  it('matches exact (post-normalization) names', () => {
    expect(hostNamesMatch('DeFi Collective', 'defi collective')).toBe(true);
  });

  it('matches via token containment: a short trusted name contained in a longer one', () => {
    expect(hostNamesMatch('The DeFi Collective', 'DeFi Collective')).toBe(true);
  });

  it('does not match unrelated short names (no meaningful token overlap)', () => {
    expect(hostNamesMatch('ETH Denver', 'ETH Global')).toBe(false);
  });

  it('is false for empty/blank input', () => {
    expect(hostNamesMatch('', 'Something')).toBe(false);
    expect(hostNamesMatch('   ', 'Something')).toBe(false);
  });

  it('two names that both tokenize to the empty set never match (review finding, MEDIUM item 5 — the vacuous-Jaccard bug)', () => {
    // Different emoji strings — normalizeHostName gives two different
    // non-empty strings (so the early exact-equality check doesn't fire),
    // but BOTH tokenize to an empty set. The old symmetric-Jaccard version
    // returned 1.0 ("a === b vacuously") for two empty sets; this must be
    // false.
    expect(hostNamesMatch('🎉🎉🎉', '🎊🎊🎊')).toBe(false);
    expect(hostNamesMatch('---', '***')).toBe(false);
  });

  it('a short, generic token (e.g. "ai", 2 chars) cannot single-handedly satisfy containment', () => {
    // "AI" alone is below the meaningful-token length floor and has no
    // non-Latin character, so it can never be the sole basis of a match —
    // this is the min-length rule the review asked for.
    expect(hostNamesMatch('AI', 'AI Summit Afterparty')).toBe(false);
  });

  it('a longer, specific trusted name still matches when genuinely contained', () => {
    expect(hostNamesMatch('DeFi Collective', 'DeFi Collective Afterparty')).toBe(true);
  });

  it('exact (post-normalization) match works for non-Latin scripts with no spaces (e.g. CJK)', () => {
    // No whitespace to tokenize on, so containment can't help here — but
    // the exact-equality fast path (before tokenizing at all) still
    // correctly matches the identical name.
    expect(hostNamesMatch('以太坊基金会', '以太坊基金会')).toBe(true);
    expect(hostNamesMatch('以太坊基金会', '比特币俱乐部')).toBe(false);
  });

  it('containment works for space-delimited non-Latin scripts (e.g. Cyrillic)', () => {
    expect(hostNamesMatch('Крипто Клуб', 'Крипто Клуб Майами')).toBe(true);
    expect(hostNamesMatch('Крипто Клуб', 'Совершенно другое имя')).toBe(false);
  });
});

describe('hostListMatches', () => {
  const trustedList: TrustedHostEntry[] = [{ kind: 'organizer', name: 'The DeFi Collective' }];

  it('returns false for an empty entry list', () => {
    expect(hostListMatches([], { organizer: 'Anyone', hosts: [] })).toBe(false);
  });

  it('matches by exact host api id regardless of name', () => {
    const entries: TrustedHostEntry[] = [{ kind: 'luma_host', id: 'usr-123', name: 'Some Display Name' }];
    expect(
      hostListMatches(entries, { organizer: 'Totally Different', hosts: [{ apiId: 'usr-123', name: 'Mismatched Name' }] })
    ).toBe(true);
  });

  it('matches organizer by token containment', () => {
    expect(hostListMatches(trustedList, { organizer: 'DeFi Collective', hosts: [] })).toBe(true);
  });

  it('matches a host (not just the organizer) by token containment', () => {
    expect(hostListMatches(trustedList, { organizer: 'Someone Else', hosts: [{ name: 'DeFi Collective' }] })).toBe(true);
  });

  it('does not match an unrelated name', () => {
    expect(hostListMatches(trustedList, { organizer: 'Random Meetup Group', hosts: [] })).toBe(false);
  });

  it('does not match an unrelated name that happens to be pure emoji', () => {
    expect(hostListMatches(trustedList, { organizer: '🎉🎉🎉', hosts: [] })).toBe(false);
  });
});
