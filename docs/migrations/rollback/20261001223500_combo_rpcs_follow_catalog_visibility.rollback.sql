-- Rollback de 20261001223500: devuelve `resolve_business_combo` y
-- `list_business_combos` a su definición anterior, capturada del arnés con las 159
-- migraciones previas aplicadas (pg_get_functiondef), y retira los dos predicados
-- internos.
--
-- Qué vuelve a quedar abierto:
--   · sin sesión se vuelve a poder leer un combo sin aprobar, el nombre, el sku y el
--     stock de un producto sin publicar, y la góndola de un comercio cerrado o de QA;
--   · vuelve el defecto de los literales: resolver un combo apagado, sin componentes,
--     con un componente borrado o con un precio derivado inválido termina en 22P02.
--
-- Qué NO hace: no toca filas ni privilegios (anon y authenticated siguen ejecutando
-- las dos RPC).
begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('la-taba:rollback:20261001223500', 0)
);

CREATE OR REPLACE FUNCTION public.resolve_business_combo(p_business_id uuid, p_combo_id text, p_quantity integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
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
begin
  if p_business_id is null or nullif(btrim(coalesce(p_combo_id, '')), '') is null then
    raise exception 'combo invalido' using errcode = '22023';
  end if;

  select * into v_combo
    from public.product_combos c
   where c.business_id = p_business_id
     and c.combo_id = p_combo_id;
  if not found then
    return jsonb_build_object(
      'combo_id', p_combo_id,
      'exists', false,
      'purchasable', false,
      'blockers', jsonb_build_array('El combo no existe para este negocio.')
    );
  end if;

  if not v_combo.is_active then
    v_blockers := v_blockers || 'El combo está desactivado.';
  end if;
  if v_combo.approval_status <> 'APROBADO_COMERCIAL' then
    v_blockers := v_blockers || format(
      'El combo no está aprobado comercialmente (%s).', v_combo.approval_status
    );
  end if;

  -- Un componente sin precio confirmado BLOQUEA el combo en vez de completarlo
  -- con un número inventado. Lo mismo con el stock: el combo sostiene tantas
  -- unidades como el componente más escaso.
  select
      coalesce(jsonb_agg(
        jsonb_build_object(
          'product_id', d.product_id,
          'sku', d.sku,
          'name', d.name,
          'presentation', d.presentation,
          'quantity', d.quantity,
          'unit_price', case when d.sellable then d.price end,
          'line_price', case when d.sellable then d.price * d.quantity end,
          'alcoholic', d.is_alcoholic,
          'max_combos', d.max_combos
        ) order by d.sort_order, d.product_id
      ), '[]'::jsonb),
      count(*)::integer,
      coalesce(sum(case when d.sellable then d.price * d.quantity end), 0),
      min(d.max_combos),
      bool_or(d.is_alcoholic),
      max(case when d.is_alcoholic then coalesce(d.minimum_age, 18) end)
    into v_components, v_component_count, v_list_price, v_stock, v_age_restricted, v_minimum_age
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
        greatest(0, floor(coalesce(p.stock, 0)::numeric / cc.quantity))::integer as max_combos
        from public.product_combo_components cc
        join public.products p on p.id = cc.product_id
       where cc.combo_id = v_combo.id
    ) d;

  if v_component_count = 0 then
    v_blockers := v_blockers || 'El combo no declara componentes.';
  end if;

  -- Motivos por componente, en el mismo vocabulario que usa la góndola.
  v_blockers := v_blockers || coalesce((
    select array_agg(reason order by reason)
      from (
        select format('%s: precio pendiente de confirmación del negocio.', c.value ->> 'sku') as reason
          from jsonb_array_elements(v_components) as c(value)
         where c.value ->> 'unit_price' is null
        union all
        select format('%s: sin stock disponible.', c.value ->> 'sku')
          from jsonb_array_elements(v_components) as c(value)
         where coalesce((c.value ->> 'max_combos')::integer, 0) <= 0
      ) reasons
  ), array[]::text[]);

  -- Un componente que ya no está en `products` no aparece en el join de arriba;
  -- se detecta comparando contra la cantidad declarada.
  if v_component_count < (select count(*) from public.product_combo_components cc where cc.combo_id = v_combo.id) then
    v_blockers := v_blockers || 'Un componente ya no está en el catálogo.';
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
      v_blockers := v_blockers || 'El precio promocional derivado no es válido.';
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
$function$;

revoke all on function public.resolve_business_combo(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.resolve_business_combo(uuid, text, integer) to anon, authenticated;

CREATE OR REPLACE FUNCTION public.list_business_combos(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(
           public.resolve_business_combo(c.business_id, c.combo_id, 1)
           order by c.sort_order, c.combo_id
         ), '[]'::jsonb)
    from public.product_combos c
   where c.business_id = p_business_id
     and c.is_active
     and c.approval_status = 'APROBADO_COMERCIAL';
$function$;

revoke all on function public.list_business_combos(uuid) from public, anon, authenticated;
grant execute on function public.list_business_combos(uuid) to anon, authenticated;

-- Después de restaurar las dos RPC ya nadie los llama.
drop function if exists private.catalog_caller_sees_drafts(uuid);
drop function if exists private.business_catalog_is_public(uuid);

commit;
