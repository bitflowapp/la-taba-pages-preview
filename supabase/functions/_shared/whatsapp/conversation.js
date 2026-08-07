/**
 * La conversación de compra.
 *
 * REGLA QUE ORDENA TODO ESTE ARCHIVO
 * ----------------------------------
 * Acá no se decide NI UN precio, NI UN descuento, NI UN total, NI si hay stock,
 * NI qué SKU es el correcto. Todo eso se le pregunta al backend y se muestra tal
 * como vino. Este módulo entiende lo que la persona quiso decir y elige qué
 * pantalla mostrarle; el comercio sigue estando del otro lado.
 *
 * Concretamente: el carrito de la conversación es una lista de identificadores
 * con cantidades. Cada vez que hay que mostrar plata se llama a `quote`, que lee
 * los renglones vivos. Y el cobro no sale de ninguna de esas lecturas: sale de
 * `create_checkout_session`, que vuelve a validar todo con los renglones
 * bloqueados y es la misma función que usa la web.
 *
 * ENTENDIMIENTO LIBRE
 * -------------------
 * «quiero un fernet con coca» se resuelve partiendo la frase en términos y
 * buscando cada uno EN EL CATÁLOGO. Si hay varios candidatos se muestran para
 * elegir; si hay uno solo se muestra igual, con su precio, y se agrega recién
 * cuando la persona lo toca. Interpretar no es decidir.
 */

import { buttonsMessage, listMessage, money, textMessage } from './messages.js';

const MAX_CART_LINES = 20;
const MAX_UNITS_PER_LINE = 24;
const PAGE_SIZE = 8;

const NUMBER_WORDS = new Map([
  ['un', 1], ['una', 1], ['uno', 1], ['dos', 2], ['tres', 3], ['cuatro', 4], ['cinco', 5],
  ['seis', 6], ['siete', 7], ['ocho', 8], ['nueve', 9], ['diez', 10], ['once', 11], ['doce', 12],
  ['media docena', 6], ['medias docenas', 6], ['una docena', 12], ['docena', 12],
]);

// Palabras que no describen un producto. Sacarlas antes de buscar es lo que
// convierte «dame dos fernet por favor» en la búsqueda «fernet».
const STOPWORDS = new Set([
  'quiero', 'querria', 'queria', 'dame', 'damelo', 'mandame', 'mandate', 'traeme', 'necesito',
  'busco', 'agregar', 'agrega', 'agregame', 'sumame', 'sumar', 'poneme', 'pone', 'ponme',
  'por', 'favor', 'porfa', 'porfis', 'gracias', 'hola', 'buenas', 'che', 'el', 'la', 'los',
  'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'y', 'con', 'mas', 'para', 'me',
  'tenes', 'tienen', 'hay', 'algo', 'ver', 'quisiera',
]);

const SPLIT_TERMS = /\s+(?:y|con|mas|\+|,|\/)\s+/g;

export const ACTIONS = Object.freeze({
  MENU: 'act:menu',
  CART: 'act:cart',
  CLEAR: 'act:clear',
  CHECKOUT: 'act:checkout',
  PAY: 'act:pay',
  DELIVERY: 'act:delivery',
  PICKUP: 'act:pickup',
  AGE_YES: 'act:age_yes',
  AGE_NO: 'act:age_no',
  HELP: 'act:help',
});

/* ========================================================================== */
/*  Interpretación                                                            */
/* ========================================================================== */

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s+,/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @returns {{kind: string, [key: string]: unknown}}
 */
