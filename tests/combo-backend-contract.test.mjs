import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

const catalog = read('20260806240000_taba2_combo_catalog_contract.sql');
const pricing = read('20260806250000_taba2_combo_checkout_pricing.sql');
const preference = read('20260806260000_taba2_combo_preference_lines.sql');
const total = read('20260806270000_taba2_order_total_with_discount.sql');
const foundation = read('20260802090000_mercadopago_checkout_pro_foundation.sql');
const both = `${catalog}\n${pricing}`;

test('ninguna de las dos migraciones destruye evidencia', () => {
  for (const sql of [catalog, pricing]) {
    assert.doesNotMatch(sql, /drop table|truncate table/i);
    assert.doesNotMatch(
      sql,
      /delete from public[.](orders|order_items|order_events|checkout_sessions|payment_intents|products|rider_locations)/i,
    );
  }
});

test('el combo se identifica por un id estable y por negocio', () => {
  assert.match(catalog, /combo_id text not null/);
  assert.match(catalog, /product_combos_combo_id_format[\s\S]{0,120}\^\[a-z0-9\]\[a-z0-9-\]\{2,63\}\$/);
  assert.match(catalog, /unique \(business_id, combo_id\)/);
});

test('el backend no guarda ningún precio de combo', () => {
  // El manifiesto declara componentes y descuento. Un precio guardado envejece
  // en silencio: el día que sube la lata el combo seguiría prometiendo un
  // ahorro que ya no existe.
  for (const forbidden of [
    /product_combos[\s\S]{0,2000}?\bprice numeric/,
    /product_combo_components[\s\S]{0,800}?\bprice numeric/,
  ]) {
    assert.doesNotMatch(catalog, forbidden);
  }
  assert.match(catalog, /discount_percentage numeric\(5, 2\) not null/);
});

test('componentes y cantidades se validan server-side contra la definición propia', () => {
  assert.match(catalog, /create table if not exists public[.]product_combo_components/);
  assert.match(catalog, /product_id uuid not null references public[.]products\(id\) on delete restrict/);
  assert.match(catalog, /product_combo_components_quantity_check[\s\S]{0,80}quantity between 1 and 100/);
  // El checkout expande el combo con SU definición, no con lo que mandó el
  // navegador: el payload sólo trae combo_id y quantity.
  assert.match(pricing, /item[.]value \? 'combo_id'[\s\S]{0,400}?item_keys[.]key not in \('combo_id', 'quantity'\)/);
});

test('el precio de lista sale de los precios bloqueados, no de los leídos antes', () => {
  // Calcularlo con el precio leído antes del lock permitiría que una
  // actualización concurrente moviera el ahorro anunciado respecto del cobrado.
  assert.match(
    pricing,
    /sum\(cc[.]quantity \* i[.]unit_price\)[\s\S]{0,900}?from public[.]product_combo_components cc[\s\S]{0,200}?join public[.]checkout_session_items i/,
  );
  // Y el bucle que fija esos unit_price toma los productos `for update`.
  assert.match(pricing, /from public[.]products p[\s\S]{0,200}?for update/);
});

