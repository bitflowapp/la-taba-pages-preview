import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANTIDAD_MAXIMA, VARIABLE_CANTIDAD, VARIABLE_CONFIRMACION,
  evaluarAtestacion, frase, leerAtestacionFisica,
} from '../scripts/e2e-production-sale/atestacion-fisica.mjs';
import {
  CASOS, ETAPAS, decidirPlan, describirPlan, stockEsperadoAntesDeVender,
} from '../scripts/e2e-production-sale/maquina-de-estado.mjs';
import {
  DIRECCION_DE_PRUEBA, IDENTIDAD_PANEL, correoDelPanel, evaluarDireccionPorIdentidad,
  evaluarRolDelPanel, nombreDelCliente, telefonoDelCliente,
} from '../scripts/e2e-production-sale/identidades.mjs';
import {
  evaluarClienteAprovisionado, evaluarPanelAprovisionado,
} from '../scripts/e2e-production-sale/sesiones.mjs';
import {
  PREFIJO, SecretoNoDisponible, generarContrasena, objetivoCompleto,
} from '../scripts/e2e-production-sale/secretos-windows.mjs';
import {
  LISTA_NEGRA_RIDER, buscarElemento, nodosDelPedido, pedidoEnPantalla,
} from '../scripts/e2e-production-sale/rider.mjs';
import { cerrarLock, generarRunId, leerLock, tomarLock } from '../scripts/e2e-production-sale/lock.mjs';
import { crearEvidencia } from '../scripts/e2e-production-sale/evidencia.mjs';
import { isValidArgentinePhone } from '../js/core/validators.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS = path.join(RAIZ, 'scripts', 'e2e-production-sale');

/*
 * Los directorios de usar y tirar van DENTRO del repositorio, en `test-results/`
 * —que está en .gitignore—, y no en el temporal del sistema. En esta máquina el
 * temporal global vive en un disco casi lleno y `mkdtemp` falla ahí de formas
 * que parecen un defecto del código y no lo son.
 */
const directorioDeUsarYTirar = (prefijo) => fs.mkdtempSync(
  path.join(fs.mkdirSync(path.join(RAIZ, 'test-results'), { recursive: true }) || path.join(RAIZ, 'test-results'), prefijo),
);

/*
 * El modo automático toma solo dos decisiones peligrosas: cuánta mercadería
 * cargar y si crear un pedido. Estas pruebas se ocupan de las dos, y de que
 * nada del harness pueda escribir en la base ni conseguirse una credencial
 * administrativa por su cuenta.
 */

// ── La atestación física ─────────────────────────────────────────────────────

test('sin las dos variables no hay atestación, y eso no es un error todavía', () => {
  const resultado = leerAtestacionFisica({});
  assert.equal(resultado.ok, false);
  assert.equal(resultado.presente, false, 'no venía a recibir mercadería');
  assert.equal(resultado.codigo, 'PHYSICAL_STOCK_NOT_ATTESTED');
});

test('una sola de las dos variables sí es un error: alguien estaba por recibir', () => {
  const soloCantidad = leerAtestacionFisica({ [VARIABLE_CANTIDAD]: '6' });
  assert.equal(soloCantidad.ok, false);
  assert.equal(soloCantidad.presente, true);
  assert.match(soloCantidad.mensaje, /a medias/);

  const soloFrase = leerAtestacionFisica({ [VARIABLE_CONFIRMACION]: frase(6) });
  assert.equal(soloFrase.ok, false);
  assert.match(soloFrase.mensaje, /a medias/);
});

test('las dos declaraciones tienen que decir el mismo número', () => {
  const cruzadas = leerAtestacionFisica({
    [VARIABLE_CANTIDAD]: '6',
    [VARIABLE_CONFIRMACION]: frase(5),
  });
  assert.equal(cruzadas.ok, false);
  assert.equal(cruzadas.codigo, 'PHYSICAL_STOCK_NOT_ATTESTED');
  assert.match(cruzadas.mensaje, /dice 6 y la confirmación dice 5/);
});

