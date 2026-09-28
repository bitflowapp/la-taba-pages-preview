// Certificación EN VIVO de la preparación de la apertura (CONTROLLED_PRODUCTION).
//
//   node scripts/controlled-production/opening-cert.mjs --out docs/evidence/controlled-production/opening-cert-cp-AAAAMMDD.json
//
// Escribe SÓLO en el tenant QA de control (qa-control-cp) y deja todo como
// estaba: entrega, horarios de los dos canales, dirección, estado, precios,
// stock, publicación y política de alcohol se leen antes y se restauran al
// final (también si algo falla). Del comercio real sólo LEE, salvo crear un
// link firmado de su instalador con la sesión de su dueño técnico.
//
// Lo que certifica, con los roles reales (anon, equipo, dueño, servicio):
//   1. la preparación: quién la lee y que no expone datos personales;
//   2. la verificación de plataforma: fallas cerradas sobre el comercio real;
//   3. retiro/delivery, horario en dos canales, dirección, abrir/pausar/cerrar;
//   4. la invitación de punta a punta con una cuenta QA nueva (y su limpieza);
//   5. catálogo después de la primera publicación: precio, lote, stock 0/NULL,
//      volver a borrador y republicar, y la planilla (ensayo y aplicación);
//   6. la política de alcohol con la sesión del comercio;
//   7. los instaladores privados: cada dueño ve sólo los de su comercio.
// No imprime correos, contraseñas ni tokens.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { loadTargetKeys } from './target-keys.mjs';
import { QA_CONTROL_BUSINESS, REAL_BUSINESS } from './qa-window.mjs';
import { leerSecreto } from '../e2e-production-sale/secretos-windows.mjs';
import { policyPatch } from './alcohol-policy.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OPTIONS = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const ORIGIN = 'https://la-taba-commercial-pilot.pages.dev';
const RIDER_APK_SHA256 = '2fcc64f9c8cac31fcc65449b25d604e9dc04dae87e5947a4f5554b9875b187d4';
// SHA256SUMS.txt del artifact taba-local-agent-0.1.0-unsigned-2f85ba0 (local-agent-dotnet.yml).
const AGENT_MSI_SHA256 = 'f6ae27ac5d5a34882ad459543684e5a9830aa9fed022d25d3915ac449de5bf3f';

const args = process.argv.slice(2);
const out = (() => { const i = args.indexOf('--out'); return i < 0 ? '' : args[i + 1]; })();

const keys = await loadTargetKeys('controlled-production');
assert.equal(keys.ref, 'tkanbadcglszlcyfjvpv', 'WRONG_TARGET');
const admin = createClient(keys.url, keys.secret, OPTIONS);
const anon = createClient(keys.url, keys.publishable, OPTIONS);

