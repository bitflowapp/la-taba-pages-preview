#!/usr/bin/env node
// La conversión de la frontera de la API, vista como la ve PostgREST, contra una base LOCAL.
//
// pgTAP no puede verla: todo llamador suyo (throws_ok, un ayudante) es un marco PL/pgSQL, así que la función
// envuelta nunca es el marco más externo y re-lanza el original. Acá cada llamada es una sentencia de primer nivel
// (como la que arma PostgREST), dentro de un savepoint, con `request.method` puesto y sin él:
//
//   · con request.method: SQLSTATE PGRST, `message` = JSON con el code, message, details y hint ORIGINALES y
//     `detail` = JSON con el estado de la política (409 para 55000, 404 para P0002);
//   · sin request.method: el error original, igual al cuerpo que viaja en el PGRST;
//   · un llamador PL/pgSQL (bloque DO) con request.method: el original, no PGRST;
//   · el camino feliz no cambia.
//
// Usa el fixture de supabase/tests/http_error_contract_test.sql (sección 2) dentro de una transacción que se
// deshace al final: no deja filas.
//
//   node scripts/db/check-api-boundary.mjs --database postgres://postgres@127.0.0.1:55521/<base>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocal, BOUNDARY_STATUS } from './wrap-api-boundary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PGTAP = path.join(ROOT, 'supabase', 'tests', 'http_error_contract_test.sql');
const ID = (suffix) => `d6900000-0000-4000-8000-0000000000${suffix}`;
const CUSTOMER = { sub: ID('a9'), role: 'authenticated' };
const OWNER = { sub: ID('a1'), role: 'authenticated', session_id: ID('e1') };
const SERVICE = { role: 'service_role' };

export function fixtureSql(pgtap = fs.readFileSync(PGTAP, 'utf8')) {
  const start = pgtap.indexOf('-- ══ 2 · FIXTURE');
  const end = pgtap.indexOf('-- Ejecuta una sentencia');
  if (start < 0 || end < start) throw new Error('FIXTURE_NOT_FOUND in http_error_contract_test.sql');
  return pgtap.slice(start, end);
}

const order = (key, product, extra = {}) => `select public.create_order_with_items('${JSON.stringify({
  business_id: ID('b1'), client_request_id: `contrato-check-${key}`, tracking_token: `${key}${'k'.repeat(64)}`.slice(0, 64).replace(/[^a-z0-9]/g, 'k'),
  items: [{ product_id: ID(product), quantity: 1 }], customer_name: 'Cliente Contrato', customer_phone: '2996209137',
  delivery_mode: 'pickup', payment_method: 'cash', ...extra,
})}'::jsonb)`;
const DELIVERY = { delivery_mode: 'delivery', customer_street_address: 'Rio Senguer 1234', customer_neighborhood: 'Lejano',
  delivery_latitude: '-38.9540', delivery_longitude: '-68.0600', delivery_location_source: 'map_pin', delivery_location_confirmed_at: '2026-10-03T12:00:00Z' };

// [nombre, claims, sentencia, sqlstate original esperado, sentencias previas (dentro del savepoint)]
export const CASES = [
  ['create_order_with_items · producto no disponible', CUSTOMER, order('fuera', 'c3'), '55000'],
  ['create_order_with_items · OUT_OF_DELIVERY_ZONE', CUSTOMER, order('zona', 'c1', DELIVERY), '55000'],
  ['create_order_with_items · ALCOHOL_WINDOW_CLOSED', CUSTOMER, order('cerveza', 'c2', { age_confirmed: true }), '55000',
    [`update public.businesses set alcohol_sales_enabled = true, alcohol_minimum_age = 18, alcohol_sales_start = '00:00', alcohol_sales_end = '24:00',
       alcohol_timezone = 'America/Argentina/Buenos_Aires', alcohol_hours_enforced = true where id = '${ID('b1')}'`]],
  ['create_order_with_items · BUSINESS_CLOSED', CUSTOMER, order('cerrado', 'c1'), '55000',
    [`insert into public.business_service_exceptions(business_id, channel, on_date, is_closed)
       select '${ID('b1')}', 'all', (now() at time zone 'America/Argentina/Buenos_Aires')::date + d, true from generate_series(-1, 1) d`]],
  ['cancel_own_order · pedido inexistente', CUSTOMER, `select public.cancel_own_order('${ID('ff')}', 'contrato-check-0001', null)`, 'P0002'],
  ['transition_order · pedido inexistente', OWNER, `select public.transition_order('${ID('ff')}', 1, 'accepted', 'contrato-check-0002')`, 'P0002'],
  ['set_service_enforcement · ENFORCEMENT_LOCKED', OWNER, `select public.set_service_enforcement('${ID('b1')}', false, null, null, null)`, '55000'],
  ['platform_verify_business_ordering · comercio inexistente', SERVICE,
    `select public.platform_verify_business_ordering('${ID('fe')}', 'contrato-plataforma@example.invalid', 'x', 1, 'ensayo')`, 'P0002'],
  ['platform_verify_business_ordering · OPENING_NOT_READY', SERVICE,
    `select public.platform_verify_business_ordering('${ID('b2')}', 'contrato-plataforma@example.invalid', 'contrato-p', 1, 'ensayo')`, '55000'],
  ['UPDATE businesses.currency_code · trigger', SERVICE, `update public.businesses set currency_code = 'USD' where id = '${ID('b1')}'`, '55000'],
];