test('el descuento y el total los decide el backend, nunca el frontend', () => {
  assert.match(pricing, /v_combo_promotional := floor\([\s\S]{0,200}?v_combo_row[.]discount_percentage/);
  assert.match(pricing, /v_total := v_subtotal - v_discount_total \+ v_delivery_fee;/);
  assert.match(pricing, /discount_total = v_discount_total/);
  // El payload de checkout no acepta ningún campo de dinero.
  assert.match(
    pricing,
    /key not in \(\s*'business_id', 'client_request_id', 'items', 'fulfillment_type',\s*'contact', 'address', 'age_confirmed', 'payment_method'\s*\)/,
  );
  for (const money of ['price', 'total', 'amount', 'discount']) {
    assert.doesNotMatch(
      pricing,
      new RegExp(`item_keys[.]key not in \\([^)]*'${money}'`),
      `el item de checkout no puede aceptar ${money}`,
    );
  }
});

test('el precio promocional nunca puede superar al de lista ni ser cero', () => {
  assert.match(pricing, /v_combo_promotional <= 0 or v_combo_promotional > v_combo_list_price/);
  assert.match(pricing, /checkout_session_combos_price_check[\s\S]{0,240}promotional_price <= list_price/);
  assert.match(pricing, /order_combos_price_check[\s\S]{0,240}promotional_price <= list_price/);
});

test('el descuento nunca puede superar el subtotal', () => {
  assert.match(pricing, /v_discount_total > v_subtotal[\s\S]{0,160}?raise exception/);
  assert.match(pricing, /orders_discount_total_check[\s\S]{0,120}discount_total <= subtotal/);
  // La invariante de dinero del pedido se vuelve explícita en vez de desaparecer.
  assert.match(pricing, /orders_total_not_below_subtotal[\s\S]{0,120}total >= subtotal - discount_total/);
});

test('la aritmética del pedido cuenta el descuento como una parte más', () => {
  // Medido sobre staging con un pago real aprobado: `20260806250000` relajó una
  // de las dos invariantes de dinero del pedido y se le pasó la otra, declarada
  // inline en la primera migración de pedidos. `finalize_paid_checkout_session`
  // levantaba 23514 en cada intento y el comprador veía "Confirmando tu pedido"
  // para siempre, con el pago ya verificado.
  assert.match(total, /drop constraint if exists orders_total_matches_parts/);
  assert.match(total, /check \(total = subtotal - discount_total \+ delivery_fee\)/);
  // Las DOS invariantes tienen que estar de acuerdo sobre el descuento.
  const declaradas = `${pricing}\n${total}`;
  assert.doesNotMatch(declaradas, /check \(total = subtotal \+ delivery_fee\)/);
  assert.doesNotMatch(declaradas, /check \(total >= subtotal\)/);
});

test('el stock disponible es el del componente limitante', () => {
  assert.match(catalog, /min\(d[.]max_combos\)/);
  assert.match(catalog, /floor\(coalesce\(p[.]stock, 0\)::numeric \/ cc[.]quantity\)/);
});

test('las cantidades se consolidan por producto antes de reservar', () => {
  // Seis latas dentro del combo y dos sueltas son ocho latas contra el mismo
  // stock. Sin consolidar, una línea suelta y un combo podrían sobrevenderse
  // entre sí sin que ninguna de las dos violara el stock por separado.
  assert.match(pricing, /union all[\s\S]{0,500}?group by merged[.]product_id/);
  assert.match(pricing, /quantity total demasiado alta para producto/);
});

test('la reserva de todos los componentes es atómica y revierte entera', () => {
  // Una sola transacción: cualquier `raise` deshace las reservas ya hechas, el
  // stock descontado y la sesión creada. No hay commit parcial posible.
  assert.match(pricing, /stock insuficiente para producto[\s\S]{0,80}?errcode = '23514'/);
  assert.match(pricing, /raise exception 'combo incompleto al reservar/);
  assert.match(pricing, /insert into public[.]inventory_reservations/);
  assert.doesNotMatch(pricing, /\bcommit\b|\bsavepoint\b/i);
});

test('el +18 se propaga desde cualquier componente alcohólico', () => {
  assert.match(catalog, /bool_or\(d[.]is_alcoholic\)/);
  // El bucle de reserva ya marca la sesión al ver un componente alcohólico, y
  // los componentes del combo pasan por ese mismo bucle.
  assert.match(pricing, /if v_product[.]is_alcoholic then[\s\S]{0,160}v_contains_alcohol := true/);
  assert.match(pricing, /politica o confirmacion de edad incompleta/);
});

test('el pedido conserva el snapshot del combo y de sus componentes', () => {
  assert.match(pricing, /create table if not exists public[.]order_combos/);
  assert.match(pricing, /combo_snapshot jsonb not null/);
  assert.match(pricing, /'components', v_combo_components/);
  assert.match(pricing, /insert into public[.]order_combos \([\s\S]{0,400}?from public[.]checkout_session_combos/);
});

test('repetir el mismo carrito es idempotente y cambiarlo se rechaza', () => {
  // El hash de intención incluye los combos: sin eso, reusar el mismo
  // client_request_id con otros combos devolvería la sesión vieja.
  assert.match(pricing, /'combos', v_normalized_combos[\s\S]{0,200}?'sha256'/);
  assert.match(pricing, /client_request_id reutilizado con un checkout diferente/);
  assert.match(pricing, /unique \(checkout_session_id, combo_id\)/);
  assert.match(pricing, /unique \(order_id, combo_id\)/);
});

test('sólo un combo aprobado y activo se puede cobrar', () => {
  assert.match(pricing, /approval_status <> 'APROBADO_COMERCIAL'[\s\S]{0,140}?raise exception/);
  assert.match(pricing, /not v_combo_row[.]is_active[\s\S]{0,140}?raise exception/);
  assert.match(catalog, /approval_status <> 'APROBADO_COMERCIAL' or approved_at is not null/);
});

test('la redefinición conserva todas las validaciones del checkout original', () => {
  // Redefinir una función de 430 líneas es la forma más barata de perder una
  // validación sin que ningún test lo note.
  for (const guard of [
    'campo no permitido en checkout',
    'medio de pago invalido para Checkout Pro',
    'nombre de contacto invalido',
    'telefono de contacto invalido',
    'direccion de delivery incompleta',
    'negocio no habilitado para pagos online',
    'Mercado Pago no esta configurado para este negocio',
    'demasiados intentos de checkout',
    'producto no disponible para pago',
    'venta de alcohol fuera de horario',
    'pg_advisory_xact_lock',
  ]) {
    assert.ok(foundation.includes(guard), `el original declara ${guard}`);
    assert.ok(pricing.includes(guard), `la redefinición conserva ${guard}`);
  }
});

test('las tablas nuevas habilitan RLS y no se pueden mutar desde el navegador', () => {
  for (const table of [
    'product_combos',
    'product_combo_components',
    'product_combo_substitutions',
    'checkout_session_combos',
    'order_combos',
  ]) {
    assert.match(both, new RegExp(`alter table public[.]${table} enable row level security`));
    assert.match(both, new RegExp(`revoke all privileges on table public[.]${table} from public, anon, authenticated`));
    assert.doesNotMatch(both, new RegExp(`grant (insert|update|delete)[^;]*on table public[.]${table}`, 'i'));
  }
});

test('la preferencia de Mercado Pago cobra el combo, no sus componentes', () => {
  // Medido en staging: con los componentes a precio de lista la suma de los
  // ítems (11.700) superaba el total autoritativo (10.650) y el armador de la
  // preferencia lanzaba, lo que el Edge Function clasificaba como
  // `network_or_timeout`. El combo se RESERVA por componentes y se COBRA como
  // combo; la preferencia tiene que contar la segunda historia.
  assert.match(preference, /from public[.]checkout_session_combos c/);
  assert.match(preference, /'unit_price', c[.]promotional_price/);
  assert.doesNotMatch(preference, /'unit_price', c[.]list_price/);

  // Y del producto sólo viaja lo que ningún combo consume.
  assert.match(preference, /i[.]quantity - coalesce\(\(\s*select sum\(cc[.]quantity \* c[.]quantity\)/);
  assert.match(preference, /and suelto[.]quantity > 0/);
});

test('la redefinición de la preferencia conserva sus guardas de autorización', () => {
  for (const guard of [
    'checkout no autorizado',
    'checkout vencido',
    'Mercado Pago no esta habilitado',
    'checkout no admite otra preferencia',
    'reserva de stock no valida',
    'el pago actual no admite un nuevo intento controlado',
  ]) {
    assert.ok(preference.includes(guard), `la redefinición conserva ${guard}`);
  }
  // El total sigue saliendo del intent, no de la suma de los ítems.
  assert.match(preference, /'total', v_intent[.]expected_amount/);
});

test('la góndola pública sólo ve combos aprobados de un negocio abierto', () => {
  assert.match(
    catalog,
    /policy "approved combos are public"[\s\S]{0,400}?approval_status = 'APROBADO_COMERCIAL'[\s\S]{0,400}?b[.]ordering_enabled/,
  );
});
