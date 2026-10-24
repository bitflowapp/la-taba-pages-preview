import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { clasificar, csvDe, MOTIVOS } from '../scripts/comercial/censo-produccion.mjs';
import {
  BLOQUEADO, chequeoEntorno, chequeoFrontend, destinoComercial, ESPERA_AUTORIZACION, FALTA_DATO_HUMANO,
  FUNCIONES_OBLIGATORIAS, funcionesActivas, INFO, OK, veredicto,
} from '../scripts/comercial/compuerta-comercial.mjs';

const root = path.resolve(import.meta.dirname, '..');

// El destino sale de deploy/environments.json. Las pruebas pasan un registro con una producción FICTICIA activa
// (tests/fixtures/environments.production-active.json), y la misma aprovisionada o sin aprovisionar, armadas acá.
const REGISTRO_ACTIVO = JSON.parse(
  fs.readFileSync(path.join(root, 'tests/fixtures/environments.production-active.json'), 'utf8'),
);
const conEstado = (status, supabase = {}) => {
  const registro = structuredClone(REGISTRO_ACTIVO);
  registro.environments.production.status = status;
  Object.assign(registro.environments.production.supabase, supabase);
  return registro;
};
const PROVISIONADO = conEstado('provisioned');
const SIN_PRODUCCION = conEstado('not_provisioned', { ref: null, organizationId: null, plan: null });

/*
 * LA DIFERENCIA ENTRE «ESTÁ ROTO» Y «FALTA QUE ALGUIEN DECIDA».
 *
 * «No está listo» esconde dos situaciones que se arreglan de maneras
 * completamente distintas: una programando y la otra llamando a una persona.
 * Mezclarlas hace que un equipo busque un bug donde falta un dato, o que espere
 * a un proveedor mientras algo está efectivamente roto.
 */
test('la compuerta separa los cuatro estados, y falla cerrado', () => {
  assert.equal(veredicto([{ estado: OK }, { estado: OK }]), 'READY FOR REAL PAYMENT');
  assert.equal(veredicto([{ estado: OK }, { estado: FALTA_DATO_HUMANO }]), 'TECHNICALLY READY');
  assert.equal(veredicto([{ estado: OK }, { estado: ESPERA_AUTORIZACION }]), 'READY TO ENABLE PAYMENT');
  assert.equal(veredicto([{ estado: OK }, { estado: BLOQUEADO }]), 'COMMERCIAL NOT READY');

  // El orden manda: un bloqueo gana sobre un dato que falta, y un dato que falta
  // gana sobre una autorización pendiente. No se resuelve un bloqueo esperando
  // una credencial, ni se autoriza lo que todavía no está cargado.
  assert.equal(veredicto([
    { estado: FALTA_DATO_HUMANO }, { estado: BLOQUEADO }, { estado: ESPERA_AUTORIZACION },
  ]), 'COMMERCIAL NOT READY');
  assert.equal(veredicto([
    { estado: FALTA_DATO_HUMANO }, { estado: ESPERA_AUTORIZACION },
  ]), 'TECHNICALLY READY');
});

/*
 * EL ABRAZO MORTAL QUE ESTE ESTADO DESHACE.
 *
 * Encender el proveedor exigía haber probado; probar exigía el proveedor
 * encendido; y la compuerta pedía el proveedor encendido para dar verde. Con
 * `READY TO ENABLE PAYMENT` el sistema puede declararse enteramente listo SIN
 * haber creado ninguna forma de cobrar.
 */
test('todo cargado y el interruptor apagado es un estado propio, no un problema', () => {
  const todoMenosElInterruptor = [
    { estado: OK, id: 'release' },
    { estado: OK, id: 'mp_functions' },
    { estado: OK, id: 'mercadopago' },
    { estado: INFO, id: 'catalogo_incompleto' },
    { estado: ESPERA_AUTORIZACION, id: 'proveedor_pago' },
  ];
  assert.equal(veredicto(todoMenosElInterruptor), 'READY TO ENABLE PAYMENT');
  // Y NO es verde: nadie puede cobrar todavía.
  assert.notEqual(veredicto(todoMenosElInterruptor), 'READY FOR REAL PAYMENT');
});

