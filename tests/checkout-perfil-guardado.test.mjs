import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { normalizeOrderDraft } from '../js/core/domain.js';
import { validateCustomerName } from '../js/core/validators.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const checkout = read('js/customer-delivery.js');
const ui = read('js/ui.js');
const indexHtml = read('index.html');
const profileMigration = read('supabase/migrations/20260729150000_customer_profile_completion.sql');

const MENSAJE_QA_401 = 'Ingresá un nombre de al menos 2 caracteres.';

/* ============================================================================
   QA-401 — LA TARJETA Y EL PEDIDO LEEN EL MISMO PERFIL

   Reproducido 3/3 en Staging el 2026-09-27: «Guardar y continuar» mostraba el
   perfil en «Tus datos» y «Confirmar pedido» contestaba «Ingresá un nombre de
   al menos 2 caracteres» sin pedir nada al servidor. La validación recibía "":
   el pedido lee los ocultos `customerName`/`customerPhone`, y sólo la carga del
   perfil los llenaba. Guardar en línea, guardar desde el editor de direcciones
   y guardar desde la hoja del inicio cambiaban la tarjeta y nada más.

   El recorrido completo está en `tests/e2e/checkout-perfil-guardado.spec.mjs`.
   Acá se fija el contrato que lo sostiene: el perfil del checkout se cambia en
   UN solo lugar, y ese lugar también escribe lo que el pedido lee.
   ========================================================================== */

function cuerpoDe(fuente, firma) {
  const inicio = fuente.indexOf(firma);
  assert.ok(inicio >= 0, `no encontré «${firma}»`);
  const apertura = fuente.indexOf('{', inicio + firma.length);
  let profundidad = 0;
  for (let i = apertura; i < fuente.length; i += 1) {
    if (fuente[i] === '{') profundidad += 1;
    if (fuente[i] === '}') profundidad -= 1;
    if (profundidad === 0) return fuente.slice(apertura, i + 1);
  }
  throw new Error(`«${firma}» no cierra`);
}

test('el perfil del checkout sólo cambia por la función que también llena los ocultos del pedido', () => {
  const asignaciones = [...checkout.matchAll(/state\.profile\s*=(?!=)/g)];
  assert.equal(asignaciones.length, 1, 'hay una asignación de state.profile que se saltea los ocultos del pedido');

  const adoptar = cuerpoDe(checkout, 'function adoptProfile(profile)');
  assert.match(adoptar, /state\.profile = profile;/);
  assert.match(adoptar, /applyProfileToEmptyFields\(profile\);/);

  const aplicar = cuerpoDe(checkout, 'function applyProfileToEmptyFields(profile)');
  assert.match(aplicar, /setValue\(form, 'customerName', profile\.name\);/);
  assert.match(aplicar, /setValue\(form, 'customerPhone', formatArgentinePhone\(profile\.phone\)\);/);
});

test('las cuatro puertas que cambian el perfil pasan por adoptProfile', () => {
  // «Guardar y continuar», el camino exacto de QA-401.
  assert.match(cuerpoDe(checkout, 'async function guardarIdentidadEnLinea()'), /adoptProfile\(resultado\.profile \|\|/);
  // El editor de direcciones guarda la identidad antes que la dirección.
  assert.match(checkout, /onProfileSaved: \(profile\) => \{ adoptProfile\(profile\); \}/);
  // La hoja del inicio.
  assert.match(cuerpoDe(checkout, 'export function applyProfileFromSheet(profile)'), /adoptProfile\(profile\);/);
  // La carga, que era la única que ya lo hacía.
  assert.match(cuerpoDe(checkout, 'async function loadCustomerDeliveryProfile()'), /adoptProfile\(result\.profile\);/);
});

test('el pedido toma nombre y teléfono de los ocultos que llena el perfil', () => {
  assert.match(indexHtml, /<input type="hidden" name="customerName" \/>/);
  assert.match(indexHtml, /<input type="hidden" name="customerPhone" \/>/);
  const valores = cuerpoDe(ui, 'export function getCheckoutFormValues()');
  assert.match(valores, /customerName: String\(formData\.get\('customerName'\) \|\| ''\)/);
  assert.match(valores, /customerPhone: String\(formData\.get\('customerPhone'\) \|\| ''\)/);
});

test('un oculto vacío es exactamente lo que QA-401 le pasaba a la validación', () => {
  assert.deepEqual(validateCustomerName(normalizeOrderDraft({ customerName: '' }).customerName), {
    ok: false,
    name: '',
    message: MENSAJE_QA_401,
  });
});

test('«Marco» y «Ma» valen; «M» no', () => {
  assert.deepEqual(validateCustomerName('Marco'), { ok: true, name: 'Marco', message: '' });
  assert.deepEqual(validateCustomerName('Ma'), { ok: true, name: 'Ma', message: '' });
  assert.deepEqual(validateCustomerName('M'), { ok: false, name: 'M', message: MENSAJE_QA_401 });
});

test('«  Marco  » se normaliza igual que en la base y el pedido lo lleva como «Marco»', () => {
  assert.deepEqual(validateCustomerName('  Marco  '), { ok: true, name: 'Marco', message: '' });
  assert.equal(validateCustomerName('  Marco   Pérez ').name, 'Marco Pérez');
  assert.equal(normalizeOrderDraft({ customerName: '  Marco  ' }).customerName, 'Marco');
  // La base recorta y colapsa los espacios con la misma regla antes de validar.
  assert.match(profileMigration, /regexp_replace\(btrim\(coalesce\(p_name, ''\)\), '\[\[:space:\]\]\+', ' ', 'g'\)/);
  assert.match(profileMigration, /char_length\(v_name\) < 2/);
});