export function resolveIntent(event, session = {}) {
  if (event?.location) return { kind: 'location', location: event.location };

  const reference = String(event?.replyId || '').trim();
  if (reference) return intentFromReference(reference);

  const raw = String(event?.text || '').trim();
  const normalized = normalizeText(raw);
  if (!normalized) return { kind: 'help' };

  // Mientras se junta la dirección, el texto libre ES la dirección. Interpretarlo
  // como una búsqueda haría que «San Martín 1234» devolviera vinos.
  if (session.state === 'awaiting_address' && !isControlWord(normalized)) {
    return { kind: 'address_text', value: raw };
  }
  if (session.state === 'awaiting_name' && !isControlWord(normalized)) {
    return { kind: 'name_text', value: raw };
  }

  if (/^(hola|buenas|buen dia|buenas tardes|buenas noches|hey|holis|start|empezar|menu|inicio|volver)\b/.test(normalized)) {
    return { kind: 'menu' };
  }
  if (/\b(ayuda|help|no entiendo|como funciona)\b/.test(normalized)) return { kind: 'help' };
  if (/\b(carrito|mi pedido|que llevo|que tengo)\b/.test(normalized)) return { kind: 'cart' };
  if (/\b(vaciar|vacia|borrar todo|empezar de nuevo|cancelar|cancela)\b/.test(normalized)) return { kind: 'clear' };
  if (/\b(finalizar|terminar|pagar|checkout|comprar ya|listo|confirmar)\b/.test(normalized)) return { kind: 'checkout' };
  if (/\b(delivery|envio|domicilio|mandamelo|entrega)\b/.test(normalized)) return { kind: 'fulfillment', value: 'delivery' };
  if (/\b(retiro|retirar|pickup|paso a buscar|lo busco)\b/.test(normalized)) return { kind: 'fulfillment', value: 'pickup' };

  const removal = normalized.match(/^(?:quitar|sacar|eliminar|borrar)\s+(.+)$/);
  if (removal) return { kind: 'remove_search', query: cleanQuery(removal[1]) };

  if (session.state === 'awaiting_age') {
    if (/^(si|sip|dale|confirmo|soy mayor|claro|obvio)\b/.test(normalized)) return { kind: 'age', value: true };
    if (/^(no|nop|menor)\b/.test(normalized)) return { kind: 'age', value: false };
  }

  const { quantity, rest } = extractQuantity(normalized);
  const terms = splitTerms(rest);
  if (!terms.length) return { kind: 'help' };
  return { kind: 'search', terms, quantity };
}

function isControlWord(normalized) {
  return /^(menu|inicio|volver|carrito|cancelar|ayuda|help|vaciar)\b/.test(normalized);
}

function intentFromReference(reference) {
  if (reference.startsWith('shelf:')) return { kind: 'shelf', shelfId: reference.slice(6) };
  if (reference.startsWith('page:')) {
    const [, shelfId, offset] = reference.split(':');
    return { kind: 'shelf', shelfId, offset: Number(offset) || 0 };
  }
  if (reference.startsWith('p:')) return { kind: 'product', productId: reference.slice(2) };
  if (reference.startsWith('c:')) return { kind: 'combo', comboId: reference.slice(2) };
  if (reference.startsWith('add:p:')) {
    const [, , productId, quantity] = reference.split(':');
    return { kind: 'add', productId, quantity: clampQuantity(quantity) };
  }
  if (reference.startsWith('add:c:')) {
    const [, , comboId, quantity] = reference.split(':');
    return { kind: 'add', comboId, quantity: clampQuantity(quantity) };
  }
  if (reference.startsWith('del:p:')) return { kind: 'remove', productId: reference.slice(6) };
  if (reference.startsWith('del:c:')) return { kind: 'remove', comboId: reference.slice(6) };
  switch (reference) {
    case ACTIONS.MENU: return { kind: 'menu' };
    case ACTIONS.CART: return { kind: 'cart' };
    case ACTIONS.CLEAR: return { kind: 'clear' };
    case ACTIONS.CHECKOUT: return { kind: 'checkout' };
    case ACTIONS.PAY: return { kind: 'pay' };
    case ACTIONS.DELIVERY: return { kind: 'fulfillment', value: 'delivery' };
    case ACTIONS.PICKUP: return { kind: 'fulfillment', value: 'pickup' };
    case ACTIONS.AGE_YES: return { kind: 'age', value: true };
    case ACTIONS.AGE_NO: return { kind: 'age', value: false };
    default: return { kind: 'help' };
  }
}

function extractQuantity(normalized) {
  const docena = normalized.match(/\b(media docena|una docena|docena)\b/);
  if (docena) {
    return {
      quantity: NUMBER_WORDS.get(docena[1]) || 12,
      rest: normalized.replace(docena[0], ' ').trim(),
    };
  }
  const digitMatch = normalized.match(/(?:^|\s)(\d{1,2})\s*(?:x\s*)?(?=\D|$)/);
  if (digitMatch) {
    return {
      quantity: clampQuantity(digitMatch[1]),
      rest: normalized.replace(digitMatch[0], ' ').trim(),
    };
  }
  const words = normalized.split(' ');
  for (let index = 0; index < words.length; index += 1) {
    if (NUMBER_WORDS.has(words[index]) && index + 1 < words.length) {
      const quantity = NUMBER_WORDS.get(words[index]);
      // «un» y «una» son artículos tanto como números: sólo cuentan como
      // cantidad si no hay otra pista, y valen 1 igual, así que no cambian nada.
      words.splice(index, 1);
      return { quantity, rest: words.join(' ').trim() };
    }
  }
  return { quantity: 1, rest: normalized };
}

