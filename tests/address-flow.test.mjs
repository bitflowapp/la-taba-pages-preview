import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { addToCart } from '../js/cart.js';
import {
  buildAddressCandidate,
  resolveAddressArea,
  validateAddressCandidate,
} from '../js/core/address-capture.js';
import {
  commerceCheckoutBlock,
  getCommerceAvailability,
  setCommerceAvailability,
} from '../js/core/commerce-availability-store.js';
import { OPERATING_AREA } from '../js/core/business-location.js';
import {
  confirmDeliveryLocationDraft,
  draftFromSavedAddress,
  draftOpenedOnMap,
  emptyDeliveryLocationDraft,
} from '../js/core/delivery-location-draft.js';
import {
  hasConfirmedDeliveryLocation,
  requireConfirmedDeliveryLocation,
} from '../js/core/delivery-location.js';
import { createOrderFromCheckout } from '../js/orders.js';
import { CONFIRMED_DELIVERY_POINT, resetState } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const indexHtml = read('index.html');
const controller = read('js/address-capture-controller.js');
const sheet = read('js/customer-address-sheet.js');
const checkout = read('js/customer-delivery.js');
const captureCore = read('js/core/address-capture.js');
const migration = read('supabase/migrations/20260812240000_customer_address_declared_neighborhood.sql');
const locationMigration = read('supabase/migrations/20260808190000_delivery_location_confirmation.sql');

const AHORA = new Date('2026-08-26T18:00:00.000Z');
const PUNTO = { latitude: -38.9539, longitude: -68.0596 };

/* ============================================================================
   POR QUÉ EXISTE ESTA SUITE

   Gemini auditó el flujo de dirección y describió tres fricciones. Las tres
   eran ciertas y están medidas contra el código: el chip del encabezado era un
   `data-nav-view="profile"`, el checkout sin dirección ofrecía «Agregar
   dirección en Perfil», y la vuelta desde el inicio no existía. Lo que la
   auditoría NO podía ver es el contrato que sostiene todo eso, y que este
   trabajo no puede aflojar:

     · la base exige la fila del cliente ANTES de aceptar una dirección;
     · `upsert_current_customer_address` rechaza cualquier clave que no esté en
       su lista blanca, así que el editor nuevo no puede inventar campos;
     · la invalidación por edición de texto NO es simétrica: sólo cae una
       confirmación REUTILIZADA de una dirección guardada;
     · la cobertura la decide el servidor, no el navegador.

   Lo de abajo fija esas cuatro cosas junto con la fricción resuelta.
   ========================================================================== */

// ─── El defecto de navegación, cerrado ───────────────────────────────────────

test('el chip «ENVIAR A» abre una hoja y ya no cambia de vista', () => {
  const control = indexHtml.match(/<button class="topbar-address"[^>]*>/)?.[0];
  assert.ok(control, 'no encontré el chip del encabezado');
  assert.match(control, /data-home-address/);
  assert.match(control, /data-address-sheet-open="home"/);
  assert.match(control, /aria-haspopup="dialog"/);
  // Éste era el defecto: tocarlo navegaba a Perfil y, de paso, `data-nav-view`
  // a Perfil LIMPIA la marca de retorno, así que tampoco había vuelta.
  assert.doesNotMatch(control, /data-nav-view/);
  assert.match(indexHtml, /<dialog class="address-sheet" data-address-sheet/);
});

