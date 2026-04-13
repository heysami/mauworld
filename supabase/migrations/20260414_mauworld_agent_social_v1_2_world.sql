do $$
begin
  if to_regclass('public.organization_versions') is null then
    raise exception 'Missing prerequisite migration: run 20260414_mauworld_agent_social_v1_1_versions_emotions.sql before 20260414_mauworld_agent_social_v1_2_world.sql';
  end if;
end
$$;

do $$
begin
  create type public.mauworld_world_snapshot_status as enum ('building', 'ready', 'failed');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_world_display_tier as enum ('hero', 'standard', 'hint', 'hidden');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_presence_actor_type as enum ('agent', 'viewer');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_world_ingest_event_type as enum ('post_created', 'post_metrics_changed', 'post_removed', 'snapshot_promoted');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_world_ingest_event_status as enum ('queued', 'processing', 'processed', 'failed');
exception
  when duplicate_object then null;
end
$$;

create or replace function public.derive_mauworld_post_title(input text)
returns text
language plpgsql
immutable
as $$
declare
  normalized text;
  sentence_match text[];
begin
  normalized := regexp_replace(coalesce(input, ''), '\s+', ' ', 'g');
  normalized := btrim(normalized);

  if normalized = '' then
    return 'Untitled post';
  end if;

  sentence_match := regexp_match(normalized, '^(.{1,120}?[.!?])(?:\s|$)');
  if sentence_match is not null and coalesce(sentence_match[1], '') <> '' then
    return btrim(sentence_match[1]);
  end if;

  return left(normalized, 80);
end;
$$;

create or replace function public.refresh_post_search_document(target_post_id uuid)
returns void
language plpgsql
as $$
declare
  next_primary_tag_id uuid;
  next_tag_search_text text;
  resolved_title text;
begin
  select tag_id
  into next_primary_tag_id
  from public.post_tags
  where post_id = target_post_id
  order by ordinal asc, created_at asc, tag_id asc
  limit 1;

  select coalesce(string_agg(label_snapshot, ' ' order by ordinal asc, created_at asc, tag_id asc), '')
  into next_tag_search_text
  from public.post_tags
  where post_id = target_post_id;

  select case
    when coalesce(title, '') = '' then public.derive_mauworld_post_title(body_plain)
    else title
  end
  into resolved_title
  from public.posts
  where id = target_post_id;

  update public.posts
  set
    title = resolved_title,
    primary_tag_id = next_primary_tag_id,
    tag_search_text = next_tag_search_text,
    search_vector =
      setweight(to_tsvector('simple', coalesce(resolved_title, '')), 'A') ||
      setweight(to_tsvector('simple', coalesce(body_plain, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(search_text, '')), 'B') ||
      setweight(to_tsvector('simple', coalesce(next_tag_search_text, '')), 'A')
  where id = target_post_id;
end;
$$;

create or replace function public.refresh_post_search_document_from_posts()
returns trigger
language plpgsql
as $$
begin
  perform public.refresh_post_search_document(new.id);
  return null;
end;
$$;

create or replace function public.refresh_post_search_document_from_post_tags()
returns trigger
language plpgsql
as $$
declare
  target_post_id uuid;
begin
  target_post_id := coalesce(new.post_id, old.post_id);
  perform public.refresh_post_search_document(target_post_id);
  return null;
end;
$$;

alter table public.app_settings
  add column if not exists world_visible_posts_per_tag integer not null default 10,
  add column if not exists world_levels_per_pillar integer not null default 4,
  add column if not exists world_queue_batch_size integer not null default 100,
  add column if not exists world_presence_ttl_seconds integer not null default 45,
  add column if not exists world_cell_size integer not null default 64,
  add column if not exists world_lod_near_distance integer not null default 180,
  add column if not exists world_billboard_distance integer not null default 420;

alter table public.posts
  add column if not exists title text,
  add column if not exists primary_tag_id uuid references public.tags(id) on delete set null,
  add column if not exists tag_search_text text not null default '',
  add column if not exists search_vector tsvector;

update public.posts
set title = public.derive_mauworld_post_title(body_plain)
where coalesce(title, '') = '';

alter table public.posts
  alter column title set not null;

alter table public.post_tags
  add column if not exists ordinal integer;

with ranked as (
  select
    post_id,
    tag_id,
    row_number() over (
      partition by post_id
      order by created_at asc, tag_id asc
    ) as next_ordinal
  from public.post_tags
)
update public.post_tags as target
set ordinal = ranked.next_ordinal
from ranked
where target.post_id = ranked.post_id
  and target.tag_id = ranked.tag_id
  and (target.ordinal is null or target.ordinal <> ranked.next_ordinal);

alter table public.post_tags
  alter column ordinal set not null;

update public.posts as target
set primary_tag_id = source.tag_id
from (
  select distinct on (post_id)
    post_id,
    tag_id
  from public.post_tags
  order by post_id, ordinal asc, created_at asc, tag_id asc
) as source
where target.id = source.post_id;

update public.posts
set search_vector =
  setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(body_plain, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(search_text, '')), 'B') ||
  setweight(
    to_tsvector(
      'simple',
      coalesce((
        select string_agg(post_tags.label_snapshot, ' ' order by post_tags.ordinal asc, post_tags.created_at asc, post_tags.tag_id asc)
        from public.post_tags
        where post_tags.post_id = public.posts.id
      ), '')
    ),
    'A'
  ),
    tag_search_text = coalesce((
      select string_agg(post_tags.label_snapshot, ' ' order by post_tags.ordinal asc, post_tags.created_at asc, post_tags.tag_id asc)
      from public.post_tags
      where post_tags.post_id = public.posts.id
    ), '');

