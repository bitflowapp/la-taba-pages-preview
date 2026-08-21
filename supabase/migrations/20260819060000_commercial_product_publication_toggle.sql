-- ─────────────────────────────────────────────────────────────────────────────
-- PUBLICAR/OCULTAR UN PRODUCTO YA VERIFICADO, DESDE LA SESIÓN NORMAL DEL PANEL
--
-- ## Por qué existe
-- --------------------
-- `apply_commercial_catalog_batch` puede mover precio, stock y publicación de
-- hasta 500 productos en una sola llamada — es la puerta de PLANILLA, pensada
-- para un CSV. Usarla desde un botón del Panel para "publicar este producto"
-- sería forzar una herramienta de lote a hacer una cosa: quien arme el payload
-- en el cliente tiene que acordarse de mandar sólo `{sku, publish:true}` y
-- nunca `price`/`stock`, y un error ahí no es un botón que falla — es un botón
-- que puede mover precio o stock de otro producto por accidente. Y hoy esa
-- puerta ni siquiera está conectada a ningún botón: sólo la llama
-- `scripts/import-commercial-catalog.mjs`, un script Node fuera del Panel.
--
-- Esta migración agrega la puerta que faltaba: UN producto, UNA decisión
-- (publicado o no), CERO superficie para precio o stock.
--
-- ## Lo que reutiliza, y por qué no se duplica nada
-- ----------------------------------------------------
--   · `has_business_role(business_id, roles)` — la misma autoridad de rol que
--     ya usan `apply_commercial_catalog_batch`, `publish_catalog_product` y
--     `apply_inventory_movement`. Trae gratis la exigencia de
--     `identity_requires_registered_session` (20260814030000): una sesión no
--     registrada ya recibe `role = null` desde `identity_member_role`, así que
--     esta función no necesita —ni debe— volver a preguntar por eso.
--   · `product_commercial_image_valid(product)` — la MISMA función de
--     20260819050000 que ya usa `apply_commercial_catalog_batch`. Ni una
--     regex ni un `exists(...)` se copian de nuevo acá.
--   · El resto de las compuertas (`is_active`, `stock > 0`,
--     `price_status = 'confirmed' and price > 0`) son exactamente las que ya
--     exige `apply_commercial_catalog_batch` al publicar — mismos valores,
--     mismo criterio, escritos una vez más porque SQL no tiene una forma de
--     compartir un bloque `if` entre dos funciones sin envolverlo en una
--     función aparte, y crear una función de tres líneas para cuatro
--     comparaciones hubiera sido más superficie, no menos.
--
-- ## Lo que agrega, y que no existía en ningún lado
-- -----------------------------------------------------
-- La compuerta de alcohol. Ninguna función existente la tenía: la política de
-- alcohol de la góndola inicial (`gondola-neuquen-plan.mjs`) vivía en un
-- SCRIPT de carga, no en una RPC que cualquier sesión de owner/admin pueda
-- invocar. Publicar acá un producto con `is_alcoholic = true` exige
-- `businesses.alcohol_sales_enabled = true`; si no, se rechaza con un mensaje
-- explícito y no hay forma de sortearlo desde este RPC.
--
-- Y una decisión deliberada: esta función NUNCA verifica un producto por
-- primera vez. Si `is_verified = false`, rechaza y dirige a la vía que sí
-- hace esa verificación (importación comercial). Publicar y verificar son dos
-- actos distintos — verificar es "los datos maestros están bien", publicar es
-- "mostralo ahora" — y esta migración separa uno del otro para que la
-- superficie de escritura de este botón sea EXACTAMENTE una columna:
-- `available`. Ni `price`, ni `stock`, ni `is_verified`, ni imagen, ni
-- categoría.
--
-- ## Roles
-- ---------
-- `owner`/`admin`, igual que `apply_commercial_catalog_batch` y
-- `publish_catalog_product` — nunca `staff`. El cliente ya tenía la
-- capacidad `products.publish` declarada y restringida así en
-- `business-capabilities.js` desde antes de esta migración (se usa hoy para
-- completar un borrador de producto escaneado); esta migración es la primera
-- vez que un botón para un producto YA EXISTENTE la ejercita.
--
-- Ocultar usa el mismo par de roles: es la misma decisión comercial en
-- sentido contrario, y `unpublish_catalog_product` (20260725110000) ya
-- establece ese mismo precedente para ocultar productos.
--
-- Forward-only. No toca 1..111.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_commercial_product_publication(
  p_business_id uuid,
  p_sku text,
  p_publish boolean
)
returns table (
  applied_sku text,
  applied_available boolean,
  applied_is_verified boolean,
  applied_price numeric(12, 2),
  applied_stock integer,
  applied_price_status text
)
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_sku text := btrim(coalesce(p_sku, ''));
  v_product public.products%rowtype;
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish or hide a commercial product.'
      using errcode = '42501';
  end if;
  if v_sku = '' then
    raise exception 'Missing sku.' using errcode = '22023';
  end if;
  if p_publish is null then
    raise exception 'p_publish must be true or false.' using errcode = '22023';
  end if;

  select * into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.sku = v_sku
   for update;
  if not found then
    raise exception 'Unknown sku % for this business.', v_sku using errcode = 'P0002';
  end if;

  -- ── ocultar: siempre permitido para owner/admin, no toca nada más ─────────
  if not p_publish then
    return query
      update public.products p
         set available = false,
             updated_at = statement_timestamp()
       where p.id = v_product.id
      returning p.sku, p.available, p.is_verified, p.price, p.stock, p.price_status;
    return;
  end if;

  -- La publicación desde el Panel sólo opera sobre la autoridad comercial.
  -- Los borradores, fixtures y otros orígenes pueden compartir SKU, precio o
  -- stock, pero no deben cruzar esta puerta de venta. Ocultar, en cambio, se
  -- mantiene disponible para retirar una publicación sin exigir revalidación.
  if coalesce(v_product.catalog_origin, '') <> 'commercial' then
    raise exception 'Refusing to publish non-commercial sku %.', v_sku;
  end if;

  -- ── publicar: producto YA verificado, nunca se verifica acá por primera vez ─
  if not v_product.is_verified then
    raise exception 'Sku % is not verified yet. Verify its master data first (commercial import), then publish.', v_sku;
  end if;
  if not v_product.is_active then
    raise exception 'Refusing to publish inactive sku %.', v_sku;
  end if;
  if v_product.price_status <> 'confirmed' or coalesce(v_product.price, 0) <= 0 then
    raise exception 'Refusing to publish sku % without a confirmed price.', v_sku;
  end if;
  if coalesce(v_product.stock, 0) <= 0 then
    raise exception 'Refusing to publish sku % without stock.', v_sku;
  end if;
  if not public.product_commercial_image_valid(v_product) then
    raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset.', v_sku;
  end if;
  if v_product.is_alcoholic then
    select * into v_business from public.businesses b where b.id = p_business_id;
    if not found or coalesce(v_business.alcohol_sales_enabled, false) is not true then
      raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku;
    end if;
  end if;

  return query
    update public.products p
       set available = true,
           updated_at = statement_timestamp()
     where p.id = v_product.id
    returning p.sku, p.available, p.is_verified, p.price, p.stock, p.price_status;
end;
$$;

revoke all on function public.set_commercial_product_publication(uuid, text, boolean)
from public, anon, authenticated;
grant execute on function public.set_commercial_product_publication(uuid, text, boolean)
to authenticated;

comment on function public.set_commercial_product_publication(uuid, text, boolean) is
  'Toggle available for ONE already-verified commercial product (owner/admin only). Never creates, never verifies for the first time, never touches price/stock/identity/imagery/category — the only column it ever writes is available. Publishing additionally requires is_active, a confirmed price above zero, stock above zero, product_commercial_image_valid(product), and — when the product is alcoholic — businesses.alcohol_sales_enabled.';
