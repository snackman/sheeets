-- ============================================================
-- Feature A: Friend Location Sharing
-- ============================================================

create table if not exists public.user_locations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamptz not null default now()
);

alter table public.user_locations enable row level security;

-- Users can read their own location
create policy "Users can read own location"
  on public.user_locations for select
  using (auth.uid() = user_id);

-- Users can upsert their own location
create policy "Users can upsert own location"
  on public.user_locations for insert
  with check (auth.uid() = user_id);

create policy "Users can update own location"
  on public.user_locations for update
  using (auth.uid() = user_id);

-- RPC to get friends' locations (SECURITY DEFINER to bypass RLS for the join)
create or replace function public.get_friends_locations()
returns table (user_id uuid, lat double precision, lng double precision, updated_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select ul.user_id, ul.lat, ul.lng, ul.updated_at
  from user_locations ul
  inner join friendships f
    on (f.user_a = auth.uid() and f.user_b = ul.user_id)
    or (f.user_b = auth.uid() and f.user_a = ul.user_id)
$$;

-- ============================================================
-- Feature B: Event Reactions
-- ============================================================

create table if not exists public.event_reactions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  visibility text not null default 'public',
  created_at timestamptz not null default now(),
  unique (event_id, user_id, emoji)
);

alter table public.event_reactions enable row level security;

-- All authenticated users can read public reactions
create policy "Authenticated users can read reactions"
  on public.event_reactions for select
  using (auth.role() = 'authenticated');

-- Users can insert their own reactions
create policy "Users can insert own reactions"
  on public.event_reactions for insert
  with check (auth.uid() = user_id);

-- Users can delete their own reactions
create policy "Users can delete own reactions"
  on public.event_reactions for delete
  using (auth.uid() = user_id);

-- ============================================================
-- Feature B: Event Comments
-- ============================================================

create table if not exists public.event_comments (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 500),
  visibility text not null default 'public',
  created_at timestamptz not null default now()
);

alter table public.event_comments enable row level security;

-- All authenticated users can read public comments
create policy "Authenticated users can read comments"
  on public.event_comments for select
  using (auth.role() = 'authenticated');

-- Users can insert their own comments
create policy "Users can insert own comments"
  on public.event_comments for insert
  with check (auth.uid() = user_id);

-- Users can delete their own comments
create policy "Users can delete own comments"
  on public.event_comments for delete
  using (auth.uid() = user_id);

-- Indexes for query performance
create index if not exists idx_event_reactions_event_id on public.event_reactions(event_id);
create index if not exists idx_event_comments_event_id on public.event_comments(event_id);
create index if not exists idx_event_comments_created_at on public.event_comments(event_id, created_at);
