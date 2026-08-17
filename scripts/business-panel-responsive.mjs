// El Panel del negocio, medido y fotografiado en los anchos donde se usa.
//
// `business-panel-screenshots.mjs` ya fotografiaba ocho pantallas del centro
// operativo a 1280px. Esto hace las tres cosas que faltaban:
//
//   1. entra por el camino de PRODUCCION -el workspace que ve un comercio real,
//      no el panel de demostracion-, y con pedidos adentro, que es cuando el
//      tablero significa algo
//   2. recorre los anchos de telefono de verdad (360…430), la tablet y los tres
//      anchos de escritorio, no un unico 1280
//   3. MIDE en cada combinacion: desborde horizontal, que elemento lo causa,
//      blancos de area tactil y contraste de la tinta contra su superficie
//
// Sin la medida las capturas son una opinion. Con la medida, el reporte dice
// que ancho esta roto y por que elemento, que es lo unico accionable.
//
//   node scripts/business-panel-responsive.mjs --out artifacts/... --label antes
//
// No toca Supabase, Mercado Pago ni ARCA: intercepta las llamadas del cliente y
// responde con datos de prueba. Ninguna captura contiene datos reales.

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}

const PORT = Number.parseInt(arg('port', process.env.TABA_PANEL_SHOT_PORT || '8152'), 10);
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.resolve(arg('out', 'artifacts/taba2-business-commercial-mobile/capturas'));
const LABEL = arg('label', 'estado');
const ONLY = arg('only', '');

const SUPABASE_URL = 'https://taba-panel-responsive.supabase.co';
const BUSINESS_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';
const RIDER_A = '33333333-3333-4333-8333-333333333333';
const RIDER_B = '44444444-4444-4444-8444-444444444444';

// Los anchos donde el Panel se usa de verdad. Los seis primeros son los que
// pidio la mision; el resto cubre tablet y los tres escritorios habituales.
const VIEWPORTS = [
  { name: '360x740', width: 360, height: 740, clase: 'movil' },
  { name: '375x812', width: 375, height: 812, clase: 'movil' },
  { name: '390x844', width: 390, height: 844, clase: 'movil' },
  { name: '393x851', width: 393, height: 851, clase: 'movil' },
  { name: '412x915', width: 412, height: 915, clase: 'movil' },
  { name: '430x932', width: 430, height: 932, clase: 'movil' },
  { name: '844x390-landscape', width: 844, height: 390, clase: 'movil-apaisado' },
  { name: '768x1024', width: 768, height: 1024, clase: 'tablet' },
  { name: '1366x768', width: 1366, height: 768, clase: 'escritorio' },
  { name: '1440x900', width: 1440, height: 900, clase: 'escritorio' },
  { name: '1920x1080', width: 1920, height: 1080, clase: 'escritorio' },
];

// Las superficies del Panel, por el nombre real de su vista.
const PANTALLAS = [
  { id: 'login', vista: null, titulo: 'Ingreso' },
  { id: 'operation-center', vista: 'operation-center', titulo: 'Qué pasa' },
  { id: 'orders', vista: 'orders', titulo: 'Pedidos' },
  { id: 'payments', vista: 'payments', titulo: 'Pagos' },
  { id: 'day-open', vista: 'day-open', titulo: 'Abrir el negocio' },
  { id: 'product-create', vista: 'product-create', titulo: 'Alta de producto' },
  { id: 'inventory-receive', vista: 'inventory-receive', titulo: 'Recepción de stock' },
  { id: 'pos', vista: 'pos', titulo: 'Mostrador' },
  { id: 'fiscal-status', vista: 'fiscal-status', titulo: 'Comprobantes' },
  { id: 'devices', vista: 'devices', titulo: 'Dispositivos' },
  { id: 'day-close', vista: 'day-close', titulo: 'Cerrar el día' },
];

const pantallasPedidas = ONLY ? new Set(ONLY.split(',').map((s) => s.trim())) : null;
const pantallas = pantallasPedidas
  ? PANTALLAS.filter((p) => pantallasPedidas.has(p.id))
  : PANTALLAS;

fs.mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, ['scripts/realtime-relay.mjs', String(PORT)], { stdio: 'ignore' });
const browser = await chromium.launch();
const medidas = [];

