import { NextRequest, NextResponse } from 'next/server';

const cache = new Map<string, { imageUrl: string | null; ts: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

/** Extract the slug from a Luma URL (lu.ma/xxx or luma.com/xxx) */
function getLumaSlug(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'lu.ma' || u.hostname === 'luma.com' || u.hostname === 'www.luma.com') {
      const slug = u.pathname.replace(/^\//, '').split('/')[0];
      return slug || null;
    }
  } catch {}
  return null;
}

/** Fetch cover image from Luma API */
async function fetchLumaImage(slug: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.lu.ma/url?url=${encodeURIComponent(slug)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();

    if (data.kind === 'event') {
      return data.data?.event?.cover_url || null;
    }
    if (data.kind === 'calendar') {
      return data.data?.calendar?.cover_image_url || null;
    }
    return null;
  } catch {
    return null;
  }
}

/** Decode common HTML entities in an extracted attribute value */
function decodeHTMLEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  if (!url) {
    return NextResponse.json({ imageUrl: null }, { status: 400 });
  }

  // Check cache
  const cached = cache.get(url);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json({ imageUrl: cached.imageUrl });
  }

  // Luma: use their API for clean cover images
  const lumaSlug = getLumaSlug(url);
  if (lumaSlug) {
    const imageUrl = await fetchLumaImage(lumaSlug);
    cache.set(url, { imageUrl, ts: Date.now() });
    return NextResponse.json({ imageUrl });
  }

  // Generic: fetch HTML and extract og:image
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; sheeets-bot/1.0)',
        'Accept': 'text/html',
      },
    });
    clearTimeout(timeout);

    if (!res.ok) {
      cache.set(url, { imageUrl: null, ts: Date.now() });
      return NextResponse.json({ imageUrl: null });
    }

    // Only read first 50KB to find og:image
    const reader = res.body?.getReader();
    if (!reader) {
      cache.set(url, { imageUrl: null, ts: Date.now() });
      return NextResponse.json({ imageUrl: null });
    }

    let html = '';
    const decoder = new TextDecoder();
    let bytesRead = 0;
    const MAX_BYTES = 50000;

    while (bytesRead < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      bytesRead += value.length;
      if (html.includes('</head>')) break;
    }
    reader.cancel();

    // Extract og:image (handle both attribute orderings)
    const ogMatch = html.match(
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
    ) || html.match(
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i
    );

    const imageUrl = ogMatch?.[1] ? decodeHTMLEntities(ogMatch[1]) : null;
    cache.set(url, { imageUrl, ts: Date.now() });

    return NextResponse.json({ imageUrl });
  } catch {
    cache.set(url, { imageUrl: null, ts: Date.now() });
    return NextResponse.json({ imageUrl: null });
  }
}
