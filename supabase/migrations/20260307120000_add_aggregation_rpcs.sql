-- ============================================================
-- Batch Data Fetching: Aggregation RPCs
-- Moves per-row fetching + client-side aggregation into
-- server-side SQL functions for fewer rows over the wire.
-- ============================================================

-- ------------------------------------------------------------
-- 1. get_comment_counts()
--    Returns one row per event_id with its comment count.
-- ------------------------------------------------------------
create or replace function public.get_comment_counts()
returns table (event_id text, comment_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select event_id, count(*)::bigint as comment_count
  from event_comments
  group by event_id;
$$;

-- ------------------------------------------------------------
-- 2. get_check_in_counts(p_user_ids uuid[])
--    Returns one row per event_id with the total count of
--    check-ins (for the supplied user IDs) and an array of
--    the user_ids who checked in.
-- ------------------------------------------------------------
create or replace function public.get_check_in_counts(p_user_ids uuid[])
returns table (event_id text, checkin_count bigint, user_ids uuid[])
language sql
security definer
set search_path = public
stable
as $$
  select
    event_id,
    count(*)::bigint as checkin_count,
    array_agg(user_id) as user_ids
  from check_ins
  where user_id = any(p_user_ids)
  group by event_id;
$$;

-- ------------------------------------------------------------
-- 3. get_reaction_summaries(p_user_id uuid)
--    Returns one row per (event_id, emoji) with the count and
--    whether the given user has reacted with that emoji.
-- ------------------------------------------------------------
create or replace function public.get_reaction_summaries(p_user_id uuid)
returns table (event_id text, emoji text, reaction_count bigint, user_reacted boolean)
language sql
security definer
set search_path = public
stable
as $$
  select
    event_id,
    emoji,
    count(*)::bigint as reaction_count,
    bool_or(user_id = p_user_id) as user_reacted
  from event_reactions
  group by event_id, emoji;
$$;

-- ------------------------------------------------------------
-- Additional indexes for aggregation performance
-- ------------------------------------------------------------

-- Covering index on event_reactions for the GROUP BY in get_reaction_summaries
create index if not exists idx_event_reactions_event_emoji
  on public.event_reactions(event_id, emoji);

-- Index on check_ins(user_id) for the WHERE in get_check_in_counts
create index if not exists idx_check_ins_user_id
  on public.check_ins(user_id);

-- Covering index on check_ins for the GROUP BY
create index if not exists idx_check_ins_event_user
  on public.check_ins(event_id, user_id);