try {
  await esperarServidor();

  for (const viewport of VIEWPORTS) {
    const opcionesContexto = {
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      hasTouch: viewport.clase.startsWith('movil'),
      isMobile: viewport.clase.startsWith('movil'),
    };

    // El ingreso necesita un contexto SIN sesión: la sesión se siembra en un
    // `addInitScript`, que no se puede desinstalar una vez puesto.
    const contextoLogin = await browser.newContext(opcionesContexto);
    const paginaLogin = await contextoLogin.newPage();
    await instalarDatosDePrueba(paginaLogin, { conSesion: false });

    const context = await browser.newContext(opcionesContexto);
    const page = await context.newPage();
    await instalarDatosDePrueba(page, { conSesion: true });

    for (const pantalla of pantallas) {
      const hoja = pantalla.vista === null ? paginaLogin : page;
      try {
        await abrir(hoja, pantalla);
        await hoja.waitForTimeout(220);
        const archivo = path.join(OUT, `${LABEL}-${viewport.name}-${pantalla.id}.png`);
        await hoja.screenshot({ path: archivo, fullPage: false });
        medidas.push({
          label: LABEL,
          viewport: viewport.name,
          viewportClass: viewport.clase,
          width: viewport.width,
          height: viewport.height,
          screen: pantalla.id,
          title: pantalla.titulo,
          shot: path.relative(process.cwd(), archivo).replaceAll('\\', '/'),
          ...(await medir(hoja)),
        });
      } catch (error) {
        medidas.push({
          label: LABEL,
          viewport: viewport.name,
          viewportClass: viewport.clase,
          screen: pantalla.id,
          error: String(error.message || error).slice(0, 200),
        });
      }
    }
    await context.close();
    await contextoLogin.close();
  }
} finally {
  await browser.close();
  server.kill();
}

// ---------- reporte ----------

const conDesborde = medidas.filter((m) => m.horizontalOverflow);
const conTactilChico = medidas.filter((m) => (m.smallTargets?.length || 0) > 0);
const conContrasteBajo = medidas.filter((m) => (m.lowContrast?.length || 0) > 0);
const conError = medidas.filter((m) => m.error);

const reporte = {
  schemaVersion: 1,
  label: LABEL,
  generatedAtUtc: new Date().toISOString(),
  viewports: VIEWPORTS.length,
  screens: pantallas.length,
  combinations: medidas.length,
  summary: {
    horizontalOverflow: conDesborde.length,
    smallTouchTargets: conTactilChico.length,
    lowContrastPairs: conContrasteBajo.length,
    errors: conError.length,
  },
  measurements: medidas,
};
fs.writeFileSync(path.join(OUT, `REPORTE-${LABEL}.json`), `${JSON.stringify(reporte, null, 2)}\n`, 'utf8');

const lineas = [
  `# Panel del negocio · responsive (${LABEL})`,
  '',
  `${medidas.length} combinaciones: ${VIEWPORTS.length} anchos × ${pantallas.length} pantallas.`,
  '',
  `- desborde horizontal: **${conDesborde.length}**`,
  `- áreas táctiles por debajo de 44px: **${conTactilChico.length}** combinaciones`,
  `- pares de contraste por debajo de 4,5:1: **${conContrasteBajo.length}** combinaciones`,
  `- errores de navegación: **${conError.length}**`,
  '',
];
if (conDesborde.length) {
  lineas.push('## Desborde horizontal', '');
  for (const m of conDesborde) {
    lineas.push(`- \`${m.viewport}\` · ${m.screen}: ${m.scrollWidth}px sobre ${m.width}px — culpables: ${(m.overflowCulprits || []).join(', ') || 'sin identificar'}`);
  }
  lineas.push('');
}
if (conTactilChico.length) {
  lineas.push('## Áreas táctiles chicas', '');
  for (const m of conTactilChico) {
    lineas.push(`- \`${m.viewport}\` · ${m.screen}: ${m.smallTargets.length} — ${m.smallTargets.slice(0, 4).join(' · ')}`);
  }
  lineas.push('');
}
if (conContrasteBajo.length) {
  lineas.push('## Contraste por debajo de 4,5:1', '');
  for (const m of conContrasteBajo) {
    lineas.push(`- \`${m.viewport}\` · ${m.screen}: ${m.lowContrast.slice(0, 4).join(' · ')}`);
  }
  lineas.push('');
}
fs.writeFileSync(path.join(OUT, `REPORTE-${LABEL}.md`), `${lineas.join('\n')}\n`, 'utf8');

