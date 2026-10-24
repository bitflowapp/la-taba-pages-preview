// Las credenciales de los guiones de operación (ops-pulse y compañía) se atan al registro de entornos: producción
// sólo desde deploy/environments.json, y los proyectos retirados se rechazan antes de cualquier llamada.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { loadTargetKeys } from '../scripts/controlled-production/target-keys.mjs';

const ACTIVE = JSON.parse(fs.readFileSync('tests/fixtures/environments.production-active.json', 'utf8'));
const REF = ACTIVE.environments.production.supabase.ref;
const key = (prefix) => [prefix, 'fixture0000000000000000'].join('_');

test('producción toma el ref del registro, nunca del usuario guardado en la credencial', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('{}', { status: 200 }); };
  try {
    const read = (name) => (/PUBLISHABLE/.test(name) ? { usuario: REF, secreto: key('sb_publishable') } : { usuario: REF, secreto: key('sb_secret') });
    const keys = await loadTargetKeys('production', { read, registry: ACTIVE });
    assert.equal(keys.ref, REF);
    assert.ok(calls.every((url) => url.startsWith(`https://${REF}.supabase.co/`)));
    const otherProject = (name) => ({ usuario: 'ixewllzzuzpqrkxzmfzx', secreto: /PUBLISHABLE/.test(name) ? key('sb_publishable') : key('sb_secret') });
    await assert.rejects(loadTargetKeys('production', { read: otherProject, registry: ACTIVE }), /PUBLISHABLE_KEY_NOT_BOUND/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('sin proyecto de producción en el registro real no se consulta nada', async () => {
  await assert.rejects(loadTargetKeys('production', { read: () => null }), /todavía no tiene un proyecto/);
});

test('un destino retirado se rechaza antes de llamar a un proyecto que ya no existe', async () => {
  const realFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('{}', { status: 200 }); };
  try {
    const read = () => ({ usuario: 'ucbtjcurawxjwjdvvcvj', secreto: key('sb_publishable') });
    await assert.rejects(loadTargetKeys('staging', { read }), /TARGET_RETIRED:staging/);
    const cp = () => ({ usuario: 'tkanbadcglszlcyfjvpv', secreto: key('sb_publishable') });
    await assert.rejects(loadTargetKeys('controlled-production', { read: cp }), /TARGET_RETIRED:controlled-production/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
