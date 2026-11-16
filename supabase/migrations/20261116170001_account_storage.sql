-- Run after 20261116170000_account.sql on a Supabase project.
-- The bucket stays private. Paths are owners/<user id>/files/<file id>.

insert into storage.buckets (id, name, public)
values ('proposal-photos', 'proposal-photos', false)
on conflict (id) do update set public = false;

create policy proposal_photos_read on storage.objects
  for select to authenticated
  using (
    public.can_use_account()
    and bucket_id = 'proposal-photos'
    and (storage.foldername(name))[1] = 'owners'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy proposal_photos_insert on storage.objects
  for insert to authenticated
  with check (
    public.can_use_account()
    and bucket_id = 'proposal-photos'
    and (storage.foldername(name))[1] = 'owners'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

create policy proposal_photos_delete on storage.objects
  for delete to authenticated
  using (
    public.can_use_account()
    and bucket_id = 'proposal-photos'
    and (storage.foldername(name))[1] = 'owners'
    and (storage.foldername(name))[2] = auth.uid()::text
  );
