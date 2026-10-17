import { timingSafeEqual } from 'crypto';

/**
 * Read the admin password off an admin GET route's request. Prefers the
 * `x-admin-password` header -- a query string (`?password=...`) is routinely
 * written to server/proxy access logs and browser history, which the header
 * is not. Falls back to the `?password=` query param for one release while
 * every admin UI fetch call switches to sending the header (see
 * `src/lib/admin-fetch.ts`).
 *
 * TODO(deprecation): once this release has shipped, drop the `?password=`
 * fallback below and require the header.
 */
export function getAdminPassword(req: { headers: Headers; nextUrl: { searchParams: URLSearchParams } }): string | null {
  return req.headers.get('x-admin-password') ?? req.nextUrl.searchParams.get('password');
}

/**
 * Server-only admin password check. The password lives in the ADMIN_PASSWORD
 * env var (never NEXT_PUBLIC_) so it is not shipped to the browser.
 * Fails closed if the env var is unset.
 */
export function isAdminPassword(password: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof password !== 'string') return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Server-only cron secret check (`Authorization: Bearer <CRON_SECRET>`).
 * Timing-safe, same pattern as `isAdminPassword` — a plain `!==` string
 * compare on a secret leaks timing information about how many leading
 * characters matched (review finding, LOW "make the cron secret check
 * timing-safe"). Fails closed if the env var is unset.
 */
export function isCronSecret(authHeader: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !authHeader) return false;
  const expectedHeader = `Bearer ${expected}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expectedHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}
