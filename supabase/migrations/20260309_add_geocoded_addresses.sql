-- Instant geocoding: store lat/lng captured at event submit time
create table if not exists public.geocoded_addresses (
  normalized_address text primary key,
  lat double precision not null,
  lng double precision not null,
  matched_address text,
  conference text,
  created_at timestamptz not null default now()
);

alter table public.geocoded_addresses enable row level security;

create policy "Anyone can read geocoded addresses"
  on public.geocoded_addresses for select using (true);

create policy "Service role can manage geocoded addresses"
  on public.geocoded_addresses for all using (auth.role() = 'service_role');
