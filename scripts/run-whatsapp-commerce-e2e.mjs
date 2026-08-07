/**
 * E2E sintético del canal de pedidos por WhatsApp.
 *
 * QUÉ ES REAL ACÁ
 * ---------------
 *  - PostgreSQL de verdad, en un contenedor propio y efímero, con LA CADENA
 *    COMPLETA de migraciones aplicada desde cero.
 *  - El motor comercial real: `whatsapp_quote_cart`, `create_checkout_session`,
 *    `prepare_mercadopago_preference`, `record_mercadopago_webhook_receipt`,
 *    `record_mercadopago_payment_snapshot`, `finalize_paid_checkout_session` y
 *    la lectura del Panel `list_operational_pipeline`.
 *  - El canal real: los mismos módulos que ejecuta la función de borde en Deno.
 *
 * QUÉ ESTÁ SIMULADO, Y POR QUÉ
 * ----------------------------
 *  - La Graph API de Meta: no hay credenciales de un número de prueba en este
 *    entorno y NO se toca ningún número productivo. El emisor stub captura cada
 *    mensaje y el test verifica su forma contra los límites de la Cloud API.
 *  - La API de Mercado Pago: no hay token de prueba disponible acá. El enlace de
 *    pago se prepara con la RPC REAL y se persiste con la RPC REAL; lo único
 *    fabricado es la respuesta HTTP de Mercado Pago. La notificación de pago
 *    entra por el recibo firmado real y se concilia con el mismo camino que
 *    recorre el worker.
 *  - Ninguna de las dos simulaciones toca el cálculo comercial: precio, stock,
 *    combo, envío, mínimo, +18 y total salen todos de la base.
 *
 * NADA DE ESTO TOCA STAGING NI PRODUCCIÓN.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { handleInboundMessage, dispatchOutbound } from '../supabase/functions/_shared/whatsapp/channel.js';
import { parseWebhookPayload } from '../supabase/functions/_shared/whatsapp/inbound.js';
import { verifyMetaSignature } from '../supabase/functions/_shared/whatsapp/signature.js';
import { LIMITS } from '../supabase/functions/_shared/whatsapp/messages.js';

if (process.env.TABA_LOCAL_WHATSAPP_E2E !== '1') {
  console.error('Refusing to run without TABA_LOCAL_WHATSAPP_E2E=1. This suite is local-only.');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dockerCommand = process.platform === 'win32' ? 'docker.exe' : 'docker';
const image = process.env.TABA_WHATSAPP_E2E_IMAGE || 'public.ecr.aws/supabase/postgres:17.6.1.143';
const container = process.env.TABA_WHATSAPP_E2E_CONTAINER || `taba2-wa-e2e-${process.pid}`;
const reuseContainer = Boolean(process.env.TABA_WHATSAPP_E2E_CONTAINER);
// De acá se copia SOLO el esquema de las plataformas que instalan los servicios
// de Supabase (auth, storage). Es una lectura; el contenedor no se toca.
const platformContainer = process.env.TABA_SUPABASE_PLATFORM_CONTAINER || 'supabase_db_la-taba-pages';
const database = `taba2_whatsapp_e2e_${process.pid}`;
const CRON_CONF = '/etc/postgresql-custom/conf.d/pg_cron.conf';

const BUSINESS_ID = '21000000-0000-4000-8000-000000000001';
const OWNER_ID = '11000000-0000-4000-8000-000000000001';
const WEB_CUSTOMER_ID = '11000000-0000-4000-8000-000000000002';
const HEINEKEN = '31000000-0000-4000-8000-000000000001';
const RED_BULL = '31000000-0000-4000-8000-000000000002';
const FERNET = '31000000-0000-4000-8000-000000000003';
const COCA = '31000000-0000-4000-8000-000000000004';
const WA_ID = '5492995550101';
const HASH_SALT = 'whatsapp-e2e-hash-salt';
const APP_SECRET = 'whatsapp-e2e-app-secret';

const checks = [];
let failures = 0;

function check(description, condition, detail = '') {
  const passed = Boolean(condition);
  if (!passed) failures += 1;
  checks.push({ description, passed, detail });
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${description}${passed || !detail ? '' : ` -- ${detail}`}`);
}

/* ========================================================================== */
/*  Base de datos efímera                                                     */
/* ========================================================================== */

function docker(args, options = {}) {
  return execFileSync(dockerCommand, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.input !== undefined ? ['pipe', 'inherit', 'inherit'] : 'inherit',
    input: options.input,
  });
}

function psql(sql, target = database) {
  docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', target, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql });
}

function psqlCapture(sql, target = database) {
  const result = spawnSync(dockerCommand, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', target,
    '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t',
  ], { cwd: root, encoding: 'utf8', input: sql, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    const message = String(result.stderr || '').split('\n').find((line) => line.startsWith('ERROR:')) || result.stderr;
    throw new Error(String(message || 'psql failed').replace(/^ERROR:\s*/, '').trim());
  }
  return String(result.stdout || '');
}

function waitForDatabase(timeoutMs = 180_000) {
  const started = Date.now();
  for (;;) {
    const probe = spawnSync(dockerCommand, ['exec', container, 'pg_isready', '-U', 'postgres'], { encoding: 'utf8' });
    if (probe.status === 0) return;
    if (Date.now() - started > timeoutMs) throw new Error('the ephemeral database never became ready');
  }
}

