import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = new URL('../supabase/migrations/20260804090000_business_operations_panel.sql', import.meta.url);
const sql = fs.readFileSync(file, 'utf8');

test('la migración es incremental y posterior a la última del RC', () => {
  assert.match(file.pathname, /20260804090000_business_operations_panel[.]sql$/);
  assert.doesNotMatch(sql, /drop table|truncate table/i);
});

test('el panel nunca recibe el Access Token de Mercado Pago', () => {
  assert.doesNotMatch(sql, /access_token/i);
  // Los identificadores públicos se devuelven recortados, no completos.
  assert.match(sql, /'collector_id_short', right[(]coalesce[(]v_settings[.]collector_id, ''[)], 4[)]/i);
  assert.match(sql, /'application_id_short', right[(]coalesce[(]v_settings[.]application_id, ''[)], 4[)]/i);
});

test('la configuración de cobros rechaza cualquier clave fuera de la lista permitida', () => {
  assert.match(sql, /create or replace function public[.]configure_mercadopago_settings/i);
  assert.match(sql, /v_allowed text\[\] := array\['collector_id', 'application_id', 'installments_limit', 'preference_expiration_minutes', 'reserve_stock', 'enabled'\]/i);
  assert.match(sql, /coalesce[(]p_settings, '\{\}'::jsonb[)] - v_allowed <> '\{\}'::jsonb then\s*\n\s*raise exception 'payload no permitido'/i);
});

test('el panel no puede configurar cobros con dinero real', () => {
  assert.match(sql, /if v_settings[.]environment <> 'test' then\s*\n\s*raise exception 'el panel no configura cobros con dinero real'/i);
});

test('los estados de cobros y de ARCA exigen rol del negocio', () => {
  for (const fn of [
    'get_mercadopago_activation_status',
    'configure_mercadopago_settings',
    'get_arca_activation_status',
    'authorize_arca_homologation',
    'get_business_opening_status',
    'complete_scanned_product',
    'get_scanned_product_readiness',
  ]) {
    const block = sql.slice(sql.indexOf(`function public.${fn}`));
    assert.match(block.slice(0, 1800), /has_business_role/i, `${fn} debería exigir rol`);
  }
});

test('las acciones de dinero, publicación y fiscal exigen owner o admin', () => {
  for (const fn of ['configure_mercadopago_settings', 'authorize_arca_homologation', 'complete_scanned_product', 'record_fiscal_verification']) {
    const block = sql.slice(sql.indexOf(`function public.${fn}`), sql.indexOf(`function public.${fn}`) + 1200);
    assert.match(block, /array\['owner', 'admin'\]/i, `${fn} debería exigir owner/admin`);
  }
});

test('la homologación de ARCA exige la frase exacta y deja rastro de quién autorizó', () => {
  assert.match(sql, /p_authorization is distinct from 'I_AUTHORIZE_ARCA_HOMOLOGATION'/);
  assert.match(sql, /homologation_authorized_by = auth[.]uid[(][)]/i);
  // El insert original apuntaba a columnas que fiscal_events no tiene y exigía un comprobante que
  // una autorización no emite. Se corrigió en 20260805120000; se verifica en el test de esa migración.
  // El gate original de esta migración confundía configurar con autorizar y quedaba en una
  // dependencia circular. La garantía real vive ahora en la ruta de ejecución; se verifica en
  // fiscal-homologation-authorization-migration.test.mjs.
});

test('la homologación se niega sin contador, sin datos fiscales o con certificado vencido', () => {
  assert.match(sql, /accountant_review_status <> 'approved' then\s*\n\s*raise exception 'falta la aprobacion contable'/i);
  assert.match(sql, /raise exception 'faltan datos fiscales obligatorios'/i);
  assert.match(sql, /certificate_expires_at <= clock_timestamp[(][)] then\s*\n\s*raise exception 'certificado vencido'/i);
});

test('la producción fiscal sigue sin ruta de activación desde el panel', () => {
  assert.doesNotMatch(sql, /environment\s*=\s*'production'/i);
  assert.doesNotMatch(sql, /production_gate_status\s*=\s*'approved'/i);
});

