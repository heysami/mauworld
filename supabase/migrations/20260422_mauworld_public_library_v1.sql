do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'Missing prerequisite migration: run 20260416_mauworld_private_worlds_v1.sql before 20260422_mauworld_public_library_v1.sql';
  end if;
end
$$;

do $$
begin
  alter type public.mauworld_private_world_asset_type add value 'sound';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_public_library_kind as enum ('world_package', 'game', 'resource');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_public_library_resource_kind as enum ('texture', 'animation', 'video', 'sound', 'model');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_public_library_delivery_mode as enum ('download', 'contact');
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  create type public.mauworld_public_library_state as enum ('active', 'archived');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.public_library_listings (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  source_world_id text,
  source_creator_username text,
  source_game_id uuid references public.world_games(id) on delete set null,
  source_asset_id uuid references public.private_world_assets(id) on delete set null,
  kind public.mauworld_public_library_kind not null,
  resource_kind public.mauworld_public_library_resource_kind,
  title text not null,
  description text not null default '',
  search_text text not null default '',
  source_snapshot jsonb not null default '{}'::jsonb,
  delivery_mode public.mauworld_public_library_delivery_mode not null,
  contact_instructions text,
  download_bucket text,
  download_object_path text,
  download_filename text,
  download_content_type text,
  download_size_bytes bigint not null default 0,
  state public.mauworld_public_library_state not null default 'active',
  rating_average numeric(4,2) not null default 0,
  review_count integer not null default 0,
  published_at timestamptz not null default timezone('utc', now()),
  snapshot_updated_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint public_library_listings_source_check check (
    ((source_world_id is not null)::integer + (source_game_id is not null)::integer + (source_asset_id is not null)::integer) = 1
  ),
  constraint public_library_listings_resource_kind_check check (
    (kind = 'resource' and resource_kind is not null) or (kind <> 'resource' and resource_kind is null)
  )
);

create table if not exists public.public_library_listing_media (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.public_library_listings(id) on delete cascade,
  sort_order integer not null default 0,
  bucket text not null,
  object_path text not null,
  filename text not null,
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  file_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.public_library_listing_reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.public_library_listings(id) on delete cascade,
  reviewer_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  rating smallint not null check (rating >= 1 and rating <= 5),
  comment text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (listing_id, reviewer_profile_id)
);

create table if not exists public.public_library_profile_reviews (
  id uuid primary key default gen_random_uuid(),
  reviewed_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  reviewer_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  rating smallint not null check (rating >= 1 and rating <= 5),
  comment text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (reviewed_profile_id, reviewer_profile_id),
  constraint public_library_profile_reviews_self_check check (reviewed_profile_id <> reviewer_profile_id)
);

create index if not exists idx_public_library_listings_owner
  on public.public_library_listings (owner_profile_id, updated_at desc);

create index if not exists idx_public_library_listings_public
  on public.public_library_listings (state, kind, published_at desc);

create index if not exists idx_public_library_listings_resource_kind
  on public.public_library_listings (state, resource_kind, published_at desc);

create index if not exists idx_public_library_listing_media_listing
  on public.public_library_listing_media (listing_id, sort_order asc, created_at asc);

create index if not exists idx_public_library_listing_reviews_listing
  on public.public_library_listing_reviews (listing_id, created_at desc);

create index if not exists idx_public_library_profile_reviews_profile
  on public.public_library_profile_reviews (reviewed_profile_id, created_at desc);

drop trigger if exists public_library_listings_set_updated_at on public.public_library_listings;
drop trigger if exists public_library_listing_media_set_updated_at on public.public_library_listing_media;
drop trigger if exists public_library_listing_reviews_set_updated_at on public.public_library_listing_reviews;
drop trigger if exists public_library_profile_reviews_set_updated_at on public.public_library_profile_reviews;

create trigger public_library_listings_set_updated_at
before update on public.public_library_listings
for each row execute procedure public.set_updated_at();

create trigger public_library_listing_media_set_updated_at
before update on public.public_library_listing_media
for each row execute procedure public.set_updated_at();

create trigger public_library_listing_reviews_set_updated_at
before update on public.public_library_listing_reviews
for each row execute procedure public.set_updated_at();

create trigger public_library_profile_reviews_set_updated_at
before update on public.public_library_profile_reviews
for each row execute procedure public.set_updated_at();

alter table public.public_library_listings enable row level security;
alter table public.public_library_listing_media enable row level security;
alter table public.public_library_listing_reviews enable row level security;
alter table public.public_library_profile_reviews enable row level security;
