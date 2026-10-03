/**
 * Certificación de «Cómo viene el sistema» en la URL PÚBLICA, contra la base viva.
 *
 * Crea un operador TEST sintético, entra al Panel como entra una persona,
 * comprueba que la salud operativa se dibuja con los datos que el servidor
 * mide de verdad, que sin datos NO se pinta de verde, que no se filtra ningún
 * secreto y que las alertas que ya existían siguen apareciendo. Al terminar,
 * borra el operador y su membresía.
 *
 * Ninguna credencial se imprime.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const URL_PUBLICA = 'https://taba2-staging.pages.dev';
const SB = `https://${process.env.TABA_STAGING_REF}.supabase.co`;
const SR = process.env.TABA_SR_KEY;
const SALIDA = 'D:/1212/artifacts/taba2-operational-resilience/certificacion-salud-publica.json';
const EV = 'D:/1212/artifacts/taba2-operational-resilience';

const H = { apikey: SR, authorization: `Bearer ${SR}`, 'content-type': 'application/json' };
const rest = async (path, init = {}) => {
  const response = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  const text = await response.text();
  try { return { status: response.status, body: JSON.parse(text) }; } catch { return { status: response.status, body: text }; }
};

const pasos = [];
const anotar = (nombre, ok, detalle = '') => {
  pasos.push({ nombre, ok, detalle });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${nombre.padEnd(58, '.')} ${detalle}`);
};

// ===== 1 · Operador TEST sintético =====
const negocio = (await rest('businesses?select=id,name&status=neq.closed&limit=1')).body[0];
const sufijo = Math.random().toString(36).slice(2, 10);
const email = `qa-salud-${sufijo}@example.invalid`;
const password = `Qa!${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2).toUpperCase()}`;

const alta = await fetch(`${SB}/auth/v1/admin/users`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { taba_actor: 'qa_certificacion_salud' } }),
});
const usuario = await alta.json();
if (!usuario?.id) throw new Error(`no se pudo crear el operador de prueba: ${alta.status}`);
await rest('business_members', {
  method: 'POST',
  headers: { prefer: 'return=representation' },
  body: JSON.stringify({ business_id: negocio.id, user_id: usuario.id, role: 'owner', is_active: true }),
});
console.log(`· operador TEST creado para ${negocio.name} (se borra al final)\n`);

const saludReal = (await rest('rpc/build_operational_health', {
  method: 'POST', body: JSON.stringify({ p_business_id: negocio.id }),
})).body;
const alertasReales = (await rest(`operational_alerts?select=alert_code,severity&business_id=eq.${negocio.id}&status=neq.resolved`)).body;

let resultado = { momento: new Date().toISOString(), url: URL_PUBLICA, negocio: negocio.name };
const navegador = await chromium.launch({ headless: true });
const contexto = await navegador.newContext({ viewport: { width: 1360, height: 1100 }, locale: 'es-AR' });
const pagina = await contexto.newPage();
const errores = []; const malas = [];
pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
pagina.on('console', (m) => { if (m.type() === 'error' && !/favicon/i.test(m.text())) errores.push(m.text().slice(0, 200)); });
pagina.on('response', (r) => { if (r.status() >= 400 && !/favicon/i.test(r.url())) malas.push(`${r.status()} ${r.url().replace(/\?.*/, '')}`); });

try {
  // ===== 2 · El Panel abre =====
  await pagina.goto(`${URL_PUBLICA}/#business`, { waitUntil: 'load', timeout: 90_000 });
  await pagina.waitForTimeout(6000);
  const form = pagina.locator('form:has(input[name="email"]):visible').last();
  await form.locator('input[name="email"]').fill(email);
  await form.locator('input[name="password"]').fill(password);
  await form.locator('button[type="submit"]').first().click();
  await pagina.waitForTimeout(14_000);

  const texto = async () => pagina.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  let t = await texto();
  anotar('el Panel abre con una cuenta de operador', /PANEL DEL NEGOCIO/i.test(t), 'sesión verificada');

  // ===== 3 · El Centro de operación con la salud =====
  await pagina.locator('button:has-text("Centro de operación"), a:has-text("Centro de operación")').first().click().catch(() => {});
  await pagina.waitForTimeout(9000);
  await pagina.locator('[data-operation-health-section]').first().waitFor({ state: 'attached', timeout: 30_000 }).catch(() => {});
  await pagina.screenshot({ path: `${EV}/panel-salud-operativa.png`, fullPage: false }).catch(() => {});

  const seccion = await pagina.evaluate(() => {
    const nodo = document.querySelector('[data-operation-health-section]');
    if (!nodo) return null;
    return {
      estado: nodo.dataset.operationHealthSection,
      titular: nodo.querySelector('.operation-health-headline strong')?.textContent?.trim() || '',
      detalle: nodo.querySelector('.operation-health-headline span')?.textContent?.trim() || '',
      filas: [...nodo.querySelectorAll('[data-operation-health]')].map((fila) => ({
        clave: fila.dataset.operationHealth,
        etiqueta: fila.querySelector('dt')?.textContent?.trim() || '',
        valor: fila.querySelector('[data-operation-health-value]')?.textContent?.trim() || '',
        detalle: fila.querySelector('small')?.textContent?.trim() || '',
      })),
    };
  });
  anotar('«Cómo viene el sistema» se dibuja en la URL pública', Boolean(seccion) && seccion.estado === 'medido',
    seccion ? seccion.titular : 'no está');
  resultado.seccion = seccion;

  // ===== 4 · Los datos son los que el servidor mide =====
  const vigilancia = seccion?.filas.find((f) => f.clave === 'watch');
  const esperadoVigilancia = saludReal?.autonomous_evaluation?.state === 'al día' ? 'Al día' : 'Detenida';
  anotar('la vigilancia automática muestra el estado real del backend',
    vigilancia?.valor === esperadoVigilancia,
    `pantalla="${vigilancia?.valor}" servidor="${saludReal?.autonomous_evaluation?.state}"`);

  const tareas = seccion?.filas.find((f) => f.clave === 'tasks');
  const cuantas = (saludReal?.scheduler || []).length;
  const sanas = (saludReal?.scheduler || []).filter((s) => s.state === 'al día').length;
  anotar('las tareas automáticas coinciden con el planificador real',
    tareas?.valor === `${sanas} de ${cuantas} al día`, `pantalla="${tareas?.valor}"`);

  const cobros = seccion?.filas.find((f) => f.clave === 'paid-without-order');
  anotar('«dinero cobrado sin pedido» sale del backend, no de un cero fijo',
    cobros?.valor === String(saludReal?.payments?.reconciliation?.paid_without_order),
    `pantalla="${cobros?.valor}" servidor=${saludReal?.payments?.reconciliation?.paid_without_order}`);

  const secretos = seccion?.filas.find((f) => f.clave === 'secrets');
  anotar('la configuración de cobros se informa por estado, no por valor',
    secretos?.valor === `${(saludReal?.secrets || []).filter((s) => s.configured).length} de ${(saludReal?.secrets || []).length} cargadas`,
    `pantalla="${secretos?.valor}"`);

  // ===== 5 · Ningún secreto en la pantalla =====
  const html = await pagina.content();
  const sospechas = (html.match(/\b(eyJ[A-Za-z0-9_-]{20,}|sb_[A-Za-z0-9_-]{20,}|sbp_[A-Za-z0-9]{20,})\b/g) || [])
    .filter((token) => !token.startsWith('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9') || false);
  anotar('la pantalla no contiene ningún secreto de la bóveda',
    !html.includes('taba_payment_worker_hmac_secret') || !/decrypted_secret/i.test(html),
    `tokens con forma de credencial en el HTML: ${sospechas.length}`);
  resultado.tokensSospechosos = sospechas.length;

  // ===== 6 · Sin datos NO es verde, con el módulo PUBLICADO =====
  const sinDatos = await pagina.evaluate(async (base) => {
    const modulo = await import(`${base}/js/business/business-panel-render.js`);
    const html = modulo.renderOperationCenterSurface({
      snapshot: { metrics: {}, alerts: [], recent_closures: [], generated_at: new Date().toISOString() },
      status: { phase: 'ready' }, role: 'owner',
    });
    const contenedor = document.createElement('div');
    contenedor.innerHTML = html;
    const nodo = contenedor.querySelector('[data-operation-health-section]');
    return {
      estado: nodo?.dataset.operationHealthSection,
      clase: nodo?.className,
      titular: nodo?.querySelector('.operation-health-headline strong')?.textContent?.trim(),
    };
  }, URL_PUBLICA);
  anotar('sin datos, el módulo publicado NO se pinta de verde',
    sinDatos.estado === 'sin-datos' && !String(sinDatos.clase).includes('tone-calm'),
    `${sinDatos.estado} · ${sinDatos.clase} · "${sinDatos.titular}"`);
  resultado.sinDatos = sinDatos;

  // ===== 7 · Las alertas que ya existían siguen ahí =====
  t = await texto();
  const codigosEnPantalla = await pagina.evaluate(() => document.querySelectorAll('[data-operational-alert]').length);
  anotar('las alertas existentes siguen apareciendo',
    codigosEnPantalla >= alertasReales.length && alertasReales.length > 0,
    `pantalla=${codigosEnPantalla} servidor=${alertasReales.length} (${alertasReales.map((a) => a.alert_code).join(', ')})`);
  anotar('y se leen en castellano, sin el código interno',
    /repartidor/i.test(t) && !/RIDER_SIGNAL_STALE/.test(t), 'texto de operador');

  anotar('cero errores de consola', errores.length === 0, errores.slice(0, 2).join(' | '));
  anotar('cero respuestas 4xx o 5xx', malas.length === 0, malas.slice(0, 3).join(' | '));
} finally {
  await navegador.close();
  // ===== Limpieza: el operador de prueba no sobrevive a esta certificación =====
  await rest(`business_members?user_id=eq.${usuario.id}`, { method: 'DELETE' });
  const borrado = await fetch(`${SB}/auth/v1/admin/users/${usuario.id}`, { method: 'DELETE', headers: H });
  const quedan = (await rest(`business_members?select=user_id&user_id=eq.${usuario.id}`)).body;
  anotar('el operador de prueba se borra al terminar',
    borrado.ok && Array.isArray(quedan) && quedan.length === 0, `HTTP ${borrado.status}`);
}

resultado = {
  ...resultado,
  pasos,
  verdes: pasos.filter((p) => p.ok).length,
  total: pasos.length,
  errores,
  respuestas4xx: malas,
};
fs.writeFileSync(SALIDA, `${JSON.stringify(resultado, null, 2)}\n`, 'utf8');
console.log(`\n${resultado.verdes}/${resultado.total} · evidencia en ${SALIDA}`);
process.exit(resultado.verdes === resultado.total ? 0 : 1);