test('con las dos coincidiendo, la atestación vale y trae la cantidad', () => {
  const resultado = leerAtestacionFisica({
    [VARIABLE_CANTIDAD]: '6',
    [VARIABLE_CONFIRMACION]: 'I_CONFIRM_6_PHYSICAL_UNITS_EXIST',
  });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.cantidad, 6);
});

test('la frase se compara exacta: ni minúsculas, ni espacios, ni variantes', () => {
  for (const variante of [
    'i_confirm_6_physical_units_exist',
    ' I_CONFIRM_6_PHYSICAL_UNITS_EXIST ',
    'I_CONFIRM_06_PHYSICAL_UNITS_EXIST',
    'I CONFIRM 6 PHYSICAL UNITS EXIST',
  ]) {
    const resultado = leerAtestacionFisica({ [VARIABLE_CANTIDAD]: '6', [VARIABLE_CONFIRMACION]: variante });
    assert.equal(resultado.ok, variante.trim() === frase(6), `«${variante}» no debería pasar tal cual`);
  }
});

test('cero, texto y cantidades absurdas se rechazan', () => {
  const cero = leerAtestacionFisica({ [VARIABLE_CANTIDAD]: '0', [VARIABLE_CONFIRMACION]: frase(0) });
  assert.equal(cero.ok, false);
  assert.match(cero.mensaje, /cero unidades/);

  const texto = leerAtestacionFisica({ [VARIABLE_CANTIDAD]: 'seis', [VARIABLE_CONFIRMACION]: frase(6) });
  assert.equal(texto.ok, false);
  assert.match(texto.mensaje, /entero/);

  const demasiado = CANTIDAD_MAXIMA + 1;
  const exceso = leerAtestacionFisica({
    [VARIABLE_CANTIDAD]: String(demasiado), [VARIABLE_CONFIRMACION]: frase(demasiado),
  });
  assert.equal(exceso.ok, false);
  assert.match(exceso.mensaje, /techo/);
});

test('con stock ya cargado, una atestación válida BLOQUEA en vez de habilitar', () => {
  const atestacion = leerAtestacionFisica({ [VARIABLE_CANTIDAD]: '6', [VARIABLE_CONFIRMACION]: frase(6) });
  const compuerta = evaluarAtestacion(atestacion, { hace_falta: false });
  assert.equal(compuerta.ok, false);
  assert.equal(compuerta.codigo, 'ATESTACION_NO_APLICABLE');
  assert.match(compuerta.mensaje, /sumaría inventario de más/);
});

test('sin recepción pendiente y sin atestación, la compuerta deja pasar', () => {
  assert.equal(evaluarAtestacion(leerAtestacionFisica({}), { hace_falta: false }).ok, true);
});

// ── La máquina de estado ─────────────────────────────────────────────────────

const PRODUCTO = (extra) => ({ external_id: 'coca-cola-original-pet-1500ml', stock: 0, available: false, ...extra });

test('CASO 1 — sin stock y oculto: recibir, publicar, vender', () => {
  const plan = decidirPlan({ producto: PRODUCTO({ stock: 0, available: false }) });
  assert.equal(plan.caso, CASOS.RECIBIR_PUBLICAR_VENDER);
  assert.deepEqual([...plan.etapas], [ETAPAS.RECEPCION, ETAPAS.PUBLICACION, ETAPAS.VENTA]);
  assert.equal(plan.requiereAtestacion, true);
});

test('CASO 2 — con stock y oculto: publicar y vender, NUNCA recibir de nuevo', () => {
  const plan = decidirPlan({ producto: PRODUCTO({ stock: 6, available: false }) });
  assert.equal(plan.caso, CASOS.PUBLICAR_VENDER);
  assert.equal(plan.etapas.includes(ETAPAS.RECEPCION), false, 'una corrida repetida no suma inventario');
  assert.equal(plan.requiereAtestacion, false);
});