/*
 * DOCE PRODUCTOS A MEDIO CARGAR NO PUEDEN IMPEDIR COBRAR LOS TREINTA Y TRES
 * QUE ESTÁN COMPLETOS.
 *
 * Es la situación real de producción. Mientras los incompletos sigan sin ser
 * comprables no le hacen daño a nadie: no están en la góndola y nadie los puede
 * poner en el carrito. Exigir el catálogo entero para empezar a vender le ataría
 * las manos al negocio por productos que hoy no vende igual.
 */
test('33 comprables válidos + 12 incompletos ocultos llegan a poder cobrar', () => {
  const produccionDeHoy = [
    { estado: OK, id: 'catalogo' },       // 33 comprables
    { estado: OK, id: 'precios' },
    { estado: OK, id: 'stock' },
    { estado: OK, id: 'imagenes' },
    { estado: INFO, id: 'catalogo_incompleto' },  // los 12, ninguno comprable
    { estado: INFO, id: 'promociones' },
    { estado: OK, id: 'alcohol' },
    { estado: OK, id: 'mp_functions' },
    { estado: OK, id: 'mercadopago' },
  ];

  // Con el interruptor apagado: listo para encender.
  assert.equal(
    veredicto([...produccionDeHoy, { estado: ESPERA_AUTORIZACION, id: 'proveedor_pago' }]),
    'READY TO ENABLE PAYMENT',
  );
  // Y con el interruptor puesto por una persona: cobrando.
  assert.equal(
    veredicto([...produccionDeHoy, { estado: OK, id: 'proveedor_pago' }]),
    'READY FOR REAL PAYMENT',
  );
});

test('un incompleto que SÍ quedó comprable es un bloqueo, porque el cliente lo toca', () => {
  // La contracara de la regla anterior: lo que no bloquea es que esté oculto.
  // Publicado y roto, bloquea.
  assert.equal(veredicto([
    { estado: OK, id: 'catalogo' }, { estado: BLOQUEADO, id: 'catalogo_incompleto' },
  ]), 'COMMERCIAL NOT READY');
});

test('INFO nunca cambia el veredicto', () => {
  assert.equal(veredicto([{ estado: OK }, { estado: INFO }, { estado: INFO }]), 'READY FOR REAL PAYMENT');
});

test('sin credenciales ni precios reales, la compuerta NO puede dar verde', () => {
  // Es la situación de hoy, y el verde tiene que estar fuera de alcance. Un
  // gate que se pone verde solo no sirve para nada.
  const hoy = [
    { estado: OK, id: 'release' },
    { estado: OK, id: 'catalogo' },
    { estado: OK, id: 'mp_functions' },
    { estado: FALTA_DATO_HUMANO, id: 'mercadopago' },
    { estado: FALTA_DATO_HUMANO, id: 'proveedor_pago' },
  ];
  assert.notEqual(veredicto(hoy), 'READY FOR REAL PAYMENT');
  assert.equal(veredicto(hoy), 'TECHNICALLY READY');
});

test('la compuerta y el censo salen por 1 mientras no se pueda cobrar', () => {
  const fuente = fs.readFileSync(path.join(root, 'scripts/comercial/compuerta-comercial.mjs'), 'utf8');
  assert.match(fuente, /process\.exit\(resultado\.veredicto === 'READY FOR REAL PAYMENT' \? 0 : 1\)/);
  // Y un fallo inesperado también cierra: nunca se sale por verde sin saber.
  assert.match(fuente, /COMMERCIAL NOT READY[\s\S]{0,200}process\.exit\(1\)/);
});

// ─── EL CENSO ────────────────────────────────────────────────────────────────

