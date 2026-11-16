-- Push endpoints are only read or written by Netlify Functions using the
-- Supabase service-role key. Never add a public or anon policy to this table.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  subscription jsonb not null,
  next_notification_at timestamptz not null,
  last_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant all on table public.push_subscriptions to service_role;

create index if not exists push_subscriptions_next_notification_idx
  on public.push_subscriptions (next_notification_at);