test('CASO 3 — con stock y publicado: se vende directamente', () => {
  const plan = decidirPlan({ producto: PRODUCTO({ stock: 5, available: true }) });
  assert.equal(plan.caso, CASOS.VENDER);
  assert.deepEqual([...plan.etapas], [ETAPAS.VENTA]);
});

test('CASO 4 — una corrida anterior sin cerrar no crea otro pedido', () => {
  const plan = decidirPlan({
    producto: PRODUCTO({ stock: 6, available: true }),
    lockPrevio: { runId: '20260822-1', estado: 'fallido', pedido: 'LT-0042' },
  });
  assert.equal(plan.caso, CASOS.RECUPERAR);
  assert.deepEqual([...plan.etapas], [ETAPAS.DIAGNOSTICO]);
  assert.equal(plan.bloqueo.codigo, 'CORRIDA_ANTERIOR_ABIERTA');
  assert.match(plan.bloqueo.mensaje, /LT-0042/);
});

test('publicado con stock cero es imposible, y no se toca sin mirarlo', () => {
  const plan = decidirPlan({ producto: PRODUCTO({ stock: 0, available: true }) });
  assert.equal(plan.bloqueo.codigo, 'PUBLICADO_SIN_STOCK');
});

test('sin producto o con stock ilegible, falla cerrado', () => {
  assert.equal(decidirPlan({ producto: null }).bloqueo.codigo, 'PRODUCTO_INEXISTENTE');
  assert.equal(decidirPlan({ producto: PRODUCTO({ stock: 'seis' }) }).bloqueo.codigo, 'STOCK_ILEGIBLE');
});

test('el stock esperado antes de vender suma la recepción, y sólo la recepción', () => {
  const conRecepcion = decidirPlan({
    producto: PRODUCTO({ stock: 0 }),
    atestacion: { ok: true, cantidad: 6 },
  });
  assert.equal(stockEsperadoAntesDeVender({ plan: conRecepcion, stockActual: 0 }), 6);

  const sinRecepcion = decidirPlan({ producto: PRODUCTO({ stock: 6, available: true }) });
  assert.equal(stockEsperadoAntesDeVender({ plan: sinRecepcion, stockActual: 6 }), 6);
});

test('el plan se describe en una línea legible', () => {
  const plan = decidirPlan({ producto: PRODUCTO({ stock: 0 }), atestacion: { ok: true, cantidad: 6 } });
  assert.match(describirPlan(plan), /CASO_1.*recepcion → publicacion → venta.*recibir 6/);
});

// ── Las identidades ──────────────────────────────────────────────────────────

test('la identidad del Panel nunca opera con privilegio de dueño', () => {
  assert.equal(evaluarRolDelPanel('owner').codigo, 'PANEL_ROL_EXCESIVO');
  assert.equal(evaluarRolDelPanel('').codigo, 'PANEL_SIN_ROL');
  assert.equal(evaluarRolDelPanel('staff').codigo, 'PANEL_ROL_DISTINTO');
  assert.equal(evaluarRolDelPanel('admin').ok, true);
  assert.equal(IDENTIDAD_PANEL.rol, 'admin');
  assert.deepEqual([...IDENTIDAD_PANEL.rolesProhibidos], ['owner']);
});

test('el correo de la identidad se puede cambiar por entorno pero nunca queda vacío', () => {
  assert.match(correoDelPanel({}), /@/);
  assert.equal(correoDelPanel({ [IDENTIDAD_PANEL.variableCorreo]: '  OTRO@Ejemplo.COM ' }), 'otro@ejemplo.com');
});