console.log(`capturas: ${medidas.filter((m) => m.shot).length} · desborde: ${conDesborde.length} · táctil: ${conTactilChico.length} · contraste: ${conContrasteBajo.length} · errores: ${conError.length}`);
console.log(`reporte: ${path.relative(process.cwd(), OUT)}`);
process.exitCode = conError.length ? 1 : 0;

// ---------- navegación ----------

async function abrir(page, pantalla) {
  if (pantalla.vista === null) {
    await page.goto(`${BASE}/#business`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-production-auth-card="business"]').waitFor({ state: 'visible', timeout: 20_000 });
    return;
  }
  if (!page.url().includes('#business')) {
    await page.goto(`${BASE}/#business`, { waitUntil: 'domcontentloaded' });
  }
  await page.locator('[data-production-workspace="business"]').waitFor({ state: 'visible', timeout: 30_000 });
  if (pantalla.vista === 'orders') {
    const boton = page.locator('[data-production-orders-view]').first();
    if (await boton.count()) await boton.click();
    await page.locator('.production-order-list').waitFor({ state: 'visible', timeout: 15_000 });
    return;
  }
  const boton = page.locator(`[data-business-ops-view="${pantalla.vista}"]`).first();
  await boton.waitFor({ state: 'visible', timeout: 15_000 });
  await boton.click();
  await page.locator(`[data-business-ops-center="${pantalla.vista}"]`).waitFor({ state: 'visible', timeout: 15_000 });
}

// ---------- medición ----------

async function medir(page) {
  return page.evaluate(() => {
    const raiz = document.querySelector('[data-view="business"]') || document.body;
    const ancho = window.innerWidth;

    // 1 · desborde horizontal, y QUIEN lo causa.
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
      raiz.scrollWidth,
    );
    const culpables = [];
    if (scrollWidth > ancho + 1) {
      for (const nodo of raiz.querySelectorAll('*')) {
        const r = nodo.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right <= ancho + 1) continue;
        // Un contenedor que scrollea a proposito no es un desborde de pagina.
        const estilo = getComputedStyle(nodo);
        if (estilo.overflowX === 'auto' || estilo.overflowX === 'scroll') continue;
        let padre = nodo.parentElement;
        let dentroDeCarril = false;
        while (padre && padre !== raiz) {
          const pe = getComputedStyle(padre);
          if (pe.overflowX === 'auto' || pe.overflowX === 'scroll') { dentroDeCarril = true; break; }
          padre = padre.parentElement;
        }
        if (dentroDeCarril) continue;
        culpables.push(`${nodo.tagName.toLowerCase()}${nodo.className && typeof nodo.className === 'string' ? `.${nodo.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''} (${Math.round(r.right)}px)`);
        if (culpables.length >= 6) break;
      }
    }

    // 2 · areas tactiles. 44px es el minimo de WCAG 2.5.8 / iOS HIG.
    const chicos = [];
    const interactivos = raiz.querySelectorAll('button, a[href], select, input:not([type="hidden"]), textarea, [role="button"], [tabindex]:not([tabindex="-1"])');
    for (const nodo of interactivos) {
      if (nodo.disabled) continue;
      const r = nodo.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(nodo).visibility === 'hidden') continue;
      if (r.height >= 44 && r.width >= 44) continue;
      // Una casilla de verificacion nativa se toca por su etiqueta.
      if (nodo.type === 'checkbox' || nodo.type === 'radio') continue;
      const etiqueta = (nodo.textContent || nodo.getAttribute('aria-label') || nodo.tagName).trim().slice(0, 28);
      chicos.push(`${etiqueta || nodo.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (chicos.length >= 12) break;
    }

    // 3 · contraste de la tinta contra la superficie que efectivamente tiene
    //     detras. Se resuelve subiendo por los ancestros hasta el primer fondo
    //     opaco, porque el fondo de un nodo suele ser transparente.
    const srgb = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
    const parse = (valor) => {
      const m = String(valor).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const partes = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return { rgb: partes.slice(0, 3), a: partes.length > 3 ? partes[3] : 1 };
    };
    const fondoDe = (nodo) => {
      let actual = nodo;
      while (actual && actual !== document.documentElement) {
        const c = parse(getComputedStyle(actual).backgroundColor);
        if (c && c.a >= 0.95) return c.rgb;
        actual = actual.parentElement;
      }
      const c = parse(getComputedStyle(document.body).backgroundColor);
      return c ? c.rgb : [255, 255, 255];
    };
    const razon = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

    const bajos = [];
    const conTexto = raiz.querySelectorAll('p, span, strong, dt, dd, h1, h2, h3, li, label, small, button, a');
    let mirados = 0;
    for (const nodo of conTexto) {
      if (mirados > 400) break;
      const texto = (nodo.textContent || '').trim();
      if (!texto || nodo.children.length) continue;
      const r = nodo.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      mirados += 1;
      const estilo = getComputedStyle(nodo);
      const tinta = parse(estilo.color);
      if (!tinta || tinta.a < 0.9) continue;
      const razonada = razon(tinta.rgb, fondoDe(nodo));
      const tam = Number.parseFloat(estilo.fontSize);
      const grande = tam >= 24 || (tam >= 18.66 && Number(estilo.fontWeight) >= 700);
      const minimo = grande ? 3 : 4.5;
      if (razonada + 0.005 < minimo) {
        bajos.push(`"${texto.slice(0, 22)}" ${razonada.toFixed(2)}:1`);
        if (bajos.length >= 8) break;
      }
    }

    return {
      scrollWidth,
      horizontalOverflow: scrollWidth > ancho + 1,
      overflowCulprits: culpables,
      smallTargets: chicos,
      lowContrast: bajos,
    };
  });
}

// ---------- servidor y datos de prueba ----------

async function esperarServidor() {
  for (let intento = 0; intento < 60; intento += 1) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch (_) { /* todavia no acepta conexiones */ }
    await new Promise((resolve) => { setTimeout(resolve, 500); });
  }
  throw new Error('el servidor local no respondió a tiempo');
}

