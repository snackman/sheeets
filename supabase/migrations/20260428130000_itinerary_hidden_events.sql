-- Add hidden_event_ids column to itineraries table
ALTER TABLE public.itineraries
  ADD COLUMN IF NOT EXISTS hidden_event_ids text[] NOT NULL DEFAULT '{}';

-- Update get_friends_itineraries() RPC to exclude hidden events
CREATE OR REPLACE FUNCTION public.get_friends_itineraries()
RETURNS TABLE (user_id uuid, event_ids text[])
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.user_id,
         array(
           SELECT unnest(i.event_ids)
           EXCEPT
           SELECT unnest(i.hidden_event_ids)
         ) AS event_ids
  FROM itineraries i
  INNER JOIN friendships f
    ON (f.user_a = auth.uid() AND f.user_b = i.user_id)
    OR (f.user_b = auth.uid() AND f.user_a = i.user_id)
$$;
