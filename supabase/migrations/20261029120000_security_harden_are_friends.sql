-- Security hardening: are_friends() is SECURITY DEFINER and was callable by
-- anon with arbitrary uuid pairs, exposing the friendship graph.
--
-- It cannot simply be revoked from anon: it is referenced inside RLS policies
-- (event_reactions / event_comments friends-only policies) that Postgres
-- also plans for anon queries, and a missing EXECUTE grant would turn those
-- anonymous reads into "permission denied" errors. Instead, restrict what it
-- answers: every caller in the app passes auth.uid() as the first argument,
-- so only answer when uid1 is the caller. Anonymous callers (auth.uid() is
-- null) and callers probing other users' friendships get false.
create or replace function public.are_friends(uid1 uuid, uid2 uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select uid1 is not null
    and uid1 = auth.uid()
    and exists (
      select 1 from friendships
      where (user_a = uid1 and user_b = uid2)
         or (user_a = uid2 and user_b = uid1)
    )
$$;

-- Nobody needs the implicit PUBLIC execute grant; keep the roles that use it
-- through RLS policies and RPCs.
revoke execute on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to anon, authenticated, service_role;
