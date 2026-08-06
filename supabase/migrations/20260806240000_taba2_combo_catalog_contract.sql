-- TABA2 · Contrato de catálogo de combos.
--
-- El manifiesto comercial (`data/combos.csv`) declara QUÉ contiene un combo, en
-- qué cantidad y qué descuento decidió el comercio. No declara precios, y esta
-- migración conserva esa decisión del lado del servidor: acá tampoco se guarda
-- ningún precio de combo. El precio de lista, el promocional, el ahorro, el
-- stock y el +18 se DERIVAN del catálogo vivo cada vez que se consulta.
--
-- La razón es la misma que en el frontend: un precio guardado envejece en
-- silencio y el día que sube la lata la góndola sigue prometiendo un ahorro que
-- ya no existe. La diferencia es que a partir de acá la derivación es
-- AUTORITATIVA: el navegador ya no puede proponer un precio de combo, sólo
-- puede pedir un combo por su identificador estable.
--
-- Un combo se identifica por `combo_id` (texto estable, el mismo del
-- manifiesto) dentro de un negocio. Los componentes apuntan a `products` por
-- UUID, así que un componente no puede quedar colgado de un SKU que cambió.

create extension if not exists pgcrypto;

-- ===== Definición del combo =====

create table if not exists public.product_combos (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  combo_id text not null,
  name text not null,
  tagline text,
  description text,
  category_id text,
  terms text,
  discount_percentage numeric(5, 2) not null default 0,
  price_rounding integer not null default 100,
  approval_status text not null default 'PENDIENTE_APROBACION_COMERCIAL',
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approval_note text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint product_combos_combo_id_format
    check (combo_id ~ '^[a-z0-9][a-z0-9-]{2,63}$'),
  constraint product_combos_name_length
    check (char_length(btrim(name)) between 2 and 120),
  constraint product_combos_discount_range
    check (discount_percentage >= 0 and discount_percentage <= 90),
  -- El redondeo del precio promocional baja a la centena: garantiza que el
  -- ahorro anunciado nunca sea menor que el real.
  constraint product_combos_rounding_check
    check (price_rounding in (1, 10, 100)),
  constraint product_combos_approval_status_check
    check (approval_status in (
      'PENDIENTE_APROBACION_COMERCIAL',
      'APROBADO_COMERCIAL',
      'SUSPENDIDO'
    )),
  -- Un combo aprobado sin constancia de quién y cuándo lo aprobó no es una
  -- aprobación: es un default que alguien se olvidó de revisar.
  constraint product_combos_approval_evidence_check
    check (approval_status <> 'APROBADO_COMERCIAL' or approved_at is not null),
  unique (business_id, combo_id)
);

create index if not exists product_combos_business_active_idx
  on public.product_combos (business_id, sort_order, combo_id)
  where is_active;

comment on table public.product_combos is
  'Definición autoritativa de combos. Declara componentes y descuento; nunca precios.';
comment on column public.product_combos.discount_percentage is
  'Descuento aprobado por el comercio. El precio promocional se deriva del catálogo vivo.';

create table if not exists public.product_combo_components (
  id uuid primary key default gen_random_uuid(),
  combo_id uuid not null references public.product_combos(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity integer not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  constraint product_combo_components_quantity_check
    check (quantity between 1 and 100),
  unique (combo_id, product_id)
);

create index if not exists product_combo_components_combo_idx
  on public.product_combo_components (combo_id, sort_order, product_id);

create table if not exists public.product_combo_substitutions (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.product_combo_components(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (component_id, product_id)
);

-- ===== Higiene de escritura =====

create or replace function public.bump_product_combo_revision()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  new.revision := old.revision;
  if new is distinct from old then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists product_combos_revision on public.product_combos;
create trigger product_combos_revision
  before update on public.product_combos
  for each row execute function public.bump_product_combo_revision();

-- ===== RLS =====
--
-- La góndola tiene que poder mostrar el combo antes de que el cliente se
-- registre, igual que los productos. Lo que NO es público es la definición de
-- un combo inactivo o suspendido: mostrarlo sería publicar una promoción que el
-- mostrador no va a respetar.

alter table public.product_combos enable row level security;
alter table public.product_combo_components enable row level security;
alter table public.product_combo_substitutions enable row level security;

revoke all privileges on table public.product_combos from public, anon, authenticated;
revoke all privileges on table public.product_combo_components from public, anon, authenticated;
revoke all privileges on table public.product_combo_substitutions from public, anon, authenticated;

grant select on table public.product_combos to anon, authenticated;
grant select on table public.product_combo_components to anon, authenticated;
grant select on table public.product_combo_substitutions to anon, authenticated;

drop policy if exists "approved combos are public" on public.product_combos;
create policy "approved combos are public"
on public.product_combos for select
to anon, authenticated
using (
  is_active
  and approval_status = 'APROBADO_COMERCIAL'
  and exists (
    select 1
      from public.businesses b
     where b.id = business_id
       and b.is_active
       and b.status = 'open'
       and b.ordering_verified
       and b.ordering_enabled
  )
);

drop policy if exists "commercial team reads every combo" on public.product_combos;
create policy "commercial team reads every combo"
on public.product_combos for select
to authenticated
using (public.has_business_role(business_id, array['owner', 'admin', 'staff']));

drop policy if exists "combo components follow combo access" on public.product_combo_components;
create policy "combo components follow combo access"
on public.product_combo_components for select
to anon, authenticated
using (
  exists (
    select 1
      from public.product_combos c
     where c.id = combo_id
       and c.is_active
       and c.approval_status = 'APROBADO_COMERCIAL'
  )
);

drop policy if exists "commercial team reads every combo component" on public.product_combo_components;
create policy "commercial team reads every combo component"
on public.product_combo_components for select
to authenticated
using (
  exists (
    select 1
      from public.product_combos c
     where c.id = combo_id
       and public.has_business_role(c.business_id, array['owner', 'admin', 'staff'])
  )
);

drop policy if exists "combo substitutions follow component access" on public.product_combo_substitutions;
create policy "combo substitutions follow component access"
on public.product_combo_substitutions for select
to anon, authenticated
using (
  exists (
    select 1
      from public.product_combo_components cc
      join public.product_combos c on c.id = cc.combo_id
     where cc.id = component_id
       and c.is_active
       and c.approval_status = 'APROBADO_COMERCIAL'
  )
);

-- ===== Resolución autoritativa =====
--
-- Devuelve SIEMPRE un objeto: un combo bloqueado se sigue pudiendo mostrar y
-- tiene que poder explicar por qué está bloqueado. Nunca devuelve un precio
-- parcial: si falta un solo componente no hay precio de lista que anunciar,
-- porque anunciar la suma de lo que sí está es anunciar un precio que no es el
-- del combo.

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
$$;

comment on function public.resolve_business_combo(uuid, text, integer) is
  'Resolución autoritativa de un combo contra el catálogo vivo. El navegador nunca dicta el precio.';

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
     and c.approval_status = 'APROBADO_COMERCIAL';
$$;

comment on function public.list_business_combos(uuid) is
  'Góndola de combos aprobados con precio, ahorro y stock derivados del catálogo vivo.';

revoke all on function public.resolve_business_combo(uuid, text, integer) from public;
revoke all on function public.list_business_combos(uuid) from public;
grant execute on function public.resolve_business_combo(uuid, text, integer) to anon, authenticated;
grant execute on function public.list_business_combos(uuid) to anon, authenticated;
