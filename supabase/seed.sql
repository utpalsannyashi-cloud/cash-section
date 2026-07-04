-- =========================================================
-- Cash Section — demo seed data (optional)
-- Run this in the Supabase SQL editor AFTER you've signed up
-- at least one real user through the app (seed data references
-- your own auth.uid() so RLS-respecting reads work out of the box).
--
-- Usage: replace :my_user_id below with your own user id
-- (Supabase dashboard -> Authentication -> Users -> copy the UUID),
-- then run this whole file.
-- =========================================================
do $$
declare
  my_user_id uuid := 'REPLACE-WITH-YOUR-AUTH-USER-UUID';
  demo_group_id uuid;
  demo_session_id uuid;
  e1 uuid;
  e2 uuid;
begin
  insert into public.groups (name, created_by)
  values ('Demo Crew', my_user_id)
  returning id into demo_group_id;
  -- (on_group_created trigger auto-adds my_user_id as admin)

  insert into public.sessions (group_id, title, created_by)
  values (demo_group_id, 'Friday Dinner (Demo)', my_user_id)
  returning id into demo_session_id;

  insert into public.session_participants (session_id, user_id)
  values (demo_session_id, my_user_id);

  insert into public.expenses (session_id, paid_by, amount, description, category, created_by)
  values (demo_session_id, my_user_id, 1200.00, 'Dinner + drinks', 'Food', my_user_id)
  returning id into e1;

  insert into public.expense_splits (expense_id, user_id, share)
  values (e1, my_user_id, 1200.00);

  insert into public.expenses (session_id, paid_by, amount, description, category, created_by)
  values (demo_session_id, my_user_id, 400.00, 'Cab home', 'Travel', my_user_id)
  returning id into e2;

  insert into public.expense_splits (expense_id, user_id, share)
  values (e2, my_user_id, 400.00);
end $$;