test('la hoja cerrada no aporta ningún nombre al árbol de accesibilidad', () => {
  /*
   * DEFECTO MEDIDO, no una regla de estilo.
   *
   * La hoja nació con `aria-label="Dirección de entrega"` como respaldo. Un
   * `<dialog>` cerrado no se ve, pero ese atributo igual le daba nombre, y ese
   * nombre choca POR SUBCADENA con el campo «Dirección» del alta del comercio:
   * `getByLabel('Dirección')` pasó a resolver a dos elementos y el asistente del
   * Panel dejó de poder completarse. Lo encontró el gate de navegador, no una
   * revisión.
   *
   * El nombre lo pone el `<h2>` que el módulo dibuja SIEMPRE antes de abrir.
   */
  const dialogo = indexHtml.match(/<dialog class="address-sheet"[^>]*>/)?.[0];
  assert.ok(dialogo, 'no encontré la hoja de direcciones');
  assert.match(dialogo, /aria-labelledby="address-sheet-title"/);
  assert.doesNotMatch(dialogo, /aria-label=/);
  // Y el módulo pinta ese título en las dos caras de la hoja, antes de abrirla.
  assert.match(sheet, /id="address-sheet-title"/);
  const apertura = sheet.slice(
    sheet.indexOf('export function openCustomerAddressSheet('),
    sheet.indexOf('export function closeCustomerAddressSheet('),
  );
  assert.ok(apertura.length > 0, 'no encontré la apertura de la hoja');
  assert.ok(
    apertura.indexOf('render();') < apertura.indexOf('showModal()'),
    'la hoja tiene que dibujarse antes de mostrarse',
  );
});

test('el checkout resuelve la dirección adentro y deja Perfil como administración', () => {
  const bloque = checkout.slice(
    checkout.indexOf('function renderDeliveryAddressBlock()'),
    checkout.indexOf('function currentDeliveryModeIsPickup()'),
  );
  assert.ok(bloque.length > 0, 'no encontré el bloque de dirección del checkout');
  // Ninguno de los dos caminos de compra manda a otra pantalla.
  assert.doesNotMatch(bloque, /add-address/);
  assert.doesNotMatch(bloque, /Agregar dirección en Perfil/);
  assert.doesNotMatch(bloque, /Confirmar ubicación en Perfil/);
  assert.match(bloque, /data-profile-checkout-action="new-address"/);
  assert.match(bloque, /capture\.html\(\)/);
  // Y Perfil sigue enlazado como lo que es.
  assert.match(bloque, /data-profile-checkout-action="manage-addresses"/);
  assert.match(bloque, /Administrar en Perfil/);
});

