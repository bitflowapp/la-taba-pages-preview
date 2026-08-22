import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluarAutorizacion, evaluarConcurrencia, evaluarDecremento, evaluarDireccion,
  evaluarNegocio, evaluarPago, evaluarProducto, evaluarRider, evaluarSesion, primerBloqueo,
} from '../scripts/e2e-production-sale/guards.mjs';
// eslint-disable-next-line no-duplicate-imports -- se importa aparte para probar la lectura dinámica del entorno
import { assertSoloLectura, ConsultaNoPermitida } from '../scripts/e2e-production-sale/db-solo-lectura.mjs';
import { cerrarLock, generarRunId, leerLock, tomarLock } from '../scripts/e2e-production-sale/lock.mjs';
import { construirReporte, redactar, redactarProfundo } from '../scripts/e2e-production-sale/evidencia.mjs';
import { AUTORIZACION, PRODUCTO_AUTORIZADO } from '../scripts/e2e-production-sale/contrato.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/*
 * El harness compra UNA vez en producción real. Estos casos prueban al
 * automatizador, no a la tienda: que sin las cuatro llaves no compre, que no
 * pueda escribir en la base ni por descuido, que el PIN no sobreviva a un log
 * y que una corrida a medias frene a la siguiente.
 */

const PRODUCTO_OK = {
  external_id: PRODUCTO_AUTORIZADO.externalId,
  stock: 6,
  available: true,
  is_verified: true,
  is_active: true,
  is_alcoholic: false,
  price: '4990.00',
};
const NEGOCIO_OK = {
  is_active: true, ordering_enabled: true, ordering_verified: true, alcohol_sales_enabled: false,
};
const todasLasLlaves = () => ({
  flags: new Set(AUTORIZACION.flags),
  env: { [AUTORIZACION.variable]: AUTORIZACION.valor },
});

// ── Autorización ─────────────────────────────────────────────────────────────

test('no crea pedido sin la variable de entorno', () => {
  const { flags } = todasLasLlaves();
  const resultado = evaluarAutorizacion({ flags, env: {} });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.codigo, 'AUTORIZACION_AUSENTE');
});

test('no crea pedido con la variable mal escrita', () => {
  const { flags } = todasLasLlaves();
  const resultado = evaluarAutorizacion({ flags, env: { [AUTORIZACION.variable]: 'si dale' } });
  assert.equal(resultado.ok, false);
});

test('no crea pedido si falta cualquiera de las tres banderas', () => {
  const { env } = todasLasLlaves();
  for (const faltante of AUTORIZACION.flags) {
    const flags = new Set(AUTORIZACION.flags.filter((f) => f !== faltante));
    const resultado = evaluarAutorizacion({ flags, env });
    assert.equal(resultado.ok, false, `sin --${faltante} tendría que bloquear`);
    assert.equal(resultado.codigo, 'FLAGS_FALTANTES');
    assert.match(resultado.mensaje, new RegExp(`--${faltante}`));
  }
});

test('las cuatro llaves juntas habilitan la compra, y sólo así', () => {
  const { flags, env } = todasLasLlaves();
  assert.equal(evaluarAutorizacion({ flags, env }).ok, true);
  assert.equal(evaluarAutorizacion({ flags: new Set(), env: {} }).ok, false);
});

// ── Producto ─────────────────────────────────────────────────────────────────

test('rechaza una cantidad distinta de uno', () => {
  for (const cantidad of [2, 6, 0, -1, 1.5]) {
    const resultado = evaluarProducto(PRODUCTO_OK, { cantidad });
    assert.equal(resultado.ok, false, `cantidad ${cantidad} tendría que bloquear`);
    assert.equal(resultado.codigo, 'CANTIDAD_NO_AUTORIZADA');
  }
  assert.equal(evaluarProducto(PRODUCTO_OK, { cantidad: 1 }).ok, true);
});

test('rechaza otro SKU aunque exista y esté publicado', () => {
  const otro = { ...PRODUCTO_OK, external_id: 'coca-cola-zero-pet-1500ml' };
  assert.equal(evaluarProducto(otro).codigo, 'SKU_NO_AUTORIZADO');
});

test('rechaza cualquier producto con alcohol', () => {
  assert.equal(evaluarProducto({ ...PRODUCTO_OK, is_alcoholic: true }).codigo, 'ALCOHOL');
});

