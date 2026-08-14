-- ─────────────────────────────────────────────────────────────────────────────
-- H-07 · El repartidor deja de leer la caja, lo fiscal y la auditoría
--
-- `business_members.role` admite owner, admin, staff y RIDER, y la tabla se
-- documenta diciendo que «staff and rider have scoped operational access».
-- Pero la función en la que se apoyan estas policies NO MIRA EL ROL:
--
--   is_business_member(id) := identity_member_role(id) is not null
--
-- `identity_member_role` verifica mucho —usuario no anónimo, membresía activa,
-- usuario no deshabilitado, sesión no revocada, token posterior al corte— y
-- después devuelve el rol sin compararlo con nada. Un repartidor, que muchas
-- veces es un tercero contratado, satisface la condición igual que un dueño.
--
-- El «scoped» del comentario no estaba implementado. Acá se implementa.
--
-- ALCANCE MEDIDO: son 28 policies, no 19. El recuento anterior cubría un solo
-- archivo de migración; éste sale de resolver drop/create sobre las 96 en orden
-- de aplicación. Las 28 son de SELECT: ninguna policy de escritura se apoyaba en
-- `is_business_member`, así que este cambio sólo puede quitar lecturas.
--
-- QUÉ NO SE TOCA, a propósito:
--   · `is_business_member` en sí. Sigue siendo la respuesta correcta a la
--     pregunta «¿pertenece a este comercio?», que en otros lugares es la que
--     corresponde.
--   · `is_assigned_rider`, ni ninguna policy por la que el repartidor ve LOS
--     PEDIDOS QUE TIENE ASIGNADOS. Ése es su trabajo.
--   · Las 11 RPC del Rider. Todas son SECURITY DEFINER, así que RLS no las
--     alcanza y este cambio no puede afectarlas.
--
-- IMPACTO, verificado y no estimado:
--   · La app del Rider (Dart, feature/taba2-rider-pilot-integration @ 894267a)
--     no menciona NINGUNA de las 28 tablas. Cero referencias.
--   · En el cliente web sólo se leen 5 de forma directa —fiscal_documents,
--     fiscal_profiles, inventory_movements, pos_sales y product_barcodes— y las
--     cinco desde tres repositorios del PANEL: supabase-fiscal-repository,
--     supabase-inventory-repository y supabase-pos-repository.
--   · El Panel lo operan owner, admin y staff, que es exactamente el conjunto
--     que estas policies conservan. Nadie que hoy opere pierde nada.
--
-- POR QUÉ ESTE TRÍO Y NO OTRO: `array['owner','admin','staff']` es la convención
-- dominante del esquema, con 71 usos frente a 60 de `['owner','admin']`. Es «el
-- equipo que opera el Panel», que es justo la pregunta que estas 28 hacen.
--
-- REVERSIÓN: docs/migrations/rollback/20260814050000_*.rollback.sql — vuelve a
-- `is_business_member(...)` en las mismas 28. No hay pérdida de datos: esta
-- migración no lee, no escribe y no borra una sola fila. Sólo cambia quién puede
-- leer.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Caja y mostrador ─────────────────────────────────────────────────────────
drop policy if exists "business reads pos sales" on public.pos_sales;
create policy "business reads pos sales" on public.pos_sales for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads pos items" on public.pos_sale_items;
create policy "business reads pos items" on public.pos_sale_items for select to authenticated
  using(exists(select 1 from public.pos_sales s where s.id=sale_id and public.has_business_role(s.business_id, array['owner','admin','staff'])));

drop policy if exists "business reads pos payments" on public.pos_payments;
create policy "business reads pos payments" on public.pos_payments for select to authenticated
  using(exists(select 1 from public.pos_sales s where s.id=sale_id and public.has_business_role(s.business_id, array['owner','admin','staff'])));

drop policy if exists "business reads daily reconciliations" on public.daily_reconciliations;
create policy "business reads daily reconciliations" on public.daily_reconciliations for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads daily reconciliation events" on public.daily_reconciliation_events;
create policy "business reads daily reconciliation events" on public.daily_reconciliation_events for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

-- ── Fiscal ───────────────────────────────────────────────────────────────────
drop policy if exists "business reads fiscal profiles" on public.fiscal_profiles;
create policy "business reads fiscal profiles" on public.fiscal_profiles for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads fiscal profile events" on public.fiscal_profile_events;
create policy "business reads fiscal profile events" on public.fiscal_profile_events for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads fiscal documents" on public.fiscal_documents;
create policy "business reads fiscal documents" on public.fiscal_documents for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads fiscal items" on public.fiscal_document_items;
create policy "business reads fiscal items" on public.fiscal_document_items for select to authenticated
  using(exists(select 1 from public.fiscal_documents d where d.id=fiscal_document_id and public.has_business_role(d.business_id, array['owner','admin','staff'])));