function splitTerms(value) {
  return String(value || '')
    .split(SPLIT_TERMS)
    .map((term) => cleanQuery(term))
    .filter(Boolean)
    .slice(0, 3);
}

function cleanQuery(value) {
  return normalizeText(value)
    .split(' ')
    .filter((word) => word && !STOPWORDS.has(word))
    .join(' ')
    .trim();
}

function clampQuantity(value) {
  const parsed = Math.floor(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, MAX_UNITS_PER_LINE);
}

/* ========================================================================== */
/*  Carrito (identificadores y cantidades, nunca precios)                     */
/* ========================================================================== */

export function cartWith(cart, line, quantity) {
  const lines = normalizeCart(cart);
  const key = lineKey(line);
  const existing = lines.find((item) => lineKey(item) === key);
  if (existing) {
    existing.quantity = clampQuantity(existing.quantity + quantity);
    return lines;
  }
  if (lines.length >= MAX_CART_LINES) return lines;
  lines.push({ ...line, quantity: clampQuantity(quantity) });
  return lines;
}

export function cartWithout(cart, line) {
  const key = lineKey(line);
  return normalizeCart(cart).filter((item) => lineKey(item) !== key);
}

export function normalizeCart(cart) {
  return (Array.isArray(cart) ? cart : [])
    .map((item) => {
      if (item?.product_id) return { product_id: String(item.product_id), quantity: clampQuantity(item.quantity) };
      if (item?.combo_id) return { combo_id: String(item.combo_id), quantity: clampQuantity(item.quantity) };
      return null;
    })
    .filter(Boolean);
}

function lineKey(line) {
  return line?.product_id ? `p:${line.product_id}` : `c:${line.combo_id}`;
}

/* ========================================================================== */
/*  Respuestas                                                                */
/* ========================================================================== */

/**
 * @param {object} input
 * @param {object} input.intent
 * @param {object} input.session estado guardado de la conversación
 * @param {object} input.contact { waId, displayName }
 * @param {object} input.backend puerto de lectura/escritura contra el comercio
 * @returns {Promise<{ session: object, replies: Array<object> }>}
 */
export async function respond({ intent, session, contact, backend }) {
  const state = { ...session, cart: normalizeCart(session.cart) };
  const waId = contact.waId;

  switch (intent.kind) {
    case 'menu':
      return showMenu({ state, waId, backend, greet: true });
    case 'help':
      return showHelp({ state, waId, backend });
    case 'shelf':
      return showShelf({ state, waId, backend, shelfId: intent.shelfId, offset: intent.offset || 0 });
    case 'search':
      return showSearch({ state, waId, backend, terms: intent.terms, quantity: intent.quantity });
    case 'product':
      return showProduct({ state, waId, backend, productId: intent.productId });
    case 'combo':
      return showCombo({ state, waId, backend, comboId: intent.comboId });
    case 'add':
      return addToCart({ state, waId, backend, intent });
    case 'remove':
      return removeFromCart({ state, waId, backend, intent });
    case 'remove_search':
      return removeBySearch({ state, waId, backend, query: intent.query });
    case 'cart':
      return showCart({ state, waId, backend });
    case 'clear':
      return clearCart({ state, waId, backend });
    case 'checkout':
      return advanceCheckout({ state, waId, backend, contact });
    case 'fulfillment':
      return setFulfillment({ state, waId, backend, contact, value: intent.value });
    case 'address_text':
      return captureAddressText({ state, waId, backend, contact, value: intent.value });
    case 'location':
      return captureLocation({ state, waId, backend, contact, location: intent.location });
    case 'name_text':
      return captureName({ state, waId, backend, contact, value: intent.value });
    case 'age':
      return confirmAge({ state, waId, backend, contact, value: intent.value });
    case 'pay':
      return pay({ state, waId, backend, contact });
    default:
      return showHelp({ state, waId, backend });
  }
}