test('rechaza stock cero o insuficiente', () => {
  assert.equal(evaluarProducto({ ...PRODUCTO_OK, stock: 0 }).codigo, 'SIN_STOCK');
  assert.equal(evaluarProducto({ ...PRODUCTO_OK, stock: null }).codigo, 'SIN_STOCK');
});

test('rechaza un producto sin publicar', () => {
  const resultado = evaluarProducto({ ...PRODUCTO_OK, available: false });
  assert.equal(resultado.codigo, 'NO_PUBLICADO');
  assert.match(resultado.mensaje, /recepción física/);
});

test('rechaza un precio distinto salvo aceptación explícita', () => {
  const caro = { ...PRODUCTO_OK, price: '5990.00' };
  assert.equal(evaluarProducto(caro).codigo, 'PRECIO_DISTINTO');
  assert.equal(evaluarProducto(caro, { aceptaPrecioDistinto: true }).ok, true);
});

test('rechaza un producto que no existe', () => {
  assert.equal(evaluarProducto(null).codigo, 'PRODUCTO_INEXISTENTE');
});

// ── Negocio, repartidor, pago, dirección ─────────────────────────────────────

test('rechaza operar con el comercio cerrado o con alcohol habilitado', () => {
  assert.equal(evaluarNegocio({ ...NEGOCIO_OK, ordering_enabled: false }).codigo, 'PEDIDOS_CERRADOS');
  assert.equal(evaluarNegocio({ ...NEGOCIO_OK, ordering_verified: false }).codigo, 'PEDIDOS_NO_VERIFICADOS');
  assert.equal(evaluarNegocio({ ...NEGOCIO_OK, alcohol_sales_enabled: true }).codigo, 'ALCOHOL_HABILITADO');
  assert.equal(evaluarNegocio({ ...NEGOCIO_OK, is_active: false }).codigo, 'NEGOCIO_INACTIVO');
  assert.equal(evaluarNegocio(NEGOCIO_OK).ok, true);
});

test('rechaza un repartidor ausente o el paquete equivocado', () => {
  const base = { miembroActivo: true, paquete: 'com.lataba.rider', dispositivoConectado: true };
  assert.equal(evaluarRider(base).ok, true);
  assert.equal(evaluarRider({ ...base, dispositivoConectado: false }).codigo, 'RIDER_SIN_DISPOSITIVO');
  assert.equal(evaluarRider({ ...base, miembroActivo: false }).codigo, 'RIDER_INACTIVO');
  assert.equal(evaluarRider({ ...base, paquete: 'com.lataba.rider.staging' }).codigo, 'RIDER_PAQUETE');
});

test('sólo acepta efectivo o coordinar: nunca Mercado Pago', () => {
  assert.equal(evaluarPago('cash').ok, true);
  assert.equal(evaluarPago('coordinate').ok, true);
  assert.equal(evaluarPago('mercadopago').codigo, 'PAGO_NO_AUTORIZADO');
  assert.equal(evaluarPago('transfer').codigo, 'PAGO_NO_AUTORIZADO');
  assert.equal(evaluarPago('').codigo, 'PAGO_AUSENTE');
});

test('sin dirección aprobada no se compra: no se manda un repartidor a donde salga', () => {
  assert.equal(evaluarDireccion('Mendoza 827', { env: {} }).codigo, 'DIRECCION_SIN_CONFIGURAR');
});

test('con dirección configurada, exige que el checkout muestre ESA', () => {
  const env = { TABA2_E2E_DIRECCION_TEXTO: 'Mendoza 827' };
  assert.equal(evaluarDireccion('Mendoza 827, Neuquén', { env }).ok, true);
  assert.equal(evaluarDireccion('MENDOZA 827, neuquen', { env }).ok, true, 'no distingue mayúsculas ni acentos');
  assert.equal(evaluarDireccion('Av. Argentina 100', { env }).codigo, 'DIRECCION_DISTINTA');
  assert.equal(evaluarDireccion('', { env }).codigo, 'DIRECCION_AUSENTE');
});

test('la dirección aprobada se lee del entorno en el momento, no al importar', async () => {
  // Una constante congelada al arranque haría que fijar la variable después no
  // tuviera efecto, y eso en esta compuerta es silencio peligroso.
  const { direccionPermitida } = await import('../scripts/e2e-production-sale/contrato.mjs');
  assert.equal(direccionPermitida({}).descripcionEsperada, '');
  assert.equal(direccionPermitida({ TABA2_E2E_DIRECCION_TEXTO: ' Mendoza 827 ' }).descripcionEsperada, 'Mendoza 827');
});

