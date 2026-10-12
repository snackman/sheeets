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

/**
 * `hostNamesMatch(candidateName, entryName)` is DIRECTIONAL (review
 * finding, HIGH item 1): `candidateName` is the event's host/organizer
 * name; `entryName` is the trusted/blocked list entry. Every test below
 * respects that argument order to match real usage in `hostListMatches`.
 */
describe('hostNamesMatch', () => {
  it('matches exact (post-normalization) names', () => {
    expect(hostNamesMatch('DeFi Collective', 'defi collective')).toBe(true);
  });

  it('matches full token-set equality regardless of word order or filler words', () => {
    expect(hostNamesMatch('The DeFi Collective', 'DeFi Collective')).toBe(true);
    expect(hostNamesMatch('Collective DeFi', 'DeFi Collective')).toBe(true); // reordered, still equal sets
  });

  it('does not match unrelated short names (no meaningful token overlap)', () => {
    expect(hostNamesMatch('ETH Denver', 'ETH Global')).toBe(false);
  });

  it('is false for empty/blank input', () => {
    expect(hostNamesMatch('', 'Something')).toBe(false);
    expect(hostNamesMatch('   ', 'Something')).toBe(false);
  });

  it('two names that both tokenize to the empty set never match (review finding, MEDIUM item 5 — the vacuous-Jaccard bug)', () => {
    expect(hostNamesMatch('🎉🎉🎉', '🎊🎊🎊')).toBe(false);
    expect(hostNamesMatch('---', '***')).toBe(false);
  });

  it('a short, generic token (e.g. "ai", 2 chars) cannot single-handedly satisfy containment', () => {
    expect(hostNamesMatch('AI Summit Afterparty', 'AI')).toBe(false);
  });

  describe('containment is directional: ENTRY contained in CANDIDATE, never the reverse (review finding, HIGH item 1)', () => {
    it('a longer, specific candidate host name matches a shorter trusted entry genuinely contained in it', () => {
      // Realistic case: the trusted entry is the org's own name; the
      // candidate is that org's display name for one specific event.
      expect(hostNamesMatch('DeFi Collective Afterparty', 'DeFi Collective')).toBe(true);
    });

    it('does NOT match when the CANDIDATE is the shorter one — a one-word candidate must never borrow a longer trusted entry\'s status', () => {
      // "Ethereum" (candidate) must not match trusted "Ethereum Foundation".
      expect(hostNamesMatch('Ethereum', 'Ethereum Foundation')).toBe(false);
      expect(hostNamesMatch('Foundation', 'Ethereum Foundation')).toBe(false);
    });

    it('does NOT match a longer candidate against a single-word, generic trusted entry ("Coinbase Fans Club" vs trusted "Coinbase")', () => {
      // The entry has only 1 meaningful token, so it can never satisfy the
      // >= 2 meaningful token requirement for the containment direction —
      // even though "Coinbase" IS literally a substring token of the
      // candidate's tokens.
      expect(hostNamesMatch('Coinbase Fans Club', 'Coinbase')).toBe(false);
    });

    it('DOES match a longer candidate against a two-word, specific trusted entry genuinely contained in it', () => {
      expect(hostNamesMatch('Coinbase Ventures Demo Day', 'Coinbase Ventures')).toBe(true);
    });

    it('never matches a strict-subset candidate even with many tokens on both sides', () => {
      // Candidate is short (1 meaningful token after filler removal) and a
      // strict subset of a much longer, unrelated-looking trusted entry.
      expect(hostNamesMatch('Labs', 'Coinbase Ventures Builder Labs International')).toBe(false);
    });
  });

  it('exact (post-normalization) match works for non-Latin scripts with no spaces (e.g. CJK)', () => {
    expect(hostNamesMatch('以太坊基金会', '以太坊基金会')).toBe(true);
    expect(hostNamesMatch('以太坊基金会', '比特币俱乐部')).toBe(false);
  });

  it('containment (entry-in-candidate) works for space-delimited non-Latin scripts (e.g. Cyrillic)', () => {
    // Entry "Крипто Клуб" (2 meaningful tokens) contained in the longer candidate.
    expect(hostNamesMatch('Крипто Клуб Майами', 'Крипто Клуб')).toBe(true);
    expect(hostNamesMatch('Совершенно другое имя', 'Крипто Клуб')).toBe(false);
  });
});

describe('hostListMatches — both directions, for both trusted and blocked lists (review finding, HIGH item 1)', () => {
  function entry(name: string): TrustedHostEntry[] {
    return [{ kind: 'organizer', name }];
  }

  it('returns false for an empty entry list', () => {
    expect(hostListMatches([], { organizer: 'Anyone', hosts: [] })).toBe(false);
  });

  it('matches by exact host api id regardless of name', () => {
    const entries: TrustedHostEntry[] = [{ kind: 'luma_host', id: 'usr-123', name: 'Some Display Name' }];
    expect(
      hostListMatches(entries, { organizer: 'Totally Different', hosts: [{ apiId: 'usr-123', name: 'Mismatched Name' }] })
    ).toBe(true);
  });

  describe('trusted list', () => {
    const trusted = entry('DeFi Collective');

    it('matches a longer event organizer name genuinely containing the trusted entry', () => {
      expect(hostListMatches(trusted, { organizer: 'DeFi Collective Afterparty', hosts: [] })).toBe(true);
    });

    it('matches a host (not just the organizer) by the same rule', () => {
      expect(hostListMatches(trusted, { organizer: 'Someone Else', hosts: [{ name: 'DeFi Collective Afterparty' }] })).toBe(true);
    });

    it('does NOT match when the event organizer name is a bare word that is a STRICT SUBSET of a longer trusted entry', () => {
      const trustedLong = entry('Ethereum Foundation');
      expect(hostListMatches(trustedLong, { organizer: 'Ethereum', hosts: [] })).toBe(false);
      expect(hostListMatches(trustedLong, { organizer: 'Foundation', hosts: [] })).toBe(false);
    });

    it('does NOT match a longer organizer name against a single-word trusted entry', () => {
      expect(hostListMatches(entry('Coinbase'), { organizer: 'Coinbase Fans Club', hosts: [] })).toBe(false);
    });

    it('does not match an unrelated name', () => {
      expect(hostListMatches(trusted, { organizer: 'Random Meetup Group', hosts: [] })).toBe(false);
    });

    it('does not match an unrelated name that happens to be pure emoji', () => {
      expect(hostListMatches(trusted, { organizer: '🎉🎉🎉', hosts: [] })).toBe(false);
    });
  });

  describe('blocked list (same directional rule applies — review finding is about hosts.ts generally, used for both lists)', () => {
    const blocked = entry('Spammy Promos');

    it('matches a longer event organizer name genuinely containing the blocked entry', () => {
      expect(hostListMatches(blocked, { organizer: 'Spammy Promos Afterparty', hosts: [] })).toBe(true);
    });

    it('does NOT match when the event organizer name is a bare word that is a strict subset of a longer blocked entry', () => {
      const blockedLong = entry('Spammy Promos International');
      expect(hostListMatches(blockedLong, { organizer: 'Spammy', hosts: [] })).toBe(false);
      expect(hostListMatches(blockedLong, { organizer: 'Promos', hosts: [] })).toBe(false);
    });

    it('does NOT match a longer organizer name against a single-word blocked entry', () => {
      expect(hostListMatches(entry('Spam'), { organizer: 'Spam Afterparty Collective', hosts: [] })).toBe(false);
    });
  });
});
