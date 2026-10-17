'use client';

/**
 * fetch() wrapper for admin UI calls. Sends the admin password via the
 * `x-admin-password` header instead of a `?password=` query string, which
 * routinely ends up in server/proxy access logs and browser history.
 *
 * The server-side admin GET routes (see `getAdminPassword()` in
 * `src/lib/admin-auth.ts`) still also accept the old `?password=` query
 * param for one release, but every admin UI call site should use this
 * helper now instead of building the password into the URL.
 *
 * TODO(deprecation): once this release has shipped, admin-auth.ts's
 * `?password=` fallback can be dropped.
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
