/** Luma URL detection and slug extraction utilities */

const LUMA_DOMAINS = ['lu.ma', 'luma.com', 'www.lu.ma', 'www.luma.com'];

/** Check if a URL is a Luma event link */
export function isLumaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return LUMA_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d)
    );
  } catch {
    // Try matching without protocol
    return LUMA_DOMAINS.some((d) => url.includes(d + '/'));
  }
}

/**
 * Extract the Luma event slug from a URL.
 * e.g. "https://lu.ma/abc123" -> "abc123"
 * e.g. "https://lu.ma/event/evt-abc" -> "event/evt-abc"
 */
export function getLumaSlug(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // Remove leading slash and any trailing slashes
    const path = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    return path || null;
  } catch {
    // Fallback: try to extract path after domain
    const match = url.match(/lu\.ma\/(.+?)(?:\?|#|$)/);
    if (match) return match[1].replace(/\/+$/, '');
    const match2 = url.match(/luma\.com\/(.+?)(?:\?|#|$)/);
    if (match2) return match2[1].replace(/\/+$/, '');
    return null;
  }
}

/** Build the Luma embed checkout URL for the fallback overlay */
export function getLumaCheckoutUrl(slug: string): string {
  return `https://lu.ma/${slug}`;
}