test('el estado fiscal expuesto no incluye clave privada, ticket ni XML', () => {
  const block = sql.slice(sql.indexOf('function public.get_arca_activation_status'), sql.indexOf('$get_arca_activation_status$;'));
  for (const forbidden of ['private_key', 'privatekey', 'wsaa_token', 'token', 'sign', 'xml', 'payload', 'last_error_message']) {
    assert.doesNotMatch(block, new RegExp(forbidden, 'i'), `no debería exponer ${forbidden}`);
  }
  assert.match(block, /'certificate_loaded', v_profile[.]certificate_fingerprint_sha256 is not null/i);
});

test('el puente sólo puede publicar códigos de error saneados', () => {
  assert.match(sql, /p_error_code !~ '\^\[A-Z\]\[A-Z0-9_\]\{2,63\}\$' then\s*\n\s*raise exception 'codigo de error no saneado'/i);
  assert.match(sql, /grant execute on function public[.]record_fiscal_credential_health[(]uuid, text, timestamptz, text, text, boolean, text[)] to service_role/i);
  assert.match(sql, /revoke execute on function public[.]record_fiscal_credential_health[(][^)]*[)] from public, anon, authenticated/i);
});

test('un producto escaneado con precio pendiente queda visible pero no comprable', () => {
  assert.match(sql, /price_status = case when v_price_pending then 'pending' else 'confirmed' end/i);
  assert.match(sql, /available = [(]not v_price_pending[)] and v_stock > 0 and is_verified/i);
  assert.match(sql, /'purchasable', coalesce[(]v_product[.]available, false[)][\s\S]*price_status = 'confirmed'/i);
});

test('completar un producto no inventa datos ni acepta campos ajenos', () => {
  assert.match(sql, /raise exception 'faltan datos obligatorios del producto'/i);
  assert.match(sql, /v_capacity_unit not in [(]'ml', 'l', 'g', 'kg', 'unidad'[)]/i);
  assert.match(sql, /v_units < 1 then\s*\n\s*raise exception 'unidades por pack invalidas'/i);
  assert.match(sql, /coalesce[(]p_details, '\{\}'::jsonb[)] - v_allowed <> '\{\}'::jsonb/i);
});

test('cada alta de producto deja auditoría con actor y código', () => {
  assert.match(sql, /create table if not exists public[.]scanned_product_audit/i);
  assert.match(sql, /insert into public[.]scanned_product_audit [(]business_id, product_id, gtin, action, actor_id, detail[)]/i);
  assert.match(sql, /actor_id uuid not null references auth[.]users[(]id[)] on delete restrict/i);
  assert.match(sql, /alter table public[.]scanned_product_audit enable row level security/i);
});

test('las tablas nuevas revocan privilegios amplios antes de conceder lectura', () => {
  assert.match(sql, /revoke all privileges on table public[.]scanned_product_audit from public, anon, authenticated/i);
  assert.match(sql, /grant select on table public[.]scanned_product_audit to authenticated/i);
  assert.doesNotMatch(sql, /grant all[\s\S]{0,120}to (?:public|anon)\b/i);
});

test('ninguna función nueva queda accesible para anónimos', () => {
  const functions = [...sql.matchAll(/create or replace function public[.]([a-z_]+)/gi)].map((match) => match[1]);
  assert.equal(new Set(functions).size, functions.length, 'no debería redefinir la misma función dos veces');
  for (const fn of functions) {
    assert.match(
      sql,
      new RegExp(`revoke execute on function public[.]${fn}[(][^)]*[)] from public, anon`, 'i'),
      `${fn} debería revocar acceso anónimo`,
    );
  }
});

test('toda función con privilegios elevados fija el search_path', () => {
  const definers = sql.split('create or replace function').slice(1);
  for (const block of definers) {
    if (!/security definer/i.test(block)) continue;
    assert.match(block.slice(0, 900), /set search_path = pg_catalog, public/i);
  }
});

test('abrir el negocio informa cada verificación con un texto para el mostrador', () => {
  assert.match(sql, /create or replace function public[.]get_business_opening_status/i);
  for (const key of ['backend', 'payments', 'fiscal', 'riders', 'queues']) {
    assert.match(sql, new RegExp(`'${key}', jsonb_build_object`, 'i'), `falta el chequeo ${key}`);
  }
  assert.match(sql, /'La web todavía no acepta pedidos[.]'/);
  assert.match(sql, /'No quedó nada trabado de antes[.]'/);
});
