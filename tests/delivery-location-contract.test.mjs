import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { beforeEach } from 'node:test';
import { fileURLToPath } from 'node:url';

import { addToCart } from '../js/cart.js';
import { normalizeOrderAddressDetails } from '../js/core/address.js';
import { normalizeOrderDraft } from '../js/core/domain.js';
import {
  DELIVERY_LOCATION_REQUIRED,
  DELIVERY_LOCATION_SOURCES,
  confirmedDeliveryLocationOf,
  deliveryDestinationDirectionsUrl,
  deliveryLocationAddressFingerprint,
  hasConfirmedDeliveryLocation,
  normalizeDeliveryLocation,
  requireConfirmedDeliveryLocation,
} from '../js/core/delivery-location.js';
import { buildMercadoPagoCheckoutPayload } from '../js/payments/mercadopago-checkout.js';
import { createOrderFromCheckout } from '../js/orders.js';
import { riderNavigationUrl } from '../js/delivery.js';
import { CONFIRMED_DELIVERY_POINT, resetState } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const businessPanel = fs.readFileSync(path.join(root, 'js', 'business.js'), 'utf8');
const riderView = fs.readFileSync(path.join(root, 'js', 'delivery.js'), 'utf8');
const checkoutView = fs.readFileSync(path.join(root, 'js', 'customer-delivery.js'), 'utf8');
const mapView = fs.readFileSync(path.join(root, 'js', 'map', 'map_view.js'), 'utf8');

const PUNTO = Object.freeze({
  latitude: -38.9539,
  longitude: -68.0596,
  locationSource: 'gps',
  accuracyMeters: 12,
  confirmedAt: '2026-08-08T18:00:00.000Z',
});

beforeEach(() => {
  Object.defineProperty(globalThis, 'location', {
    value: { search: '?demo=1' },
    configurable: true,
  });
  resetState();
});

// ── El contrato ──────────────────────────────────────────────────────────────

test('el contrato declara los tres orígenes y ninguno más', () => {
  assert.deepEqual([...DELIVERY_LOCATION_SOURCES], ['gps', 'map_pin', 'geocoded_confirmed']);
});

test('una confirmación son cuatro piezas juntas o no es nada', () => {
  assert.ok(normalizeDeliveryLocation(PUNTO));
  assert.equal(normalizeDeliveryLocation({ ...PUNTO, confirmedAt: '' }), null, 'sin momento no hay confirmación');
  assert.equal(normalizeDeliveryLocation({ ...PUNTO, locationSource: '' }), null, 'sin origen no hay confirmación');
  assert.equal(normalizeDeliveryLocation({ ...PUNTO, latitude: null }), null, 'sin latitud no hay confirmación');
  assert.equal(normalizeDeliveryLocation({ ...PUNTO, longitude: null }), null, 'sin longitud no hay confirmación');
  // Un origen inventado no es un origen.
  assert.equal(normalizeDeliveryLocation({ ...PUNTO, locationSource: 'centroide_de_calle' }), null);
  // Coordenadas fuera del planeta tampoco.
  assert.equal(normalizeDeliveryLocation({ ...PUNTO, latitude: 120 }), null);
});

test('delivery exige punto confirmado; retiro en local no exige nada geográfico', () => {
  const sinPunto = requireConfirmedDeliveryLocation({ fulfillmentType: 'delivery', location: {} });
  assert.equal(sinPunto.ok, false);
  assert.equal(sinPunto.code, DELIVERY_LOCATION_REQUIRED);
  assert.match(sinPunto.message, /Confirmá en el mapa/);

  assert.equal(requireConfirmedDeliveryLocation({ fulfillmentType: 'delivery', location: PUNTO }).ok, true);
  assert.equal(requireConfirmedDeliveryLocation({ fulfillmentType: 'pickup', location: {} }).ok, true);
});

