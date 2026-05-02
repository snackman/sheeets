export function isLumaUrl(url: string): boolean {
  try {
    return new URL(url).hostname.includes('lu.ma');
  } catch {
    return false;
  }
}

export function getLumaSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('lu.ma')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch {
    return null;
  }
}
