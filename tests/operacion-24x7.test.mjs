/*
 * TABA ABIERTA LAS 24 HORAS, Y EL ALCOHOL NO.
 *
 * Son tres contratos distintos y hasta ahora dos de ellos no se podían separar:
 *
 *   1. el comercio ACEPTA PEDIDOS      → canal `delivery` / `pickup`
 *   2. hay REPARTO disponible          → zona de entrega + canal `delivery`
 *   3. un producto especial SE PUEDE VENDER → canal `alcohol` + su compuerta
 *
 * Lo que faltaba era poder escribir «el canal está abierto todo el día» con la
 * exigencia de horario encendida: la RPC del Panel topaba en `23:59` y la tabla
 * prohíbe una franja de ancho cero, así que 24/7 sólo se lograba APAGANDO la
 * exigencia —lo que también apaga el otro canal y borra la diferencia entre
 * «atiende siempre» y «no cargó horario»—.
 *
 * Se resuelve con `00:00 – 24:00`, que la tabla ya admite y `business_is_open`
 * ya sabe leer. Estas pruebas cubren las dos mitades:
 *
 *   · la semántica de la franja, en el módulo de presentación, contra los cinco
 *     instantes del encargo;
 *   · el contrato del backend, leído del SQL, para que nadie vuelva a acoplar el
 *     horario general con la venta de alcohol.
 *
 * LA AUTORIDAD SIGUE SIENDO LA BASE. `business_is_open` decide con el huso del
 * comercio, y nada de lo que se prueba acá autoriza una compra: `service-hours.js`
 * sólo explica una grilla y valida antes de mandarla.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  FULL_DAY_CLOSE,
  buildAlwaysOpenGrid,
  describeSlot,
  describeWeeklyGrid,
  isAlwaysOpenGrid,
  isFullDaySlot,
  isValidCloseTime,
  isValidOpenTime,
  minutesOfDay,
  slotContainsLocalTime,
  weeklyGridIsOpenAt,
} from '../js/core/service-hours.js';
import { validateWeeklyHours } from '../js/business/business-operations-config.js';

const sqlHorarios = fs.readFileSync(
  new URL('../supabase/migrations/20260828130000_horario_24x7_representable.sql', import.meta.url),
  'utf8',
);
const sqlResolucion = fs.readFileSync(
  new URL('../supabase/migrations/20260812210000_business_operations_resolution.sql', import.meta.url),
  'utf8',
);
const sqlCheckout = fs.readFileSync(
  new URL('../supabase/migrations/20260812220000_business_operations_checkout_enforcement.sql', import.meta.url),
  'utf8',
);

/** Los cinco instantes del encargo, más los bordes que rompen una franja mal escrita. */
const INSTANTES = ['00:00', '02:00', '05:00', '12:00', '23:59'];

test('un día completo contiene las 24 horas, incluida la madrugada', () => {
  const dia = { weekday: 3, opensAt: '00:00', closesAt: FULL_DAY_CLOSE };
  assert.equal(isFullDaySlot(dia), true);
  for (const hora of INSTANTES) {
    assert.equal(slotContainsLocalTime(dia, hora), true, `${hora} tiene que caer adentro del día completo`);
  }
});

test('la grilla de 24/7 deja el canal abierto en los cinco instantes y los siete días', () => {
  const grilla = buildAlwaysOpenGrid();
  assert.equal(isAlwaysOpenGrid(grilla), true);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (const localTime of INSTANTES) {
      assert.equal(
        weeklyGridIsOpenAt(grilla, { weekday, localTime }),
        true,
        `día ${weekday} a las ${localTime} tendría que estar abierto`,
      );
    }
  }
});

test('un horario comercial normal sigue cerrando de madrugada', () => {
  // La contraprueba que le da sentido a la anterior: si 24/7 se lograra
  // aflojando la comparación, este horario también daría abierto a las 02:00.
  const comercial = Array.from({ length: 7 }, (_, weekday) => ({ weekday, opensAt: '09:00', closesAt: '21:00' }));
  assert.equal(isAlwaysOpenGrid(comercial), false);
  assert.equal(weeklyGridIsOpenAt(comercial, { weekday: 3, localTime: '12:00' }), true);
  for (const localTime of ['00:00', '02:00', '05:00', '23:59']) {
    assert.equal(weeklyGridIsOpenAt(comercial, { weekday: 3, localTime }), false, `${localTime} tiene que estar cerrado`);
  }
  // 21:00 en punto ya cerró: el intervalo es semiabierto, igual que time_in_window.
  assert.equal(weeklyGridIsOpenAt(comercial, { weekday: 3, localTime: '21:00' }), false);
  assert.equal(weeklyGridIsOpenAt(comercial, { weekday: 3, localTime: '09:00' }), true);
});

