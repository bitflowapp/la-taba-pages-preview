/*
 * ASISTENTE DE ACTIVACIÓN COMERCIAL DE MERCADO PAGO
 *
 *   node scripts/mercadopago/asistente-activacion.mjs [estado]              checklist P1–P10 con lo que se puede comprobar solo
 *   node scripts/mercadopago/asistente-activacion.mjs red                   dominio, HTTPS, callback, webhook, CORS y worker
 *   node scripts/mercadopago/asistente-activacion.mjs integradora           identidad de la aplicación (Client Secret oculto)
 *   node scripts/mercadopago/asistente-activacion.mjs webhook-firma --confirm <ref>   la clave del webhook coincide
 *   node scripts/mercadopago/asistente-activacion.mjs ensayo                ensayo sin dinero: producción ficticia completa
 *   node scripts/mercadopago/asistente-activacion.mjs reversion --business <uuid> --slug <slug>
 *
 *   --target production (por defecto) | qa      --json   salida para máquinas
 *
 * Arma, en el orden de docs/audit/mp-commercial-onboarding-20261024/PRODUCCION.md, lo que antes eran pasos sueltos:
 * los procedimientos y herramientas que ya existían (bind-production, deploy, verificar-configuracion,
 * sincronizar-worker-hmac, cobro-negocio, rehearse-mp-onboarding) y las comprobaciones en vivo que faltaban.
 *
 * Reglas: nunca imprime ni guarda un secreto (entran por entrada oculta o por stdin, viven en memoria y se descartan);
 * nunca crea pagos, preferencias ni pedidos ni guarda filas en producción: `red` usa sondas que no dejan filas (IPN
 * viejo, preflight, worker sin firma) y `webhook-firma` manda UN aviso firmado de vinculación de un vendedor que no
 * existe, que se contesta sin guardarse (sólo si la clave NO coincide queda una fila rechazada, y lo avisa). Mientras
 * producción no exista, lo que la necesita sale 2 y lo dice.
 *
 * Salida: 0 = todo lo comprobable está bien. 1 = algo falló (dice qué y qué hacer). 2 = no se puede comprobar todavía.
 */
import { spawnSync } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { ROOT, productionTarget, qaTarget, readEnvironments } from '../lib/environments.mjs';

const TIMEOUT_MS = 20_000;

// ------------------------------------------------------------------------------------------- destino y binding

export function resolveTarget(name, registry = readEnvironments()) {
  // El preview de QA está detrás de usuario y contraseña (registro: web.access = basic-auth).
  if (name === 'qa') return { name, provisioned: true, siteAccess: registry.environments.qa.web.access || 'public', ...qaTarget(registry) };
  if (name !== 'production') throw new Error('--target debe ser production o qa');
  try {
    return { name, provisioned: true, ...productionTarget({ registry, allowProvisioned: true }) };
  } catch (error) {
    if (error?.code !== 'PRODUCTION_NOT_PROVISIONED') throw error;
    const production = registry.environments.production;
    return { name, provisioned: false, status: production.status, ref: production.supabase.ref, origin: production.web.origin,
      mercadoPagoApplicationId: production.mercadoPago.applicationId, pendingDecisions: production.pendingDecisions || [] };
  }
}

/** ¿Las funciones del árbol tienen el binding de este ref (lo escribe bind-production.mjs)? Sin leer secretos. */
export function bindingState(ref, root = ROOT) {
  if (!ref) return { bound: false, reason: 'sin ref' };
  const oauth = fs.readFileSync(path.join(root, 'supabase/functions/_shared/seller-oauth.ts'), 'utf8');
  const recovery = fs.readFileSync(path.join(root, 'supabase/functions/_shared/recovery-deployment.ts'), 'utf8');
  const bound = new RegExp(`^ {2}${ref}: \\{`, 'm').test(oauth);
  const forbiddenForRecovery = recovery.includes(`'${ref}'`);
  return { bound, forbiddenForRecovery, reason: bound ? 'binding presente' : 'falta correr bind-production.mjs (P2)' };
}