// pg_cron sólo deja instalarse desde la base que indica `cron.database_name`,
// que es del clúster. Como el contenedor es propio y descartable, se apunta al
// esquema efímero y la migración 20260803120000 se aplica tal como está escrita.
function pointClusterCronAt(name) {
  execFileSync(dockerCommand, ['exec', '-u', 'root', container, 'sh', '-c',
    `sed -i "s|^cron.database_name = .*|cron.database_name = '${name}'|" ${CRON_CONF}`], { stdio: 'pipe' });
  execFileSync(dockerCommand, ['restart', container], { stdio: 'pipe' });
  waitForDatabase();
}

function startContainer() {
  if (reuseContainer) {
    waitForDatabase();
    return;
  }
  execFileSync(dockerCommand, [
    'run', '-d', '--name', container,
    '-e', 'POSTGRES_PASSWORD=postgres',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
    image,
  ], { stdio: 'pipe' });
  waitForDatabase();
}

function buildDatabase() {
  pointClusterCronAt(database);
  docker(['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database]);
  docker(['exec', container, 'createdb', '-U', 'postgres', database]);

  const platformSchemas = execFileSync(dockerCommand, [
    'exec', platformContainer, 'pg_dump', '-U', 'postgres', '-d', 'postgres', '--schema-only',
    '--schema=auth', '--schema=storage', '--no-owner', '--no-privileges',
  ], { maxBuffer: 128 * 1024 * 1024 });
  psql(platformSchemas);
  psql(`
    create schema if not exists extensions;
    grant usage on schema extensions to anon, authenticated, service_role;
    create extension if not exists pgcrypto with schema extensions;
    create schema if not exists vault;
  `);

  const migrations = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql')).sort();
  for (const name of migrations) {
    psql(fs.readFileSync(path.join(root, 'supabase', 'migrations', name)));
  }
  psql(fs.readFileSync(path.join(root, 'supabase', 'tests', 'fixtures', 'whatsapp_commerce_seed.local.sql')));
  return migrations.length;
}

/* ========================================================================== */
/*  RPC sobre la base real                                                    */
/* ========================================================================== */

const TAG = '$wa$';

function literal(value, type) {
  if (value === null || value === undefined) return `null::${type}`;
  if (type === 'boolean') return value ? 'true' : 'false';
  if (type === 'integer' || type === 'bigint' || type === 'numeric') return `${Number(value)}::${type}`;
  if (type === 'uuid[]') {
    const items = (Array.isArray(value) ? value : [value]).map((item) => quote(String(item)));
    return `array[${items.join(',')}]::uuid[]`;
  }
  if (type === 'jsonb' || type === 'json') return `${quote(JSON.stringify(value))}::${type}`;
  return `${quote(String(value))}::${type}`;
}

function quote(value) {
  if (value.includes(TAG)) throw new Error('literal collides with the SQL dollar-quote tag');
  return `${TAG}${value}${TAG}`;
}

let signatures = new Map();

function loadSignatures() {
  const output = psqlCapture(`
    select p.proname || '|' || pg_get_function_identity_arguments(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
     order by p.proname, p.pronargs desc;
  `);
  const parsed = new Map();
  for (const line of output.split('\n')) {
    const [name, args = ''] = line.split('|');
    if (!name) continue;
    if (parsed.has(name)) continue;
    parsed.set(name, args.split(',').map((part) => {
      const trimmed = part.trim();
      const separator = trimmed.indexOf(' ');
      return separator === -1
        ? { name: trimmed, type: 'text' }
        : { name: trimmed.slice(0, separator), type: trimmed.slice(separator + 1).trim() };
    }).filter((argument) => argument.name));
  }
  signatures = parsed;
}

/** Ejecuta una función de la base con los tipos que la propia base declara. */
function rpc(name, args = {}) {
  const declared = signatures.get(name);
  if (!declared) throw new Error(`unknown database function: ${name}`);
  const rendered = Object.entries(args)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => {
      const argument = declared.find((candidate) => candidate.name === key);
      if (!argument) throw new Error(`unknown argument ${key} for ${name}`);
      return `${key} => ${literal(value, argument.type)}`;
    });
  const output = psqlCapture(`select coalesce(to_jsonb(public.${name}(${rendered.join(', ')}))::text, 'null');`).trim();
  return output ? JSON.parse(output) : null;
}

/** Devuelve el valor como texto crudo. `null` cuando la consulta no devuelve nada. */
function query(sql) {
  const output = psqlCapture(`select coalesce((${sql})::text, '');`).trim();
  return output || null;
}

/** Igual que `query`, para columnas jsonb. */
function queryJson(sql) {
  const output = query(sql);
  return output === null ? null : JSON.parse(output);
}

function count(sql) {
  return Number(query(sql));
}

/* ========================================================================== */
/*  Cliente sintético de WhatsApp                                             */
/* ========================================================================== */

const outbox = [];

const sender = {
  async send(message) {
    // Se valida la forma contra los límites de la Cloud API antes de "mandar":
    // un título de 25 caracteres devolvería 400 en Meta y acá lo diríamos tarde.
    assertCloudApiShape(message);
    outbox.push(message);
    return { ok: true, status: 200, providerMessageId: `wamid.${outbox.length}` };
  },
  async markRead() {
    return { ok: true, status: 200 };
  },
};

function assertCloudApiShape(message) {
  if (message.messaging_product !== 'whatsapp') throw new Error('mensaje sin messaging_product');
  if (message.type === 'text' && message.text.body.length > LIMITS.TEXT_BODY) throw new Error('cuerpo de texto excedido');
  if (message.type !== 'interactive') return;
  const interactive = message.interactive;
  if (interactive.body.text.length > LIMITS.INTERACTIVE_BODY) throw new Error('cuerpo interactivo excedido');
  if (interactive.header && interactive.header.text.length > LIMITS.HEADER) throw new Error('encabezado excedido');
  if (interactive.footer && interactive.footer.text.length > LIMITS.FOOTER) throw new Error('pie excedido');
  if (interactive.type === 'button') {
    if (interactive.action.buttons.length > LIMITS.REPLY_BUTTONS) throw new Error('demasiados botones');
    for (const button of interactive.action.buttons) {
      if (button.reply.title.length > LIMITS.BUTTON_TITLE) throw new Error('titulo de boton excedido');
    }
    return;
  }
  if (interactive.action.button.length > LIMITS.LIST_BUTTON) throw new Error('boton de lista excedido');
  const rows = interactive.action.sections.flatMap((section) => section.rows);
  if (rows.length > LIMITS.LIST_ROWS) throw new Error('demasiadas filas en la lista');
  if (interactive.action.sections.length > LIMITS.LIST_SECTIONS) throw new Error('demasiadas secciones');
  for (const row of rows) {
    if (row.title.length > LIMITS.ROW_TITLE) throw new Error(`titulo de fila excedido: ${row.title}`);
    if (row.description && row.description.length > LIMITS.ROW_DESCRIPTION) throw new Error('descripcion de fila excedida');
    if (row.id.length > LIMITS.ROW_ID) throw new Error('id de fila excedido');
  }
}

let messageCounter = 0;

function metaEnvelope(message) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'entry-e2e',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5492990000000', phone_number_id: '900000000000000' },
          contacts: [{ profile: { name: 'Vale QA' }, wa_id: WA_ID }],
          messages: [message],
        },
      }],
    }],
  };
}

