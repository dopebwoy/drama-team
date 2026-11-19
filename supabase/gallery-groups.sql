-- Apply in the Supabase SQL Editor before deploying the grouped gallery.
-- Existing records keep a useful group name based on their current title/name.
begin;

alter table public.photos
  add column if not exists group_title text;

alter table public.videos
  add column if not exists group_title text;

update public.photos
set group_title = left(
  coalesce(
    nullif(btrim(group_title), ''),
    nullif(regexp_replace(coalesce(file_name, ''), '\.[^.]+$', ''), ''),
    'Previous uploads'
  ),
  255
)
where group_title is null or btrim(group_title) = '';

update public.videos
set group_title = left(
  coalesce(
    nullif(btrim(group_title), ''),
    nullif(btrim(title), ''),
    'Previous uploads'
  ),
  255
)
where group_title is null or btrim(group_title) = '';

alter table public.photos
  alter column group_title set not null;

alter table public.videos
  alter column group_title set not null;

alter table public.photos
  drop constraint if exists photos_group_title_nonempty;
alter table public.photos
  add constraint photos_group_title_nonempty
  check (char_length(btrim(group_title)) between 1 and 255);

alter table public.videos
  drop constraint if exists videos_group_title_nonempty;
alter table public.videos
  add constraint videos_group_title_nonempty
  check (char_length(btrim(group_title)) between 1 and 255);

create index if not exists photos_group_title_created_at_idx
  on public.photos (group_title, created_at desc);
create index if not exists videos_group_title_created_at_idx
  on public.videos (group_title, created_at desc);

drop policy if exists "Public can add videos" on public.videos;
create policy "Public can add videos"
  on public.videos for insert
  to anon, authenticated
  with check (
    length(title) between 1 and 255
    and char_length(btrim(group_title)) between 1 and 255
    and file_key like 'videos/%'
    and (file_hash is null or file_hash ~ '^[0-9a-f]{64}$')
    and (thumbnail_path is null or thumbnail_path like 'video-thumbnails/%')
  );

commit;
