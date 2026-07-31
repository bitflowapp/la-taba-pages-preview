import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  formatArgentinePhone,
  isValidArgentinePhone,
  normalizeArgentinePhone,
  validateCustomerName,
} from '../js/core/validators.js';
import { normalizeOrderDraft } from '../js/core/domain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260729150000_customer_profile_completion.sql'),
  'utf8',
);
const profileView = fs.readFileSync(
  path.join(root, 'js', 'customer-profile-view.js'),
  'utf8',
);
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('nombre y teléfono del perfil se normalizan con límites operativos', () => {
  assert.deepEqual(validateCustomerName('  Cliente    Demo  '), {
    ok: true,
    name: 'Cliente Demo',
    message: '',
  });
  assert.equal(validateCustomerName('$$$').ok, false);
  assert.equal(validateCustomerName('M').ok, false);
  assert.equal(validateCustomerName('a'.repeat(81)).ok, false);
  assert.equal(normalizeArgentinePhone('(299) 000-0000'), '2990000000');
  assert.equal(isValidArgentinePhone('2990000000'), true);
  assert.equal(isValidArgentinePhone('1111111111'), false);
  assert.equal(formatArgentinePhone('2990000000'), '299 000 0000');
});

test('la migración incremental completa etiqueta y fecha del snapshot sin mutar pedidos históricos', () => {
  assert.match(migration, /add column if not exists delivery_address_label text/i);
  assert.match(migration, /add column if not exists delivery_snapshot_created_at timestamptz/i);
  assert.match(migration, /set delivery_snapshot_created_at = created_at[\s\S]*delivery_address_formatted is not null/i);
  assert.match(migration, /and delivery_snapshot_created_at is null/i);
  assert.match(migration, /delivery_address_label = case[\s\S]*coalesce\(v_label, 'Entrega'\)/i);
  assert.match(migration, /delivery_floor = case/i);
  assert.match(migration, /delivery_apartment = case/i);
  assert.match(migration, /delivery_province = case/i);
  assert.match(migration, /delivery_postal_code = case/i);
});

test('RPCs derivan propiedad de auth.uid, normalizan perfil y cierran el acceso interno', () => {
  assert.match(migration, /v_customer_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /a\.customer_id = v_customer_id/i);
  assert.match(migration, /regexp_replace\(btrim\(coalesce\(p_name/i);
  assert.match(migration, /regexp_replace\(coalesce\(p_phone/i);
  assert.match(migration, /char_length\(v_name\) < 2/i);
  assert.match(migration, /v_name !~ '\[\[:alpha:\]\]'/i);
  assert.match(migration, /revoke all on function public\.create_order_with_items_profile_v1\(jsonb\)[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /p_customer_id|p_user_id|service_role|disable row level security/i);
});

test('la pantalla pide sólo datos de entrega y Perfil es la única fuente editable', () => {
  assert.match(index, /data-view="profile"[\s\S]*data-customer-profile/i);
  // El checkout dejó de ofrecer un guardado propio del Perfil: administrar los
  // datos del cliente es responsabilidad exclusiva de Perfil.
  assert.doesNotMatch(index, /Guardar estos cambios en mi perfil/i);
  assert.doesNotMatch(index, /name="rememberCustomer"/i);
  assert.match(profileView, /Nombre y apellido/);
  assert.match(profileView, /Teléfono/);
  assert.match(profileView, /Calle/);
  assert.match(profileView, /Número/);
  assert.match(profileView, /Provincia/);
  assert.match(profileView, /Referencias/);
  assert.doesNotMatch(
    `${index}\n${profileView}`,
    /name="[^"]*(?:dni|documento|birth|nacimiento|genero|género|estadoCivil|tarjeta|biometric)[^"]*"/i,
  );
});

test('checkout conserva componentes confirmados y no inventa coordenadas 0,0 para campos vacíos', () => {
  const draft = normalizeOrderDraft({
    customerName: 'Cliente Demo',
    customerPhone: '2990000000',
    customerStreetAddress: 'Antártida Argentina 1234',
    customerNeighborhood: 'Neuquén',
    customerAddressLabel: 'Casa',
    deliveryStreet: 'Antártida Argentina',
    deliveryStreetNumber: '1234',
    deliveryFloor: '2',
    deliveryApartment: 'B',
    deliveryCity: 'Neuquén',
    deliveryProvince: 'Neuquén',
    deliveryLatitude: '',
    deliveryLongitude: '',
  });
  assert.equal(draft.customerAddressLabel, 'Casa');
  assert.equal(draft.deliveryStreetNumber, '1234');
  assert.equal(draft.deliveryFloor, '2');
  assert.equal(draft.deliveryProvince, 'Neuquén');
  assert.equal(draft.deliveryLatitude, null);
  assert.equal(draft.deliveryLongitude, null);
});
