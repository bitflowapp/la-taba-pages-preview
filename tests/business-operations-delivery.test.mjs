// Horarios, cobertura, tarifa y mínimo — del lado del cliente y del Panel.
//
// El servidor ya está probado contra PostgreSQL real
// (`scripts/run-business-operations-db.mjs`). Acá se prueba lo otro: que la
// tienda NO decide, que muestra lo que el servidor contestó, que falla del lado
// seguro cuando no contestó nadie, y que la pantalla del Panel no habilita un
// control que la base no habilitó.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import {
  clearCommerceAvailability,
  commerceCheckoutBlock,
  getCommerceAvailability,
  hasResolvedDelivery,
  serverDeliveryFee,
  serverMinimumSubtotal,
  setCommerceAvailability,
} from '../js/core/commerce-availability-store.js';
import { getDeliveryFeeForMode } from '../js/core/pricing.js';
import {
  auditLines,
  enforcementBlockers,
  normalizeOperationsConfig,
  validateWeeklyHours,
  validateZoneDraft,
  weeklyGrid,
} from '../js/business/business-operations-config.js';
import {
  configureBusinessOperations,
  renderBusinessOperations,
  resetBusinessOperationsForTests,
} from '../js/business/business-operations-center.js';

const OPEN_AND_COVERED = Object.freeze({
  business_id: 'b-1',
  channel: 'delivery',
  ordering_ready: true,
  is_open: true,
  hours_enforced: true,
  coverage_enforced: true,
  next_open_at: null,
  hours: [{ weekday: 1, opens_at: '08:00', closes_at: '14:00' }],
  areas: [{ name: 'Santa Genoveva', delivery_fee: 2500, minimum_subtotal: null }],
  delivery: {
    eligible: true, reason: 'ok', zone_name: 'Santa Genoveva',
    delivery_fee: '2500.00', minimum_subtotal: '4000.00',
  },
});

beforeEach(() => clearCommerceAvailability());

// ── Lo que el servidor dijo, y nada más ─────────────────────────────────────

test('sin respuesta del servidor la tienda no afirma nada y no bloquea', () => {
  const state = getCommerceAvailability();
  assert.equal(state.known, false);
  assert.equal(serverDeliveryFee('delivery'), null);
  assert.equal(hasResolvedDelivery(), false);
  // No bloquear con lo desconocido es deliberado: la compuerta real está en el
  // alta del pedido, que rechaza igual. Bloquear acá rompería la tienda cada vez
  // que se cae una consulta sin ganar una sola garantía.
  assert.equal(commerceCheckoutBlock('delivery'), null);
});

test('la tarifa que se muestra es la que resolvió el backend, no la del comercio', () => {
  setCommerceAvailability(OPEN_AND_COVERED);
  assert.equal(serverDeliveryFee('delivery'), 2500);
  assert.equal(getDeliveryFeeForMode('delivery'), 2500);
  assert.equal(getDeliveryFeeForMode('pickup'), 0);
});

test('un mínimo nulo del servidor es «sin mínimo», no «no sé»', () => {
  setCommerceAvailability({
    ...OPEN_AND_COVERED,
    delivery: { eligible: true, reason: 'ok', delivery_fee: '2500', minimum_subtotal: null },
  });
  assert.equal(hasResolvedDelivery(), true);
  assert.equal(serverMinimumSubtotal('delivery'), null);
});

test('una respuesta negativa no arrastra tarifa: nadie autorizó ese número', () => {
  setCommerceAvailability({
    ...OPEN_AND_COVERED,
    delivery: {
      eligible: false, reason: 'out_of_coverage',
      message: 'Por el momento no realizamos entregas en esta zona.',
      delivery_fee: '2500', zone_name: 'Santa Genoveva',
    },
  });
  assert.equal(serverDeliveryFee('delivery'), null);
  assert.equal(getCommerceAvailability().delivery.deliveryFee, null);
});

test('una respuesta sin is_open no se lee como abierto', () => {
  setCommerceAvailability({ ...OPEN_AND_COVERED, is_open: undefined });
  assert.equal(getCommerceAvailability().isOpen, false);
  assert.equal(commerceCheckoutBlock('delivery').reason, 'closed');
});

// ── El bloqueo, y lo que se le dice a la persona ────────────────────────────

