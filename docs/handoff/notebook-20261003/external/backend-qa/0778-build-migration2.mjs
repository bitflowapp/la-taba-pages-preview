import fs from 'node:fs';

const SRC = 'D:/1212/la-taba-e2e-test-staging-rc/supabase/migrations/20260802093000_mercadopago_checkout_pro_lifecycle.sql';
const OUT = 'D:/1212/la-taba-e2e-test-staging-rc/supabase/migrations/20260806150000_mercadopago_order_delivery_address_snapshot.sql';

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
// finalize_paid_checkout_session spans 639..712 (1-indexed) in the original.
let body = lines.slice(638, 712).join('\n');

const fromCols = `    customer_name, customer_phone, customer_whatsapp, address_label,
    customer_street_address, customer_neighborhood, customer_reference,
    payment_method, subtotal, delivery_fee, total
  ) values (`;
const toCols = `    customer_name, customer_phone, customer_whatsapp, address_label,
    customer_street_address, customer_neighborhood, customer_reference,
    customer_address_id, delivery_address_formatted, delivery_street, delivery_street_number,
    delivery_floor, delivery_apartment, delivery_reference, delivery_city, delivery_province,
    delivery_postal_code, delivery_address_label, delivery_address_source, delivery_snapshot_created_at,
    payment_method, subtotal, delivery_fee, total
  ) values (`;

const fromVals = `    v_session.address_snapshot ->> 'street', v_session.address_snapshot ->> 'city', v_session.address_snapshot ->> 'reference',
    'mercadopago', v_session.subtotal, v_session.delivery_fee, v_session.total`;
const toVals = `    btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))),
    v_session.address_snapshot ->> 'city', v_session.address_snapshot ->> 'reference',
    nullif(v_session.address_snapshot ->> 'address_id', '')::uuid,
    case when v_session.fulfillment_type = 'delivery' then nullif(btrim(concat_ws(', ',
      nullif(btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))), ''),
      nullif(v_session.address_snapshot ->> 'city', ''),
      nullif(v_session.address_snapshot ->> 'province', ''))), '') end,
    v_session.address_snapshot ->> 'street', v_session.address_snapshot ->> 'street_number',
    v_session.address_snapshot ->> 'floor', v_session.address_snapshot ->> 'apartment',
    v_session.address_snapshot ->> 'reference', v_session.address_snapshot ->> 'city',
    v_session.address_snapshot ->> 'province', v_session.address_snapshot ->> 'postal_code',
    v_session.address_snapshot ->> 'label',
    case when v_session.fulfillment_type = 'delivery'
      then coalesce(nullif(v_session.address_snapshot ->> 'source', ''), 'checkout_session') end,
    case when v_session.fulfillment_type = 'delivery' then clock_timestamp() end,
    'mercadopago', v_session.subtotal, v_session.delivery_fee, v_session.total`;

for (const [from, to] of [[fromCols, toCols], [fromVals, toVals]]) {
  if (!body.includes(from)) throw new Error(`no encontrado:\n${from}`);
  body = body.replace(from, to);
}

const header = `-- Proyecta la direccion de entrega completa al pedido creado por Checkout Pro.
-- Medido el 2026-08-06 sobre el pedido real LT-0033: la sesion de checkout
-- guardaba address_snapshot completo (street, street_number, city, province,
-- address_id, label, source) pero la finalizacion escribia unicamente
-- customer_street_address = street, perdiendo el numero de calle y dejando en
-- NULL todas las columnas delivery_* y customer_address_id. El pedido llegaba al
-- Panel sin domicilio utilizable, a diferencia de los pedidos de los demas
-- medios de pago, que si traen el snapshot estructurado.

`;

fs.writeFileSync(OUT, `${header}${body}\n`);
console.log('escrita:', OUT, '| lineas:', body.split('\n').length);
