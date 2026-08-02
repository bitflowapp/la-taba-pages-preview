import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = new URL('../supabase/migrations/20260802160000_business_windows_scanner_fiscal.sql', import.meta.url);
const sql = fs.readFileSync(file, 'utf8');

test('migraci\u00f3n es incremental y posterior al gate de revisiones', () => {
  assert.match(file.pathname, /20260802160000_business_windows_scanner_fiscal[.]sql$/);
  assert.doesNotMatch(sql, /drop table|truncate table/i);
});

test('barcodes son texto, \u00fanicos por negocio, validan check digit y factor positivo', () => {
  assert.match(sql, /create table if not exists public[.]product_barcodes/i);
  assert.match(sql, /gtin text not null/i);
  assert.match(sql, /unique [(]business_id, gtin[)]/i);
  assert.match(sql, /gtin_check_digit_valid[(]gtin[)]/i);
  assert.match(sql, /unit_factor integer not null default 1 check [(]unit_factor > 0[)]/i);
});

test('borrador requiere confirmaci\u00f3n owner/admin y no publica producto incompleto', () => {
  assert.match(sql, /create table if not exists public[.]catalog_product_drafts/i);
  assert.match(sql, /publish_catalog_product_draft[\s\S]*has_business_role[(]v_draft[.]business_id, array\['owner', 'admin'\][)]/i);
  assert.match(sql, /requires_catalog_verification', true/i);
  assert.match(sql, /values [(]v_draft[.]business_id[\s\S]*false, false, false, 'commercial'[)]/i);
});

test('ledger de inventario es inmutable, idempotente y bloquea stock negativo bajo lock', () => {
  assert.match(sql, /create table if not exists public[.]inventory_movements/i);
  assert.match(sql, /unique [(]business_id, idempotency_key[)]/i);
  assert.match(sql, /before update or delete on public[.]inventory_movements/i);
  assert.match(sql, /from public[.]products p[\s\S]*for update/i);
  assert.match(sql, /stock negativo bloqueado/i);
});

test('packing persiste sesiones/scans y rechaza producto o cantidad incorrectos', () => {
  assert.match(sql, /create table if not exists public[.]order_packing_sessions/i);
  assert.match(sql, /create table if not exists public[.]order_packing_scans/i);
  assert.match(sql, /producto equivocado/i);
  assert.match(sql, /cantidad excedida/i);
  assert.match(sql, /start_packing_session[\s\S]*conflicto de revision/i);
  assert.match(sql, /undo_last_packing_scan/i);
  assert.match(sql, /confirm_packing_session[\s\S]*excepcion owner\/admin con motivo/i);
  assert.match(sql, /unique[(]business_id, idempotency_key[)]/i);
});

test('POS calcula precios en servidor, bloquea producto y descuenta stock at\u00f3micamente', () => {
  assert.match(sql, /create or replace function public[.]checkout_pos_sale/i);
  assert.match(sql, /p_items[\s\S]*productId','quantity'[\s\S]*payload de item no permitido/i);
  assert.match(sql, /from public[.]products p[\s\S]*for update/i);
  assert.match(sql, /update public[.]products set stock = stock - v_quantity/i);
  assert.match(sql, /insert into public[.]inventory_movements/i);
});

test('comandos de pedido usan CAS, idempotencia, roles y search_path fijo', () => {
  for (const name of ['acknowledge_order', 'transition_order', 'set_preparation_estimate', 'cancel_order']) {
    assert.match(sql, new RegExp(`create or replace function public[.]${name}`, 'i'));
  }
  assert.match(sql, /business_command_receipts[\s\S]*unique [(]business_id, idempotency_key[)]/i);
  assert.match(sql, /revision desactualizada/i);
  assert.match(sql, /set search_path = pg_catalog, public, extensions, pg_temp/i);
});

test('fiscal arranca disabled y producci\u00f3n exige revisi\u00f3n contable del servidor', () => {
  assert.match(sql, /environment text not null default 'disabled'/i);
  assert.match(sql, /accountant_review_status text not null default 'pending'/i);
  assert.match(sql, /environment <> 'production'[\s\S]*accountant_review_status = 'approved'[\s\S]*production_gate_status = 'approved'/i);
  assert.match(sql, /produccion no se configura desde el panel/i);
});

test('outbox fiscal aplica exactly-once, numeraci\u00f3n \u00fanica, SKIP LOCKED, lease y dead-letter', () => {
  assert.match(sql, /unique[(]business_id, source_type, source_id, document_intent[)]/i);
  assert.match(sql, /unique[(]environment, cuit, point_of_sale, document_type, document_number[)]/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /lease_owner[\s\S]*lease_deadline/i);
  assert.match(sql, /dead_letter/i);
  assert.match(sql, /reserve_fiscal_document_number[\s\S]*pg_advisory_xact_lock/i);
  assert.match(sql, /insert into public[.]fiscal_request_attempts/i);
});

test('parámetros WSFE se guardan versionados sólo desde el worker privado', () => {
  assert.match(sql, /save_fiscal_parameter_snapshot/i);
  assert.match(sql, /unique[(]environment, parameter_type, version[)]/i);
  assert.match(sql, /p_parameter_type not in \('document_types','recipient_document_types','vat_types','currencies','concepts','points_of_sale'\)/i);
  assert.match(sql, /save_fiscal_parameter_snapshot[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /save_fiscal_parameter_snapshot[\s\S]*to service_role/i);
});

test('autorizaci\u00f3n exige CAE y ambig\u00fcedad vuelve a reconciliaci\u00f3n', () => {
  assert.match(sql, /fiscal_authorized_has_cae[\s\S]*cae ~ '\^\[0-9\][{]14[}]\$'/i);
  assert.match(sql, /v_class='ambiguous'[\s\S]*state='ambiguous'[\s\S]*state='retry_wait'/i);
  assert.match(sql, /autorizacion sin CAE o numero valido/i);
  assert.match(sql, /REQUIRES_FISCAL_REVIEW[\s\S]*state='dead_letter'/i);
});

test('nota de cr\u00e9dito conserva la factura y requiere acci\u00f3n owner/admin con motivo', () => {
  assert.match(sql, /request_full_credit_note/i);
  assert.match(sql, /has_business_role[(]v_original[.]business_id,array\['owner','admin'\][)]/i);
  assert.match(sql, /motivo requerido/i);
  assert.match(sql, /associated_document_id/i);
  assert.match(sql, /un comprobante autorizado no se elimina/i);
});

test('RLS y grants cierran escrituras directas y worker privado no queda en authenticated', () => {
  assert.match(sql, /alter table public[.]fiscal_outbox enable row level security/i);
  assert.match(sql, /revoke all on table[\s\S]*from anon, authenticated/i);
  assert.match(sql, /revoke all on function public[.]claim_fiscal_outbox[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public[.]claim_fiscal_outbox[\s\S]*to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public[.]claim_fiscal_outbox[\s\S]*to authenticated/i);
});

test('Realtime es acelerador para snapshots autoritativos', () => {
  assert.match(sql, /alter publication supabase_realtime add table public[.]inventory_movements/i);
  assert.match(sql, /alter publication supabase_realtime add table public[.]fiscal_documents/i);
});
