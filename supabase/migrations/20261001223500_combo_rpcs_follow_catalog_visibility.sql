-- Las RPC de combos muestran lo mismo que las tablas, ni una fila más.
--
-- QUÉ ESTABA ABIERTO (medido el 2026-10-01 sobre las 159 migraciones anteriores)
--
--   `resolve_business_combo` y `list_business_combos` son SECURITY DEFINER y las
--   ejecuta `anon`. Las tablas detrás tienen policies («approved combos are public»,
--   «production verified products are public», «alcohol verificado con foto se puede
--   mirar»); las funciones, al correr como su dueño, no pasan por ninguna. Sin sesión:
--
--     · `resolve_business_combo(<negocio>, 'promo-sin-aprobar')` devolvía un combo
--       PENDIENTE de aprobación con su nombre, sus términos y su estado, cuando la
--       tabla le mostraba cero filas a ese mismo rol;
--     · de cada componente devolvía sku, nombre, presentación y `max_combos`
--       (= stock / cantidad) aunque el producto no estuviera publicado: un producto
--       sin verificar con stock 37 se leía entero;
--     · `list_business_combos(<negocio cerrado>)` devolvía los combos, los precios y
--       el stock de un comercio cerrado, y lo mismo valía para un comercio de QA
--       fuera de su ventana.
--
-- QUÉ QUEDA
--
--   Dos miradas, decididas del lado del servidor:
--
--     completa   el equipo del comercio (owner / admin / staff con sesión vigente) y
--                la clave de servicio. Es exactamente la respuesta de antes: el
--                Panel y el importador de combos siguen viendo borradores, combos
--                suspendidos y el motivo de cada bloqueo.
--     pública    todos los demás (anon, clientes, repartidores, equipo de OTRO
--                comercio). Un combo existe sólo si está activo, aprobado y su
--                comercio tiene la góndola pública —el mismo predicado que usan las
--                policies de `products`, ventana de QA incluida—. Si no, la
--                respuesta es la de un combo inexistente, sin distinguir el motivo.
--                De cada componente se muestran los datos sólo si el producto es
--                público por las policies de `products`; si no, queda el renglón
--                (producto y cantidad ya son públicos por `product_combo_components`)
--                marcado `unavailable`, sin sku, nombre, presentación, precio ni
--                stock, y el combo no es comprable.
--
--   De paso, un defecto que la prueba de regresión encontró en la versión anterior:
--   cuatro motivos de bloqueo se agregaban con `v_blockers || 'texto'`. Con un
--   `text[]` a la izquierda Postgres lee el literal como un arreglo y la función
--   terminaba en 22P02 «malformed array literal». Resolver un combo APAGADO, sin
--   componentes, con un componente borrado o con un precio derivado inválido no
--   devolvía el motivo: fallaba. Los literales llevan ahora su `::text`.
--
-- QUÉ NO CAMBIA
--
--   · Firmas, dueño, `search_path`, volatilidad y privilegios (anon y authenticated
--     siguen pudiendo ejecutarlas: son la góndola pública).
--   · La respuesta para el equipo y para la clave de servicio, campo por campo
--     (salvo los cuatro casos de arriba, que antes eran un error).
--   · La creación de pedidos y de sesiones de checkout: no llaman a estas funciones.
--   · Las policies de las tablas.
--
-- Forward-only. No toca filas.
-- Reversión: docs/migrations/rollback/20261001223500_combo_rpcs_follow_catalog_visibility.rollback.sql