test('la dirección se elige por identificador, no por parecido de texto', () => {
  const aprobada = '21e458f2-e6b6-46cb-9761-9833663ba21a';
  assert.equal(evaluarDireccionPorIdentidad({
    idElegido: aprobada, idAprobado: aprobada, ubicacionConfirmada: true,
  }).ok, true);
  assert.equal(evaluarDireccionPorIdentidad({
    idElegido: 'otra', idAprobado: aprobada, ubicacionConfirmada: true,
  }).codigo, 'DIRECCION_DISTINTA');
  assert.equal(evaluarDireccionPorIdentidad({
    idElegido: '', idAprobado: aprobada, ubicacionConfirmada: true,
  }).codigo, 'DIRECCION_AUSENTE');
  assert.equal(evaluarDireccionPorIdentidad({
    idElegido: aprobada, idAprobado: '', ubicacionConfirmada: true,
  }).codigo, 'DIRECCION_SIN_APROVISIONAR');
  assert.equal(evaluarDireccionPorIdentidad({
    idElegido: aprobada, idAprobado: aprobada, ubicacionConfirmada: false,
  }).codigo, 'DIRECCION_SIN_PUNTO', 'sin punto no sale ningún repartidor');
});

test('el punto de entrega de la prueba está declarado y no se improvisa', () => {
  assert.equal(typeof DIRECCION_DE_PRUEBA.latitud, 'number');
  assert.equal(typeof DIRECCION_DE_PRUEBA.longitud, 'number');
  assert.ok(DIRECCION_DE_PRUEBA.latitud < -30 && DIRECCION_DE_PRUEBA.latitud > -45, 'la latitud es de la Patagonia norte');
  assert.ok(DIRECCION_DE_PRUEBA.metrosDePrecision > 0 && DIRECCION_DE_PRUEBA.metrosDePrecision <= 50);
  assert.match(DIRECCION_DE_PRUEBA.origen, /confirmada por una persona/);
});

test('el teléfono de prueba pasa la validación que exige el checkout', () => {
  assert.equal(isValidArgentinePhone(telefonoDelCliente({})), true);
  assert.equal(nombreDelCliente({}).length >= 2, true);
});

// ── Las sesiones ─────────────────────────────────────────────────────────────

test('una sesión de cliente sin perfil o sin dirección confirmada no sirve', () => {
  assert.equal(evaluarClienteAprovisionado({ tieneDatos: false, direcciones: [] }).codigo, 'CLIENTE_SIN_PERFIL');
  assert.equal(evaluarClienteAprovisionado({
    tieneDatos: true, direcciones: [{ id: 'a', confirmada: false }],
  }).codigo, 'CLIENTE_SIN_DIRECCION');
  assert.equal(evaluarClienteAprovisionado({
    tieneDatos: true, direcciones: [{ id: 'otra', confirmada: true }],
  }, 'aprobada').codigo, 'CLIENTE_DIRECCION_PERDIDA');
  const buena = evaluarClienteAprovisionado({
    tieneDatos: true, direcciones: [{ id: 'aprobada', confirmada: true }],
  }, 'aprobada');
  assert.equal(buena.ok, true);
  assert.equal(buena.direccion.id, 'aprobada');
});

test('una sesión de Panel vencida se reconoce por la pantalla de ingreso', () => {
  assert.equal(evaluarPanelAprovisionado({ pideIngreso: true, centroVisible: false }).codigo, 'PANEL_PIDE_INGRESO');
  assert.equal(evaluarPanelAprovisionado({ pideIngreso: false, centroVisible: false }).codigo, 'PANEL_SIN_CENTRO');
  assert.equal(evaluarPanelAprovisionado({ pideIngreso: false, centroVisible: true }).ok, true);
});

test('la sesión del Panel tiene que ser la de la identidad dedicada, no la de una persona', () => {
  const dedicada = '301b89c3-5d09-4856-bb0f-242fb2271327';
  const dueno = '61f238ad-fc2b-446a-9f17-257f4622cd86';
  const abierta = { pideIngreso: false, centroVisible: true };
  assert.equal(evaluarPanelAprovisionado({ ...abierta, userId: dedicada }, dedicada).ok, true);
  assert.equal(
    evaluarPanelAprovisionado({ ...abierta, userId: dueno }, dedicada).codigo,
    'PANEL_IDENTIDAD_AJENA',
    'una sesión de dueño dejada a mano no puede colarse como si fuera la del robot',
  );
  assert.equal(evaluarPanelAprovisionado({ ...abierta, userId: dedicada }, '').ok, true, 'sin ficha todavía, no se exige');
});