async function instalarDatosDePrueba(page, { conSesion = true } = {}) {
  await page.route(`${SUPABASE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    if (p.endsWith('/auth/v1/user')) return json(route, sesionDuenio().user);
    if (p.includes('/auth/v1/token')) return json(route, sesionDuenio());
    if (p.includes('/auth/v1/logout')) return route.fulfill({ status: 204, body: '' });
    // La autoridad del rol es la compuerta del backend, no la tabla: el Panel
    // pregunta por `identity_current_context` y sin `session_id` se queda en la
    // tarjeta de acceso. Es la misma respuesta que da produccion cuando la
    // cuenta SI tiene membresia.
    if (p.includes('/rpc/identity_current_context')) {
      return json(route, {
        user_id: OWNER_ID, business_id: BUSINESS_ID, role: 'owner',
        session_id: '55555555-5555-4555-8555-555555555555',
        permissions: ['orders.read', 'orders.write', 'payments.read', 'catalog.write'],
      });
    }
    if (p.includes('/rpc/register_identity_session') || p.includes('/rpc/identity_register_session')) {
      return json(route, { ok: true, session_id: '55555555-5555-4555-8555-555555555555', role: 'owner' });
    }
    if (p.includes('/rest/v1/business_members')) {
      return json(route, { business_id: BUSINESS_ID, user_id: OWNER_ID, role: 'owner', is_active: true });
    }
    if (p.includes('/rest/v1/businesses')) return json(route, negocio());
    if (p.includes('/rest/v1/orders')) return json(route, pedidos());
    if (p.includes('/rpc/list_active_business_riders')) return json(route, riders());
    if (p.includes('/rpc/list_rider_order_offers')) return json(route, []);
    if (p.includes('/rpc/get_production_operation_center')) return json(route, centroDeOperacion());
    if (p.includes('/rpc/get_mercadopago_activation_status')) return json(route, mercadoPago());
    if (p.includes('/rpc/list_business_payments')) return json(route, pagos());
    if (p.includes('/rpc/get_arca_activation_status')) return json(route, arca());
    if (p.includes('/rpc/get_business_opening_status')) return json(route, apertura());
    if (p.includes('/rest/v1/fiscal_profiles')) return json(route, perfilFiscal());
    if (p.includes('/rest/v1/products')) return json(route, []);
    return json(route, []);
  });

  await page.addInitScript(({ businessId, supabaseUrl, sesion }) => {
    globalThis.__LA_TABA_RUNTIME_CONFIG__ = {
      mode: 'production',
      repository: {
        provider: 'supabase', deploymentEnvironment: 'staging', supabaseUrl,
        publishableKey: 'sb_publishable_panel_responsive', businessId, pollMs: 60_000,
      },
    };
    // La clave la deriva supabase-js del primer segmento del host.
    if (sesion) localStorage.setItem('sb-taba-panel-responsive-auth-token', JSON.stringify(sesion));
    globalThis.__TAURI__ = { core: { invoke: async (comando) => {
      if (comando === 'initialize_business_runtime') return true;
      if (comando === 'outbox_list') return [];
      if (comando === 'outbox_get' || comando === 'outbox_find_by_idempotency_key') return null;
      if (comando === 'outbox_put') return true;
      if (comando === 'list_printers') return [{ name: 'EPSON TM-T20 (mostrador)', isDefault: true }];
      if (comando === 'probe_printer') return { name: 'EPSON TM-T20 (mostrador)', reachable: true, outOfPaper: false, error: false, queuedJobs: 0 };
      if (comando === 'check_for_signed_update') return { configured: false, available: false, currentVersion: '0.1.0', version: null };
      return true;
    } } };
  }, { businessId: BUSINESS_ID, supabaseUrl: SUPABASE_URL, sesion: conSesion ? sesionDuenio() : null });
}

function json(route, body) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function sesionDuenio() {
  const expira = Math.floor(Date.parse('2099-01-01T00:00:00Z') / 1000);
  const enc = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const access = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: OWNER_ID, exp: expira, role: 'authenticated' })}.firma`;
  return {
    access_token: access, token_type: 'bearer', expires_in: 3600, expires_at: expira,
    refresh_token: 'panel-responsive-refresh',
    user: {
      id: OWNER_ID, aud: 'authenticated', role: 'authenticated',
      email: 'duenio@la-taba.test', is_anonymous: false, user_metadata: { taba_actor: 'owner' },
    },
  };
}

function negocio() {
  return {
    id: BUSINESS_ID, name: 'La Taba', slug: 'la-taba', status: 'open', is_active: true,
    ordering_enabled: true, ordering_verified: true, whatsapp_phone: '+5492995550000',
  };
}

// Seis pedidos que cubren el arco de la bandeja del negocio. Los estados son
// los de `BUSINESS_INBOX_STATUSES`: 'delivered' y 'canceled' NO entran a la
// bandeja -el repositorio los rechaza con 'estado fuera de bandeja'- asi que
// ponerlos aca no probaria una pantalla, probaria un error de datos.
function pedidos() {
  const ahora = Date.now();
  const hace = (min) => new Date(ahora - min * 60_000).toISOString();
  const base = (n, estado, min, extra = {}) => ({
    id: `00000000-0000-4000-8000-00000000000${n}`,
    public_code: `LT-20${40 + n}`,
    business_id: BUSINESS_ID,
    status: estado,
    created_at: hace(min),
    updated_at: hace(Math.max(0, min - 2)),
    revision: n,
    currency_code: 'ARS',
    payment_method: extra.payment_method || 'cash',
    delivery_mode: extra.delivery_mode || 'delivery',
    customer_name: extra.customer_name,
    customer_phone: extra.customer_phone,
    address_label: extra.address_label || 'Mendoza 851, Centro, Neuquén',
    delivery_street: 'Mendoza', delivery_street_number: '851',
    delivery_city: 'Neuquén', delivery_province: 'Neuquén',
    customer_notes: extra.customer_notes || null,
    subtotal: extra.subtotal, delivery_fee: extra.delivery_fee ?? 1990,
    discount_total: extra.discount_total ?? 0,
    total: extra.total,
    assigned_rider_user_id: extra.assigned_rider_user_id || null,
    order_items: extra.order_items,
    order_events: [],
    order_combos: [],
  });

  return [
    base(1, 'submitted', 3, {
      customer_name: 'Lucía Fernández', customer_phone: '2995550101',
      customer_notes: 'Tocar timbre del portón gris, el perro ladra pero no muerde.',
      subtotal: 12800, total: 14790,
      order_items: [
        { id: 'i1', product_uuid: '99999999-9999-4999-8999-999999999901', name: 'Cerveza Patagonia Amber Lager 730 ml', product_name: 'Cerveza Patagonia Amber Lager 730 ml', quantity: 4, unit_price: 2400, unit_label: 'botella', unit: 'botella' },
        { id: 'i2', product_uuid: '99999999-9999-4999-8999-999999999902', name: 'Papas fritas clásicas 150 g', product_name: 'Papas fritas clásicas 150 g', quantity: 2, unit_price: 1600, unit_label: 'paquete', unit: 'paquete' },
      ],
    }),
    base(2, 'submitted', 9, {
      customer_name: 'Martín Ojeda', customer_phone: '2995550102',
      delivery_mode: 'pickup', delivery_fee: 0,
      payment_method: 'mercadopago',
      subtotal: 8600, total: 8600,
      order_items: [
        { id: 'i3', product_uuid: '99999999-9999-4999-8999-999999999903', name: 'Fernet Branca 750 ml', product_name: 'Fernet Branca 750 ml', quantity: 1, unit_price: 8600, unit_label: 'botella', unit: 'botella' },
      ],
    }),
    base(3, 'preparing', 18, {
      customer_name: 'Sofía Quintriqueo', customer_phone: '2995550103',
      subtotal: 21400, total: 23390,
      address_label: 'Bahía Blanca 1240, Alta Barda, Neuquén',
      order_items: [
        { id: 'i4', product_uuid: '99999999-9999-4999-8999-999999999904', name: 'Vino Malbec Reserva 750 ml', product_name: 'Vino Malbec Reserva 750 ml', quantity: 2, unit_price: 7900, unit_label: 'botella', unit: 'botella' },
        { id: 'i5', product_uuid: '99999999-9999-4999-8999-999999999905', name: 'Agua tónica 1,5 L', product_name: 'Agua tónica 1,5 L', quantity: 3, unit_price: 1200, unit_label: 'botella', unit: 'botella' },
        { id: 'i6', product_uuid: '99999999-9999-4999-8999-999999999906', name: 'Maní salado 200 g', product_name: 'Maní salado 200 g', quantity: 1, unit_price: 2000, unit_label: 'paquete', unit: 'paquete' },
      ],
    }),
    base(4, 'ready', 26, {
      customer_name: 'Diego Arriagada', customer_phone: '2995550104',
      subtotal: 9600, total: 11590,
      order_items: [
        { id: 'i7', product_uuid: '99999999-9999-4999-8999-999999999907', name: 'Gaseosa cola 2,25 L', product_name: 'Gaseosa cola 2,25 L', quantity: 4, unit_price: 2400, unit_label: 'botella', unit: 'botella' },
      ],
    }),
    base(5, 'on_the_way', 41, {
      customer_name: 'Valentina Ruiz', customer_phone: '2995550105',
      assigned_rider_user_id: RIDER_A,
      subtotal: 15200, total: 17190,
      address_label: 'Chubut 455, Villa Florencia, Neuquén',
      order_items: [
        { id: 'i8', product_uuid: '99999999-9999-4999-8999-999999999908', name: 'Cerveza artesanal IPA 500 ml', product_name: 'Cerveza artesanal IPA 500 ml', quantity: 6, unit_price: 2200, unit_label: 'botella', unit: 'botella' },
        { id: 'i9', product_uuid: '99999999-9999-4999-8999-999999999909', name: 'Hielo en cubos 3 kg', product_name: 'Hielo en cubos 3 kg', quantity: 1, unit_price: 2000, unit_label: 'bolsa', unit: 'bolsa' },
      ],
    }),
    base(6, 'arrived', 96, {
      customer_name: 'Ramiro Paillalef', customer_phone: '2995550106',
      assigned_rider_user_id: RIDER_B,
      subtotal: 6400, total: 8390,
      order_items: [
        { id: 'i10', product_uuid: '99999999-9999-4999-8999-999999999910', name: 'Sidra 910 ml', product_name: 'Sidra 910 ml', quantity: 2, unit_price: 3200, unit_label: 'botella', unit: 'botella' },
      ],
    }),
  ];
}

function riders() {
  return [
    { rider_user_id: RIDER_A, id: RIDER_A, display_name: 'Nahuel Cárdenas', active_order_count: 1, max_active_orders: 3, is_active: true },
    { rider_user_id: RIDER_B, id: RIDER_B, display_name: 'Camila Antileo', active_order_count: 3, max_active_orders: 3, is_active: true },
  ];
}

function centroDeOperacion() {
  return {
    generated_at: new Date().toISOString(),
    business_id: BUSINESS_ID,
    metrics: {
      new_orders: 2, delayed_orders: 1, pending_payments: 2, payments_in_review: 1,
      orders_without_stock: 0, packing_incomplete: 1, active_deliveries: 1,
      riders_without_signal: 0, fiscal_documents_pending: 1, failed_prints: 0,
      pending_credit_notes: 0, blocked_outboxes: 0, reconciliations_required: 1,
    },
    alerts: [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', severity: 'CRITICAL', status: 'open',
        code: 'PAYMENT_APPROVED_WITHOUT_ORDER', correlation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        last_seen_at: new Date().toISOString(), occurrence_count: 1,
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', severity: 'ACTION_REQUIRED', status: 'open',
        code: 'PRINT_JOB_FAILED', correlation_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        last_seen_at: new Date().toISOString(), occurrence_count: 2,
      },
    ],
    recent_closures: [],
  };
}

