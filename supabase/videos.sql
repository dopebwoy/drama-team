-- Video bytes stay in a private Backblaze B2 bucket. This table stores the
-- title, B2 key, and optional public preview image path.
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  title text,
  file_key text,
  thumbnail_path text,
  created_at timestamptz not null default now()
);

alter table public.videos add column if not exists title text;
alter table public.videos add column if not exists file_key text;
alter table public.videos add column if not exists thumbnail_path text;

drop policy if exists "Public can view videos" on public.videos;
drop policy if exists "Public can add videos" on public.videos;

do $migrate$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'videos' and column_name = 'file_name'
  ) and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'videos' and column_name = 'object_key'
  ) then
    execute $sql$
      update public.videos
      set title = coalesce(nullif(title, ''), file_name),
          file_key = coalesce(nullif(file_key, ''), object_key)
      where title is null or title = '' or file_key is null or file_key = ''
    $sql$;
  end if;
end
$migrate$;

alter table public.videos
  drop column if exists file_name,
  drop column if exists object_key,
  drop column if exists public_url,
  drop column if exists content_type,
  drop column if exists file_size,
  drop column if exists uploaded_by;

alter table public.videos alter column title set not null;
alter table public.videos alter column file_key set not null;

create unique index if not exists videos_file_key_idx
  on public.videos (file_key);
create index if not exists videos_created_at_idx
  on public.videos (created_at desc);

alter table public.videos enable row level security;
grant select, insert on table public.videos to anon, authenticated;

create policy "Public can view videos"
  on public.videos for select
  to anon, authenticated
  using (true);

create policy "Public can add videos"
  on public.videos for insert
  to anon, authenticated
  with check (
    length(title) between 1 and 255
    and file_key like 'videos/%'
    and (thumbnail_path is null or thumbnail_path like 'video-thumbnails/%')
  );
