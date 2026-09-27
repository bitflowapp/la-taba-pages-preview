-- TABA · ADOPCION DEL CORE FISCAL · UPGRADE sobre datos existentes
--
-- Requiere supabase/tests/fixtures/fiscal_core_legacy_rows.sql cargado ANTES de
-- las migraciones de adopcion (lo hace scripts/run-release-v5-db.mjs). Verifica
-- sobre esas filas, ya migradas:
--
--   NO DATA LOSS           · los 11 comprobantes, sus colas, items, PDF e impresiones siguen;
--   NO DUPLICATE DOCUMENTS · una intencion por venta, una clave por comprobante;
--   NO NUMBER REUSE        · lo autorizado no cambia; un numero que pudo llegar a ARCA
--                            queda retenido y otro comprobante no puede reservarlo (TF002);
--   NO CREDIT ALLOCATION LOSS · la NC fallida despues de reservar numero recupera sus asignaciones;
--   NO INVALID STATE       · todo cumple la maquina de estados y el registro de envios.
--
-- Todo lo que escribe corre en una transaccion que termina en rollback.

begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

create temporary table t_doc(k text primary key, id uuid) on commit drop;
insert into t_doc values
  ('L1','f1e90000-0000-4000-8000-000000000001'),('L2','f1e90000-0000-4000-8000-000000000002'),
  ('L3','f1e90000-0000-4000-8000-000000000003'),('L4','f1e90000-0000-4000-8000-000000000004'),
  ('L5','f1e90000-0000-4000-8000-000000000005'),('L6','f1e90000-0000-4000-8000-000000000006'),
  ('L7','f1e90000-0000-4000-8000-000000000007'),('L8','f1e90000-0000-4000-8000-000000000008'),
  ('L9','f1e90000-0000-4000-8000-000000000009'),('L10','f1e90000-0000-4000-8000-000000000010'),
  ('L11','f1e90000-0000-4000-8000-000000000011');
grant all on t_doc to service_role;
create or replace function pg_temp.doc(p_key text) returns public.fiscal_documents language sql as $$
  select d.* from public.fiscal_documents d join t_doc t on t.id = d.id where t.k = p_key $$;

-- ══ NO DATA LOSS / NO DUPLICATES ═════════════════════════════════════════════
select is((select count(*)::integer from public.fiscal_documents d join t_doc t on t.id = d.id), 11,
  'los 11 comprobantes legados siguen ahi');
select is((select count(*)::integer from public.fiscal_outbox o join t_doc t on t.id = o.fiscal_document_id), 11,
  'y sus 11 filas de cola');
select is((select count(*)::integer from (
  select business_id, source_type, source_id, document_intent from public.fiscal_documents
   group by 1,2,3,4 having count(*) > 1) x), 0, 'ninguna intencion duplicada en toda la base');
select is((select count(*)::integer from (
  select environment, cuit, point_of_sale, document_type, document_number from public.fiscal_documents
   where document_number is not null group by 1,2,3,4,5 having count(*) > 1) x), 0, 'ningun numero duplicado en ninguna serie');
select is((select count(*)::integer from public.fiscal_idempotency_keys k join t_doc t on t.id = k.fiscal_document_id), 11,
  'cada clave ya usada quedo registrada (una por comprobante)');
select ok(not exists (select 1 from public.fiscal_idempotency_keys k join public.fiscal_documents d on d.id = k.fiscal_document_id join t_doc t on t.id = d.id
                       where d.document_intent = 'invoice' and k.request_fingerprint is null),
  'las facturas legadas quedaron con la huella de su solicitud');

-- ══ LO AUTORIZADO NO CAMBIA ══════════════════════════════════════════════════
select ok((select state = 'authorized' and document_number = 9 and cae = '74000000000009' and cae_expiration = '2026-09-30'
             and issue_date = '2026-09-20' and authorized_at = '2026-09-20 12:00:00-03' and artifact_state = 'artifact_ready'
             and net_amount = 826.45 and tax_amount = 173.55 and total_amount = 1000 from pg_temp.doc('L7')),
  'L7 autorizado: numero, CAE, fechas, importes y PDF intactos');
select ok(exists (select 1 from public.fiscal_document_artifacts a where a.fiscal_document_id = (pg_temp.doc('L7')).id and a.is_current and a.state = 'artifact_ready')
          and exists (select 1 from public.fiscal_print_jobs j where j.fiscal_document_id = (pg_temp.doc('L7')).id and j.status = 'completed_when_verifiable'),
  'su PDF vigente y su impresion A4 siguen');
select is((select array_agg(status order by id) from public.print_jobs where source_entity_id = (pg_temp.doc('L7')).id),
  array['printed','claimed'], 'los tickets del agente local siguen: el impreso y el que estaba en vuelo');

-- ══ LO QUE PUDO LLEGAR A ARCA VUELVE A CONCILIARSE ═══════════════════════════
select ok((select state = 'ambiguous' and document_number = 10 and dispatch_count >= 1 and last_dispatch_at is not null from pg_temp.doc('L3')),
  'L3 (authorizing con numero, worker caido): ambiguo, conserva el 10 y el envio registrado');