async function showMenu({ state, waId, backend, greet = false }) {
  const shelves = await backend.shelves();
  if (!shelves.length) {
    return reply(state, [textMessage(waId, 'Ahora mismo no tenemos nada publicado para vender. Escribinos en un rato 🙏')]);
  }
  const sections = [{
    title: 'Categorías',
    rows: shelves.slice(0, 9).map((shelf) => ({
      id: `shelf:${shelf.shelf_id}`,
      title: shelf.title,
      description: `${shelf.count} ${shelf.count === 1 ? 'opción' : 'opciones'}`,
    })),
  }];
  const cartCount = state.cart.length;
  if (cartCount) {
    sections.push({ title: 'Tu pedido', rows: [{ id: ACTIONS.CART, title: 'Ver carrito', description: `${cartCount} ${cartCount === 1 ? 'línea' : 'líneas'}` }] });
  }
  const body = greet
    ? '¡Hola! Somos TABA2 🍻\nElegí una categoría o escribime lo que buscás (por ejemplo: «un fernet con coca»).'
    : 'Elegí una categoría o escribime lo que buscás.';
  return reply({ ...state, state: 'browsing' }, [
    listMessage(waId, { header: 'TABA2', body, footer: 'Precios y stock en vivo', button: 'Ver categorías', sections }),
  ]);
}

async function showHelp({ state, waId, backend }) {
  const shelves = await backend.shelves();
  const names = shelves.slice(0, 4).map((shelf) => shelf.title).join(', ');
  return reply(state, [
    textMessage(waId, [
      'Te ayudo así 👇',
      '• Escribí lo que buscás: «dos heineken», «fernet con coca».',
      names ? `• O pedime una categoría: ${names}.` : '',
      '• «carrito» para ver lo que llevás.',
      '• «finalizar» para pagar con Mercado Pago.',
      '• «menu» para volver al principio.',
    ].filter(Boolean).join('\n')),
  ]);
}

async function showShelf({ state, waId, backend, shelfId, offset = 0 }) {
  if (shelfId === 'combos') {
    const { combos } = await backend.combos({ limit: PAGE_SIZE, offset });
    if (!combos.length) return showMenu({ state, waId, backend });
    const rows = combos.map((combo) => ({
      id: `c:${combo.combo_id}`,
      title: combo.name,
      description: `${money(combo.promotional_price)} · ahorrás ${money(combo.savings)}`,
    }));
    return reply({ ...state, state: 'browsing', last_shelf: 'combos' }, [
      listMessage(waId, {
        header: 'Combos',
        body: 'Estos son los combos aprobados que podemos armar hoy con lo que hay en stock.',
        footer: 'Precio armado con el catálogo vivo',
        button: 'Ver combos',
        sections: [{ title: 'Combos', rows }],
      }),
    ]);
  }

  const { products, total, shelf_id: resolvedShelf } = await backend.products({ shelfId, limit: PAGE_SIZE, offset });
  if (!products.length) return showMenu({ state, waId, backend });
  const sections = [{ title: 'Productos', rows: products.map(productRow) }];
  const nextOffset = offset + products.length;
  if (nextOffset < total) {
    sections.push({ title: 'Más', rows: [{ id: `page:${shelfId}:${nextOffset}`, title: 'Ver más', description: `Quedan ${total - nextOffset}` }] });
  }
  return reply({ ...state, state: 'browsing', last_shelf: resolvedShelf || shelfId }, [
    listMessage(waId, {
      body: 'Tocá lo que quieras agregar.',
      footer: 'Precio y stock en vivo',
      button: 'Ver productos',
      sections,
    }),
  ]);
}

async function showSearch({ state, waId, backend, terms, quantity }) {
  const sections = [];
  let found = 0;
  for (const term of terms) {
    const { products } = await backend.products({ query: term, limit: terms.length > 1 ? 3 : PAGE_SIZE });
    if (!products.length) continue;
    found += products.length;
    sections.push({
      title: term.slice(0, 24),
      rows: products.map((product) => productRow(product, quantity)),
    });
  }
  if (!found) {
    const shelves = await backend.shelves();
    return reply(state, [
      listMessage(waId, {
        body: `No encontré «${terms.join(' y ')}» en el catálogo de hoy. Probá con otra cosa o mirá las categorías.`,
        button: 'Ver categorías',
        sections: [{
          title: 'Categorías',
          rows: shelves.slice(0, 9).map((shelf) => ({ id: `shelf:${shelf.shelf_id}`, title: shelf.title })),
        }],
      }),
    ]);
  }
  return reply({ ...state, state: 'browsing' }, [
    listMessage(waId, {
      body: terms.length > 1
        ? 'Encontré esto. Tocá uno por vez para agregarlo.'
        : 'Encontré esto:',
      footer: 'Precio y stock en vivo',
      button: 'Elegir',
      sections,
    }),
  ]);
}