// ------------------------------------------------------------------------------------------- comprobaciones en vivo

async function probe(fetchImpl, url, init = {}) {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), ...init });
    const text = await response.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* no es JSON */ }
    return { ok: true, status: response.status, headers: response.headers, text, json, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.cause?.code || error?.name || error?.message || error), ms: Date.now() - started };
  }
}

/**
 * Dominio, HTTPS y callbacks, sin escribir en producción. Cada fila: qué se miró, qué se esperaba, qué pasó y, si
 * falló, qué hacer. `fetchImpl` se inyecta en las pruebas.
 */
export async function networkChecks(target, fetchImpl = fetch) {
  const supabase = `https://${target.ref}.supabase.co`;
  const rows = [];
  const row = (id, what, expected, observed, ok, fix) => rows.push({ id, what, expected, observed, ok, ...(ok ? {} : { fix }) });
  // Un sitio protegido con contraseña a propósito (QA) contesta 401: el certificado y el dominio se comprobaron
  // igual (la conexión TLS se completó), pero su contenido no se puede leer. Se informa como no verificable.
  const protectedSite = (response) => target.siteAccess === 'basic-auth' && response.status === 401;
  const unverifiable = (id, what, expected) => rows.push({ id, what, expected, observed: '401: sitio protegido con contraseña (registro: basic-auth)', ok: true, skipped: true });

  const site = await probe(fetchImpl, `${target.origin}/`);
  if (protectedSite(site)) {
    row('sitio_https', `${target.origin}/ por HTTPS con certificado válido`, '200 (o 401 si está protegido)', '401 por HTTPS, TLS válido', true);
  } else {
    row('sitio_https', `${target.origin}/ por HTTPS con certificado válido`, '200', site.ok ? String(site.status) : site.error,
      site.ok && site.status === 200, 'Publicar el sitio (LANZAMIENTO.md §2, P9) y revisar el dominio/certificado en Cloudflare Pages.');
  }
  const runtime = await probe(fetchImpl, `${target.origin}/runtime-config.js`);
  const pointsHere = runtime.ok && runtime.status === 200 && runtime.text.includes(`${target.ref}.supabase.co`);
  if (protectedSite(runtime)) unverifiable('sitio_apunta_al_proyecto', 'runtime-config.js del sitio apunta a este proyecto', `${target.ref}.supabase.co`);
  else {
    row('sitio_apunta_al_proyecto', 'runtime-config.js del sitio apunta a este proyecto', `${target.ref}.supabase.co`,
      runtime.ok ? (pointsHere ? 'sí' : `no (${runtime.status})`) : runtime.error, pointsHere,
      'El sitio publicado es de otra base: volver a desplegar con `Deploy production` (deriva runtime-config del registro).');
  }
  const identity = await probe(fetchImpl, `${target.origin}/release-identity.json`);
  if (protectedSite(identity)) unverifiable('sitio_identidad', 'release-identity.json publicado', '200 con identidad');
  else {
    row('sitio_identidad', 'release-identity.json publicado', '200 con identidad', identity.ok ? `${identity.status} ${identity.json?.cacheName ?? identity.json?.identity ?? ''}`.trim() : identity.error,
      identity.ok && identity.status === 200, 'El sitio no expone su identidad de release: no es un despliegue de este repositorio.');
  }

  // El callback sin parámetros: con la configuración cargada vuelve al Panel (303); sin ella, 503.
  const callback = await probe(fetchImpl, `${supabase}/functions/v1/mercadopago-oauth-callback`);
  const location = callback.ok ? callback.headers.get('location') || '' : '';
  const toPanel = callback.status === 303 && location.startsWith(`${target.origin}/`) && /mp_connection=/.test(location);
  row('callback_oauth', 'Redirect URL de OAuth (la que se registra en la aplicación)', `303 al Panel ${target.origin}/`,
    callback.ok ? `${callback.status} ${location.split('?')[0]}` : callback.error, toPanel,
    callback.status === 503 ? 'Faltan secretos OAuth del proyecto: configurar-oauth-produccion (P7).' : 'Desplegar mercadopago-oauth-callback (deploy.mjs functions, P4) y revisar MERCADOPAGO_OAUTH_PANEL_URL.');

  // Webhook: un GET se rechaza (405) y el IPN viejo se reconoce SIN guardar nada (200 ignored): prueba que la función
  // está publicada y que carga la clave del webhook. Nunca se manda un aviso con firma falsa: dejaría una fila
  // `rejected_signature` y la alerta «avisos que no se pudieron verificar».
  const webhookGet = await probe(fetchImpl, `${supabase}/functions/v1/mercadopago-webhook`);
  row('webhook_metodo', 'Webhook rechaza GET', '405', webhookGet.ok ? String(webhookGet.status) : webhookGet.error,
    webhookGet.status === 405, 'Desplegar mercadopago-webhook (P4).');
  const ipn = await probe(fetchImpl, `${supabase}/functions/v1/mercadopago-webhook?topic=payment&id=1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resource: '1', topic: 'payment' }),
  });
  row('webhook_configurado', 'Webhook publicado y con su clave cargada (IPN viejo reconocido sin guardar nada)', '200 ignored: legacy_ipn',
    ipn.ok ? `${ipn.status} ${ipn.json?.ignored ?? ipn.json?.code ?? ''}`.trim() : ipn.error,
    ipn.status === 200 && ipn.json?.ignored === 'legacy_ipn',
    ipn.status === 503 ? 'Falta MERCADOPAGO_OAUTH_WEBHOOK_SECRET o la configuración OAuth del proyecto (P6–P7).' : 'Desplegar mercadopago-webhook (P4).');

  // CORS: sólo el origen de la tienda.
  const preflight = (origin) => probe(fetchImpl, `${supabase}/functions/v1/mercadopago-create-checkout-session`, {
    method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' },
  });
  const own = await preflight(target.origin);
  row('cors_tienda', 'Preflight desde la tienda', `204 con access-control-allow-origin ${target.origin}`,
    own.ok ? `${own.status} ${own.headers.get('access-control-allow-origin') || '(sin ACAO)'}` : own.error,
    own.status === 204 && own.headers.get('access-control-allow-origin') === target.origin,
    'TABA_ALLOWED_ORIGINS no incluye el origen de la tienda (P7).');
  const foreign = await preflight('https://origen-ajeno.example');
  row('cors_ajeno', 'Preflight desde un origen ajeno', 'sin access-control-allow-origin',
    foreign.ok ? `${foreign.status} ${foreign.headers.get('access-control-allow-origin') || '(sin ACAO)'}` : foreign.error,
    foreign.ok && !foreign.headers.get('access-control-allow-origin'), 'TABA_ALLOWED_ORIGINS acepta orígenes que no son la tienda.');

  // Worker: sólo con la firma HMAC del cron.
  const worker = await probe(fetchImpl, `${supabase}/functions/v1/mercadopago-payment-worker`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
  });
  row('worker_firma', 'Worker de pagos sin firma', '401', worker.ok ? String(worker.status) : worker.error, worker.status === 401,
    'Desplegar mercadopago-payment-worker y cargar PAYMENT_WORKER_SECRET (sincronizar-worker-hmac.mjs).');
  return { ok: rows.every((entry) => entry.ok), rows };
}

/** La aplicación integradora con sus credenciales: dueño real en producción, usuario de prueba en QA. */
export async function integratorCheck(target, clientSecret, fetchImpl = fetch) {
  const grant = await probe(fetchImpl, 'https://api.mercadopago.com/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: target.mercadoPagoApplicationId, client_secret: clientSecret }),
  });
  if (!grant.ok || grant.status !== 200 || typeof grant.json?.access_token !== 'string') {
    return { ok: false, step: 'client_credentials', status: grant.status || grant.error,
      fix: 'El Client Secret no corresponde a la aplicación o fue renovado: copiarlo de nuevo desde Tus integraciones (P5).' };
  }
  const me = await probe(fetchImpl, 'https://api.mercadopago.com/users/me', { headers: { authorization: `Bearer ${grant.json.access_token}` } });
  const tags = Array.isArray(me.json?.tags) ? me.json.tags : [];
  const testUser = tags.includes('test_user');
  const expectedTest = target.name === 'qa';
  const ok = me.status === 200 && me.json?.site_id === 'MLA' && testUser === expectedTest &&
    (grant.json.user_id === undefined || String(grant.json.user_id) === String(me.json?.id));
  return {
    ok, application_id: target.mercadoPagoApplicationId, owner_id: me.json?.id ?? null, site_id: me.json?.site_id ?? null,
    owner_is_test_user: testUser, expected_test_user: expectedTest, live_mode: grant.json.live_mode ?? null,
    ...(ok ? {} : { fix: expectedTest
      ? 'En QA la integradora tiene que ser de un usuario de prueba (si no, todo pago falla con 2034).'
      : 'En producción la integradora tiene que ser de una cuenta real (La Taba), nunca de un usuario de prueba.' }),
  };
}

/**
 * El aviso firmado de prueba: «Vinculación de aplicaciones» (mp-connect) de un vendedor que no existe (999). Con la
 * firma válida el webhook contesta 200 `seller_authorization: not_connected` SIN guardar nada ni llamar al proveedor
 * (seller-deauthorization.ts): una respuesta positiva que sólo se obtiene si la clave coincide. Con otra clave, 401.
 */
export const PROBE_SELLER = '999';

export function signedProbe(target, secret, { now = Date.now(), requestId = randomUUID() } = {}) {
  const ts = String(Math.floor(now / 1000));
  const v1 = createHmac('sha256', secret).update(`id:${PROBE_SELLER};request-id:${requestId};ts:${ts};`).digest('hex');
  return {
    url: `https://${target.ref}.supabase.co/functions/v1/mercadopago-webhook?data.id=${PROBE_SELLER}&type=mp-connect`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId },
      body: JSON.stringify({ action: 'application.authorized', api_version: 'v1', data: { id: PROBE_SELLER },
        date_created: new Date(now).toISOString(), id: Number(String(now).slice(-9)), live_mode: target.name === 'production',
        type: 'mp-connect', user_id: Number(PROBE_SELLER) }),
    },
  };
}

