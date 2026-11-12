// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

/**
 * Guards the theme system: user-facing code must use --theme-* / semantic status tokens
 * (bg-success-bg, text-danger-text, ...) instead of Tailwind palette colours or raw hex.
 */
const ROOT = path.resolve(__dirname, '../..');

// Files/dirs that intentionally keep fixed colours.
const ALLOW: RegExp[] = [
  /^components\/admin\//, // admin tooling is a fixed dark UI (lower priority)
  /^app\/admin\//,
  /^app\/api\//, // developer docs page + API routes: standalone fixed-dark page
  /^app\/ads\//, // advertiser marketing page: fixed dark design
  /^app\/global-error\.tsx$/, // renders outside the theme provider
  /^components\/ShareCard/, // render fixed-colour share images
  /^components\/LockScreen/,
  /^components\/OGImage\.tsx$/,
  /__tests__/,
];

const PALETTE =
  /\b(?:bg|text|border|ring|from|to|via|divide|fill|stroke|outline|decoration|shadow|accent|caret|placeholder)-(?:red|green|amber|blue|purple|emerald|yellow|orange|pink|rose|teal|cyan|indigo|violet|sky|lime|fuchsia|stone|slate|gray|zinc|neutral)-\d{2,3}\b/;
const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/;

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

describe('no hardcoded colours in themed UI', () => {
  const files = [...walk(path.join(ROOT, 'components')), ...walk(path.join(ROOT, 'app'))]
    .map((p) => ({ p, rel: path.relative(ROOT, p).split(path.sep).join('/') }))
    .filter((f) => !ALLOW.some((re) => re.test(f.rel)));

  it('scans a meaningful number of files', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('has no Tailwind palette colour classes or raw hex values', () => {
    const offenders: string[] = [];
    for (const { p, rel } of files) {
      readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (PALETTE.test(line) || HEX.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('has no sub-10px type sizes or rounded-md', () => {
    const offenders: string[] = [];
    for (const { p, rel } of files) {
      const src = readFileSync(p, 'utf8');
      if (/text-\[(?:[0-9]|10|11)px\]|\brounded-md\b/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });
});
