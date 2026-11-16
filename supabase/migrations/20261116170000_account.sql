-- Account history for PASIONARIA Calculator.
-- Apply in the Supabase SQL editor. Storage policies live in the next file.
-- The first administrator is inserted manually after that person exists in auth.users.
-- Do not enable public sign-up. An administrator creates managers with a temporary password.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role text not null default 'manager' check (role in ('admin', 'manager')),
  active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.calculations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  raw_request text not null,
  normalized_input jsonb not null,
  result jsonb not null,
  product_type text,
  model text,
  price numeric,
  status text not null check (status in ('success', 'failed')),
  proposal_id uuid,
  created_at timestamptz not null default now()
);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  number text not null,
  title text not null,
  client_name text,
  author_name text,
  issued_on date,
  status text not null default 'draft' check (status in ('draft', 'ready', 'archived')),
  discount jsonb not null default '{}'::jsonb,
  total numeric not null default 0,
  schema_version integer not null default 1,
  snapshot jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, number)
);

create table public.proposal_items (
  id uuid primary key,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  calculation_id uuid,
  product_type text,
  title text not null,
  parameters jsonb not null default '{}'::jsonb,
  color text,
  photo_source text,
  photo_ref text,
  quantity numeric not null,
  price numeric not null,
  position integer not null,
  room text,
  snapshot jsonb not null
);

create table public.proposal_files (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique,
  content_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 2000000),
  created_at timestamptz not null default now()
);

create table public.proposal_file_refs (
  file_id uuid not null references public.proposal_files (id) on delete cascade,
  proposal_id uuid not null references public.proposals (id) on delete cascade,
  primary key (file_id, proposal_id)
);

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  grantee_id uuid not null references public.profiles (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  scope text not null check (scope in ('read_proposals', 'read_calculations')),
  created_at timestamptz not null default now(),
  unique (grantee_id, owner_id, scope)
);

create index calculations_owner_created_idx
  on public.calculations (owner_id, created_at desc);
create index proposals_owner_updated_idx
  on public.proposals (owner_id, updated_at desc);
create index proposal_items_proposal_idx
  on public.proposal_items (proposal_id, position);

alter table public.calculations
  add constraint calculations_proposal_fk
  foreign key (proposal_id) references public.proposals (id) on delete set null;

create or replace function public.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active
  );
$$;

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

