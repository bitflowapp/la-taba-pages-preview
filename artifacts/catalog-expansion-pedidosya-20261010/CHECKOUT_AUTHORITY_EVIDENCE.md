# CHECKOUT_AUTHORITY_EVIDENCE · quién decide el precio del pedido

**Fecha:** 2026-10-10 · **Base:** producción `wwcpogltfgzgkrlilbcd` (la que sirve `la-taba.pages.dev`) · **Método:** `pg_get_functiondef` sobre las funciones desplegadas, en transacción `read only` con `rollback`. **No se creó ningún pedido ni se escribió nada.**

## 1. Lo que envía el cliente

- Carrito de pedidos (`js/repositories/supabase_order_repository.js`, dos mapeos de `cartItems`): cada línea es `{ product_id, quantity }`. Sin precio.
- Combos: `{ combo_id, quantity }`. Sin precio.
- Payload de Mercado Pago (`js/payments/mercadopago-checkout.js`, `buildMercadoPagoCheckoutPayload`): líneas `{ product_id | combo_id, quantity }`. Sin precio.
- Edge Function `mercadopago-create-checkout-session`: el propio archivo declara que no recibe `price`, `currency`, ID de preferencia ni ID de pago.

## 2. Lo que decide el servidor (función desplegada `create_order_with_items_core`)

```
v_subtotal numeric(12, 2) := 0;
...
raise exception 'quantity total demasiado alta para producto: %', v_item.product_id
if v_product.price <= 0 then
  raise exception 'precio no verificado para producto: %', v_item.product_id
v_line_subtotal := v_product.price * v_item.quantity;
v_subtotal := v_subtotal + v_line_subtotal;
'unit_price', v_product.price,
'subtotal', v_line_subtotal
v_minimum := nullif(v_zone ->> 'minimum_subtotal', '')::numeric(12, 2);
v_total := v_subtotal + v_delivery_fee;
```

## 3. Lo que decide el servidor (función desplegada `create_checkout_session`)

```
-- identificador estable y NUNCA con un precio: el precio lo decide el backend.
... or v_product.price_status <> 'confirmed'
    or v_product.price is null
    or v_product.price <= 0 then
checkout_session_id, product_id, product_snapshot, quantity, unit_price, subtotal
v_product.price,
v_product.price * v_item.quantity
v_subtotal := v_subtotal + (v_product.price * v_item.quantity);
-- El precio de lista del combo se calcula con los precios BLOQUEADOS recien
-- ahora: usar el precio leido antes del lock permitiria que una actualizacion ...
v_total := v_subtotal - v_discount_total + v_delivery_fee;
```

## 4. Qué significa para el catálogo que se va a actualizar

- Un producto con `price_status <> 'confirmed'` o `price <= 0` **no se puede comprar** en ninguna de las dos funciones: el checkout lo rechaza en el servidor.
- El precio que queda registrado en el pedido (`unit_price`) es el de `products` **en el momento de la compra**, no el que mostró la tienda un rato antes.
- Hay una brecha conocida: la tienda muestra el precio cargado al abrir la página. Si un owner cambia un precio mientras el cliente tiene el carrito abierto, el pedido se crea con el precio nuevo y el cliente lo ve recién en el resumen final. Esto no es una falla de autoridad, pero conviene que la UI del resumen muestre el total devuelto por el servidor antes de confirmar. **No cambié esa UI en este PR.**

## 5. Limitaciones de esta verificación

- Es lectura de definiciones desplegadas, no una prueba de extremo a extremo. No se ejecutó ningún pedido: la regla «no usar producción para pedidos de prueba» se respeta.
- Staging no tiene los 134 SKU ni una sesión de owner vigente, así que una prueba de pedido real contra staging quedó bloqueada.