function textEnvelope(body, id = `wamid.in.${++messageCounter}`) {
  return metaEnvelope({ from: WA_ID, id, timestamp: '1780000000', type: 'text', text: { body } });
}

function tapEnvelope(replyId, title, id = `wamid.in.${++messageCounter}`) {
  return metaEnvelope({
    from: WA_ID,
    id,
    timestamp: '1780000000',
    type: 'interactive',
    interactive: { type: 'list_reply', list_reply: { id: replyId, title } },
  });
}

function locationEnvelope(latitude, longitude, id = `wamid.in.${++messageCounter}`) {
  return metaEnvelope({
    from: WA_ID,
    id,
    timestamp: '1780000000',
    type: 'location',
    location: { latitude, longitude, name: 'Casa' },
  });
}

/* ========================================================================== */
/*  Puentes del canal                                                         */
/* ========================================================================== */

function ensureCustomer({ waId }) {
  // En producción esto es la Admin API de Supabase. Acá se escribe la fila que
  // esa API escribiría, igual que hace el fixture local de pagos del repo.
  const id = uuidFromSeed(`whatsapp-customer-${waId}`);
  psql(`
    insert into auth.users (id, aud, role, phone, phone_confirmed_at, encrypted_password,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('${id}', 'authenticated', 'authenticated', '${waId}', clock_timestamp(), '',
      '{}'::jsonb, '{"channel":"whatsapp"}'::jsonb, clock_timestamp(), clock_timestamp())
    on conflict (id) do nothing;
  `);
  return id;
}

let preferenceCounter = 0;

/**
 * Prepara el pago con la RPC REAL y persiste con la RPC REAL. Lo único
 * fabricado es lo que hubiera contestado Mercado Pago, y antes de fabricarlo se
 * comprueba la MISMA invariante que `_shared/mercadopago.ts` aplica sobre la
 * preferencia: la suma de los ítems más el envío es exactamente el total
 * autoritativo, nunca más.
 */
