-- TABA 24/7 · Dar de alta un producto nuevo, con contrato y en una transacción.
--
-- ## EL DEFECTO
--
-- `apply_commercial_catalog_batch` es la única puerta no privilegiada para mover
-- precio, stock y publicación, y dice de sí misma:
--
--     'Unknown sku % for this business. Commercial import never creates products.'
--
-- Está bien dicho: la planilla de cuatro columnas —sku, precio, stock,
-- publicar— no alcanza para crear nada. No dice qué es el producto, en qué
-- góndola va, ni si lleva alcohol.
--
-- Pero con la tienda 24/7 multi-rubro eso pasó a ser un cuello real: abrir el
-- rubro limpieza son decenas de artículos que todavía no existen, y el único
-- camino para crearlos es el pipeline de investigación de catálogo, que sirve
-- para relevar identidad y no para operar un comercio.
--
-- ## LO QUE AGREGA ESTE ARCHIVO
--
-- `apply_commercial_catalog_plan(business, creates, updates)`: una función que
-- hace las dos cosas EN LA MISMA TRANSACCIÓN.
--
--   · las ALTAS se insertan acá, con el contrato completo de abajo;
--   · las MODIFICACIONES se delegan, sin cambiarlas, a
--     `apply_commercial_catalog_batch`, que ya tiene sus compuertas de precio,
--     stock, foto y republicación.
--
-- Juntarlas importa. Partirlas en dos llamadas dejaría una ventana con los
-- productos nuevos creados y los precios sin actualizar, o al revés: con
-- planillas de decenas de filas, una góndola a medias que alguien reconstruye a
-- mano. Acá se aplica todo o no se aplica nada.
--
-- ## EL CONTRATO DE UN ALTA
--
-- Una fila nueva NO se inserta sólo porque tiene un nombre. Hacen falta, sin
-- excepción:
--
--   sku          · estable, minúsculas/dígitos/guiones, 3 a 80. Es el
--                  identificador para siempre. No puede existir ya, ni parecer
--                  un fixture de QA, ni ser un pack de abastecimiento.
--   name         · 2 a 160 caracteres.
--   category     · uno de los nombres que acepta
--                  `products_verified_canonical_beverage_category`. Publicar en
--                  una góndola que no existe es publicar y no aparecer.
--   is_alcoholic · booleano EXPLÍCITO. No se infiere de la categoría ni del
--                  nombre: un vacío leído como «no» convierte un descuido en una
--                  botella sin +18.
--   minimum_age  · 18 a 99 si lleva alcohol; nulo si no. Coherente con la
--                  categoría, con la misma partición que el CHECK de la tabla.
--
-- Precio y stock son opcionales: un producto puede existir sin estar a la venta,
-- y así nace.
--
-- ## EL ALTA NACE OCULTA. SIEMPRE.
--
-- `is_verified = false`, `available = false`. No hay parámetro para publicarla y
-- no es un olvido:
--
--   · publicar exige `is_verified`, y un producto verificado tiene que cumplir
--     `products_verified_publication_authority` —identidad comercial completa,
--     presentación, capacidad, envase, imagen coherente— que una planilla de
--     nueve columnas no puede acreditar;
--   · un alta con alcohol publicada por planilla sería afirmar una habilitación
--     de expendio sobre un producto que nadie miró. `alcohol_sales_enabled`
--     sigue siendo de una persona, y este archivo no lo toca;
--   · un producto comprable sin foto lo sigue detectando `commercial:gate`.
--
-- Crear y publicar son dos pasadas: primero se cargan, después se revisan, y
-- recién entonces la misma planilla los publica por el camino de siempre, con
-- el SKU ya existente y todas las compuertas de
-- `apply_commercial_catalog_batch` corriendo.
--
-- ## LO QUE NO CAMBIA
--
--   · `apply_commercial_catalog_batch` no se toca. Sigue existiendo, sigue
--     siendo llamable sola, y sigue negándose a crear productos;
--   · ninguna fila existente se modifica por este archivo;
--   · el alcohol, el horario y Mercado Pago quedan exactamente donde estaban.
--
-- ## REVERSIÓN
--
-- `drop function public.apply_commercial_catalog_plan`. Las filas creadas por
-- ella quedan como cualquier producto oculto: no se venden y se pueden archivar
-- desde el Panel.
--
-- Forward-only. No toca 1..117.

