const LUMA_DOMAINS = ['lu.ma', 'luma.com', 'www.lu.ma', 'www.luma.com'];

export function isLumaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return LUMA_DOMAINS.some(
      (d) => parsed.hostname === d || parsed.hostname.endsWith('.' + d)
    );
  } catch {
    return LUMA_DOMAINS.some((d) => url.includes(d + '/'));
  }
}

export function getLumaSlug(url: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    return path || null;
  } catch {
    const match = url.match(/lu\.ma\/(.+?)(?:\?|#|$)/);
    if (match) return match[1].replace(/\/+$/, '');
    return null;
  }
}
