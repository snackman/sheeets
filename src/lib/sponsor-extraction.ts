/**
 * Sponsor extraction pipeline — shared logic for crawling event pages
 * and extracting sponsor/partner information.
 *
 * Layers:
 *   1. Platform API data (Luma hosts/sponsors)
 *   2. HTML section detection (sponsor/partner headings + link/image grids)
 *   3. Description text mining ("Sponsored by X, Y, Z" patterns)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Platform = 'luma' | 'eventbrite' | 'partiful' | 'meetup' | 'posh' | 'unknown';

export type SponsorType = 'sponsor' | 'partner' | 'presenter' | 'host';
export type Confidence = 'high' | 'medium' | 'low';
export type ExtractionMethod = 'api' | 'json-ld' | 'html-section' | 'description';

export interface ExtractedSponsor {
  sponsor_name: string;
  sponsor_url: string | null;
  sponsor_logo_url: string | null;
  sponsor_type: SponsorType;
  confidence: Confidence;
  extraction_method: ExtractionMethod;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const USER_AGENT = 'Mozilla/5.0 (compatible; SheetsEventBot/1.0; +https://sheeets.com)';
const FETCH_TIMEOUT_MS = 8000;

/** Patterns to match sponsor/partner section headings or container IDs/classes */
const SPONSOR_HEADING_PATTERNS = [
  /sponsors?/i,
  /partners?/i,
  /supported\s+by/i,
  /presented\s+by/i,
  /brought\s+to\s+you\s+by/i,
  /powered\s+by/i,
  /collaborators?/i,
  /backed\s+by/i,
];

/** Patterns for extracting sponsors from description text */
const DESCRIPTION_PATTERNS = [
  // "Sponsored by X, Y, and Z"
  /(?:sponsored|presented|powered|supported|backed|hosted)\s+by\s+(.+?)(?:\.|$)/gi,
  // "Partners: X | Y | Z" or "Partners: X, Y, Z"
  /(?:sponsors?|partners?|collaborators?)\s*[:]\s*(.+?)(?:\n|\.|$)/gi,
  // "In partnership with X, Y"
  /in\s+(?:partnership|collaboration)\s+with\s+(.+?)(?:\.|$)/gi,
];

// Names to skip — generic/noise strings that are not real sponsors
const SKIP_NAMES = new Set([
  '', 'sponsor', 'sponsors', 'partner', 'partners', 'learn more',
  'click here', 'read more', 'view all', 'see all', 'more info',
  'our sponsors', 'our partners', 'event sponsors', 'event partners',
  'logo', 'image', 'link', 'website', 'home', 'about',
]);

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

export function detectPlatform(url: string): Platform {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');

    if (host === 'lu.ma' || host === 'luma.com') return 'luma';
    if (host.startsWith('eventbrite.')) return 'eventbrite';
    if (host === 'partiful.com') return 'partiful';
    if (host === 'meetup.com') return 'meetup';
    if (host === 'posh.vip') return 'posh';
  } catch {
    // invalid URL
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// HTML fetcher (standalone, no Next.js dependency)
// ---------------------------------------------------------------------------

export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }

  return res.text();
}

// ---------------------------------------------------------------------------
// Luma API fetcher
// ---------------------------------------------------------------------------

