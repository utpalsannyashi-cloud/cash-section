-- =========================================================
-- Cash Section — Storage: private "bills" bucket
-- Path convention: bills/{group_id}/{session_id}/{expense_id}-{filename}
-- =========================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bills',
  'bills',
  false,
  10485760, -- 10 MB
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Helper: extract the group_id (first path segment) from a storage object path.
create or replace function public.group_id_from_storage_path(object_path text)
returns uuid
language sql
immutable
as $$
  select (string_to_array(object_path, '/'))[1]::uuid;
$$;

create policy "bills_select_group_members" on storage.objects
  for select using (
    bucket_id = 'bills'
    and public.is_group_member(public.group_id_from_storage_path(name))
  );

create policy "bills_insert_group_members" on storage.objects
  for insert with check (
    bucket_id = 'bills'
    and public.is_group_member(public.group_id_from_storage_path(name))
  );

create policy "bills_delete_owner_or_admin" on storage.objects
  for delete using (
    bucket_id = 'bills'
    and (
      owner = auth.uid()
      or public.is_group_admin(public.group_id_from_storage_path(name))
    )
  );
