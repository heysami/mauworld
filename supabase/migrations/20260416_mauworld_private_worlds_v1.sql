do $$
begin
  if to_regclass('public.world_snapshots') is null then
    raise exception 'Missing prerequisite migration: run 20260414_mauworld_agent_social_v1_2_world.sql before 20260416_mauworld_private_worlds_v1.sql';
  end if;
end
$$;

do $$
begin
  create type public.mauworld_private_world_type as enum ('room', 'field', 'board');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_private_world_template_size as enum ('small', 'medium', 'large');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_private_world_collaborator_role as enum ('creator', 'editor');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_private_world_instance_status as enum ('active', 'started');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_private_world_participant_role as enum ('editor', 'viewer', 'player', 'guest');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  username text not null unique,
  display_name text not null default '',
  search_text text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.private_worlds (
  id uuid primary key default gen_random_uuid(),
  world_id text not null unique,
  creator_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  world_type public.mauworld_private_world_type not null,
  template_size public.mauworld_private_world_template_size not null default 'medium',
  width integer not null,
  length integer not null,
  height integer not null,
  name text not null,
  about text not null,
  search_text text not null default '',
  max_viewers integer not null default 20,
  max_players integer not null default 8,
  default_scene_id uuid,
  origin_world_id text,
  origin_creator_username text,
  origin_world_name text,
  imported_at timestamptz,
  imported_by_profile_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint private_worlds_dimensions_valid check (
    width >= 4 and length >= 4 and height >= 2
  )
);

create table if not exists public.private_world_collaborators (
  world_id uuid not null references public.private_worlds(id) on delete cascade,
  profile_id uuid not null references public.user_profiles(id) on delete cascade,
  role public.mauworld_private_world_collaborator_role not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (world_id, profile_id)
);

create table if not exists public.private_world_scenes (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.private_worlds(id) on delete cascade,
  name text not null,
  scene_doc jsonb not null default '{}'::jsonb,
  compiled_doc jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  is_default boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.private_world_prefabs (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null references public.private_worlds(id) on delete cascade,
  name text not null,
  prefab_doc jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.private_world_active_instances (
  id uuid primary key default gen_random_uuid(),
  world_id uuid not null unique references public.private_worlds(id) on delete cascade,
  active_scene_id uuid references public.private_world_scenes(id) on delete set null,
  status public.mauworld_private_world_instance_status not null default 'active',
  anchor_world_snapshot_id uuid not null references public.world_snapshots(id) on delete cascade,
  anchor_position_x double precision not null default 0,
  anchor_position_y double precision not null default 0,
  anchor_position_z double precision not null default 0,
  anchor_cell_x integer not null default 0,
  anchor_cell_z integer not null default 0,
  miniature_width double precision not null default 6,
  miniature_length double precision not null default 6,
  miniature_height double precision not null default 3,
  runtime_state jsonb not null default '{}'::jsonb,
  created_by_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_active_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.private_world_participants (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references public.private_world_active_instances(id) on delete cascade,
  profile_id uuid references public.user_profiles(id) on delete cascade,
  guest_session_id text,
  join_role public.mauworld_private_world_participant_role not null default 'viewer',
  display_name text not null default '',
  player_entity_id text,
  visible_to_others boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_seen_at timestamptz not null default timezone('utc', now()),
  constraint private_world_participants_identity_check check (
    (profile_id is not null and guest_session_id is null) or
    (profile_id is null and guest_session_id is not null)
  ),
  unique (instance_id, profile_id),
  unique (instance_id, guest_session_id)
);

create table if not exists public.private_world_ready_states (
  instance_id uuid not null references public.private_world_active_instances(id) on delete cascade,
  participant_id uuid not null references public.private_world_participants(id) on delete cascade,
  ready boolean not null default false,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (instance_id, participant_id)
);

create table if not exists public.private_world_entity_locks (
  world_id uuid not null references public.private_worlds(id) on delete cascade,
  scene_id uuid not null references public.private_world_scenes(id) on delete cascade,
  entity_key text not null,
  profile_id uuid not null references public.user_profiles(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (world_id, scene_id, entity_key)
);

create index if not exists idx_private_worlds_creator
  on public.private_worlds (creator_profile_id, created_at desc);

create index if not exists idx_private_world_collaborators_profile
  on public.private_world_collaborators (profile_id, created_at desc);

create index if not exists idx_private_world_scenes_world
  on public.private_world_scenes (world_id, updated_at desc);

create index if not exists idx_private_world_prefabs_world
  on public.private_world_prefabs (world_id, updated_at desc);

create index if not exists idx_private_world_active_instances_anchor
  on public.private_world_active_instances (anchor_world_snapshot_id, anchor_cell_x, anchor_cell_z);

create index if not exists idx_private_world_participants_instance
  on public.private_world_participants (instance_id, last_seen_at desc);

create index if not exists idx_private_world_entity_locks_world
  on public.private_world_entity_locks (world_id, scene_id, expires_at);

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
drop trigger if exists private_worlds_set_updated_at on public.private_worlds;
drop trigger if exists private_world_scenes_set_updated_at on public.private_world_scenes;
drop trigger if exists private_world_prefabs_set_updated_at on public.private_world_prefabs;
drop trigger if exists private_world_active_instances_set_updated_at on public.private_world_active_instances;
drop trigger if exists private_world_participants_set_updated_at on public.private_world_participants;
drop trigger if exists private_world_entity_locks_set_updated_at on public.private_world_entity_locks;

create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row execute procedure public.set_updated_at();

create trigger private_worlds_set_updated_at
before update on public.private_worlds
for each row execute procedure public.set_updated_at();

create trigger private_world_scenes_set_updated_at
before update on public.private_world_scenes
for each row execute procedure public.set_updated_at();

create trigger private_world_prefabs_set_updated_at
before update on public.private_world_prefabs
for each row execute procedure public.set_updated_at();

create trigger private_world_active_instances_set_updated_at
before update on public.private_world_active_instances
for each row execute procedure public.set_updated_at();

create trigger private_world_participants_set_updated_at
before update on public.private_world_participants
for each row execute procedure public.set_updated_at();

create trigger private_world_entity_locks_set_updated_at
before update on public.private_world_entity_locks
for each row execute procedure public.set_updated_at();

alter table public.user_profiles enable row level security;
alter table public.private_worlds enable row level security;
alter table public.private_world_collaborators enable row level security;
alter table public.private_world_scenes enable row level security;
alter table public.private_world_prefabs enable row level security;
alter table public.private_world_active_instances enable row level security;
alter table public.private_world_participants enable row level security;
alter table public.private_world_ready_states enable row level security;
alter table public.private_world_entity_locks enable row level security;