export async function webhookSecretCheck(target, secret, fetchImpl = fetch) {
  // Primero, que la función cargue su configuración: sin ella no se puede decir nada de la clave.
  const ipn = await probe(fetchImpl, `https://${target.ref}.supabase.co/functions/v1/mercadopago-webhook?topic=payment&id=1`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resource: '1', topic: 'payment' }),
  });
  if (!(ipn.status === 200 && ipn.json?.ignored === 'legacy_ipn')) {
    return { ok: false, verdict: 'configuracion', status: ipn.status || ipn.error,
      fix: 'El webhook no carga su configuración: correr `red` y completar P4/P7 antes de probar la clave.' };
  }
  const { url, init } = signedProbe(target, secret);
  const signed = await probe(fetchImpl, url, init);
  if (signed.status === 200 && signed.json?.seller_authorization === 'not_connected') {
    return { ok: true, verdict: 'clave_coincide', status: 200 };
  }
  if (signed.status === 401) {
    return { ok: false, verdict: 'clave_distinta', status: 401,
      fix: 'La clave cargada en el proyecto (MERCADOPAGO_OAUTH_WEBHOOK_SECRET) no es la de Webhooks de la aplicación: recargarla (P7). Esta prueba dejó UNA fila rejected_signature.' };
  }
  if (signed.status === 503) {
    return { ok: false, verdict: 'configuracion', status: 503,
      fix: 'La firma no se pudo evaluar: falta MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved o la configuración OAuth (P7). Completar y repetir.' };
  }
  return { ok: false, verdict: 'inesperado', status: signed.status || signed.error, fix: 'Respuesta inesperada: revisar los registros de mercadopago-webhook.' };
}