function createPaymentLink({ checkoutSessionId, customerId }) {
  const preparation = rpc('prepare_mercadopago_preference', {
    p_checkout_session_id: checkoutSessionId,
    p_customer_id: customerId,
    p_new_attempt: false,
  });
  if (!preparation) return { initPoint: '', message: 'sin preparacion' };
  if (preparation.init_point) return { initPoint: preparation.init_point };

  const itemsTotal = (preparation.items || [])
    .reduce((sum, item) => sum + Number(item.unit_price) * Number(item.quantity), 0);
  const surcharge = Number((Number(preparation.total) - itemsTotal).toFixed(2));
  if (surcharge < 0) throw new Error('la preferencia supera el total autoritativo');
  paymentInvariants.push({ checkoutSessionId, itemsTotal, surcharge, total: Number(preparation.total) });

  preferenceCounter += 1;
  const preferenceId = `PREF-WA-E2E-${preferenceCounter}`;
  rpc('record_mercadopago_preference_created', {
    p_payment_attempt_id: preparation.payment_attempt_id,
    p_preference_id: preferenceId,
    p_init_point: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${preferenceId}`,
    p_sandbox_init_point: null,
    p_response_hash: crypto.createHash('sha256').update(preferenceId).digest('hex'),
    p_provider_request_id: `req-${preferenceCounter}`,
  });
  preferences.set(checkoutSessionId, { preferenceId, externalReference: preparation.external_reference });
  return { initPoint: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${preferenceId}` };
}

const preferences = new Map();
const paymentInvariants = [];

const deps = {
  rpc: (name, args) => rpc(name, args),
  businessId: BUSINESS_ID,
  hashSalt: HASH_SALT,
  ensureCustomer,
  createPaymentLink,
  sender,
};

async function deliver(envelope) {
  const raw = JSON.stringify(envelope);
  const signature = `sha256=${crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;
  const valid = await verifyMetaSignature({ rawBody: raw, header: signature, appSecret: APP_SECRET });
  if (!valid) throw new Error('la firma sintetica no valido');
  const { messages } = parseWebhookPayload(JSON.parse(raw));
  const results = [];
  for (const event of messages) {
    results.push(await handleInboundMessage({ event, deps }));
  }
  return results;
}

function lastMessage() {
  return outbox[outbox.length - 1];
}

function messageText(message) {
  if (!message) return '';
  if (message.type === 'text') return message.text.body;
  const interactive = message.interactive;
  const parts = [interactive.header?.text || '', interactive.body.text, interactive.footer?.text || ''];
  if (interactive.type === 'list') {
    for (const section of interactive.action.sections) {
      parts.push(section.title);
      for (const row of section.rows) parts.push(`${row.title} ${row.description || ''}`);
    }
  } else {
    for (const button of interactive.action.buttons) parts.push(button.reply.title);
  }
  return parts.join('\n');
}

function rowIds(message) {
  if (message?.type !== 'interactive') return [];
  if (message.interactive.type === 'list') {
    return message.interactive.action.sections.flatMap((section) => section.rows.map((row) => row.id));
  }
  return message.interactive.action.buttons.map((button) => button.reply.id);
}

function uuidFromSeed(seed) {
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `4${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

/* ========================================================================== */
/*  Escenario                                                                 */
/* ========================================================================== */

async function run() {
  loadSignatures();

  // ---- 1. Firma y verificación ------------------------------------------
  const probe = JSON.stringify({ hola: 'mundo' });
  check(
    'la firma X-Hub-Signature-256 rechaza un cuerpo alterado',
    !(await verifyMetaSignature({
      rawBody: `${probe} `,
      header: `sha256=${crypto.createHmac('sha256', APP_SECRET).update(probe).digest('hex')}`,
      appSecret: APP_SECRET,
    })),
  );
  check(
    'la firma X-Hub-Signature-256 rechaza otro app secret',
    !(await verifyMetaSignature({
      rawBody: probe,
      header: `sha256=${crypto.createHmac('sha256', 'otro').update(probe).digest('hex')}`,
      appSecret: APP_SECRET,
    })),
  );

  // ---- 2. HOLA -> menú ----------------------------------------------------
  await deliver(textEnvelope('HOLA'));
  const menu = messageText(lastMessage());
  for (const shelf of ['Combos', 'Cervezas', 'Fernet', 'Gaseosas']) {
    check(`el menú ofrece ${shelf}`, menu.includes(shelf), menu.slice(0, 200));
  }
  check('el menú es una lista interactiva', lastMessage()?.interactive?.type === 'list');

  // ---- 3. Combos con precio derivado del catálogo vivo --------------------
  await deliver(tapEnvelope('shelf:combos', 'Combos'));
  const comboList = messageText(lastMessage());
  check('el estante de combos muestra Noche larga', comboList.includes('Noche larga'));
  check('el combo muestra el precio promocional derivado ($ 11.900)', comboList.includes('11.900'), comboList);
  check('el combo muestra el ahorro derivado ($ 1.700)', comboList.includes('1.700'), comboList);

  await deliver(tapEnvelope('c:combo-noche-larga', 'Noche larga'));
  const comboDetail = messageText(lastMessage());
  check('el detalle del combo lista sus componentes', comboDetail.includes('Heineken') && comboDetail.includes('Red Bull'));
  check('el detalle del combo declara el +18', /mayores de 18/.test(comboDetail));

  await deliver(tapEnvelope('add:c:combo-noche-larga:1', 'Agregar combo'));
  const cartAfterCombo = messageText(lastMessage());
  check('el carrito muestra el combo cobrado como combo', cartAfterCombo.includes('Noche larga'));
  check('el carrito muestra el descuento de combo', cartAfterCombo.includes('1.700'), cartAfterCombo);

  // ---- 4. Entendimiento libre --------------------------------------------
  await deliver(textEnvelope('quiero un fernet con coca'));
  const search = messageText(lastMessage());
  check('«un fernet con coca» encuentra el fernet del catálogo', search.includes('Fernet Branca'), search);
  check('«un fernet con coca» encuentra la gaseosa del catálogo', search.includes('Coca-Cola'), search);
  check(
    'la búsqueda libre NO agrega nada sola: sólo propone',
    queryJson((`select cart from public.whatsapp_conversations limit 1`)).length === 1,
  );

  const cocaRow = rowIds(lastMessage()).find((id) => id.includes(COCA));
  check('la propuesta identifica el SKU real del catálogo', Boolean(cocaRow), rowIds(lastMessage()).join(','));
  await deliver(tapEnvelope(cocaRow, 'Coca-Cola'));
  await deliver(tapEnvelope(`add:p:${COCA}:2`, 'Agregar 2'));
  const cartAfterCoca = messageText(lastMessage());
  check('el carrito suma la gaseosa elegida', cartAfterCoca.includes('Coca-Cola'));

  const storedCart = queryJson(('select cart from public.whatsapp_conversations limit 1'));
  check('el carrito guardado tiene dos líneas', storedCart.length === 2, JSON.stringify(storedCart));
  check(
    'el carrito guardado NO contiene precios: sólo identificadores y cantidades',
    storedCart.every((line) => Object.keys(line).every((key) => ['product_id', 'combo_id', 'quantity'].includes(key))),
    JSON.stringify(storedCart),
  );

  // ---- 5. La base rechaza un carrito con precio ---------------------------
  let rejected = false;
  try {
    psqlCapture(`
      update public.whatsapp_conversations
         set cart = '[{"product_id":"${COCA}","quantity":1,"unit_price":1}]'::jsonb;
    `);
  } catch (error) {
    rejected = /whatsapp_conversations_cart_check|violates check constraint/i.test(error.message);
  }
  check('la base rechaza guardar un precio dentro del carrito del chat', rejected);

  // ---- 6. Checkout: modalidad, nombre, dirección, +18 ---------------------
  await deliver(tapEnvelope('act:checkout', 'Finalizar compra'));
  check('pide la modalidad de entrega', /Cómo lo querés/i.test(messageText(lastMessage())));

  await deliver(tapEnvelope('act:delivery', 'Envío a domicilio'));
  check('pide la dirección', /dirección/i.test(messageText(lastMessage())), messageText(lastMessage()));

  await deliver(locationEnvelope(-38.9539, -68.0596));
  await deliver(textEnvelope('San Martín 1234'));
  check('pide la ciudad cuando falta', /ciudad|localidad/i.test(messageText(lastMessage())), messageText(lastMessage()));
  await deliver(textEnvelope('Neuquén'));

  const ageAsk = messageText(lastMessage());
  check('pide confirmación de mayoría de edad por el alcohol del combo', /mayor de 18/.test(ageAsk), ageAsk);

  const draft = queryJson(('select draft_address from public.whatsapp_conversations limit 1'));
  check('la ubicación de WhatsApp queda como punto de entrega', draft.latitude === -38.9539 && draft.longitude === -68.0596, JSON.stringify(draft));
  check('el origen de la dirección queda declarado como gps', draft.source === 'gps');

  // ---- 7. Un checkout sin +18 no puede cobrarse --------------------------
  let ageRefusal = '';
  try {
    rpc('create_checkout_session', {
      p_customer_id: uuidFromSeed(`whatsapp-customer-${WA_ID}`),
      p_payload: {
        business_id: BUSINESS_ID,
        client_request_id: 'waedgecase00000001',
        items: [{ combo_id: 'combo-noche-larga', quantity: 1 }],
        fulfillment_type: 'pickup',
        contact: { name: 'Vale QA', phone: WA_ID },
        address: {},
        age_confirmed: false,
        payment_method: 'mercadopago',
      },
    });
  } catch (error) {
    ageRefusal = error.message;
  }
  check('sin confirmación de edad el backend no crea el checkout', /edad|politica/i.test(ageRefusal), ageRefusal);
  check(
    'el intento rechazado no reservó stock',
    count(`select stock from public.products where id = '${HEINEKEN}'`) === 96,
  );

  await deliver(tapEnvelope('act:age_yes', 'Sí, soy mayor'));
  const summary = messageText(lastMessage());
  check('el resumen muestra el total con envío', summary.includes('19.800'), summary);
  check('el resumen ofrece pagar', rowIds(lastMessage()).includes('act:pay'));

  // ---- 8. Pago -----------------------------------------------------------
  await deliver(tapEnvelope('act:pay', 'Pagar'));
  const payMessage = messageText(lastMessage());
  check('el mensaje de pago trae un enlace de Mercado Pago', /https:\/\/www\.mercadopago\.com\.ar\/checkout/.test(payMessage), payMessage);
  check('el mensaje de pago declara el total autoritativo', payMessage.includes('19.800'), payMessage);

  const checkoutSessionId = query('select checkout_session_id from public.whatsapp_conversations limit 1');
  check('la conversación quedó atada a su sesión de checkout', Boolean(checkoutSessionId));
  const session = queryJson((`
    select jsonb_build_object('subtotal', subtotal, 'discount_total', discount_total,
      'delivery_fee', delivery_fee, 'total', total, 'status', status, 'origin', origin)
      from public.checkout_sessions where id = '${checkoutSessionId}'
  `.replace(/\s+/g, ' ')));
  check('el checkout cobra el total autoritativo 19800', Number(session.total) === 19800, JSON.stringify(session));
  check('el checkout aplica el descuento de combo 1700', Number(session.discount_total) === 1700, JSON.stringify(session));
  check(
    'el checkout quedó en un estado pagable',
    ['ready_for_payment', 'preference_created', 'redirected'].includes(session.status),
    session.status,
  );
  check('el pedido sintético queda clasificado como QA por su catálogo de prueba', session.origin === 'qa', session.origin);
  check(
    'la preferencia nunca supera el total autoritativo',
    paymentInvariants.length > 0 && paymentInvariants.every((entry) => entry.surcharge >= 0
      && Math.abs(entry.itemsTotal + entry.surcharge - entry.total) < 0.01),
    JSON.stringify(paymentInvariants),
  );

  // ---- 9. La cotización del chat y el cobro coinciden ---------------------
  const quote = rpc('whatsapp_quote_cart', {
    p_business_id: BUSINESS_ID,
    p_cart: [{ combo_id: 'combo-noche-larga', quantity: 1 }, { product_id: COCA, quantity: 2 }],
    p_fulfillment_type: 'delivery',
  });
  check(
    'la cotización del chat es idéntica al cobro del checkout',
    Number(quote.subtotal) === Number(session.subtotal)
      && Number(quote.discount_total) === Number(session.discount_total)
      && Number(quote.delivery_fee) === Number(session.delivery_fee)
      && Number(quote.total) === Number(session.total),
    JSON.stringify({ quote, session }),
  );

  // ---- 10. El mismo carrito desde la web cobra lo mismo -------------------
  psql(`
    insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data,
      raw_user_meta_data, created_at, updated_at)
    values ('${WEB_CUSTOMER_ID}', 'authenticated', 'authenticated', 'wa-web-twin@taba2.invalid', '',
      '{}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp())
    on conflict (id) do nothing;
  `);
  const webCheckout = rpc('create_checkout_session', {
    p_customer_id: WEB_CUSTOMER_ID,
    p_payload: {
      business_id: BUSINESS_ID,
      client_request_id: 'webtwincheckout0001',
      items: [{ combo_id: 'combo-noche-larga', quantity: 1 }, { product_id: COCA, quantity: 2 }],
      fulfillment_type: 'delivery',
      contact: { name: 'Cliente Web', phone: '5492995550202' },
      address: { street: 'San Martín', street_number: '1234', city: 'Neuquén', source: 'manual' },
      age_confirmed: true,
      payment_method: 'mercadopago',
    },
  });
  check(
    'un pedido idéntico hecho desde la web cobra exactamente lo mismo',
    Number(webCheckout.total) === Number(session.total)
      && Number(webCheckout.subtotal) === Number(session.subtotal)
      && Number(webCheckout.discount_total) === Number(session.discount_total),
    JSON.stringify({ web: webCheckout.total, whatsapp: session.total }),
  );
  // La sesión gemela liberó stock reservado: se devuelve para que el conteo
  // final mida el canal de WhatsApp y no este control.
  rpc('release_checkout_session_inventory', {
    p_checkout_session_id: webCheckout.checkout_session_id,
    p_reason: 'web_twin_control',
    p_terminal_status: 'cancelled',
  });

  // ---- 11. Idempotencia del canal ----------------------------------------
  const sessionsBefore = query('select count(*) from public.checkout_sessions');
  const outboxBefore = outbox.length;
  await deliver(tapEnvelope('act:pay', 'Pagar', 'wamid.in.replay'));
  await deliver(tapEnvelope('act:pay', 'Pagar', 'wamid.in.replay'));
  const sessionsAfter = query('select count(*) from public.checkout_sessions');
  check(
    'reenviar el mismo mensaje no crea otra sesión de checkout',
    Number(sessionsAfter) === Number(sessionsBefore),
    `${sessionsBefore} -> ${sessionsAfter}`,
  );
  check(
    'reenviar el mismo mensaje no repite la respuesta',
    outbox.length === outboxBefore + 1,
    `${outboxBefore} -> ${outbox.length}`,
  );
  check(
    'el recibo del mensaje repetido quedó deduplicado',
    Number(query(`select count(*) from public.whatsapp_inbound_events where provider_message_id = 'wamid.in.replay'`)) === 1,
  );

  // ---- 12. Reservas de stock exactas -------------------------------------
  const stock = queryJson((`
    select jsonb_object_agg(id::text, stock) from public.products where business_id = '${BUSINESS_ID}'
  `.replace(/\s+/g, ' ')));
  check('reservó exactamente 4 Heineken', Number(stock[HEINEKEN]) === 92, String(stock[HEINEKEN]));
  check('reservó exactamente 2 Red Bull', Number(stock[RED_BULL]) === 58, String(stock[RED_BULL]));
  check('reservó exactamente 2 Coca-Cola', Number(stock[COCA]) === 78, String(stock[COCA]));
  check('no tocó el stock del fernet', Number(stock[FERNET]) === 24, String(stock[FERNET]));

  // ---- 13. Notificación de Mercado Pago ----------------------------------
  const preference = preferences.get(checkoutSessionId);
  const paymentId = '90000000777';
  const receipt = rpc('record_mercadopago_webhook_receipt', {
    p_environment: 'test',
    p_webhook_event_id: 'evt-wa-e2e-1',
    p_event_type: 'payment',
    p_resource_id: paymentId,
    p_signature_valid: true,
    p_request_id: 'req-wa-e2e-1',
    p_payload_hash: crypto.createHash('sha256').update('wa-e2e-payment').digest('hex'),
  });
  check('el recibo firmado entra a la cola durable', receipt.queued === true, JSON.stringify(receipt));
  const duplicateReceipt = rpc('record_mercadopago_webhook_receipt', {
    p_environment: 'test',
    p_webhook_event_id: 'evt-wa-e2e-1',
    p_event_type: 'payment',
    p_resource_id: paymentId,
    p_signature_valid: true,
    p_request_id: 'req-wa-e2e-1',
    p_payload_hash: crypto.createHash('sha256').update('wa-e2e-payment').digest('hex'),
  });
  check('un recibo repetido se deduplica', duplicateReceipt.duplicate === true);

  const intent = rpc('find_payment_intent_by_external_reference', {
    p_environment: 'test',
    p_external_reference: preference.externalReference,
  });
  check('el pago se resuelve contra su sesión de checkout', intent?.checkout_session_id === checkoutSessionId);

  const snapshot = rpc('record_mercadopago_payment_snapshot', {
    p_payment_intent_id: intent.payment_intent_id,
    p_snapshot: {
      provider_payment_id: paymentId,
      external_reference: preference.externalReference,
      preference_id: preference.preferenceId,
      merchant_order_id: 'MO-WA-E2E',
      collector_id: 'wa-collector-fixture',
      application_id: 'wa-application-fixture',
      currency: 'ARS',
      transaction_amount: '19800.00',
      status: 'approved',
      status_detail: 'accredited',
      payment_method: 'visa',
      live_mode: false,
      provider_occurred_at: new Date(1_780_000_000_000).toISOString(),
      refunded_amount: '0.00',
      payer_email_hash: crypto.createHash('sha256').update('payer@example.invalid').digest('hex'),
      raw_response_hash: crypto.createHash('sha256').update('raw-wa-e2e').digest('hex'),
    },
    p_source: 'webhook',
    p_webhook_receipt_id: receipt.receipt_id,
  });
  check('el pago aprobado y verificado habilita la finalización', snapshot.finalize_required === true, JSON.stringify(snapshot));

  const finalized = rpc('finalize_paid_checkout_session', { p_checkout_session_id: checkoutSessionId });
  check('el pago aprobado crea el pedido', finalized.ok === true && Boolean(finalized.order_id), JSON.stringify(finalized));
  const replayFinalized = rpc('finalize_paid_checkout_session', { p_checkout_session_id: checkoutSessionId });
  check('finalizar dos veces no crea un segundo pedido', replayFinalized.idempotent === true);
  check(
    'existe exactamente UN pedido para este comercio',
    Number(query(`select count(*) from public.orders where business_id = '${BUSINESS_ID}'`)) === 1,
  );

  const order = queryJson((`
    select jsonb_build_object('code', public_code, 'total', total, 'subtotal', subtotal,
      'discount_total', discount_total, 'delivery_fee', delivery_fee, 'status', status,
      'payment_method', payment_method, 'delivery_mode', delivery_mode, 'origin', origin,
      'customer_name', customer_name, 'customer_phone', customer_phone,
      'street', delivery_street, 'number', delivery_street_number, 'city', delivery_city,
      'latitude', delivery_latitude, 'longitude', delivery_longitude,
      'address_source', delivery_address_source)
      from public.orders where business_id = '${BUSINESS_ID}'
  `.replace(/\s+/g, ' ')));
  check('el pedido cobra el mismo total que la web', Number(order.total) === 19800, JSON.stringify(order));
  check('el pedido nace en el pipeline operativo como recibido', order.status === 'received');
  check('el pedido conserva la dirección que se juntó por chat', order.street === 'San Martín' && order.number === '1234' && order.city === 'Neuquén', JSON.stringify(order));
  check('el pedido lleva el punto de entrega que mandó WhatsApp', Number(order.latitude) === -38.9539 && Number(order.longitude) === -68.0596, JSON.stringify(order));
  check('el pedido declara el origen real de esa coordenada', order.address_source === 'gps');
  check('el pedido conserva el teléfono de WhatsApp como contacto', order.customer_phone === WA_ID);
  check(
    'el pedido tiene sus líneas de combo y de producto',
    Number(query(`select count(*) from public.order_items where order_id = (select id from public.orders limit 1)`)) === 3
      && Number(query(`select count(*) from public.order_combos where order_id = (select id from public.orders limit 1)`)) === 1,
  );
  check(
    'la reserva de stock se convirtió exactamente una vez',
    Number(query(`select count(*) from public.inventory_reservations where checkout_session_id = '${checkoutSessionId}' and status = 'converted'`)) === 3,
  );
  const stockAfter = queryJson((`
    select jsonb_object_agg(id::text, stock) from public.products where business_id = '${BUSINESS_ID}'
  `.replace(/\s+/g, ' ')));
  check(
    'finalizar no descuenta el stock una segunda vez',
    Number(stockAfter[HEINEKEN]) === 92 && Number(stockAfter[RED_BULL]) === 58 && Number(stockAfter[COCA]) === 78,
    JSON.stringify(stockAfter),
  );

  // ---- 14. El Panel ve el pedido -----------------------------------------
  const panel = JSON.parse(psqlCapture(`
    begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${OWNER_ID}","role":"authenticated"}';
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'code', public_code,
      'state', pipeline_state, 'total', total, 'origin', origin, 'delivery', delivery_mode)), '[]'::jsonb)::text
      from public.list_operational_pipeline('${BUSINESS_ID}'::uuid, true);
    rollback;
  `).trim());
  const panelOrder = panel.find((row) => row.kind === 'order');
  check('el Panel del negocio ve el pedido de WhatsApp', Boolean(panelOrder), JSON.stringify(panel));
  check('el Panel lo ve con el total correcto', Number(panelOrder?.total) === 19800, JSON.stringify(panelOrder));
  check('el Panel lo ve como pedido de delivery', panelOrder?.delivery === 'delivery');
  const productionPanel = JSON.parse(psqlCapture(`
    begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"${OWNER_ID}","role":"authenticated"}';
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind)), '[]'::jsonb)::text
      from public.list_operational_pipeline('${BUSINESS_ID}'::uuid, false);
    rollback;
  `).trim());
  check(
    'la bandeja de producción NO se ensucia con el pedido sintético',
    productionPanel.length === 0,
    JSON.stringify(productionPanel),
  );

  // ---- 15. El cliente se entera por el mismo canal ------------------------
  const queued = queryJson((`
    select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'status', status, 'payload', payload)), '[]'::jsonb)
      from public.whatsapp_outbound_messages where kind = 'order_confirmed'
  `.replace(/\s+/g, ' ')));
  check('la confirmación quedó encolada al crearse el pedido', queued.length === 1, JSON.stringify(queued));
  const dispatched = await dispatchOutbound({ rpc, sender, owner: 'e2e-dispatcher', limit: 5 });
  check('el despachador manda la confirmación', dispatched.sent === 1, JSON.stringify(dispatched));
  const confirmation = messageText(lastMessage());
  check('la confirmación trae el número de pedido', confirmation.includes(order.code), confirmation);
  check('la confirmación trae el total pagado', confirmation.includes('19.800'), confirmation);
  const dispatchedAgain = await dispatchOutbound({ rpc, sender, owner: 'e2e-dispatcher', limit: 5 });
  check('la confirmación no se manda dos veces', dispatchedAgain.claimed === 0, JSON.stringify(dispatchedAgain));

  // ---- 16. La conversación cierra limpia ---------------------------------
  const closed = queryJson((`
    select jsonb_build_object('state', state, 'cart', cart, 'checkout', checkout_session_id)
      from public.whatsapp_conversations limit 1
  `.replace(/\s+/g, ' ')));
  check('la conversación queda cerrada y sin carrito', closed.state === 'completed' && closed.cart.length === 0, JSON.stringify(closed));

  // ---- 17. Higiene del canal ---------------------------------------------
  const storedEvents = queryJson((`
    select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.whatsapp_inbound_events e
  `.replace(/\s+/g, ' ')));
  const serializedEvents = JSON.stringify(storedEvents);
  check(
    'no se persiste el texto de ningún mensaje del cliente',
    !/HOLA|fernet con coca|San Mart|Neuqu/i.test(serializedEvents),
    serializedEvents.slice(0, 200),
  );
  check(
    'cada mensaje entrante quedó registrado exactamente una vez',
    storedEvents.length === new Set(storedEvents.map((event) => event.provider_message_id)).size,
  );
  const contact = queryJson((`
    select jsonb_build_object('wa_id_hash', wa_id_hash, 'customer_id', customer_id, 'display_name', display_name)
      from public.whatsapp_channel_contacts limit 1
  `.replace(/\s+/g, ' ')));
  check('el contacto guarda un hash para los logs', /^[a-f0-9]{64}$/.test(contact.wa_id_hash));
  check('el contacto quedó atado a un cliente del comercio', Boolean(contact.customer_id));
  check(
    'ninguna tabla del canal es alcanzable desde el navegador',
    count(`
      select count(*) from information_schema.table_privileges
       where table_schema = 'public' and table_name like 'whatsapp%'
         and grantee in ('anon', 'authenticated')
    `.replace(/\s+/g, ' ')) === 0,
  );
  check(
    'ninguna función del canal es ejecutable por anon o authenticated',
    count(`
      select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'whatsapp%'
         and (has_function_privilege('anon', p.oid, 'execute')
              or has_function_privilege('authenticated', p.oid, 'execute'))
    `.replace(/\s+/g, ' ')) === 0,
  );

  // El canal corre como service_role en producción, no como superusuario. Si los
  // privilegios estuvieran mal, todo lo anterior seguiría en verde y el canal
  // fallaría en el primer mensaje real.
  const asServiceRole = psqlCapture(`
    begin;
    set local role service_role;
    select public.whatsapp_upsert_contact(
      '${BUSINESS_ID}'::uuid, '5492995550999', repeat('a', 64), 'Rol de servicio', null
    ) is not null
      and (public.whatsapp_quote_cart('${BUSINESS_ID}'::uuid,
        '[{"product_id":"${COCA}","quantity":1}]'::jsonb, 'pickup') ->> 'total')::numeric = 3200
      and jsonb_array_length(public.whatsapp_catalog_shelves('${BUSINESS_ID}'::uuid)) > 0;
    rollback;
  `).trim();
  check('service_role puede operar el canal completo', asServiceRole === 't', asServiceRole);

  let anonDenied = '';
  try {
    psqlCapture(`
      begin;
      set local role anon;
      select count(*) from public.whatsapp_conversations;
      rollback;
    `);
  } catch (error) {
    anonDenied = error.message;
  }
  check('anon no puede ni leer las conversaciones', /permission denied/i.test(anonDenied), anonDenied);
}

/* ========================================================================== */

let exitCode = 0;
try {
  startContainer();
  const applied = buildDatabase();
  console.log(`Base efímera lista: ${applied} migraciones + escenario sintético.\n`);
  await run();
  console.log(`\n${checks.length - failures}/${checks.length} comprobaciones en verde.`);
  if (failures) {
    console.error(`${failures} comprobación(es) en rojo.`);
    exitCode = 1;
  } else {
    console.log('TABA2_WHATSAPP_COMMERCE_TEST_FLOW_CERTIFIED');
  }
} catch (error) {
  console.error(`\nEl E2E se cortó: ${error.message}`);
  exitCode = 1;
} finally {
  if (!reuseContainer) {
    spawnSync(dockerCommand, ['rm', '-f', container], { stdio: 'ignore' });
  } else {
    spawnSync(dockerCommand, ['exec', container, 'dropdb', '-U', 'postgres', '--if-exists', '--force', database], { stdio: 'ignore' });
  }
}
process.exit(exitCode);
