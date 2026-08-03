-- Durable, least-data packing recovery. PostgreSQL remains authoritative:
-- local clients may cache the manifest and queue scans, but confirmation
-- always reconciles this server projection first.

create or replace function public.record_packing_scan(
  p_session_id uuid,
  p_gtin text,
  p_scan_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $packing_scan$
declare
  v_session public.order_packing_sessions%rowtype;
  v_barcode public.product_barcodes%rowtype;
  v_item public.order_items%rowtype;
  v_existing public.order_packing_scans%rowtype;
  v_scanned integer;
  v_complete boolean;
begin
  if btrim(coalesce(p_scan_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'scan_key invalida' using errcode='22023';
  end if;
  select s.* into v_session
  from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;

  select b.* into v_barcode
  from public.product_barcodes b
  where b.business_id=v_session.business_id and b.gtin=p_gtin and b.is_active;
  if not found then raise exception 'producto desconocido' using errcode='P0002'; end if;

  select s.* into v_existing
  from public.order_packing_scans s
  where s.session_id=v_session.id and s.scan_key=p_scan_key;
  if found then
    if v_existing.barcode_id<>v_barcode.id then
      raise exception 'scan_key reutilizada con otro codigo' using errcode='23505';
    end if;
    return jsonb_build_object(
      'ok',v_existing.reverted_at is null,
      'idempotent_replay',true,
      'reverted',v_existing.reverted_at is not null,
      'scan_key',v_existing.scan_key,
      'product_id',v_existing.product_id,
      'unit_factor',v_existing.unit_factor
    );
  end if;

  if v_session.status not in ('in_progress','complete') then
    raise exception 'sesion cerrada' using errcode='P0001';
  end if;
  select oi.* into v_item
  from public.order_items oi
  where oi.order_id=v_session.order_id and oi.product_uuid=v_barcode.product_id
  order by oi.id limit 1;
  if not found then raise exception 'producto equivocado' using errcode='23514'; end if;
  select coalesce(sum(s.unit_factor),0)::integer into v_scanned
  from public.order_packing_scans s
  where s.session_id=v_session.id and s.order_item_id=v_item.id and s.reverted_at is null;
  if v_scanned+v_barcode.unit_factor>v_item.quantity then
    raise exception 'cantidad excedida' using errcode='23514';
  end if;

  insert into public.order_packing_scans(
    session_id,order_item_id,product_id,barcode_id,unit_factor,operator_id,scan_key
  ) values (
    v_session.id,v_item.id,v_barcode.product_id,v_barcode.id,v_barcode.unit_factor,auth.uid(),p_scan_key
  );
  select not exists(
    select 1 from public.order_items oi
    where oi.order_id=v_session.order_id
      and coalesce((select sum(ps.unit_factor) from public.order_packing_scans ps where ps.session_id=v_session.id and ps.order_item_id=oi.id and ps.reverted_at is null),0)<>oi.quantity
  ) into v_complete;
  update public.order_packing_sessions
  set status=case when v_complete then 'complete' else 'in_progress' end,updated_at=now()
  where id=v_session.id;
  return jsonb_build_object(
    'ok',true,'complete',v_complete,'idempotent_replay',false,
    'scan_key',p_scan_key,'product_id',v_barcode.product_id,'unit_factor',v_barcode.unit_factor
  );
end;
$packing_scan$;

create or replace function public.get_packing_manifest(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $packing_manifest$
declare
  v_session public.order_packing_sessions%rowtype;
begin
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  return jsonb_build_object(
    'schema_version',1,
    'session',jsonb_build_object(
      'id',v_session.id,
      'business_id',v_session.business_id,
      'order_id',v_session.order_id,
      'order_revision',v_session.order_revision,
      'status',v_session.status,
      'operator_id',v_session.operator_id,
      'updated_at',v_session.updated_at
    ),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id',oi.product_uuid,
        'name',left(oi.name,100),
        'quantity',oi.quantity,
        'barcodes',coalesce((
          select jsonb_agg(jsonb_build_object('gtin',b.gtin,'unit_factor',b.unit_factor) order by b.gtin)
          from public.product_barcodes b
          where b.business_id=v_session.business_id and b.product_id=oi.product_uuid and b.is_active
        ),'[]'::jsonb)
      ) order by oi.created_at,oi.id)
      from public.order_items oi where oi.order_id=v_session.order_id
    ),'[]'::jsonb),
    'scans',coalesce((
      select jsonb_agg(jsonb_build_object(
        'scan_key',ps.scan_key,
        'gtin',b.gtin,
        'product_id',ps.product_id,
        'unit_factor',ps.unit_factor,
        'created_at',ps.created_at,
        'reverted_at',ps.reverted_at
      ) order by ps.created_at,ps.id)
      from public.order_packing_scans ps
      join public.product_barcodes b on b.id=ps.barcode_id
      where ps.session_id=v_session.id
    ),'[]'::jsonb)
  );
