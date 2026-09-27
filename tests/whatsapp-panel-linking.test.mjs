import assert from 'node:assert/strict';
import test from 'node:test';

import {
  configureBusinessOperations,
  handleBusinessOperationsAction,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';
import { createSupabaseFiscalRepository } from '../js/repositories/supabase-fiscal-repository.js';

// El Panel vincula el WhatsApp de cada persona del equipo: pide un código de un solo uso, muestra los
// vínculos (número enmascarado, lo decide el servidor) y los revoca. Nada de esto decide algo
// fiscal: las RPC y la base hacen el trabajo; acá se fija que se llamen bien y se muestre lo justo.

function element(attributes) {
  const dataset = Object.fromEntries(Object.entries(attributes).map(([name, value]) => [
    name.replace(/^data-/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value,
  ]));
  return {
    dataset,
    closest(selector) {
      const names = selector.split(',').map((part) => /^\[([a-z-]+)(?:=[^\]]*)?\]$/.exec(part.trim())?.[1]);
      return names.some((name) => name && Object.hasOwn(attributes, name)) ? this : null;
    },
    hasAttribute: (name) => Object.hasOwn(attributes, name),
  };
}

test('el repositorio llama las RPC de WhatsApp con sus nombres de argumento', async () => {
  const calls = [];
  const client = { from() { throw new Error('no se usa'); }, async rpc(name, args) { calls.push([name, args]); return { data: [], error: null, status: 200 }; } };
  const repository = createSupabaseFiscalRepository({ client, businessId: 'b' });
  await repository.createWhatsAppPairing();
  await repository.listWhatsAppLinks();
  await repository.revokeWhatsAppLink({ linkId: 'l', reason: 'perdió el teléfono' });
  assert.deepEqual(calls, [
    ['create_whatsapp_pairing', { p_business_id: 'b' }],
    ['list_whatsapp_links', { p_business_id: 'b' }],
    ['revoke_whatsapp_link', { p_link_id: 'l', p_reason: 'perdió el teléfono' }],
  ]);
});

test('Comprobantes ofrece vincular WhatsApp: código de un solo uso, vínculos enmascarados y desvincular', async () => {
  resetBusinessOperationsForTests();
  const link = '4c8a1f7e-2b3d-4e5f-8a9b-0c1d2e3f4a5b';
  let links = [{ id: link, phone_hint: '+54 ••• 0101', is_own: true, active: true }];
  const calls = [];
  configureBusinessOperations({
    role: 'staff',
    listWhatsAppLinks: async () => { calls.push('list'); return { ok: true, data: links }; },
    createWhatsAppPairing: async () => { calls.push('create'); return { ok: true, data: { code: 'ABCD-EFGH-JKLM', message: 'vincular ABCD-EFGH-JKLM', expires_at: '2026-09-27T10:00:00Z' } }; },
    revokeWhatsAppLink: async (input) => { calls.push(['revoke', input]); links = []; return { ok: true, data: { link_id: link } }; },
  });
  renderBusinessOperations('fiscal-status');
  // La activación de la vista lee los vínculos junto con los comprobantes.
  for (let attempt = 0; attempt < 20 && !calls.includes('list'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  await new Promise((resolve) => setTimeout(resolve, 5));
  let html = renderBusinessOperations('fiscal-status');
  assert.match(html, /WhatsApp de facturación/);
  assert.match(html, /\+54 ••• 0101 · tu WhatsApp/);
  assert.doesNotMatch(html, /data-whatsapp-code/, 'sin pedirlo, no hay código a la vista');

  const created = await handleBusinessOperationsAction(element({ 'data-whatsapp-pairing-create': '' }));
  assert.deepEqual([created.ok, created.message], [true, 'Código generado. Vence en 10 minutos.']);
  html = renderBusinessOperations('fiscal-status');
  assert.match(html, /ABCD-EFGH-JKLM/);
  assert.match(html, /mandá al número de La Taba: vincular ABCD-EFGH-JKLM/);

  const revoked = await handleBusinessOperationsAction(element({ 'data-whatsapp-link-revoke': link }));
  assert.equal(revoked.ok, true);
  assert.deepEqual(calls.find((call) => Array.isArray(call)), ['revoke', { linkId: link, reason: 'desvinculado desde el Panel' }]);
  html = renderBusinessOperations('fiscal-status');
  assert.match(html, /Ningún WhatsApp vinculado\./);
  resetBusinessOperationsForTests();
});

test('los errores de vincular se dicen sin jerga', async () => {
  resetBusinessOperationsForTests();
  configureBusinessOperations({
    role: 'staff',
    createWhatsAppPairing: async () => ({ ok: false, code: '54000', message: 'demasiados codigos pedidos; probar en una hora' }),
  });
  const tooMany = await handleBusinessOperationsAction(element({ 'data-whatsapp-pairing-create': '' }));
  assert.deepEqual([tooMany.ok, tooMany.message], [false, 'Pediste demasiados códigos. Probá de nuevo en una hora.']);
  configureBusinessOperations({ role: 'staff', createWhatsAppPairing: async () => ({ ok: false, code: 'PGRST202', message: 'Could not find the function public.create_whatsapp_pairing' }) });
  const missing = await handleBusinessOperationsAction(element({ 'data-whatsapp-pairing-create': '' }));
  assert.equal(missing.message, 'No se pudo completar la operación. Probá de nuevo.');
  const bad = await handleBusinessOperationsAction(element({ 'data-whatsapp-link-revoke': 'no-es-un-id' }));
  assert.deepEqual([bad.ok, bad.message], [false, 'Vínculo no encontrado.']);
  resetBusinessOperationsForTests();
});
