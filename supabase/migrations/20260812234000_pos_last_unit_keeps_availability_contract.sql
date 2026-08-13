-- ═══════════════════════════════════════════════════════════════════════════
-- VENDER LA ÚLTIMA UNIDAD POR MOSTRADOR DEJA DE VOLTEAR LA VENTA ENTERA
--
-- ESTADO: PREPARADA, NO APLICADA. Esta migración no se ejecutó contra ningún
-- entorno. Queda en el árbol para que la aplique una persona.
--
-- QUÉ ESTABA MAL
-- --------------
-- `checkout_pos_sale` descontaba stock así:
--
--     update public.products set stock = stock - v_quantity where id = …;
--
-- Sólo `stock`. Pero el contrato comercial (20260809060000) impone:
--
--     constraint products_available_requires_verification check (
--       not available or (is_verified and is_active and stock is not null
--                         and stock > 0 and price_status = 'confirmed' and price > 0))
--
-- Al vender la ÚLTIMA unidad, el producto quedaba con `stock = 0` y
-- `available = true`: las dos ramas del CHECK en falso. El UPDATE levantaba
-- 23514 y, como `checkout_pos_sale` no tiene bloque `exception`, se caía la
-- transacción COMPLETA. La venta de mostrador no se registraba, el pago no se
-- asentaba y el operador veía un error genérico con el cliente enfrente.
--
-- El camino de pedidos online nunca tuvo este problema:
-- `create_order_with_items` ya escribía `available` junto con el stock. El
-- mostrador era el único que no.
--
-- QUÉ CAMBIA, Y NADA MÁS
-- ----------------------
-- Una sola línea del cuerpo: el UPDATE ahora recalcula `available`. Se usa
-- `available and (stock - v_quantity) > 0` —y no `(stock - v_quantity) > 0` a
-- secas, como hace el camino online— para NO reactivar un producto que el
-- comercio había pausado a mano: vender no puede volver a publicar algo.
--
-- No se toca: la autorización (`has_business_role` con los mismos tres roles),
-- la idempotencia por `idempotency_key`, el `for update`, la verificación de
-- stock suficiente, los asientos en `pos_sale_items`, `inventory_movements` y
-- `pos_payments`, ni la firma, ni `security definer`, ni el `search_path`.
--
-- CÓMO SE REVIERTE
-- ----------------
-- Volver a aplicar la definición de `checkout_pos_sale` de
-- 20260802160000_business_windows_scanner_fiscal.sql. No hay cambio de esquema
-- ni de datos: esto es sólo el cuerpo de una función.
--
-- CÓMO SE COMPRUEBA QUE SIRVIÓ
-- ----------------------------
-- Con un producto de `stock = 1`, `available = true`, verificado y con precio
-- confirmado, llamar a `checkout_pos_sale` por esa única unidad. Antes: 23514 y
-- ninguna fila en `pos_sales`. Después: la venta queda `completed`, el producto
-- queda en `stock = 0` con `available = false`, y el CHECK se respeta.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.checkout_pos_sale(
  p_business_id uuid,
  p_items jsonb,
  p_payment_method text,
  p_idempotency_key text,
  p_request_fiscal boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $checkout_pos$
declare
  v_sale public.pos_sales%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_quantity integer;
  v_subtotal numeric(12,2) := 0;
begin
  if not public.has_business_role(p_business_id, array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_payment_method not in ('cash','debit_card','credit_card','transfer','qr') then raise exception 'medio de pago invalido' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 200 then raise exception 'items invalidos' using errcode = '22023'; end if;
  if (select count(distinct value->>'productId') from jsonb_array_elements(p_items)) <> jsonb_array_length(p_items) then raise exception 'productos duplicados en payload' using errcode='22023'; end if;
  select s.* into v_sale from public.pos_sales s where s.business_id = p_business_id and s.idempotency_key = p_idempotency_key;
  if found then return jsonb_build_object('sale_id', v_sale.id, 'state', v_sale.state, 'total', v_sale.total, 'idempotent_replay', true); end if;
  insert into public.pos_sales(business_id, operator_id, state, idempotency_key) values(p_business_id, auth.uid(), 'pricing', p_idempotency_key) returning * into v_sale;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if v_item - array['productId','quantity'] <> '{}'::jsonb then raise exception 'payload de item no permitido' using errcode = '22023'; end if;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 1 then raise exception 'cantidad invalida' using errcode = '22023'; end if;
    select p.* into v_product from public.products p where p.id = (v_item->>'productId')::uuid and p.business_id = p_business_id and p.is_active and p.is_verified for update;
    if not found then raise exception 'producto no disponible' using errcode = 'P0002'; end if;
    if coalesce(v_product.stock,0) < v_quantity then raise exception 'stock insuficiente' using errcode = '23514'; end if;
    -- LA CORRECCIÓN: `available` se recalcula junto con el stock.
    --
    -- Antes esta línea escribía SÓLO `stock`. Al vender la última unidad el
    -- producto quedaba con `stock = 0` y `available = true`, que es justo lo
    -- que prohíbe el CHECK `products_available_requires_verification`
    -- (20260809060000): «not available or (… and stock > 0 and …)». El UPDATE
    -- levantaba 23514, y como esta función no tiene bloque `exception`, la
    -- venta ENTERA se caía. Vender la última unidad por mostrador era
    -- imposible.
    --
    -- Se escribe `available and (…)` y no `(…)` a secas —como hace
    -- `create_order_with_items`— para no REACTIVAR un producto que el comercio
    -- había pausado a mano: vender no puede volver a publicar algo.
    update public.products
       set stock = stock - v_quantity,
           available = available and (stock - v_quantity) > 0
     where id = v_product.id;
    insert into public.pos_sale_items(sale_id, product_id, product_name, quantity, unit_price, tax_snapshot, line_total)
    values(v_sale.id, v_product.id, v_product.name, v_quantity, v_product.price, jsonb_build_object('configured_by_server', true), v_quantity * v_product.price);
    insert into public.inventory_movements(business_id, product_id, movement_type, quantity_delta, previous_stock, resulting_stock, unit_factor, reference_type, reference_id, operator_id, idempotency_key)
    values(p_business_id, v_product.id, 'sale', -v_quantity, v_product.stock, v_product.stock-v_quantity, 1, 'pos_sale', v_sale.id, auth.uid(), p_idempotency_key || '-' || v_product.id::text);
    v_subtotal := v_subtotal + v_quantity * v_product.price;
  end loop;
  insert into public.pos_payments(sale_id, payment_method, amount, status) values(v_sale.id, p_payment_method, v_subtotal, 'confirmed');
  update public.pos_sales set subtotal = v_subtotal, total = v_subtotal, state = 'completed', completed_at = now() where id = v_sale.id returning * into v_sale;
  return jsonb_build_object('sale_id', v_sale.id, 'state', v_sale.state, 'total', v_sale.total, 'fiscal_requested', p_request_fiscal, 'idempotent_replay', false);
end;
$checkout_pos$;

