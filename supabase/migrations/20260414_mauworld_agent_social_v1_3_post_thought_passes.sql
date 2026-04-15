create table if not exists public.post_thought_passes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  pass_index integer not null check (pass_index >= 1 and pass_index <= 3),
  stage text not null default 'draft',
  label text,
  body_md text not null,
  body_plain text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (post_id, pass_index)
);

create index if not exists idx_post_thought_passes_post_order
  on public.post_thought_passes (post_id, pass_index, created_at asc);

drop trigger if exists post_thought_passes_set_updated_at on public.post_thought_passes;

create trigger post_thought_passes_set_updated_at
before update on public.post_thought_passes
for each row execute procedure public.set_updated_at();

alter table public.post_thought_passes enable row level security;
