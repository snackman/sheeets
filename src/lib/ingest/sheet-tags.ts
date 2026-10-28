/**
 * The sheet's Tags column is a dropdown limited to exactly these values.
 * Anything written outside this list is rejected/ugly in the sheet, so every
 * tag headed for the sheet goes through `sanitizeSheetTags`.
 */
export const SHEET_TAGS = [
  'Networking',
  'Party',
  'Art',
  'Panel/Talk',
  'Bar/Pub',
  'Conference',
  'Performance',
  'Wellness',
  'Hackathon',
  'Brunch',
  'Dinner',
  'Devs/Builders',
  'VCs/Angels',
  'Jobs/Hiring',
  'DePIN',
  'AI',
  'DeFi',
  'NFTs',
  'Memecoins',
  'Ordinals',
  'BTC',
  'ETH',
  'SOL',
  'DAOs',
  'RWA',
  'Gaming',
] as const;

export type SheetTag = (typeof SHEET_TAGS)[number];

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

const ALIASES: Record<string, SheetTag> = {
  devs: 'Devs/Builders',
  developers: 'Devs/Builders',
  developer: 'Devs/Builders',
  builders: 'Devs/Builders',
  builder: 'Devs/Builders',
  'devs & builders': 'Devs/Builders',
  drinks: 'Bar/Pub',
  drink: 'Bar/Pub',
  'happy hour': 'Bar/Pub',
  bar: 'Bar/Pub',
  pub: 'Bar/Pub',
  panel: 'Panel/Talk',
  panels: 'Panel/Talk',
  talk: 'Panel/Talk',
  talks: 'Panel/Talk',
  'panel/talks': 'Panel/Talk',
  'panel / talk': 'Panel/Talk',
  'panel talk': 'Panel/Talk',
  'panel & talk': 'Panel/Talk',
  vcs: 'VCs/Angels',
  vc: 'VCs/Angels',
  investors: 'VCs/Angels',
  investor: 'VCs/Angels',
  angels: 'VCs/Angels',
  jobs: 'Jobs/Hiring',
  hiring: 'Jobs/Hiring',
  career: 'Jobs/Hiring',
  careers: 'Jobs/Hiring',
  // Submit-modal picker tags -> closest sheet tag
  workshop: 'Panel/Talk',
  session: 'Panel/Talk',
  education: 'Panel/Talk',
  'demo day': 'Panel/Talk',
  showcase: 'Panel/Talk',
  meetup: 'Networking',
  activation: 'Networking',
  founders: 'Devs/Builders',
  tech: 'Devs/Builders',
  lounge: 'Bar/Pub',
  music: 'Performance',
  comedy: 'Performance',
  screening: 'Performance',
  exhibition: 'Art',
  'film/tv': 'Art',
  culture: 'Art',
};

const CANONICAL = new Map<string, SheetTag>(SHEET_TAGS.map((t) => [norm(t), t]));

/** Map one raw tag to a canonical sheet tag, or null if it has no valid mapping. */
export function toSheetTag(raw: string): SheetTag | null {
  const k = norm(raw);
  return CANONICAL.get(k) ?? ALIASES[k] ?? null;
}

/** Canonicalize, drop unknowns, dedupe; preserves first-seen order. */
export function sanitizeSheetTags(tags: readonly string[] | null | undefined): SheetTag[] {
  const out: SheetTag[] = [];
  for (const t of tags ?? []) {
    if (typeof t !== 'string') continue;
    const c = toSheetTag(t);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Sanitize a comma-separated tag string (as stored on submissions / written to the sheet). */
export function sanitizeSheetTagString(tags: string | null | undefined): string {
  return sanitizeSheetTags(typeof tags === 'string' ? tags.split(/[,;|]/) : []).join(', ');
}
