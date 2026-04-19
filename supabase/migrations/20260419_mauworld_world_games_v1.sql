do $$
begin
  if to_regclass('public.user_profiles') is null then
    raise exception 'Missing prerequisite migration: run 20260416_mauworld_private_worlds_v1.sql before 20260419_mauworld_world_games_v1.sql';
  end if;
end
$$;

create table if not exists public.world_games (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid not null references public.user_profiles(id) on delete cascade,
  source_game_id uuid references public.world_games(id) on delete set null,
  title text not null,
  prompt text not null default '',
  source_html text not null,
  manifest jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  ai_provider text,
  ai_model text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_world_games_owner_updated
  on public.world_games (owner_profile_id, updated_at desc);

create index if not exists idx_world_games_source
  on public.world_games (source_game_id, created_at desc);

drop trigger if exists world_games_set_updated_at on public.world_games;

create trigger world_games_set_updated_at
before update on public.world_games
for each row execute procedure public.set_updated_at();

alter table public.world_games enable row level security;