test('una franja que cruza la medianoche arrastra al día siguiente y no al anterior', () => {
  // Viernes 22:00 → sábado 02:00. El sábado a la 01:00 está abierto POR EL
  // VIERNES; el viernes a la 01:00 no, porque su franja todavía no empezó.
  const nocturno = [{ weekday: 5, opensAt: '22:00', closesAt: '02:00' }];
  assert.equal(weeklyGridIsOpenAt(nocturno, { weekday: 5, localTime: '23:00' }), true);
  assert.equal(weeklyGridIsOpenAt(nocturno, { weekday: 6, localTime: '01:00' }), true);
  assert.equal(weeklyGridIsOpenAt(nocturno, { weekday: 5, localTime: '01:00' }), false);
  assert.equal(weeklyGridIsOpenAt(nocturno, { weekday: 6, localTime: '03:00' }), false);
});

test('24:00 vale como cierre y nunca como apertura', () => {
  assert.equal(isValidCloseTime('24:00'), true);
  assert.equal(isValidOpenTime('24:00'), false);
  assert.equal(minutesOfDay('24:00'), 1440);
  assert.equal(minutesOfDay('25:00'), null);
  assert.equal(minutesOfDay('23:60'), null);

  const { ok, errors } = validateWeeklyHours([{ weekday: 1, opensAt: '24:00', closesAt: '08:00' }]);
  assert.equal(ok, false);
  assert.match(errors[0], /HH:MM/);
});

test('el Panel acepta la grilla de 24/7 y rechaza mezclarla con otro tramo', () => {
  assert.equal(validateWeeklyHours(buildAlwaysOpenGrid()).ok, true);
  // El día completo ocupa la recta entera de minutos, así que cualquier otro
  // tramo del mismo día lo toca. Aceptarlo dejaría dos filas que dicen lo mismo.
  const mezcla = validateWeeklyHours([
    { weekday: 1, opensAt: '00:00', closesAt: '24:00' },
    { weekday: 1, opensAt: '08:00', closesAt: '14:00' },
  ]);
  assert.equal(mezcla.ok, false);
  assert.match(mezcla.errors[0], /superpuestos/);
});

test('el día completo se lee con palabras, no con un borde que hay que decodificar', () => {
  assert.equal(describeSlot({ opensAt: '00:00', closesAt: '24:00' }), 'Las 24 horas');
  assert.equal(describeSlot({ opensAt: '09:00', closesAt: '21:00' }), '09:00–21:00');
  assert.equal(describeWeeklyGrid(buildAlwaysOpenGrid()), 'Abierto las 24 horas, todos los días');
  assert.equal(describeWeeklyGrid([]), 'Sin horario cargado');
  // Seis días completos no son 24/7 y decirlo sería mentir en la primera pantalla.
  assert.equal(isAlwaysOpenGrid(buildAlwaysOpenGrid().slice(0, 6)), false);
});

test('la RPC de horarios acepta 24:00 sólo como cierre', () => {
  assert.match(sqlHorarios, /create or replace function public\.set_business_service_hours/);
  // La apertura sigue topando en 23:59; el cierre suma la alternativa 24:00.
  assert.match(sqlHorarios, /'opens_at'\) !~ '\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\(:\[0-5\]\[0-9\]\)\?\$'/);
  assert.match(sqlHorarios, /'closes_at'\)[^\n]*\|\^24:00\(:00\)\?\$'/);
  // Sigue siendo transaccional y auditada: reemplaza la grilla entera y deja
  // el antes y el después en business_config_audit.
  assert.match(sqlHorarios, /delete from public\.business_service_hours/);
  assert.match(sqlHorarios, /insert into public\.business_config_audit/);
  assert.match(sqlHorarios, /can_manage_commercial_settings/);
  // No escribe un solo horario: aplicar la migración no pone a nadie 24/7.
  assert.doesNotMatch(sqlHorarios, /insert into public\.businesses/i);
  assert.doesNotMatch(sqlHorarios, /update public\.businesses/i);
});

