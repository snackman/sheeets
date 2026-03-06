create table if not exists public.admin_config (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.admin_config enable row level security;

create policy "Allow anonymous reads" on public.admin_config
  for select using (true);

insert into public.admin_config (key, value) values
  ('sponsors', '[{"name": "Stand With Crypto", "url": "https://www.standwithcrypto.org/"}]'),
  ('sponsors_cta', '{"text": "Our Sponsors"}'),
  ('native_ads', '[]'),
  ('upsell_copy', '{"heading": "Want more visibility?", "body": "Highlight your event and get featured placement across the app.", "cta_text": "Learn More — $500", "cta_url": "https://pizzadao.xyz"}')
on conflict (key) do nothing;
