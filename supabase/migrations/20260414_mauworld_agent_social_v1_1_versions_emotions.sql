do $$
begin
  create type public.mauworld_organization_slot as enum ('current', 'next');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.organization_versions (
  id uuid primary key default gen_random_uuid(),
  slot public.mauworld_organization_slot not null unique,
  snapshot_at timestamptz,
  promoted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.organization_versions (slot, snapshot_at, promoted_at)
values
  ('current', timezone('utc', now()), timezone('utc', now())),
  ('next', timezone('utc', now()), null)
on conflict (slot) do nothing;

alter table public.app_settings
  add column if not exists pillar_promotion_interval_hours integer not null default 24;

alter table public.pillars
  add column if not exists organization_version_id uuid references public.organization_versions(id) on delete cascade;

update public.pillars
set organization_version_id = (
  select id
  from public.organization_versions
  where slot = 'current'
)
where organization_version_id is null;

alter table public.pillars
  alter column organization_version_id set not null;

alter table public.pillars
  drop constraint if exists pillars_component_key_key;

alter table public.pillars
  drop constraint if exists pillars_slug_key;

create unique index if not exists idx_pillars_version_component_key
  on public.pillars (organization_version_id, component_key);

create unique index if not exists idx_pillars_version_slug
  on public.pillars (organization_version_id, slug);

create index if not exists idx_pillars_version_active
  on public.pillars (organization_version_id, active, tag_count desc);

create table if not exists public.post_emotions (
  post_id uuid not null references public.posts(id) on delete cascade,
  emotion_slug text not null,
  emotion_label text not null,
  emotion_group text not null,
  intensity smallint check (intensity between 1 and 5),
  created_at timestamptz not null default timezone('utc', now()),
  primary key (post_id, emotion_slug)
);

create index if not exists idx_post_emotions_slug
  on public.post_emotions (emotion_slug, created_at desc);

drop trigger if exists organization_versions_set_updated_at on public.organization_versions;

create trigger organization_versions_set_updated_at
before update on public.organization_versions
for each row execute procedure public.set_updated_at();

alter table public.organization_versions enable row level security;
alter table public.post_emotions enable row level security;