create index if not exists idx_posts_primary_tag_id
  on public.posts (primary_tag_id);

create index if not exists idx_posts_search_vector
  on public.posts
  using gin (search_vector);

drop trigger if exists posts_refresh_post_search_document on public.posts;

create trigger posts_refresh_post_search_document
after insert or update of title, body_plain, search_text on public.posts
for each row
when (pg_trigger_depth() = 0)
execute procedure public.refresh_post_search_document_from_posts();

drop trigger if exists post_tags_refresh_post_search_document on public.post_tags;

create trigger post_tags_refresh_post_search_document
after insert or update or delete on public.post_tags
for each row
when (pg_trigger_depth() = 0)
execute procedure public.refresh_post_search_document_from_post_tags();

create table if not exists public.world_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_version_id uuid not null unique references public.organization_versions(id) on delete cascade,
  status public.mauworld_world_snapshot_status not null default 'building',
  layout_seed integer not null default 1,
  layout_algorithm text not null default 'pillar-rings-v1',
  bounds_x_min double precision not null default 0,
  bounds_x_max double precision not null default 0,
  bounds_z_min double precision not null default 0,
  bounds_z_max double precision not null default 0,
  built_at timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.world_snapshots (organization_version_id, status)
select id, 'building'
from public.organization_versions
on conflict (organization_version_id) do nothing;

create table if not exists public.world_pillar_layouts (
  world_snapshot_id uuid not null references public.world_snapshots(id) on delete cascade,
  pillar_id uuid not null references public.pillars(id) on delete cascade,
  position_x double precision not null,
  position_y double precision not null default 0,
  position_z double precision not null,
  radius double precision not null default 0,
  height double precision not null default 0,
  level_count integer not null default 1,
  importance_score double precision not null default 0,
  cell_x integer not null default 0,
  cell_z integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (world_snapshot_id, pillar_id)
);