// ------------------------------------------------------------------------------------------- checklist

export function checklist(target, binding) {
  const prod = target.name === 'production';
  const pending = (done) => (done ? 'hecho' : 'pendiente');
  return [
    { id: 'P1', title: 'Proyecto de producción creado (plan pago, sa-east-1)', who: 'Marco / Luna Systems (D1, servicio pago)',
      state: target.provisioned ? 'hecho' : 'pendiente', evidence: `deploy/environments.json production.status = ${target.status ?? 'active'}` },
    { id: 'P2', title: 'Binding del proyecto en las funciones (PR + CI verde)', who: 'ingeniería',
      state: prod ? pending(target.provisioned && binding.bound) : 'hecho', command: 'node scripts/production/bind-production.mjs --ref <ref> --organization <org> --plan pro --verify-remote --write',
      evidence: binding.reason },
    { id: 'P3', title: 'Ensayo sin dinero sobre el código del binding', who: 'ingeniería (local)', state: 'ejecutable siempre',
      command: 'node scripts/mercadopago/asistente-activacion.mjs ensayo' },
    { id: 'P4', title: 'Esquema y funciones desplegados', who: 'ingeniería', state: target.provisioned ? 'verificar' : 'pendiente',
      command: 'node scripts/production/deploy.mjs bootstrap --apply --confirm <ref> && node scripts/production/deploy.mjs functions all --apply --confirm <ref> && node scripts/production/deploy.mjs gates' },
    { id: 'P5', title: 'Client Secret de La Taba Delivery renovado (conservando el Client ID)', who: 'dueño de La Taba Delivery',
      state: 'acción del titular', command: 'Developers → Tus integraciones → La Taba Delivery → Credenciales de producción; verificar con `integradora`' },
    { id: 'P6', title: 'Redirect URL y webhook (Pagos + Vinculación de aplicaciones) registrados; clave del webhook revelada', who: 'dueño de La Taba Delivery',
      state: 'acción del titular', evidence: target.ref ? `https://${target.ref}.supabase.co/functions/v1/mercadopago-oauth-callback · …/mercadopago-webhook` : 'URLs del proyecto nuevo',
      command: 'verificar con `red` y `webhook-firma`' },
    { id: 'P7', title: 'Secretos cargados por entrada oculta, SIN la llave final', who: 'Marco', state: target.provisioned ? 'verificar' : 'pendiente',
      command: 'scripts/mercadopago/configurar-oauth-produccion.ps1 · node scripts/mercadopago/sincronizar-worker-hmac.mjs --target=production --apply · node scripts/mercadopago/verificar-configuracion.mjs --ref=produccion --esperado=disabled' },
    { id: 'P8', title: 'Verificación en vivo', who: 'ingeniería', state: target.provisioned ? 'verificar' : 'pendiente',
      command: 'node scripts/mercadopago/asistente-activacion.mjs red && node scripts/mercadopago/asistente-activacion.mjs webhook-firma --confirm <ref>' },
    { id: 'P9', title: 'Sitio publicado contra el proyecto nuevo', who: 'ingeniería', state: target.provisioned ? 'verificar' : 'pendiente',
      command: 'Deploy production (workflow_dispatch) — comprobado por `red` (sitio_apunta_al_proyecto)' },
    { id: 'P10', title: 'Walter vincula SU cuenta y «Verificar» no muestra más que «cobro apagado»', who: 'Walter, en su dispositivo',
      state: 'acción del titular', command: 'docs/audit/mp-commercial-onboarding-20261024/CONECTAR-WALTER.md' },
    { id: 'P11', title: 'Primer cobro y primera devolución reales de control (cierran R-MKT-1 y la API de reembolsos con dinero real)', who: 'Walter (importe y producto, D5) + operador',
      state: 'autorización del titular', command: 'docs/audit/commercial-readiness-20261023/LANZAMIENTO.md §5–§6' },
  ];
}

