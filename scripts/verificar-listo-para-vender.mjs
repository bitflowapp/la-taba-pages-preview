/*
 * ¿PUEDE ENTRAR UN CLIENTE AHORA, COMPRAR Y RECIBIR SU PEDIDO?
 *
 * Ésta es la pregunta comercial, y no la contesta ninguna suite de pruebas: un
 * repositorio verde con el envío sin precio, sin horarios y sin zonas vende
 * igual —a cualquier dirección, a cualquier hora y con el reparto gratis—.
 * Los gates técnicos del proyecto miden que el software haga lo que dice; éste
 * mide que el COMERCIO esté configurado para vender.
 *
 * SÓLO LEE. Toda la base entra por `db-solo-lectura.mjs`, que rechaza cualquier
 * sentencia que no sea un SELECT. No escribe, no repara y no decide nada: lo
 * que encuentra sin resolver lo deja escrito con el nombre de quien tiene que
 * resolverlo.
 *
 *   node scripts/verificar-listo-para-vender.mjs
 *
 * Salida 0 = se puede vender. 1 = falta una decisión humana. 2 = no se pudo
 * preguntar.
 *
 * POR QUÉ MIRA `business_config_audit` Y NO SÓLO EL VALOR
 * ------------------------------------------------------
 * El 2026-08-18 un guion de plataforma escribió `delivery_fee = 0` y
 * `minimum_delivery_subtotal = 0` sobre dos columnas que estaban en NULL, con
 * `actor_kind='service'`. Mirando sólo la fila, el envío «está configurado en
 * $0». Mirando la auditoría se ve que nadie del comercio lo decidió — y que ese
 * cero, además, es lo que ABRE la puerta: `resolve_delivery_zone` devuelve
 * `business_fee_missing` y no entrega nada mientras la tarifa es NULL. Un valor
 * por omisión que enciende una venta no es una configuración: es una promesa
 * comercial que nadie hizo.
 */
import process from 'node:process';
import { consultar, lit } from './e2e-production-sale/db-solo-lectura.mjs';
import { PRODUCCION, RIDER } from './e2e-production-sale/contrato.mjs';

const NEGOCIO = PRODUCCION.businessId;
const lineas = [];
const pendientes = [];
const avisos = [];

const ok = (texto) => lineas.push(`  OK      ${texto}`);
const info = (texto) => lineas.push(`  ·       ${texto}`);
const aviso = (texto) => { avisos.push(texto); lineas.push(`  AVISO   ${texto}`); };
const humano = (texto, donde) => {
  pendientes.push({ texto, donde });
  lineas.push(`  DECIDE  ${texto}`);
  lineas.push(`          → ${donde}`);
};
const volcar = () => console.log(lineas.splice(0).join('\n'));

const pesos = (valor) => (valor === null || valor === undefined
  ? 'sin definir'
  : `$ ${Number(valor).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`);

let negocio;
try {
  [negocio] = await consultar(`
    select name, status, is_active, ordering_enabled, ordering_verified,
           delivery_enabled, pickup_enabled, delivery_fee, minimum_delivery_subtotal,
           delivery_zone_enforced, hours_enforced, delivery_max_radius_meters,
           alcohol_sales_enabled, operating_timezone, address,
           coalesce(phone, whatsapp_phone, whatsapp) as contacto
      from public.businesses where id = ${lit(NEGOCIO)}`);
} catch (error) {
  console.error(`no se pudo leer producción: ${String(error.message).slice(0, 200)}`);
  process.exit(2);
}
if (!negocio) {
  console.error('el negocio canónico no existe en producción');
  process.exit(2);
}

console.log(`\nLA TABA — ¿LISTO PARA VENDER?  (${negocio.name} · ${negocio.address || 'sin dirección'})\n`);

