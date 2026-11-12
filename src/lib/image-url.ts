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

/**
 * Rewrite an image URL to a width-limited variant for thumbnails, for hosts
 * known to support on-the-fly resizing via URL. Unknown hosts are returned
 * unchanged (we deliberately do NOT proxy arbitrary scraped hosts through the
 * Next/Vercel image optimizer: an open `remotePatterns` allowlist would make
 * plan.wtf a free image proxy and burn the Hobby source-image quota).
 *
 *  - images.lumacdn.com  -> Cloudflare Image Resizing (/cdn-cgi/image/)
 *  - images.unsplash.com -> imgix params (w, auto=format, fit=crop)
 *  - img.evbuc.com       -> Eventbrite's imgix-style `w` param
 *  - *.imgix.net         -> imgix `w` + `auto=format`
 */
export function thumbUrl(url: string | null | undefined, width = 320): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host === 'images.lumacdn.com') return resizedLumaCover(url, width);
    const w = String(Math.round(width));
    if (host === 'images.unsplash.com') {
      u.searchParams.set('w', w);
      u.searchParams.set('auto', 'format');
      u.searchParams.set('fit', 'crop');
      u.searchParams.set('q', '70');
      return u.toString();
    }
    if (host === 'img.evbuc.com') {
      u.searchParams.set('w', w);
      return u.toString();
    }
    if (host.endsWith('.imgix.net')) {
      u.searchParams.set('w', w);
      u.searchParams.set('auto', 'format');
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * `srcSet` string (w descriptors) for a thumbnail, or undefined when the host
 * can't be resized (all candidates would be the same URL, so a srcset is noise).
 */
export function thumbSrcSet(url: string | null | undefined, widths: number[]): string | undefined {
  if (!url) return undefined;
  const candidates = widths.map((w) => ({ w, src: thumbUrl(url, w) }));
  if (candidates.every((c) => c.src === url)) return undefined;
  return candidates.map((c) => `${c.src} ${c.w}w`).join(', ');
}
