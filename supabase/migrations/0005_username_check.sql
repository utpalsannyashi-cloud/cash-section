-- =========================================================
-- Cash Section — pre-signup username availability check
-- profiles has restrictive RLS (only readable by yourself or group-mates),
-- so an unauthenticated signup form can't just SELECT from it directly.
-- This RPC exposes only a boolean, nothing else about existing users.
-- =========================================================
create or replace function public.is_username_available(check_username text)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select not exists (select 1 from public.profiles where username = check_username);
$$;

grant execute on function public.is_username_available(text) to anon, authenticated;
