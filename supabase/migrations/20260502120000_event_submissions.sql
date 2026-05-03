create table if not exists public.event_submissions (
  id uuid primary key default gen_random_uuid(),
  conference text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),

  -- Event fields (mirror EventRow from google-sheets.ts)
  event_name text not null,
  event_date text not null,
  start_time text not null default '',
  end_time text not null default '',
  organizer text not null default '',
  address text not null default '',
  cost text not null default 'Free',
  tags text not null default '',
  link text not null default '',
  has_food boolean not null default false,
  has_bar boolean not null default false,
  note text not null default '',

  -- Geocoding coords captured at submit time
  coords_lat double precision,
  coords_lng double precision,

  -- Review metadata
  rejection_reason text,
  reviewed_at timestamptz,
  sheet_row integer,

  created_at timestamptz not null default now()
);

alter table public.event_submissions enable row level security;

create policy "Service role manages submissions"
  on public.event_submissions for all using (auth.role() = 'service_role');

create index idx_submissions_status on public.event_submissions (status);
create index idx_submissions_conference on public.event_submissions (conference);
