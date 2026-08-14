-- REVERSIÓN de 20260814050000_back_office_reads_exclude_riders.sql (H-07)
--
-- Devuelve las 28 policies de SELECT a `is_business_member(...)`, es decir a
-- permitir que el rol `rider` lea caja, fiscal, inventario y auditoría.
--
-- Estas sentencias son la definición EXACTA que existía antes de la migración:
-- se generaron resolviendo drop/create sobre las 96 migraciones previas, no se
-- transcribieron a mano.
--
-- ESTE ARCHIVO NO ES UNA MIGRACIÓN y vive fuera de supabase/migrations a
-- propósito, para que `supabase db push` no pueda aplicarlo por accidente. Se
-- ejecuta a mano y sólo con una decisión explícita de quien opera.
--
-- No hay pérdida de datos en ninguno de los dos sentidos: sólo cambia quién lee.
-- Después de revertir, la exposición de H-07 vuelve a estar abierta.

begin;

drop policy if exists "business reads command audit" on public.business_command_receipts;
create policy "business reads command audit" on public.business_command_receipts for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads product drafts" on public.catalog_product_drafts;
create policy "business reads product drafts" on public.catalog_product_drafts for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads daily reconciliation events" on public.daily_reconciliation_events;
create policy "business reads daily reconciliation events" on public.daily_reconciliation_events for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads daily reconciliations" on public.daily_reconciliations;
create policy "business reads daily reconciliations" on public.daily_reconciliations for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads fiscal credit allocations" on public.fiscal_credit_allocations;
create policy "business reads fiscal credit allocations" on public.fiscal_credit_allocations for select to authenticated using (public.is_business_member(business_id));

drop policy if exists "business reads fiscal artifact metadata" on public.fiscal_document_artifacts;
create policy "business reads fiscal artifact metadata" on public.fiscal_document_artifacts for select to authenticated using (public.is_business_member(business_id));

drop policy if exists "business reads fiscal items" on public.fiscal_document_items;
create policy "business reads fiscal items" on public.fiscal_document_items for select to authenticated using(exists(select 1 from public.fiscal_documents d where d.id=fiscal_document_id and public.is_business_member(d.business_id)));

drop policy if exists "business reads fiscal documents" on public.fiscal_documents;
create policy "business reads fiscal documents" on public.fiscal_documents for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads fiscal events" on public.fiscal_events;
create policy "business reads fiscal events" on public.fiscal_events for select to authenticated using(exists(select 1 from public.fiscal_documents d where d.id=fiscal_document_id and public.is_business_member(d.business_id)));

drop policy if exists "business reads fiscal print audit" on public.fiscal_print_jobs;
create policy "business reads fiscal print audit" on public.fiscal_print_jobs for select to authenticated using (public.is_business_member(business_id));

drop policy if exists "business reads fiscal profile events" on public.fiscal_profile_events;
create policy "business reads fiscal profile events" on public.fiscal_profile_events for select to authenticated using (public.is_business_member(business_id));

drop policy if exists "business reads fiscal profiles" on public.fiscal_profiles;
create policy "business reads fiscal profiles" on public.fiscal_profiles for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads inventory ledger" on public.inventory_movements;
create policy "business reads inventory ledger" on public.inventory_movements for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads receipt items" on public.inventory_receipt_items;
create policy "business reads receipt items" on public.inventory_receipt_items for select to authenticated using(exists(select 1 from public.inventory_receipts r where r.id=receipt_id and public.is_business_member(r.business_id)));

drop policy if exists "business reads receipts" on public.inventory_receipts;
create policy "business reads receipts" on public.inventory_receipts for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads notification status" on public.notification_outbox;
create policy "business reads notification status" on public.notification_outbox for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads operational alert events" on public.operational_alert_events;
create policy "business reads operational alert events" on public.operational_alert_events for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads operational alerts" on public.operational_alerts;
create policy "business reads operational alerts" on public.operational_alerts for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads packing scans" on public.order_packing_scans;
create policy "business reads packing scans" on public.order_packing_scans for select to authenticated using(exists(select 1 from public.order_packing_sessions s where s.id=session_id and public.is_business_member(s.business_id)));

drop policy if exists "business reads packing" on public.order_packing_sessions;
create policy "business reads packing" on public.order_packing_sessions for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads pos payments" on public.pos_payments;
create policy "business reads pos payments" on public.pos_payments for select to authenticated using(exists(select 1 from public.pos_sales s where s.id=sale_id and public.is_business_member(s.business_id)));

drop policy if exists "business reads pos items" on public.pos_sale_items;
create policy "business reads pos items" on public.pos_sale_items for select to authenticated using(exists(select 1 from public.pos_sales s where s.id=sale_id and public.is_business_member(s.business_id)));

drop policy if exists "business reads pos sales" on public.pos_sales;
create policy "business reads pos sales" on public.pos_sales for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "business reads barcode catalog" on public.product_barcodes;
create policy "business reads barcode catalog" on public.product_barcodes for select to authenticated using(public.is_business_member(business_id));

drop policy if exists "operational team reads legacy riders" on public.riders;
create policy "operational team reads legacy riders" on public.riders for select to authenticated using (public.is_business_member(business_id));

drop policy if exists "business reads scanned product audit" on public.scanned_product_audit;
create policy "business reads scanned product audit" on public.scanned_product_audit for select to authenticated using (public.is_business_member(business_id));

drop policy if exists "business reads stock count items" on public.stock_count_items;
create policy "business reads stock count items" on public.stock_count_items for select to authenticated using(exists(select 1 from public.stock_count_sessions s where s.id=session_id and public.is_business_member(s.business_id)));

drop policy if exists "business reads stock counts" on public.stock_count_sessions;
create policy "business reads stock counts" on public.stock_count_sessions for select to authenticated using(public.is_business_member(business_id));

comment on function public.is_business_member(uuid) is
  'Membresia Auth -> negocio. No distingue rol.';

commit;