test('fuera de cobertura se bloquea con la frase acordada', () => {
  setCommerceAvailability({
    ...OPEN_AND_COVERED,
    delivery: {
      eligible: false, reason: 'out_of_coverage',
      message: 'Por el momento no realizamos entregas en esta zona.',
    },
  });
  const block = commerceCheckoutBlock('delivery');
  assert.equal(block.reason, 'out_of_coverage');
  assert.equal(block.message, 'Por el momento no realizamos entregas en esta zona.');
  // Y el retiro en el local sigue siendo un camino: la cobertura no lo toca.
  assert.equal(commerceCheckoutBlock('pickup'), null);
});

test('cerrado bloquea los dos canales y dice cuándo abre', () => {
  const nextOpen = new Date(Date.now() + 3600000).toISOString();
  setCommerceAvailability({ ...OPEN_AND_COVERED, is_open: false, next_open_at: nextOpen });
  const block = commerceCheckoutBlock('delivery');
  assert.equal(block.reason, 'closed');
  // La HORA siempre está; el DÍA aparece sólo cuando la apertura cae en otra
  // fecha. Antes esto exigía `/Abrimos a las HH:MM\./` a secas, y por eso se
  // ponía en rojo todas las noches entre las 23 y las 00: «dentro de una hora»
  // cruzaba la medianoche y el mensaje pasaba a «Abrimos el lunes a las 00:27».
  // El producto estaba bien —decir el día es MÁS información, no menos— y la
  // prueba medía una de las dos frases en vez de la propiedad. Un gate que se
  // enciende solo la mitad de la noche se termina ignorando.
  assert.match(block.message, /Abrimos (el \p{L}+ )?a las \d{2}:\d{2}\./u);
  assert.equal(commerceCheckoutBlock('pickup').reason, 'closed');
});

test('si abre otro día, el mensaje dice qué día', () => {
  // La otra mitad del contrato, forzada en vez de esperada: a dos días de
  // distancia la apertura cae siempre en otra fecha, corra la prueba a la hora
  // que corra.
  const enDosDias = new Date(Date.now() + 48 * 3600000).toISOString();
  setCommerceAvailability({ ...OPEN_AND_COVERED, is_open: false, next_open_at: enDosDias });
  const block = commerceCheckoutBlock('delivery');
  assert.equal(block.reason, 'closed');
  assert.match(block.message, /Abrimos el \p{L}+ a las \d{2}:\d{2}\./u);
});

test('un payload roto vuelve al estado «no sé» en vez de inventar una respuesta', () => {
  setCommerceAvailability(OPEN_AND_COVERED);
  setCommerceAvailability(null);
  assert.equal(getCommerceAvailability().known, false);
  assert.equal(commerceCheckoutBlock('delivery'), null);
});

test('los horarios y los barrios llegan del servidor: la tienda no los tiene escritos', () => {
  setCommerceAvailability(OPEN_AND_COVERED);
  const state = getCommerceAvailability();
  assert.deepEqual(state.hours, [{ weekday: 1, opensAt: '08:00', closesAt: '14:00' }]);
  assert.equal(state.areas[0].name, 'Santa Genoveva');
  assert.equal(state.areas[0].deliveryFee, 2500);
});

// ── El carrito no se rompe, se frena ────────────────────────────────────────

test('una zona que deja de estar disponible bloquea el checkout sin tocar el carrito', async () => {
  // El catálogo de demo es el mismo que usa `tests/cart.test.mjs`.
  Object.defineProperty(globalThis, 'location', { value: { search: '?demo=1' }, configurable: true });
  const { resetState, state } = await import('./helpers.mjs');
  resetState();
  const { addToCart, getCartSummary, validateCartForCheckout } = await import('../js/cart.js');
  assert.equal(addToCart('qa-jugo-naranja', 4).ok, true);
  const before = getCartSummary('delivery').count;
  assert.ok(before > 0);

  setCommerceAvailability({
    ...OPEN_AND_COVERED,
    delivery: {
      eligible: false, reason: 'out_of_coverage',
      message: 'Por el momento no realizamos entregas en esta zona.',
    },
  });
  const validation = validateCartForCheckout('delivery');
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, 'out_of_coverage');
  assert.match(validation.message, /retiro en el local/);
  // Lo que la persona eligió sigue ahí. Se frena el paso siguiente, no el carrito.
  assert.equal(getCartSummary('delivery').count, before);
  assert.equal(state().cart.length > 0, true);

  // Y con retiro en el local el mismo carrito vuelve a poder avanzar.
  assert.equal(validateCartForCheckout('pickup').ok, true);
});

// ── El Panel ────────────────────────────────────────────────────────────────

test('sin can_manage explícito, el Panel no habilita nada', () => {
  assert.equal(normalizeOperationsConfig({}).canManage, false);
  assert.equal(normalizeOperationsConfig({ can_manage: 'true' }).canManage, false);
  assert.equal(normalizeOperationsConfig({ can_manage: true }).canManage, true);
});