// ── 1 · la puerta ────────────────────────────────────────────────────────────
console.log('LA PUERTA');
const abierta = negocio.status === 'open' && negocio.is_active
  && negocio.ordering_enabled && negocio.ordering_verified;
if (abierta) ok(`la tienda toma pedidos · status=${negocio.status}`);
else {
  humano(`la tienda NO toma pedidos · status=${negocio.status} · habilitado=${negocio.ordering_enabled} · verificado=${negocio.ordering_verified}`,
    'Panel → Abrir');
}
if (negocio.delivery_enabled) ok('delivery encendido');
else aviso('delivery apagado');
info(`retiro en local: ${negocio.pickup_enabled ? 'sí' : 'no'}`);
volcar();

// ── 2 · el envío, que es donde se va la plata ────────────────────────────────
console.log('\nENVÍO Y MÍNIMO');
const [auditoria] = await consultar(`
  select actor_kind, created_at
    from public.business_config_audit
   where business_id = ${lit(NEGOCIO)} and scope = 'delivery_pricing'
   order by created_at desc limit 1`);
if (negocio.delivery_fee === null) {
  humano('el envío no tiene precio: con la tarifa en NULL el servidor no entrega nada',
    'Panel → Horarios y cobertura → Envío y pedido mínimo');
} else if (auditoria && auditoria.actor_kind !== 'user') {
  humano(`el envío dice ${pesos(negocio.delivery_fee)} y el mínimo ${pesos(negocio.minimum_delivery_subtotal)}, `
    + `pero los escribió «${auditoria.actor_kind}», no el comercio (${String(auditoria.created_at).slice(0, 16)})`,
    'Panel → Horarios y cobertura → Envío y pedido mínimo. Guardarlos desde ahí lo vuelve una decisión del comercio.');
} else {
  ok(`envío ${pesos(negocio.delivery_fee)} · mínimo ${pesos(negocio.minimum_delivery_subtotal)}, fijados por el comercio`);
}
volcar();

// ── 3 · hasta dónde se entrega ───────────────────────────────────────────────
console.log('\nCOBERTURA');
const zonas = await consultar(`
  select name, is_active from public.delivery_zones
   where business_id = ${lit(NEGOCIO)} order by priority, name`);
const activas = zonas.filter((zona) => zona.is_active);
/*
 * EL TOPE POR DISTANCIA NO ES UNA OPCIÓN HOY, Y MANDAR A ALGUIEN A BUSCARLO ES
 * MANDARLO A UN ERROR.
 *
 * `set_delivery_pricing` se niega a fijar `delivery_max_radius_meters` si no hay
 * un punto del local verificado POR UNA PERSONA —«el tope de distancia necesita
 * el punto del local verificado por una persona», errcode 55000—, y en
 * producción `private.rider_map_business_locations` está VACÍA. Así que la única
 * palanca de cobertura disponible es la lista blanca de zonas.
 */
const [punto] = await consultar('select count(*) filter (where human_verified) verificados from private.rider_map_business_locations');
const topePosible = Number(punto?.verificados || 0) > 0;
if (!negocio.delivery_zone_enforced) {
  humano('la cobertura no se exige: hoy se acepta un pedido a CUALQUIER dirección',
    'Panel → Horarios y cobertura → Zonas de entrega, y después «Empezar a exigir»');
  info(`zonas cargadas: ${zonas.length} (${activas.length} activas)`);
  if (!topePosible) {
    info('el tope por distancia no está disponible: exige un punto del local verificado por una persona, y no hay ninguno cargado');
  }
} else if (!activas.length) {
  humano('la cobertura se exige y NO hay ninguna zona activa: se cancelarían todos los envíos',
    'Panel → Horarios y cobertura → Zonas de entrega');
} else {
  ok(`${activas.length} zona(s) activa(s), y la cobertura se exige`);
}
volcar();

// ── 4 · cuándo se atiende ────────────────────────────────────────────────────
console.log('\nHORARIOS');
const horarios = await consultar(`
  select channel, weekday from public.business_service_hours
   where business_id = ${lit(NEGOCIO)} order by channel, weekday`);
