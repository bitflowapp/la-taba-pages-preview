// La plantilla sin editar no puede pasar como configuración válida (F14).
//
// POR QUÉ EXISTE ESTE ARCHIVO
// ---------------------------
// `resolveRuntimeConfig` valida la FORMA: que la URL sea una URL, que el id sea
// un uuid, que la clave tenga el prefijo correcto. La plantilla del repo cumple
// las tres, así que `npm run config:check` sobre `runtime-config.example.js`
// imprimía, literalmente:
//
//   Runtime válido: entorno=staging, host=project_ref.supabase.co,
//   business=00000000-0000-4000-8000-000000000000, key=sb_pub…AZAR
//
// Un despliegue con la plantilla sin tocar pasaba el gate y publicaba un sitio
// que no puede hablar con ningún backend. El gate decía que sí a algo que era
// obviamente un placeholder.
//
// La comprobación nueva mira el CONTENIDO y vive en el gate de despliegue, no
// en el resolutor del navegador: no cambia lo que hace el cliente en runtime,
// sólo lo que se deja publicar.
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkRuntimeConfig, sentinelErrors } from '../scripts/check-runtime-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('la plantilla del repo se rechaza, y con motivos', async () => {
  const informe = await checkRuntimeConfig(path.join(root, 'runtime-config.example.js'));
  assert.equal(informe.ok, false, 'la plantilla sin editar no puede pasar el gate');
  assert.ok(informe.errors.length >= 3, 'tiene que decir CADA cosa que falta');
  const texto = informe.errors.join(' | ');
  assert.match(texto, /supabaseUrl sigue siendo el de la plantilla/);
  assert.match(texto, /publishableKey sigue siendo el centinela/);
  assert.match(texto, /businessId es el uuid de ceros/);
});

test('cada centinela se detecta por separado', () => {
  const bueno = {
    supabaseUrl: 'https://ukxqbgswjlibmnjemrzd.supabase.co',
    publishableKey: 'sb_publishable_9c2f4a1e7d3b',
    businessId: '11111111-1111-4111-8111-111111111111',
  };
  assert.deepEqual(sentinelErrors(bueno), [], 'una configuración real no puede dar falsos positivos');

  assert.equal(sentinelErrors({ ...bueno, supabaseUrl: 'https://PROJECT_REF.supabase.co' }).length, 1);
  assert.equal(sentinelErrors({ ...bueno, publishableKey: 'sb_publishable_REEMPLAZAR' }).length, 1);
  assert.equal(sentinelErrors({ ...bueno, businessId: '00000000-0000-4000-8000-000000000000' }).length, 1);
});

test('no marca como centinela un proyecto real que casualmente tenga ceros', () => {
  // Un uuid real puede empezar con ceros sin ser el de la plantilla. El patrón
  // exige la forma completa del uuid de ceros, no «tiene muchos ceros».
  const casi = {
    supabaseUrl: 'https://ukxqbgswjlibmnjemrzd.supabase.co',
    publishableKey: 'sb_publishable_9c2f4a1e7d3b',
    businessId: '00000000-0000-4000-8000-000000000001',
  };
  assert.deepEqual(sentinelErrors(casi), []);
});

test('el gate sigue aceptando una configuración legítima', async () => {
  const informe = await checkRuntimeConfig(
    path.join(root, 'tests', 'fixtures', 'runtime-config-valido.js'),
  );
  assert.equal(informe.ok, true, informe.errors?.join(' | ') || 'debería ser válida');
  assert.equal(informe.environment, 'staging');
});
