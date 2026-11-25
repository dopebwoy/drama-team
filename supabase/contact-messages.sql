-- Run this once in the Supabase SQL Editor before using the contact inbox.
begin;

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  email text check (email is null or char_length(btrim(email)) between 3 and 254),
  message text not null check (char_length(btrim(message)) between 1 and 5000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

alter table public.contact_messages alter column email drop not null;
alter table public.contact_messages drop constraint if exists contact_messages_email_check;
alter table public.contact_messages
  add constraint contact_messages_email_check
  check (email is null or char_length(btrim(email)) between 3 and 254);

alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from anon, authenticated;
grant all privileges on table public.contact_messages to service_role;

create index if not exists contact_messages_created_at_idx
  on public.contact_messages (created_at desc);
create index if not exists contact_messages_unread_created_at_idx
  on public.contact_messages (created_at desc)
  where read_at is null;

commit;
