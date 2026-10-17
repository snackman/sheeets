import { NextRequest, NextResponse } from 'next/server';
import { isAdminPassword } from '@/lib/admin-auth';
import { createRateLimiter, getClientIp } from '@/lib/rate-limit';

// Basic brute-force speed bump: at most 10 attempts per 5 minutes per IP.
// In-process (resets on cold start, not shared across instances) -- see
// `createRateLimiter`'s doc comment.
const limiter = createRateLimiter(10, 5 * 60 * 1000);

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!limiter.check(ip)) {
    return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  if (!isAdminPassword(body?.password)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
