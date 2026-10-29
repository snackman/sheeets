import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as queueGet, POST as queuePost } from '../../app/api/admin/ingest/queue/route';
import { GET as configGet, PUT as configPut } from '../../app/api/admin/ingest/config/route';
import { POST as runPost } from '../../app/api/admin/ingest/run/route';
import { GET as runsGet } from '../../app/api/admin/ingest/runs/route';
import { GET as cronGet } from '../../app/api/cron/ingest/route';

const TEST_PASSWORD = 'ingest-test-admin-password';
const TEST_CRON_SECRET = 'ingest-test-cron-secret';

beforeAll(() => {
  process.env.ADMIN_PASSWORD = TEST_PASSWORD;
  process.env.CRON_SECRET = TEST_CRON_SECRET;
});

function jsonRequest(url: string, body: unknown, method = 'POST'): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin ingest API auth', () => {
  it('GET /api/admin/ingest/queue rejects a missing password', async () => {
    const res = await queueGet(new NextRequest('http://localhost/api/admin/ingest/queue'));
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/ingest/queue rejects a wrong password', async () => {
    const res = await queueGet(new NextRequest('http://localhost/api/admin/ingest/queue', { headers: { 'x-admin-password': 'nope' } }));
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/ingest/queue accepts the right password (auth gate passes)', async () => {
    const res = await queueGet(new NextRequest('http://localhost/api/admin/ingest/queue', { headers: { 'x-admin-password': TEST_PASSWORD } }));
    expect(res.status).not.toBe(401);
  });

  it('POST /api/admin/ingest/queue rejects a wrong password before touching any candidate', async () => {
    const res = await queuePost(
      jsonRequest('http://localhost/api/admin/ingest/queue', { password: 'nope', action: 'approve', ids: ['00000000-0000-0000-0000-000000000000'] })
    );
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/ingest/queue rejects a body with no password field (fails zod validation before the auth check)', async () => {
    const res = await queuePost(
      jsonRequest('http://localhost/api/admin/ingest/queue', { action: 'approve', ids: ['00000000-0000-0000-0000-000000000000'] })
    );
    expect(res.status).toBe(400);
  });

  it('GET /api/admin/ingest/config rejects a wrong password', async () => {
    const res = await configGet(new NextRequest('http://localhost/api/admin/ingest/config', { headers: { 'x-admin-password': 'nope' } }));
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/ingest/config accepts the right password', async () => {
    const res = await configGet(new NextRequest('http://localhost/api/admin/ingest/config', { headers: { 'x-admin-password': TEST_PASSWORD } }));
    expect(res.status).not.toBe(401);
  });

  it('PUT /api/admin/ingest/config rejects a wrong password', async () => {
    const res = await configPut(jsonRequest('http://localhost/api/admin/ingest/config', { password: 'nope', conference: 'X', theme_key: 'crypto' }, 'PUT'));
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/ingest/run rejects a wrong password', async () => {
    const res = await runPost(jsonRequest('http://localhost/api/admin/ingest/run', { password: 'nope', conference: 'X' }));
    expect(res.status).toBe(401);
  });

  it('POST /api/admin/ingest/run rejects a request with neither sourceId nor conference, even with the right password', async () => {
    const res = await runPost(jsonRequest('http://localhost/api/admin/ingest/run', { password: TEST_PASSWORD }));
    expect(res.status).toBe(400);
  });

  it('GET /api/admin/ingest/runs rejects a wrong password', async () => {
    const res = await runsGet(new NextRequest('http://localhost/api/admin/ingest/runs', { headers: { 'x-admin-password': 'nope' } }));
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/ingest/runs accepts the right password', async () => {
    const res = await runsGet(new NextRequest('http://localhost/api/admin/ingest/runs', { headers: { 'x-admin-password': TEST_PASSWORD } }));
    expect(res.status).not.toBe(401);
  });

  it('GET /api/cron/ingest rejects a missing Authorization header', async () => {
    const res = await cronGet(new Request('http://localhost/api/cron/ingest'));
    expect(res.status).toBe(401);
  });

  it('GET /api/cron/ingest rejects the wrong secret', async () => {
    const res = await cronGet(new Request('http://localhost/api/cron/ingest', { headers: { authorization: 'Bearer wrong' } }));
    expect(res.status).toBe(401);
  });
});
