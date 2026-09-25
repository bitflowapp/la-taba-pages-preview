#!/usr/bin/env node
/*
 * Reembolso de LIMPIEZA del pago de prueba creado con el APP_USR directo.
 *
 * Ese pago lo creó la aplicación de «Credenciales de prueba», no la aplicación
 * integradora: el token OAuth del vendedor —que es con lo que La Taba lee,
 * rutea y reembolsa— no lo ve (la sonda del worker lo registró como
 * `payment.provider_probe_empty`). Por eso La Taba no puede reembolsarlo con
 * `mercadopago-refund` y se devuelve con la API oficial de Mercado Pago y la
 * misma credencial que lo creó. Dinero ficticio de una cuenta de prueba.
 *
 * Se manda DOS veces con la misma X-Idempotency-Key: Mercado Pago tiene que
 * devolver el mismo reembolso, nunca dos.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { leerSecreto } from '../../e2e-production-sale/secretos-windows.mjs';

const ESTADO = path.join(os.tmpdir(), 'la-taba-mp-directo', 'estado.json');
const VENDEDOR = '3594962708';
const estado = JSON.parse(readFileSync(ESTADO, 'utf8'));
const pagoId = process.argv.find((a) => /^--pago=\d+$/.test(a))?.split('=')[1];
if (!pagoId) throw new Error('uso: reembolso-proveedor.mjs --pago=<id>');
const token = leerSecreto('MP STAGING ACCESS TOKEN')?.secreto?.trim();
if (!/^APP_USR-\d+-\d{6}-[0-9a-f]+-3594962708$/.test(token || '')) throw new Error('TOKEN_DIRECTO_NO_DISPONIBLE');
const mp = async (ruta, init = {}) => {
  const r = await fetch(`https://api.mercadopago.com${ruta}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(20_000) });
  return { status: r.status, cuerpo: await r.json().catch(() => null), requestId: r.headers.get('x-request-id') || '' };
};
const antes = await mp(`/v1/payments/${pagoId}`);
if (antes.status !== 200 || String(antes.cuerpo?.collector_id) !== VENDEDOR || antes.cuerpo?.external_reference !== estado.external_reference) throw new Error('PAGO_AJENO_A_ESTA_CERTIFICACION');
estado.reembolso_proveedor ||= { idempotency_key: randomUUID(), envios: [] };
const clave = estado.reembolso_proveedor.idempotency_key;
for (const vuelta of ['primera', 'repeticion_misma_clave']) {
  const r = await mp(`/v1/payments/${pagoId}/refunds`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': clave }, body: '{}' });
  estado.reembolso_proveedor.envios.push({ vuelta, momento: new Date().toISOString(), http: r.status, request_id: r.requestId, refund_id: r.cuerpo?.id ? String(r.cuerpo.id) : null, status: r.cuerpo?.status ?? null, amount: r.cuerpo?.amount ?? null, error: r.cuerpo?.error ?? null });
  writeFileSync(ESTADO, `${JSON.stringify(estado, null, 2)}\n`);
}
const despues = await mp(`/v1/payments/${pagoId}`);
const reembolsos = await mp(`/v1/payments/${pagoId}/refunds`);
const resumen = {
  pago: pagoId, estado_antes: antes.cuerpo?.status, estado_despues: despues.cuerpo?.status, status_detail: despues.cuerpo?.status_detail,
  envios: estado.reembolso_proveedor.envios,
  reembolsos_en_el_proveedor: Array.isArray(reembolsos.cuerpo) ? reembolsos.cuerpo.map((x) => ({ id: String(x.id), status: x.status, amount: x.amount })) : reembolsos.status,
};
estado.reembolso_proveedor.resultado = resumen;
writeFileSync(ESTADO, `${JSON.stringify(estado, null, 2)}\n`);
console.log(JSON.stringify(resumen, null, 2));
