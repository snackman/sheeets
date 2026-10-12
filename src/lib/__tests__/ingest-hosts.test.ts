import { describe, it, expect } from 'vitest';
import { normalizeHostName, hostNamesMatch, hostListMatches } from '../ingest/hosts';
import type { TrustedHostEntry } from '../ingest/types';

describe('normalizeHostName', () => {
  it('trims and lowercases', () => {
    expect(normalizeHostName('  DeFi Collective  ')).toBe('defi collective');
  });
});

describe('hostNamesMatch', () => {
  it('matches exact (post-normalization) names', () => {
    expect(hostNamesMatch('DeFi Collective', 'defi collective')).toBe(true);
  });

  it('fuzzily matches a "The" prefix / trivial punctuation difference', () => {
    expect(hostNamesMatch('The DeFi Collective', 'DeFi Collective')).toBe(true);
    expect(hostNamesMatch('ETHGlobal', 'ETH Global')).toBe(false); // no shared tokens once split
  });

  it('does not match unrelated short names (low token overlap)', () => {
    expect(hostNamesMatch('ETH Denver', 'ETH Global')).toBe(false);
  });

  it('is false for empty/blank input', () => {
    expect(hostNamesMatch('', 'Something')).toBe(false);
    expect(hostNamesMatch('   ', 'Something')).toBe(false);
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

  it('matches organizer by fuzzy name (the Phase 2 follow-up)', () => {
    expect(hostListMatches(trustedList, { organizer: 'DeFi Collective', hosts: [] })).toBe(true);
  });

  it('matches a host (not just the organizer) by fuzzy name', () => {
    expect(hostListMatches(trustedList, { organizer: 'Someone Else', hosts: [{ name: 'DeFi Collective' }] })).toBe(true);
  });

  it('does not match an unrelated name', () => {
    expect(hostListMatches(trustedList, { organizer: 'Random Meetup Group', hosts: [] })).toBe(false);
  });
});