-- ── 1. Los dos predicados, una sola vez ─────────────────────────────────────
-- La góndola de un comercio es pública con las mismas condiciones que exigen las dos
-- policies públicas de `products`.
create or replace function private.business_catalog_is_public(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select exists (
    select 1
      from public.businesses b
     where b.id = p_business_id
       and b.is_active
       and b.status = 'open'
       and b.ordering_verified
       and b.ordering_enabled
       and (not b.qa_fixture or b.qa_window_until > now())
  );
$$;
revoke all on function private.business_catalog_is_public(uuid) from public, anon, authenticated;

-- Quién ve la definición completa. La clave de servicio se reconoce por su claim, no
-- por la ausencia de usuario: `anon` tampoco tiene usuario y ejecuta estas funciones.
create or replace function private.catalog_caller_sees_drafts(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select coalesce(public.identity_jwt_claims() ->> 'role', '') = 'service_role'
      or coalesce(public.has_business_role(p_business_id, array['owner', 'admin', 'staff']), false);
$$;
revoke all on function private.catalog_caller_sees_drafts(uuid) from public, anon, authenticated;

-- ── 2. Un combo ─────────────────────────────────────────────────────────────
create or replace function public.resolve_business_combo(
  p_business_id uuid,
  p_combo_id text,
  p_quantity integer default 1
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
declare
  v_combo public.product_combos%rowtype;
  v_quantity integer := greatest(1, coalesce(p_quantity, 1));
  v_blockers text[] := array[]::text[];
  v_components jsonb := '[]'::jsonb;
  v_component_count integer := 0;
  v_list_price numeric(12, 2) := 0;
  v_promotional numeric(12, 2);
  v_savings numeric(12, 2);
  v_stock integer;
  v_limiting text;
  v_age_restricted boolean := false;
  v_minimum_age integer;
  v_priced boolean;
  v_full boolean;
  v_hidden integer := 0;
begin
  if p_business_id is null or nullif(btrim(coalesce(p_combo_id, '')), '') is null then
    raise exception 'combo invalido' using errcode = '22023';
  end if;

  v_full := private.catalog_caller_sees_drafts(p_business_id);

  select * into v_combo
    from public.product_combos c
   where c.business_id = p_business_id
     and c.combo_id = p_combo_id;
  -- Para la mirada pública, un combo que la tabla no le mostraría no existe. La
  -- respuesta es la misma que la de un identificador inventado: no se puede usar
  -- para averiguar qué promociones prepara un comercio ni si está cerrado.
  if not found
     or (
       not v_full
       and not (
         v_combo.is_active
         and v_combo.approval_status = 'APROBADO_COMERCIAL'
         and private.business_catalog_is_public(p_business_id)
       )
     ) then
    return jsonb_build_object(
      'combo_id', p_combo_id,
      'exists', false,
      'purchasable', false,
      'blockers', jsonb_build_array('El combo no existe para este negocio.')
    );
  end if;

  if not v_combo.is_active then
    v_blockers := v_blockers || 'El combo está desactivado.'::text;
  end if;
  if v_combo.approval_status <> 'APROBADO_COMERCIAL' then
    v_blockers := v_blockers || format(
      'El combo no está aprobado comercialmente (%s).', v_combo.approval_status
    );
  end if;

  -- Un componente sin precio confirmado BLOQUEA el combo en vez de completarlo
  -- con un número inventado. Lo mismo con el stock: el combo sostiene tantas
  -- unidades como el componente más escaso.
  --
  -- `shown` es la visibilidad del producto para quien llama: todo para la mirada
  -- completa; para la pública, las dos policies públicas de `products` (el comercio
  -- ya se comprobó arriba). De un componente que no se muestra no sale ningún dato
  -- del producto, ni su stock a través de `max_combos`.
  select
      coalesce(jsonb_agg(
        case
          when d.shown then jsonb_build_object(
            'product_id', d.product_id,
            'sku', d.sku,
            'name', d.name,
            'presentation', d.presentation,
            'quantity', d.quantity,
            'unit_price', case when d.sellable then d.price end,
            'line_price', case when d.sellable then d.price * d.quantity end,
            'alcoholic', d.is_alcoholic,
            'max_combos', d.max_combos
          )
          else jsonb_build_object(
            'product_id', d.product_id,
            'quantity', d.quantity,
            'unavailable', true,
            'max_combos', 0
          )
        end order by d.sort_order, d.product_id
      ), '[]'::jsonb),
      count(*)::integer,
      coalesce(sum(case when d.sellable and d.shown then d.price * d.quantity end), 0),
      min(case when d.shown then d.max_combos else 0 end),
      bool_or(d.is_alcoholic) filter (where d.shown),
      max(case when d.shown and d.is_alcoholic then coalesce(d.minimum_age, 18) end),
      (count(*) filter (where not d.shown))::integer
    into v_components, v_component_count, v_list_price, v_stock, v_age_restricted, v_minimum_age, v_hidden
    from (
      select
        cc.product_id,
        cc.quantity,
        cc.sort_order,
        p.sku,
        p.name,
        p.presentation,
        p.price,
        p.is_alcoholic,
        p.minimum_age,
        (
          p.is_active and p.is_verified and p.available
          and p.price_status = 'confirmed'
          and p.price is not null and p.price > 0
          and p.stock is not null
        ) as sellable,
        (
          v_full
          or (
            p.is_active and p.is_verified
            and (
              (p.available and p.stock is not null and p.stock > 0)
              or (
                p.is_alcoholic is true and p.available is false
                and p.image_url is not null and p.catalog_asset_id is not null
              )
            )
          )
        ) as shown,
        greatest(0, floor(coalesce(p.stock, 0)::numeric / cc.quantity))::integer as max_combos
        from public.product_combo_components cc
        join public.products p on p.id = cc.product_id
       where cc.combo_id = v_combo.id
    ) d;

  if v_component_count = 0 then
    v_blockers := v_blockers || 'El combo no declara componentes.'::text;
  end if;

  -- Motivos por componente, en el mismo vocabulario que usa la góndola. De un
  -- componente que no se muestra no se dice cuál es ni por qué.
  v_blockers := v_blockers || coalesce((
    select array_agg(reason order by reason)
      from (
        select format('%s: precio pendiente de confirmación del negocio.', c.value ->> 'sku') as reason
          from jsonb_array_elements(v_components) as c(value)
         where c.value ->> 'unit_price' is null
           and not c.value ? 'unavailable'
        union all
        select format('%s: sin stock disponible.', c.value ->> 'sku')
          from jsonb_array_elements(v_components) as c(value)
         where coalesce((c.value ->> 'max_combos')::integer, 0) <= 0
           and not c.value ? 'unavailable'
      ) reasons
  ), array[]::text[]);
  if coalesce(v_hidden, 0) > 0 then
    v_blockers := v_blockers || 'Un componente no está disponible.'::text;
  end if;

  -- Un componente que ya no está en `products` no aparece en el join de arriba;
  -- se detecta comparando contra la cantidad declarada.
  if v_component_count < (select count(*) from public.product_combo_components cc where cc.combo_id = v_combo.id) then
    v_blockers := v_blockers || 'Un componente ya no está en el catálogo.'::text;
  end if;

  v_priced := array_length(v_blockers, 1) is null;
  v_stock := coalesce(v_stock, 0);

  if v_priced then
    v_promotional := floor(
      (v_list_price * (100 - v_combo.discount_percentage) / 100) / v_combo.price_rounding
    ) * v_combo.price_rounding;
    if v_promotional <= 0 or v_promotional > v_list_price then
      v_priced := false;
      v_promotional := null;
      v_blockers := v_blockers || 'El precio promocional derivado no es válido.'::text;
    else
      v_savings := v_list_price - v_promotional;
    end if;
  end if;

  return jsonb_build_object(
    'combo_id', v_combo.combo_id,
    'combo_uuid', v_combo.id,
    'exists', true,
    'name', v_combo.name,
    'tagline', v_combo.tagline,
    'description', v_combo.description,
    'category_id', v_combo.category_id,
    'terms', v_combo.terms,
    'quantity', v_quantity,
    'discount_percentage', v_combo.discount_percentage,
    'approval_status', v_combo.approval_status,
    'components', v_components,
    'list_price', case when v_priced then v_list_price end,
    'promotional_price', case when v_priced then v_promotional end,
    'savings', case when v_priced then v_savings end,
    'savings_percentage', case
      when v_priced and v_list_price > 0
      then round((v_savings / v_list_price) * 1000) / 10
    end,
    'stock', v_stock,
    'limiting_sku', (
      select c.value ->> 'sku'
        from jsonb_array_elements(v_components) as c(value)
       where coalesce((c.value ->> 'max_combos')::integer, 0) = v_stock
       limit 1
    ),
    'age_restricted', coalesce(v_age_restricted, false),
    'minimum_age', case when coalesce(v_age_restricted, false) then coalesce(v_minimum_age, 18) end,
    'purchasable', v_priced and v_stock >= v_quantity,
    'blockers', to_jsonb(v_blockers)
  );
end;
$$;

revoke all on function public.resolve_business_combo(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.resolve_business_combo(uuid, text, integer) to anon, authenticated;

-- ── 3. La lista ─────────────────────────────────────────────────────────────
create or replace function public.list_business_combos(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(
           public.resolve_business_combo(c.business_id, c.combo_id, 1)
           order by c.sort_order, c.combo_id
         ), '[]'::jsonb)
    from public.product_combos c
   where c.business_id = p_business_id
     and c.is_active
     and c.approval_status = 'APROBADO_COMERCIAL'
     and (
       private.catalog_caller_sees_drafts(p_business_id)
       or private.business_catalog_is_public(p_business_id)
     );
$$;

revoke all on function public.list_business_combos(uuid) from public, anon, authenticated;
grant execute on function public.list_business_combos(uuid) to anon, authenticated;
