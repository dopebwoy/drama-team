-- Run in Supabase SQL Editor to enable contribution events and device controls.
begin;

create table if not exists public.contribution_events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 255),
  description text not null default '',
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  treasurer_name text not null check (char_length(btrim(treasurer_name)) between 1 and 80),
  treasurer_phone text not null check (treasurer_phone ~ '^07[89][0-9]{7}$'),
  treasurer_photo_url text,
  target_amount bigint not null check (target_amount > 0),
  approval_pin_hash text,
  approval_pin_salt text,
  active boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.contribution_events add column if not exists treasurer_photo_url text;
alter table public.contribution_events add column if not exists approval_pin_hash text;
alter table public.contribution_events add column if not exists approval_pin_salt text;
create unique index if not exists contribution_one_active_event_idx on public.contribution_events (active) where active;

create table if not exists public.contribution_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.contribution_events(id) on delete cascade,
  member_name text not null check (char_length(btrim(member_name)) between 1 and 80),
  phone text not null check (phone ~ '^07[89][0-9]{7}$'),
  claimed_amount bigint not null check (claimed_amount > 0),
  verified_amount bigint check (verified_amount > 0),
  transaction_id text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  verified_by text,
  created_at timestamptz not null default now()
);
alter table public.contribution_payments drop constraint if exists contribution_payments_status_check;
alter table public.contribution_payments add constraint contribution_payments_status_check check (status in ('pending','approved','rejected'));
create index if not exists contribution_payments_event_status_idx on public.contribution_payments(event_id, status, created_at desc);

create table if not exists public.contribution_comments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.contribution_events(id) on delete cascade,
  member_name text not null check (char_length(btrim(member_name)) between 1 and 80),
  comment text not null check (char_length(btrim(comment)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.treasurer_change_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.contribution_events(id) on delete cascade,
  requested_by text not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.site_settings(key,value) values
  ('site_paused','false'::jsonb),('whatsapp_group_url','null'::jsonb),('umukomite_password','null'::jsonb)
on conflict(key) do nothing;

create table if not exists public.device_registry (
  device_id uuid primary key,
  name text not null,
  role text not null check (role in ('member','umukomite')),
  last_seen timestamptz not null default now(),
  is_blocked boolean not null default false,
  is_banned_from_meet boolean not null default false
);

do $$ declare t text; begin
  foreach t in array array['contribution_events','contribution_payments','contribution_comments','treasurer_change_requests','site_settings','device_registry'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from anon, authenticated',t);
    execute format('grant all privileges on table public.%I to service_role',t);
  end loop;
end $$;
commit;