export function getLumaSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (
      u.hostname === 'lu.ma' ||
      u.hostname === 'luma.com' ||
      u.hostname === 'www.luma.com'
    ) {
      const slug = u.pathname.replace(/^\//, '').split('/')[0];
      return slug || null;
    }
  } catch {
    // invalid URL
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchLumaApi(slug: string): Promise<any> {
  const res = await fetch(`https://api.lu.ma/url?url=${encodeURIComponent(slug)}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Luma API returned HTTP ${res.status} for slug "${slug}"`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Layer 1: Luma API extraction
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractSponsorsFromLuma(apiData: any): ExtractedSponsor[] {
  const sponsors: ExtractedSponsor[] = [];

  if (!apiData?.data) return sponsors;

  const { hosts, event } = apiData.data;

  // Extract hosts as potential sponsors/presenters
  if (Array.isArray(hosts)) {
    for (const host of hosts) {
      const name = host.name?.trim();
      if (!name || isSkipName(name)) continue;

      sponsors.push({
        sponsor_name: name,
        sponsor_url: host.url || host.website || host.instagram_url || null,
        sponsor_logo_url: host.avatar_url || null,
        sponsor_type: 'host',
        confidence: 'high',
        extraction_method: 'api',
      });
    }
  }

  // Check for explicit sponsors/partners fields in the Luma event data
  const sponsorFields = ['sponsors', 'partners', 'collaborators'];
  for (const field of sponsorFields) {
    const items = event?.[field] || apiData.data?.[field];
    if (Array.isArray(items)) {
      for (const item of items) {
        const name = (typeof item === 'string' ? item : item?.name)?.trim();
        if (!name || isSkipName(name)) continue;

        const type: SponsorType = field === 'partners' ? 'partner' : 'sponsor';
        sponsors.push({
          sponsor_name: name,
          sponsor_url: typeof item === 'object' ? (item.url || item.website || null) : null,
          sponsor_logo_url: typeof item === 'object' ? (item.avatar_url || item.logo_url || null) : null,
          sponsor_type: type,
          confidence: 'high',
          extraction_method: 'api',
        });
      }
    }
  }

  // Also mine the event description text for sponsor mentions
  const description = event?.description || event?.description_mirror || '';
  if (description) {
    const descSponsors = extractSponsorsFromDescription(description);
    for (const ds of descSponsors) {
      // Only add if not already found via API fields
      if (!sponsors.some((s) => normalizeName(s.sponsor_name) === normalizeName(ds.sponsor_name))) {
        sponsors.push(ds);
      }
    }
  }

  return deduplicateSponsors(sponsors);
}

// ---------------------------------------------------------------------------
// Layer 2: HTML section detection
// ---------------------------------------------------------------------------

/**
 * Find a sponsor/partner section in HTML and extract names + URLs.
 */
export function findSponsorSection(html: string): string | null {
  // Strategy 1: Look for elements with sponsor/partner in class or id
  const classIdRegex = /<(?:div|section|aside|ul|ol|footer)[^>]*(?:class|id)=["'][^"']*(?:sponsor|partner)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|section|aside|ul|ol|footer)>/gi;
  let match = classIdRegex.exec(html);
  if (match) return match[0];

  // Strategy 2: Look for headings containing sponsor/partner keywords, then grab the next sibling content
  const headingRegex = /<(h[1-6])[^>]*>[^<]*(?:sponsors?|partners?|supported\s+by|presented\s+by|powered\s+by|brought\s+to\s+you\s+by)[^<]*<\/\1>/gi;
  match = headingRegex.exec(html);
  if (match) {
    // Grab up to 3000 chars after the heading to capture the section content
    const startIdx = match.index;
    const sectionSlice = html.slice(startIdx, startIdx + 3000);
    return sectionSlice;
  }

  // Strategy 3: Look for <strong>/<b> tags with sponsor keywords (common in descriptions)
  const strongRegex = /<(?:strong|b)>[^<]*(?:sponsors?|partners?|supported\s+by|presented\s+by|powered\s+by)[^<]*<\/(?:strong|b)>/gi;
  match = strongRegex.exec(html);
  if (match) {
    const startIdx = match.index;
    const sectionSlice = html.slice(startIdx, startIdx + 2000);
    return sectionSlice;
  }

  return null;
}

/**
 * Extract sponsor names from an HTML section.
 * Looks for <a> tags (name from text, URL from href) and <img> tags (name from alt).
 */
export function extractSponsorNames(sectionHtml: string): ExtractedSponsor[] {
  const sponsors: ExtractedSponsor[] = [];
  const seenNames = new Set<string>();

  // Extract from <a> tags
  const linkRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(sectionHtml)) !== null) {
    const href = match[1];
    const innerHtml = match[2];

    // Get text content from the link (strip HTML tags)
    let name = innerHtml.replace(/<[^>]+>/g, '').trim();

    // If no text, try to get alt from an inner <img>
    if (!name) {
      const imgMatch = innerHtml.match(/<img[^>]+alt=["']([^"']+)["']/i);
      if (imgMatch) name = imgMatch[1].trim();
    }

    if (!name || isSkipName(name)) continue;

    const normalized = normalizeName(name);
    if (seenNames.has(normalized)) continue;
    seenNames.add(normalized);

    // Extract logo URL from inner <img src="">
    let logoUrl: string | null = null;
    const imgSrcMatch = innerHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgSrcMatch) logoUrl = imgSrcMatch[1];

    sponsors.push({
      sponsor_name: name,
      sponsor_url: href.startsWith('http') ? href : null,
      sponsor_logo_url: logoUrl,
      sponsor_type: guessSponsorType(sectionHtml),
      confidence: 'medium',
      extraction_method: 'html-section',
    });
  }

  // Extract from standalone <img alt=""> tags (logo grids without links)
  const imgRegex = /<img[^>]+alt=["']([^"']+)["'][^>]*>/gi;
  while ((match = imgRegex.exec(sectionHtml)) !== null) {
    const name = match[1].trim();
    if (!name || isSkipName(name)) continue;

    const normalized = normalizeName(name);
    if (seenNames.has(normalized)) continue;
    seenNames.add(normalized);

    // Get the src as logo URL
    const srcMatch = match[0].match(/src=["']([^"']+)["']/i);

    sponsors.push({
      sponsor_name: name,
      sponsor_url: null,
      sponsor_logo_url: srcMatch ? srcMatch[1] : null,
      sponsor_type: guessSponsorType(sectionHtml),
      confidence: 'medium',
      extraction_method: 'html-section',
    });
  }

  return sponsors;
}

/**
 * Full HTML extraction: find sponsor section + extract names.
 */
export function extractSponsorsFromHtml(html: string, _url: string): ExtractedSponsor[] {
  const allSponsors: ExtractedSponsor[] = [];

  // Layer 1.5: JSON-LD structured data (organizer/sponsor fields)
  const jsonLdSponsors = extractSponsorsFromJsonLd(html);
  allSponsors.push(...jsonLdSponsors);

  // Layer 2: HTML section detection
  const section = findSponsorSection(html);
  if (section) {
    const sectionSponsors = extractSponsorNames(section);
    allSponsors.push(...sectionSponsors);
  }

  // Layer 3: Description text mining
  // Try to find description content: <meta property="og:description"> or common description containers
  const ogDescMatch = html.match(
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i
  ) || html.match(
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i
  );
  if (ogDescMatch) {
    const descSponsors = extractSponsorsFromDescription(decodeHtmlEntities(ogDescMatch[1]));
    allSponsors.push(...descSponsors);
  }

  // Also mine the full body text for sponsor patterns (within reason)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    const bodyText = bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // Only process a reasonable chunk to avoid false positives
    const descSponsors = extractSponsorsFromDescription(bodyText.slice(0, 10000));
    allSponsors.push(...descSponsors);
  }

  return deduplicateSponsors(allSponsors);
}