function productRow(product, quantity = 1) {
  const units = quantity > 1 ? `${quantity} × ` : '';
  return {
    id: quantity > 1 ? `add:p:${product.product_id}:${quantity}` : `p:${product.product_id}`,
    title: [product.brand, product.name].filter(Boolean).join(' ') || product.name,
    description: `${units}${money(product.price)} · ${product.presentation || ''}`.trim(),
  };
}

async function showProduct({ state, waId, backend, productId }) {
  const { products } = await backend.products({ productIds: [productId], limit: 1 });
  const product = products[0];
  if (!product) {
    return reply(state, [textMessage(waId, 'Ese producto ya no está disponible. Escribí «menu» para ver lo que sí hay.')]);
  }
  const lines = [
    `*${[product.brand, product.name].filter(Boolean).join(' ')}*`,
    product.presentation ? product.presentation : '',
    `${money(product.price)} por unidad`,
    product.stock <= 5 ? `Quedan ${product.stock}` : '',
    product.is_alcoholic ? `Venta exclusiva a mayores de ${product.minimum_age || 18} años` : '',
  ].filter(Boolean);
  return reply({ ...state, state: 'browsing' }, [
    buttonsMessage(waId, {
      body: lines.join('\n'),
      buttons: [
        { id: `add:p:${product.product_id}:1`, title: 'Agregar 1' },
        { id: `add:p:${product.product_id}:6`, title: 'Agregar 6' },
        { id: ACTIONS.CART, title: 'Ver carrito' },
      ],
    }),
  ]);
}

async function showCombo({ state, waId, backend, comboId }) {
  const { combos } = await backend.combos({ limit: 30 });
  const combo = combos.find((item) => item.combo_id === comboId);
  if (!combo) {
    return reply(state, [textMessage(waId, 'Ese combo ya no está disponible. Escribí «menu» para ver lo que sí hay.')]);
  }
  const components = (combo.components || [])
    .map((component) => `• ${component.quantity} × ${component.name}${component.presentation ? ` (${component.presentation})` : ''}`)
    .join('\n');
  const lines = [
    `*${combo.name}*`,
    combo.tagline || '',
    components,
    `Precio de lista ${money(combo.list_price)}`,
    `*${money(combo.promotional_price)}* · ahorrás ${money(combo.savings)}`,
    combo.contains_alcohol ? `Venta exclusiva a mayores de ${combo.minimum_age || 18} años` : '',
    combo.terms || '',
  ].filter(Boolean);
  return reply({ ...state, state: 'browsing' }, [
    buttonsMessage(waId, {
      body: lines.join('\n'),
      buttons: [
        { id: `add:c:${combo.combo_id}:1`, title: 'Agregar combo' },
        { id: 'shelf:combos', title: 'Ver otros combos' },
        { id: ACTIONS.CART, title: 'Ver carrito' },
      ],
    }),
  ]);
}

async function addToCart({ state, waId, backend, intent }) {
  const line = intent.productId ? { product_id: intent.productId } : { combo_id: intent.comboId };
  // Antes de tocar el carrito se confirma que lo pedido existe y es comprable
  // HOY. Un identificador de un mensaje viejo no puede volver a entrar.
  const exists = intent.productId
    ? (await backend.products({ productIds: [intent.productId], limit: 1 })).products.length > 0
    : (await backend.combos({ limit: 30 })).combos.some((combo) => combo.combo_id === intent.comboId);
  if (!exists) {
    return reply(state, [textMessage(waId, 'Eso ya no está disponible. Escribí «menu» para ver el catálogo de ahora.')]);
  }

  const candidate = cartWith(state.cart, line, intent.quantity || 1);
  const quote = await backend.quote({ cart: candidate, fulfillmentType: state.fulfillment_type || 'delivery' });
  const stockBlocker = (quote.blockers || []).find((blocker) => blocker.code === 'INSUFFICIENT_STOCK');
  if (stockBlocker) {
    // Se rechaza el agregado entero y se deja el carrito como estaba: prometer
    // una cantidad que el mostrador no puede armar es peor que decir que no.
    const previous = await backend.quote({ cart: state.cart, fulfillmentType: state.fulfillment_type || 'delivery' });
    return reply(state, [
      textMessage(waId, `No llego con el stock de *${stockBlocker.name || 'ese producto'}*: quedan ${stockBlocker.available}. Probá con menos unidades.`),
      ...cartMessages(waId, state, previous),
    ]);
  }
  const next = { ...state, cart: candidate, state: 'cart' };
  return reply(next, cartMessages(waId, next, quote, 'Agregado 👍'));
}