export function rollbackPlan({ business = '<uuid del comercio>', slug = '<slug>' } = {}) {
  return [
    { level: 1, action: `node scripts/mercadopago/cobro-negocio.mjs apagar --target=production --business=${business} --confirmar=${slug}`,
      effect: 'el comercio deja de ofrecer Mercado Pago; efectivo sigue; historial intacto; se reenciende sin reconectar' },
    { level: 2, action: 'Dashboard de Supabase → Edge Functions → Secrets: borrar MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION',
      effect: 'ninguna preferencia real se crea en toda la plataforma' },
    { level: 3, action: 'borrar MERCADOPAGO_PRODUCTION_REVIEW_STATUS', effect: 'todo el runtime productivo de pagos falla cerrado (503)' },
    { level: 4, action: 'Panel → Mercado Pago → Desconectar (se niega con operaciones pendientes)', effect: 'borra la credencial del vendedor' },
    { level: 5, action: 'node scripts/production/deploy.mjs functions <lista> --apply --confirm <ref> (SHA anterior) y la reversa de docs/migrations/rollback/',
      effect: 'código y esquema anteriores' },
    { level: 6, action: 'Cloudflare Pages → Rollback del despliegue anterior, o Deploy production con el SHA anterior', effect: 'interfaz anterior' },
    { level: 7, action: 'restauración desde respaldo (RESPALDOS-Y-RECUPERACION.md §5)', effect: 'recuperación de datos' },
  ];
}

