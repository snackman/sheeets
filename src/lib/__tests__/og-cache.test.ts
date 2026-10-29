import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The og route can't export helpers (Next route files), so assert the cap is wired in.
describe('og route in-memory cache bound', () => {
  const src = readFileSync(resolve(__dirname, '../../app/api/og/route.ts'), 'utf8');
  it('evicts beyond a fixed max and never sets the Map directly', () => {
    expect(src).toMatch(/MEMORY_CACHE_MAX = 500/);
    expect(src).toMatch(/while \(memoryCache\.size > MEMORY_CACHE_MAX\)/);
    expect(src.match(/memoryCache\.set\(/g)?.length).toBe(1);
  });
});
