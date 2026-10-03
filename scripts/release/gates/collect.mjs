// Compuertas de release del e-commerce: la recolección de hechos.
//
// POR QUÉ TODA LA ENTRADA/SALIDA VIENE INYECTADA
// ----------------------------------------------
// Este módulo no sabe hablar con Supabase ni leer el disco. Recibe un `io` y
// arma el objeto `facts` que consume `evaluate.mjs`:
//
//   io.runReadOnlySql(sql)   → filas ([{ data: ... }]) del destino, por el
//                              endpoint de SÓLO LECTURA de la Management API
//   io.listFunctions()       → Edge Functions desplegadas en el destino
//   io.readRepoFile(ruta)    → texto de un archivo del repo
//   io.listRepoDir(ruta)     → [{ name, isDirectory }] de un directorio del repo
//   io.ciConclusion?()       → { conclusion, commit } del CI, si alguien lo trae
//   io.repoHead?()           → commit del árbol que se está evaluando
//   io.repoUncommitted?(rutas) → líneas de `git status --porcelain` de esas rutas
//   io.repoTracked?(ruta)    → true si git versiona algo bajo esa ruta
//   io.repoLastCommitTime?(rutas) → milisegundos del último commit que tocó alguna
//                              de esas rutas, o null si git no las conoce
//   io.listReferenceFunctions?() → Edge Functions del entorno de referencia
//   io.listSecrets?()        → secretos del destino como [{ name, digest }]: el
//                              nombre y la HUELLA SHA-256 que devuelve la
//                              Management API, nunca el valor. Se comparan acá
//                              contra los valores públicos del contrato y lo que
//                              queda en `facts` es un estado (ENABLED, ABSENT…):
//                              ni la huella ni el valor salen de este archivo.
//   io.projectRef?           → ref del proyecto que responde (sólo evidencia)
//
// Así los tests corren sin red y el cableado real (`live-io.mjs`) queda en un
// archivo aparte, chico, que los tests no importan.
//
// LAS DOS GARANTÍAS DE ESTE ARCHIVO
// ---------------------------------
//   1. No escribe en el destino. Son tres cosas juntas, y ninguna alcanza sola:
//      (a) el SQL sale únicamente de los constructores estáticos de `SQL`, donde
//          lo único que se interpola es un UUID validado y un entero;
//      (b) viaja por el endpoint de SÓLO LECTURA de la Management API (rol
//          `supabase_read_only_user`, transacción de sólo lectura);
//      (c) antes de salir pasa por `assertSelectOnly`: una sola sentencia, que
//          empieza con SELECT o WITH, sin verbos de escritura y que sólo llama a
//          funciones de una lista cerrada.
//      `assertSelectOnly` es el segundo cerrojo, no la garantía: revisa texto, no
//      entiende SQL. La garantía es (b); el test aplica (c) a cada consulta.
//   2. No se cae. Un recolector que falla devuelve `{ ok: false, error }` y los
//      demás siguen. Que falte una función que la misión todavía está agregando
//      (`private.order_intake_guard`, `get_store_opening_readiness`) es un
//      hecho —«no existe»—, no una excepción.
//
// Ninguna consulta devuelve credenciales, identificadores de cuenta, teléfonos
// ni correos: de Mercado Pago salen sólo estados y booleanos.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const COLLECT_TARGETS = Object.freeze(['staging', 'controlled-production']);
export const PAYMENT_CERTIFICATION_PATH = 'docs/ecommerce-hardening/payment-certification.json';
export const FINDINGS_REGISTER_PATH = 'docs/ecommerce-hardening/findings-register.json';
export const MIGRATIONS_DIR = 'supabase/migrations';
export const FUNCTIONS_DIR = 'supabase/functions';
export const SUPABASE_CONFIG_PATH = 'supabase/config.toml';
// Lo que el veredicto lee del árbol de trabajo (más la herramienta misma). Si
// algo de esto tiene cambios sin commitear, lo evaluado no es el commit del CI.
export const RELEASE_INPUT_PATHS = Object.freeze([
  FINDINGS_REGISTER_PATH, PAYMENT_CERTIFICATION_PATH, MIGRATIONS_DIR, FUNCTIONS_DIR, SUPABASE_CONFIG_PATH, 'scripts/release',
]);
// La evidencia de una certificación vive donde el repo guarda evidencia.
export const EVIDENCE_ROOTS = Object.freeze(['artifacts/', 'docs/']);
const MIN_PRODUCTS_RANGE = Object.freeze({ min: 1, max: 500 });

// ── El cerrojo de sólo lectura ───────────────────────────────────────────────