// ------------------------------------------------------------------------------------------- entrada oculta

async function hiddenInput(prompt, jsonKey) {
  if (!process.stdin.isTTY) {
    // Por tubería: JSON con la clave pedida, para que un proceso la pase sin archivo ni argumento.
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')[jsonKey];
    if (typeof value !== 'string' || value.length < 16) throw new Error(`stdin: falta "${jsonKey}" (JSON)`);
    return value;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (text) => { if (text.includes(prompt)) process.stdout.write(prompt); };
  const value = await new Promise((resolve) => rl.question(prompt, resolve));
  rl.close();
  process.stdout.write('\n');
  if (value.trim().length < 16) throw new Error('valor demasiado corto');
  return value.trim();
}

// ------------------------------------------------------------------------------------------- CLI

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function print(result, asJson) {
  if (asJson) { console.log(JSON.stringify(result, null, 2)); return; }
  if (Array.isArray(result.rows)) {
    for (const entry of result.rows) {
      const mark = entry.skipped ? 'NO VERIFICABLE' : entry.ok ? 'OK  ' : 'FALLA';
      console.log(`${mark} ${entry.what}\n      esperado: ${entry.expected} · visto: ${entry.observed}${entry.fix ? `\n      qué hacer: ${entry.fix}` : ''}`);
    }
    return;
  }
  if (Array.isArray(result.steps)) {
    for (const step of result.steps) {
      console.log(`${step.id.padEnd(4)} [${step.state}] ${step.title}\n      quién: ${step.who}${step.command ? `\n      cómo: ${step.command}` : ''}${step.evidence ? `\n      dato: ${step.evidence}` : ''}`);
    }
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'estado';
  const asJson = process.argv.includes('--json');
  const target = resolveTarget(option('--target', 'production'));
  const needsProject = () => {
    if (target.provisioned) return;
    console.error(`PRODUCCIÓN NO EXISTE TODAVÍA (deploy/environments.json: ${target.status}). Pendiente: ${(target.pendingDecisions || []).join(' | ')}`);
    console.error('Lo que se puede hacer hoy: `estado` y `ensayo` (sin red ni dinero).');
    process.exit(2);
  };
  if (command === 'estado') {
    const binding = bindingState(target.ref);
    const steps = checklist(target, binding);
    print({ target: { name: target.name, ref: target.ref, origin: target.origin, provisioned: target.provisioned }, steps }, asJson);
    if (!asJson) console.log(target.provisioned ? '\nSiguiente: `red`, `integradora`, `webhook-firma --confirm <ref>`.' : '\nSiguiente: P1 (crear el proyecto). Mientras tanto: `ensayo`.');
    process.exitCode = target.provisioned ? 0 : 2;
    return;
  }
  if (command === 'red') {
    needsProject();
    const result = await networkChecks(target);
    print(result, asJson);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command === 'integradora') {
    needsProject();
    const secret = await hiddenInput('Client Secret de la aplicación (no se muestra): ', 'clientSecret');
    const result = await integratorCheck(target, secret);
    print(result, asJson);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command === 'webhook-firma') {
    needsProject();
    if (option('--confirm') !== target.ref) {
      console.error(`Escribí --confirm ${target.ref}: se manda UN aviso firmado de un pago inexistente a ese proyecto.`);
      process.exit(2);
    }
    const secret = await hiddenInput('Clave secreta del webhook (no se muestra): ', 'webhookSecret');
    const result = await webhookSecretCheck(target, secret);
    print(result, asJson);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  if (command === 'ensayo') {
    // Producción completa sobre un ref FICTICIO: las funciones con el binding que escribirá bind-production.mjs,
    // la base con todas las migraciones, Mercado Pago emulado. Ni red ni dinero.
    const report = path.join(ROOT, 'artifacts', 'ci', 'ensayo-activacion.json');
    const bench = spawnSync(process.execPath, [path.join(ROOT, 'scripts/payments-e2e/run.mjs'), '--environment', 'production', '--report', report], { stdio: 'inherit', cwd: ROOT });
    const onboarding = spawnSync(process.execPath, [path.join(ROOT, 'scripts/production/rehearse-mp-onboarding.mjs')], { stdio: 'inherit', cwd: ROOT });
    // Salir con 0 no alcanza: el informe tiene que existir, estar en verde y haber corrido escenarios.
    let benchReportOk = false;
    try {
      const parsed = JSON.parse(fs.readFileSync(report, 'utf8'));
      benchReportOk = parsed.ok === true && parsed.runs?.length > 0 && parsed.runs.every((run) => run.scenarios?.length > 0);
    } catch { benchReportOk = false; }
    const ok = bench.status === 0 && benchReportOk && onboarding.status === 0;
    console.log(ok ? `\nENSAYO DE ACTIVACIÓN OK (informe: ${path.relative(ROOT, report)})` : '\nENSAYO DE ACTIVACIÓN FALLÓ');
    process.exitCode = ok ? 0 : 1;
    return;
  }
  if (command === 'reversion') {
    const plan = rollbackPlan({ business: option('--business') || undefined, slug: option('--slug') || undefined });
    if (asJson) console.log(JSON.stringify(plan, null, 2));
    else for (const step of plan) console.log(`Nivel ${step.level}: ${step.action}\n         efecto: ${step.effect}`);
    if (!asJson) console.log('\nDe lo más fino a lo más grueso. Apagado inmediato (nivel 1, y 2 si no alcanza) ante: pago al vendedor equivocado, pago sin pedido que no se puede rearmar, cobro o reembolso duplicado, firma inválida aceptada, credencial expuesta.');
    return;
  }
  console.error('uso: asistente-activacion.mjs [estado|red|integradora|webhook-firma|ensayo|reversion] [--target production|qa] [--json]');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ASISTENTE DETENIDO: ${String(error?.message || error).slice(0, 400)}`);
    process.exitCode = 1;
  });
}