drop policy if exists "business reads fiscal events" on public.fiscal_events;
create policy "business reads fiscal events" on public.fiscal_events for select to authenticated
  using(exists(select 1 from public.fiscal_documents d where d.id=fiscal_document_id and public.has_business_role(d.business_id, array['owner','admin','staff'])));

drop policy if exists "business reads fiscal artifact metadata" on public.fiscal_document_artifacts;
create policy "business reads fiscal artifact metadata" on public.fiscal_document_artifacts for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads fiscal print audit" on public.fiscal_print_jobs;
create policy "business reads fiscal print audit" on public.fiscal_print_jobs for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads fiscal credit allocations" on public.fiscal_credit_allocations;
create policy "business reads fiscal credit allocations" on public.fiscal_credit_allocations for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin','staff']));

-- ── Auditoría de comandos ────────────────────────────────────────────────────
-- La más sensible del lote: lleva el payload de las órdenes, o sea datos
-- personales de clientes con los que un repartidor no tiene ninguna relación.
drop policy if exists "business reads command audit" on public.business_command_receipts;
create policy "business reads command audit" on public.business_command_receipts for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads scanned product audit" on public.scanned_product_audit;
create policy "business reads scanned product audit" on public.scanned_product_audit for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin','staff']));

-- ── Inventario y conteos ─────────────────────────────────────────────────────
drop policy if exists "business reads inventory ledger" on public.inventory_movements;
create policy "business reads inventory ledger" on public.inventory_movements for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads receipts" on public.inventory_receipts;
create policy "business reads receipts" on public.inventory_receipts for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads receipt items" on public.inventory_receipt_items;
create policy "business reads receipt items" on public.inventory_receipt_items for select to authenticated
  using(exists(select 1 from public.inventory_receipts r where r.id=receipt_id and public.has_business_role(r.business_id, array['owner','admin','staff'])));

drop policy if exists "business reads stock counts" on public.stock_count_sessions;
create policy "business reads stock counts" on public.stock_count_sessions for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads stock count items" on public.stock_count_items;
create policy "business reads stock count items" on public.stock_count_items for select to authenticated
  using(exists(select 1 from public.stock_count_sessions s where s.id=session_id and public.has_business_role(s.business_id, array['owner','admin','staff'])));

-- ── Catálogo interno y códigos ───────────────────────────────────────────────
drop policy if exists "business reads product drafts" on public.catalog_product_drafts;
create policy "business reads product drafts" on public.catalog_product_drafts for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads barcode catalog" on public.product_barcodes;
create policy "business reads barcode catalog" on public.product_barcodes for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

-- ── Preparación de pedidos ───────────────────────────────────────────────────
-- El repartidor NO necesita esto: lo que tiene que saber de su pedido asignado
-- se lo entregan get_rider_queue y get_active_rider_delivery, que son SECURITY
-- DEFINER y no pasan por estas policies.
drop policy if exists "business reads packing" on public.order_packing_sessions;
create policy "business reads packing" on public.order_packing_sessions for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads packing scans" on public.order_packing_scans;
create policy "business reads packing scans" on public.order_packing_scans for select to authenticated
  using(exists(select 1 from public.order_packing_sessions s where s.id=session_id and public.has_business_role(s.business_id, array['owner','admin','staff'])));

-- ── Operación y notificaciones ───────────────────────────────────────────────
drop policy if exists "business reads operational alerts" on public.operational_alerts;
create policy "business reads operational alerts" on public.operational_alerts for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads operational alert events" on public.operational_alert_events;
create policy "business reads operational alert events" on public.operational_alert_events for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

drop policy if exists "business reads notification status" on public.notification_outbox;
create policy "business reads notification status" on public.notification_outbox for select to authenticated
  using(public.has_business_role(business_id, array['owner','admin','staff']));

-- ── Tabla legacy ─────────────────────────────────────────────────────────────
-- `public.riders` no la lee nadie: cero referencias en el cliente web y cero en
-- la app del Rider. Se cierra por el mismo criterio, no por uso.
drop policy if exists "operational team reads legacy riders" on public.riders;
create policy "operational team reads legacy riders" on public.riders for select to authenticated
  using (public.has_business_role(business_id, array['owner','admin','staff']));

comment on function public.is_business_member(uuid) is
  'Pertenencia al comercio SIN mirar el rol: incluye rider. Para superficies de back office (caja, fiscal, inventario, auditoria) usar has_business_role(id, array[''owner'',''admin'',''staff'']) — ver H-07.';
