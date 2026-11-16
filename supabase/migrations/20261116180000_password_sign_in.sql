-- Safe to run after the two account migrations, including on a database
-- created from an older copy of those files. A fresh project already has
-- the column; this file repeats the password-change guards.

alter table public.profiles
  add column if not exists must_change_password boolean not null default true;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and active
      and role = 'admin'
      and not must_change_password
  );
$$;

create or replace function public.can_use_account()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and active
      and not must_change_password
  );
$$;

create or replace function public.protect_profile()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or coalesce(auth.role(), '') = 'service_role'
     or public.is_admin() then
    return new;
  end if;
  if old.must_change_password then
    raise exception 'profile fields are locked';
  end if;
  if new.id is distinct from old.id
    or new.email is distinct from old.email
    or new.role is distinct from old.role
    or new.active is distinct from old.active
    or new.must_change_password is distinct from old.must_change_password
    or new.created_at is distinct from old.created_at
  then
    raise exception 'profile fields are locked';
  end if;
  return new;
end;
$$;

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin() or (id = auth.uid() and public.can_use_account()))
  with check (public.is_admin() or (id = auth.uid() and public.can_use_account()));

drop policy if exists calculations_select on public.calculations;
create policy calculations_select on public.calculations
  for select to authenticated
  using (
    public.can_use_account()
    and status = 'success'
    and public.can_read_owner(owner_id)
    and (
      owner_id = auth.uid()
      or exists (
        select 1 from public.access_grants
        where grantee_id = auth.uid() and owner_id = calculations.owner_id and scope = 'read_calculations'
      )
    )
  );

drop policy if exists calculations_insert on public.calculations;
create policy calculations_insert on public.calculations
  for insert to authenticated
  with check (owner_id = auth.uid() and public.can_use_account());

drop policy if exists proposals_select on public.proposals;
create policy proposals_select on public.proposals
  for select to authenticated
  using (
    public.can_use_account() and (
      owner_id = auth.uid()
      or exists (
        select 1 from public.access_grants
        where grantee_id = auth.uid() and owner_id = proposals.owner_id and scope = 'read_proposals'
      )
    )
  );

drop policy if exists proposals_insert on public.proposals;
create policy proposals_insert on public.proposals
  for insert to authenticated
  with check (owner_id = auth.uid() and public.can_use_account());

drop policy if exists proposals_update on public.proposals;
create policy proposals_update on public.proposals
  for update to authenticated
  using (owner_id = auth.uid() and public.can_use_account())
  with check (owner_id = auth.uid() and public.can_use_account());

drop policy if exists proposal_items_all on public.proposal_items;
create policy proposal_items_all on public.proposal_items
  for all to authenticated
  using (
    public.can_use_account()
    and exists (
      select 1 from public.proposals
      where proposals.id = proposal_items.proposal_id
        and (
          proposals.owner_id = auth.uid()
          or exists (
            select 1 from public.access_grants
            where grantee_id = auth.uid()
              and owner_id = proposals.owner_id
              and scope = 'read_proposals'
          )
        )
    )
  )
  with check (
    public.can_use_account()
    and exists (
      select 1 from public.proposals
      where proposals.id = proposal_items.proposal_id
        and proposals.owner_id = auth.uid()
    )
  );

drop policy if exists proposal_files_select on public.proposal_files;
create policy proposal_files_select on public.proposal_files
  for select to authenticated
  using (
    public.can_use_account()
    and (
      owner_id = auth.uid()
      or exists (
        select 1 from public.access_grants
        where grantee_id = auth.uid()
          and owner_id = proposal_files.owner_id
          and scope = 'read_proposals'
      )
    )
  );

drop policy if exists proposal_files_insert on public.proposal_files;
create policy proposal_files_insert on public.proposal_files
  for insert to authenticated
  with check (owner_id = auth.uid() and public.can_use_account());

drop policy if exists proposal_file_refs_all on public.proposal_file_refs;
create policy proposal_file_refs_all on public.proposal_file_refs
  for all to authenticated
  using (
    public.can_use_account()
    and exists (
      select 1 from public.proposal_files
      where proposal_files.id = proposal_file_refs.file_id
        and public.can_read_owner(proposal_files.owner_id)
    )
  )
  with check (
    public.can_use_account()
    and exists (
      select 1 from public.proposal_files
      where proposal_files.id = proposal_file_refs.file_id
        and proposal_files.owner_id = auth.uid()
    )
  );

drop policy if exists proposal_photos_read on storage.objects;
drop policy if exists proposal_photos_insert on storage.objects;
drop policy if exists proposal_photos_delete on storage.objects;

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

revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_use_account() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.can_use_account() to authenticated, service_role;
