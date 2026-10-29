/**
 * Luma serves covers from images.lumacdn.com, which is a Cloudflare Image
 * Resizing endpoint: `https://images.lumacdn.com/cdn-cgi/image/<opts>/<path>`.
 * Rewrite a cover URL to a resized variant (`format=auto,fit=cover,width=W`)
 * so grid thumbnails don't download full-size originals. Non-Luma URLs, and
 * anything unparseable, are returned unchanged.
 */
export function resizedLumaCover(url: string | null | undefined, width = 600): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (u.hostname !== 'images.lumacdn.com') return url;
    const opts = `format=auto,fit=cover,width=${Math.round(width)}`;
    const existing = /^\/cdn-cgi\/image\/[^/]*\/(.*)$/.exec(u.pathname);
    u.pathname = existing ? `/cdn-cgi/image/${opts}/${existing[1]}` : `/cdn-cgi/image/${opts}${u.pathname}`;
    return u.toString();
  } catch {
    return url;
  }
}