function mercadoPago() {
  return {
    settings_present: true, enabled: true, environment: 'test', currency: 'ARS', reserve_stock: true,
    collector_configured: true, application_configured: true,
    collector_id_short: '8877', application_id_short: '2233',
    configured_at: new Date().toISOString(), credentials_loaded: true,
    signed_notice_at: new Date().toISOString(), rejected_notices_recent: 0,
    test_payment_at: new Date().toISOString(), test_payment_order_created: true,
    test_payment_stock_applied: true, storefront_ready: true, production_review_status: 'not_requested',
  };
}

function pagos() {
  const ahora = new Date().toISOString();
  return [
    { payment_intent_id: 'p-1', internal_status: 'approved_order_pending', amount: 8600, currency: 'ARS', method: 'Tarjeta de crédito', created_at: ahora, can_reconcile: true, payment_id_short: '445566' },
    { payment_intent_id: 'p-2', internal_status: 'completed', order_public_code: 'LT-2045', amount: 17190, currency: 'ARS', method: 'Tarjeta de débito', approved_at: ahora, can_refund: true, can_reconcile: true, payment_id_short: '778899' },
    { payment_intent_id: 'p-3', internal_status: 'in_process', order_public_code: 'LT-2044', amount: 11590, currency: 'ARS', method: 'Efectivo en sucursal', created_at: ahora, can_cancel: true },
  ];
}

