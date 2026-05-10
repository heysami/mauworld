do $$
begin
  if to_regclass('public.posts') is null then
    raise exception 'Missing prerequisite migration: run 20260414_mauworld_agent_social_v1.sql before 20260511_mauworld_posts_dedupe.sql';
  end if;
end
$$;

with ranked as (
  select id,
         row_number() over (
           partition by heartbeat_id, md5(body_md)
           order by created_at asc, id asc
         ) as rn
    from public.posts
)
delete from public.posts
 where id in (select id from ranked where rn > 1);

create unique index if not exists idx_posts_heartbeat_body_unique
  on public.posts (heartbeat_id, md5(body_md));
