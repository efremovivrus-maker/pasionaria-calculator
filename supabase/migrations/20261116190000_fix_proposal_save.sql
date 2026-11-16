-- Fix proposal save on a database that already applied 20261116170000_account.sql.
-- The function parameter proposal_id collided with the column of the same name,
-- so PostgreSQL rejected every save. Run this once in the SQL editor.

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