test('la huella ignora piso y departamento, que no mueven el pin', () => {
  const base = { street: 'Antártida Argentina', streetNumber: '1450', city: 'Neuquén', province: 'Neuquén' };
  assert.equal(
    deliveryLocationAddressFingerprint(base),
    deliveryLocationAddressFingerprint({ ...base, floor: '3', apartment: 'B' }),
  );
  assert.notEqual(
    deliveryLocationAddressFingerprint(base),
    deliveryLocationAddressFingerprint({ ...base, streetNumber: '2600' }),
  );
  // Espeja la normalización de la base: acentos, abreviaturas y separadores.
  assert.equal(
    deliveryLocationAddressFingerprint({ street: 'Av. Argentina', streetNumber: '450 B', city: 'Neuquén Capital', province: 'Neuquén', postalCode: '8300' }),
    'avenida argentina 450 b neuquen capital neuquen 8300',
  );
});

test('una confirmación deja de valer si el texto de la dirección cambió', () => {
  const direccion = {
    street: 'Antártida Argentina',
    streetNumber: '1450',
    city: 'Neuquén',
    province: 'Neuquén',
    ...PUNTO,
    locationConfirmedAt: PUNTO.confirmedAt,
    geolocationAccuracy: PUNTO.accuracyMeters,
    locationConfirmedAddress: deliveryLocationAddressFingerprint({
      street: 'Antártida Argentina', streetNumber: '1450', city: 'Neuquén', province: 'Neuquén',
    }),
  };
  assert.ok(confirmedDeliveryLocationOf(direccion));
  assert.equal(confirmedDeliveryLocationOf({ ...direccion, streetNumber: '2600' }), null);
});

// ── El borrador del pedido ───────────────────────────────────────────────────

test('el borrador del pedido transporta el punto entero o ninguno', () => {
  const confirmado = normalizeOrderDraft({
    deliveryMode: 'delivery',
    ...CONFIRMED_DELIVERY_POINT,
  });
  assert.equal(confirmado.deliveryLocationConfirmed, true);
  assert.equal(confirmado.deliveryLocationSource, 'gps');
  assert.equal(confirmado.deliveryLocationConfirmedAt, '2026-08-08T18:00:00.000Z');

  const aMedias = normalizeOrderDraft({
    deliveryMode: 'delivery',
    deliveryLatitude: -38.9539,
    deliveryLongitude: -68.0596,
  });
  assert.equal(aMedias.deliveryLocationConfirmed, false);
  assert.equal(aMedias.deliveryLocationSource, '');
});

