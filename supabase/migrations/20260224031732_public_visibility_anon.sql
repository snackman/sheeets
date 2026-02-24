-- Allow all users (including anonymous) to read public reactions and comments.
-- Friends-only items still require authentication + friendship.

-- Reactions
drop policy if exists "Users can read visible reactions" on public.event_reactions;

create policy "Anyone can read public reactions"
  on public.event_reactions for select
  using (visibility = 'public');

create policy "Friends can read friends-only reactions"
  on public.event_reactions for select
  using (
    visibility = 'friends'
    and auth.role() = 'authenticated'
    and (user_id = auth.uid() or are_friends(auth.uid(), user_id))
  );

-- Comments
drop policy if exists "Users can read visible comments" on public.event_comments;

create policy "Anyone can read public comments"
  on public.event_comments for select
  using (visibility = 'public');

create policy "Friends can read friends-only comments"
  on public.event_comments for select
  using (
    visibility = 'friends'
    and auth.role() = 'authenticated'
    and (user_id = auth.uid() or are_friends(auth.uid(), user_id))
  );
