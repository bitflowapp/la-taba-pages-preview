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
  CASOS, ETAPAS, decidirPlan, describirPlan, ofertaSigueVigente, stockEsperadoAntesDeVender,
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
  ETIQUETA_BIOMETRIA, ETIQUETA_PERMISOS, ETIQUETAS_DECLINABLES, LISTA_NEGRA_RIDER,
  avisosDeLaPantalla, buscarElemento, calidadDelFijo, decidirRespuestaDeHoja, esPeligroso,
  nodosDelPedido, redSana,
  pedidoEnPantalla, puntoParaAceptar, tarjetaDeLaOferta,
} from '../scripts/e2e-production-sale/rider.mjs';
import { estadoAdbDelTelefono } from '../scripts/e2e-production-sale/precheck.mjs';
import { evaluarProducto, evaluarProductoBase, evaluarRider } from '../scripts/e2e-production-sale/guards.mjs';
import { cerrarLock, generarRunId, leerLock, tomarLock } from '../scripts/e2e-production-sale/lock.mjs';
import { crearEvidencia } from '../scripts/e2e-production-sale/evidencia.mjs';
import { yaPaso } from '../scripts/e2e-production-sale/venta-real.mjs';
import { assertSoloLectura, ConsultaNoPermitida } from '../scripts/e2e-production-sale/db-solo-lectura.mjs';
import { escribirYConfirmar } from '../scripts/e2e-production-sale/panel-mercaderia.mjs';
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

/*
 * ESTAS PRUEBAS EXISTEN POR LT-0002.
 *
 * Una corrida real creó el pedido y se cayó en el paso siguiente. Repetir la
 * compra habría dejado DOS ventas reales donde el dueño autorizó una.
 */
test('CASO 4 — si la corrida anterior dejó un pedido vivo, se REANUDA', () => {
  const plan = decidirPlan({
    producto: PRODUCTO({ stock: 5, available: true }),
    lockPrevio: { runId: '20260822-190014', estado: 'fallido', pedido: 'LT-0002' },
    pedidoDelLock: { public_code: 'LT-0002', status: 'received' },
  });
  assert.equal(plan.caso, CASOS.REANUDAR);
  assert.equal(plan.reanudarCodigo, 'LT-0002');
  assert.equal(plan.estadoAlReanudar, 'received');
  assert.deepEqual([...plan.etapas], [ETAPAS.VENTA], 'ni recibe ni publica: sólo termina lo empezado');
  assert.equal(plan.bloqueo, null);
  assert.equal(plan.requiereAtestacion, false);
});

test('un pedido anterior ya terminado no se reanuda: se mira y se libera el lock', () => {
  for (const estado of ['delivered', 'cancelled', 'rejected']) {
    const plan = decidirPlan({
      producto: PRODUCTO({ stock: 5, available: true }),
      lockPrevio: { runId: 'x', estado: 'fallido', pedido: 'LT-0002' },
      pedidoDelLock: { public_code: 'LT-0002', status: estado },
    });
    assert.equal(plan.bloqueo.codigo, 'PEDIDO_ANTERIOR_TERMINADO', `«${estado}» no se reanuda`);
  }
});