function arca() {
  return {
    legal_name: 'La Taba SRL', cuit: '30712345678', cuit_valid: true,
    tax_condition: 'Responsable Inscripto', business_address: 'Mendoza 827, Neuquén',
    accountant_review_status: 'approved', environment: 'homologation', point_of_sale: 4,
    certificate_loaded: true,
    certificate_expires_at: new Date(Date.now() + 200 * 86_400_000).toISOString(),
    certificate_cuit_mismatch: false, delegation_status: 'verified',
    connection_ok_at: new Date().toISOString(), homologation_authorized_at: new Date().toISOString(),
    homologated_invoices: 1, homologated_credit_notes: 0,
    pending_documents: 1, stalled_documents: 0,
    last_document_label: 'FA 4 00000001', last_document_at: new Date().toISOString(),
    last_document_failed: false, last_error_code: null, last_error_at: null,
    artifact_verified_at: null, print_verified_at: null,
  };
}

function apertura() {
  return {
    generated_at: new Date().toISOString(), business_status: 'open',
    backend: { status: 'ok', detail: 'El sistema del negocio respondió.' },
    payments: { status: 'ok', detail: 'Los cobros por la web están activos.' },
    fiscal: { status: 'ok', detail: 'La facturación está activa.' },
    riders: { status: 'ok', detail: '2 repartidor(es) disponible(s).' },
    queues: { status: 'ok', detail: 'No quedó nada trabado de antes.' },
    open_orders: 4,
  };
}

function perfilFiscal() {
  return {
    business_id: BUSINESS_ID, legal_name: 'La Taba SRL', cuit: '30712345678',
    tax_condition: 'Responsable Inscripto', business_address: 'Mendoza 827, Neuquén',
    environment: 'homologation', point_of_sale: 4, is_enabled: true,
    accountant_review_status: 'approved', production_gate_status: 'blocked',
  };
}