// ── El almacén de secretos ───────────────────────────────────────────────────

test('el nombre de una credencial se valida antes de entrar a un guion de PowerShell', () => {
  assert.equal(objetivoCompleto('business-operator'), `${PREFIJO}:business-operator`);
  assert.equal(objetivoCompleto(`${PREFIJO}:business-operator`), `${PREFIJO}:business-operator`);
  for (const malo of ['a', '', 'con "comillas"', 'con $variable', 'con `backtick', 'x'.repeat(200)]) {
    assert.throws(() => objetivoCompleto(malo), SecretoNoDisponible, `«${malo}» tendría que rechazarse`);
  }
});

test('la contraseña generada cumple el mínimo del proyecto y no trae caracteres peligrosos', () => {
  const muestras = Array.from({ length: 25 }, () => generarContrasena(32));
  for (const clave of muestras) {
    assert.equal(clave.length, 32);
    assert.match(clave, /^[A-Za-z0-9._-]+$/, 'sin comillas, sin $ y sin backtick');
  }
  assert.equal(new Set(muestras).size, muestras.length, 'no se repiten');
  assert.ok(generarContrasena(12).length >= 12, 'el mínimo de Auth es 12');
});

// ── El teléfono ──────────────────────────────────────────────────────────────

test('la lista negra del repartidor cubre lo que nunca se toca', () => {
  for (const prohibido of ['Cerrar sesión', 'Rechazar', 'Reportar un problema', 'Cancelar', 'Eliminar']) {
    assert.ok(LISTA_NEGRA_RIDER.includes(prohibido), `${prohibido} tiene que estar en la lista negra`);
  }
});

test('el pedido en pantalla y sus nodos se resuelven por el código, no por posición', () => {
  const nodos = [
    { descripcion: 'Mapa operativo del pedido LT-0007', clase: 'android.view.View', clickable: false, bounds: [0, 0, 1080, 2400] },
    { descripcion: 'Pedido LT-0007 · Mendoza 851', clase: 'android.widget.Button', clickable: true, bounds: [0, 300, 1080, 400] },
    { descripcion: 'Pedido LT-0001 · Otra calle', clase: 'android.widget.Button', clickable: true, bounds: [0, 400, 1080, 500] },
    { descripcion: 'Llegué', clase: 'android.widget.Button', clickable: true, bounds: [40, 2100, 1040, 2260] },
  ];
  assert.equal(pedidoEnPantalla(nodos), 'LT-0007');
  assert.equal(nodosDelPedido(nodos, 'LT-0001').length, 1);
  assert.equal(nodosDelPedido(nodos, 'LT-0007').length, 2);
  assert.equal(buscarElemento(nodos, 'Llegué').bounds[1], 2100);
  assert.equal(buscarElemento(nodos, 'Cerrar sesión'), null);
});

// ── El lock ──────────────────────────────────────────────────────────────────

test('una corrida fallida DEJA el lock puesto y una exitosa lo libera', () => {
  const raiz = directorioDeUsarYTirar('taba-lock-');
  const runId = generarRunId();
  tomarLock({ runId, modo: 'prueba', raiz });
  assert.equal(leerLock(raiz).abierto, true);

  cerrarLock({ runId, estado: 'fallido', raiz });
  assert.equal(leerLock(raiz).estado, 'fallido', 'la próxima corrida tiene que mirarlo');

  cerrarLock({ runId, estado: 'ok', raiz });
  assert.equal(leerLock(raiz), null);
  fs.rmSync(raiz, { recursive: true, force: true });
});

// ── La evidencia ─────────────────────────────────────────────────────────────

