-- ============================================================================
--  TABA2 · Canal de pedidos por WhatsApp
-- ============================================================================
--
--  QUÉ ES ESTO
--  -----------
--  WhatsApp es OTRO FRONTEND del mismo comercio. No es un comercio nuevo, no
--  tiene catálogo propio, no tiene precios propios y no tiene stock propio.
--  Esta migración agrega exactamente tres cosas:
--
--    1. la identidad del canal (qué número de WhatsApp es qué cliente),
--    2. el estado de la conversación (un carrito de IDENTIFICADORES, sin precios),
--    3. lecturas autoritativas para poder CONTAR el catálogo por chat.
--
--  Lo que NO agrega: ninguna forma de crear un pedido, cobrar, reservar stock o
--  decidir un precio. Todo eso sigue pasando por `create_checkout_session`,
--  `prepare_mercadopago_preference` y `finalize_paid_checkout_session`, que son
--  las mismas funciones que usa la web. El bot no tiene una segunda puerta.
--
--  EL CARRITO NO GUARDA PRECIOS
--  ----------------------------
--  `whatsapp_conversations.cart` es una lista de `{product_id, quantity}` o
--  `{combo_id, quantity}` y nada más. La restricción `whatsapp_cart_is_valid` lo
--  hace cumplir en la base, no en el bot: si mañana alguien intenta guardar un
--  `unit_price` en el carrito del chat, el INSERT falla. Un precio guardado en
--  una conversación envejece en silencio y termina cobrando otra cosa que la
--  góndola.
--
--  LA COTIZACIÓN ES UNA PROYECCIÓN, NO UNA AUTORIDAD
--  -------------------------------------------------
--  `whatsapp_quote_cart` existe porque un chat necesita decir «van $ 21.150»
--  antes de pagar. Lee los MISMOS renglones vivos que `create_checkout_session`
--  (products.price, products.stock, businesses.delivery_fee, el descuento
--  aprobado del combo) y aplica la MISMA aritmética, pero no reserva nada y no
--  decide nada: es una lectura. El total que se cobra lo sigue calculando el
--  checkout con los renglones bloqueados. La equivalencia entre las dos no es
--  una promesa de este comentario: está verificada, carrito por carrito, en
--  `supabase/tests/whatsapp_commerce_channel.local.sql` y en el E2E sintético.
--
--  PII
--  ---
--  Del cliente se guarda lo mínimo para poder contestarle: el `wa_id` (que es su
--  teléfono, sin el cual no hay canal) y el nombre de perfil que Meta manda.
--  NO se guarda el texto de los mensajes: de cada mensaje entrante queda su
--  identificador -para deduplicar- y un hash del payload. Para los logs y las
--  métricas está `wa_id_hash`, que es lo único que puede salir del backend.
-- ============================================================================

-- ===== Identidad del canal =====

create table if not exists public.whatsapp_channel_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  -- El identificador que Meta le da al teléfono del cliente. Es su número en
  -- formato internacional sin '+'. Sin esto no hay a quién contestarle.
  wa_id text not null,
  -- Lo único que puede viajar a un log o a una métrica.
  wa_id_hash text not null,
  customer_id uuid references auth.users(id) on delete set null,
  display_name text,
  first_seen_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  blocked_at timestamptz,
  blocked_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_channel_contacts_wa_id_format
    check (wa_id ~ '^[0-9]{8,15}$'),
  constraint whatsapp_channel_contacts_wa_id_hash_format
    check (wa_id_hash ~ '^[a-f0-9]{64}$'),
  constraint whatsapp_channel_contacts_display_name_length
    check (display_name is null or char_length(display_name) <= 80),
  unique (business_id, wa_id)
);

create index if not exists whatsapp_channel_contacts_customer_idx
  on public.whatsapp_channel_contacts (customer_id)
  where customer_id is not null;

comment on table public.whatsapp_channel_contacts is
  'Vinculo entre un numero de WhatsApp y el cliente del comercio. PII minima: wa_id para poder contestar y hash para logs.';

-- ===== Estado de la conversación =====

