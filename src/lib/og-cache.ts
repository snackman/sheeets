/** Successful lookups are effectively immutable (1 day CDN + 1 day SWR);
 *  failures stay short so a transient miss heals quickly. */
export function ogCacheHeaders(imageUrl: string | null): Record<string, string> {
  return {
    'Cache-Control': imageUrl
      ? 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400'
      : 'public, max-age=60, s-maxage=300',
  };
}