test('un pedido de delivery sin punto confirmado no se crea', () => {
  addToCart('qa-gaseosa-cola', 1);
  const result = createOrderFromCheckout({
    customerName: 'Cliente Sin Punto',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    customerStreetAddress: 'Roca 321',
    customerNeighborhood: 'Centro',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, DELIVERY_LOCATION_REQUIRED);
  assert.match(result.message, /Confirmá en el mapa/);
});

test('con lat/lng pero sin confirmación tampoco se crea', () => {
  addToCart('qa-gaseosa-cola', 1);
  const result = createOrderFromCheckout({
    customerName: 'Cliente Sin Confirmar',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    customerStreetAddress: 'Roca 321',
    customerNeighborhood: 'Centro',
    deliveryLatitude: -38.9539,
    deliveryLongitude: -68.0596,
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, DELIVERY_LOCATION_REQUIRED);
});

test('un pedido de retiro en local no necesita punto', () => {
  addToCart('qa-gaseosa-cola', 1);
  const result = createOrderFromCheckout({
    customerName: 'Cliente Retiro',
    customerPhone: '2995550000',
    deliveryMode: 'pickup',
    paymentMethod: 'cash',
  });
  assert.equal(result.ok, true);
});

test('el punto confirmado llega al pedido y de ahí a las superficies', () => {
  addToCart('qa-gaseosa-cola', 1);
  const result = createOrderFromCheckout({
    ...CONFIRMED_DELIVERY_POINT,
    customerName: 'Cliente Con Punto',
    customerPhone: '2995550000',
    customerAddress: 'Roca 321',
    customerStreetAddress: 'Roca 321',
    customerNeighborhood: 'Centro',
    deliveryMode: 'delivery',
    paymentMethod: 'cash',
  });
  assert.equal(result.ok, true);
  const address = normalizeOrderAddressDetails(result.order);
  assert.equal(address.latitude, CONFIRMED_DELIVERY_POINT.deliveryLatitude);
  assert.equal(address.longitude, CONFIRMED_DELIVERY_POINT.deliveryLongitude);
  assert.equal(address.locationSource, 'gps');
  assert.equal(address.locationConfirmedAt, CONFIRMED_DELIVERY_POINT.deliveryLocationConfirmedAt);
  assert.equal(hasConfirmedDeliveryLocation(address), true);
});

// ── Propagación ──────────────────────────────────────────────────────────────

test('Checkout Pro manda el punto en la dirección; antes se perdía', () => {
  const payload = buildMercadoPagoCheckoutPayload({
    businessId: '00000000-0000-4000-8000-000000000001',
    clientRequestId: '11111111-2222-4333-8444-555555555555',
    items: [{ product_id: '30000000-0000-4000-8000-000000000001', quantity: 1 }],
    values: {
      deliveryMode: 'delivery',
      customerName: 'Cliente Con Punto',
      customerPhone: '2995550000',
      deliveryStreet: 'Roca',
      deliveryStreetNumber: '321',
      deliveryCity: 'Neuquén',
      ...CONFIRMED_DELIVERY_POINT,
      deliveryAddressSource: 'gps',
    },
  });
  assert.equal(payload.address.latitude, '-38.9539');
  assert.equal(payload.address.longitude, '-68.0596');
  assert.equal(payload.address.geolocation_accuracy, '12');
  assert.equal(payload.address.location_source, 'gps');
  assert.equal(payload.address.location_confirmed_at, '2026-08-08T18:00:00.000Z');
});

test('Checkout Pro no manda coordenadas basura cuando no hay punto', () => {
  const payload = buildMercadoPagoCheckoutPayload({
    businessId: '00000000-0000-4000-8000-000000000001',
    clientRequestId: '11111111-2222-4333-8444-555555555555',
    items: [{ product_id: '30000000-0000-4000-8000-000000000001', quantity: 1 }],
    values: {
      deliveryMode: 'delivery',
      deliveryStreet: 'Roca',
      deliveryStreetNumber: '321',
      deliveryCity: 'Neuquén',
      deliveryLatitude: '',
      deliveryLongitude: undefined,
    },
  });
  assert.equal('latitude' in payload.address, false);
  assert.equal('longitude' in payload.address, false);
  assert.equal('location_source' in payload.address, false);
});

test('el Rider navega por coordenadas, no por texto de dirección', () => {
  const url = riderNavigationUrl({
    latitude: -38.9539,
    longitude: -68.0596,
    label: 'Mendoza 827, Neuquén',
    reference: 'Portón negro',
  }, 'Mendoza 827, Neuquén');
  assert.match(url, /destination=-38\.9539000%2C-68\.0596000/);
  assert.doesNotMatch(url, /Mendoza/, 'mandar el texto deja que un geocodificador adivine la ciudad');

  // Un pedido anterior al contrato no tiene punto: mejor una búsqueda por texto
  // que ninguna navegación.
  const viejo = riderNavigationUrl({ reference: '' }, 'Mendoza 827, Neuquén');
  assert.match(viejo, /destination=Mendoza/);
});

test('el enlace de Maps del destino usa coordenadas con precisión estable', () => {
  const url = deliveryDestinationDirectionsUrl({ latitude: -38.9539, longitude: -68.0596 });
  assert.equal(
    url,
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent('-38.9539000,-68.0596000')}`,
  );
  assert.equal(deliveryDestinationDirectionsUrl({}), '');
});

test('el Panel muestra el punto de entrega y lo enlaza por coordenadas', () => {
  assert.match(businessPanel, /function renderDeliveryPointRow\(address\)/);
  assert.match(businessPanel, /deliveryDestinationSearchUrl\(address\)/);
  assert.match(businessPanel, /data-delivery-point="missing"/);
  assert.match(businessPanel, /Sin punto confirmado/);
});

test('el Rider ve el punto exacto sólo junto a la dirección, es decir post-claim', () => {
  assert.match(riderView, /function renderRiderDeliveryPoint\(address\)/);
  // La vista previa a tomar la entrega sólo conoce la zona general: el punto
  // exacto no puede filtrarse antes del claim.
  const preview = riderView.slice(
    riderView.indexOf('function renderRiderAssignmentPreview('),
    riderView.indexOf('function renderRiderSheetTopbar('),
  );
  assert.ok(preview.length > 0, 'no encontré la vista previa del Rider');
  assert.doesNotMatch(preview, /renderRiderDeliveryPoint|plottableDeliveryPoint|latitude/);
  assert.match(preview, /generalZone/);
});

test('el seguimiento dibuja el destino del pedido real, no sólo el de la sandbox', () => {
  assert.match(mapView, /function orderDestinationPoint\(order\)/);
  assert.match(mapView, /sandboxScenario\?\.destination \|\| orderDestinationPoint\(order\)/);
  // Un retiro en local no tiene destino de entrega que dibujar.
  assert.match(mapView, /order\.deliveryMode === 'pickup'\) return null/);
});

test('el punto VUELVE del pedido guardado, no sólo se escribe', async () => {
  // Defecto medido en staging: la fila traía delivery_latitude y el mapeo de
  // lectura armaba `addressDetails` a mano sin las coordenadas, así que el
  // Panel, el Rider y el seguimiento veían texto y nada más con el dato al lado
  // en la base. Se fija el camino de LECTURA, que es el que se había quedado.
  const repositorio = fs.readFileSync(path.join(root, 'js', 'repositories', 'supabase_order_repository.js'), 'utf8');
  const mapeo = repositorio.slice(
    repositorio.indexOf('function rowToDemoOrder'),
    repositorio.indexOf('function rowToDemoOrder') + 2600,
  );
  for (const clave of [
    'latitude: row.delivery_latitude',
    'longitude: row.delivery_longitude',
    'geolocationAccuracy: row.delivery_geolocation_accuracy',
    'locationSource: row.delivery_location_source',
    'locationConfirmedAt: row.delivery_location_confirmed_at',
  ]) {
    assert.ok(mapeo.includes(clave), `el mapeo de lectura descarta ${clave}`);
  }

  // Y el Panel que el comercio usa de verdad lo muestra.
  const panelProductivo = fs.readFileSync(path.join(root, 'js', 'production-operations.js'), 'utf8');
  assert.match(panelProductivo, /function renderDeliveryPoint\(addressDetails\)/);
  assert.match(panelProductivo, /deliveryDestinationSearchUrl\(addressDetails\)/);
  assert.match(panelProductivo, /Punto de entrega: sin confirmar/);
});

test('el checkout no deja elegir una dirección sin punto confirmado', () => {
  assert.match(checkoutView, /data-profile-block="no-confirmed-location"/);
  assert.match(checkoutView, /hasConfirmedDeliveryLocation\(normalizeCustomerAddress\(address\)\)/);
  // El control queda deshabilitado Y la selección por código también se frena.
  assert.match(checkoutView, /disabled aria-disabled="true"/);
  const select = checkoutView.slice(
    checkoutView.indexOf('function selectAddress('),
    checkoutView.indexOf('function applyAddressToForm('),
  );
  assert.match(select, /hasConfirmedDeliveryLocation/);
});