test('un lock sin pedido anotado frena: pudo haberse caído mientras compraba', () => {
  const plan = decidirPlan({
    producto: PRODUCTO({ stock: 5, available: true }),
    lockPrevio: { runId: 'x', estado: 'fallido', pedido: null },
  });
  assert.equal(plan.caso, CASOS.RECUPERAR);
  assert.equal(plan.bloqueo.codigo, 'CORRIDA_ANTERIOR_ABIERTA');
  assert.match(plan.bloqueo.mensaje, /sin pedido anotado/);
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

test('el estado de adb se lee de la línea del teléfono, no de si la palabra aparece', () => {
  const salida = ['List of devices attached', 'ZY32LHS6PS\toffline', 'OTRO123\tdevice', ''].join('\n');
  assert.equal(estadoAdbDelTelefono(salida, 'ZY32LHS6PS'), 'offline');
  assert.equal(estadoAdbDelTelefono(salida, 'OTRO123'), 'device');
  assert.equal(estadoAdbDelTelefono(salida, 'NOEXISTE'), 'ausente');
  assert.equal(estadoAdbDelTelefono(['List of devices attached', ''].join('\n'), 'ZY32LHS6PS'), 'ausente');
});

test('un teléfono offline no se confunde con uno desenchufado: mandan a hacer cosas distintas', () => {
  const base = { miembroActivo: true, paquete: 'com.lataba.rider', dispositivoConectado: false };
  assert.match(evaluarRider({ ...base, estadoAdb: 'ausente' }).mensaje, /cable/);
  assert.match(evaluarRider({ ...base, estadoAdb: 'offline' }).mensaje, /desbloqueá la pantalla/);
  assert.match(evaluarRider({ ...base, estadoAdb: 'unauthorized' }).mensaje, /Permitir depuración USB/);
  assert.equal(evaluarRider({ ...base, dispositivoConectado: true, estadoAdb: 'device' }).ok, true);
  assert.equal(
    evaluarRider({ ...base, dispositivoConectado: true, estadoAdb: 'device', paquete: 'com.lataba.rider.staging' }).codigo,
    'RIDER_PAQUETE',
    'la app de staging no sirve para una prueba de producción',
  );
});

test('la compuerta base del producto mira lo que no depende de la etapa', () => {
  const base = {
    external_id: 'coca-cola-original-pet-1500ml',
    is_alcoholic: false,
    is_verified: true,
    is_active: true,
    price: '4990.00',
  };
  // Sin stock y oculto: correcto en el precheck de una corrida que viene a recibir.
  assert.equal(evaluarProductoBase({ ...base, stock: 0, available: false }).ok, true);
  // Y la compuerta completa, la de la venta, ahí sí bloquea.
  assert.equal(evaluarProducto({ ...base, stock: 0, available: false }).codigo, 'NO_PUBLICADO');

  assert.equal(evaluarProductoBase({ ...base, external_id: 'otro-sku' }).codigo, 'SKU_NO_AUTORIZADO');
  assert.equal(evaluarProductoBase({ ...base, is_alcoholic: true }).codigo, 'ALCOHOL');
  assert.equal(evaluarProductoBase({ ...base, is_verified: false }).codigo, 'NO_VERIFICADO');
  assert.equal(evaluarProductoBase({ ...base, price: '5990.00' }).codigo, 'PRECIO_DISTINTO');
  assert.equal(evaluarProductoBase(null).codigo, 'PRODUCTO_INEXISTENTE');
});

/*
 * Esta prueba existe porque al abrir la aplicación de verdad, con el teléfono en
 * la mano, apareció una hoja ofreciendo activar huella o rostro. Tapaba la
 * pantalla entera: el volcado no mostraba ningún pedido y el harness se habría
 * quedado esperando una oferta que no iba a ver nunca.
 */
/*
 * LAS DOS HOJAS OFRECEN «AHORA NO», Y UNA DE ELLAS NO SE PUEDE DECLINAR.
 *
 * La de biometría es una invitación. La de permisos del recorrido dice, con
 * todas las letras: «Si los rechazás, la entrega no se inicia». Una rutina que
 * declinara todo lo declinable habría cancelado la entrega creyendo que
 * despejaba un estorbo — se vio con LT-0002 ya retirado, en el teléfono.
 */
test('la hoja de biometría se declina; la de permisos del recorrido se acepta', () => {
  // Tal cual salieron del volcado del Moto.
  assert.equal(decidirRespuestaDeHoja(['Activar huella o rostro', 'Ahora no', 'Scrim']), 'Ahora no');
  assert.equal(decidirRespuestaDeHoja(['Continuar', 'Ahora no', 'Dismiss']), 'Continuar');
  // Sin ninguna hoja, no se toca nada.
  assert.equal(decidirRespuestaDeHoja(['Llegué', 'Reportar un problema']), null);
  assert.equal(decidirRespuestaDeHoja([]), null);

  // Y la mitad peligrosa de la hoja de biometría sigue prohibida.
  assert.ok(LISTA_NEGRA_RIDER.includes(ETIQUETA_BIOMETRIA));
  assert.equal(ETIQUETAS_DECLINABLES.includes(ETIQUETA_BIOMETRIA), false);
  assert.equal(esPeligroso(ETIQUETA_PERMISOS), false, '«Continuar» tiene que poder tocarse');
  for (const declinable of ETIQUETAS_DECLINABLES) {
    assert.equal(esPeligroso(declinable), false, `«${declinable}» no puede estar prohibida`);
  }
});

/*
 * ESTAS PRUEBAS EXISTEN POR UNA RECEPCIÓN QUE CARGÓ UNA BOTELLA EN VEZ DE SEIS.
 *
 * El centro de operación se redibuja solo y repone los valores por defecto del
 * formulario, borrando lo tipeado. Escribir, esperar y releer NO alcanzó: el
 * campo pasó la relectura y llegó en «1» al click igual, porque el redibujado
 * siguiente cayó en el medio. La única forma de ganar esa carrera es no dejar
 * ningún hueco: escribir, comprobar y apretar en el mismo turno de JavaScript.
 *
 * La página de mentira ejecuta el bloque como lo haría el navegador, con un
 * `input` que puede fingir que un redibujado le repuso el valor por defecto.
 */
const paginaDeMentira = ({ pisaElValor = false, faltaBoton = false } = {}) => {
  const registro = { clicks: 0, valorAlHacerClick: null };
  const hacerInput = (valorInicial) => ({
    _v: valorInicial,
    get value() { return this._v; },
    set value(v) { this._v = pisaElValor ? valorInicial : v; },
    dispatchEvent() { return true; },
  });
  const cantidad = hacerInput('1');
  const referencia = hacerInput('');
  const boton = { click() { registro.clicks += 1; registro.valorAlHacerClick = cantidad.value; } };
  const raiz = {
    querySelector(sel) {
      if (sel === '[name="packageQuantity"]') return cantidad;
      if (sel === '[name="reason"]') return referencia;
      if (sel.startsWith('[data-inventory-confirm')) return faltaBoton ? null : boton;
      return null;
    },
  };
  return {
    registro,
    async evaluate(fn, args) {
      // Se le presta a la función el `document` y el `HTMLInputElement` que
      // esperaría en el navegador, y se la ejecuta tal cual.
      const documentoPrevio = globalThis.document;
      const ventanaPrevia = globalThis.window;
      globalThis.document = { querySelector: (sel) => (sel === '[data-business-ops-center]' ? raiz : null) };
      globalThis.window = {
        HTMLInputElement: { prototype: { } },
      };
      Object.defineProperty(globalThis.window.HTMLInputElement.prototype, 'value', {
        configurable: true,
        set(v) { this._v = pisaElValor ? '1' : v; },
        get() { return this._v; },
      });
      globalThis.Event = class { constructor(tipo) { this.type = tipo; } };
      try {
        return fn(args);
      } finally {
        globalThis.document = documentoPrevio;
        globalThis.window = ventanaPrevia;
      }
    },
  };
};

test('la cantidad se escribe y se confirma en el mismo turno: nada se cuela en el medio', async () => {
  const pagina = paginaDeMentira();
  const resultado = await escribirYConfirmar(pagina, { cantidad: 6, referencia: 'E2E', accion: 'purchase_receipt' });
  assert.equal(resultado.ok, true);
  assert.equal(resultado.cantidadLeida, '6');
  assert.equal(pagina.registro.clicks, 1);
  assert.equal(pagina.registro.valorAlHacerClick, '6', 'el botón vio la cantidad atestiguada, no el valor por defecto');
});

test('si el redibujado repone el valor por defecto, NO se aprieta el botón', async () => {
  const pagina = paginaDeMentira({ pisaElValor: true });
  const resultado = await escribirYConfirmar(pagina, { cantidad: 6, referencia: 'E2E', accion: 'purchase_receipt' });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /quedó en «1» y la atestación dice 6/);
  assert.equal(pagina.registro.clicks, 0, 'una recepción con la cantidad equivocada es inventario mal contado');
});

test('sin botón de confirmar no se inventa nada: se informa y se sale', async () => {
  const pagina = paginaDeMentira({ faltaBoton: true });
  const resultado = await escribirYConfirmar(pagina, { cantidad: 6, referencia: '', accion: 'purchase_receipt' });
  assert.equal(resultado.ok, false);
  assert.match(resultado.motivo, /faltan el campo de cantidad o el botón/);
  assert.equal(pagina.registro.clicks, 0);
});

/*
 * ESTAS DOS PRUEBAS EXISTEN POR UNA CORRIDA REAL ABORTADA CON EL PEDIDO YA EN
 * «LISTO» Y EL REPARTIDOR YA NOTIFICADO.
 */
test('la guarda de sólo lectura distingue una TABLA de una función que muta', () => {
  // Esto la tumbaba: `rider_order_offers` es una tabla, y el prefijo `rider_`
  // la hacía parecer una función.
  assert.doesNotThrow(() => assertSoloLectura(
    "select status from public.rider_order_offers where order_id = 'x' limit 1",
  ));
  assert.doesNotThrow(() => assertSoloLectura('select * from public.inventory_movements'));
  assert.doesNotThrow(() => assertSoloLectura('select created_at from public.orders'));

  // Y lo que vino a impedir sigue impedido: una función se invoca con paréntesis.
  for (const peligrosa of [
    "select public.apply_inventory_movement('a','b')",
    'select transition_order(1)',
    "select public.cancel_order('x')",
    'select rider_claim_order(1)',
    'select create_order_with_items(1)',
  ]) {
    assert.throws(() => assertSoloLectura(peligrosa), ConsultaNoPermitida, `«${peligrosa}» tenía que rechazarse`);
  }
});

test('al reanudar, un paso que ya quedó atrás no espera un botón que el Panel ya no dibuja', () => {
  assert.equal(yaPaso('ready', 'accepted'), true, 'listo ya pasó por aceptado');
  assert.equal(yaPaso('ready', 'ready'), true);
  assert.equal(yaPaso('received', 'accepted'), false);
  assert.equal(yaPaso('preparing', 'ready'), false);
  assert.equal(yaPaso('delivered', 'on_the_way'), true);
  assert.equal(yaPaso('arrived', 'delivered'), false);
  assert.equal(yaPaso(null, 'accepted'), false, 'sin estado no se asume nada');
  assert.equal(yaPaso('cancelled', 'accepted'), false, 'un estado fuera del orden no cuenta como avance');
});

/*
 * ESTA PRUEBA EXISTE POR UNA CAPTURA DE LA PANTALLA REAL DE OFERTAS.
 *
 * La lista negra se escribió con etiquetas sueltas y se comparaba por igualdad.
 * La pantalla de «Nuevas solicitudes» pone «Rechazar» y «Aceptar» al lado del
 * código del pedido, y al buscar el nodo más chico que menciona ese código, el
 * botón de rechazar era un candidato perfecto: el harness podía rechazar su
 * propio viaje mientras lo buscaba.
 */
test('la lista negra atrapa la etiqueta aunque venga con el código pegado', () => {
  assert.equal(esPeligroso('Rechazar'), true);
  assert.equal(esPeligroso('Rechazar la solicitud LT-0002'), true);
  assert.equal(esPeligroso('RECHAZAR OFERTA'), true);
  assert.equal(esPeligroso('Cerrar sesión de jariel1970+rider'), true);
  assert.equal(esPeligroso('Cancelar el pedido LT-0002'), true);
  // Lo que sí hay que poder tocar sigue tocándose.
  /*
   * «Iniciar y abrir Maps» NO es «Abrir en Google Maps». La segunda sólo abre un
   * mapa; la primera es la acción que pone el pedido en camino, y con el pedido
   * retirado es la única disponible en la aplicación. Prohibirla era prohibir la
   * entrega — se vio con el teléfono en la mano, en LT-0002.
   */
  assert.equal(esPeligroso('Abrir en Google Maps'), true);
  assert.equal(esPeligroso('Iniciar y abrir Maps'), false);
  assert.equal(esPeligroso('Aceptar'), false);
  assert.equal(esPeligroso('Aceptar la solicitud LT-0002'), false);
  assert.equal(esPeligroso('Llegué'), false);
  assert.equal(esPeligroso('Confirmar entrega'), false);
  assert.equal(esPeligroso(''), false);
});

/*
 * ESTAS PRUEBAS EXISTEN PORQUE LA TARJETA DE LA OFERTA ES UN SOLO NODO.
 *
 * El árbol real, medido en el Moto con LT-0002 ofrecido:
 *
 *   clickable=false  bounds=[40,1025,1040,1435]
 *   «Nueva solicitud LT-0002. Zona Neuquén Capital. 1 bulto. Cobrás ARS 4.990»
 *
 * «Rechazar» y «Aceptar» se ven en pantalla y NO existen en el árbol. No hay
 * etiqueta que resolver, así que el ancla es la tarjeta —que menciona el código
 * de la corrida— y el punto sale de SUS bordes, con la mitad izquierda prohibida
 * por construcción: ahí está el botón de rechazar.
 */
const PANTALLA_CON_OFERTA = [
  { descripcion: 'Mapa operativo de TABA2 Rider', clase: 'android.view.View', clickable: false, bounds: [0, 0, 1080, 2400] },
  { descripcion: 'Entregas: 1/3', clase: 'android.view.View', clickable: false, bounds: [423, 123, 657, 248] },
  { descripcion: 'Pedido LT-0001. En camino. Mendoza 851', clase: 'android.view.View', clickable: false, bounds: [40, 682, 1040, 865] },
  { descripcion: 'Nuevas solicitudes', clase: 'android.view.View', clickable: false, bounds: [40, 905, 1040, 965] },
  { descripcion: 'Nueva solicitud LT-0002. Zona Neuquén Capital. 1 bulto. Cobrás ARS 4.990', clase: 'android.view.View', clickable: false, bounds: [40, 1025, 1040, 1435] },
];

test('la oferta se encuentra por el código de la corrida, no por posición en la lista', () => {
  const tarjeta = tarjetaDeLaOferta(PANTALLA_CON_OFERTA, 'LT-0002');
  assert.ok(tarjeta, 'tendría que encontrar la tarjeta de LT-0002');
  assert.deepEqual(tarjeta.bounds, [40, 1025, 1040, 1435]);

  // El pedido que ya está en curso NO es una oferta: no empieza con el prefijo.
  assert.equal(tarjetaDeLaOferta(PANTALLA_CON_OFERTA, 'LT-0001'), null);
  assert.equal(tarjetaDeLaOferta(PANTALLA_CON_OFERTA, 'LT-0099'), null);
});

test('con dos tarjetas del mismo código no se adivina: no se toca nada', () => {
  const ambiguo = [...PANTALLA_CON_OFERTA, {
    descripcion: 'Nueva solicitud LT-0002. Otra zona', clase: 'android.view.View', clickable: false, bounds: [40, 1500, 1040, 1900],
  }];
  assert.equal(tarjetaDeLaOferta(ambiguo, 'LT-0002'), null);
});

test('el punto para aceptar cae SIEMPRE en la mitad derecha, nunca sobre «Rechazar»', () => {
  const tarjeta = tarjetaDeLaOferta(PANTALLA_CON_OFERTA, 'LT-0002');
  const punto = puntoParaAceptar(tarjeta);
  assert.ok(punto, 'tendría que haber un punto');
  const [x1, y1, x2, y2] = tarjeta.bounds;
  assert.ok(punto.x > (x1 + x2) / 2, 'a la derecha del centro: la izquierda es «Rechazar»');
  assert.ok(punto.x > x1 && punto.x < x2, 'dentro de la tarjeta');
  assert.ok(punto.y > y1 && punto.y < y2, 'dentro de la tarjeta');
  assert.deepEqual(punto, { x: 780, y: 1340 }, 'el centro medido del botón de aceptar');
});

test('una tarjeta demasiado angosta no deja calcular un punto seguro: devuelve null', () => {
  // Si la tarjeta fuera tan angosta que el desplazamiento cayera a la izquierda
  // del centro, calcular igual sería apuntar a «Rechazar».
  assert.equal(puntoParaAceptar({ bounds: [40, 1025, 400, 1435] }), null);
  assert.equal(puntoParaAceptar({ bounds: [40, 1025, 1040, 1060] }), null, 'ni tan baja');
  assert.equal(puntoParaAceptar(null), null);
});

/*
 * ESTA PRUEBA EXISTE PORQUE UN CLIENTE MIRANDO SU PEDIDO INVALIDA LA OFERTA DEL
 * REPARTIDOR.
 *
 * Medido en LT-0002: la oferta se hizo esperando la revisión 7; tres minutos
 * después el cliente abrió su seguimiento, eso rotó su token, dejó un
 * `tracking_access_recovered` y subió el pedido a la revisión 8. Desde ahí el
 * botón «Aceptar» del teléfono no hace nada: la app llama al servidor, el
 * servidor rechaza, y la pantalla dice «La solicitud cambió».
 */
test('una oferta atada a una revisión vieja NO se da por buena', () => {
  const pendiente = (revision) => ({ status: 'pending', expected_order_revision: revision });
  assert.equal(ofertaSigueVigente(pendiente(8), 8), true);
  assert.equal(ofertaSigueVigente(pendiente(7), 8), false, 'el cliente movió la revisión: hay que reofrecer');
  assert.equal(ofertaSigueVigente({ status: 'rejected', expected_order_revision: 8 }, 8), false);
  assert.equal(ofertaSigueVigente(null, 8), false);
  assert.equal(ofertaSigueVigente(pendiente(null), 8), false, 'sin revisión no se asume nada');
});

/*
 * ESTA PRUEBA EXISTE PORQUE LAS FILAS DE «TUS ENTREGAS» NO SON `clickable`.
 *
 * Con dos entregas encima la app muestra una lista, y hay que abrir la del
 * pedido de la corrida para llegar a sus botones. En el árbol esas filas son
 * `android.view.View` con una descripción y sin la marca de clickable: filtrando
 * por `clickable` no quedaba ningún candidato y el harness esperaba botones de
 * una pantalla que nunca abría.
 */
test('la fila del pedido se reconoce por su descripción, no por la marca de clickable', () => {
  const lista = [
    { descripcion: 'Mapa operativo de TABA2 Rider', clickable: false, bounds: [0, 0, 1080, 2400] },
    { descripcion: 'Pedido LT-0001. En camino. Mendoza 851', clickable: false, bounds: [40, 682, 1040, 865] },
    { descripcion: 'Pedido LT-0002. Asignado. Mendoza 851', clickable: false, bounds: [40, 880, 1040, 1063] },
    { descripcion: 'Actualizar', clickable: true, bounds: [40, 1160, 1040, 1290] },
  ];
  const delPedido = nodosDelPedido(lista, 'LT-0002');
  assert.equal(delPedido.length, 1);
  assert.match(delPedido[0].descripcion, /^Pedido LT-0002\./);
  // La fila del otro pedido no se confunde con la nuestra.
  assert.equal(nodosDelPedido(lista, 'LT-0001').length, 1);
  assert.notEqual(nodosDelPedido(lista, 'LT-0001')[0].bounds[1], delPedido[0].bounds[1]);
});

/*
 * ESTA PRUEBA EXISTE PORQUE EL WI-FI DEL MOTO SE APAGÓ EN MEDIO DE UNA ENTREGA.
 *
 * La aplicación seguía dibujando sus botones y el harness los tocó tres veces
 * sin efecto. La pantalla lo decía —«Sin conexión: falta enviar 4 puntos del
 * recorrido», «No pudimos iniciar la entrega»— pero el informe salió como
 * `RIDER_NO_AVANZA`, que manda a buscar un botón cuando el problema era la red.
 */
test('la red del teléfono se juzga por el ping, y «10% packet loss» no es sana', () => {
  assert.equal(redSana('2 packets transmitted, 2 received, 0% packet loss, time 1001ms'), true);
  assert.equal(redSana('2 packets transmitted, 0 received, 100% packet loss, time 1002ms'), false);
  assert.equal(redSana('10 packets transmitted, 9 received, 10% packet loss'), false, 'el 0 de «10%» no cuenta');
  assert.equal(redSana('connect: Network is unreachable'), false);
  assert.equal(redSana(''), false);
  assert.equal(redSana(null), false);
});

/*
 * ESTAS DOS PRUEBAS SON LAS QUE HABRÍAN AHORRADO LA TARDE.
 *
 * Con LT-0002 retirado, la aplicación no iniciaba el recorrido y desde afuera
 * parecía un botón que no respondía. La respuesta estaba en dos lugares que el
 * harness no miraba: el cartel de la propia pantalla y la calidad del fijo de
 * GPS. El Moto estaba bajo techo: cero satélites y un «último fijo» de hace dos
 * horas con diez kilómetros de altura.
 */
test('un fijo de GPS viejo, sin satélites y a 10 km de altura no es un fijo', () => {
  const malo = 'last location=Location[gps -38.851797,-68.043580 hAcc=11.3 et=+2h15m38s505ms '
    + 'alt=10957.4 vel=0.0 {Bundle[{satellites=0, maxCn0=0, meanCn0=0}]}]';
  const medido = calidadDelFijo(malo);
  assert.equal(medido.hayFijo, true);
  assert.equal(medido.satelites, 0);
  assert.equal(medido.antiguedadSegundos, 8138);
  assert.equal(medido.alturaAbsurda, true);
  assert.equal(medido.usable, false);

  const bueno = 'last location=Location[gps -38.9517,-68.0657 hAcc=8.0 et=+12s alt=270.0 '
    + '{Bundle[{satellites=11, maxCn0=38, meanCn0=27}]}]';
  assert.equal(calidadDelFijo(bueno).usable, true);

  // Un fijo con satélites pero de hace media hora tampoco sirve para salir.
  const viejo = 'last location=Location[gps -38.9,-68.0 hAcc=8.0 et=+31m2s alt=270.0 '
    + '{Bundle[{satellites=9}]}]';
  assert.equal(calidadDelFijo(viejo).usable, false);
  assert.equal(calidadDelFijo('sin nada').hayFijo, false);
});

test('el harness cita lo que la aplicación avisa en pantalla', () => {
  // Tal cual salieron del volcado del Moto, con sus saltos de línea escapados.
  const nodos = [
    { descripcion: 'Estado: Pedido retirado' },
    { descripcion: 'La entrega no se inició. No pudimos iniciar la entrega. Intentá nuevamente.&#10;La entrega' },
    { descripcion: 'Ubicación débil o sin señal GPS. Pedido LT-0001 · 4 ubicaciones pendientes' },
    { descripcion: 'Cobrás ARS 4.990 en efectivo.' },
  ];
  const avisos = avisosDeLaPantalla(nodos);
  assert.equal(avisos.length, 2);
  assert.match(avisos[0], /La entrega no se inició/);
  assert.match(avisos[1], /Ubicación débil o sin señal GPS/);
  assert.deepEqual(avisosDeLaPantalla([{ descripcion: 'Todo bien' }]), []);
  assert.deepEqual(avisosDeLaPantalla([]), []);
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
