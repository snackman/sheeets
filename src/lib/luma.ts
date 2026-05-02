/** Luma URL detection and slug extraction utilities */

const LUMA_HOSTS = ['lu.ma', 'luma.com', 'www.luma.com'];

export function isLumaUrl(url: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return LUMA_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

export function getLumaSlug(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (!LUMA_HOSTS.includes(u.hostname)) return null;
    const slug = u.pathname.replace(/^\//, '').split('/')[0];
    return slug || null;
  } catch {
    return null;
  }
}