test('la línea de tiempo se guarda redactada y con los saltos entre hitos', () => {
  const raiz = directorioDeUsarYTirar('taba-evid-');
  const evidencia = crearEvidencia('prueba', { raiz });
  evidencia.hito('inicio', 'arranque');
  evidencia.hito('pin', 'el código era 4821 y no puede quedar escrito');
  evidencia.volcarRegistro();
  const linea = JSON.parse(fs.readFileSync(path.join(evidencia.directorio, 'timeline.json'), 'utf8'));
  assert.equal(linea.length, 2);
  assert.equal(linea[0].nombre, 'inicio');
  assert.match(linea[1].detalle, /PIN-REDACTADO/);
  assert.doesNotMatch(JSON.stringify(linea), /4821/);
  assert.equal(typeof linea[1].msDesdeElHitoAnterior, 'number');
  fs.rmSync(raiz, { recursive: true, force: true });
});

// ── Lo que el harness NO puede hacer ─────────────────────────────────────────

const archivosDelHarness = fs.readdirSync(HARNESS)
  .filter((nombre) => nombre.endsWith('.mjs'))
  .map((nombre) => ({ nombre, texto: fs.readFileSync(path.join(HARNESS, nombre), 'utf8') }));

test('ningún módulo del harness puede conseguirse una credencial administrativa', () => {
  /*
   * La clave de servicio se la da una persona al guion de alta, en su entorno,
   * y a nadie más. Si un módulo del recorrido pudiera leerla, todo el resto de
   * las compuertas —sólo lectura incluida— serían decorativas.
   */
  const permitidos = new Set(['provisionar-identidad-panel.mjs']);
  for (const { nombre, texto } of archivosDelHarness) {
    if (permitidos.has(nombre)) continue;
    assert.doesNotMatch(texto, /SUPABASE_SERVICE_ROLE_KEY/, `${nombre} no puede nombrar la clave de servicio`);
    assert.doesNotMatch(texto, /service_role/, `${nombre} no puede buscar la clave de servicio`);
    assert.doesNotMatch(texto, /api-keys/, `${nombre} no puede pedir las claves del proyecto`);
  }
});

test('sólo el runner de sólo lectura habla con la Management API', () => {
  const permitidos = new Set(['db-solo-lectura.mjs']);
  for (const { nombre, texto } of archivosDelHarness) {
    if (permitidos.has(nombre)) continue;
    // Se mira el IMPORT, no la mención: un comentario que nombra el módulo del
    // token es documentación, no una puerta.
    assert.doesNotMatch(texto, /from\s+'[^']*supabase-cli-token/, `${nombre} no puede importar el token del CLI`);
    assert.doesNotMatch(texto, /api\.supabase\.com/, `${nombre} no puede llamar a la Management API`);
  }
});

test('el modo automático no tiene ninguna forma de escribir SQL', () => {
  const auto = archivosDelHarness.find((archivo) => archivo.nombre === 'auto.mjs').texto;
  assert.match(auto, /db-solo-lectura\.mjs/, 'la única puerta a la base es la de sólo lectura');
  for (const escritura of ['insert into', 'update public.', 'delete from', 'createClient']) {
    assert.doesNotMatch(auto.toLowerCase(), new RegExp(escritura), `auto.mjs no puede contener «${escritura}»`);
  }
});

test('la recepción y la publicación pasan por el Panel, no por la RPC', () => {
  const mercaderia = archivosDelHarness.find((archivo) => archivo.nombre === 'panel-mercaderia.mjs').texto;
  const cuerpo = mercaderia.split('*/').slice(1).join('*/');
  assert.doesNotMatch(cuerpo, /rpc\(/, 'nada de llamar RPC: si el botón está roto, la prueba tiene que fallar');
  assert.match(mercaderia, /data-inventory-confirm/, 'la recepción se confirma con el botón del Panel');
  assert.match(mercaderia, /data-commercial-publish/, 'la publicación se hace con el botón del Panel');
});

test('el guion de alta de identidad no puede otorgar owner', () => {
  const alta = archivosDelHarness.find((archivo) => archivo.nombre === 'provisionar-identidad-panel.mjs').texto;
  assert.doesNotMatch(alta, /role:\s*'owner'/, 'nunca escribe el rol de dueño');
  assert.match(alta, /IDENTIDAD_PANEL\.rol/, 'el rol sale del contrato, no de un argumento');
  assert.match(alta, /--confirm/, 'por defecto es un ensayo');
});