// ---------------------------------------------------------------------------
// Layer 1.5: JSON-LD sponsor extraction
// ---------------------------------------------------------------------------

function extractSponsorsFromJsonLd(html: string): ExtractedSponsor[] {
  const sponsors: ExtractedSponsor[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;

  while ((scriptMatch = regex.exec(html)) !== null) {
    try {
      const json = JSON.parse(scriptMatch[1]);
      const items = Array.isArray(json) ? json : [json];

      for (const item of items) {
        const candidates = item['@graph'] ? [...item['@graph'], item] : [item];

        for (const candidate of candidates) {
          // Look for sponsor/funder/organizer fields in JSON-LD
          const sponsorFields = ['sponsor', 'funder', 'contributor'];
          for (const field of sponsorFields) {
            const val = candidate[field];
            if (!val) continue;

            const entries = Array.isArray(val) ? val : [val];
            for (const entry of entries) {
              const name = (typeof entry === 'string' ? entry : entry?.name)?.trim();
              if (!name || isSkipName(name)) continue;

              sponsors.push({
                sponsor_name: name,
                sponsor_url: typeof entry === 'object' ? (entry.url || null) : null,
                sponsor_logo_url: typeof entry === 'object' ? (entry.logo || entry.image || null) : null,
                sponsor_type: field === 'sponsor' ? 'sponsor' : 'partner',
                confidence: 'high',
                extraction_method: 'json-ld',
              });
            }
          }

          // Also check organizer as a host-type sponsor
          const org = candidate.organizer;
          if (org) {
            const entries = Array.isArray(org) ? org : [org];
            for (const entry of entries) {
              const name = (typeof entry === 'string' ? entry : entry?.name)?.trim();
              if (!name || isSkipName(name)) continue;

              sponsors.push({
                sponsor_name: name,
                sponsor_url: typeof entry === 'object' ? (entry.url || null) : null,
                sponsor_logo_url: null,
                sponsor_type: 'host',
                confidence: 'high',
                extraction_method: 'json-ld',
              });
            }
          }
        }
      }
    } catch {
      // Ignore invalid JSON-LD blocks
    }
  }

  return sponsors;
}

// ---------------------------------------------------------------------------
// Layer 3: Description text mining
// ---------------------------------------------------------------------------

function extractSponsorsFromDescription(text: string): ExtractedSponsor[] {
  const sponsors: ExtractedSponsor[] = [];
  const seenNames = new Set<string>();

  for (const pattern of DESCRIPTION_PATTERNS) {
    // Reset the regex lastIndex for each use
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const rawList = match[1];
      // Split by common delimiters: comma, pipe, ampersand, "and", semicolon
      const names = rawList
        .split(/[,|;&]|\band\b/i)
        .map((n) => n.trim())
        .filter((n) => n.length > 1 && n.length < 80);

      for (const name of names) {
        const cleaned = name.replace(/[.!?]+$/, '').trim();
        if (!cleaned || isSkipName(cleaned)) continue;

        const normalized = normalizeName(cleaned);
        if (seenNames.has(normalized)) continue;
        seenNames.add(normalized);

        sponsors.push({
          sponsor_name: cleaned,
          sponsor_url: null,
          sponsor_logo_url: null,
          sponsor_type: guessTypeFromContext(match[0]),
          confidence: 'low',
          extraction_method: 'description',
        });
      }
    }
  }

  return sponsors;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSkipName(name: string): boolean {
  return SKIP_NAMES.has(name.toLowerCase().trim()) || name.length < 2 || name.length > 100;
}

function guessSponsorType(sectionHtml: string): SponsorType {
  const lower = sectionHtml.toLowerCase();
  if (/partner/i.test(lower)) return 'partner';
  if (/present(?:ed|er|ing)/i.test(lower)) return 'presenter';
  if (/host/i.test(lower)) return 'host';
  return 'sponsor';
}

function guessTypeFromContext(matchedText: string): SponsorType {
  const lower = matchedText.toLowerCase();
  if (lower.includes('partner')) return 'partner';
  if (lower.includes('present')) return 'presenter';
  if (lower.includes('host')) return 'host';
  return 'sponsor';
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

/**
 * Deduplicate sponsors by normalized name, keeping the highest-confidence entry.
 */
function deduplicateSponsors(sponsors: ExtractedSponsor[]): ExtractedSponsor[] {
  const confidenceRank: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };
  const map = new Map<string, ExtractedSponsor>();

  for (const s of sponsors) {
    const key = normalizeName(s.sponsor_name);
    const existing = map.get(key);
    if (!existing || confidenceRank[s.confidence] > confidenceRank[existing.confidence]) {
      // Merge: keep best URL/logo from either
      map.set(key, {
        ...s,
        sponsor_url: s.sponsor_url || existing?.sponsor_url || null,
        sponsor_logo_url: s.sponsor_logo_url || existing?.sponsor_logo_url || null,
      });
    }
  }

  return Array.from(map.values());
}