create or replace function public.apply_commercial_catalog_plan(
  p_business_id uuid,
  p_creates jsonb default '[]'::jsonb,
  p_updates jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $apply_commercial_catalog_plan$
declare
  v_row jsonb;
  v_sku text;
  v_name text;
  v_category text;
  v_subcategory text;
  v_alcoholic boolean;
  v_minimum_age integer;
  v_price numeric(12, 2);
  v_stock integer;
  v_seen text[] := '{}';
  v_created integer := 0;
  v_updated integer := 0;
  v_creadas jsonb := '[]'::jsonb;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can apply a commercial catalog plan.'
      using errcode = '42501';
  end if;
  if p_creates is null or jsonb_typeof(p_creates) is distinct from 'array'
     or p_updates is null or jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'Both creates and updates must be JSON arrays.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_creates) > 500 then
    raise exception 'A plan proposes at most 500 new products.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_creates) = 0 and jsonb_array_length(p_updates) = 0 then
    raise exception 'A plan that decides nothing is not applied.' using errcode = '22023';
  end if;

  -- ── ALTAS ──────────────────────────────────────────────────────────────────
  for v_row in select value from jsonb_array_elements(p_creates)
  loop
    v_sku := btrim(coalesce(v_row ->> 'sku', ''));
    if v_sku !~ '^[a-z0-9][a-z0-9-]{2,79}$' then
      raise exception 'Unstable sku for a new product: %. Use lowercase letters, digits and dashes.', v_sku
        using errcode = '22023';
    end if;
    if v_sku = any (v_seen) then
      raise exception 'Duplicated new sku % in the same plan.', v_sku using errcode = '22023';
    end if;
    v_seen := v_seen || v_sku;

    -- Un fixture de QA nunca entra al catálogo comercial. Es la misma regla que
    -- ya aplica el lote de modificaciones, con el mismo patrón.
    if v_sku ~* '(-staging-only$)|(^qa[-_])|(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking sku in the commercial catalog: %.', v_sku
        using errcode = '22023';
    end if;
    -- El pack con el que el local se surte no es un producto de góndola.
    if v_sku ~* '-(pack|bulto|caja)-[0-9]+$' then
      raise exception 'Sku % looks like a procurement pack, not a shelf product.', v_sku
        using errcode = '22023';
    end if;

    if exists (select 1 from public.products p
                where p.business_id = p_business_id and p.sku = v_sku) then
      raise exception 'Sku % already exists for this business. A plan never overwrites by creating.', v_sku
        using errcode = '23505';
    end if;

    v_name := btrim(coalesce(v_row ->> 'name', ''));
    if char_length(v_name) not between 2 and 160 then
      raise exception 'Invalid name for new sku %.', v_sku using errcode = '22023';
    end if;

    v_category := btrim(coalesce(v_row ->> 'category', ''));
    if v_category not in (
      'Gaseosas', 'Mixers', 'Energizantes', 'Aguas', 'Aguas saborizadas', 'Isotónicas', 'Hielo',
      'Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados',
      'Snacks', 'Golosinas', 'Almacén', 'Limpieza', 'Higiene personal', 'Hogar', 'Mascotas', 'Otros'
    ) then
      raise exception 'Unknown category % for new sku %.', v_category, v_sku using errcode = '22023';
    end if;

    if jsonb_typeof(v_row -> 'is_alcoholic') is distinct from 'boolean' then
      raise exception 'New sku % must declare is_alcoholic explicitly as a boolean.', v_sku
        using errcode = '22023';
    end if;
    v_alcoholic := (v_row ->> 'is_alcoholic')::boolean;

    -- La góndola y la bandera tienen que decir lo mismo: es la misma partición
    -- que exige `products_verified_alcohol_coherence`, adelantada al alta para
    -- que el producto no nazca imposible de verificar.
    if v_alcoholic <> (v_category in ('Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados')) then
      raise exception 'Category % and is_alcoholic=% disagree for new sku %.', v_category, v_alcoholic, v_sku
        using errcode = '22023';
    end if;

    if v_alcoholic then
      v_minimum_age := coalesce(nullif(btrim(coalesce(v_row ->> 'minimum_age', '')), '')::integer, 18);
      if v_minimum_age not between 18 and 99 then
        raise exception 'Invalid minimum_age for new sku %.', v_sku using errcode = '22023';
      end if;
    else
      v_minimum_age := null;
      if nullif(btrim(coalesce(v_row ->> 'minimum_age', '')), '') is not null then
        raise exception 'New sku % is not alcoholic and cannot carry a minimum age.', v_sku
          using errcode = '22023';
      end if;
    end if;

    if nullif(btrim(coalesce(v_row ->> 'price', '')), '') is null then
      v_price := null;
    elsif coalesce(v_row ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for new sku %.', v_sku using errcode = '22023';
    else
      v_price := (v_row ->> 'price')::numeric;
      if v_price <= 0 or v_price > 9999999999.99 then
        raise exception 'Invalid price value for new sku %.', v_sku using errcode = '22023';
      end if;
    end if;

    if nullif(btrim(coalesce(v_row ->> 'stock', '')), '') is null then
      v_stock := 0;
    elsif coalesce(v_row ->> 'stock', '') !~ '^[0-9]+$'
          or (v_row ->> 'stock')::numeric > 2147483647 then
      raise exception 'Invalid stock for new sku %.', v_sku using errcode = '22023';
    else
      v_stock := (v_row ->> 'stock')::integer;
    end if;

    -- Publicar no viaja en un alta. Si alguien lo manda igual, se dice por qué
    -- no, en vez de ignorar la clave en silencio.
    if coalesce((v_row ->> 'publish')::text, 'false') not in ('false', '') then
      raise exception 'A newly proposed product is always created hidden: publish sku % in a second pass.', v_sku
        using errcode = '22023';
    end if;

    v_subcategory := nullif(btrim(coalesce(v_row ->> 'subcategory', '')), '');
    if v_subcategory is not null and char_length(v_subcategory) > 80 then
      raise exception 'Invalid subcategory for new sku %.', v_sku using errcode = '22023';
    end if;

    insert into public.products (
      business_id, sku, external_id, name, category, subcategory,
      price, price_status, stock,
      -- Nace ACTIVO pero NO disponible y NO verificado: existe para el Panel,
      -- no existe para la góndola. `available` es lo que decide si se puede
      -- comprar, y sólo lo enciende la segunda pasada con sus compuertas.
      is_active, available, is_verified,
      is_alcoholic, minimum_age, catalog_origin
    ) values (
      p_business_id, v_sku, v_sku, v_name, v_category, v_subcategory,
      coalesce(v_price, 0),
      case when v_price is null then 'pending' else 'confirmed' end,
      v_stock,
      true, false, false,
      v_alcoholic, v_minimum_age, 'commercial'
    );

    v_created := v_created + 1;
    v_creadas := v_creadas || jsonb_build_array(jsonb_build_object(
      'sku', v_sku, 'name', v_name, 'category', v_category,
      'is_alcoholic', v_alcoholic, 'available', false, 'is_verified', false
    ));
  end loop;

  -- ── MODIFICACIONES ─────────────────────────────────────────────────────────
  -- Se delegan tal cual. La misma transacción, las mismas compuertas.
  if jsonb_array_length(p_updates) > 0 then
    select count(*) into v_updated
      from public.apply_commercial_catalog_batch(p_business_id, p_updates);
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'updated', v_updated,
    'rows', v_creadas
  );
end;
$apply_commercial_catalog_plan$;

revoke all on function public.apply_commercial_catalog_plan(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.apply_commercial_catalog_plan(uuid, jsonb, jsonb) to authenticated;

comment on function public.apply_commercial_catalog_plan(uuid, jsonb, jsonb) is
  'Aplica un plan comercial completo en UNA transaccion: da de alta productos nuevos —ocultos, no verificados, con categoria y clasificacion alcoholica explicitas— y delega las modificaciones a apply_commercial_catalog_batch. Un alta nunca nace publicada ni habilita alcohol.';
