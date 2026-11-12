// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { readdirSync, statSync } from 'fs';
import { THEME_OPTIONS } from '../themes';

const css = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8');

/** Parse `selector { --x: y; }` blocks that define theme tokens. Later blocks for the same theme merge. */
function parseThemes(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const selectors = m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const ids = selectors.split(',').map((x) => x.trim()).map((x) => (x === ':root' ? 'root' : x === ':root:not([data-theme])' ? 'light-blue' : x.match(/^\[data-theme="([\w-]+)"\]$/)?.[1] ?? '')).filter(Boolean);
    if (!ids.length) continue;
    const decls: Record<string, string> = {};
    for (const d of m[2].replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls[d[1]] = d[2].trim();
    for (const id of ids) out[id] = { ...(out[id] ?? {}), ...decls };
  }
  return out;
}

const blocks = parseThemes();
const THEMES = THEME_OPTIONS.map((t) => t.id);

/** Theme tokens with :root as the base and var() references resolved. */
function resolve(theme: string): Record<string, string> {
  const base = { ...blocks['root'], ...blocks[theme] };
  const get = (k: string, depth = 0): string => {
    const v = base[k];
    if (v === undefined || depth > 10) return v;
    return v.replace(/var\((--[\w-]+)\)/g, (_, n) => get(n, depth + 1));
  };
  return Object.fromEntries(Object.keys(base).map((k) => [k, get(k)]));
}

type RGBA = [number, number, number, number];
function parseColor(c: string): RGBA {
  c = c.trim();
  let m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((x) => x + x).join('');
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = c.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  throw new Error(`Unparseable colour: ${c}`);
}
function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}
function lum([r, g, b]: RGBA): number {
  const f = (v: number) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(fgS: string, bgS: string, under: string): number {
  const base = over(parseColor(bgS), over(parseColor(under), [255, 255, 255, 1]));
  const fg = over(parseColor(fgS), base);
  const [a, b] = [lum(fg), lum(base)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const STATUS = ['success', 'danger', 'warn', 'info'];
const STATUS_SUFFIX = ['', '-hover', '-on', '-bg', '-text', '-border', '-dot'];
const REQUIRED = [
  'bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-card', 'text-primary', 'text-secondary', 'text-muted', 'text-faint',
  'accent', 'accent-text', 'accent-link', 'border-primary',
  ...STATUS.flatMap((s) => STATUS_SUFFIX.map((x) => `${s}${x}`)),
  'avatar-text', ...Array.from({ length: 10 }, (_, i) => `avatar-${i + 1}`),
  'marker-day', 'marker-tick', 'marker-badge-bg', 'marker-badge-text',
].map((k) => `--theme-${k}`);

describe('theme tokens', () => {
  it('finds a block for every theme', () => {
    expect(blocks['root']).toBeTruthy();
    for (const t of THEMES) expect(blocks[t], `block for ${t}`).toBeTruthy();
  });

  for (const t of THEMES) {
    it(`${t} defines every required token`, () => {
      const tokens = resolve(t);
      expect(REQUIRED.filter((k) => !tokens[k])).toEqual([]);
    });
  }

  it('the five core themes each define the status tokens themselves (not inherited)', () => {
    for (const t of ['dark', 'paper', 'light', 'light-blue', 'sxsw']) {
      const own = blocks[t];
      const missing = STATUS.flatMap((s) => STATUS_SUFFIX.map((x) => `--theme-${s}${x}`)).filter((k) => !(k in own));
      expect(missing, t).toEqual([]);
    }
  });

  for (const t of THEMES) {
    describe(`${t} contrast`, () => {
      const k = resolve(t);
      const pairs: [string, string, string, number][] = [];
      for (const bg of ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-card']) {
        for (const fg of ['text-primary', 'text-secondary', 'text-muted', 'text-faint', 'accent-link']) {
          pairs.push([`--theme-${fg}`, `--theme-${bg}`, '--theme-bg-primary', 4.5]);
        }
      }
      pairs.push(['--theme-accent-text', '--theme-accent', '--theme-bg-primary', 4.5]);
      pairs.push(['--theme-accent-link', '--theme-accent-muted', '--theme-bg-primary', 4.5]);
      pairs.push(['--theme-accent', '--theme-bg-primary', '--theme-bg-primary', 3]);
      for (const s of STATUS) {
        pairs.push([`--theme-${s}-on`, `--theme-${s}`, '--theme-bg-primary', 4.5]);
        pairs.push([`--theme-${s}-on`, `--theme-${s}-hover`, '--theme-bg-primary', 4.5]);
        for (const bg of ['bg-primary', 'bg-card']) {
          pairs.push([`--theme-${s}-text`, `--theme-${bg}`, '--theme-bg-primary', 4.5]);
          // tinted chip: text on top of the translucent tint over the page
          pairs.push([`--theme-${s}-text`, `--theme-${s}-bg`, `--theme-${bg}`, 4.5]);
        }
      }
      for (let i = 1; i <= 10; i++) pairs.push(['--theme-avatar-text', `--theme-avatar-${i}`, '--theme-bg-primary', 4.5]);
      for (const [fg, bg, under, min] of pairs) {
        it(`${fg} on ${bg}${bg.endsWith('-bg') ? ` over ${under}` : ''} >= ${min}:1`, () => {
          expect(ratio(k[fg], k[bg], k[under])).toBeGreaterThanOrEqual(min);
        });
      }
    });
  }
});

describe('every --theme-* token referenced in src resolves in every theme', () => {
  const SRC = path.resolve(__dirname, '../..');
  function walk(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== '__tests__') walk(p, out); }
      else if (/\.(tsx?|css)$/.test(f) && !/\.test\./.test(f)) out.push(p);
    }
    return out;
  }
  const used = new Map<string, string>();
  for (const f of walk(SRC)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/var\((--theme-[\w-]*[a-z0-9])(?![\w$-])/g)) if (!used.has(m[1])) used.set(m[1], path.relative(SRC, f));
  }
  it('finds referenced tokens', () => expect(used.size).toBeGreaterThan(50));
  for (const t of THEMES) {
    it(`${t}: no undefined or unresolved tokens`, () => {
      const k = resolve(t);
      const missing = [...used].filter(([n]) => !k[n] || k[n].includes('var(')).map(([n, f]) => `${n} (${f})`);
      expect(missing).toEqual([]);
    });
  }
});
