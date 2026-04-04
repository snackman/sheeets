import { describe, it, expect } from 'vitest';
import { hashString, assignVariant } from '../ab-testing';
import type { ABTestVariant } from '../types';

describe('hashString', () => {
  it('returns a number between 0 and 9999', () => {
    const result = hashString('test-input');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(10000);
  });

  it('is deterministic (same input = same output)', () => {
    const a = hashString('hello-world');
    const b = hashString('hello-world');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = hashString('test-a');
    const b = hashString('test-b');
    expect(a).not.toBe(b);
  });

  it('handles empty string', () => {
    const result = hashString('');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(10000);
  });

  it('handles long strings', () => {
    const longStr = 'a'.repeat(10000);
    const result = hashString(longStr);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(10000);
  });

  it('handles special characters', () => {
    const result = hashString('test:visitor:123!@#$%');
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThan(10000);
  });

  it('uses the testId:visitorId pattern deterministically', () => {
    const hash1 = hashString('test-1:visitor-abc');
    const hash2 = hashString('test-1:visitor-abc');
    expect(hash1).toBe(hash2);
  });
});

describe('assignVariant', () => {
  const variantA: ABTestVariant = {
    id: 'control',
    name: 'Control',
    weight: 50,
    config: {},
  };
  const variantB: ABTestVariant = {
    id: 'variant-a',
    name: 'Variant A',
    weight: 50,
    config: { color: 'blue' },
  };

  it('returns null for empty variants array', () => {
    expect(assignVariant('test-1', 'visitor-1', [])).toBeNull();
  });

  it('returns the only variant when there is just one', () => {
    const result = assignVariant('test-1', 'visitor-1', [variantA]);
    expect(result).toBe(variantA);
  });

  it('returns a variant for two variants (deterministic)', () => {
    const result = assignVariant('test-1', 'visitor-1', [variantA, variantB]);
    expect(result).not.toBeNull();
    expect([variantA.id, variantB.id]).toContain(result!.id);
  });

  it('is deterministic (same inputs = same variant)', () => {
    const a = assignVariant('test-1', 'visitor-1', [variantA, variantB]);
    const b = assignVariant('test-1', 'visitor-1', [variantA, variantB]);
    expect(a!.id).toBe(b!.id);
  });

  it('different visitors may get different variants', () => {
    // Test with many visitors to verify distribution
    const variants = [variantA, variantB];
    const assignments = new Map<string, number>();

    for (let i = 0; i < 1000; i++) {
      const result = assignVariant('test-1', `visitor-${i}`, variants);
      const count = assignments.get(result!.id) || 0;
      assignments.set(result!.id, count + 1);
    }

    // With 50/50 weights and 1000 visitors, both variants should get meaningful traffic
    expect(assignments.get('control')).toBeGreaterThan(100);
    expect(assignments.get('variant-a')).toBeGreaterThan(100);
  });

  it('respects heavily weighted variants', () => {
    const heavyA: ABTestVariant = { id: 'heavy', name: 'Heavy', weight: 90, config: {} };
    const lightB: ABTestVariant = { id: 'light', name: 'Light', weight: 10, config: {} };

    const assignments = new Map<string, number>();
    for (let i = 0; i < 1000; i++) {
      const result = assignVariant('test-weight', `visitor-${i}`, [heavyA, lightB]);
      const count = assignments.get(result!.id) || 0;
      assignments.set(result!.id, count + 1);
    }

    // Heavy variant should get significantly more traffic
    const heavyCount = assignments.get('heavy') || 0;
    const lightCount = assignments.get('light') || 0;
    expect(heavyCount).toBeGreaterThan(lightCount * 3);
  });

  it('handles three variants', () => {
    const v1: ABTestVariant = { id: 'a', name: 'A', weight: 33, config: {} };
    const v2: ABTestVariant = { id: 'b', name: 'B', weight: 34, config: {} };
    const v3: ABTestVariant = { id: 'c', name: 'C', weight: 33, config: {} };

    const result = assignVariant('test-3', 'visitor-1', [v1, v2, v3]);
    expect(result).not.toBeNull();
    expect(['a', 'b', 'c']).toContain(result!.id);
  });

  it('always returns a variant (never null) when variants exist', () => {
    for (let i = 0; i < 100; i++) {
      const result = assignVariant('any-test', `v-${i}`, [variantA, variantB]);
      expect(result).not.toBeNull();
    }
  });

  it('different test IDs can produce different assignments for same visitor', () => {
    const v1 = assignVariant('test-alpha', 'same-visitor', [variantA, variantB]);
    const v2 = assignVariant('test-beta', 'same-visitor', [variantA, variantB]);
    // They may or may not differ, but the function should work for both
    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
  });
});