if (!horarios.length) {
  humano('no hay horarios cargados: la tienda figura abierta las 24 h y no puede decirle al cliente cuándo vuelve a abrir',
    'Panel → Horarios y cobertura → Horario de atención');
  info('mientras tanto la tienda se abre y se cierra a mano desde Panel → Abrir / Cerrar');
} else if (!negocio.hours_enforced) {
  aviso(`hay ${horarios.length} tramo(s) cargado(s) pero no se exigen: la tienda no cierra sola`);
} else {
  ok(`${horarios.length} tramo(s) y el horario manda · huso ${negocio.operating_timezone}`);
}
volcar();

// ── 5 · con qué se paga ──────────────────────────────────────────────────────
console.log('\nMEDIOS DE PAGO');
const [pagos] = await consultar(`
  select count(*) filter (where enabled) habilitados, count(*) total
    from public.business_payment_settings where business_id = ${lit(NEGOCIO)}`);
if (Number(pagos.habilitados) > 0) ok(`${pagos.habilitados} proveedor(es) de pago en línea habilitado(s)`);
else info('sin pago en línea: la tienda ofrece «a coordinar con el local» y «efectivo al recibir», que es exactamente lo que dice el checkout');
volcar();

// ── 6 · qué hay para vender ──────────────────────────────────────────────────
console.log('\nGÓNDOLA');
const [catalogo] = await consultar(`
  select count(*) total,
         count(*) filter (where available and is_verified) comprables,
         count(*) filter (where available and is_verified and stock <= 0) sin_stock,
         count(*) filter (where available and is_verified and image_url is not null) con_foto,
         count(*) filter (where available and is_verified and is_alcoholic) alcohol_a_la_venta
    from public.products where business_id = ${lit(NEGOCIO)}`);
if (Number(catalogo.comprables) > 0) {
  ok(`${catalogo.comprables} producto(s) comprable(s) de ${catalogo.total} · ${catalogo.con_foto} con fotografía propia`);
} else {
  humano('no hay ningún producto comprable: la tienda está vacía', 'Panel → Mostrador');
}
if (Number(catalogo.sin_stock) > 0) aviso(`${catalogo.sin_stock} producto(s) publicados sin stock`);
if (Number(catalogo.alcohol_a_la_venta) > 0 && !negocio.alcohol_sales_enabled) {
  humano(`${catalogo.alcohol_a_la_venta} producto(s) con alcohol están a la venta y la venta de alcohol está apagada`,
    'decisión del titular: habilitar alcohol es una habilitación, no un ajuste');
}
volcar();

// ── 7 · cómo llega el cliente al comercio si algo sale mal ───────────────────
console.log('\nCONTACTO');
/*
 * NO HAY PANTALLA QUE ARREGLE ESTO, Y CONVIENE DECIRLO EN VEZ DE MANDAR A UNA
 * QUE NO EXISTE.
 *
 * `set_business_whatsapp_contact(business_id, telefono, verificado)` existe en
 * la base, exige rol owner/admin y valida el número — pero NINGÚN archivo del
 * cliente la llama. La única pantalla con un campo de WhatsApp vive en
 * `js/business.js` (el tablero de demostración) y guarda en el estado del
 * navegador, no en el servidor: en producción esa superficie se vacía.
 *
 * Y el cliente no muestra un número sin `whatsapp_verified = true`, así que
 * publicar de verdad son las dos cosas: cargar el número y verificarlo.
 */
if (negocio.contacto) ok('el comercio publica un contacto');
else {
  humano('el comercio no publica teléfono ni WhatsApp: un cliente con un problema no tiene a dónde escribir',
    'no hay pantalla: `set_business_whatsapp_contact` existe en la base y nadie la llama. '
    + 'Publicarlo hoy exige ejecutarla con una sesión owner/admin, o agregarle el formulario que le falta al Panel.');
}
volcar();

