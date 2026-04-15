alter table public.app_settings
  add column if not exists world_chat_max_chars integer not null default 160,
  add column if not exists world_chat_ttl_seconds integer not null default 8,
  add column if not exists world_chat_detail_radius integer not null default 180,
  add column if not exists world_browser_radius integer not null default 96,
  add column if not exists world_interaction_max_recipients integer not null default 20;