const errorOf = async (client, claims, sql, method, before = []) => {
  await client.query('savepoint api_case');
  try {
    await client.query("select set_config('request.jwt.claims', $1, true), set_config('request.method', $2, true)", [JSON.stringify(claims), method]);
    for (const statement of before) await client.query(statement);
    await client.query(sql);
    return null;
  } catch (error) {
    return { code: error.code, message: error.message, detail: error.detail ?? null, hint: error.hint ?? null };
  } finally {
    await client.query('rollback to savepoint api_case');
  }
};

export async function checkBoundary(client) {
  const results = [];
  await client.query('begin');
  try {
    await client.query(fixtureSql());
    for (const [label, claims, sql, original, before = []] of CASES) {
      const api = await errorOf(client, claims, sql, 'POST', before);
      const plain = await errorOf(client, claims, sql, '', before);
      const nested = await errorOf(client, claims, `do $nested$ begin execute ${quote(sql)}; end $nested$`, 'POST', before);
      const problems = [];
      if (!plain || plain.code !== original) problems.push(`sin request.method: ${plain?.code} (esperado ${original})`);
      if (!api || api.code !== 'PGRST') problems.push(`con request.method: ${api?.code} (esperado PGRST)`);
      else {
        const body = JSON.parse(api.message);
        const status = JSON.parse(api.detail);
        if (status.status !== BOUNDARY_STATUS[original]) problems.push(`estado ${status.status} (esperado ${BOUNDARY_STATUS[original]})`);
        if (plain && (body.code !== plain.code || body.message !== plain.message || body.details !== (plain.detail || null) || body.hint !== (plain.hint || null))) {
          problems.push(`el cuerpo cambió: ${JSON.stringify(body)} vs ${JSON.stringify(plain)}`);
        }
      }
      if (!nested || nested.code !== original) problems.push(`llamador PL/pgSQL con request.method: ${nested?.code} (esperado ${original})`);
      results.push({ label, ok: problems.length === 0, problems, status: api?.code === 'PGRST' ? JSON.parse(api.detail).status : null, original: plain?.code ?? null });
    }
    const happy = await errorOf(client, CUSTOMER, order('feliz', 'c1'), 'POST');
    results.push({ label: 'create_order_with_items · camino feliz con request.method', ok: happy === null, problems: happy ? [JSON.stringify(happy)] : [] });
  } finally {
    await client.query('rollback');
  }
  return results;
}

const quote = (text) => `'${text.replace(/'/g, "''")}'`;

async function main(argv) {
  const index = argv.indexOf('--database');
  const url = index >= 0 ? argv[index + 1] : null;
  if (!url) throw new Error('usage: --database <local postgres url>');
  assertLocal(url);
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  client.on('notice', () => {});
  try {
    const results = await checkBoundary(client);
    for (const result of results) console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.label}${result.status ? ` · ${result.original} → ${result.status}` : ''}${result.problems.length ? `\n     ${result.problems.join('\n     ')}` : ''}`);
    const passed = results.filter((result) => result.ok).length;
    console.log(`API_BOUNDARY_CHECK: ${passed === results.length ? 'PASS' : 'FAIL'} ${passed}/${results.length}`);
    if (passed !== results.length) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exit(1); });
}