async function removeFromCart({ state, waId, backend, intent }) {
  const line = intent.productId ? { product_id: intent.productId } : { combo_id: intent.comboId };
  const next = { ...state, cart: cartWithout(state.cart, line) };
  const quote = await backend.quote({ cart: next.cart, fulfillmentType: next.fulfillment_type || 'delivery' });
  return reply({ ...next, state: next.cart.length ? 'cart' : 'browsing' }, cartMessages(waId, next, quote, 'Lo saqué.'));
}

async function removeBySearch({ state, waId, backend, query }) {
  const quote = await backend.quote({ cart: state.cart, fulfillmentType: state.fulfillment_type || 'delivery' });
  const normalized = normalizeText(query);
  const target = (quote.lines || []).find((line) => normalizeText(line.name).includes(normalized));
  if (!target) {
    return reply(state, [
      textMessage(waId, `No encontré «${query}» en tu carrito.`),
      ...cartMessages(waId, state, quote),
    ]);
  }
  return removeFromCart({
    state,
    waId,
    backend,
    intent: target.kind === 'combo' ? { comboId: target.combo_id } : { productId: target.product_id },
  });
}

async function showCart({ state, waId, backend }) {
  const quote = await backend.quote({ cart: state.cart, fulfillmentType: state.fulfillment_type || 'delivery' });
  return reply({ ...state, state: state.cart.length ? 'cart' : 'browsing' }, cartMessages(waId, state, quote));
}

async function clearCart({ state, waId, backend }) {
  const next = { ...state, cart: [], state: 'browsing', checkout_session_id: null };
  return reply(next, [textMessage(waId, 'Listo, vaciamos el carrito.'), ...(await showMenu({ state: next, waId, backend })).replies]);
}

function cartMessages(waId, state, quote, prefix = '') {
  if (!state.cart.length || !(quote.lines || []).length) {
    return [buttonsMessage(waId, {
      body: 'Tu carrito está vacío.',
      buttons: [{ id: ACTIONS.MENU, title: 'Ver catálogo' }],
    })];
  }
  const lines = quote.lines.map((line) => {
    if (line.kind === 'combo') {
      return `• ${line.quantity} × ${line.name} — ${money(line.subtotal)}`;
    }
    return `• ${line.quantity} × ${line.name} — ${money(line.subtotal)}`;
  });
  const totals = [
    `Subtotal ${money(quote.subtotal)}`,
    Number(quote.discount_total) > 0 ? `Descuento combos −${money(quote.discount_total)}` : '',
    quote.fulfillment_type === 'delivery' ? `Envío ${money(quote.delivery_fee)}` : 'Retirás por el local',
    `*Total ${money(quote.total)}*`,
  ].filter(Boolean);
  const warnings = (quote.blockers || []).map(blockerText).filter(Boolean);

  return [buttonsMessage(waId, {
    header: prefix || 'Tu pedido',
    body: [prefix ? 'Tu pedido:' : '', ...lines, '', ...totals, warnings.length ? `\n⚠️ ${warnings.join('\n⚠️ ')}` : '']
      .filter((part) => part !== '')
      .join('\n'),
    footer: 'Precios del catálogo vivo',
    buttons: [
      { id: ACTIONS.CHECKOUT, title: 'Finalizar compra' },
      { id: ACTIONS.MENU, title: 'Seguir comprando' },
      { id: ACTIONS.CLEAR, title: 'Vaciar' },
    ],
  })];
}

function blockerText(blocker) {
  switch (blocker.code) {
    case 'BELOW_DELIVERY_MINIMUM':
      return `Para envío falta ${money(blocker.missing)} (mínimo ${money(blocker.minimum)}).`;
    case 'INSUFFICIENT_STOCK':
      return `${blocker.name || 'Un producto'}: quedan ${blocker.available}.`;
    case 'ALCOHOL_OUTSIDE_HOURS':
      return 'Ahora no podemos vender alcohol por horario.';
    case 'ALCOHOL_NOT_ENABLED':
      return 'Hoy no estamos vendiendo alcohol.';
    case 'PRODUCT_UNAVAILABLE':
    case 'COMBO_UNAVAILABLE':
      return 'Sacamos algo que dejó de estar disponible.';
    case 'FULFILLMENT_UNAVAILABLE':
      return 'Esa modalidad de entrega no está habilitada.';
    case 'DELIVERY_NOT_CONFIGURED':
      return 'El envío no está configurado.';
    case 'PAYMENTS_UNAVAILABLE':
      return 'El pago online no está disponible en este momento.';
    default:
      return '';
  }
}

