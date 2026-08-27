import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { clasificar, csvDe, MOTIVOS } from '../scripts/comercial/censo-produccion.mjs';
import {
  BLOQUEADO, ESPERA_AUTORIZACION, FALTA_DATO_HUMANO, INFO, OK, veredicto,
} from '../scripts/comercial/compuerta-comercial.mjs';

const root = path.resolve(import.meta.dirname, '..');

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
