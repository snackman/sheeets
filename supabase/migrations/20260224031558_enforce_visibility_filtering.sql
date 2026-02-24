-- Helper: check if two users are friends
create or replace function public.are_friends(uid1 uuid, uid2 uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from friendships
    where (user_a = uid1 and user_b = uid2)
       or (user_a = uid2 and user_b = uid1)
  )
$$;

-- ============================================================
-- Event Reactions: enforce visibility
-- ============================================================

drop policy if exists "Authenticated users can read reactions" on public.event_reactions;

create policy "Users can read visible reactions"
  on public.event_reactions for select
  using (
    auth.role() = 'authenticated'
    and (
      visibility = 'public'
      or user_id = auth.uid()
      or are_friends(auth.uid(), user_id)
    )
  );

-- ============================================================
-- Event Comments: enforce visibility
-- ============================================================

drop policy if exists "Authenticated users can read comments" on public.event_comments;

create policy "Users can read visible comments"
  on public.event_comments for select
  using (
    auth.role() = 'authenticated'
    and (
      visibility = 'public'
      or user_id = auth.uid()
      or are_friends(auth.uid(), user_id)
    )
  );