create table if not exists public.world_tag_layouts (
  world_snapshot_id uuid not null references public.world_snapshots(id) on delete cascade,
  pillar_id uuid not null references public.pillars(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  orbit_angle double precision not null default 0,
  orbit_radius double precision not null default 0,
  y_offset double precision not null default 0,
  branch_depth integer not null default 1,
  active_post_count integer not null default 0,
  visible_post_count integer not null default 0,
  cell_x integer not null default 0,
  cell_z integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (world_snapshot_id, pillar_id, tag_id)
);

create table if not exists public.world_post_instances (
  world_snapshot_id uuid not null references public.world_snapshots(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  is_canonical boolean not null default false,
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  position_z double precision not null default 0,
  level_index integer not null default 0,
  rank_in_tag integer not null default 1,
  popularity_score double precision not null default 0,
  size_factor double precision not null default 1,
  display_tier public.mauworld_world_display_tier not null default 'hidden',
  cell_x integer not null default 0,
  cell_z integer not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (world_snapshot_id, post_id, tag_id)
);

create unique index if not exists idx_world_post_instances_canonical
  on public.world_post_instances (world_snapshot_id, post_id)
  where is_canonical = true;

create table if not exists public.live_presence_sessions (
  id uuid primary key default gen_random_uuid(),
  actor_type public.mauworld_presence_actor_type not null,
  installation_id uuid references public.agent_installations(id) on delete cascade,
  viewer_session_id text,
  world_snapshot_id uuid not null references public.world_snapshots(id) on delete cascade,
  position_x double precision not null default 0,
  position_y double precision not null default 0,
  position_z double precision not null default 0,
  heading_y double precision not null default 0,
  movement_state jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint live_presence_sessions_identity_check check (
    (actor_type = 'agent' and installation_id is not null and viewer_session_id is null) or
    (actor_type = 'viewer' and installation_id is null and viewer_session_id is not null)
  )
);

create unique index if not exists idx_live_presence_installation_unique
  on public.live_presence_sessions (installation_id)
  where installation_id is not null;

create unique index if not exists idx_live_presence_viewer_unique
  on public.live_presence_sessions (viewer_session_id)
  where viewer_session_id is not null;

create table if not exists public.world_ingest_events (
  id uuid primary key default gen_random_uuid(),
  event_type public.mauworld_world_ingest_event_type not null,
  post_id uuid references public.posts(id) on delete cascade,
  world_snapshot_id uuid references public.world_snapshots(id) on delete cascade,
  status public.mauworld_world_ingest_event_status not null default 'queued',
  priority integer not null default 100,
  available_at timestamptz not null default timezone('utc', now()),
  claimed_at timestamptz,
  processed_at timestamptz,
  payload jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_world_pillar_layouts_snapshot_cell
  on public.world_pillar_layouts (world_snapshot_id, cell_x, cell_z);

create index if not exists idx_world_tag_layouts_snapshot_cell
  on public.world_tag_layouts (world_snapshot_id, cell_x, cell_z);

create index if not exists idx_world_post_instances_snapshot_cell
  on public.world_post_instances (world_snapshot_id, cell_x, cell_z, display_tier);

create index if not exists idx_live_presence_sessions_snapshot_expires
  on public.live_presence_sessions (world_snapshot_id, expires_at);

create index if not exists idx_world_ingest_events_status_available
  on public.world_ingest_events (status, available_at, priority desc, created_at asc);

create index if not exists idx_world_ingest_events_snapshot_status
  on public.world_ingest_events (world_snapshot_id, status, created_at desc);

drop trigger if exists world_snapshots_set_updated_at on public.world_snapshots;
drop trigger if exists world_pillar_layouts_set_updated_at on public.world_pillar_layouts;
drop trigger if exists world_tag_layouts_set_updated_at on public.world_tag_layouts;
drop trigger if exists world_post_instances_set_updated_at on public.world_post_instances;
drop trigger if exists live_presence_sessions_set_updated_at on public.live_presence_sessions;
drop trigger if exists world_ingest_events_set_updated_at on public.world_ingest_events;

create trigger world_snapshots_set_updated_at
before update on public.world_snapshots
for each row execute procedure public.set_updated_at();

create trigger world_pillar_layouts_set_updated_at
before update on public.world_pillar_layouts
for each row execute procedure public.set_updated_at();

create trigger world_tag_layouts_set_updated_at
before update on public.world_tag_layouts
for each row execute procedure public.set_updated_at();

create trigger world_post_instances_set_updated_at
before update on public.world_post_instances
for each row execute procedure public.set_updated_at();

create trigger live_presence_sessions_set_updated_at
before update on public.live_presence_sessions
for each row execute procedure public.set_updated_at();

create trigger world_ingest_events_set_updated_at
before update on public.world_ingest_events
for each row execute procedure public.set_updated_at();

alter table public.world_snapshots enable row level security;
alter table public.world_pillar_layouts enable row level security;
alter table public.world_tag_layouts enable row level security;
alter table public.world_post_instances enable row level security;
alter table public.live_presence_sessions enable row level security;
alter table public.world_ingest_events enable row level security;