/* ========================================================================== */
/*  Checkout                                                                  */
/* ========================================================================== */

async function setFulfillment({ state, waId, backend, contact, value }) {
  const next = { ...state, fulfillment_type: value };
  return advanceCheckout({ state: next, waId, backend, contact });
}

async function captureName({ state, waId, backend, contact, value }) {
  const name = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (name.length < 2 || !/[a-záéíóúñ]/i.test(name)) {
    return reply(state, [textMessage(waId, '¿Me pasás tu nombre? Con nombre y apellido alcanza.')]);
  }
  await backend.saveDisplayName(name);
  return advanceCheckout({ state, waId, backend, contact: { ...contact, displayName: name } });
}

async function captureAddressText({ state, waId, backend, contact, value }) {
  const draft = { ...(state.draft_address || {}) };
  const parsed = parseAddress(value);
  if (parsed.street && parsed.streetNumber) {
    draft.street = parsed.street;
    draft.street_number = parsed.streetNumber;
    if (parsed.city) draft.city = parsed.city;
    if (!draft.source) draft.source = 'manual';
  } else if (!draft.street) {
    return reply(state, [textMessage(waId, 'Necesito calle y número. Por ejemplo: «San Martín 1234».')]);
  } else if (!draft.city) {
    draft.city = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  } else {
    draft.reference = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180);
  }
  return advanceCheckout({ state: { ...state, draft_address: draft }, waId, backend, contact });
}

async function captureLocation({ state, waId, backend, contact, location }) {
  // La ubicación de WhatsApp es el punto real del cliente. Es lo mismo que la
  // web captura con el GPS del navegador, y viaja al pedido igual: la app del
  // Rider lo necesita para saber a dónde ir.
  const draft = {
    ...(state.draft_address || {}),
    latitude: Number(location.latitude.toFixed(6)),
    longitude: Number(location.longitude.toFixed(6)),
    source: 'gps',
  };
  if (location.reference && !draft.reference) draft.reference = location.reference;
  const next = { ...state, draft_address: draft };
  if (state.state !== 'awaiting_address') {
    return reply(next, [textMessage(waId, 'Anoté tu ubicación 📍 La uso cuando salga el reparto.')]);
  }
  return advanceCheckout({ state: next, waId, backend, contact });
}

async function confirmAge({ state, waId, backend, contact, value }) {
  if (!value) {
    return reply({ ...state, state: 'cart' }, [
      textMessage(waId, 'Sin la confirmación de mayoría de edad no podemos vender alcohol. Podés sacar esos productos del carrito y seguir con el resto.'),
    ]);
  }
  return advanceCheckout({ state: { ...state, age_confirmed: true }, waId, backend, contact });
}

/**
 * Un solo lugar decide qué falta para poder cobrar, y siempre en el mismo orden.
 * Cada paso vuelve a entrar acá, así que no hay dos caminos hacia el pago.
 */
