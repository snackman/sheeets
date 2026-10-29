-- Publisher lease: serializes sheet-row inserts (pipeline auto-publish and
-- admin approve, via src/lib/ingest/publish.ts) against the dedupe sweep's
-- row deletes (src/lib/ingest/dedupe-sweep.ts) for the SAME tab. Both
-- locate rows by index, so an insert landing between the sweep's re-read
-- and its deleteDimension would shift rows and delete the wrong one.
--
-- A lease ROW, not pg_advisory_lock: PostgREST runs each RPC in its own
-- pooled transaction, so a session advisory lock can't be held across the
-- several HTTP calls (read sheet -> write sheet) the critical section
-- spans. Leases expire (ttl) so a crashed holder can't wedge publishing.
--
-- Code degrades gracefully until this is applied: a missing function
-- (PGRST202 / 42883) makes src/lib/ingest/publisher-lease.ts log a warning
-- and proceed WITHOUT the lock (today's behavior).
--
-- Manual apply. Idempotent.
create table if not exists public.ingest_publisher_leases (
  lease_key text primary key,
  holder text not null,
  expires_at timestamptz not null,
  acquired_at timestamptz not null default now()
);

alter table public.ingest_publisher_leases enable row level security;
revoke all on public.ingest_publisher_leases from anon, authenticated;

-- Acquire (or re-acquire, same holder) the lease if it's free or expired.
-- Returns true when p_holder now holds it.
create or replace function public.ingest_try_acquire_publisher_lease(p_key text, p_holder text, p_ttl_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  got text;
begin
  insert into public.ingest_publisher_leases as l (lease_key, holder, expires_at, acquired_at)
  values (p_key, p_holder, now() + make_interval(secs => greatest(1, least(p_ttl_seconds, 300))), now())
  on conflict (lease_key) do update
    set holder = excluded.holder, expires_at = excluded.expires_at, acquired_at = excluded.acquired_at
    where l.expires_at < now() or l.holder = excluded.holder
  returning l.holder into got;
  return got is not null and got = p_holder;
end;
$$;

-- Release only if p_holder still holds it (an expired-then-stolen lease is
-- never released by its previous holder).
create or replace function public.ingest_release_publisher_lease(p_key text, p_holder text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ingest_publisher_leases where lease_key = p_key and holder = p_holder;
  return found;
end;
$$;

revoke all on function public.ingest_try_acquire_publisher_lease(text, text, integer) from public, anon, authenticated;
revoke all on function public.ingest_release_publisher_lease(text, text) from public, anon, authenticated;
grant execute on function public.ingest_try_acquire_publisher_lease(text, text, integer) to service_role;
grant execute on function public.ingest_release_publisher_lease(text, text) to service_role;
