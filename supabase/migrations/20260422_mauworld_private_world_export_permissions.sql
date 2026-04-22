alter table public.private_worlds
  add column if not exists allow_non_editor_export boolean not null default false,
  add column if not exists allow_non_editor_fork boolean not null default false;
