import { NextRequest, NextResponse } from 'next/server';

const cache = new Map<string, { imageUrl: string | null; ts: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

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
      // Stop early if we've found </head>
      if (html.includes('</head>')) break;
    }
    reader.cancel();

    // Extract og:image
    const ogMatch = html.match(
      /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
    ) || html.match(
      /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i
    );

    const imageUrl = ogMatch?.[1] || null;
    cache.set(url, { imageUrl, ts: Date.now() });

    return NextResponse.json({ imageUrl });
  } catch {
    cache.set(url, { imageUrl: null, ts: Date.now() });
    return NextResponse.json({ imageUrl: null });
  }
}