test('la grilla semanal arma el turno partido de cada día', () => {
  const config = normalizeOperationsConfig({
    hours: [
      { channel: 'delivery', weekday: 1, opens_at: '17:30', closes_at: '22:30' },
      { channel: 'delivery', weekday: 1, opens_at: '08:00', closes_at: '14:00' },
      { channel: 'pickup', weekday: 1, opens_at: '09:00', closes_at: '12:00' },
    ],
  });
  const monday = weeklyGrid(config, 'delivery').find((day) => day.value === 1);
  assert.deepEqual(monday.slots, [
    { opensAt: '08:00', closesAt: '14:00' },
    { opensAt: '17:30', closesAt: '22:30' },
  ]);
  // El canal de retiro no se mezcla con el de envío.
  assert.equal(weeklyGrid(config, 'pickup').find((day) => day.value === 1).slots.length, 1);
});

test('dos franjas por día son válidas; superpuestas no', () => {
  assert.equal(validateWeeklyHours([
    { weekday: 1, opensAt: '08:00', closesAt: '14:00' },
    { weekday: 1, opensAt: '17:30', closesAt: '22:30' },
  ]).ok, true);

  const overlap = validateWeeklyHours([
    { weekday: 1, opensAt: '08:00', closesAt: '14:00' },
    { weekday: 1, opensAt: '13:00', closesAt: '18:00' },
  ]);
  assert.equal(overlap.ok, false);
  assert.match(overlap.errors[0], /superpuestos/);
});

test('el solapamiento se detecta también cuando una franja cruza la medianoche', () => {
  // 22:00–02:00 y 01:00–03:00 se tocan entre la 01:00 y las 02:00. Comparadas
  // sin partir en dos, parecerían no tocarse nunca.
  const crossing = validateWeeklyHours([
    { weekday: 1, opensAt: '22:00', closesAt: '02:00' },
    { weekday: 1, opensAt: '01:00', closesAt: '03:00' },
  ]);
  assert.equal(crossing.ok, false);
  assert.match(crossing.errors[0], /superpuestos/);

  // Y una que cruza sola sigue siendo válida.
  assert.equal(validateWeeklyHours([{ weekday: 1, opensAt: '22:00', closesAt: '02:00' }]).ok, true);
});

test('una franja de ancho cero y una hora mal escrita se rechazan con su motivo', () => {
  assert.match(validateWeeklyHours([{ weekday: 1, opensAt: '10:00', closesAt: '10:00' }]).errors[0], /misma hora/);
  assert.match(validateWeeklyHours([{ weekday: 1, opensAt: '25:00', closesAt: '26:00' }]).errors[0], /HH:MM/);
  assert.match(validateWeeklyHours([{ weekday: 9, opensAt: '10:00', closesAt: '11:00' }]).errors[0], /día de la semana/);
});

test('más de cuatro tramos en un día es un error de carga, no un turno partido', () => {
  const many = validateWeeklyHours([
    { weekday: 2, opensAt: '06:00', closesAt: '07:00' },
    { weekday: 2, opensAt: '08:00', closesAt: '09:00' },
    { weekday: 2, opensAt: '10:00', closesAt: '11:00' },
    { weekday: 2, opensAt: '12:00', closesAt: '13:00' },
    { weekday: 2, opensAt: '14:00', closesAt: '15:00' },
  ]);
  assert.equal(many.ok, false);
  assert.match(many.errors.join(' '), /hasta 4 tramos/);
});

test('una zona por barrio arma su payload; sin nombre no sale', () => {
  const ok = validateZoneDraft({ name: 'Santa Genoveva', deliveryFee: '2500', minimumSubtotal: '' });
  assert.equal(ok.ok, true);
  assert.equal(ok.zone.match_kind, 'declared_area');
  assert.equal(ok.zone.area, 'Santa Genoveva');
  assert.equal(ok.zone.delivery_fee, '2500');
  // Mínimo vacío no viaja: dejarlo caer al del comercio es una decisión, y
  // mandar cero sería otra distinta.
  assert.equal(Object.hasOwn(ok.zone, 'minimum_subtotal'), false);

  assert.equal(validateZoneDraft({ name: 'X' }).ok, false);
  assert.equal(validateZoneDraft({ name: 'Poligono', matchKind: 'polygon', boundary: [[1, 2]] }).ok, false);
});