const fila = (extra = {}) => ({
  id: 'x', sku: 'agua-500ml', external_id: 'ext-1', name: 'Agua', category: 'aguas',
  is_active: true, is_verified: true, available: true, price: '1500.00',
  price_status: 'confirmed', stock: 10, is_alcoholic: false, image_url: 'https://x/f.webp',
  ...extra,
});

test('un producto completo es comprable y no arrastra motivos', () => {
  const r = clasificar(fila());
  assert.equal(r.comprable, true);
  assert.deepEqual(r.motivos, []);
  assert.equal(r.bucket, 'normales');
  assert.equal(r.conImagen, true);
});

test('el motivo bloqueante es el PRIMERO, que es el que hay que resolver antes', () => {
  // Sin verificar y sin precio: lo que frena primero es que no entra a la
  // góndola, y arreglar el precio no cambiaría nada mientras eso siga así.
  const r = clasificar(fila({ is_verified: false, price_status: 'pending' }));
  assert.equal(r.comprable, false);
  assert.equal(r.motivos[0], MOTIVOS.SIN_VERIFICAR);
  assert.ok(r.motivos.includes(MOTIVOS.PRECIO_PENDIENTE));
});

test('el alcohol cerrado NO se informa como «el comercio no lo publicó»', () => {
  /*
   * Decirle a alguien que publique un alcohólico mientras la venta de alcohol
   * está cerrada lo manda a hacer algo que no puede y que no debe: publicarlo
   * es una habilitación de expendio, no un ajuste de catálogo.
   */
  const cerrado = clasificar(fila({ is_alcoholic: true, available: false }), { alcoholHabilitado: false });
  assert.equal(cerrado.motivos[0], MOTIVOS.ALCOHOL_SIN_HABILITAR);
  assert.equal(cerrado.bucket, 'alcohol_visible_no_comprable');

  // Con la habilitación puesta, el mismo producto sin publicar SÍ es un
  // pendiente común del comercio.
  const abierto = clasificar(fila({ is_alcoholic: true, available: false }), { alcoholHabilitado: true });
  assert.equal(abierto.motivos[0], MOTIVOS.NO_DISPONIBLE);
});

test('la foto no impide vender, y por eso no convierte a nadie en no comprable', () => {
  const r = clasificar(fila({ image_url: '' }));
  assert.equal(r.comprable, true, 'sin foto se vende igual');
  assert.equal(r.conImagen, false);
  assert.ok(r.motivos.includes(MOTIVOS.SIN_IMAGEN), 'pero queda anotado');
});

test('un producto inactivo va a su bucket aunque le falte todo lo demás', () => {
  const r = clasificar(fila({ is_active: false, price_status: 'pending', stock: 0 }));
  assert.equal(r.bucket, 'inactivos');
  assert.equal(r.motivos[0], MOTIVOS.INACTIVO);
});

test('el CSV del censo lleva el motivo bloqueante en su propia columna', () => {
  const filas = [{ ...fila({ available: false }), ...clasificar(fila({ available: false })) }];
  const csv = csvDe(filas);
  const [cabecera, primera] = csv.trim().split('\n');
  assert.ok(cabecera.includes('motivo_bloqueante'));
  assert.ok(primera.includes(MOTIVOS.NO_DISPONIBLE.split(':')[0]));
});

test('el censo sólo puede leer: la puerta que usa rechaza todo lo que no sea SELECT', () => {
  // No es una convención: es la guarda de `db-solo-lectura`, y esta prueba
  // existe para que nadie cambie el censo a un runner que sí escriba.
  const fuente = fs.readFileSync(path.join(root, 'scripts/comercial/censo-produccion.mjs'), 'utf8');
  assert.match(fuente, /from '\.\.\/e2e-production-sale\/db-solo-lectura\.mjs'/);
  assert.doesNotMatch(fuente, /\b(insert|update|delete)\s+into|\bupdate\s+public\./i);
});