test('lo que elige la hoja vale para UNA compra, y después vuelve a regir la predeterminada', () => {
  /*
   * Abrir el carrito empieza una sesión de checkout NUEVA, y una sesión nueva
   * arranca en la predeterminada del Perfil: es una decisión tomada, y
   * `customer-delivery.spec` la sostiene saliendo a Home y volviendo. Sirve para
   * que una selección vieja no se cuele en la compra siguiente.
   *
   * Lo que la hoja declara es otra cosa —«a esto que estoy por comprar,
   * llevámelo acá»—, así que viaja como una intención de UN SOLO uso. Sin ella,
   * elegir «Trabajo» en el inicio y abrir el carrito cambiaba el destino en
   * silencio justo en la pantalla donde se paga; con ella permanente, se habría
   * roto la regla de la sesión nueva.
   */
  const sesion = checkout.slice(
    checkout.indexOf('async function beginCheckoutSession()'),
    checkout.indexOf('function reconcileHydratedAddress('),
  );
  assert.ok(sesion.length > 0, 'no encontré el arranque de la sesión de checkout');
  // Se consume: se lee y se borra en el mismo paso.
  assert.match(sesion, /const intencion = state\.sheetIntentAddressId;\s*\n\s*state\.sheetIntentAddressId = '';/);
  // Y la predeterminada sigue siendo el camino por defecto.
  assert.match(sesion, /state\.addressSource = ADDRESS_SOURCE\.PROFILE_DEFAULT;/);
  assert.match(sesion, /const cachedDefault = defaultAddress\(\);/);
  // La intención sólo la escriben las dos entradas de la hoja.
  const escrituras = [...checkout.matchAll(/state\.sheetIntentAddressId = [^']/g)];
  assert.equal(escrituras.length, 2, 'la intención se declara sólo desde la hoja');
});

test('el checkout ya no tiene un segundo camino de confirmación de ubicación', () => {
  /*
   * Vivían acá `renderLocationPanel`, `renderAddressEditor`, `saveAddress` y
   * `confirmPendingLocation`: un editor entero al que ningún control llegaba
   * —sus funciones de dibujo estaban vivas y jamás se invocaban— y que además
   * había quedado atrás del contrato. `confirmPendingLocation` escribía latitud
   * y longitud SIN `deliveryLocationSource` ni `deliveryLocationConfirmedAt`,
   * o sea una confirmación incompleta que el trigger
   * `orders_require_confirmed_delivery_location` habría rebotado con
   * DELIVERY_LOCATION_REQUIRED después de cobrar.
   */
  for (const muerto of [
    'function renderLocationPanel',
    'function renderAddressEditor',
    'function renderSuggestion',
    'function renderDuplicatePanel',
    'function confirmPendingLocation',
    'async function useCurrentLocation',
    'async function saveAddress',
  ]) {
    assert.ok(!checkout.includes(muerto), `${muerto} debería haberse retirado del checkout`);
  }
  // El único camino que queda es el componente compartido.
  assert.match(checkout, /createAddressCaptureController/);
});

// ─── Reutilización: una sola implementación de cada regla ────────────────────

test('el editor compartido no reimplementa normalización, huella, RPC ni geolocalización', () => {
  for (const [modulo, fuente] of [['controlador', controller], ['hoja', sheet]]) {
    assert.ok(!/\.rpc\(/.test(fuente), `${modulo}: no puede hablar directo con la base`);
    assert.ok(!/fetch\(/.test(fuente), `${modulo}: no puede salir a la red por su cuenta`);
    assert.ok(
      !/replace\(\/\[\^a-z0-9\]/.test(fuente),
      `${modulo}: la huella se calcula en un solo lugar`,
    );
    assert.ok(
      !/navigator\.geolocation/.test(fuente),
      `${modulo}: el GPS pasa por el servicio, que ya decide precisión y permisos`,
    );
  }
  // Y lo que sí usa, lo importa de donde ya vive.
  assert.match(controller, /from '\.\/core\/delivery-location-draft\.js'/);
  assert.match(controller, /from '\.\/delivery-location-step\.js'/);
  assert.match(controller, /from '\.\/map\/location_picker_map\.js'/);
  assert.match(controller, /from '\.\/services\/customer-geolocation\.js'/);
  assert.match(controller, /from '\.\/repositories\/repository_factory\.js'/);
  assert.match(controller, /from '\.\/core\/address-capture\.js'/);
  // La hoja lee las direcciones del checkout, que ya las carga y reconcilia: un
  // segundo cargador sería una segunda verdad sobre cuál es el destino activo.
  assert.match(sheet, /from '\.\/customer-delivery\.js'/);
  assert.ok(!/customerProfiles/.test(sheet), 'la hoja no toca el repositorio por su cuenta');
});

test('el paso de confirmación es literalmente el mismo que usa Perfil', () => {
  const perfil = read('js/customer-profile-view.js');
  assert.match(perfil, /renderDeliveryLocationStep/);
  assert.match(controller, /renderDeliveryLocationStep/);
  // Y por lo tanto habla el mismo vocabulario de acciones, que es lo que
  // permite que las dos superficies compartan el componente sin adaptadores.
  for (const accion of ['use-location', 'open-location-map', 'confirm-location', 'discard-location']) {
    assert.match(controller, new RegExp(`'${accion}'`), `falta el manejo de ${accion}`);
  }
});

// ─── El contrato de la base, del lado del navegador ──────────────────────────

test('el candidato sólo lleva claves que `upsert_current_customer_address` acepta', () => {
  const permitidas = new Set(
    migration
      .slice(migration.indexOf('where key not in ('), migration.indexOf('limit 1'))
      .match(/'([a-zA-Z]+)'/g)
      .map((token) => token.replaceAll("'", '')),
  );
  assert.ok(permitidas.has('neighborhood'), 'la lista blanca leída no parece la vigente');

  const draft = confirmDeliveryLocationDraft(
    draftOpenedOnMap(emptyDeliveryLocationDraft(), PUNTO),
    { address: {}, now: AHORA },
  );
  const { candidate } = buildAddressCandidate({
    label: 'Casa',
    street: 'Antártida Argentina',
    streetNumber: '1450',
    floor: '3',
    apartment: 'B',
    reference: 'Portón negro',
    neighborhood: 'Centro',
    area: resolveAddressArea({ written: {}, saved: {} }),
    isDefault: true,
    draft,
  });

  // El repositorio descarta `lastUsedAt` antes de enviar; el resto viaja tal
  // cual. Una clave de más no degrada: la función ABORTA el guardado entero.
  const { lastUsedAt, ...payload } = candidate;
  const sobrantes = Object.keys(payload).filter((key) => !permitidas.has(key));
  assert.deepEqual(sobrantes, [], 'el editor mandaría campos que la RPC rechaza');
});

test('el nombre y el teléfono se guardan ANTES que la dirección, porque la base lo exige', () => {
  // El servidor: sin fila de cliente, la dirección no entra.
  assert.match(migration, /guardá primero tu nombre y telefono/);
  // El editor: por eso pide identidad cuando falta, y por eso `saveProfile` va
  // primero. Sin esto, la primera compra de cada persona nueva rebotaba con un
  // mensaje del servidor que no se podía resolver en esa pantalla.
  const guardado = controller.slice(
    controller.indexOf('async function save({'),
    controller.indexOf('function fail(fieldName, message)'),
  );
  assert.ok(guardado.length > 0, 'no encontré el guardado del editor');
  assert.ok(
    guardado.indexOf('repo.saveProfile(') < guardado.indexOf('repo.saveAddress('),
    'la identidad tiene que guardarse antes que la dirección',
  );
  assert.match(controller, /profileNeedsIdentity/);
});

test('abrir la hoja no crea una identidad: sólo guardar lo hace', () => {
  // `load()` del repositorio va con `createIfMissing: false` y la hoja no llama
  // a ninguna otra cosa. Crear una identidad anónima por mirar dejaría una fila
  // permanente por visita, robots incluidos.
  const repositorio = read('js/repositories/customer_profile_repository.js');
  assert.match(repositorio, /createIfMissing: false/);
  // Ni la hoja ni el editor pueden alcanzar el servicio de sesión: la única
  // puerta a la identidad es el repositorio, y ahí `load()` no crea nada.
  for (const [nombre, fuente] of [['hoja', sheet], ['editor', controller]]) {
    assert.ok(
      !/from '[^']*supabase-auth\.js'/.test(fuente),
      `${nombre}: no puede importar el servicio de autenticación`,
    );
    assert.ok(
      !/authService/.test(fuente),
      `${nombre}: la sesión no se maneja acá`,
    );
  }
});

// ─── La regla real de invalidación ───────────────────────────────────────────

test('una confirmación FRESCA sobrevive a que se siga escribiendo la dirección', () => {
  // El paso de ubicación está DEBAJO de los campos, así que marcar el pin y
  // después terminar de escribir es el orden humano. Invalidar ahí dejaba a la
  // persona sin poder guardar nunca; está medido contra la URL pública.
  const draft = confirmDeliveryLocationDraft(
    draftOpenedOnMap(emptyDeliveryLocationDraft(), PUNTO),
    { address: { street: 'Antártida Argentina' }, now: AHORA },
  );
  const { candidate, draft: revisado } = buildAddressCandidate({
    label: 'Casa',
    street: 'Antártida Argentina',
    streetNumber: '1450',
    area: resolveAddressArea({ written: {}, saved: {} }),
    draft,
  });
  assert.equal(revisado.status, 'confirmed');
  assert.equal(candidate.locationSource, 'map_pin');
  assert.ok(hasConfirmedDeliveryLocation(candidate));
  // La huella se sella con el texto que se está guardando, no con el que había
  // cuando se tocó «Confirmar ubicación».
  assert.match(candidate.locationConfirmedAddress, /antartida argentina 1450/);
});

test('una confirmación REUTILIZADA de una dirección guardada cae al cambiar la calle', () => {
  const guardada = {
    street: 'Antártida Argentina',
    streetNumber: '1450',
    city: OPERATING_AREA.city,
    province: OPERATING_AREA.province,
    latitude: PUNTO.latitude,
    longitude: PUNTO.longitude,
    locationSource: 'map_pin',
    locationConfirmedAt: AHORA.toISOString(),
    locationConfirmedAddress: 'antartida argentina 1450 neuquen capital neuquen',
  };
  const draft = draftFromSavedAddress(guardada);
  assert.equal(draft.status, 'confirmed');
  assert.equal(draft.origin, 'saved');

  const { candidate, draft: revisado } = buildAddressCandidate({
    label: 'Casa',
    street: 'Rivadavia',
    streetNumber: '1450',
    area: resolveAddressArea({ written: {}, saved: guardada }),
    draft,
  });
  assert.equal(revisado.status, 'pending', 'el pin ya no describe esa puerta');
  assert.equal(candidate.latitude, null);
  assert.equal(candidate.locationConfirmedAt, '');
  assert.ok(!hasConfirmedDeliveryLocation(candidate));
  // Y la base impone lo mismo, así que las dos capas dicen lo mismo en vez de
  // contradecirse.
  assert.match(migration, /invalida la confirmación|v_confirmed_at := null/);
});

test('sin confirmación la dirección se arma SIN punto, no a medias', () => {
  const { candidate } = buildAddressCandidate({
    label: 'Casa',
    street: 'Antártida Argentina',
    streetNumber: '1450',
    area: resolveAddressArea({ written: {}, saved: {} }),
    draft: emptyDeliveryLocationDraft(),
  });
  assert.equal(candidate.latitude, null);
  assert.equal(candidate.longitude, null);
  assert.equal(candidate.locationSource, '');
  assert.equal(candidate.locationConfirmedAt, '');
});

test('la localidad se resuelve, no se pregunta, y una dirección vieja no se reescribe sola', () => {
  assert.deepEqual(resolveAddressArea({ written: {}, saved: {} }), {
    city: OPERATING_AREA.city,
    province: OPERATING_AREA.province,
    postalCode: '',
  });
  assert.equal(
    resolveAddressArea({ written: {}, saved: { city: 'Plottier' } }).city,
    'Plottier',
  );
  assert.equal(
    resolveAddressArea({ written: { city: 'Cipolletti' }, saved: { city: 'Plottier' } }).city,
    'Cipolletti',
  );
});

test('sólo se exige lo que la pantalla pide: calle y número', () => {
  assert.deepEqual(validateAddressCandidate({ street: 'Roca', streetNumber: '120' }), { ok: true });
  assert.equal(validateAddressCandidate({ street: '', streetNumber: '120' }).field, 'street');
  assert.equal(validateAddressCandidate({ street: 'Roca', streetNumber: '' }).field, 'streetNumber');
  // Ciudad y provincia salen del área de operación: reclamarlas sería marcar un
  // error sobre un campo que la persona no puede completar.
  assert.equal(validateAddressCandidate({ street: 'Roca', streetNumber: '120', city: '' }).ok, true);
});

// ─── Fail-closed: lo que no cambia ───────────────────────────────────────────

test('delivery sigue exigiendo punto confirmado y retiro en local sigue sin exigirlo', () => {
  const sinPunto = requireConfirmedDeliveryLocation({
    fulfillmentType: 'delivery',
    address: { street: 'Roca', streetNumber: '120' },
  });
  assert.equal(sinPunto.ok, false);
  assert.equal(sinPunto.code, 'DELIVERY_LOCATION_REQUIRED');

  const retiro = requireConfirmedDeliveryLocation({ fulfillmentType: 'pickup', address: {} });
  assert.equal(retiro.ok, true);
  assert.equal(retiro.skipped, true);

  // Y el servidor impone lo mismo, antes de tocar el stock.
  assert.match(locationMigration, /DELIVERY_LOCATION_REQUIRED/);
  assert.match(locationMigration, /orders_require_confirmed_delivery_location/);
});

test('crear el pedido sigue rechazando una ubicación inválida', () => {
  resetState();
  addToCart('qa-gaseosa-cola', 2);
  const rechazado = createOrderFromCheckout({
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    customerStreetAddress: 'Antártida Argentina 1450',
    customerNeighborhood: 'Neuquén Capital',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  assert.equal(rechazado.ok, false);
  assert.equal(rechazado.code, 'DELIVERY_LOCATION_REQUIRED');

  const aceptado = createOrderFromCheckout({
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    customerStreetAddress: 'Antártida Argentina 1450',
    customerNeighborhood: 'Neuquén Capital',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
    ...CONFIRMED_DELIVERY_POINT,
  });
  assert.equal(aceptado.ok, true);
});

test('retiro en local se crea sin ninguna dirección', () => {
  resetState();
  addToCart('qa-gaseosa-cola', 2);
  const creado = createOrderFromCheckout({
    customerName: 'Cliente QA',
    customerPhone: '2995550000',
    deliveryMode: 'pickup',
    paymentMethod: 'cash',
  });
  assert.equal(creado.ok, true);
});

// ─── Cobertura: la decide el servidor ────────────────────────────────────────

test('la cobertura la resuelve el backend; el editor sólo ofrece la lista que el comercio publica', () => {
  /*
   * `coverageEnforced` NO es una compuerta del navegador: es una configuración
   * del comercio que viaja en la respuesta de `commerce_availability`. Lo que
   * bloquea es que el SERVIDOR haya contestado que esa dirección no es
   * elegible. Mientras no contestó, la tienda no bloquea: bloquear por
   * desconocimiento rompería la tienda cada vez que se cae una consulta, sin
   * ganar una sola garantía —la garantía ya está del otro lado—.
   */
  setCommerceAvailability(null);
  assert.equal(getCommerceAvailability().known, false);
  assert.equal(commerceCheckoutBlock('delivery'), null);

  setCommerceAvailability({
    business_id: 'qa',
    is_open: true,
    coverage_enforced: true,
    areas: [{ name: 'Centro' }, { name: 'Confluencia' }],
    delivery: { eligible: false, reason: 'out_of_coverage', message: 'No llegamos a esa zona.' },
  });
  const bloqueo = commerceCheckoutBlock('delivery');
  assert.equal(bloqueo.reason, 'out_of_coverage');
  assert.equal(bloqueo.message, 'No llegamos a esa zona.');
  // Retiro en local nunca queda bloqueado por cobertura.
  assert.equal(commerceCheckoutBlock('pickup'), null);

  // Y el campo de barrio del editor sale de esa misma lista publicada: no es
  // texto libre, y si la lista viene vacía el campo no aparece.
  assert.match(controller, /getCommerceAvailability\(\)/);
  assert.match(controller, /if \(!areas\.length\) return '';/);

  setCommerceAvailability(null);
});

// ─── Teléfono ────────────────────────────────────────────────────────────────

test('los campos del editor declaran el tamaño que evita el zoom de Safari', () => {
  const hoja = read('styles/checkout.css');
  const bloque = hoja.slice(hoja.indexOf('.address-capture input,'));
  assert.match(bloque, /min-height: 48px;/);
  assert.match(bloque, /font-size: 16px;/);
  // Y la hoja respeta el área segura y no deja que el gesto siga en la góndola.
  assert.match(hoja, /overscroll-behavior: contain;/);
  assert.match(hoja, /env\(safe-area-inset-bottom, 0px\)/);
});

test('el editor no puede enviar el pedido con un Enter', () => {
  // Vive dentro de `<form data-checkout-form>` —HTML no anida formularios—, así
  // que un Enter en cualquiera de sus campos dispararía la compra.
  assert.match(checkout, /if \(event\.key !== 'Enter'\) return;/);
  assert.match(sheet, /if \(event\.key !== 'Enter'\) return;/);
  assert.ok(
    !/<form class="address-capture/.test(controller),
    'el editor no puede ser un <form>: el parser lo descarta dentro del checkout',
  );
});

test('los nombres de los campos no pueden pisar los del pedido', () => {
  const ocultos = [...indexHtml.matchAll(/<input type="hidden" name="([^"]+)"/g)].map((m) => m[1]);
  const delEditor = [...controller.matchAll(/name="\$\{FIELD\.[a-zA-Z]+\}"/g)];
  assert.ok(delEditor.length > 0, 'el editor debería declarar sus campos por constante');
  const prefijos = [...controller.matchAll(/^\s{2}[a-zA-Z]+: '(capture[A-Za-z]+)',$/gm)].map((m) => m[1]);
  assert.ok(prefijos.length >= 10, 'faltan nombres de campo del editor');
  for (const nombre of prefijos) {
    assert.ok(!ocultos.includes(nombre), `${nombre} pisaría un campo del pedido`);
  }
});