test('la autoridad del horario es el backend con el huso del comercio', () => {
  // `business_is_open` lee la hora del instante EN EL HUSO DEL COMERCIO. Ningún
  // camino usa la hora del navegador, y sin huso configurado cierra en vez de
  // adivinar.
  assert.match(sqlResolucion, /v_local := p_at at time zone v_business\.operating_timezone/);
  assert.match(sqlResolucion, /operating_timezone is null[\s\S]{0,120}return false/);
  // La franja se evalúa semiabierta y el arrastre lo aporta el día anterior:
  // es la misma regla que replica `core/service-hours.js`.
  assert.match(sqlResolucion, /v_time >= w\.opens_at and v_time < w\.closes_at/);
  assert.match(sqlResolucion, /business_day_windows\(p_business_id, p_channel, v_date - 1\)/);
});

test('el horario general NO autoriza la venta de alcohol', () => {
  /*
   * ESTE ES EL CONTRATO CRÍTICO DEL ENCARGO.
   *
   * Que el comercio abra las 24 horas no puede volver comprable una cerveza a
   * las 03:00. Las dos decisiones viajan por caminos separados y este test lo
   * fija leyendo el SQL del checkout:
   *
   *   · el alcohol exige `alcohol_sales_enabled` y su política completa —edad
   *     mínima, ventana y huso— antes de mirar cualquier otra cosa;
   *   · su ventana horaria se evalúa con `alcohol_timezone` y
   *     `alcohol_sales_start/end`, que son columnas propias;
   *   · si además hay grilla, se consulta el canal `alcohol`, que son FILAS
   *     DISTINTAS de las de `delivery` y `pickup`, detrás de su propia bandera
   *     `alcohol_hours_enforced`.
   *
   * Ninguna de las tres mira `hours_enforced` ni las franjas del canal de venta.
   */
  const bloqueAlcohol = sqlCheckout.slice(
    sqlCheckout.indexOf('if v_contains_alcohol then'),
    sqlCheckout.indexOf('-- ── HORARIO ─'),
  );
  assert.ok(bloqueAlcohol.length > 0, 'no se encontró el bloque de alcohol del checkout');
  assert.match(bloqueAlcohol, /not v_business\.alcohol_sales_enabled/);
  assert.match(bloqueAlcohol, /v_business\.alcohol_minimum_age is null/);
  assert.match(bloqueAlcohol, /v_business\.alcohol_sales_start is null/);
  assert.match(bloqueAlcohol, /v_business\.alcohol_timezone is null/);
  assert.match(bloqueAlcohol, /confirmacion de mayoria de edad requerida/);
  // La compuerta de alcohol no consulta el horario general por ningún lado.
  assert.doesNotMatch(bloqueAlcohol, /hours_enforced/);
  assert.doesNotMatch(bloqueAlcohol, /business_is_open/);
  assert.doesNotMatch(bloqueAlcohol, /business_service_hours/);

  // Y la ventana de alcohol, cuando se exige, pregunta por SU canal.
  assert.match(sqlCheckout, /alcohol_hours_enforced[\s\S]{0,160}business_is_open\(v_business_id, 'alcohol'/);
  // El canal de venta pregunta por el suyo, con el modo de entrega del pedido.
  assert.match(sqlCheckout, /business_is_open\(v_business_id, v_delivery_mode, clock_timestamp\(\)\)/);
});

test('aceptar pedidos y tener reparto siguen siendo dos preguntas distintas', () => {
  /*
   * Un comercio abierto 24 horas NO implica que haya un repartidor. En el
   * checkout son dos compuertas consecutivas y con dos motivos distintos:
   * `BUSINESS_CLOSED` es horario, `OUT_OF_DELIVERY_ZONE` es cobertura. Juntarlas
   * haría que abrir de madrugada prometiera una entrega que nadie puede hacer.
   */
  assert.match(sqlCheckout, /raise exception 'BUSINESS_CLOSED'/);
  assert.match(sqlCheckout, /raise exception 'OUT_OF_DELIVERY_ZONE'/);
  const cobertura = sqlCheckout.slice(sqlCheckout.indexOf("if v_delivery_mode = 'delivery' then"));
  assert.match(cobertura, /resolve_delivery_zone\(/);
  // La cobertura no se decide con el horario: son listas blancas de zona.
  const zonaHastaElRechazo = cobertura.slice(0, cobertura.indexOf("raise exception 'OUT_OF_DELIVERY_ZONE'"));
  assert.doesNotMatch(zonaHastaElRechazo, /business_is_open/);
});