select ok((select state = 'ambiguous' and document_number = 11 and dispatch_count >= 1 from pg_temp.doc('L4'))
          and (select state = 'retry_wait' and next_attempt_at <= now() from public.fiscal_outbox where fiscal_document_id = (pg_temp.doc('L4')).id),
  'L4 (ambiguo con numero): sigue ambiguo, con envio registrado y vuelve a la cola ya');
select ok((select state = 'retry_wait' and document_number is null and dispatch_count = 0 from pg_temp.doc('L5'))
          and (select state = 'retry_wait' and document_number is null and dispatch_count = 0 from pg_temp.doc('L6'))
          and (select state = 'retry_wait' from public.fiscal_outbox where fiscal_document_id = (pg_temp.doc('L6')).id),
  'L5 y L6 (en vuelo sin numero): nada se envio, vuelven a esperar sin numero ni envios');
select is((select count(*)::integer from public.fiscal_events e join t_doc t on t.id = e.fiscal_document_id
            where t.k in ('L3','L4') and e.event_type = 'ambiguous_legacy_state'), 2,
  'cada conversion a ambiguo quedo en la auditoria');

-- ══ RECHAZO LEGADO: el numero se libera, con aviso para verificar en ARCA ══════
select ok((select state = 'rejected' and document_number is null from pg_temp.doc('L8')),
  'L8 (rechazado con numero): libera el 12 (ARCA no consumio un numero rechazado)');
select ok(exists (select 1 from public.fiscal_events e where e.fiscal_document_id = (pg_temp.doc('L8')).id
                   and e.event_type = 'legacy_rejection_number_released'
                   and (e.sanitized_detail->>'released_document_number')::bigint = 12
                   and e.sanitized_detail ? 'verification_required'),
  'y la auditoria guarda el numero liberado con la verificacion pendiente en ARCA');

-- ══ NOTA DE CREDITO: sus asignaciones no se pierden ══════════════════════════
select ok((select state = 'manual_review' and document_number = 13 and dispatch_count >= 1 from pg_temp.doc('L9')),
  'L9 (NC fallida despues de reservar numero): revision manual, conserva el 13');
select is((select array_agg(state) from public.fiscal_credit_allocations where credit_document_id = (pg_temp.doc('L9')).id),
  array['reserved'], 'sus asignaciones liberadas vuelven a reservarse: la factura no se puede acreditar dos veces');

-- ══ LO FINAL SIGUE FINAL ═════════════════════════════════════════════════════
select ok((select state = 'failed' and document_number is null from pg_temp.doc('L10'))
          and (select state = 'rejected' and document_number is null from pg_temp.doc('L11'))
          and (select state = 'queued' from pg_temp.doc('L1')) and (select state = 'retry_wait' from pg_temp.doc('L2')),
  'L1, L2, L10 y L11 no cambian');
select ok(not exists (select 1 from public.fiscal_documents d join t_doc t on t.id = d.id
   where (d.state in ('authorizing','ambiguous') and (d.document_number is null or d.dispatch_count < 1 or d.last_dispatch_at is null))
      or (d.state in ('queued','retry_wait') and (d.document_number is not null or d.dispatch_count <> 0))
      or (d.artifact_state <> 'artifact_pending' and d.state not in ('authorized','credited'))),
  'ningun estado invalido: registro de envios y PDF consistentes');

-- ══ EL WORKER CANONICO RETOMA EL TRABAJO ═════════════════════════════════════
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
create temporary table t_claim on commit drop as
  select * from public.claim_fiscal_outbox('legacy-upgrade-worker','homologation','20333333334',50,120);
set local role postgres;
select is((select array_agg(t.k order by t.k) from t_claim c join t_doc t on t.id = c.fiscal_document_id),
  array['L1','L2','L3','L4','L5','L6'], 'el worker de ese CUIT retoma exactamente lo pendiente y lo ambiguo; nada final');
select is((select count(*)::integer from t_claim where lease_epoch >= 1), 6, 'cada reclamo lleva su epoch de fencing');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(
  format($$select public.reserve_fiscal_document_number(%L,'legacy-upgrade-worker',%s,10,(now() at time zone 'America/Argentina/Buenos_Aires')::date)$$,
    (pg_temp.doc('L1')).id, (select lease_epoch from t_claim where fiscal_document_id = (pg_temp.doc('L1')).id)),
  'TF002', 'numero fiscal retenido por otro comprobante de la serie', 'NO NUMBER REUSE: el 10 (L3, pudo llegar a ARCA) no se reserva para otro');
select throws_ok(
  format($$select public.reserve_fiscal_document_number(%L,'legacy-upgrade-worker',%s,9,(now() at time zone 'America/Argentina/Buenos_Aires')::date)$$,
    (pg_temp.doc('L2')).id, (select lease_epoch from t_claim where fiscal_document_id = (pg_temp.doc('L2')).id)),
  'TF002', 'numero fiscal retenido por otro comprobante de la serie', 'ni el 9 autorizado de L7');
select throws_ok(
  format($$select public.reserve_fiscal_document_number(%L,'legacy-upgrade-worker',%s,11,(now() at time zone 'America/Argentina/Buenos_Aires')::date)$$,
    (pg_temp.doc('L3')).id, (select lease_epoch from t_claim where fiscal_document_id = (pg_temp.doc('L3')).id)),
  'TF006', 'el comprobante ya tiene numero o envio registrado: conciliar', 'un ambiguo nunca se renumera: se concilia');

select * from finish();
rollback;