// ── 8 · lo que quedó abierto de antes ────────────────────────────────────────
console.log('\nOPERACIÓN EN CURSO');
const vivos = await consultar(`
  select public_code, status, assigned_rider_user_id
    from public.orders
   where business_id = ${lit(NEGOCIO)}
     and status not in ('delivered', 'cancelled', 'rejected')
   order by created_at`);
if (!vivos.length) ok('no hay pedidos abiertos de antes');
else {
  const porRepartidor = new Map();
  for (const pedido of vivos) {
    if (!pedido.assigned_rider_user_id) continue;
    porRepartidor.set(pedido.assigned_rider_user_id, (porRepartidor.get(pedido.assigned_rider_user_id) || 0) + 1);
  }
  /*
   * El tope sale de `contrato.mjs` y NO de `rider_max_active_orders()`. La
   * puerta de sólo lectura rechaza —con razón— cualquier llamada a función, y
   * relajarla para conseguir un número que ya está escrito sería cambiar una
   * garantía por una comodidad. La autoridad sigue siendo el servidor; esto es
   * sólo para poder decir «lleva 2 de 3».
   */
  const tope = RIDER.maximoDeEntregasActivas;
  humano(`${vivos.length} pedido(s) siguen abiertos: ${vivos.map((p) => `${p.public_code}:${p.status}`).join(', ')}`,
    'cerrarlos desde el teléfono del repartidor, o cancelarlos desde el Panel');
  for (const [, cuantos] of porRepartidor) {
    if (cuantos >= tope) {
      humano(`un repartidor ya lleva ${cuantos} de ${tope} entregas activas: no puede tomar ninguna más`,
        'cerrar esas entregas antes de que entre tráfico real');
    } else if (cuantos > 0) {
      aviso(`un repartidor arranca con ${cuantos} de ${tope} entregas ocupadas`);
    }
  }
}
volcar();

// ── 9 · el vigía ─────────────────────────────────────────────────────────────
console.log('\nVIGILANCIA');
const [barrido] = await consultar(`
  select status, round(extract(epoch from (now() - started_at))) segundos
    from public.operational_sweep_runs order by started_at desc limit 1`);
if (barrido && barrido.status === 'ok' && Number(barrido.segundos) < 300) {
  ok(`la vigilancia revisó la operación hace ${barrido.segundos} s`);
} else {
  humano(`la vigilancia automática no está al día (${barrido ? `${barrido.status}, hace ${barrido.segundos} s` : 'sin corridas'})`,
    'revisar los cron del proyecto: sin vigilancia, un tablero vacío no significa nada');
}
const alertas = await consultar(`
  select severity, count(*) cuantas from public.operational_alerts
   where business_id = ${lit(NEGOCIO)} and status <> 'resolved' group by severity`);
if (!alertas.length) ok('sin alertas operativas abiertas');
else {
  for (const fila of alertas) {
    const texto = `${fila.cuantas} alerta(s) ${fila.severity} abierta(s)`;
    if (fila.severity === 'CRITICAL' || fila.severity === 'ACTION_REQUIRED') humano(texto, 'Panel → Qué resolver');
    else aviso(texto);
  }
}
volcar();

// ── veredicto ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(74)}`);
if (!pendientes.length) {
  console.log(`LISTO PARA VENDER${avisos.length ? ` · con ${avisos.length} aviso(s)` : ''}\n`);
  process.exit(0);
}
console.log(`FALTAN ${pendientes.length} DECISIÓN(ES) HUMANA(S) — ninguna la puede tomar el software:\n`);
pendientes.forEach((pendiente, indice) => {
  console.log(`  ${indice + 1}. ${pendiente.texto}`);
  console.log(`     → ${pendiente.donde}\n`);
});
process.exit(1);
