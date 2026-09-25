import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { estado, leerArgumentos, PLANES, validar } from '../scripts/mercadopago/cobro-negocio.mjs';

const NEGOCIO = 'e7850ad2-a447-402c-8375-3fd74e9466ba';
const args = (texto) => leerArgumentos(texto.split(' ').filter(Boolean));

test('cobro-negocio: each target switches its own environment and application', () => {
  assert.deepEqual(PLANES['controlled-production'], { environment: 'production', application: '7677852968049976' });
  assert.deepEqual(PLANES.staging, { environment: 'test', application: '2691240967769590' });
});

test('cobro-negocio: nothing changes without a known command, target and business', () => {
  assert.equal(validar(args(`borrar --target=staging --business=${NEGOCIO}`)), 'COMANDO_INVALIDO');
  assert.equal(validar(args(`estado --target=produccion --business=${NEGOCIO}`)), 'DESTINO_INVALIDO');
  assert.equal(validar(args('estado --target=staging --business=la-taba')), 'NEGOCIO_INVALIDO');
  assert.equal(validar(args(`estado --target=controlled-production --business=${NEGOCIO}`)), null);
});

test('cobro-negocio: changing anything repeats the business slug', () => {
  assert.equal(validar(args(`apagar --target=controlled-production --business=${NEGOCIO}`)), 'FALTA_CONFIRMAR_EL_SLUG');
  assert.equal(validar(args(`apagar --target=controlled-production --business=${NEGOCIO} --confirmar=la-taba-cp`)), null);
});

test('cobro-negocio: real money needs the production review confirmed by a person', () => {
  assert.equal(validar(args(`encender --target=controlled-production --business=${NEGOCIO} --confirmar=la-taba-cp`)),
    'COBRO_REAL_SIN_REVISION_PRODUCTIVA_CONFIRMADA');
  assert.equal(validar(args(`encender --target=controlled-production --business=${NEGOCIO} --confirmar=la-taba-cp --revision-aprobada`)), null);
  // Test money has no production review.
  assert.equal(validar(args(`encender --target=staging --business=${NEGOCIO} --confirmar=qa`)), null);
});

test('cobro-negocio: status reports states and matches, never accounts or credentials', async () => {
  const filas = {
    businesses: { slug: 'la-taba-cp', status: 'open', ordering_enabled: true },
    business_payment_settings: { enabled: true, environment: 'production', production_review_status: 'approved',
      application_id: '7677852968049976', updated_at: '2026-09-26T10:00:00Z' },
    mp_seller_connections: [{ environment: 'production', status: 'connected', application_id: '7677852968049976',
      expires_at: '2027-03-01T00:00:00Z', updated_at: '2026-09-26T10:00:00Z' }],
    business_config_audit: [{ action: 'enabled', actor_kind: 'service', created_at: '2026-09-26T10:00:00Z' }],
  };
  const consulta = (tabla) => {
    const cadena = { select: () => cadena, eq: () => cadena, order: () => cadena, limit: () => Promise.resolve({ data: filas[tabla], error: null }),
      maybeSingle: () => Promise.resolve({ data: filas[tabla], error: null }),
      then: (resolver) => resolver({ data: filas[tabla], error: null }) };
    return cadena;
  };
  const db = { from: consulta, rpc: async () => ({ data: { available: true }, error: null }) };
  const informe = await estado(db, NEGOCIO, PLANES['controlled-production'], Date.parse('2026-09-26T12:00:00Z'));
  assert.equal(informe.ofrecido_en_checkout, true);
  assert.equal(informe.conexion.aplicacion_esperada, true);
  assert.equal(informe.ajustes.aplicacion_esperada, true);
  assert.equal(informe.conexion.dias_hasta_vencer, 155);
  assert.doesNotMatch(JSON.stringify(informe), /7677852968049976|collector|seller_id|token/);
});

test('cobro-negocio never selects a credential, an account id or payer data', () => {
  const source = fs.readFileSync(new URL('../scripts/mercadopago/cobro-negocio.mjs', import.meta.url), 'utf8');
  const selects = [...source.matchAll(/\.select\('([^']*)'/g)].map((match) => match[1]);
  assert.ok(selects.length >= 4, 'the selects are the ones inspected');
  for (const forbidden of ['protected_tokens', 'seller_id', 'collector_id', 'payer', 'access_token', 'email']) {
    assert.equal(selects.join(',').includes(forbidden), false, forbidden);
  }
});