// ── Sesiones ─────────────────────────────────────────────────────────────────

test('una sesión vencida frena la compra con AUTH SESSION EXPIRED', () => {
  const vencida = evaluarSesion({ nombre: 'cliente', existe: true, vencida: true, verificada: true });
  assert.equal(vencida.codigo, 'AUTH_SESSION_EXPIRED');
  assert.equal(evaluarSesion({ nombre: 'cliente', existe: false }).codigo, 'AUTH_SESSION_MISSING');
  assert.equal(evaluarSesion({ nombre: 'cliente', existe: true, vencida: false, verificada: false }).codigo, 'AUTH_SESSION_INVALID');
  assert.equal(evaluarSesion({ nombre: 'cliente', existe: true, vencida: false, verificada: true }).ok, true);
});

// ── Concurrencia, lock y run_id ──────────────────────────────────────────────

test('una corrida anterior sin cerrar frena la siguiente', () => {
  const bloqueo = evaluarConcurrencia({ lockPrevio: { runId: 'anterior', estado: 'fallido' } });
  assert.equal(bloqueo.codigo, 'CORRIDA_ANTERIOR_ABIERTA');
  assert.match(bloqueo.mensaje, /diagnosticala/);
  assert.equal(evaluarConcurrencia({ lockPrevio: null }).ok, true);
});