end;
$packing_manifest$;

create or replace function public.revert_packing_scan(
  p_session_id uuid,
  p_scan_key text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $packing_revert$
declare
  v_session public.order_packing_sessions%rowtype;
  v_scan public.order_packing_scans%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode='22023';
  end if;
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  v_hash:=public.business_command_request_hash(
    'revert_packing_scan',v_session.order_id,
    jsonb_build_object('session_id',p_session_id,'scan_key',p_scan_key)
  );
  select r.* into v_receipt from public.business_command_receipts r
  where r.business_id=v_session.business_id and r.idempotency_key=p_idempotency_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode='23505';
    end if;
    return v_receipt.result||jsonb_build_object('idempotent_replay',true);
  end if;
  if v_session.status not in ('in_progress','complete') then
    raise exception 'sesion cerrada' using errcode='P0001';
  end if;
  select s.* into v_scan from public.order_packing_scans s
  where s.session_id=p_session_id and s.scan_key=p_scan_key for update;
  if not found then raise exception 'lectura inexistente' using errcode='P0002'; end if;
  update public.order_packing_scans set reverted_at=coalesce(reverted_at,now()) where id=v_scan.id;
  update public.order_packing_sessions set status='in_progress',updated_at=now() where id=p_session_id;
  v_result:=jsonb_build_object('ok',true,'scan_key',p_scan_key,'reverted',true);
  insert into public.business_command_receipts(
    business_id,order_id,actor_user_id,command_type,idempotency_key,request_hash,result
  ) values (
    v_session.business_id,v_session.order_id,auth.uid(),'revert_packing_scan',p_idempotency_key,v_hash,v_result
  );
  return v_result||jsonb_build_object('idempotent_replay',false);
end;
$packing_revert$;

create or replace function public.confirm_packing_session_once(
  p_session_id uuid,
  p_exception_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $packing_confirm$
declare
  v_session public.order_packing_sessions%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_complete boolean;
  v_hash text;
  v_result jsonb;
begin
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode='22023';
  end if;
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  v_hash:=public.business_command_request_hash(
    'confirm_packing_session',v_session.order_id,
    jsonb_build_object('session_id',p_session_id,'exception_reason',nullif(btrim(coalesce(p_exception_reason,'')),''))
  );
  select r.* into v_receipt from public.business_command_receipts r
  where r.business_id=v_session.business_id and r.idempotency_key=p_idempotency_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode='23505';
    end if;
    return v_receipt.result||jsonb_build_object('idempotent_replay',true);
  end if;
  if v_session.status='confirmed' then
    v_result:=to_jsonb(v_session)||jsonb_build_object('ok',true);
  else
    if v_session.status not in ('in_progress','complete','exception_required') then
      raise exception 'sesion cerrada' using errcode='P0001';
    end if;
    select not exists(
      select 1 from public.order_items oi where oi.order_id=v_session.order_id
        and coalesce((select sum(ps.unit_factor) from public.order_packing_scans ps where ps.session_id=v_session.id and ps.order_item_id=oi.id and ps.reverted_at is null),0)<>oi.quantity
    ) into v_complete;
    if not v_complete and (
      not public.has_business_role(v_session.business_id,array['owner','admin'])
      or char_length(btrim(coalesce(p_exception_reason,''))) not between 3 and 300
    ) then
      raise exception 'faltantes requieren excepcion owner/admin con motivo' using errcode='42501';
    end if;
    update public.order_packing_sessions
    set status='confirmed',exception_reason=case when v_complete then null else btrim(p_exception_reason) end,
        exception_authorized_by=case when v_complete then null else auth.uid() end,
        confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
    where id=p_session_id returning * into v_session;
    v_result:=to_jsonb(v_session)||jsonb_build_object('ok',true);
  end if;
  insert into public.business_command_receipts(
    business_id,order_id,actor_user_id,command_type,idempotency_key,request_hash,result
  ) values (
    v_session.business_id,v_session.order_id,auth.uid(),'confirm_packing_session',p_idempotency_key,v_hash,v_result
  );
  return v_result||jsonb_build_object('idempotent_replay',false);
end;
$packing_confirm$;

revoke all on function public.record_packing_scan(uuid,text,text)
from public,anon,authenticated;
revoke all on function public.get_packing_manifest(uuid)
from public,anon,authenticated;
revoke all on function public.revert_packing_scan(uuid,text,text)
from public,anon,authenticated;
revoke all on function public.confirm_packing_session_once(uuid,text,text)
from public,anon,authenticated;
grant execute on function public.record_packing_scan(uuid,text,text),
  public.get_packing_manifest(uuid),
  public.revert_packing_scan(uuid,text,text),
  public.confirm_packing_session_once(uuid,text,text)
to authenticated;