const WRITE_VERBS = /\b(insert|update|delete|merge|upsert|truncate|alter|drop|create|grant|revoke|comment|copy|call|do|execute|prepare|deallocate|vacuum|analyze|refresh|reindex|cluster|lock|listen|notify|set|reset|begin|start|commit|rollback|savepoint|into|returning)\b/i;
// Funciones que cambian estado aunque la sentencia empiece con SELECT.
const SIDE_EFFECT_CALLS = /\b(set_config|nextval|setval|pg_advisory\w*|pg_notify|pg_sleep|pg_terminate_backend|pg_cancel_backend|pg_reload_conf|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_\w+|dblink\w*|pg_logical_\w+|pg_create_\w+|pg_drop_\w+|pg_switch_wal)\s*\(/i;
// Todo lo que en estas consultas va seguido de un paréntesis: palabras del
// lenguaje y funciones que sólo leen. La lista es cerrada a propósito. Una
// lista de funciones prohibidas siempre se queda corta: `query_to_xml('delete
// …')` ejecuta el texto que recibe, y cualquier función del esquema `public`
// puede escribir aunque se la llame desde un SELECT.
const PAREN_KEYWORDS = Object.freeze(['select', 'with', 'as', 'from', 'where', 'and', 'or', 'not', 'in', 'on', 'exists', 'filter',
  'join', 'when', 'then', 'else', 'case', 'by', 'over', 'any', 'all', 'union', 'limit']);
const READ_ONLY_CALLS = Object.freeze(['jsonb_build_object', 'jsonb_agg', 'to_jsonb', 'coalesce', 'count', 'bool_or', 'bool_and',
  'char_length', 'btrim', 'regexp_replace', 'position', 'current_setting', 'pg_get_constraintdef',
  // La única función del proyecto que se llama: la preparación de apertura, que sólo lee.
  'public.get_store_opening_readiness']);
const ALLOWED_BEFORE_PAREN = new Set([...PAREN_KEYWORDS, ...READ_ONLY_CALLS]);

/**
 * La sentencia con cada literal `'…'` reemplazado por `''`. Con cadenas
 * `E'…'` (y las otras con prefijo) la barra invertida escapa la comilla y ya
 * no se sabe dónde termina el literal; todo lo que sigue depende de saberlo,
 * así que se rechazan. Estas consultas no las usan.
 */
function withoutLiterals(statement) {
  let code = '';
  for (let index = 0; index < statement.length; index += 1) {
    if (statement[index] !== "'") { code += statement[index]; continue; }
    if (/(^|[^A-Za-z0-9_])(?:[eEbBxXnN]|[uU]&)$/.test(code)) throw Error('SQL_NOT_READ_ONLY:prefixed string literals are not allowed');
    let from = index + 1;
    for (;;) {
      const close = statement.indexOf("'", from);
      if (close === -1) throw Error('SQL_NOT_READ_ONLY:unterminated string literal');
      // Dos comillas seguidas son una comilla adentro del literal.
      if (statement[close + 1] === "'") { from = close + 2; continue; }
      index = close;
      break;
    }
    code += "''";
  }
  return code;
}

/**
 * Lanza si el texto no es UNA sentencia de lectura de las que arma este
 * archivo. Devuelve el mismo texto. Es un filtro de texto: el segundo cerrojo.
 */
export function assertSelectOnly(sql) {
  const statement = String(sql ?? '').trim();
  if (!/^(select|with)\b/i.test(statement)) throw Error('SQL_NOT_READ_ONLY:must start with SELECT or WITH');
  if (statement.includes(';')) throw Error('SQL_NOT_READ_ONLY:single statement only');
  if (/--|\/\*/.test(statement)) throw Error('SQL_NOT_READ_ONLY:comments are not allowed');
  // `$$…$$` es otra forma de escribir una cadena, con una comilla suelta adentro
  // si hace falta: ni en un literal se admite el signo.
  if (statement.includes('$')) throw Error('SQL_NOT_READ_ONLY:dollar quoting is not allowed');
  // Los literales no cuentan: 'confirmed' o 'a confirmar' no son verbos.
  const code = withoutLiterals(statement);
  if (code.includes('"')) throw Error('SQL_NOT_READ_ONLY:quoted identifiers are not allowed');
  const verb = WRITE_VERBS.exec(code);
  if (verb) throw Error(`SQL_NOT_READ_ONLY:${verb[1].toLowerCase()}`);
  const call = SIDE_EFFECT_CALLS.exec(code);
  if (call) throw Error(`SQL_NOT_READ_ONLY:${call[1].toLowerCase()}`);
  if (/\bfor\s+(no\s+key\s+|key\s+)?(share)\b/i.test(code)) throw Error('SQL_NOT_READ_ONLY:row lock');
  for (const [, name] of code.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) {
    if (!ALLOWED_BEFORE_PAREN.has(name.toLowerCase())) throw Error(`SQL_NOT_READ_ONLY:call not allowed:${name.toLowerCase().slice(0, 60)}`);
  }
  return statement;
}

function businessLiteral(businessId) {
  // El id se interpola en el SQL: sólo entra si es un UUID, sin excepción.
  if (!UUID.test(String(businessId ?? ''))) throw Error('BUSINESS_ID_INVALID');
  return `'${String(businessId).toLowerCase()}'::uuid`;
}

// ── Las consultas ────────────────────────────────────────────────────────────
// Cada una devuelve UNA fila con UNA columna `data` (jsonb). Los nombres de
// columna salen de las definiciones vivas (158 migraciones + la del guardián).

// La llamada al guardián tal como la escribe una función: el nombre calificado
// y el paréntesis, con o sin espacio en el medio. Es una expresión regular de
// PostgreSQL, por eso el punto y el paréntesis van escapados.
const GUARD_CALL = String.raw`private\.order_intake_guard\s*\(`;

export const SQL = Object.freeze({
  /** Quién está mirando: tiene que ser el rol de sólo lectura, en transacción de sólo lectura. */
  observer: () => `
    select jsonb_build_object(
      'current_user', current_user,
      'transaction_read_only', current_setting('transaction_read_only')) as data`,

  // El comercio se lee como jsonb y se eligen claves: una columna que el destino
  // todavía no tiene (`order_intake_guard_mode` antes de 20261001180000) da null
  // en vez de romper la consulta entera.
  business: (businessId) => `
    with b as (
      select to_jsonb(x) as j from public.businesses x where x.id = ${businessLiteral(businessId)}
    )
    select jsonb_build_object(
      'id', j -> 'id',
      'slug', j -> 'slug',
      'status', j -> 'status',
      'is_active', j -> 'is_active',
      'qa_fixture', j -> 'qa_fixture',
      'ordering_enabled', j -> 'ordering_enabled',
      'ordering_verified', j -> 'ordering_verified',
      'currency_code', j -> 'currency_code',
      'delivery_enabled', j -> 'delivery_enabled',
      'pickup_enabled', j -> 'pickup_enabled',
      'delivery_fee', j -> 'delivery_fee',
      'minimum_delivery_subtotal', j -> 'minimum_delivery_subtotal',
      'hours_enforced', j -> 'hours_enforced',
      'delivery_zone_enforced', j -> 'delivery_zone_enforced',
      'delivery_max_radius_meters', j -> 'delivery_max_radius_meters',
      'operating_timezone', j -> 'operating_timezone',
      'timezone_valid', exists (
        select 1 from pg_catalog.pg_timezone_names t where t.name = j ->> 'operating_timezone'),
      'address_ok', char_length(regexp_replace(btrim(coalesce(j ->> 'address', '')), '\\s+', ' ', 'g')) >= 5
        and regexp_replace(btrim(coalesce(j ->> 'address', '')), '\\s+', ' ', 'g') !~* '(a confirmar|no publicad|sin direcci)',
      'rider_presence_required', j -> 'rider_presence_required',
      'abandoned_order_minutes', j -> 'abandoned_order_minutes',
      'stock_reservation_minutes', j -> 'stock_reservation_minutes',
      'order_intake_guard_mode', j -> 'order_intake_guard_mode') as data
    from b`,

  serviceHours: (businessId) => `
    select jsonb_build_object(
      'delivery', count(*) filter (where h.channel = 'delivery'),
      'pickup', count(*) filter (where h.channel = 'pickup'),
      'alcohol', count(*) filter (where h.channel = 'alcohol')) as data
    from public.business_service_hours h
    where h.business_id = ${businessLiteral(businessId)}`,

  // El envío y el mínimo efectivos de una zona son los propios o, si no trae,
  // los del comercio: la misma regla que `resolve_delivery_zone`.
  deliveryZones: (businessId) => `
    select jsonb_build_object(
      'total', count(*),
      'active', count(*) filter (where z.is_active),
      'active_without_fee', count(*) filter (
        where z.is_active and coalesce(z.delivery_fee, b.delivery_fee) is null),
      'active_without_minimum', count(*) filter (
        where z.is_active and coalesce(z.minimum_subtotal, b.minimum_delivery_subtotal) is null)) as data
    from public.delivery_zones z
    join public.businesses b on b.id = z.business_id
    where z.business_id = ${businessLiteral(businessId)}`,

  // «Público» es el predicado de la política RLS `production verified products
  // are public`. Los CHECK de `products` ya impiden casi todo lo que se cuenta
  // acá; la compuerta lo mide igual, porque un CHECK se puede haber quitado.
  catalog: (businessId) => `
    with p as (
      select x.sku, x.is_active, x.is_verified, x.available, x.merchant_available, x.stock, x.price, x.price_status,
             x.catalog_origin,
             x.catalog_asset_id is not null and x.image_url is not null and a.approved_at is not null
               and a.rights_status is distinct from 'UNAPPROVED_QA' as approved_image
        from public.products x
        left join public.catalog_assets a on a.id = x.catalog_asset_id
       where x.business_id = ${businessLiteral(businessId)}
    )
    select jsonb_build_object(
      'total', count(*),
      'available', count(*) filter (where available),
      'public', count(*) filter (
        where available and is_active and is_verified and stock is not null and stock > 0),
      'available_unverified', count(*) filter (where available and not is_verified),
      'available_without_intent', count(*) filter (where available and merchant_available is not true),
      'available_inactive', count(*) filter (where available and not is_active),
      'available_without_stock', count(*) filter (where available and (stock is null or stock <= 0)),
      'available_bad_price', count(*) filter (where available and (price is null or price <= 0)),
      'available_price_not_confirmed', count(*) filter (
        where available and price_status is distinct from 'confirmed'),
      'available_non_commercial', count(*) filter (
        where available and catalog_origin is distinct from 'commercial'),
      'available_without_approved_image', count(*) filter (where available and approved_image is not true),
      'pending_price_total', count(*) filter (where price_status = 'pending'),
      'image_policy_applies', coalesce((
        select bool_or(position(${businessLiteral(businessId)}::text in pg_get_constraintdef(c.oid)) > 0)
          from pg_catalog.pg_constraint c
          join pg_catalog.pg_class r on r.oid = c.conrelid
          join pg_catalog.pg_namespace n on n.oid = r.relnamespace
         where n.nspname = 'public' and r.relname = 'products'
           and c.conname = 'cp_published_requires_approved_image'), false),
      'approval_offenders', coalesce((
        select jsonb_agg(o.sku order by o.sku) from (
          select coalesce(sku, '(sin sku)') as sku from p
           where available and (not is_verified or merchant_available is not true)
           order by 1 limit 20) o), '[]'::jsonb),
      'image_offenders', coalesce((
        select jsonb_agg(o.sku order by o.sku) from (
          select coalesce(sku, '(sin sku)') as sku from p
           where available and approved_image is not true
           order by 1 limit 20) o), '[]'::jsonb),
      'non_commercial_offenders', coalesce((
        select jsonb_agg(o.sku order by o.sku) from (
          select coalesce(sku, '(sin sku)') as sku from p
           where available and catalog_origin is distinct from 'commercial'
           order by 1 limit 20) o), '[]'::jsonb),
      'price_offenders', coalesce((
        select jsonb_agg(o.sku order by o.sku) from (
          select coalesce(sku, '(sin sku)') as sku from p
           where available and (price is null or price <= 0 or price_status is distinct from 'confirmed')
           order by 1 limit 20) o), '[]'::jsonb)) as data
    from p`,

  // «Activo» como lo cuenta la preparación de apertura: membresía activa y la
  // persona no deshabilitada. Sólo cantidades por rol: ni ids ni correos.
  team: (businessId) => `
    select jsonb_build_object(
      'owners', count(*) filter (where m.role = 'owner'),
      'admins', count(*) filter (where m.role = 'admin'),
      'staff', count(*) filter (where m.role = 'staff'),
      'riders', count(*) filter (where m.role = 'rider')) as data
    from public.business_members m
    left join public.identity_user_security s on s.business_id = m.business_id and s.user_id = m.user_id
    where m.business_id = ${businessLiteral(businessId)} and m.is_active and s.disabled_at is null`,

  // De Mercado Pago salen estados y booleanos. La credencial se mira sólo como
  // «está o no está», y vendedor/aplicación sólo como «coinciden o no».
  mercadoPago: (businessId) => `
    select jsonb_build_object(
      'settings', (
        select jsonb_build_object(
          'enabled', s.enabled,
          'environment', s.environment,
          'checkout_mode', s.checkout_mode,
          'currency', s.currency,
          'reserve_stock', s.reserve_stock,
          'production_review_status', s.production_review_status)
          from public.business_payment_settings s
         where s.business_id = ${businessLiteral(businessId)} and s.provider = 'mercadopago'),
      'connections', coalesce((
        select jsonb_agg(jsonb_build_object(
          'environment', c.environment,
          'status', c.status,
          'has_credential', c.protected_tokens is not null,
          'expires_at', c.expires_at,
          'matches_settings', exists (
            select 1 from public.business_payment_settings s
             where s.business_id = c.business_id and s.provider = 'mercadopago'
               and s.environment = c.environment
               and s.collector_id = c.seller_id and s.application_id = c.application_id)) order by c.environment)
          from public.mp_seller_connections c
         where c.business_id = ${businessLiteral(businessId)}), '[]'::jsonb)) as data`,

  migrationLedger: () => `
    select coalesce(jsonb_agg(jsonb_build_object('version', m.version, 'name', m.name) order by m.version), '[]'::jsonb) as data
    from supabase_migrations.schema_migrations m`,

  // Existencia por catálogo del sistema: no depende de tener EXECUTE sobre las
  // funciones, y que no existan es una respuesta, no un error. Las dos puertas
  // por las que nace un pedido tienen que llamar al guardián en TODAS sus
  // sobrecargas: una sobrecarga vieja sin guardián es la puerta abierta.
  // Se busca la LLAMADA (`private.order_intake_guard(`), no el nombre suelto:
  // las puertas también leen la columna `order_intake_guard_mode`, y una
  // redefinición que quitara la llamada y dejara esa lectura seguiría «cableada».
  abuse: () => `
    select jsonb_build_object(
      'guard_function_exists', exists (
        select 1 from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid = f.pronamespace
         where n.nspname = 'private' and f.proname = 'order_intake_guard'),
      'readiness_function_exists', exists (
        select 1 from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid = f.pronamespace
         where n.nspname = 'public' and f.proname = 'get_store_opening_readiness'),
      'guard_doors', jsonb_build_object(
        'create_order_with_items', coalesce((
          select bool_and(f.prosrc ~ '${GUARD_CALL}')
            from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid = f.pronamespace
           where n.nspname = 'public' and f.proname = 'create_order_with_items'), false),
        'create_checkout_session', coalesce((
          select bool_and(f.prosrc ~ '${GUARD_CALL}')
            from pg_catalog.pg_proc f join pg_catalog.pg_namespace n on n.oid = f.pronamespace
           where n.nspname = 'public' and f.proname = 'create_checkout_session'), false))) as data`,

  // Informativo. El rol de sólo lectura puede no tener EXECUTE: se tolera.
  readiness: (businessId, minProducts) => `
    select public.get_store_opening_readiness(${businessLiteral(businessId)}, ${Number.isInteger(minProducts) ? minProducts : 1}) as data`,

  // El lado de la base del dinero real, para TODO el destino y no sólo para el
  // comercio evaluado: cualquier comercio con Mercado Pago encendido en
  // producción y un vendedor productivo conectado puede cobrar si la plataforma
  // lo deja. Sólo cantidades. Se cuenta con la condición mínima (encendido,
  // producción, vendedor conectado): sumar más condiciones sólo podría bajar la
  // cuenta, y contar de más dice «posible», que es el lado seguro.
  realMoneyBusinesses: () => `
    with s as (
      select x.enabled, x.environment,
             exists (
               select 1 from public.mp_seller_connections c
                where c.business_id = x.business_id and c.environment = 'production' and c.status = 'connected') as seller_connected
        from public.business_payment_settings x
       where x.provider = 'mercadopago'
    )
    select jsonb_build_object(
      'settings_enabled_production', count(*) filter (where s.enabled and s.environment = 'production'),
      'chargeable_production', count(*) filter (where s.enabled and s.environment = 'production' and s.seller_connected),
      'connected_production_sellers', (
        select count(*) from public.mp_seller_connections c
         where c.environment = 'production' and c.status = 'connected')) as data
    from s`,
});

// ── El interruptor de dinero real (EDGE-03) ──────────────────────────────────
// Los nombres y el único valor que abre son los de
// supabase/functions/_shared/real-money-gate.ts; un test los compara.

export const REAL_MONEY_SWITCH = 'MERCADOPAGO_REAL_MONEY_ENABLED';
export const REAL_MONEY_SWITCH_OPEN_VALUE = 'enabled';
export const LEGACY_SMOKE_CONFIRMATION = 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION';

// Los valores que se reconocen por su huella. Son constantes PÚBLICAS del
// contrato (`test`, `approved`, `enabled`): adivinar por huella un valor de
// verdad secreto (un token) es exactamente lo que esta herramienta no hace.
const KNOWN_SECRET_VALUES = Object.freeze({
  MERCADOPAGO_ENVIRONMENT: Object.freeze({ test: 'TEST', production: 'PRODUCTION' }),
  MERCADOPAGO_PRODUCTION_REVIEW_STATUS: Object.freeze({
    approved: 'APPROVED', not_requested: 'NOT_APPROVED', pending: 'NOT_APPROVED', rejected: 'NOT_APPROVED',
  }),
  [REAL_MONEY_SWITCH]: Object.freeze({ [REAL_MONEY_SWITCH_OPEN_VALUE]: 'ENABLED' }),
});
// Qué es una huella válida que no coincide con ningún valor conocido. Para el
// interruptor eso PRUEBA que no vale `enabled`: la compuerta compara exacto.
// Para el entorno y la revisión no prueba nada: las funciones recortan (y el
// entorno lo pasan a minúsculas), así que `Production` o ` approved` abren allá
// y acá no coinciden. Eso queda UNRECOGNIZED, y UNRECOGNIZED no es «cerrado».
const UNMATCHED_SECRET_STATE = Object.freeze({
  MERCADOPAGO_ENVIRONMENT: 'UNRECOGNIZED',
  MERCADOPAGO_PRODUCTION_REVIEW_STATUS: 'UNRECOGNIZED',
  [REAL_MONEY_SWITCH]: 'NOT_ENABLED',
});
const SHA256_HEX = /^[0-9a-f]{64}$/;

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Del listado de secretos ([{ name, digest }]) a un estado por secreto:
 *
 *   MERCADOPAGO_ENVIRONMENT               ABSENT | TEST | PRODUCTION | UNRECOGNIZED | UNREADABLE
 *   MERCADOPAGO_PRODUCTION_REVIEW_STATUS  ABSENT | APPROVED | NOT_APPROVED | UNRECOGNIZED | UNREADABLE
 *   MERCADOPAGO_REAL_MONEY_ENABLED        ABSENT | ENABLED | NOT_ENABLED | UNREADABLE
 *   MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION  ABSENT | PRESENT
 *
 * UNREADABLE es una entrada sin una huella SHA-256 legible: no se sabe qué vale.
 * Un listado con una entrada sin nombre o con un nombre repetido no se lee: no
 * se sabe cuál de las dos ve el runtime. Ni la huella ni el valor se devuelven.
 */
export async function classifyRealMoneySecrets(list) {
  if (!Array.isArray(list)) throw Error('SECRETS_NOT_A_LIST');
  const digests = new Map();
  for (const entry of list) {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (!name) throw Error('SECRETS_ENTRY_WITHOUT_NAME');
    if (digests.has(name)) throw Error('SECRETS_DUPLICATE_NAME');
    digests.set(name, typeof entry?.digest === 'string' ? entry.digest.trim().toLowerCase() : null);
  }
  const states = {};
  for (const [name, known] of Object.entries(KNOWN_SECRET_VALUES)) {
    if (!digests.has(name)) { states[name] = 'ABSENT'; continue; }
    const digest = digests.get(name);
    if (!digest || !SHA256_HEX.test(digest)) { states[name] = 'UNREADABLE'; continue; }
    let state = UNMATCHED_SECRET_STATE[name];
    for (const [value, label] of Object.entries(known)) {
      if ((await sha256Hex(value)) === digest) { state = label; break; }
    }
    states[name] = state;
  }
  // La variable vieja ya no abre nada: alcanza con saber si está.
  states[LEGACY_SMOKE_CONFIRMATION] = digests.has(LEGACY_SMOKE_CONFIRMATION) ? 'PRESENT' : 'ABSENT';
  return states;
}

// ── Utilidades ───────────────────────────────────────────────────────────────

// El motivo de un fallo termina en `facts` y en reportes que se commitean: una
// ruta de disco de quien corrió la herramienta no tiene nada que hacer ahí.
const ABSOLUTE_PATH = /(?:\b[A-Za-z]:[\\/]|\/(?:Users|home)\/)[^\s'"]*/g;
const cleanError = (error) => String(error?.message ?? error ?? 'ERROR')
  .replace(ABSOLUTE_PATH, '<path>').replace(/\s+/g, ' ').trim().slice(0, 200) || 'ERROR';

/** Corre un recolector; si lanza, la sección queda desconocida y la corrida sigue. */
async function attempt(task) {
  try {
    return { ok: true, ...(await task()) };
  } catch (error) {
    return { ok: false, error: cleanError(error) };
  }
}

/** Una consulta → el valor de `data` de su única fila. El driver puede entregarlo ya parseado o como texto. */
async function queryData(io, sql) {
  if (typeof io?.runReadOnlySql !== 'function') throw Error('IO_MISSING:runReadOnlySql');
  const rows = await io.runReadOnlySql(assertSelectOnly(sql));
  if (!Array.isArray(rows)) throw Error('SQL_RESULT_NOT_ROWS');
  if (rows.length === 0) return null;
  const value = rows[0]?.data;
  return typeof value === 'string' ? JSON.parse(value) : value ?? null;
}

const objectOrThrow = (value, code) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(code);
  return value;
};

/** Sólo rutas relativas al repo: nada absoluto, nada que suba de directorio. */
export function isRepoRelativePath(value) {
  const candidate = String(value ?? '');
  return candidate.length > 0 && candidate.length <= 300 && /^[A-Za-z0-9._\-/]+$/.test(candidate)
    && !candidate.startsWith('/') && !candidate.split('/').includes('..') && !candidate.split('/').includes('');
}

/**
 * Una ruta que puede ser evidencia de una certificación: bajo artifacts/ o
 * docs/, sin directorios ocultos, y que no sea el propio archivo que la
 * declara. «.», «docs» o «package.json» existen en cualquier checkout: que
 * existan no certifica nada.
 */
export function isEvidencePath(value) {
  const candidate = String(value ?? '');
  return isRepoRelativePath(candidate)
    && EVIDENCE_ROOTS.some((root) => candidate.startsWith(root) && candidate.length > root.length)
    && !candidate.split('/').some((segment) => segment.startsWith('.'))
    && candidate !== PAYMENT_CERTIFICATION_PATH;
}

/** true/false según git, o null si nadie lo pudo decir (y entonces la evidencia no cuenta). */
async function repoPathTracked(io, relativePath) {
  if (typeof io?.repoTracked !== 'function') return null;
  try {
    const tracked = await io.repoTracked(relativePath);
    return typeof tracked === 'boolean' ? tracked : null;
  } catch (_) {
    return null;
  }
}

async function repoPathExists(io, relativePath) {
  if (!isRepoRelativePath(relativePath)) return false;
  try {
    const entries = await io.listRepoDir(relativePath);
    if (Array.isArray(entries) && entries.length > 0) return true;
  } catch (_) { /* no es un directorio: puede ser un archivo */ }
  try {
    return typeof (await io.readRepoFile(relativePath)) === 'string';
  } catch (_) {
    return false;
  }
}

/**
 * `verify_jwt` de cada `[functions.<slug>]` de supabase/config.toml.
 * No es un parser de TOML: lee lo único que este archivo declara por función.
 */
export function parseFunctionsVerifyJwt(configToml) {
  const declared = {};
  let current = null;
  for (const raw of String(configToml ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      const name = /^functions\.(?:"([^"]+)"|([A-Za-z0-9_-]+))$/.exec(section[1].trim());
      current = name ? name[1] || name[2] : null;
      continue;
    }
    const setting = /^verify_jwt\s*=\s*(true|false)$/.exec(line);
    if (current && setting) declared[current] = setting[1] === 'true';
  }
  return declared;
}

