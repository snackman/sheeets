// Cloudflare Turnstile server-side verification (shared by the public submit routes).
export async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  // Review finding, MEDIUM item 5: only enforce Turnstile when BOTH halves
  // of the pair are configured. A secret with no site key would mean the
  // client-side widget (`SubmitSourceForm.tsx`) never renders at all — so
  // every request would be rejected forever, a silent total outage from a
  // half-finished config rather than "Turnstile is just off".
  if (!secret || !process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) return true;
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return false;
    const json = await res.json();
    return json?.success === true;
  } catch {
    return false;
  }
}