-- Un carrito de chat es una lista de identificadores con cantidades. Nada más.
-- Esta función es la que impide que un precio entre por la ventana.
create or replace function public.whatsapp_cart_is_valid(p_cart jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select p_cart is not null
     and jsonb_typeof(p_cart) = 'array'
     and jsonb_array_length(p_cart) <= 40
     and not exists (
       select 1
         from jsonb_array_elements(p_cart) as line(value)
        where jsonb_typeof(line.value) <> 'object'
           or not (line.value ? 'quantity')
           or (line.value ->> 'quantity') !~ '^[1-9][0-9]{0,3}$'
           or (line.value ? 'product_id') = (line.value ? 'combo_id')
           or exists (
             select 1
               from jsonb_object_keys(line.value) as keys(key)
              where keys.key not in ('product_id', 'combo_id', 'quantity')
           )
           or (
             (line.value ? 'product_id')
             and (line.value ->> 'product_id') !~*
               '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
           )
           or (
             (line.value ? 'combo_id')
             and (line.value ->> 'combo_id') !~ '^[a-z0-9][a-z0-9-]{2,63}$'
           )
     );
$$;

comment on function public.whatsapp_cart_is_valid(jsonb) is
  'El carrito del chat solo admite identificadores y cantidades. Un precio en el carrito falla el INSERT.';

-- El borrador de dirección admite exactamente las claves que después acepta
-- `create_checkout_session`. Ni una más: lo que el chat junta es lo que el
-- checkout va a validar, no un superset que se descarta en silencio.
create or replace function public.whatsapp_draft_address_is_valid(p_address jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select p_address is not null
     and jsonb_typeof(p_address) = 'object'
     and not exists (
       select 1
         from jsonb_object_keys(p_address) as keys(key)
        where keys.key not in (
          'label', 'street', 'street_number', 'floor', 'apartment', 'reference',
          'city', 'province', 'postal_code', 'latitude', 'longitude',
          'geolocation_accuracy', 'source'
        )
     );
$$;

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.whatsapp_channel_contacts(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  state text not null default 'idle',
  cart jsonb not null default '[]'::jsonb,
  -- Nulo mientras la persona no eligió. Un default 'delivery' haría que el chat
  -- decidiera por ella y le cobrara un envío que nunca pidió.
  fulfillment_type text,
  -- Borrador de dirección mientras se arma. La dirección final la valida y la
  -- guarda `create_checkout_session`, igual que en la web.
  draft_address jsonb not null default '{}'::jsonb,
  age_confirmed_at timestamptz,
  checkout_session_id uuid references public.checkout_sessions(id) on delete set null,
  last_shelf text,
  revision bigint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_conversations_state_check
    check (state in (
      'idle', 'browsing', 'cart', 'awaiting_name', 'awaiting_address',
      'awaiting_age', 'awaiting_payment', 'completed'
    )),
  constraint whatsapp_conversations_fulfillment_check
    check (fulfillment_type is null or fulfillment_type in ('delivery', 'pickup')),
  constraint whatsapp_conversations_cart_check
    check (public.whatsapp_cart_is_valid(cart)),
  constraint whatsapp_conversations_draft_address_check
    check (public.whatsapp_draft_address_is_valid(draft_address)),
  constraint whatsapp_conversations_last_shelf_check
    check (last_shelf is null or last_shelf ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  unique (contact_id)
);

create index if not exists whatsapp_conversations_business_state_idx
  on public.whatsapp_conversations (business_id, state, updated_at desc);

comment on table public.whatsapp_conversations is
  'Estado de una conversacion de compra. El carrito guarda identificadores y cantidades; nunca precios ni stock.';

-- ===== Idempotencia de entrada =====
--
-- Meta reintenta una notificación hasta que recibe 200. Sin esta tabla, un
-- reintento suma dos veces la misma lata al carrito. La unicidad es del
-- identificador de mensaje que asigna Meta, que es estable entre reintentos.

create table if not exists public.whatsapp_inbound_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider_message_id text not null,
  contact_id uuid references public.whatsapp_channel_contacts(id) on delete set null,
  event_type text not null,
  payload_hash text not null,
  status text not null default 'received',
  attempts integer not null default 0,
  error_code text,
  received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  constraint whatsapp_inbound_events_status_check
    check (status in ('received', 'processing', 'processed', 'failed', 'ignored')),
  constraint whatsapp_inbound_events_payload_hash_format
    check (payload_hash ~ '^[a-f0-9]{64}$'),
  constraint whatsapp_inbound_events_message_id_length
    check (char_length(provider_message_id) between 1 and 180),
  constraint whatsapp_inbound_events_error_code_length
    check (error_code is null or char_length(error_code) <= 120),
  unique (business_id, provider_message_id)
);

create index if not exists whatsapp_inbound_events_status_idx
  on public.whatsapp_inbound_events (status, received_at)
  where status in ('received', 'processing');

comment on table public.whatsapp_inbound_events is
  'Recibo deduplicado de cada mensaje entrante. Guarda el identificador y un hash; nunca el texto del mensaje.';

-- ===== Salida: cola durable y deduplicada =====
--
-- Todo lo que sale por el canal pasa por acá, tanto la respuesta de una
-- conversación como el aviso de que el pago se acreditó. Dos motivos: que un
-- reintento no mande dos veces el mismo mensaje (`idempotency_key`), y que un
-- aviso no se pierda si el envío falla (se reintenta).

create table if not exists public.whatsapp_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  contact_id uuid not null references public.whatsapp_channel_contacts(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  idempotency_key text not null,
  kind text not null,
  -- Identificadores y números que ya son públicos para ese cliente: el código
  -- del pedido, el total que acaba de pagar. Nunca el texto renderizado.
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  provider_message_id text,
  error_code text,
  available_at timestamptz not null default clock_timestamp(),
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  constraint whatsapp_outbound_messages_status_check
    check (status in ('pending', 'sending', 'sent', 'failed', 'dead_letter')),
  constraint whatsapp_outbound_messages_kind_check
    check (kind ~ '^[a-z][a-z0-9_]{1,40}$'),
  constraint whatsapp_outbound_messages_attempts_check
    check (attempts >= 0),
  constraint whatsapp_outbound_messages_idempotency_length
    check (char_length(idempotency_key) between 8 and 180),
  unique (business_id, idempotency_key)
);

create index if not exists whatsapp_outbound_messages_pending_idx
  on public.whatsapp_outbound_messages (available_at)
  where status in ('pending', 'sending');

comment on table public.whatsapp_outbound_messages is
  'Cola durable de salida. Deduplicada por idempotency_key; guarda datos, no el texto renderizado.';

-- ===== Estantes del catálogo =====
--
-- Qué categorías ofrece el chat y en qué orden es CONFIGURACIÓN del comercio,
-- no lógica del bot: se cambia con una fila, no con un despliegue. Cada estante
-- apunta al catálogo vivo; ninguno guarda productos ni precios.

create table if not exists public.whatsapp_catalog_shelves (
  shelf_id text primary key,
  title text not null,
  kind text not null,
  category text,
  subcategory_pattern text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  constraint whatsapp_catalog_shelves_id_format
    check (shelf_id ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  constraint whatsapp_catalog_shelves_kind_check
    check (kind in ('combos', 'category', 'subcategory')),
  constraint whatsapp_catalog_shelves_title_length
    check (char_length(btrim(title)) between 2 and 24),
  constraint whatsapp_catalog_shelves_definition_check
    check (
      (kind = 'combos' and category is null and subcategory_pattern is null)
      or (kind = 'category' and category is not null and subcategory_pattern is null)
      or (kind = 'subcategory' and category is not null and subcategory_pattern is not null)
    )
);

comment on table public.whatsapp_catalog_shelves is
  'Presentacion del catalogo en el chat. Apunta al catalogo vivo; no guarda productos ni precios.';

-- El título entra en una fila de lista de WhatsApp, que admite 24 caracteres.
insert into public.whatsapp_catalog_shelves (shelf_id, title, kind, category, subcategory_pattern, sort_order)
values
  ('combos', 'Combos', 'combos', null, null, 10),
  ('cervezas', 'Cervezas', 'category', 'Cervezas', null, 20),
  ('fernet', 'Fernet', 'subcategory', 'Whisky y destilados', '%fernet%', 30),
  ('gaseosas', 'Gaseosas', 'category', 'Gaseosas', null, 40),
  ('aguas', 'Aguas', 'category', 'Aguas', null, 50),
  ('energeticas', 'Energéticas', 'category', 'Energéticas', null, 60),
  ('isotonicas', 'Isotónicas', 'category', 'Isotónicas', null, 70),
  ('jugos', 'Jugos', 'category', 'Jugos', null, 80),
  ('vinos', 'Vinos y espumantes', 'category', 'Vinos y espumantes', null, 90),
  ('destilados', 'Whisky y destilados', 'category', 'Whisky y destilados', null, 100),
  ('gins', 'Gins y vodkas', 'category', 'Gins y vodkas', null, 110),
  ('picadas', 'Picadas y deli', 'category', 'Picadas y deli', null, 120),
  ('hielo', 'Hielo y extras', 'category', 'Hielo y extras', null, 130),
  ('promos', 'Promos', 'category', 'Promos', null, 140)
on conflict (shelf_id) do nothing;

-- ===== RLS y privilegios =====
--
-- Ninguna de estas tablas es del navegador. El canal corre entero del lado del
-- servidor: sólo `service_role` las toca, y sólo a través de las funciones de
-- abajo.

alter table public.whatsapp_channel_contacts enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_inbound_events enable row level security;
alter table public.whatsapp_outbound_messages enable row level security;
alter table public.whatsapp_catalog_shelves enable row level security;

revoke all privileges on table public.whatsapp_channel_contacts from public, anon, authenticated;
revoke all privileges on table public.whatsapp_conversations from public, anon, authenticated;
revoke all privileges on table public.whatsapp_inbound_events from public, anon, authenticated;
revoke all privileges on table public.whatsapp_outbound_messages from public, anon, authenticated;
revoke all privileges on table public.whatsapp_catalog_shelves from public, anon, authenticated;

-- Explícito en vez de heredado: el canal escribe con service_role y conviene que
-- eso esté escrito acá y no dependa de los privilegios por defecto del proyecto.
grant select, insert, update on table public.whatsapp_channel_contacts to service_role;
grant select, insert, update on table public.whatsapp_conversations to service_role;
grant select, insert, update on table public.whatsapp_inbound_events to service_role;
grant select, insert, update on table public.whatsapp_outbound_messages to service_role;
grant select on table public.whatsapp_catalog_shelves to service_role;

-- ===== Higiene de escritura =====

create or replace function public.whatsapp_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists whatsapp_channel_contacts_touch on public.whatsapp_channel_contacts;
create trigger whatsapp_channel_contacts_touch
  before update on public.whatsapp_channel_contacts
  for each row execute function public.whatsapp_touch_updated_at();

drop trigger if exists whatsapp_outbound_messages_touch on public.whatsapp_outbound_messages;
create trigger whatsapp_outbound_messages_touch
  before update on public.whatsapp_outbound_messages
  for each row execute function public.whatsapp_touch_updated_at();

create or replace function public.whatsapp_bump_conversation_revision()
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

drop trigger if exists whatsapp_conversations_revision on public.whatsapp_conversations;
create trigger whatsapp_conversations_revision
  before update on public.whatsapp_conversations
  for each row execute function public.whatsapp_bump_conversation_revision();

-- ===== Búsqueda sin acentos y sin extensiones =====
--
-- `unaccent` no está garantizada en un proyecto vacío y la cadena de migraciones
-- tiene que poder reproducirse desde cero. `translate` alcanza para el alfabeto
-- que usa este catálogo.

create or replace function public.whatsapp_normalize_search(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select btrim(regexp_replace(
    translate(lower(coalesce(p_value, '')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
    '[^a-z0-9]+', ' ', 'g'
  ));
$$;

-- ===== Idempotencia de entrada =====

create or replace function public.whatsapp_register_inbound_event(
  p_business_id uuid,
  p_provider_message_id text,
  p_event_type text,
  p_payload_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.whatsapp_inbound_events%rowtype;
  v_inserted boolean := false;
begin
  if p_business_id is null
    or coalesce(btrim(p_provider_message_id), '') = ''
    or coalesce(btrim(p_event_type), '') = ''
    or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'evento entrante invalido' using errcode = '22023';
  end if;

  insert into public.whatsapp_inbound_events (
    business_id, provider_message_id, event_type, payload_hash, status, attempts
  ) values (
    p_business_id, btrim(p_provider_message_id), btrim(p_event_type), p_payload_hash, 'processing', 1
  )
  on conflict (business_id, provider_message_id) do nothing
  returning * into v_event;
  v_inserted := found;

  if not v_inserted then
    select * into v_event
      from public.whatsapp_inbound_events e
     where e.business_id = p_business_id
       and e.provider_message_id = btrim(p_provider_message_id)
     for update;
    -- Un mensaje que ya se procesó no se vuelve a procesar nunca. Uno que quedó
    -- a mitad de camino sí: Meta reintenta justamente porque no supo si salió.
    if v_event.status in ('processed', 'ignored') then
      return jsonb_build_object('event_id', v_event.id, 'duplicate', true, 'process', false);
    end if;
    update public.whatsapp_inbound_events
       set status = 'processing', attempts = attempts + 1
     where id = v_event.id
     returning * into v_event;
    return jsonb_build_object('event_id', v_event.id, 'duplicate', true, 'process', true);
  end if;

  return jsonb_build_object('event_id', v_event.id, 'duplicate', false, 'process', true);
end;
$$;

create or replace function public.whatsapp_complete_inbound_event(
  p_event_id uuid,
  p_status text,
  p_contact_id uuid default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_status not in ('processed', 'failed', 'ignored') then
    raise exception 'estado de evento invalido' using errcode = '22023';
  end if;
  update public.whatsapp_inbound_events
     set status = p_status,
         contact_id = coalesce(p_contact_id, contact_id),
         error_code = left(nullif(btrim(coalesce(p_error_code, '')), ''), 120),
         processed_at = case when p_status = 'processed' then clock_timestamp() else processed_at end
   where id = p_event_id;
  return found;
end;
$$;

-- ===== Identidad =====

create or replace function public.whatsapp_find_customer_by_phone(p_phone text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
  -- El cliente que ya compró por la web con ese mismo teléfono es el MISMO
  -- cliente. Devolver su id evita partir su historial en dos cuentas.
  select u.id
    from auth.users u
   where u.deleted_at is null
     and regexp_replace(coalesce(u.phone, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
     and regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') <> ''
   order by u.created_at
   limit 1;
$$;

create or replace function public.whatsapp_upsert_contact(
  p_business_id uuid,
  p_wa_id text,
  p_wa_id_hash text,
  p_display_name text default null,
  p_customer_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_contact public.whatsapp_channel_contacts%rowtype;
  v_conversation public.whatsapp_conversations%rowtype;
begin
  if p_business_id is null or p_wa_id !~ '^[0-9]{8,15}$' or p_wa_id_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'contacto de whatsapp invalido' using errcode = '22023';
  end if;

  insert into public.whatsapp_channel_contacts (
    business_id, wa_id, wa_id_hash, display_name, customer_id
  ) values (
    p_business_id, p_wa_id, p_wa_id_hash,
    left(nullif(btrim(coalesce(p_display_name, '')), ''), 80), p_customer_id
  )
  on conflict (business_id, wa_id) do update
     set last_seen_at = clock_timestamp(),
         display_name = coalesce(
           left(nullif(btrim(coalesce(excluded.display_name, '')), ''), 80),
           public.whatsapp_channel_contacts.display_name
         ),
         customer_id = coalesce(public.whatsapp_channel_contacts.customer_id, excluded.customer_id)
  returning * into v_contact;

  insert into public.whatsapp_conversations (contact_id, business_id)
  values (v_contact.id, p_business_id)
  on conflict (contact_id) do nothing;

  select * into v_conversation
    from public.whatsapp_conversations c
   where c.contact_id = v_contact.id;

  return jsonb_build_object(
    'contact_id', v_contact.id,
    'customer_id', v_contact.customer_id,
    'display_name', v_contact.display_name,
    'blocked', v_contact.blocked_at is not null,
    'conversation', jsonb_build_object(
      'id', v_conversation.id,
      'state', v_conversation.state,
      'cart', v_conversation.cart,
      'fulfillment_type', v_conversation.fulfillment_type,
      'draft_address', v_conversation.draft_address,
      'age_confirmed', v_conversation.age_confirmed_at is not null,
      'checkout_session_id', v_conversation.checkout_session_id,
      'last_shelf', v_conversation.last_shelf,
      'revision', v_conversation.revision
    )
  );
end;
$$;

create or replace function public.whatsapp_link_customer(
  p_contact_id uuid,
  p_customer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if p_contact_id is null or p_customer_id is null then
    raise exception 'vinculo de cliente invalido' using errcode = '22023';
  end if;
  update public.whatsapp_channel_contacts
     set customer_id = p_customer_id
   where id = p_contact_id
     and customer_id is null;
  return found;
end;
$$;

-- ===== Estado de la conversación =====

create or replace function public.whatsapp_save_conversation(
  p_contact_id uuid,
  p_expected_revision bigint,
  p_state text,
  p_cart jsonb,
  p_fulfillment_type text,
  p_draft_address jsonb,
  p_age_confirmed boolean,
  p_last_shelf text default null,
  p_checkout_session_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
begin
  select * into v_conversation
    from public.whatsapp_conversations c
   where c.contact_id = p_contact_id
   for update;
  if not found then
    raise exception 'conversacion inexistente' using errcode = 'P0002';
  end if;
  -- Dos mensajes seguidos del mismo cliente no pueden pisarse el carrito. El que
  -- llega con una revisión vieja se rechaza y su handler vuelve a leer.
  if p_expected_revision is not null and v_conversation.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'REVISION_CONFLICT', 'revision', v_conversation.revision);
  end if;

  update public.whatsapp_conversations
     set state = p_state,
         cart = coalesce(p_cart, '[]'::jsonb),
         fulfillment_type = coalesce(nullif(btrim(coalesce(p_fulfillment_type, '')), ''), fulfillment_type),
         draft_address = coalesce(p_draft_address, '{}'::jsonb),
         age_confirmed_at = case
           when coalesce(p_age_confirmed, false) then coalesce(age_confirmed_at, clock_timestamp())
           else null
         end,
         last_shelf = p_last_shelf,
         checkout_session_id = p_checkout_session_id
   where id = v_conversation.id
   returning * into v_conversation;

  return jsonb_build_object(
    'ok', true,
    'conversation', jsonb_build_object(
      'id', v_conversation.id,
      'state', v_conversation.state,
      'cart', v_conversation.cart,
      'fulfillment_type', v_conversation.fulfillment_type,
      'draft_address', v_conversation.draft_address,
      'age_confirmed', v_conversation.age_confirmed_at is not null,
      'checkout_session_id', v_conversation.checkout_session_id,
      'last_shelf', v_conversation.last_shelf,
      'revision', v_conversation.revision
    )
  );
end;
$$;

-- ===== Lecturas del catálogo vivo =====

create or replace function public.whatsapp_catalog_shelves(p_business_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  -- Un estante sin nada comprable HOY no se ofrece: mandar a alguien a una
  -- categoría vacía es hacerle perder un mensaje.
  select coalesce(jsonb_agg(
    jsonb_build_object('shelf_id', shelf.shelf_id, 'title', shelf.title, 'kind', shelf.kind, 'count', shelf.available)
    order by shelf.sort_order, shelf.shelf_id
  ), '[]'::jsonb)
    from (
      select s.shelf_id, s.title, s.kind, s.sort_order,
        case s.kind
          when 'combos' then (
            select count(*)
              from public.product_combos c
             where c.business_id = p_business_id
               and c.is_active
               and c.approval_status = 'APROBADO_COMERCIAL'
               and exists (select 1 from public.product_combo_components cc where cc.combo_id = c.id)
               and not exists (
                 select 1
                   from public.product_combo_components cc
                   left join public.products p
                     on p.id = cc.product_id
                    and p.business_id = p_business_id
                    and p.is_active and p.is_verified and p.available
                    and p.price_status = 'confirmed' and p.price > 0
                  where cc.combo_id = c.id
                    and (p.id is null or coalesce(p.stock, 0) < cc.quantity)
               )
          )
          else (
            select count(*)
              from public.products p
             where p.business_id = p_business_id
               and p.is_active and p.is_verified and p.available
               and p.price_status = 'confirmed' and p.price > 0
               and coalesce(p.stock, 0) > 0
               and p.category = s.category
               and (
                 s.subcategory_pattern is null
                 or lower(coalesce(p.subcategory, '')) like s.subcategory_pattern
                 or lower(coalesce(p.brand, '')) like s.subcategory_pattern
                 or lower(coalesce(p.name, '')) like s.subcategory_pattern
               )
          )
        end as available
      from public.whatsapp_catalog_shelves s
      where s.is_active
    ) as shelf
   where shelf.available > 0;
$$;

create or replace function public.whatsapp_catalog_products(
  p_business_id uuid,
  p_shelf_id text default null,
  p_query text default null,
  p_limit integer default 10,
  p_offset integer default 0,
  p_product_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_shelf public.whatsapp_catalog_shelves%rowtype;
  v_terms text[];
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 30);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  if nullif(btrim(coalesce(p_shelf_id, '')), '') is not null then
    select * into v_shelf from public.whatsapp_catalog_shelves s
     where s.shelf_id = btrim(p_shelf_id) and s.is_active;
    if not found or v_shelf.kind = 'combos' then
      return jsonb_build_object('shelf_id', p_shelf_id, 'total', 0, 'products', '[]'::jsonb);
    end if;
  end if;

  v_terms := case
    when nullif(public.whatsapp_normalize_search(p_query), '') is null then null
    else string_to_array(public.whatsapp_normalize_search(p_query), ' ')
  end;

  with matched as (
    select p.*
      from public.products p
     where p.business_id = p_business_id
       and p.is_active and p.is_verified and p.available
       and p.price_status = 'confirmed' and p.price > 0
       and coalesce(p.stock, 0) > 0
       and (p_product_ids is null or p.id = any (p_product_ids))
       and (
         v_shelf.shelf_id is null
         or (
           p.category = v_shelf.category
           and (
             v_shelf.subcategory_pattern is null
             or lower(coalesce(p.subcategory, '')) like v_shelf.subcategory_pattern
             or lower(coalesce(p.brand, '')) like v_shelf.subcategory_pattern
             or lower(coalesce(p.name, '')) like v_shelf.subcategory_pattern
           )
         )
       )
       and (
         v_terms is null
         or (
           select bool_and(
             public.whatsapp_normalize_search(
               concat_ws(' ', p.brand, p.name, p.variant, p.presentation, p.subcategory, p.category,
                         array_to_string(coalesce(p.tags, array[]::text[]), ' '))
             ) like '%' || term || '%'
           )
             from unnest(v_terms) as term
            where term <> ''
         )
       )
  )
  select jsonb_build_object(
    'shelf_id', v_shelf.shelf_id,
    'total', (select count(*) from matched),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id', page.id,
        'sku', page.sku,
        'name', page.name,
        'brand', page.brand,
        'presentation', page.presentation,
        'category', page.category,
        'subcategory', page.subcategory,
        'price', page.price,
        'stock', page.stock,
        'is_alcoholic', coalesce(page.is_alcoholic, false),
        'minimum_age', page.minimum_age
      ) order by page.sort_order, page.name, page.id)
        from (
          select m.* from matched m
           order by m.sort_order, m.name, m.id
           limit v_limit offset v_offset
        ) as page
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- El precio promocional de un combo se DERIVA. Esta función es la aritmética
-- exacta que aplica `create_checkout_session` sobre los renglones bloqueados;
-- tenerla en un solo lugar es lo que permite que la cotización del chat y el
-- cobro no puedan separarse sin que un test lo grite.
create or replace function public.combo_promotional_price(
  p_list_price numeric,
  p_discount_percentage numeric,
  p_price_rounding integer
)
returns numeric
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $$
  select floor((p_list_price * (100 - p_discount_percentage) / 100) / p_price_rounding) * p_price_rounding;
$$;

comment on function public.combo_promotional_price(numeric, numeric, integer) is
  'Aritmetica unica del precio promocional de un combo: la misma que aplica create_checkout_session.';

create or replace function public.whatsapp_available_combos(p_business_id uuid)
returns table (
  combo_id text,
  name text,
  tagline text,
  terms text,
  discount_percentage numeric,
  list_price numeric,
  promotional_price numeric,
  contains_alcohol boolean,
  minimum_age integer,
  max_units integer,
  components jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  select
    c.combo_id,
    c.name,
    c.tagline,
    c.terms,
    c.discount_percentage,
    parts.list_price,
    public.combo_promotional_price(parts.list_price, c.discount_percentage, c.price_rounding) as promotional_price,
    parts.contains_alcohol,
    parts.minimum_age,
    parts.max_units,
    parts.components
  from public.product_combos c
  cross join lateral (
    select
      coalesce(sum(cc.quantity * p.price), 0) as list_price,
      bool_or(coalesce(p.is_alcoholic, false)) as contains_alcohol,
      max(p.minimum_age) filter (where coalesce(p.is_alcoholic, false)) as minimum_age,
      coalesce(min(floor(coalesce(p.stock, 0) / cc.quantity)), 0)::integer as max_units,
      count(*) as priced_components,
      coalesce(jsonb_agg(jsonb_build_object(
        'product_id', p.id, 'name', p.name, 'presentation', p.presentation, 'quantity', cc.quantity
      ) order by cc.sort_order, cc.product_id), '[]'::jsonb) as components
      from public.product_combo_components cc
      left join public.products p
        on p.id = cc.product_id
       and p.business_id = c.business_id
       and p.is_active and p.is_verified and p.available
       and p.price_status = 'confirmed' and p.price > 0
     where cc.combo_id = c.id
       and p.id is not null
  ) as parts
  where c.business_id = p_business_id
    and c.is_active
    and c.approval_status = 'APROBADO_COMERCIAL'
    and parts.priced_components = (select count(*) from public.product_combo_components cc where cc.combo_id = c.id)
    and parts.list_price > 0
    and parts.max_units > 0
  order by c.sort_order, c.combo_id;
$$;

create or replace function public.whatsapp_catalog_combos(
  p_business_id uuid,
  p_limit integer default 10,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
  -- Sólo entran los combos cuyos componentes están TODOS comprables ahora, con
  -- stock suficiente. Un combo a medias no es una oferta, es una promesa rota.
  select jsonb_build_object(
    'shelf_id', 'combos',
    'total', (select count(*) from public.whatsapp_available_combos(p_business_id)),
    'combos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'combo_id', c.combo_id,
        'name', c.name,
        'tagline', c.tagline,
        'terms', c.terms,
        'discount_percentage', c.discount_percentage,
        'list_price', c.list_price,
        'promotional_price', c.promotional_price,
        'savings', c.list_price - c.promotional_price,
        'contains_alcohol', c.contains_alcohol,
        'minimum_age', c.minimum_age,
        'max_units', c.max_units,
        'components', c.components
      ))
        from (
          select * from public.whatsapp_available_combos(p_business_id)
          limit least(greatest(coalesce(p_limit, 10), 1), 30)
          offset greatest(coalesce(p_offset, 0), 0)
        ) as c
    ), '[]'::jsonb)
  );
$$;

-- ===== Cotización del carrito =====
--
-- Lectura. No reserva, no cobra, no decide. Existe para poder decir un total en
-- el chat con los mismos renglones vivos que va a leer el checkout.

create or replace function public.whatsapp_quote_cart(
  p_business_id uuid,
  p_cart jsonb,
  p_fulfillment_type text default 'delivery'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_business public.businesses%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_line record;
  v_product public.products%rowtype;
  v_combo public.product_combos%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_subtotal numeric(12, 2) := 0;
  v_discount numeric(12, 2) := 0;
  v_delivery numeric(12, 2) := 0;
  v_contains_alcohol boolean := false;
  v_minimum_age integer;
  v_fulfillment text := lower(btrim(coalesce(p_fulfillment_type, 'delivery')));
  v_units jsonb;
  v_list_price numeric(12, 2);
  v_promotional numeric(12, 2);
  v_declared integer;
  v_priced integer;
  v_now time;
begin
  if not public.whatsapp_cart_is_valid(coalesce(p_cart, '[]'::jsonb)) then
    raise exception 'carrito invalido' using errcode = '22023';
  end if;
  if v_fulfillment not in ('delivery', 'pickup') then
    raise exception 'modalidad invalida' using errcode = '22023';
  end if;

  select b.* into v_business from public.businesses b where b.id = p_business_id;
  if not found or not v_business.is_active or v_business.status <> 'open'
    or not v_business.ordering_enabled or not v_business.ordering_verified then
    return jsonb_build_object('ok', false, 'blockers', jsonb_build_array(
      jsonb_build_object('code', 'BUSINESS_CLOSED')
    ));
  end if;

  select s.* into v_settings from public.business_payment_settings s
   where s.business_id = p_business_id and s.provider = 'mercadopago';
  if not found or not v_settings.enabled or v_settings.checkout_mode <> 'checkout_pro' then
    v_blockers := v_blockers || jsonb_build_object('code', 'PAYMENTS_UNAVAILABLE');
  end if;

  if (v_fulfillment = 'delivery' and not v_business.delivery_enabled)
    or (v_fulfillment = 'pickup' and not v_business.pickup_enabled) then
    v_blockers := v_blockers || jsonb_build_object('code', 'FULFILLMENT_UNAVAILABLE');
  end if;

  if jsonb_array_length(coalesce(p_cart, '[]'::jsonb)) = 0 then
    return jsonb_build_object(
      'ok', false, 'currency', 'ARS', 'lines', '[]'::jsonb,
      'subtotal', 0, 'discount_total', 0, 'delivery_fee', 0, 'total', 0,
      'contains_alcohol', false,
      'blockers', v_blockers || jsonb_build_object('code', 'EMPTY_CART')
    );
  end if;

  -- Unidades consolidadas por producto: una lata suelta y la misma lata dentro
  -- de un combo compiten por el MISMO stock, igual que en el checkout.
  select coalesce(jsonb_object_agg(totals.product_id, totals.quantity), '{}'::jsonb)
    into v_units
    from (
      select merged.product_id::text as product_id, sum(merged.quantity)::integer as quantity
        from (
          select (line.value ->> 'product_id')::uuid as product_id,
                 (line.value ->> 'quantity')::integer as quantity
            from jsonb_array_elements(p_cart) as line(value)
           where line.value ? 'product_id'
          union all
          select cc.product_id, cc.quantity * (line.value ->> 'quantity')::integer
            from jsonb_array_elements(p_cart) as line(value)
            join public.product_combos pc
              on pc.business_id = p_business_id
             and pc.combo_id = (line.value ->> 'combo_id')
            join public.product_combo_components cc on cc.combo_id = pc.id
           where line.value ? 'combo_id'
        ) as merged
       group by merged.product_id
    ) as totals;

  -- El SUBTOTAL se arma sobre las unidades consolidadas, exactamente como lo
  -- arma `create_checkout_session`: un combo se reserva y se suma por sus
  -- COMPONENTES a precio de lista, y el ahorro del combo baja después como
  -- descuento. Sumar la línea de combo ya rebajada y encima restar el descuento
  -- lo descontaría dos veces. Acá también se decide disponibilidad, stock y +18
  -- de todo lo que el carrito toca, esté suelto o dentro de un combo.
  for v_line in
    select key::uuid as product_id, value::integer as quantity
      from jsonb_each_text(v_units)
     order by 1
  loop
    select p.* into v_product
      from public.products p
     where p.id = v_line.product_id and p.business_id = p_business_id;
    if not found or not v_product.is_active or not v_product.is_verified or not v_product.available
      or v_product.price_status <> 'confirmed' or v_product.price is null or v_product.price <= 0 then
      v_blockers := v_blockers || jsonb_build_object(
        'code', 'PRODUCT_UNAVAILABLE', 'product_id', v_line.product_id
      );
      continue;
    end if;
    if coalesce(v_product.stock, 0) < v_line.quantity then
      v_blockers := v_blockers || jsonb_build_object(
        'code', 'INSUFFICIENT_STOCK', 'product_id', v_line.product_id,
        'name', v_product.name, 'available', coalesce(v_product.stock, 0)
      );
    end if;
    if coalesce(v_product.is_alcoholic, false) then
      v_contains_alcohol := true;
      v_minimum_age := greatest(coalesce(v_minimum_age, 0), coalesce(v_product.minimum_age, 18));
    end if;
    v_subtotal := v_subtotal + (v_product.price * v_line.quantity);
  end loop;

  -- Las líneas sueltas son sólo presentación: lo que la persona sumó por fuera
  -- de un combo, a precio de lista.
  for v_line in
    select (line.value ->> 'product_id')::uuid as product_id,
           sum((line.value ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_cart) as line(value)
     where line.value ? 'product_id'
     group by (line.value ->> 'product_id')::uuid
     order by 1
  loop
    select p.* into v_product
      from public.products p
     where p.id = v_line.product_id and p.business_id = p_business_id;
    if not found then continue; end if;
    v_lines := v_lines || jsonb_build_object(
      'kind', 'product',
      'product_id', v_product.id,
      'sku', v_product.sku,
      'name', v_product.name,
      'presentation', v_product.presentation,
      'quantity', v_line.quantity,
      'unit_price', v_product.price,
      'subtotal', v_product.price * v_line.quantity
    );
  end loop;

  for v_line in
    select (line.value ->> 'combo_id') as combo_id,
           sum((line.value ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_cart) as line(value)
     where line.value ? 'combo_id'
     group by (line.value ->> 'combo_id')
     order by 1
  loop
    select c.* into v_combo
      from public.product_combos c
     where c.business_id = p_business_id and c.combo_id = v_line.combo_id;
    if not found or not v_combo.is_active or v_combo.approval_status <> 'APROBADO_COMERCIAL' then
      v_blockers := v_blockers || jsonb_build_object('code', 'COMBO_UNAVAILABLE', 'combo_id', v_line.combo_id);
      continue;
    end if;

    select count(*)::integer into v_declared
      from public.product_combo_components cc where cc.combo_id = v_combo.id;
    select count(*)::integer, coalesce(sum(cc.quantity * p.price), 0)
      into v_priced, v_list_price
      from public.product_combo_components cc
      join public.products p
        on p.id = cc.product_id
       and p.business_id = p_business_id
       and p.is_active and p.is_verified and p.available
       and p.price_status = 'confirmed' and p.price > 0
     where cc.combo_id = v_combo.id;
    if v_declared = 0 or v_priced <> v_declared or v_list_price <= 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'COMBO_UNAVAILABLE', 'combo_id', v_line.combo_id);
      continue;
    end if;

    if exists (
      select 1
        from public.product_combo_components cc
        join public.products p on p.id = cc.product_id
       where cc.combo_id = v_combo.id
         and coalesce(p.is_alcoholic, false)
    ) then
      v_contains_alcohol := true;
      select greatest(coalesce(v_minimum_age, 0), coalesce(max(p.minimum_age), 18))
        into v_minimum_age
        from public.product_combo_components cc
        join public.products p on p.id = cc.product_id
       where cc.combo_id = v_combo.id and coalesce(p.is_alcoholic, false);
    end if;

    v_promotional := public.combo_promotional_price(v_list_price, v_combo.discount_percentage, v_combo.price_rounding);
    if v_promotional <= 0 or v_promotional > v_list_price then
      v_blockers := v_blockers || jsonb_build_object('code', 'COMBO_UNAVAILABLE', 'combo_id', v_line.combo_id);
      continue;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'kind', 'combo',
      'combo_id', v_combo.combo_id,
      'name', v_combo.name,
      'quantity', v_line.quantity,
      'list_price', v_list_price,
      'promotional_price', v_promotional,
      'discount_amount', (v_list_price - v_promotional) * v_line.quantity,
      'subtotal', v_promotional * v_line.quantity
    );
    v_discount := v_discount + (v_list_price - v_promotional) * v_line.quantity;
  end loop;

  if v_discount > v_subtotal then
    v_blockers := v_blockers || jsonb_build_object('code', 'DISCOUNT_EXCEEDS_SUBTOTAL');
  end if;

  if v_contains_alcohol then
    if not v_business.alcohol_sales_enabled or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null then
      v_blockers := v_blockers || jsonb_build_object('code', 'ALCOHOL_NOT_ENABLED');
    else
      v_now := (clock_timestamp() at time zone v_business.alcohol_timezone)::time;
      if v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
        if v_now not between v_business.alcohol_sales_start and v_business.alcohol_sales_end then
          v_blockers := v_blockers || jsonb_build_object('code', 'ALCOHOL_OUTSIDE_HOURS');
        end if;
      elsif v_now between v_business.alcohol_sales_end and v_business.alcohol_sales_start then
        v_blockers := v_blockers || jsonb_build_object('code', 'ALCOHOL_OUTSIDE_HOURS');
      end if;
      v_minimum_age := greatest(coalesce(v_minimum_age, 0), v_business.alcohol_minimum_age);
    end if;
  end if;

  if v_fulfillment = 'delivery' then
    v_delivery := coalesce(v_business.delivery_fee, 0);
    if v_business.delivery_fee is null or v_business.minimum_delivery_subtotal is null then
      v_blockers := v_blockers || jsonb_build_object('code', 'DELIVERY_NOT_CONFIGURED');
    elsif (v_subtotal - v_discount) < v_business.minimum_delivery_subtotal then
      v_blockers := v_blockers || jsonb_build_object(
        'code', 'BELOW_DELIVERY_MINIMUM', 'minimum', v_business.minimum_delivery_subtotal,
        'missing', v_business.minimum_delivery_subtotal - (v_subtotal - v_discount)
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'currency', 'ARS',
    'fulfillment_type', v_fulfillment,
    'lines', v_lines,
    'subtotal', v_subtotal,
    'discount_total', v_discount,
    'delivery_fee', v_delivery,
    'total', v_subtotal - v_discount + v_delivery,
    'contains_alcohol', v_contains_alcohol,
    'minimum_age', v_minimum_age,
    'blockers', v_blockers
  );
end;
$$;

-- ===== Salida =====

create or replace function public.whatsapp_enqueue_outbound(
  p_business_id uuid,
  p_contact_id uuid,
  p_idempotency_key text,
  p_kind text,
  p_payload jsonb default '{}'::jsonb,
  p_conversation_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_message public.whatsapp_outbound_messages%rowtype;
begin
  insert into public.whatsapp_outbound_messages (
    business_id, contact_id, conversation_id, idempotency_key, kind, payload
  ) values (
    p_business_id, p_contact_id, p_conversation_id, p_idempotency_key, p_kind, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (business_id, idempotency_key) do nothing
  returning * into v_message;
  if not found then
    select * into v_message
      from public.whatsapp_outbound_messages m
     where m.business_id = p_business_id and m.idempotency_key = p_idempotency_key;
    return jsonb_build_object('message_id', v_message.id, 'duplicate', true, 'status', v_message.status);
  end if;
  return jsonb_build_object('message_id', v_message.id, 'duplicate', false, 'status', v_message.status);
end;
$$;

create or replace function public.whatsapp_claim_outbound(
  p_owner text,
  p_limit integer default 10,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_claimed jsonb;
begin
  if coalesce(btrim(p_owner), '') = '' then
    raise exception 'owner requerido' using errcode = '22023';
  end if;
  with candidate as (
    select m.id
      from public.whatsapp_outbound_messages m
     where m.status in ('pending', 'sending')
       -- Una respuesta de conversación no se guarda renderizada, así que nadie
       -- puede reintentarla desde la cola: se resuelve en su propio turno.
       and m.kind <> 'conversation_reply'
       and m.available_at <= clock_timestamp()
       and (m.lease_expires_at is null or m.lease_expires_at <= clock_timestamp())
     order by m.available_at
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
     for update skip locked
  ), leased as (
    update public.whatsapp_outbound_messages m
       set status = 'sending',
           lease_owner = p_owner,
           lease_expires_at = clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_lease_seconds, 60), 10), 600)),
           attempts = m.attempts + 1
      from candidate
     where m.id = candidate.id
     returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', leased.id,
    'contact_id', leased.contact_id,
    'conversation_id', leased.conversation_id,
    'kind', leased.kind,
    'payload', leased.payload,
    'attempts', leased.attempts,
    'wa_id', c.wa_id
  ) order by leased.created_at), '[]'::jsonb)
    into v_claimed
    from leased
    join public.whatsapp_channel_contacts c on c.id = leased.contact_id;
  return v_claimed;
end;
$$;

create or replace function public.whatsapp_settle_outbound(
  p_message_id uuid,
  p_owner text,
  p_status text,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_retry_after_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_message public.whatsapp_outbound_messages%rowtype;
begin
  select * into v_message from public.whatsapp_outbound_messages m
   where m.id = p_message_id for update;
  if not found or v_message.lease_owner is distinct from p_owner then
    return false;
  end if;
  if p_status = 'sent' then
    update public.whatsapp_outbound_messages
       set status = 'sent',
           provider_message_id = left(nullif(btrim(coalesce(p_provider_message_id, '')), ''), 180),
           sent_at = clock_timestamp(),
           lease_owner = null,
           lease_expires_at = null,
           error_code = null
     where id = p_message_id;
    return true;
  end if;
  if p_status <> 'retry' and p_status <> 'failed' then
    raise exception 'estado de salida invalido' using errcode = '22023';
  end if;
  -- Ocho intentos con espera creciente y después carta muerta. Un mensaje que no
  -- sale no puede quedar girando para siempre ni desaparecer sin registro.
  update public.whatsapp_outbound_messages
     set status = case
           when p_status = 'failed' or v_message.attempts >= 8 then 'dead_letter'
           else 'pending'
         end,
         error_code = left(nullif(btrim(coalesce(p_error_code, '')), ''), 120),
         available_at = clock_timestamp() + make_interval(
           secs => least(greatest(coalesce(p_retry_after_seconds, power(2, least(v_message.attempts, 6))::integer), 1), 900)
         ),
         lease_owner = null,
         lease_expires_at = null
   where id = p_message_id;
  return true;
end;
$$;

-- ===== El pago acreditado avisa por el mismo canal =====
--
-- El cliente compró por chat: la confirmación tiene que llegarle por chat, no
-- quedar esperando a que vuelva a escribir. El aviso se encola cuando el
-- checkout se convierte en pedido, que es el único instante en que eso es cierto.
--
-- El bloque de excepción no es decorativo: un fallo encolando un aviso NUNCA
-- puede voltear la finalización de un pedido ya pagado.

create or replace function public.whatsapp_notify_completed_order()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_conversation public.whatsapp_conversations%rowtype;
  v_order public.orders%rowtype;
begin
  if new.completed_order_id is null or old.completed_order_id is not null then
    return null;
  end if;
  begin
    select * into v_conversation
      from public.whatsapp_conversations c
     where c.checkout_session_id = new.id;
    if not found then return null; end if;

    select * into v_order from public.orders o where o.id = new.completed_order_id;
    if not found then return null; end if;

    perform public.whatsapp_enqueue_outbound(
      new.business_id,
      v_conversation.contact_id,
      'order-confirmed:' || new.completed_order_id::text,
      'order_confirmed',
      jsonb_build_object(
        'order_public_code', v_order.public_code,
        'total', v_order.total,
        'fulfillment_type', v_order.fulfillment_type
      ),
      v_conversation.id
    );

    update public.whatsapp_conversations
       set state = 'completed', cart = '[]'::jsonb, checkout_session_id = null
     where id = v_conversation.id;
  exception when others then
    -- El pedido ya está cobrado y creado. Un aviso que no se pudo encolar es un
    -- problema de canal, no motivo para perder la venta.
    return null;
  end;
  return null;
end;
$$;

drop trigger if exists checkout_sessions_notify_whatsapp on public.checkout_sessions;
create trigger checkout_sessions_notify_whatsapp
  after update on public.checkout_sessions
  for each row execute function public.whatsapp_notify_completed_order();

-- ===== Rate limit =====
--
-- El canal usa el MISMO limitador que los pagos en vez de fabricar otro. Sólo se
-- agregan los alcances nuevos; los existentes no cambian.

alter table public.payment_rate_limit_buckets
  drop constraint if exists payment_rate_limit_scope_check;
alter table public.payment_rate_limit_buckets
  add constraint payment_rate_limit_scope_check
  check (scope in (
    'checkout_session', 'preference', 'checkout_status', 'webhook', 'refund',
    'cancellation', 'worker', 'whatsapp_inbound', 'whatsapp_outbound'
  ));

create or replace function public.consume_payment_rate_limit(
  p_scope text,
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_bucket timestamptz;
  v_count integer;
begin
  if p_scope not in (
      'checkout_session', 'preference', 'checkout_status', 'webhook', 'refund',
      'cancellation', 'worker', 'whatsapp_inbound', 'whatsapp_outbound'
    )
    or p_subject_hash !~ '^[a-f0-9]{64}$'
    or p_limit not between 1 and 1000
    or p_window_seconds not between 10 and 3600 then
    raise exception 'rate limit invalido' using errcode = '22023';
  end if;
  v_bucket := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into public.payment_rate_limit_buckets (
    scope, subject_hash, bucket_started_at, request_count
  ) values (
    p_scope, p_subject_hash, v_bucket, 1
  ) on conflict (scope, subject_hash, bucket_started_at)
  do update set request_count = public.payment_rate_limit_buckets.request_count + 1
  returning request_count into v_count;
  return jsonb_build_object('allowed', v_count <= p_limit, 'count', v_count, 'limit', p_limit, 'bucket_started_at', v_bucket);
end;
$$;

-- ===== Privilegios de las funciones =====
--
-- Nada de esto es alcanzable desde un navegador. El canal es servidor.

revoke all on function public.whatsapp_cart_is_valid(jsonb) from public, anon, authenticated;
revoke all on function public.whatsapp_draft_address_is_valid(jsonb) from public, anon, authenticated;
-- Las funciones de disparador no las invoca nadie a mano; PostgreSQL verifica el
-- privilegio al crear el trigger, no al ejecutarlo, así que revocarlas no rompe
-- nada y cierra una superficie que por defecto quedaba abierta a PUBLIC.
revoke all on function public.whatsapp_touch_updated_at() from public, anon, authenticated;
revoke all on function public.whatsapp_bump_conversation_revision() from public, anon, authenticated;
revoke all on function public.whatsapp_notify_completed_order() from public, anon, authenticated;
revoke all on function public.whatsapp_normalize_search(text) from public, anon, authenticated;
revoke all on function public.whatsapp_register_inbound_event(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.whatsapp_complete_inbound_event(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.whatsapp_find_customer_by_phone(text) from public, anon, authenticated;
revoke all on function public.whatsapp_upsert_contact(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_link_customer(uuid, uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_save_conversation(uuid, bigint, text, jsonb, text, jsonb, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_catalog_shelves(uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_catalog_products(uuid, text, text, integer, integer, uuid[]) from public, anon, authenticated;
revoke all on function public.whatsapp_available_combos(uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_catalog_combos(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.whatsapp_quote_cart(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.whatsapp_enqueue_outbound(uuid, uuid, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_claim_outbound(text, integer, integer) from public, anon, authenticated;
revoke all on function public.whatsapp_settle_outbound(uuid, text, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.combo_promotional_price(numeric, numeric, integer) from public, anon;

-- Las dos que sostienen restricciones CHECK sí las necesita quien escribe: la
-- verificación de la restricción corre con los privilegios del que inserta.
grant execute on function public.whatsapp_cart_is_valid(jsonb) to service_role;
grant execute on function public.whatsapp_draft_address_is_valid(jsonb) to service_role;
grant execute on function public.whatsapp_normalize_search(text) to service_role;
grant execute on function public.whatsapp_register_inbound_event(uuid, text, text, text) to service_role;
grant execute on function public.whatsapp_complete_inbound_event(uuid, text, uuid, text) to service_role;
grant execute on function public.whatsapp_find_customer_by_phone(text) to service_role;
grant execute on function public.whatsapp_upsert_contact(uuid, text, text, text, uuid) to service_role;
grant execute on function public.whatsapp_link_customer(uuid, uuid) to service_role;
grant execute on function public.whatsapp_save_conversation(uuid, bigint, text, jsonb, text, jsonb, boolean, text, uuid) to service_role;
grant execute on function public.whatsapp_catalog_shelves(uuid) to service_role;
grant execute on function public.whatsapp_catalog_products(uuid, text, text, integer, integer, uuid[]) to service_role;
grant execute on function public.whatsapp_available_combos(uuid) to service_role;
grant execute on function public.whatsapp_catalog_combos(uuid, integer, integer) to service_role;
grant execute on function public.whatsapp_quote_cart(uuid, jsonb, text) to service_role;
grant execute on function public.whatsapp_enqueue_outbound(uuid, uuid, text, text, jsonb, uuid) to service_role;
grant execute on function public.whatsapp_claim_outbound(text, integer, integer) to service_role;
grant execute on function public.whatsapp_settle_outbound(uuid, text, text, text, text, integer) to service_role;
grant execute on function public.combo_promotional_price(numeric, numeric, integer) to authenticated, service_role;