/** Una sesión de persona, registrada como la registra el Panel, con su propio rótulo. */
async function sessionClient(credentialName, businessId) {
  const stored = leerSecreto(credentialName);
  assert.ok(stored?.usuario && stored?.secreto, `CREDENTIAL_REQUIRED:${credentialName}`);
  const client = createClient(keys.url, keys.publishable, OPTIONS);
  const signed = await client.auth.signInWithPassword({ email: stored.usuario, password: stored.secreto });
  if (signed.error || !signed.data?.session) throw Error(`SIGN_IN_REFUSED:${credentialName}`);
  const registered = await client.rpc('identity_register_session', { p_business_id: businessId, p_client: 'panel_web',
    p_device_label: 'Certificación de apertura', p_device_key_hash: null, p_app_version: 'opening-cert' });
  if (registered.error || registered.data?.ok !== true) throw Error(`SESSION_REFUSED:${credentialName}`);
  return client;
}
async function closeSession(client, businessId) {
  try { await client.rpc('identity_close_own_session', { p_business_id: businessId }); } catch { /* ya cerrada */ }
  try { await client.auth.signOut({ scope: 'local' }); } catch { /* sin sesión */ }
}
async function findUserIdByEmail(email) {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => (u.email || '').toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

const owner = await sessionClient('CP QA OWNER', QA_CONTROL_BUSINESS);
const staff = await sessionClient('CP QA STAFF', QA_CONTROL_BUSINESS);

const checks = [];
const check = (id, ok, detail = '') => {
  checks.push({ id, ok: Boolean(ok), detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ` · ${detail}` : ''}`);
};
const code = (response) => response?.error?.code || response?.error?.message || 'OK';
const one = async (query) => { const { data, error } = await query; if (error) throw Error(`READ:${error.code || error.message}`); return data; };
const restores = [];
const started = new Date().toISOString();

async function invite(body) {
  const response = await fetch(`${keys.url}/functions/v1/team-invitation`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: keys.publishable, origin: ORIGIN },
    body: JSON.stringify(body),
  });
  return response.json();
}

const realBefore = await one(admin.from('businesses').select('*').eq('id', REAL_BUSINESS).single());

try {
  // ── 1 · Preparación ────────────────────────────────────────────────────────
  const anonReadiness = await anon.rpc('get_store_opening_readiness', { p_business_id: REAL_BUSINESS, p_min_products: 1 });
  check('READINESS_ANON_DENIED', Boolean(anonReadiness.error), code(anonReadiness));
  const staffReadiness = await staff.rpc('get_store_opening_readiness', { p_business_id: QA_CONTROL_BUSINESS, p_min_products: 1 });
  check('READINESS_STAFF_READS', !staffReadiness.error && staffReadiness.data?.items?.length >= 18, `${staffReadiness.data?.items?.length} compuertas`);
  const foreign = await staff.rpc('get_store_opening_readiness', { p_business_id: REAL_BUSINESS, p_min_products: 1 });
  check('READINESS_OTHER_BUSINESS_DENIED', Boolean(foreign.error), code(foreign));
  const real = await admin.rpc('get_store_opening_readiness', { p_business_id: REAL_BUSINESS, p_min_products: 1 });
  const realPending = real.data?.pending || [];
  check('READINESS_REAL_BLOCKED', real.data?.can_open === false && realPending.includes('SERVICE_HOURS') && realPending.includes('PLATFORM_VERIFICATION'),
    realPending.join(','));
  check('READINESS_NO_PERSONAL_DATA', !JSON.stringify(real.data).includes('@') && !/user_id/.test(JSON.stringify(real.data)));

  // ── 2 · Verificación de plataforma: falla cerrada ─────────────────────────
  const qaOwnerEmail = leerSecreto('CP QA OWNER').usuario;
  const mismatch = await admin.rpc('platform_verify_business_ordering', {
    p_business_id: REAL_BUSINESS, p_verifier_email: qaOwnerEmail, p_confirm_slug: 'otro', p_min_products: 1, p_note: null });
  check('VERIFY_CONFIRMATION_MISMATCH', mismatch.error?.message === 'CONFIRMATION_MISMATCH', code(mismatch));
  const nobody = await admin.rpc('platform_verify_business_ordering', {
    p_business_id: REAL_BUSINESS, p_verifier_email: 'nadie@qa.lataba.invalid', p_confirm_slug: realBefore.slug, p_min_products: 1, p_note: null });
  check('VERIFY_UNKNOWN_VERIFIER', nobody.error?.message === 'VERIFIER_NOT_FOUND', code(nobody));
  // Este intento sólo se hace si la preparación dice que el comercio real NO
  // está listo: con todo listo, verificaría de verdad, y eso no se prueba acá.
  const blockingBesidesPlatform = realPending.filter((c) => c !== 'PLATFORM_VERIFICATION');
  assert.ok(blockingBesidesPlatform.includes('CATALOG_PUBLISHED') && real.data?.ready_for_platform_verification === false,
    'REAL_BUSINESS_LOOKS_READY: no se intenta la verificación prematura');
  const premature = await admin.rpc('platform_verify_business_ordering', {
    p_business_id: REAL_BUSINESS, p_verifier_email: qaOwnerEmail, p_confirm_slug: realBefore.slug, p_min_products: 1, p_note: 'certificación: debe fallar' });
  check('VERIFY_PREMATURE_REFUSED', premature.error?.message === 'OPENING_NOT_READY'
    && premature.error?.details === blockingBesidesPlatform.join(','), premature.error?.details);
  const personVerify = await owner.rpc('platform_verify_business_ordering', {
    p_business_id: QA_CONTROL_BUSINESS, p_verifier_email: qaOwnerEmail, p_confirm_slug: 'qa-control-cp', p_min_products: 1, p_note: null });
  check('VERIFY_PERSON_CANNOT_CALL', Boolean(personVerify.error), code(personVerify));
  const realAfterVerify = await one(admin.from('businesses').select('ordering_verified,ordering_enabled').eq('id', REAL_BUSINESS).single());
  check('VERIFY_REFUSALS_WROTE_NOTHING', !realAfterVerify.ordering_verified && !realAfterVerify.ordering_enabled);

  // ── 3 · QA: entrega, horario, dirección, estado ────────────────────────────
  const qaBefore = await one(admin.from('businesses').select('*').eq('id', QA_CONTROL_BUSINESS).single());
  const hoursBefore = await one(admin.from('business_service_hours').select('channel,weekday,opens_at,closes_at').eq('business_id', QA_CONTROL_BUSINESS));
  restores.push(async () => {
    await owner.rpc('set_business_fulfillment', { p_business_id: QA_CONTROL_BUSINESS,
      p_delivery_enabled: qaBefore.delivery_enabled, p_pickup_enabled: qaBefore.pickup_enabled });
    for (const channel of ['delivery', 'pickup']) {
      // Con segundos: el QA guarda «00:00:00 – 23:59:59» y se devuelve igual.
      const rows = hoursBefore.filter((h) => h.channel === channel)
        .map((h) => ({ weekday: h.weekday, opens_at: h.opens_at, closes_at: h.closes_at }));
      await owner.rpc('set_business_service_hours', { p_business_id: QA_CONTROL_BUSINESS, p_channel: channel, p_hours: rows });
    }
    await admin.from('businesses').update({ address: qaBefore.address, status: qaBefore.status }).eq('id', QA_CONTROL_BUSINESS);
  });

  const staffFulfillment = await staff.rpc('set_business_fulfillment', { p_business_id: QA_CONTROL_BUSINESS, p_delivery_enabled: false, p_pickup_enabled: true });
  check('FULFILLMENT_STAFF_DENIED', staffFulfillment.error?.code === '42501', code(staffFulfillment));
  const pickupOnly = await owner.rpc('set_business_fulfillment', { p_business_id: QA_CONTROL_BUSINESS, p_delivery_enabled: false, p_pickup_enabled: true });
  const pickupReadiness = await owner.rpc('get_store_opening_readiness', { p_business_id: QA_CONTROL_BUSINESS, p_min_products: 1 });
  const item = (payload, c) => payload?.items?.find((row) => row.code === c);
  check('FULFILLMENT_PICKUP_ONLY', !pickupOnly.error && item(pickupReadiness.data, 'DELIVERY_PRICING')?.status === 'na',
    `delivery=${pickupOnly.data?.delivery_enabled} pickup=${pickupOnly.data?.pickup_enabled}`);
  const bothOff = await owner.rpc('set_business_fulfillment', { p_business_id: QA_CONTROL_BUSINESS, p_delivery_enabled: false, p_pickup_enabled: false });
  check('FULFILLMENT_VERIFIED_NEEDS_ONE', bothOff.error?.code === '22023', code(bothOff));

  const grid = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opens_at: '00:00', closes_at: '24:00' }));
  const hoursSaved = await owner.rpc('set_business_opening_hours', { p_business_id: QA_CONTROL_BUSINESS, p_hours: grid });
  const hoursNow = await one(admin.from('business_service_hours').select('channel').eq('business_id', QA_CONTROL_BUSINESS));
  check('HOURS_BOTH_CHANNELS', !hoursSaved.error && hoursSaved.data?.same_for_pickup === true
    && hoursNow.filter((h) => h.channel === 'delivery').length === 7 && hoursNow.filter((h) => h.channel === 'pickup').length === 7);
  const badGrid = await owner.rpc('set_business_opening_hours', { p_business_id: QA_CONTROL_BUSINESS,
    p_hours: [{ weekday: 1, opens_at: '10:00', closes_at: '14:00' }, { weekday: 1, opens_at: '13:00', closes_at: '18:00' }] });
  check('HOURS_OVERLAP_REFUSED', badGrid.error?.code === '22023', code(badGrid));

  const placeholder = await owner.rpc('set_business_address', { p_business_id: QA_CONTROL_BUSINESS, p_address: 'Dirección a confirmar' });
  check('ADDRESS_PLACEHOLDER_REFUSED', placeholder.error?.code === '22023', code(placeholder));
  const address = await owner.rpc('set_business_address', { p_business_id: QA_CONTROL_BUSINESS, p_address: 'QA  Calle 123,   Neuquén' });
  check('ADDRESS_SAVED_NORMALIZED', address.data?.address === 'QA Calle 123, Neuquén', address.data?.address);

  // El corte sale del reloj de la base, no del de esta máquina.
  const lastAudit = await one(admin.from('business_config_audit').select('created_at').eq('business_id', QA_CONTROL_BUSINESS)
    .eq('scope', 'open_state').order('created_at', { ascending: false }).limit(1));
  const t0 = lastAudit[0]?.created_at || '1970-01-01T00:00:00Z';
  const paused = await owner.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'paused' });
  const staffClose = await staff.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'closed' });
  const closed = await owner.rpc('set_business_open_state', { p_business_id: QA_CONTROL_BUSINESS, p_status: 'closed' });
  const openAudit = await one(admin.from('business_config_audit').select('scope,after').eq('business_id', QA_CONTROL_BUSINESS)
    .eq('scope', 'open_state').gt('created_at', t0).order('created_at'));
  const transitions = (qaBefore.status !== 'paused' ? 1 : 0) + 1;
  check('OPEN_STATE_AUDITED', !paused.error && !closed.error && openAudit.length === transitions
    && openAudit.at(-1)?.after?.status === 'closed', `${openAudit.length} cambios auditados`);
  check('CLOSE_NEEDS_OWNER_OR_ADMIN', staffClose.error?.code === '42501', code(staffClose));

  // ── 4 · Invitación de punta a punta (cuenta QA nueva) ─────────────────────
  const email = `opening-cert-${Date.now()}@qa.lataba.invalid`;
  const created = await owner.rpc('identity_create_invitation', { p_business_id: QA_CONTROL_BUSINESS, p_email: email,
    p_role: 'rider', p_full_name: 'Rider Certificación', p_valid_for: '1 hour' });
  const token = created.data?.token;
  check('INVITE_CREATED', created.data?.ok === true && /^[0-9a-f]{64}$/.test(token || ''), created.data?.code || '');
  let inviteeId = null;
  let acceptedOk = false;
  try {
    const inspected = await invite({ action: 'inspect', token });
    check('INVITE_INSPECT_NEW', inspected.ok === true && inspected.account === 'new' && !JSON.stringify(inspected).includes(email), inspected.email_hint || '');
    const wrong = await invite({ action: 'activate', token, email: 'otra@qa.lataba.invalid' });
    check('INVITE_WRONG_EMAIL', wrong.code === 'email_mismatch', wrong.code);
    const activated = await invite({ action: 'activate', token, email });
    check('INVITE_ACTIVATED', activated.ok === true && activated.type === 'recovery');
    const invitee = createClient(keys.url, keys.publishable, OPTIONS);
    const verified = await invitee.auth.verifyOtp({ token_hash: activated.token_hash, type: 'recovery' });
    inviteeId = verified.data?.user?.id || null;
    const password = randomBytes(18).toString('base64url');
    const updated = await invitee.auth.updateUser({ password });
    const accepted = await invitee.rpc('identity_accept_invitation', { p_token: token });
    acceptedOk = accepted.data?.ok === true;
    check('INVITE_ACCEPTED_WITH_OWN_SESSION', !verified.error && !updated.error && acceptedOk && accepted.data?.role === 'rider',
      accepted.data?.code || accepted.data?.role || '');
    await invitee.auth.signOut({ scope: 'local' });
    const again = await invite({ action: 'inspect', token });
    check('INVITE_SINGLE_USE', again.code === 'already_accepted', again.code);
    const rider = createClient(keys.url, keys.publishable, OPTIONS);
    const signed = await rider.auth.signInWithPassword({ email, password });
    const session = await rider.rpc('identity_register_session', { p_business_id: QA_CONTROL_BUSINESS, p_client: 'rider_android',
      p_device_label: 'certificación apertura', p_device_key_hash: null, p_app_version: 'opening-cert' });
    check('INVITED_RIDER_SIGNS_IN', !signed.error && session.data?.ok === true, session.data?.code || '');
    await closeSession(rider, QA_CONTROL_BUSINESS);
    const members = await owner.rpc('identity_list_members', { p_business_id: QA_CONTROL_BUSINESS });
    check('INVITED_RIDER_IS_MEMBER', (members.data || []).some((m) => m.user_id === inviteeId && m.role === 'rider' && m.is_active));
    const audit = await one(admin.from('identity_audit_events').select('event_type').eq('subject_user_id', inviteeId));
    check('INVITE_AUDITED', audit.some((a) => a.event_type === 'invitation_account_activated'), audit.map((a) => a.event_type).join(','));
  } finally {
    if (created.data?.invitation_id && !acceptedOk) {
      await owner.rpc('identity_revoke_invitation', { p_invitation_id: created.data.invitation_id });
    }
    inviteeId = inviteeId || await findUserIdByEmail(email);
    if (inviteeId) {
      if (acceptedOk) {
        await owner.rpc('identity_set_member_active', { p_business_id: QA_CONTROL_BUSINESS, p_user_id: inviteeId, p_is_active: false,
          p_reason: 'fin de certificación' });
      }
      const removed = await admin.auth.admin.deleteUser(inviteeId);
      check('INVITE_CLEANUP', !removed.error && !(await findUserIdByEmail(email)), removed.error?.message || 'cuenta QA borrada');
    }
  }

  // Revocar, y los límites de quién invita a dónde.
  const revokedEmail = `opening-cert-revoke-${Date.now()}@qa.lataba.invalid`;
  const toRevoke = await owner.rpc('identity_create_invitation', { p_business_id: QA_CONTROL_BUSINESS, p_email: revokedEmail,
    p_role: 'staff', p_full_name: 'Empleado Revocado', p_valid_for: '1 hour' });
  const revoked = await owner.rpc('identity_revoke_invitation', { p_invitation_id: toRevoke.data?.invitation_id });
  const afterRevoke = await invite({ action: 'inspect', token: toRevoke.data?.token });
  check('INVITE_REVOKED_IS_DEAD', revoked.data?.ok === true && afterRevoke.ok !== true && ['invalid_token'].includes(afterRevoke.code),
    afterRevoke.code);
  const foreignInvite = await owner.rpc('identity_create_invitation', { p_business_id: REAL_BUSINESS,
    p_email: `opening-cert-foreign-${Date.now()}@qa.lataba.invalid`, p_role: 'rider', p_full_name: 'Ajeno', p_valid_for: '1 hour' });
  check('INVITE_OTHER_BUSINESS_DENIED', Boolean(foreignInvite.error) || foreignInvite.data?.ok !== true,
    foreignInvite.error?.code || foreignInvite.data?.code);
  const staffInvite = await staff.rpc('identity_create_invitation', { p_business_id: QA_CONTROL_BUSINESS,
    p_email: `opening-cert-staff-${Date.now()}@qa.lataba.invalid`, p_role: 'rider', p_full_name: 'Por Empleado', p_valid_for: '1 hour' });
  check('INVITE_STAFF_CANNOT_INVITE', Boolean(staffInvite.error) || staffInvite.data?.ok !== true,
    staffInvite.error?.code || staffInvite.data?.code);
  for (const stray of [foreignInvite, staffInvite]) {
    if (stray.data?.invitation_id) await admin.from('identity_invitations').update({ revoked_at: new Date().toISOString() }).eq('id', stray.data.invitation_id);
  }

  // ── 5 · Catálogo después de la primera publicación ────────────────────────
  const productsBefore = await one(admin.from('products').select('sku,external_id,price,price_status,stock,available,merchant_available,is_verified')
    .eq('business_id', QA_CONTROL_BUSINESS).order('sku'));
  const published = productsBefore.filter((p) => p.available && p.is_verified && p.stock > 1);
  assert.ok(published.length >= 2, 'QA_NEEDS_TWO_PUBLISHED_PRODUCTS');
  const [a, b] = published;
  const fingerprint = (rows) => createHash('sha256').update(JSON.stringify(rows.map((p) => [p.sku, String(p.price), p.price_status, p.stock, p.available, p.merchant_available, p.is_verified]))).digest('hex');
  restores.push(async () => {
    await owner.rpc('apply_commercial_catalog_batch', { p_business_id: QA_CONTROL_BUSINESS, p_rows: [a, b].map((p) => ({ sku: p.sku, price: String(p.price), stock: String(p.stock) })) });
    for (const p of [a, b]) {
      const now = await one(admin.from('products').select('available,is_verified').eq('business_id', QA_CONTROL_BUSINESS).eq('sku', p.sku).single());
      if (!now.is_verified) await owner.rpc('apply_commercial_catalog_batch', { p_business_id: QA_CONTROL_BUSINESS, p_rows: [{ sku: p.sku, publish: true }] });
      else if (!now.available) await owner.rpc('set_commercial_product_publication', { p_business_id: QA_CONTROL_BUSINESS, p_sku: p.sku, p_publish: true });
    }
  });
  const read = async (sku) => one(admin.from('products').select('price,stock,available,is_verified').eq('business_id', QA_CONTROL_BUSINESS).eq('sku', sku).single());

  const single = await owner.rpc('apply_commercial_catalog_batch', { p_business_id: QA_CONTROL_BUSINESS, p_rows: [{ sku: a.sku, price: String(Number(a.price) + 1) }] });
  const afterSingle = await read(a.sku);
  check('PRICE_SINGLE_EDIT_STAYS_PUBLISHED', !single.error && Number(afterSingle.price) === Number(a.price) + 1 && afterSingle.available && afterSingle.is_verified);
  const bulk = await owner.rpc('apply_commercial_catalog_batch', { p_business_id: QA_CONTROL_BUSINESS,
    p_rows: [{ sku: a.sku, price: String(a.price) }, { sku: b.sku, stock: String(b.stock + 1) }] });
  check('PRICE_BULK_EDIT', !bulk.error && (bulk.data || []).length === 2 && Number((await read(a.sku)).price) === Number(a.price));
  const staffPrice = await staff.rpc('apply_commercial_catalog_batch', { p_business_id: QA_CONTROL_BUSINESS, p_rows: [{ sku: a.sku, price: '1' }] });
  check('PRICE_STAFF_DENIED', Boolean(staffPrice.error), code(staffPrice));
  await owner.rpc('apply_commercial_catalog_batch', { p_business_id: QA_CONTROL_BUSINESS, p_rows: [{ sku: b.sku, stock: '0' }] });
  const soldOut = await read(b.sku);
  await owner.rpc('apply_commercial_catalog_batch', { p_business_id: QA_CONTROL_BUSINESS, p_rows: [{ sku: b.sku, stock: String(b.stock) }] });
  const restocked = await read(b.sku);
  const republished = await owner.rpc('set_commercial_product_publication', { p_business_id: QA_CONTROL_BUSINESS, p_sku: b.sku, p_publish: true });
  check('STOCK_ZERO_UNPUBLISHES_AND_REPUBLISH', soldOut.stock === 0 && !soldOut.available && !restocked.available && !republished.error && (await read(b.sku)).available);
  const hidden = await owner.rpc('set_commercial_product_publication', { p_business_id: QA_CONTROL_BUSINESS, p_sku: b.sku, p_publish: false });
  const reshown = await owner.rpc('set_commercial_product_publication', { p_business_id: QA_CONTROL_BUSINESS, p_sku: b.sku, p_publish: true });
  check('HIDE_AND_REPUBLISH', !hidden.error && !reshown.error && (await read(b.sku)).available);
  const reopened = await owner.rpc('unpublish_catalog_product', { p_business_id: QA_CONTROL_BUSINESS, p_external_id: a.external_id });
  const draft = await read(a.sku);
  const verifyPublish = await owner.rpc('apply_commercial_catalog_batch', { p_business_id: QA_CONTROL_BUSINESS, p_rows: [{ sku: a.sku, publish: true }] });
  check('REOPEN_THEN_VERIFY_AND_PUBLISH', reopened.data === true && !draft.is_verified && !draft.available && !verifyPublish.error && (await read(a.sku)).available);

  // La planilla. El importador NO acepta los productos del tenant QA (se llaman
  // «QA …» y la planilla rechaza productos de prueba a propósito), así que acá
  // se certifica en vivo esa negativa y el ensayo de la planilla real de 46
  // filas contra el catálogo real, que sólo lee. La aplicación usa la misma RPC
  // que se acaba de certificar arriba con la sesión del dueño QA; el simulacro
  // completo contra una base descartable es `npm run catalog:commercial:drill`
  // (necesita Docker: no corre en CI ni en esta máquina).
  const sheetDir = mkdtempSync(path.join(tmpdir(), 'opening-cert-'));
  try {
    const importer = (file, extra = []) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/import-commercial-catalog.mjs'), file,
      '--catalogo', 'cp', ...extra], { cwd: ROOT, encoding: 'utf8', timeout: 240_000 });
    const qaSheet = path.join(sheetDir, 'planilla-qa.csv');
    writeFileSync(qaSheet, `sku,precio,stock,publicar\n${b.sku},${b.price},${b.stock},si\n`);
    const refused = importer(qaSheet, ['--business', QA_CONTROL_BUSINESS, '--json']);
    const refusedPlan = JSON.parse(refused.stdout || '{}');
    check('SHEET_REFUSES_QA_PRODUCTS', refused.status === 1 && refusedPlan.errors?.length === 1
      && /producto de prueba/.test(refusedPlan.errors[0]) && (await read(b.sku)).stock === b.stock, refusedPlan.errors?.[0] || '');
    const realSheet = path.join(ROOT, 'catalog/opening/planilla-apertura-cp.csv');
    const dry = importer(realSheet, ['--json']);
    const dryPlan = JSON.parse(dry.stdout || '{}');
    check('SHEET_REAL_TEMPLATE_DRY_RUN', dry.status === 0 && dryPlan.errors?.length === 0 && dryPlan.summary?.sheetRows === 46
      && dryPlan.summary?.changed === 0, `${dryPlan.summary?.sheetRows} filas · ${dryPlan.summary?.changed} cambios · sin escribir`);
  } finally {
    rmSync(sheetDir, { recursive: true, force: true });
  }

  // ── 6 · Política de alcohol con la sesión del comercio ────────────────────
  const alcoholBefore = await one(admin.from('businesses')
    .select('alcohol_sales_enabled,alcohol_minimum_age,alcohol_sales_start,alcohol_sales_end,alcohol_timezone').eq('id', QA_CONTROL_BUSINESS).single());
  restores.push(async () => { await admin.from('businesses').update(alcoholBefore).eq('id', QA_CONTROL_BUSINESS); });
  // La sesión del comercio escribe la política pero no lee el interruptor: se lee con la clave de servicio.
  const alcoholOn = async () => (await one(admin.from('businesses').select('alcohol_sales_enabled').eq('id', QA_CONTROL_BUSINESS).single()))
    .alcohol_sales_enabled;
  const enable = await owner.from('businesses').update(policyPatch({ command: 'apply', minAge: 18, start: '10:00', end: '23:00',
    timezone: 'America/Argentina/Buenos_Aires' })).eq('id', QA_CONTROL_BUSINESS).select('id').single();
  const enabledNow = await alcoholOn();
  const alcoholReadiness = await owner.rpc('get_store_opening_readiness', { p_business_id: QA_CONTROL_BUSINESS, p_min_products: 1 });
  const disable = await owner.from('businesses').update(policyPatch({ command: 'disable' })).eq('id', QA_CONTROL_BUSINESS).select('id').single();
  check('ALCOHOL_POLICY_OWNER_SESSION', !enable.error && enabledNow === true && item(alcoholReadiness.data, 'ALCOHOL_POLICY')?.status === 'pass'
    && !disable.error && (await alcoholOn()) === false, code(enable));
  const incomplete = await owner.from('businesses').update({ alcohol_sales_enabled: true, alcohol_minimum_age: null }).eq('id', QA_CONTROL_BUSINESS).select('id');
  check('ALCOHOL_INCOMPLETE_REFUSED', incomplete.error?.code === '23514' && (await alcoholOn()) === false, code(incomplete));

  // ── 7 · Instaladores privados ─────────────────────────────────────────────
  const realApk = `${REAL_BUSINESS}/rider/com.lataba.rider.pilot-0.1.3-canonical-pilot-v4-cp.apk`;
  const qaTry = await owner.storage.from('team-apps').createSignedUrl(realApk, 60);
  check('TEAM_APPS_OTHER_BUSINESS_DENIED', Boolean(qaTry.error) || !qaTry.data?.signedUrl, qaTry.error?.message || '');
  const realOwner = await sessionClient('CP OWNER MARCO PANEL', REAL_BUSINESS);
  try {
    const link = await realOwner.storage.from('team-apps').createSignedUrl(realApk, 120);
    const bytes = link.data?.signedUrl ? Buffer.from(await (await fetch(link.data.signedUrl)).arrayBuffer()) : Buffer.alloc(0);
    check('TEAM_APPS_OWNER_SIGNED_LINK', createHash('sha256').update(bytes).digest('hex') === RIDER_APK_SHA256, `${bytes.length} bytes`);
    const agentLink = await realOwner.storage.from('team-apps').createSignedUrl(`${REAL_BUSINESS}/agent/TabaLocalAgent-0.1.0-win-x64.msi`, 120);
    const agentBytes = agentLink.data?.signedUrl ? Buffer.from(await (await fetch(agentLink.data.signedUrl)).arrayBuffer()) : Buffer.alloc(0);
    check('TEAM_APPS_AGENT_SIGNED_LINK', createHash('sha256').update(agentBytes).digest('hex') === AGENT_MSI_SHA256,
      `${agentBytes.length} bytes · interno sin firma`);
  } finally {
    await closeSession(realOwner, REAL_BUSINESS);
  }

  // Para el final: el QA vuelve a quedar igual.
  for (const restore of restores.splice(0).reverse()) await restore();
  const productsAfter = await one(admin.from('products').select('sku,external_id,price,price_status,stock,available,merchant_available,is_verified')
    .eq('business_id', QA_CONTROL_BUSINESS).order('sku'));
  check('QA_CATALOG_RESTORED', fingerprint(productsAfter) === fingerprint(productsBefore), fingerprint(productsAfter).slice(0, 12));
  const qaAfter = await one(admin.from('businesses').select('*').eq('id', QA_CONTROL_BUSINESS).single());
  const hoursAfter = await one(admin.from('business_service_hours').select('channel,weekday,opens_at,closes_at').eq('business_id', QA_CONTROL_BUSINESS));
  const hoursKey = (rows) => rows.map((h) => `${h.channel}|${h.weekday}|${h.opens_at}|${h.closes_at}`).sort().join(';');
  const fields = ['delivery_enabled', 'pickup_enabled', 'address', 'status', 'alcohol_sales_enabled', 'alcohol_minimum_age', 'alcohol_sales_start',
    'alcohol_sales_end', 'alcohol_timezone', 'ordering_verified', 'ordering_enabled'];
  check('QA_BUSINESS_RESTORED', fields.every((f) => qaAfter[f] === qaBefore[f]) && hoursKey(hoursAfter) === hoursKey(hoursBefore),
    fields.filter((f) => qaAfter[f] !== qaBefore[f]).join(','));
} finally {
  for (const restore of restores.reverse()) { try { await restore(); } catch (_) { /* se informa abajo */ } }
  const realAfter = await one(admin.from('businesses').select('*').eq('id', REAL_BUSINESS).single());
  const changed = Object.keys(realBefore).filter((k) => k !== 'updated_at' && JSON.stringify(realBefore[k]) !== JSON.stringify(realAfter[k]));
  check('REAL_BUSINESS_UNTOUCHED', changed.length === 0, changed.join(','));
  await closeSession(owner, QA_CONTROL_BUSINESS);
  await closeSession(staff, QA_CONTROL_BUSINESS);
}

const failed = checks.filter((c) => !c.ok);
const report = { at: new Date().toISOString(), started, target: 'controlled-production', qaBusiness: 'qa-control-cp',
  realBusiness: 'la-taba-cp (sólo lectura)', verdict: failed.length ? 'FAIL' : 'PASS', passed: checks.length - failed.length, total: checks.length, checks };
if (out) { mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`); }
console.log(`\nOPENING_CERT: ${report.verdict} (${report.passed}/${report.total})`);
if (failed.length) process.exitCode = 1;