// El mismo patrón con el que el CLI de Supabase reconoce una migración
// (`<versión>_<nombre>.sql`). Un .sql que no lo cumple el CLI lo saltea, así que
// nunca llegaría al destino: se informa en vez de ignorarlo en silencio.
const MIGRATION_FILE = /^(\d+)_(.+)\.sql$/;

/** Los archivos de migración del repo como { version, name }, y lo que no se pudo leer como tal. */
export function parseRepoMigrations(entries) {
  const files = [];
  const unrecognized = [];
  for (const entry of entries || []) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (!name || entry?.isDirectory === true || !String(name).endsWith('.sql')) continue;
    const match = MIGRATION_FILE.exec(name);
    if (match) files.push({ version: match[1], name: match[2] });
    else unrecognized.push(String(name));
  }
  files.sort((a, b) => a.version.localeCompare(b.version));
  return { files, unrecognized };
}

// La plataforma verifica el JWT salvo que la función diga lo contrario: una
// función sin entrada en config.toml se despliega con verify_jwt = true.
const PLATFORM_DEFAULT_VERIFY_JWT = true;

const normalizeFunction = (fn) => ({
  slug: String(fn?.slug ?? ''),
  status: fn?.status ?? null,
  verify_jwt: typeof fn?.verify_jwt === 'boolean' ? fn.verify_jwt : null,
  version: fn?.version ?? null,
  bundle_sha256: fn?.bundle_sha256 ?? fn?.ezbr_sha256 ?? null,
  updated_at: fn?.updated_at ?? null,
});

