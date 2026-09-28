-- ============================================================================
--  ADOPCION DEL CORE FISCAL · guardas de La Taba sobre los canales de servidor
-- ============================================================================
--
--  Unica diferencia de comportamiento con bitflowapp/taba-fiscal@26d2f4c:
--  service_request_fiscal_document, la entrada de WHATSAPP y AUTOMATION.
--  Candidata a llevarse al core (docs/TABA-FISCAL-CORE-ADOPTION.md §5).
--
--  QUE SE MIDIO (revision cruzada 2026-09-27, PG17 con el esquema real):
--    · el core solo protege esta entrada con GRANT a service_role, y el GRANT
--      no rige dentro de una funcion SECURITY DEFINER: bill_commercial_order
--      (PR #106) la invocaba para anon y cualquier usuario, que elegia el canal
--      y creaba intenciones fiscales de otro negocio;
--    · con un actor NULL todo quedaba como 'system', aunque del otro lado del
--      WhatsApp haya una persona;
--    · el actor solo tenia que ser miembro activo: un repartidor podia figurar
--      como quien pidio la factura.
--
--  CONTRATO QUE QUEDA (misma firma, misma ruta unica de emision):
--    · solo con un JWT de service_role (identity_jwt_claims, que trata un
--      claim ilegible como ausente); cualquier otro llamador: 42501;
--    · WHATSAPP exige el usuario que escribio (p_actor_id): nunca 'system'
--      cuando hay una persona real;
--    · AUTOMATION puede no tener persona: queda actor_type 'system',
--      actor_id NULL y command_source 'AUTOMATION' en fiscal_events y en
--      fiscal_idempotency_keys (la identidad del sistema es explicita);
--    · el actor, si viene, es back office ACTIVO de ese negocio
--      (owner, admin, staff): ni repartidor, ni cliente, ni otro negocio.
-- ============================================================================

create or replace function public.service_request_fiscal_document(
  p_business_id uuid,
  p_source_type text,
  p_source_id uuid,
  p_document_intent text,
  p_idempotency_key text,
  p_command_source text,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $service_request_fiscal_document$
begin
  if coalesce(public.identity_jwt_claims() ->> 'role', '') <> 'service_role' then
    raise exception 'canal de servidor no autorizado' using errcode = '42501';
  end if;
  if p_command_source is null or p_command_source not in ('WHATSAPP','AUTOMATION') then
    raise exception 'canal de servicio invalido' using errcode = '22023';
  end if;
  if p_command_source = 'WHATSAPP' and p_actor_id is null then
    raise exception 'un pedido por WhatsApp requiere el usuario que lo hizo' using errcode = '22023';
  end if;
  if p_actor_id is not null and not exists (
    select 1 from public.business_members m
     where m.business_id = p_business_id and m.user_id = p_actor_id and m.is_active
       and m.role in ('owner','admin','staff')
  ) then
    raise exception 'actor ajeno al negocio' using errcode = '42501';
  end if;
  return private.fiscal_request_invoice(p_business_id, p_source_type, p_source_id, p_document_intent, p_idempotency_key, p_command_source, p_actor_id, 'system');
end;
$service_request_fiscal_document$;

revoke all on function public.service_request_fiscal_document(uuid, text, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.service_request_fiscal_document(uuid, text, uuid, text, text, text, uuid) to service_role;

comment on function public.service_request_fiscal_document(uuid, text, uuid, text, text, text, uuid) is
  'Intencion fiscal desde un canal de servidor (WHATSAPP, AUTOMATION). Solo con JWT de service_role; WHATSAPP exige el usuario; el actor es back office activo del negocio. Misma ruta y misma identidad que request_fiscal_document.';