create or replace function public.can_read_owner(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_active_profile() and (
    target = auth.uid()
    or exists (
      select 1 from public.access_grants
      where grantee_id = auth.uid()
        and owner_id = target
        and scope in ('read_proposals', 'read_calculations')
    )
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

create trigger profiles_protect
  before update on public.profiles
  for each row execute function public.protect_profile();

create or replace function public.protect_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id is immutable';
  end if;
  return new;
end;
$$;

create trigger calculations_owner
  before update on public.calculations
  for each row execute function public.protect_owner();

create trigger proposals_owner
  before update on public.proposals
  for each row execute function public.protect_owner();

create trigger proposal_files_owner
  before update on public.proposal_files
  for each row execute function public.protect_owner();

alter table public.profiles enable row level security;
alter table public.calculations enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_items enable row level security;
alter table public.proposal_files enable row level security;
alter table public.proposal_file_refs enable row level security;
alter table public.access_grants enable row level security;

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update on public.profiles
  for update to authenticated
  using (public.is_admin() or (id = auth.uid() and public.can_use_account()))
  with check (public.is_admin() or (id = auth.uid() and public.can_use_account()));

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

create policy calculations_insert on public.calculations
  for insert to authenticated
  with check (owner_id = auth.uid() and public.can_use_account());

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

create policy proposals_insert on public.proposals
  for insert to authenticated
  with check (owner_id = auth.uid() and public.can_use_account());

create policy proposals_update on public.proposals
  for update to authenticated
  using (owner_id = auth.uid() and public.can_use_account())
  with check (owner_id = auth.uid() and public.can_use_account());

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

create policy proposal_files_insert on public.proposal_files
  for insert to authenticated
  with check (owner_id = auth.uid() and public.can_use_account());

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

create policy access_grants_admin on public.access_grants
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.save_account_proposal(
  proposal_id uuid,
  expected_version integer,
  document jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
  declare
  saved public.proposals%rowtype;
  item jsonb;
  item_position integer := 0;
  encoded text := document::text;
  removed jsonb := '[]'::jsonb;
begin
  if not public.can_use_account() then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;
  if octet_length(encoded) > 1500000 or encoded like '%data:image%' then
    raise exception 'invalid document' using errcode = '22023';
  end if;
  if coalesce((document ->> 'schemaVersion')::integer, 1) > 1 then
    raise exception 'unsupported schema' using errcode = '22023';
  end if;

  if expected_version is null then
    insert into public.proposals (
      id, owner_id, number, title, client_name, author_name, issued_on,
      status, discount, total, schema_version, snapshot
    ) values (
      coalesce(proposal_id, gen_random_uuid()),
      auth.uid(),
      'КП-' || lpad((
        select count(*) + 1 from public.proposals where owner_id = auth.uid()
      )::text, 4, '0'),
      coalesce(nullif(document #>> '{proposal,objectName}', ''), 'Коммерческое предложение'),
      document #>> '{proposal,recipient}',
      document #>> '{proposal,author}',
      nullif(document #>> '{proposal,issuedOn}', '')::date,
      'draft',
      coalesce(document #> '{proposal,discount}', '{}'::jsonb),
      coalesce((document ->> 'total')::numeric, 0),
      1,
      document
    )
    returning * into saved;
  else
    update public.proposals set
      title = coalesce(nullif(document #>> '{proposal,objectName}', ''), title),
      client_name = document #>> '{proposal,recipient}',
      author_name = document #>> '{proposal,author}',
      issued_on = nullif(document #>> '{proposal,issuedOn}', '')::date,
      discount = coalesce(document #> '{proposal,discount}', '{}'::jsonb),
      total = coalesce((document ->> 'total')::numeric, total),
      snapshot = document,
      version = version + 1,
      updated_at = now()
    where id = proposal_id
      and owner_id = auth.uid()
      and version = expected_version
    returning * into saved;
    if not found then
      if exists (
        select 1 from public.proposals
        where id = proposal_id and owner_id = auth.uid()
      ) then
        raise exception 'conflict' using errcode = '40001';
      end if;
      raise exception 'not_found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.proposal_items as existing_items
  where existing_items.proposal_id = saved.id;
  delete from public.proposal_file_refs as existing_refs
  where existing_refs.proposal_id = saved.id;

  for item in
    select value from jsonb_array_elements(coalesce(document #> '{proposal,items}', '[]'::jsonb))
  loop
    item_position := item_position + 1;
    insert into public.proposal_items (
      id, proposal_id, calculation_id, product_type, title, parameters, color,
      photo_source, photo_ref, quantity, price, position, room, snapshot
    ) values (
      coalesce((item ->> 'id')::uuid, gen_random_uuid()),
      saved.id,
      nullif(item ->> 'calculationId', '')::uuid,
      item ->> 'productType',
      coalesce(item ->> 'title', 'Позиция'),
      item,
      item ->> 'fabricColor',
      case
        when nullif(item ->> 'storedPhotoId', '') is not null then 'upload'
        when nullif(item ->> 'mediaOfferId', '') is not null then 'catalog'
        else null
      end,
      coalesce(item ->> 'storedPhotoId', item ->> 'mediaOfferId'),
      coalesce((item ->> 'quantity')::numeric, 1),
      coalesce((item ->> 'unitPrice')::numeric, 0),
      item_position,
      item ->> 'room',
      item
    );
    if nullif(item ->> 'storedPhotoId', '') is not null then
      insert into public.proposal_file_refs (file_id, proposal_id)
      select public.proposal_files.id, saved.id
      from public.proposal_files
      where public.proposal_files.id = (item ->> 'storedPhotoId')::uuid
        and public.proposal_files.owner_id = auth.uid();
    end if;
  end loop;

  select coalesce(jsonb_agg(storage_path), '[]'::jsonb)
    into removed
  from public.proposal_files
  where owner_id = auth.uid()
    and created_at < now() - interval '1 hour'
    and not exists (
      select 1 from public.proposal_file_refs
      where proposal_file_refs.file_id = proposal_files.id
    );

  delete from public.proposal_files
  where owner_id = auth.uid()
    and created_at < now() - interval '1 hour'
    and not exists (
      select 1 from public.proposal_file_refs
      where proposal_file_refs.file_id = proposal_files.id
    );

  return to_jsonb(saved) || jsonb_build_object('removed_paths', removed);
end;
$$;

revoke all on function public.save_account_proposal(uuid, integer, jsonb) from public;
grant execute on function public.save_account_proposal(uuid, integer, jsonb) to authenticated;

revoke all on function public.is_active_profile() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.can_read_owner(uuid) from public, anon;
revoke all on function public.can_use_account() from public, anon;
revoke all on function public.save_account_proposal(uuid, integer, jsonb) from anon;
grant execute on function public.is_active_profile() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.can_read_owner(uuid) to authenticated, service_role;
grant execute on function public.can_use_account() to authenticated, service_role;
grant execute on function public.save_account_proposal(uuid, integer, jsonb) to service_role;
