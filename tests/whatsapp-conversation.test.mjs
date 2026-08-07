import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cartWith,
  cartWithout,
  normalizeCart,
  parseAddress,
  resolveIntent,
  respond,
} from '../supabase/functions/_shared/whatsapp/conversation.js';

const HEINEKEN = '31000000-0000-4000-8000-000000000001';
const COCA = '31000000-0000-4000-8000-000000000004';
const FERNET = '31000000-0000-4000-8000-000000000003';
const CONTACT = { waId: '5492995550101', displayName: 'Vale QA' };

/**
 * Doble de prueba del comercio. Devuelve datos FIJOS: acá se prueba que la
 * conversación muestre lo que el backend dijo, no que calcule bien. Que el
 * cálculo real coincida con el cobro lo verifica el E2E contra PostgreSQL.
 */
function fakeBackend(overrides = {}) {
  const calls = [];
  const catalog = [
    { product_id: HEINEKEN, sku: 'heineken', name: 'Heineken Original', brand: 'Heineken', presentation: 'Lata · 473 ml', price: 2350, stock: 96, is_alcoholic: true, minimum_age: 18, category: 'Cervezas' },
    { product_id: COCA, sku: 'coca', name: 'Coca-Cola Original', brand: 'Coca-Cola', presentation: 'PET · 1500 ml', price: 3200, stock: 80, is_alcoholic: false, minimum_age: null, category: 'Gaseosas' },
    { product_id: FERNET, sku: 'fernet', name: 'Fernet Branca', brand: 'Fernet Branca', presentation: 'Botella · 750 ml', price: 12800, stock: 24, is_alcoholic: true, minimum_age: 18, category: 'Whisky y destilados' },
  ];
  const backend = {
    calls,
    async shelves() {
      calls.push(['shelves']);
      return [
        { shelf_id: 'combos', title: 'Combos', kind: 'combos', count: 1 },
        { shelf_id: 'cervezas', title: 'Cervezas', kind: 'category', count: 1 },
        { shelf_id: 'fernet', title: 'Fernet', kind: 'subcategory', count: 1 },
        { shelf_id: 'gaseosas', title: 'Gaseosas', kind: 'category', count: 1 },
      ];
    },
    async products({ shelfId = null, query = null, productIds = null } = {}) {
      calls.push(['products', { shelfId, query, productIds }]);
      let products = catalog;
      if (productIds) products = products.filter((product) => productIds.includes(product.product_id));
      if (query) {
        products = products.filter((product) => `${product.brand} ${product.name}`.toLowerCase().includes(query));
      }
      if (shelfId) products = products.filter((product) => product.category.toLowerCase().includes(shelfId.slice(0, 5)));
      return { shelf_id: shelfId, total: products.length, products };
    },
    async combos() {
      calls.push(['combos']);
      return {
        total: 1,
        combos: [{
          combo_id: 'combo-noche-larga',
          name: 'Noche larga',
          tagline: 'Cuatro Heineken y dos Red Bull',
          terms: 'Requiere validación de edad.',
          discount_percentage: 12,
          list_price: 13600,
          promotional_price: 11900,
          savings: 1700,
          contains_alcohol: true,
          minimum_age: 18,
          max_units: 24,
          components: [{ product_id: HEINEKEN, name: 'Heineken Original', presentation: 'Lata · 473 ml', quantity: 4 }],
        }],
      };
    },
    async quote({ cart, fulfillmentType }) {
      calls.push(['quote', { cart, fulfillmentType }]);
      return {
        ok: true,
        currency: 'ARS',
        fulfillment_type: fulfillmentType,
        lines: cart.map((line) => (line.product_id
          ? { kind: 'product', product_id: line.product_id, name: 'Coca-Cola Original', quantity: line.quantity, unit_price: 3200, subtotal: 3200 * line.quantity }
          : { kind: 'combo', combo_id: line.combo_id, name: 'Noche larga', quantity: line.quantity, subtotal: 11900 * line.quantity })),
        subtotal: 20000,
        discount_total: 1700,
        delivery_fee: 1500,
        total: 19800,
        contains_alcohol: true,
        minimum_age: 18,
        blockers: [],
      };
    },
    async saveDisplayName(name) {
      calls.push(['saveDisplayName', name]);
    },
    async startPayment(input) {
      calls.push(['startPayment', input]);
      return { ok: true, checkoutSessionId: 'sess-1', total: 19800, initPoint: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=X' };
    },
  };
  return Object.assign(backend, overrides);
}

function session(extra = {}) {
  return {
    state: 'browsing',
    cart: [],
    fulfillment_type: '',
    draft_address: {},
    age_confirmed: false,
    last_shelf: null,
    checkout_session_id: null,
    revision: 1,
    ...extra,
  };
}

function flatten(replies) {
  return replies.map((message) => {
    if (message.type === 'text') return message.text.body;
    const interactive = message.interactive;
    const rows = interactive.type === 'list'
      ? interactive.action.sections.flatMap((s) => s.rows.map((row) => `${row.id} ${row.title} ${row.description || ''}`))
      : interactive.action.buttons.map((button) => `${button.reply.id} ${button.reply.title}`);
    return [interactive.header?.text, interactive.body.text, interactive.footer?.text, ...rows].filter(Boolean).join('\n');
  }).join('\n---\n');
}

/* ===== Interpretación ===================================================== */

test('los saludos y las palabras de control se reconocen', () => {
  for (const text of ['HOLA', 'hola!', 'Buenas', 'buen día', 'menu', 'Volver']) {
    assert.equal(resolveIntent({ text }, session()).kind, 'menu', text);
  }
  assert.equal(resolveIntent({ text: 'carrito' }, session()).kind, 'cart');
  assert.equal(resolveIntent({ text: 'quiero finalizar' }, session()).kind, 'checkout');
  assert.equal(resolveIntent({ text: 'vaciar' }, session()).kind, 'clear');
  assert.equal(resolveIntent({ text: 'ayuda' }, session()).kind, 'help');
  assert.equal(resolveIntent({ text: 'retiro' }, session()).value, 'pickup');
  assert.equal(resolveIntent({ text: 'delivery' }, session()).value, 'delivery');
});

test('el texto libre se parte en términos y cantidad', () => {
  assert.deepEqual(resolveIntent({ text: 'quiero un fernet con coca' }, session()), {
    kind: 'search', terms: ['fernet', 'coca'], quantity: 1,
  });
  assert.deepEqual(resolveIntent({ text: 'dame dos heineken por favor' }, session()), {
    kind: 'search', terms: ['heineken'], quantity: 2,
  });
  assert.deepEqual(resolveIntent({ text: '6 coca cola' }, session()), {
    kind: 'search', terms: ['coca cola'], quantity: 6,
  });
  assert.equal(resolveIntent({ text: 'media docena de heineken' }, session()).quantity, 6);
  assert.deepEqual(resolveIntent({ text: 'fernet y coca y hielo' }, session()).terms, ['fernet', 'coca', 'hielo']);
});

test('quitar algo se entiende como quitar, no como buscar', () => {
  assert.deepEqual(resolveIntent({ text: 'sacar la coca' }, session()), { kind: 'remove_search', query: 'coca' });
});

test('mientras se junta la dirección el texto libre es la dirección', () => {
  const state = session({ state: 'awaiting_address' });
  assert.deepEqual(resolveIntent({ text: 'San Martín 1234' }, state), { kind: 'address_text', value: 'San Martín 1234' });
  // Salvo que sea una palabra de control: nadie queda encerrado en un paso.
  assert.equal(resolveIntent({ text: 'menu' }, state).kind, 'menu');
  assert.equal(resolveIntent({ text: 'cancelar' }, state).kind, 'clear');
});

test('la confirmación de edad sólo cuenta cuando se está preguntando', () => {
  assert.equal(resolveIntent({ text: 'si' }, session({ state: 'awaiting_age' })).kind, 'age');
  assert.equal(resolveIntent({ text: 'si' }, session({ state: 'awaiting_age' })).value, true);
  assert.equal(resolveIntent({ text: 'no' }, session({ state: 'awaiting_age' })).value, false);
  assert.notEqual(resolveIntent({ text: 'si' }, session()).kind, 'age');
});

test('las referencias de los botones y listas se decodifican', () => {
  assert.deepEqual(resolveIntent({ replyId: 'shelf:combos' }), { kind: 'shelf', shelfId: 'combos' });
  assert.deepEqual(resolveIntent({ replyId: `p:${COCA}` }), { kind: 'product', productId: COCA });
  assert.deepEqual(resolveIntent({ replyId: `add:p:${COCA}:2` }), { kind: 'add', productId: COCA, quantity: 2 });
  assert.deepEqual(resolveIntent({ replyId: 'add:c:combo-noche-larga:1' }), { kind: 'add', comboId: 'combo-noche-larga', quantity: 1 });
  assert.deepEqual(resolveIntent({ replyId: 'act:pay' }), { kind: 'pay' });
  assert.deepEqual(resolveIntent({ replyId: 'act:desconocido' }), { kind: 'help' });
});

test('una ubicación gana sobre cualquier otra lectura', () => {
  const intent = resolveIntent({ text: 'hola', location: { latitude: -38.9, longitude: -68.1 } }, session());
  assert.equal(intent.kind, 'location');
});

/* ===== Carrito ============================================================ */

test('sumar el mismo producto acumula en una sola línea', () => {
  let cart = cartWith([], { product_id: COCA }, 2);
  cart = cartWith(cart, { product_id: COCA }, 3);
  assert.deepEqual(cart, [{ product_id: COCA, quantity: 5 }]);
});

test('el carrito no admite cantidades absurdas ni líneas infinitas', () => {
  assert.equal(cartWith([], { product_id: COCA }, 9999)[0].quantity, 24);
  assert.equal(cartWith([], { product_id: COCA }, 0)[0].quantity, 1);
  let cart = [];
  for (let index = 0; index < 40; index += 1) {
    cart = cartWith(cart, { combo_id: `combo-${index}` }, 1);
  }
  assert.equal(cart.length, 20);
});

test('un combo y un producto con el mismo texto no se confunden', () => {
  const cart = cartWith(cartWith([], { product_id: COCA }, 1), { combo_id: COCA }, 1);
  assert.equal(cart.length, 2);
  assert.deepEqual(cartWithout(cart, { combo_id: COCA }), [{ product_id: COCA, quantity: 1 }]);
});

test('el carrito normalizado descarta cualquier campo que no sea identificador o cantidad', () => {
  const cart = normalizeCart([
    { product_id: COCA, quantity: 2, unit_price: 3200, subtotal: 6400 },
    { combo_id: 'combo-noche-larga', quantity: 1, promotional_price: 11900 },
    { nada: true },
  ]);
  assert.deepEqual(cart, [
    { product_id: COCA, quantity: 2 },
    { combo_id: 'combo-noche-larga', quantity: 1 },
  ]);
});

/* ===== Direcciones ======================================================== */

test('la dirección se lee sólo cuando hay calle y número', () => {
  assert.deepEqual(parseAddress('San Martín 1234, Neuquén'), {
    street: 'San Martín', streetNumber: '1234', city: 'Neuquén',
  });
  assert.deepEqual(parseAddress('Av. Argentina 500'), { street: 'Av. Argentina', streetNumber: '500', city: '' });
  // Sin número no se inventa: el flujo vuelve a preguntar.
  assert.equal(parseAddress('por el centro').street, undefined);
  assert.deepEqual(parseAddress(''), {});
});

/* ===== Respuestas ========================================================= */

test('el menú ofrece los estantes que el backend declara, y sólo esos', async () => {
  const backend = fakeBackend();
  const { replies } = await respond({ intent: { kind: 'menu' }, session: session(), contact: CONTACT, backend });
  const rendered = flatten(replies);
  for (const shelf of ['Combos', 'Cervezas', 'Fernet', 'Gaseosas']) {
    assert.match(rendered, new RegExp(shelf));
  }
  assert.doesNotMatch(rendered, /Vinos/);
});

test('una búsqueda propone pero no agrega nada al carrito', async () => {
  const backend = fakeBackend();
  const { replies, session: next } = await respond({
    intent: { kind: 'search', terms: ['fernet', 'coca'], quantity: 1 },
    session: session(),
    contact: CONTACT,
    backend,
  });
  assert.deepEqual(next.cart, []);
  const rendered = flatten(replies);
  assert.match(rendered, /Fernet Branca/);
  assert.match(rendered, /Coca-Cola/);
});

test('agregar valida primero contra el catálogo vivo', async () => {
  const backend = fakeBackend({
    products: async () => ({ shelf_id: null, total: 0, products: [] }),
  });
  const { replies, session: next } = await respond({
    intent: { kind: 'add', productId: COCA, quantity: 2 },
    session: session(),
    contact: CONTACT,
    backend,
  });
  assert.deepEqual(next.cart, []);
  assert.match(flatten(replies), /ya no está disponible/i);
});

test('sin stock el agregado se rechaza entero y el carrito no cambia', async () => {
  const previous = [{ product_id: COCA, quantity: 1 }];
  const backend = fakeBackend({
    quote: async ({ cart }) => (cart.length && cart[0].quantity > 1
      ? { ok: false, lines: [], subtotal: 0, discount_total: 0, delivery_fee: 0, total: 0, blockers: [{ code: 'INSUFFICIENT_STOCK', name: 'Coca-Cola Original', available: 1 }] }
      : { ok: true, lines: [{ kind: 'product', name: 'Coca-Cola Original', quantity: 1, subtotal: 3200 }], subtotal: 3200, discount_total: 0, delivery_fee: 1500, total: 4700, blockers: [] }),
  });
  const { replies, session: next } = await respond({
    intent: { kind: 'add', productId: COCA, quantity: 5 },
    session: session({ cart: previous }),
    contact: CONTACT,
    backend,
  });
  assert.deepEqual(next.cart, previous);
  assert.match(flatten(replies), /quedan 1/i);
});

test('el carrito muestra exactamente los números que dio el backend', async () => {
  const backend = fakeBackend();
  const { replies } = await respond({
    intent: { kind: 'cart' },
    session: session({ cart: [{ combo_id: 'combo-noche-larga', quantity: 1 }], fulfillment_type: 'delivery' }),
    contact: CONTACT,
    backend,
  });
  const rendered = flatten(replies);
  assert.match(rendered, /Subtotal \$ 20\.000/);
  assert.match(rendered, /Descuento combos −\$ 1\.700/);
  assert.match(rendered, /Envío \$ 1\.500/);
  assert.match(rendered, /Total \$ 19\.800/);
});

test('el checkout pide una cosa por vez y en orden', async () => {
  const backend = fakeBackend();
  const cart = [{ combo_id: 'combo-noche-larga', quantity: 1 }];

  const modalidad = await respond({ intent: { kind: 'checkout' }, session: session({ cart }), contact: CONTACT, backend });
  assert.match(flatten(modalidad.replies), /Cómo lo querés/);

  const nombre = await respond({
    intent: { kind: 'checkout' },
    session: session({ cart, fulfillment_type: 'delivery' }),
    contact: { waId: CONTACT.waId, displayName: '' },
    backend,
  });
  assert.equal(nombre.session.state, 'awaiting_name');

  const direccion = await respond({
    intent: { kind: 'checkout' },
    session: session({ cart, fulfillment_type: 'delivery' }),
    contact: CONTACT,
    backend,
  });
  assert.equal(direccion.session.state, 'awaiting_address');

  const ciudad = await respond({
    intent: { kind: 'checkout' },
    session: session({ cart, fulfillment_type: 'delivery', draft_address: { street: 'San Martín', street_number: '1234' } }),
    contact: CONTACT,
    backend,
  });
  assert.match(flatten(ciudad.replies), /ciudad|localidad/i);

  const edad = await respond({
    intent: { kind: 'checkout' },
    session: session({ cart, fulfillment_type: 'delivery', draft_address: { street: 'San Martín', street_number: '1234', city: 'Neuquén' } }),
    contact: CONTACT,
    backend,
  });
  assert.equal(edad.session.state, 'awaiting_age');
  assert.match(flatten(edad.replies), /mayor de 18/);
});

test('decir que no a la mayoría de edad no cobra nada', async () => {
  const backend = fakeBackend();
  const { replies, session: next } = await respond({
    intent: { kind: 'age', value: false },
    session: session({ cart: [{ combo_id: 'combo-noche-larga', quantity: 1 }], fulfillment_type: 'pickup' }),
    contact: CONTACT,
    backend,
  });
  assert.equal(next.state, 'cart');
  assert.match(flatten(replies), /no podemos vender alcohol/i);
  assert.equal(backend.calls.some((call) => call[0] === 'startPayment'), false);
});

test('la ubicación de WhatsApp se guarda como punto con origen declarado', async () => {
  const backend = fakeBackend();
  const { session: next } = await respond({
    intent: { kind: 'location', location: { latitude: -38.95394321, longitude: -68.05961234, reference: 'Casa' } },
    session: session({ state: 'browsing' }),
    contact: CONTACT,
    backend,
  });
  assert.equal(next.draft_address.latitude, -38.953943);
  assert.equal(next.draft_address.longitude, -68.059612);
  assert.equal(next.draft_address.source, 'gps');
});

test('pagar delega en el backend y muestra su enlace, sin fabricar totales', async () => {
  const backend = fakeBackend();
  const { replies, session: next } = await respond({
    intent: { kind: 'pay' },
    session: session({
      cart: [{ combo_id: 'combo-noche-larga', quantity: 1 }],
      fulfillment_type: 'delivery',
      draft_address: { street: 'San Martín', street_number: '1234', city: 'Neuquén' },
      age_confirmed: true,
    }),
    contact: CONTACT,
    backend,
  });
  const rendered = flatten(replies);
  assert.match(rendered, /mercadopago\.com\.ar\/checkout/);
  assert.match(rendered, /\$ 19\.800/);
  assert.equal(next.state, 'awaiting_payment');
  assert.equal(next.checkout_session_id, 'sess-1');
  const payment = backend.calls.find((call) => call[0] === 'startPayment')[1];
  assert.deepEqual(Object.keys(payment).sort(), ['address', 'ageConfirmed', 'cart', 'contactName', 'fulfillmentType']);
});

test('si el backend no puede preparar el pago, el chat no promete un enlace', async () => {
  const backend = fakeBackend({
    startPayment: async () => ({ ok: false, message: 'No llegamos al mínimo de envío.' }),
  });
  const { replies, session: next } = await respond({
    intent: { kind: 'pay' },
    session: session({ cart: [{ product_id: COCA, quantity: 1 }], fulfillment_type: 'delivery', age_confirmed: true }),
    contact: CONTACT,
    backend,
  });
  assert.equal(next.state, 'cart');
  assert.match(flatten(replies), /mínimo de envío/);
  assert.doesNotMatch(flatten(replies), /https:/);
});
