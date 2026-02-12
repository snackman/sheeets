import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function getSupabase() {
  return createClient(supabaseUrl, supabaseAnonKey);
}

/** In-memory fallback cache for when Supabase is unavailable */
const memoryCache = new Map<string, { imageUrl: string | null; ts: number }>();
const MEMORY_CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

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

/** Resolve an image URL from a source URL (Luma API or og:image scraping) */
async function resolveImageUrl(url: string): Promise<string | null> {
  // Luma: use their API for clean cover images
  const lumaSlug = getLumaSlug(url);
  if (lumaSlug) {
    return fetchLumaImage(lumaSlug);
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

    if (!res.ok) return null;

    // Only read first 50KB to find og:image
    const reader = res.body?.getReader();
    if (!reader) return null;

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

    return ogMatch?.[1] ? decodeHTMLEntities(ogMatch[1]) : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const eventId = request.nextUrl.searchParams.get('eventId');

  if (!url) {
    return NextResponse.json({ imageUrl: null }, { status: 400 });
  }

  // 1. Check Supabase cache (if eventId provided)
  if (eventId && supabaseUrl && supabaseAnonKey) {
    try {
      const supabase = getSupabase();
      const { data } = await supabase
        .from('event_images')
        .select('image_url')
        .eq('event_id', eventId)
        .single();

      if (data) {
        return NextResponse.json(
          { imageUrl: data.image_url },
          { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
        );
      }
    } catch {
      // Supabase unavailable, fall through to resolution
    }
  }

  // 2. Check in-memory cache (fallback / no eventId)
  const memCached = memoryCache.get(url);
  if (memCached && Date.now() - memCached.ts < MEMORY_CACHE_TTL) {
    return NextResponse.json({ imageUrl: memCached.imageUrl });
  }

  // 3. Resolve the image URL from source
  const imageUrl = await resolveImageUrl(url);

  // 4. Store in Supabase cache (if eventId provided)
  if (eventId && supabaseUrl && supabaseAnonKey) {
    try {
      const supabase = getSupabase();
      await supabase
        .from('event_images')
        .upsert(
          {
            event_id: eventId,
            source_url: url,
            image_url: imageUrl,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'event_id' }
        );
    } catch {
      // Supabase write failed, still return the resolved URL
    }
  }

  // 5. Store in memory cache as fallback
  memoryCache.set(url, { imageUrl, ts: Date.now() });

  return NextResponse.json({ imageUrl });
}

/** Batch endpoint: resolve and cache multiple event images at once */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const items: { eventId: string; url: string }[] = body.items;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ results: {} }, { status: 400 });
    }

    // Limit batch size
    const batch = items.slice(0, 20);
    const eventIds = batch.map((item) => item.eventId);

    // Check Supabase for existing cached images
    const results: Record<string, string | null> = {};
    const uncached: { eventId: string; url: string }[] = [];

    if (supabaseUrl && supabaseAnonKey) {
      try {
        const supabase = getSupabase();
        const { data } = await supabase
          .from('event_images')
          .select('event_id, image_url')
          .in('event_id', eventIds);

        const cachedMap = new Map(
          (data || []).map((row) => [row.event_id, row.image_url])
        );

        for (const item of batch) {
          if (cachedMap.has(item.eventId)) {
            results[item.eventId] = cachedMap.get(item.eventId) ?? null;
          } else {
            uncached.push(item);
          }
        }
      } catch {
        // Supabase unavailable, resolve all
        uncached.push(...batch);
      }
    } else {
      uncached.push(...batch);
    }

    // Resolve uncached images in parallel (max 5 concurrent)
    const CONCURRENCY = 5;
    for (let i = 0; i < uncached.length; i += CONCURRENCY) {
      const chunk = uncached.slice(i, i + CONCURRENCY);
      const resolved = await Promise.all(
        chunk.map(async (item) => {
          const imageUrl = await resolveImageUrl(item.url);
          return { eventId: item.eventId, url: item.url, imageUrl };
        })
      );

      for (const r of resolved) {
        results[r.eventId] = r.imageUrl;
      }

      // Batch upsert to Supabase
      if (supabaseUrl && supabaseAnonKey) {
        try {
          const supabase = getSupabase();
          await supabase.from('event_images').upsert(
            resolved.map((r) => ({
              event_id: r.eventId,
              source_url: r.url,
              image_url: r.imageUrl,
              updated_at: new Date().toISOString(),
            })),
            { onConflict: 'event_id' }
          );
        } catch {
          // Supabase write failed, still return results
        }
      }
    }

    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: {} }, { status: 500 });
  }
}