test('el Panel dice qué falta antes de dejar encender una exigencia', () => {
  const empty = normalizeOperationsConfig({ can_manage: true });
  const blockers = enforcementBlockers(empty);
  assert.match(blockers.join(' '), /huso horario/);
  assert.match(blockers.join(' '), /No hay horarios cargados/);
  assert.match(blockers.join(' '), /No hay zonas activas/);

  const ready = normalizeOperationsConfig({
    can_manage: true,
    operating_timezone: 'America/Argentina/Buenos_Aires',
    hours: [{ channel: 'delivery', weekday: 1, opens_at: '08:00', closes_at: '14:00' }],
    zones: [{ id: 'z-1', name: 'Zona', is_active: true, match_kind: 'declared_area' }],
  });
  assert.deepEqual(enforcementBlockers(ready), []);
});

test('la auditoría se lee como frases, y un cambio del servidor lo dice', () => {
  const config = normalizeOperationsConfig({
    can_manage: true,
    audit: [
      {
        id: '2', scope: 'delivery_pricing', action: 'updated', actor_kind: 'service',
        created_at: '2026-08-12T10:00:00Z',
        before: { delivery_fee: 1000, minimum_delivery_subtotal: 5000 },
        after: { delivery_fee: 2500, minimum_delivery_subtotal: 5000 },
      },
      {
        id: '1', scope: 'zone', action: 'disabled', actor_kind: 'user',
        actor_id: 'u-1', created_at: '2026-08-12T09:00:00Z',
        before: { name: 'Santa Genoveva' }, after: { name: 'Santa Genoveva' },
      },
    ],
  });
  const lines = auditLines(config);
  assert.match(lines[0].text, /^El servidor editó envío y mínimo$/);
  assert.match(lines[0].detail, /envío 1000 → 2500/);
  assert.match(lines[1].text, /^Alguien del equipo desactivó zona de entrega$/);
  assert.equal(lines[1].detail, 'Santa Genoveva');
});

test('cambiar de negocio descarta la configuración anterior y consulta el contexto nuevo', async (t) => {
  t.after(() => resetBusinessOperationsForTests());
  let consultasA = 0;
  let consultasB = 0;
  const respuesta = (businessId, zoneName) => ({
    ok: true,
    data: {
      business_id: businessId,
      can_manage: true,
      operating_timezone: 'America/Argentina/Buenos_Aires',
      zones: [{ id: `zone-${businessId}`, name: zoneName, is_active: true }],
    },
  });

  configureBusinessOperations({
    role: 'owner',
    onChange() {},
    async getOperationsConfig() {
      consultasA += 1;
      return respuesta('business-a', 'Zona del comercio A');
    },
  });
  renderBusinessOperations('operations-config');
  await settleOperationsConfig();
  assert.match(renderBusinessOperations('operations-config'), /Zona del comercio A/);
  assert.equal(consultasA, 1);

  configureBusinessOperations({
    role: 'owner',
    onChange() {},
    async getOperationsConfig() {
      consultasB += 1;
      return respuesta('business-b', 'Zona del comercio B');
    },
  });
  renderBusinessOperations('operations-config');
  await settleOperationsConfig();
  const secondMarkup = renderBusinessOperations('operations-config');

  assert.equal(consultasB, 1);
  assert.match(secondMarkup, /Zona del comercio B/);
  assert.doesNotMatch(secondMarkup, /Zona del comercio A/);
});

test('una respuesta tardía del negocio anterior no repuebla el contexto nuevo', async (t) => {
  t.after(() => resetBusinessOperationsForTests());
  let resolveOldRequest;
  const oldRequest = new Promise((resolve) => { resolveOldRequest = resolve; });
  const response = (businessId, zoneName) => ({
    ok: true,
    data: {
      business_id: businessId,
      can_manage: true,
      zones: [{ id: `zone-${businessId}`, name: zoneName, is_active: true }],
    },
  });

  configureBusinessOperations({
    role: 'owner',
    onChange() {},
    getOperationsConfig: () => oldRequest,
  });
  renderBusinessOperations('operations-config');
  await settleOperationsConfig();

  configureBusinessOperations({
    role: 'owner',
    onChange() {},
    getOperationsConfig: async () => response('business-b', 'Zona vigente B'),
  });
  renderBusinessOperations('operations-config');
  await settleOperationsConfig();
  resolveOldRequest(response('business-a', 'Zona tardía A'));
  await settleOperationsConfig();

  const markup = renderBusinessOperations('operations-config');
  assert.match(markup, /Zona vigente B/);
  assert.doesNotMatch(markup, /Zona tardía A/);
});

async function settleOperationsConfig() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
