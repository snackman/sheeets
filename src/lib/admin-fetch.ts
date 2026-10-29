'use client';

/**
 * fetch() wrapper for admin UI calls. Sends the admin password via the
 * `x-admin-password` header instead of a `?password=` query string, which
 * routinely ends up in server/proxy access logs and browser history.
 *
 * Admin routes only accept the header, a JSON body `password`, or the signed
 * session cookie issued by /api/admin/verify (see `requireAdmin()` in
 * `src/lib/admin-guard.ts`); the old `?password=` query fallback is gone.
 */
export function adminFetch(url: string, password: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'x-admin-password': password,
    },
  });
}