async function advanceCheckout({ state, waId, backend, contact }) {
  if (!state.cart.length) {
    return reply({ ...state, state: 'browsing' }, [
      buttonsMessage(waId, { body: 'Todavía no hay nada en el carrito.', buttons: [{ id: ACTIONS.MENU, title: 'Ver catálogo' }] }),
    ]);
  }

  const quote = await backend.quote({ cart: state.cart, fulfillmentType: state.fulfillment_type || 'delivery' });

  if (!state.fulfillment_type) {
    return reply({ ...state, state: 'cart' }, [
      buttonsMessage(waId, {
        body: '¿Cómo lo querés?',
        buttons: [
          { id: ACTIONS.DELIVERY, title: 'Envío a domicilio' },
          { id: ACTIONS.PICKUP, title: 'Retiro en el local' },
        ],
      }),
    ]);
  }

  const displayName = String(contact.displayName || '').trim();
  if (displayName.length < 2) {
    return reply({ ...state, state: 'awaiting_name' }, [
      textMessage(waId, '¿A nombre de quién anotamos el pedido?'),
    ]);
  }

  if (state.fulfillment_type === 'delivery') {
    const draft = state.draft_address || {};
    if (!draft.street || !draft.street_number) {
      return reply({ ...state, state: 'awaiting_address' }, [
        textMessage(waId, '¿A qué dirección te lo llevamos?\nMandame *calle y número* (por ejemplo «San Martín 1234»). Si querés, sumá tu ubicación 📍 con el clip → Ubicación.'),
      ]);
    }
    if (!draft.city) {
      return reply({ ...state, state: 'awaiting_address' }, [
        textMessage(waId, '¿En qué ciudad o localidad?'),
      ]);
    }
  }

  if (quote.contains_alcohol && !state.age_confirmed) {
    return reply({ ...state, state: 'awaiting_age' }, [
      buttonsMessage(waId, {
        body: `Tu pedido tiene bebidas con alcohol. ¿Confirmás que sos mayor de ${quote.minimum_age || 18} años?\nAl recibirlo te vamos a pedir el documento.`,
        buttons: [
          { id: ACTIONS.AGE_YES, title: 'Sí, soy mayor' },
          { id: ACTIONS.AGE_NO, title: 'No' },
        ],
      }),
    ]);
  }

  const blockers = (quote.blockers || []).map(blockerText).filter(Boolean);
  if (blockers.length) {
    return reply({ ...state, state: 'cart' }, [
      textMessage(waId, `Antes de cobrar hay que resolver esto:\n⚠️ ${blockers.join('\n⚠️ ')}`),
      ...cartMessages(waId, state, quote),
    ]);
  }

  const summary = [
    'Repasemos:',
    ...(quote.lines || []).map((line) => `• ${line.quantity} × ${line.name} — ${money(line.subtotal)}`),
    '',
    state.fulfillment_type === 'delivery'
      ? `Envío a ${addressLabel(state.draft_address)} — ${money(quote.delivery_fee)}`
      : 'Retirás por el local',
    `*Total ${money(quote.total)}*`,
  ].join('\n');

  return reply({ ...state, state: 'cart' }, [
    buttonsMessage(waId, {
      body: summary,
      footer: 'Pagás con Mercado Pago',
      buttons: [
        { id: ACTIONS.PAY, title: 'Pagar' },
        { id: ACTIONS.MENU, title: 'Agregar algo más' },
        { id: ACTIONS.CLEAR, title: 'Cancelar' },
      ],
    }),
  ]);
}

async function pay({ state, waId, backend, contact }) {
  if (!state.cart.length) return advanceCheckout({ state, waId, backend, contact });
  const result = await backend.startPayment({
    cart: state.cart,
    fulfillmentType: state.fulfillment_type || 'delivery',
    address: state.draft_address || {},
    ageConfirmed: Boolean(state.age_confirmed),
    contactName: contact.displayName,
  });

  if (!result.ok) {
    return reply({ ...state, state: 'cart' }, [
      textMessage(waId, result.message || 'No pudimos preparar el pago. Probá de nuevo en un minuto.'),
    ]);
  }

  return reply({ ...state, state: 'awaiting_payment', checkout_session_id: result.checkoutSessionId }, [
    textMessage(waId, [
      `Total a pagar: *${money(result.total)}*`,
      '',
      'Pagá acá 👇',
      result.initPoint,
      '',
      'Apenas Mercado Pago confirme, te aviso por acá con el número de pedido. El link vence en unos minutos.',
    ].join('\n')),
  ]);
}

function addressLabel(address = {}) {
  return [
    [address.street, address.street_number].filter(Boolean).join(' '),
    address.city,
  ].filter(Boolean).join(', ');
}

/**
 * «San Martín 1234, Neuquén» / «Av. Argentina 500 piso 3, Neuquén».
 * Deliberadamente conservador: si no encuentra calle y número con confianza, no
 * inventa nada y el flujo vuelve a preguntar. Una dirección adivinada es un
 * reparto perdido.
 */
export function parseAddress(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (!raw) return {};
  const [head, ...tail] = raw.split(',');
  const match = String(head).trim().match(/^(.{2,120}?)\s+(\d{1,6})\s*(?:bis)?$/i);
  if (!match) return { city: tail.join(',').trim() || '' };
  return {
    street: match[1].trim().slice(0, 120),
    streetNumber: match[2].slice(0, 24),
    city: tail.join(',').replace(/\s+/g, ' ').trim().slice(0, 100),
  };
}

function reply(state, replies) {
  return { session: state, replies };
}