test('el lock se toma, se lee y sólo se libera cuando la corrida sale bien', () => {
  const raiz = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'taba-lock-'));
  try {
    assert.equal(leerLock(raiz), null);
    tomarLock({ runId: 'r1', modo: 'prueba', raiz });
    assert.equal(leerLock(raiz).runId, 'r1');
    // Una corrida fallida DEJA el lock puesto.
    cerrarLock({ runId: 'r1', estado: 'fallido', raiz });
    assert.equal(leerLock(raiz).estado, 'fallido');
    assert.equal(evaluarConcurrencia({ lockPrevio: leerLock(raiz) }).ok, false);
    // Una corrida buena lo libera.
    tomarLock({ runId: 'r2', modo: 'prueba', raiz });
    cerrarLock({ runId: 'r2', estado: 'ok', raiz });
    assert.equal(leerLock(raiz), null);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('un lock ilegible se trata como lock: fallar cerrado', () => {
  const raiz = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'taba-lock-'));
  try {
    fs.mkdirSync(path.join(raiz, '.local/locks'), { recursive: true });
    fs.writeFileSync(path.join(raiz, '.local/locks/production-sale-e2e.lock'), 'no es json');
    assert.equal(evaluarConcurrencia({ lockPrevio: leerLock(raiz) }).ok, false);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('cada corrida tiene un run_id único', () => {
  const vistos = new Set();
  for (let i = 0; i < 300; i += 1) vistos.add(generarRunId());
  assert.equal(vistos.size, 300);
});

// ── La base es de sólo lectura, y no se negocia ──────────────────────────────

test('el ayudante de base acepta SELECT y nada más', () => {
  assert.doesNotThrow(() => assertSoloLectura('select 1'));
  assert.doesNotThrow(() => assertSoloLectura('with x as (select 1) select * from x'));
  for (const prohibida of [
    "update public.products set stock = 5",
    "insert into public.orders (id) values ('x')",
    'delete from public.orders',
    'drop table public.products',
    'truncate public.orders',
    "select 1; update public.products set stock = 0",
    'begin',
    "select apply_inventory_movement('a','b','c','purchase_receipt',1,1,null,null,null,'k')",
    "select public.transition_order('x')",
  ]) {
    assert.throws(() => assertSoloLectura(prohibida), ConsultaNoPermitida, `tendría que rechazar: ${prohibida}`);
  }
});

test('una escritura escondida en un comentario tampoco pasa', () => {
  assert.throws(() => assertSoloLectura('-- select\nupdate public.products set stock = 1'), ConsultaNoPermitida);
});

test('columnas que se llaman parecido a una escritura siguen permitidas', () => {
  assert.doesNotThrow(() => assertSoloLectura('select updated_at, created_at from public.orders'));
});

// ── El harness no repara: no puede escribir ni queriendo ─────────────────────

test('ningún módulo del harness abre un camino de escritura a la base', () => {
  const directorio = path.join(ROOT, 'scripts/e2e-production-sale');
  for (const archivo of fs.readdirSync(directorio).filter((f) => f.endsWith('.mjs'))) {
    if (archivo === 'db-solo-lectura.mjs') continue;
    const fuente = fs.readFileSync(path.join(directorio, archivo), 'utf8');
    const codigo = fuente.split('\n').filter((linea) => !/^\s*(\/\/|\*|\/\*)/.test(linea)).join('\n');
    assert.doesNotMatch(codigo, /supabase-cli-token/, `${archivo} no puede pedir el token por su cuenta`);
    assert.doesNotMatch(codigo, /database\/query/, `${archivo} no puede hablar con la base directamente`);
    assert.doesNotMatch(codigo, /\b(update|insert into|delete from)\s+public\./i, `${archivo} contiene una escritura`);
  }
});

test('el decremento de stock se exige exacto: ni de más ni de menos', () => {
  assert.equal(evaluarDecremento({ antes: 6, despues: 5 }).ok, true);
  assert.equal(evaluarDecremento({ antes: 6, despues: 6 }).codigo, 'P0_STOCK_DECREMENT_FAILURE');
  assert.equal(evaluarDecremento({ antes: 6, despues: 4 }).codigo, 'P0_STOCK_DECREMENT_FAILURE');
  assert.equal(evaluarDecremento({ antes: 6, despues: 0 }).codigo, 'P0_STOCK_DECREMENT_FAILURE');
});

// ── El PIN no sobrevive a un log ─────────────────────────────────────────────

test('el PIN nunca queda escrito: se redacta en texto y en estructuras', () => {
  assert.equal(redactar('el código de entrega es 4821'), 'el código de entrega es [PIN-REDACTADO]');
  const redactado = redactarProfundo({ pin: '4821', nota: 'ingresó 4821', anidado: { deliveryPin: '0000' } });
  assert.equal(redactado.pin, '[REDACTADO]');
  assert.equal(redactado.anidado.deliveryPin, '[REDACTADO]');
  assert.doesNotMatch(JSON.stringify(redactado), /4821/);
});

test('tokens, claves y teléfonos tampoco quedan escritos', () => {
  const sucio = [
    'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
    'clave sb_publishable_abc123DEF456',
    'secreto sb_secret_zzz999',
    'teléfono +54 9 299 620-9136',
  ].join(' | ');
  const limpio = redactar(sucio);
  assert.doesNotMatch(limpio, /eyJ/);
  assert.doesNotMatch(limpio, /sb_publishable_abc/);
  assert.doesNotMatch(limpio, /sb_secret_zzz/);
  assert.doesNotMatch(limpio, /6209136|620-9136/);
});

test('el reporte final declara que se leyó el PIN pero no lo imprime', () => {
  const { texto, markdown } = construirReporte({
    runId: 'r1',
    modo: 'VENTA REAL',
    pasos: [{ nombre: 'PIN', estado: 'PASS', detalle: 'leído de la pantalla del cliente: 4821' }],
    tiempos: { 'PIN → delivered': 1200 },
    resumen: 'PRODUCTION SALE E2E PASS',
  });
  assert.match(texto, /PIN .* PASS/);
  assert.doesNotMatch(texto, /4821/);
  assert.doesNotMatch(markdown, /4821/);
});

// ── El contrato no se afloja sin que alguien lo vea ──────────────────────────

test('el contrato sigue siendo un solo producto, una unidad y sin Mercado Pago', () => {
  assert.equal(PRODUCTO_AUTORIZADO.externalId, 'coca-cola-original-pet-1500ml');
  assert.equal(PRODUCTO_AUTORIZADO.cantidadMaxima, 1);
  assert.equal(PRODUCTO_AUTORIZADO.precioEsperado, 4990);
  assert.equal(AUTORIZACION.flags.length, 3);
});

test('primerBloqueo devuelve la primera compuerta cerrada', () => {
  const abierto = { ok: true };
  const cerrado = { ok: false, codigo: 'X', mensaje: 'y' };
  assert.equal(primerBloqueo([abierto, abierto]).ok, true);
  assert.equal(primerBloqueo([abierto, cerrado, { ok: false, codigo: 'Z' }]).codigo, 'X');
});

test('las sesiones guardadas están fuera del repositorio', () => {
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.local\/$/m, 'las sesiones de producción no pueden versionarse');
});
