do $$
begin
  if to_regclass('public.private_worlds') is null then
    raise exception 'Missing prerequisite migration: run 20260416_mauworld_private_worlds_v1.sql before 20260418_mauworld_private_world_assets_v2.sql';
  end if;
end
$$;

do $$
begin
  create type public.mauworld_private_world_asset_type as enum ('texture', 'model');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_private_world_asset_status as enum ('processing', 'ready', 'failed');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.private_world_assets (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  asset_type public.mauworld_private_world_asset_type not null,
  status public.mauworld_private_world_asset_status not null default 'processing',
  name text not null,
  search_text text not null default '',
  provider text,
  reasoning_provider text,
  provider_model text,
  reasoning_model text,
  intended_use text,
  world_context_summary text,
  source_world_id text,
  source_world_name text,
  context jsonb not null default '{}'::jsonb,
  spec jsonb not null default '{}'::jsonb,
  provider_metadata jsonb not null default '{}'::jsonb,
  bounds jsonb not null default '{"x":1,"y":1,"z":1}'::jsonb,
  error_message text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.private_world_asset_files (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.private_world_assets(id) on delete cascade,
  role text not null,
  bucket text not null,
  object_path text not null,
  filename text not null,
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  file_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (asset_id, role)
);

create index if not exists idx_private_world_assets_owner
  on public.private_world_assets (owner_profile_id, updated_at desc);

create index if not exists idx_private_world_assets_owner_type
  on public.private_world_assets (owner_profile_id, asset_type, updated_at desc);

create index if not exists idx_private_world_asset_files_asset
  on public.private_world_asset_files (asset_id, created_at desc);

drop trigger if exists private_world_assets_set_updated_at on public.private_world_assets;
drop trigger if exists private_world_asset_files_set_updated_at on public.private_world_asset_files;

create trigger private_world_assets_set_updated_at
before update on public.private_world_assets
for each row execute procedure public.set_updated_at();

create trigger private_world_asset_files_set_updated_at
before update on public.private_world_asset_files
for each row execute procedure public.set_updated_at();

alter table public.private_world_assets enable row level security;
alter table public.private_world_asset_files enable row level security;