test('las funciones Edge que faltan son un BLOQUEO técnico, no una espera humana', () => {
  /*
   * Se pueden desplegar sin secretos y sin habilitar cobros: fallan cerrado por
   * contrato (`requireEnv` lanza ante cualquier secreto ausente). Verificado en
   * producción el 2026-08-27 con las siete desplegadas: el webhook contesta
   * HTTP 503 PAYMENT_UNAVAILABLE y el veredicto de Mercado Pago sigue DISABLED.
   *
   * Por eso llamarlas «falta un dato humano» mentiría sobre de quién es el
   * trabajo: es infraestructura nuestra y se despliega hoy.
   */
  const fuente = fs.readFileSync(path.join(root, 'scripts/comercial/compuerta-comercial.mjs'), 'utf8');
  assert.match(fuente, /chequeo\('mp_functions', BLOQUEADO/);
  assert.doesNotMatch(fuente, /chequeo\('mp_functions', FALTA_DATO_HUMANO/);
});

test('la compuerta no le pide a Walter una Public Key que el código no usa', () => {
  // Checkout Pro acá es redirección a `init_point`: el navegador nunca habla con
  // el SDK de Mercado Pago, así que no hay dónde configurar una Public Key.
  const fuente = fs.readFileSync(path.join(root, 'scripts/comercial/compuerta-comercial.mjs'), 'utf8');
  const pedido = fuente.match(/'Walter: [^']+'/g) || [];
  for (const linea of pedido) assert.doesNotMatch(linea, /Public Key/);

  const runbook = fs.readFileSync(path.join(root, 'MERCADOPAGO-PRODUCTION-ACTIVATION.md'), 'utf8');
  assert.doesNotMatch(runbook, /\|\s*\*\*Public Key productiva\*\*/, 'no puede estar en la tabla de datos obligatorios');
});

// ─── LA FOTO: DEPENDE DE SI ALGUIEN LO VE ────────────────────────────────────
/*
 * Un producto PUBLICADO sin imagen es un hueco en la góndola que el cliente mira
 * y toca; arrancar a cobrar así es una decisión que nadie tomó. Uno que no es
 * comprable puede esperar su foto todo lo que haga falta, porque nadie lo está
 * mirando. La misma ausencia, dos consecuencias distintas.
 */
test('33 válidos + 1 comprable sin foto => COMMERCIAL NOT READY', () => {
  assert.equal(veredicto([
    { estado: OK, id: 'catalogo' },
    { estado: OK, id: 'precios' },
    { estado: OK, id: 'stock' },
    { estado: BLOQUEADO, id: 'imagenes' },   // el comprable sin image_url
    { estado: OK, id: 'mp_functions' },
    { estado: OK, id: 'mercadopago' },
    { estado: ESPERA_AUTORIZACION, id: 'proveedor_pago' },
  ]), 'COMMERCIAL NOT READY');
});

test('33 válidos + incompletos ocultos sin foto => no bloquea', () => {
  assert.equal(veredicto([
    { estado: OK, id: 'catalogo' },
    { estado: OK, id: 'precios' },
    { estado: OK, id: 'stock' },
    { estado: OK, id: 'imagenes' },            // los comprables sí tienen foto
    { estado: INFO, id: 'catalogo_incompleto' }, // los ocultos, sin foto, no importan
    { estado: OK, id: 'mp_functions' },
    { estado: OK, id: 'mercadopago' },
    { estado: ESPERA_AUTORIZACION, id: 'proveedor_pago' },
  ]), 'READY TO ENABLE PAYMENT');
});

test('la regla de la foto vive en la compuerta, no en la comprabilidad del catálogo', () => {
  // El frontend sigue vendiendo un producto sin foto: cambiar eso tocaría el
  // catálogo entero para resolver una pregunta de arranque comercial.
  const r = clasificar(fila({ image_url: '' }));
  assert.equal(r.comprable, true);
  // Y la compuerta igual lo frena, con su propia regla.
  const fuente = fs.readFileSync(path.join(root, 'scripts/comercial/compuerta-comercial.mjs'), 'utf8');
  assert.match(fuente, /chequeo\('imagenes', BLOQUEADO/);
});

// ─── LAS SIETE FUNCIONES, POR NOMBRE ─────────────────────────────────────────
/*
 * `refund` y `cancel-payment` son obligatorias, y no por precaución: el Panel
 * DIBUJA el control de devolución (`data-payment-refund-confirm`) y
 * `supabase_order_repository` invoca las dos funciones. Cobrar sin poder
 * devolver deja al dueño tocando un botón que falla.
 */
test('la lista obligatoria son las siete, con las de devolución adentro', () => {
  assert.equal(FUNCIONES_OBLIGATORIAS.length, 7);
  assert.ok(FUNCIONES_OBLIGATORIAS.includes('mercadopago-refund'));
  assert.ok(FUNCIONES_OBLIGATORIAS.includes('mercadopago-cancel-payment'));

  // Y el circuito que las justifica sigue existiendo: si el Panel dejara de
  // ofrecer devoluciones, esta exigencia habría que revisarla.
  const repo = fs.readFileSync(path.join(root, 'js/repositories/supabase_order_repository.js'), 'utf8');
  assert.match(repo, /invokePaymentFunction\('mercadopago-refund'/);
  assert.match(repo, /invokePaymentFunction\('mercadopago-cancel-payment'/);
});

test('se verifican por NOMBRE y estado, no contando cuántas hay', () => {
  const salidaReal = [
    '  ✓ mercadopago-create-checkout-session          v1    ACTIVE verify_jwt=true',
    '  ✓ mercadopago-create-preference                v1    ACTIVE verify_jwt=true',
    '  ✓ mercadopago-checkout-status                  v1    ACTIVE verify_jwt=true',
    '  ✓ mercadopago-webhook                          v1    ACTIVE verify_jwt=false',
    '  ✓ mercadopago-payment-worker                   v1    ACTIVE verify_jwt=false',
    '  · mercadopago-refund                           v1    ACTIVE verify_jwt=true',
    '  · mercadopago-cancel-payment                   v1    ACTIVE verify_jwt=true',
  ].join('\n');
  assert.deepEqual(funcionesActivas(salidaReal), [...FUNCIONES_OBLIGATORIAS]);

  // Cinco correctas y dos ausentes dan «cinco», igual que cinco correctas más
  // dos de otra cosa. Contar no distingue esos dos mundos; nombrar, sí.
  const sinDevoluciones = salidaReal.split('\n').slice(0, 5).join('\n')
    + '\n  ✓ mercadopago-otra-cosa                     v1    ACTIVE verify_jwt=true'
    + '\n  ✓ mercadopago-otra-mas                      v1    ACTIVE verify_jwt=true';
  const activas = funcionesActivas(sinDevoluciones);
  assert.equal(activas.length, 5, 'las dos de relleno no cuentan');
  assert.ok(!activas.includes('mercadopago-refund'));

  // Desplegada pero NO activa no alcanza.
  const inactiva = '  ✗ mercadopago-webhook                          v1    INACTIVE';
  assert.deepEqual(funcionesActivas(inactiva, ['mercadopago-webhook']), []);

  // Y un nombre que empieza igual no puede hacerse pasar por otro.
  const parecida = '  ✓ mercadopago-refund-v2                        v1    ACTIVE';
  assert.deepEqual(funcionesActivas(parecida, ['mercadopago-refund']), []);
});

// ─── EL DESTINO SALE DEL REGISTRO DE ENTORNOS ────────────────────────────────
/*
 * El negocio, el sitio, el ref de producción y el de staging estaban escritos
 * en la compuerta, y los dos proyectos ya no existen: medía la tienda contra una
 * base borrada. Ahora salen de deploy/environments.json, al correr.
 */
test('la compuerta toma sitio, ref, negocio y refs prohibidos del registro', () => {
  const produccion = REGISTRO_ACTIVO.environments.production;
  const destino = destinoComercial({ registry: REGISTRO_ACTIVO, env: {} });
  assert.equal(destino.host, produccion.web.origin);
  assert.equal(destino.ref, produccion.supabase.ref);
  assert.equal(destino.negocio, produccion.businessId);
  assert.equal(destino.estado, 'active');
  for (const ref of ['ixewllzzuzpqrkxzmfzx', 'wwcpogltfgzgkrlilbcd', 'ukxqbgswjlibmnjemrzd', 'tkanbadcglszlcyfjvpv']) {
    assert.ok(destino.prohibidos.has(ref), `${ref} tiene que estar prohibido`);
  }
  // TABA_PUBLIC_ORIGIN sigue pudiendo apuntar la compuerta a otro sitio, como antes.
  assert.equal(destinoComercial({ registry: REGISTRO_ACTIVO, env: { TABA_PUBLIC_ORIGIN: 'https://otro.example' } }).host,
    'https://otro.example');
});

test('sin proyecto de producción la compuerta no tiene destino: falla cerrado', () => {
  assert.throws(() => destinoComercial({ registry: SIN_PRODUCCION, env: {} }), { code: 'PRODUCTION_NOT_PROVISIONED' });
});

// Correrla de verdad con un registro activo saldría a la red; por eso sólo se corre mientras el registro real no tenga
// producción, y con el registro alternativo apagado.
const produccionReal = JSON.parse(fs.readFileSync(path.join(root, 'deploy/environments.json'), 'utf8'))
  .environments.production.status;
test('sin proyecto de producción la línea de comandos sale 2, sin tocar la red', {
  skip: produccionReal !== 'not_provisioned' && 'el registro real ya tiene producción: correr la compuerta saldría a la red',
}, () => {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/comercial/compuerta-comercial.mjs')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, TABA_ENVIRONMENTS_FILE: '' },
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Producción todavía no tiene un proyecto/);
  assert.doesNotMatch(r.stdout, /VEREDICTO/);
});

test('el runtime-config publicado no puede nombrar QA ni un proyecto retirado', () => {
  const destino = destinoComercial({ registry: REGISTRO_ACTIVO, env: {} });
  const publicado = (ref, negocio = destino.negocio) => ({
    ok: true, estado: 200, cuerpo: `supabaseUrl: 'https://${ref}.supabase.co', businessId: '${negocio}'`,
  });
  assert.equal(chequeoFrontend(publicado(destino.ref), destino).estado, OK);
  // El sitio todavía nombra la producción anterior, que ya no existe: eso bloquea, igual que QA o staging.
  for (const ref of ['wwcpogltfgzgkrlilbcd', 'ukxqbgswjlibmnjemrzd', 'ixewllzzuzpqrkxzmfzx']) {
    const r = chequeoFrontend(publicado(ref), destino);
    assert.equal(r.estado, BLOQUEADO, ref);
    assert.match(r.detalle, /QA, retirado o ajeno/);
  }
  assert.match(chequeoFrontend(publicado('abcdefghijklmnopqrst'), destino).detalle, /no apunta al Supabase de producción/);
  assert.match(chequeoFrontend(publicado(destino.ref, 'otro-negocio'), destino).detalle, /otro negocio/);
  assert.equal(chequeoFrontend({ ok: false, estado: 404, cuerpo: '' }, destino).estado, BLOQUEADO);
});

test('un proyecto aprovisionado y todavía no activo nunca da READY FOR REAL PAYMENT', () => {
  assert.equal(chequeoEntorno(destinoComercial({ registry: REGISTRO_ACTIVO, env: {} })).estado, OK);
  const espera = chequeoEntorno(destinoComercial({ registry: PROVISIONADO, env: {} }));
  assert.equal(espera.estado, ESPERA_AUTORIZACION);
  assert.equal(veredicto([{ estado: OK }, { estado: OK }, espera]), 'READY TO ENABLE PAYMENT');
});