// ── Recolectores ─────────────────────────────────────────────────────────────

// El código que entra en el bundle de una función: sus propios archivos y,
// siguiendo los imports relativos, el código común que alcanza. Las pruebas
// (`*.deno.ts`, `*.test.ts`) viven al lado y no se despliegan.
const FUNCTION_SOURCE_FILE = /\.(?:ts|js|mjs|json)$/;
const FUNCTION_TEST_FILE = /\.(?:deno|test)\.ts$/;
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\1/g;
// La configuración de Deno de la carpeta de funciones (mapa de imports) también entra.
const FUNCTIONS_SHARED_CONFIG = Object.freeze(['deno.json', 'deno.jsonc', 'import_map.json']);

/** Las rutas relativas que importa un archivo fuente (estáticas y dinámicas). */
export function relativeImports(source) {
  return [...String(source ?? '').matchAll(RELATIVE_IMPORT)].map((match) => match[2]);
}

/** `a/b/../c/./d.ts` → `a/c/d.ts`; null si se sale por arriba de la raíz del repo. */
function normalizeRepoPath(relativePath) {
  const parts = [];
  for (const part of String(relativePath).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.join('/');
}

/**
 * Los archivos del repo de los que depende el bundle de una función, ordenados.
 * Un import relativo que apunta fuera de supabase/functions, o a un archivo que
 * no existe, es un error: no se sabe qué se despliega.
 */
export async function functionSourceFiles(io, slug, functionsDirEntries = null) {
  const files = new Set();
  const pending = [];
  const add = (file) => { if (!files.has(file)) { files.add(file); pending.push(file); } };
  const walk = async (dir) => {
    for (const entry of (await io.listRepoDir(dir)) || []) {
      const name = String(entry.name);
      if (entry.isDirectory === true) await walk(`${dir}/${name}`);
      else if (FUNCTION_SOURCE_FILE.test(name) && !FUNCTION_TEST_FILE.test(name)) add(`${dir}/${name}`);
    }
  };
  await walk(`${FUNCTIONS_DIR}/${slug}`);
  while (pending.length) {
    const file = pending.pop();
    if (!/\.(?:ts|js|mjs)$/.test(file)) continue;
    const directory = file.slice(0, file.lastIndexOf('/'));
    for (const specifier of relativeImports(await io.readRepoFile(file))) {
      const target = normalizeRepoPath(`${directory}/${specifier}`);
      if (!target || !target.startsWith(`${FUNCTIONS_DIR}/`)) throw Error(`FUNCTION_IMPORT_OUTSIDE_FUNCTIONS:${slug}`);
      add(target);
    }
  }
  for (const entry of functionsDirEntries ?? (await io.listRepoDir(FUNCTIONS_DIR)) ?? []) {
    if (entry?.isDirectory !== true && FUNCTIONS_SHARED_CONFIG.includes(String(entry?.name))) files.add(`${FUNCTIONS_DIR}/${entry.name}`);
  }
  return [...files].sort();
}

async function collectRepoFunctions(io) {
  const entries = await io.listRepoDir(FUNCTIONS_DIR);
  const declared = parseFunctionsVerifyJwt(await io.readRepoFile(SUPABASE_CONFIG_PATH));
  // `_shared` (y cualquier directorio con guion bajo) es código común, no una función desplegable.
  const slugs = (entries || [])
    .filter((entry) => entry?.isDirectory === true && !/^[_.]/.test(String(entry.name)))
    .map((entry) => String(entry.name)).sort();
  const functions = [];
  for (const slug of slugs) {
    // Cuándo cambió por última vez el código que entra en su bundle. Si no se
    // puede saber (sin git, o un import que no se resuelve) queda en null y la
    // compuerta lo informa: nunca se supone que lo desplegado está al día.
    let sourceCommittedAt = null;
    let sourceFiles = null;
    if (typeof io.repoLastCommitTime === 'function') {
      try {
        const files = await functionSourceFiles(io, slug, entries);
        sourceFiles = files.length;
        const ms = await io.repoLastCommitTime(files);
        sourceCommittedAt = Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
      } catch (_) { sourceCommittedAt = null; }
    }
    functions.push({
      slug,
      verify_jwt: Object.hasOwn(declared, slug) ? declared[slug] : PLATFORM_DEFAULT_VERIFY_JWT,
      declared_in_config: Object.hasOwn(declared, slug),
      source_committed_at: sourceCommittedAt,
      source_files: sourceFiles,
    });
  }
  return { functions };
}

async function collectPaymentCertification(io) {
  const document = objectOrThrow(JSON.parse(await io.readRepoFile(PAYMENT_CERTIFICATION_PATH)), 'PAYMENT_CERTIFICATION_MALFORMED');
  if (!Array.isArray(document.entries)) throw Error('PAYMENT_CERTIFICATION_MALFORMED');
  const entries = [];
  for (const entry of document.entries) {
    // Que el archivo diga «certificado» no alcanza: la evidencia tiene que estar
    // en el repo, es decir, ser una ruta de evidencia que existe Y que git versiona.
    const evidence = typeof entry?.evidence === 'string' ? entry.evidence.trim() : '';
    const exists = isEvidencePath(evidence) ? await repoPathExists(io, evidence) : false;
    entries.push({
      method: entry?.method ?? null, environment: entry?.environment ?? null, certified: entry?.certified === true,
      evidence: evidence || null, evidence_exists: exists,
      evidence_tracked: exists ? await repoPathTracked(io, evidence) : false,
      date: entry?.date ?? null, limits: entry?.limits ?? null, reason: entry?.reason ?? null,
    });
  }
  return { path: PAYMENT_CERTIFICATION_PATH, opening_decision: document.opening_decision ?? null, entries };
}

async function collectFindingsRegister(io) {
  const document = objectOrThrow(JSON.parse(await io.readRepoFile(FINDINGS_REGISTER_PATH)), 'FINDINGS_REGISTER_MALFORMED');
  if (!Array.isArray(document.findings)) throw Error('FINDINGS_REGISTER_MALFORMED');
  const findings = document.findings.map((finding) => ({
    id: finding?.id ?? null, severity: finding?.severity ?? null, title: finding?.title ?? null,
    status: finding?.status ?? null, fixed_by: finding?.fixed_by ?? null, notes: finding?.notes ?? null,
    aliases: Array.isArray(finding?.aliases) ? finding.aliases : [],
  }));
  return { path: FINDINGS_REGISTER_PATH, findings };
}

async function collectRepoState(io) {
  if (typeof io?.repoHead !== 'function') throw Error('IO_MISSING:repoHead');
  const head = String((await io.repoHead()) ?? '').trim();
  if (!/^[0-9a-f]{7,64}$/i.test(head)) throw Error('REPO_HEAD_UNREADABLE');
  // Qué entradas del veredicto tienen cambios sin commitear. Si no se puede
  // saber queda null (y CI_GREEN queda UNKNOWN): no se asume un árbol limpio.
  let uncommitted = null;
  if (typeof io.repoUncommitted === 'function') {
    try {
      const lines = await io.repoUncommitted([...RELEASE_INPUT_PATHS]);
      if (Array.isArray(lines)) uncommitted = lines.map((line) => cleanError(line)).filter(Boolean).slice(0, 200);
    } catch (_) {
      uncommitted = null;
    }
  }
  return { head: head.toLowerCase(), uncommitted_release_inputs: uncommitted };
}

/**
 * Las secciones de `facts` que salen del repo: lo que se va a publicar.
 *
 * Está aparte de `collect()` porque al evaluar hechos guardados estas secciones
 * se releen del árbol actual: un hallazgo reabierto o una migración agregada
 * después de la foto tienen que verse.
 */
export async function collectRepoFacts(io) {
  return {
    repoMigrations: await attempt(async () => parseRepoMigrations(await io.listRepoDir(MIGRATIONS_DIR))),
    repoFunctions: await attempt(() => collectRepoFunctions(io)),
    paymentCertification: await attempt(() => collectPaymentCertification(io)),
    findingsRegister: await attempt(() => collectFindingsRegister(io)),
    repo: await attempt(() => collectRepoState(io)),
  };
}

/**
 * collect(target, businessId, io, options) → facts.
 *
 * No lanza por un fallo de recolección: sólo por un pedido mal formado (destino
 * desconocido, un id que no es un UUID o un mínimo fuera de rango), que es un
 * error de quien llama.
 */
export async function collect(target, businessId, io, options = {}) {
  if (!COLLECT_TARGETS.includes(target)) throw Error(`UNKNOWN_TARGET:${target}`);
  if (!UUID.test(String(businessId ?? ''))) throw Error('BUSINESS_ID_INVALID');
  const id = String(businessId).toLowerCase();
  // Un mínimo ilegible no se cambia por 1 en silencio: pedir 20 y medir contra 1 es otra evaluación.
  const requested = options.minProducts ?? MIN_PRODUCTS_RANGE.min;
  if (!Number.isInteger(requested) || requested < MIN_PRODUCTS_RANGE.min || requested > MIN_PRODUCTS_RANGE.max) throw Error('MIN_PRODUCTS_INVALID');
  const minProducts = requested;
  const functionsReference = options.functionsReference || null;
  const now = typeof options.now === 'function' ? options.now() : new Date();

  const facts = {
    schema: 1,
    collectedAt: now.toISOString(),
    target,
    // El ref del proyecto que respondió, para que la evidencia diga de dónde salió.
    projectRef: typeof io?.projectRef === 'string' ? io.projectRef : null,
    businessId: id,
    options: {
      minProducts,
      requireRider: options.requireRider === true,
      requireImages: options.requireImages === true,
      functionsReference,
    },
  };

  // ── El destino: una consulta por hecho, para que una que falle no arrastre a las demás.
  facts.observer = await attempt(async () => objectOrThrow(await queryData(io, SQL.observer()), 'OBSERVER_EMPTY'));
  facts.business = await attempt(async () => {
    const row = await queryData(io, SQL.business(id));
    if (!row || row.id !== id) throw Error('BUSINESS_NOT_FOUND');
    return row;
  });
  facts.serviceHours = await attempt(async () => objectOrThrow(await queryData(io, SQL.serviceHours(id)), 'SERVICE_HOURS_EMPTY'));
  facts.deliveryZones = await attempt(async () => objectOrThrow(await queryData(io, SQL.deliveryZones(id)), 'DELIVERY_ZONES_EMPTY'));
  facts.catalog = await attempt(async () => objectOrThrow(await queryData(io, SQL.catalog(id)), 'CATALOG_EMPTY'));
  facts.team = await attempt(async () => objectOrThrow(await queryData(io, SQL.team(id)), 'TEAM_EMPTY'));
  facts.mercadoPago = await attempt(async () => objectOrThrow(await queryData(io, SQL.mercadoPago(id)), 'MERCADOPAGO_EMPTY'));
  facts.migrationLedger = await attempt(async () => {
    const versions = await queryData(io, SQL.migrationLedger());
    if (!Array.isArray(versions)) throw Error('LEDGER_NOT_A_LIST');
    return { versions };
  });
  facts.abuse = await attempt(async () => objectOrThrow(await queryData(io, SQL.abuse()), 'ABUSE_EMPTY'));
  facts.readiness = await attempt(async () => {
    const payload = objectOrThrow(await queryData(io, SQL.readiness(id, minProducts)), 'READINESS_EMPTY');
    return {
      can_open: payload.can_open === true, accepting_orders: payload.accepting_orders === true,
      pending: Array.isArray(payload.pending) ? payload.pending : [],
    };
  });
  // El dinero real: los secretos del proyecto (por huella) y los comercios que
  // podrían cobrar. Dos secciones, para que una que no se pudo leer no esconda
  // lo que la otra prueba.
  facts.realMoneySecrets = await attempt(async () => {
    if (typeof io?.listSecrets !== 'function') throw Error('IO_MISSING:listSecrets');
    return { states: await classifyRealMoneySecrets(await io.listSecrets()) };
  });
  facts.realMoneyBusinesses = await attempt(async () => objectOrThrow(await queryData(io, SQL.realMoneyBusinesses()), 'REAL_MONEY_BUSINESSES_EMPTY'));
  facts.deployedFunctions = await attempt(async () => {
    if (typeof io?.listFunctions !== 'function') throw Error('IO_MISSING:listFunctions');
    const list = await io.listFunctions();
    if (!Array.isArray(list)) throw Error('FUNCTIONS_NOT_A_LIST');
    return { functions: list.map(normalizeFunction) };
  });
  if (functionsReference) {
    facts.referenceFunctions = await attempt(async () => {
      if (typeof io?.listReferenceFunctions !== 'function') throw Error('IO_MISSING:listReferenceFunctions');
      const list = await io.listReferenceFunctions();
      if (!Array.isArray(list)) throw Error('FUNCTIONS_NOT_A_LIST');
      return { target: functionsReference, functions: list.map(normalizeFunction) };
    });
  }

  // ── El repo: lo que se va a publicar.
  Object.assign(facts, await collectRepoFacts(io));

  // ── El CI: sólo si alguien lo trae. Sin dato, la compuerta queda UNKNOWN.
  facts.ci = null;
  if (typeof io?.ciConclusion === 'function') {
    try {
      const ci = await io.ciConclusion();
      if (ci && typeof ci === 'object') facts.ci = { conclusion: ci.conclusion ?? null, commit: ci.commit ?? null };
      else if (typeof ci === 'string' && ci) facts.ci = { conclusion: ci, commit: null };
    } catch (error) {
      facts.ci = { conclusion: null, commit: null, error: cleanError(error) };
    }
  }
  return facts;
}
