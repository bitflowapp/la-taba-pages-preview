/*
 * Horarios de atención, del lado del que los MUESTRA.
 *
 * QUÉ ES Y QUÉ NO ES
 * ------------------
 * NO es la autoridad. Quien decide si el comercio está abierto es
 * `business_is_open` en la base, con el huso del comercio
 * (`businesses.operating_timezone`) y las filas de `business_service_hours`. El
 * navegador no vota: pregunta y recibe una respuesta ya decidida, y la hora del
 * dispositivo no participa de esa decisión en ningún camino.
 *
 * Este módulo existe para las dos cosas que sí pasan en el cliente:
 *
 *   1. DECIR lo que hay cargado. El Panel dibuja la grilla semanal y la tienda
 *      muestra el horario; las dos necesitan poder leer «00:00 – 24:00» y
 *      escribir «Abierto las 24 horas» en vez de repetir un par de horas que no
 *      dice nada.
 *   2. VALIDAR temprano. Antes de mandar una grilla al servidor conviene
 *      rechazar lo que el servidor va a rechazar igual, para que el operador vea
 *      el error donde lo escribió.
 *
 * Las reglas de acá replican exactamente las de `time_in_window` y
 * `set_business_service_hours`. Si estas funciones se borraran, el sistema
 * seguiría siendo correcto —sólo más molesto de usar—.
 *
 * EL DÍA COMPLETO
 * ---------------
 * `00:00 – 24:00`. No es un truco: `time` en PostgreSQL admite `24:00:00` como
 * valor máximo y la hora local de un instante siempre es menor, así que el
 * intervalo semiabierto `[00:00, 24:00)` contiene todas las horas del día. Siete
 * de esas filas —una por día— son un canal abierto las 24 horas, sin una
 * columna nueva, sin una bandera nueva y sin tocar la función que decide.
 *
 * `24:00` vale SÓLO como cierre. Como apertura sería una franja que empieza
 * cuando el día terminó y quedaría equivalente a `00:00 – cierre` con otro
 * nombre: dos formas de escribir lo mismo es exactamente lo que este contrato
 * evita.
 */

export const FULL_DAY_OPEN = '00:00';
export const FULL_DAY_CLOSE = '24:00';
export const MINUTES_IN_DAY = 1440;
export const WEEKDAY_COUNT = 7;

/** Una hora de apertura: reloj de 24, de `00:00` a `23:59`. */
const OPEN_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
/** Una hora de cierre: lo mismo, más `24:00` para el día completo. */
const CLOSE_TIME_PATTERN = /^(?:([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$/;

export function isValidOpenTime(value) {
  return OPEN_TIME_PATTERN.test(String(value ?? ''));
}

export function isValidCloseTime(value) {
  return CLOSE_TIME_PATTERN.test(String(value ?? ''));
}

/** Minutos desde la medianoche local. `24:00` vale 1440; una hora inválida, `null`. */
export function minutesOfDay(value) {
  const text = String(value ?? '');
  if (!isValidCloseTime(text)) return null;
  const [hours, mins] = text.split(':').map(Number);
  return hours * 60 + mins;
}

/** ¿Esta franja es el día entero? */
export function isFullDaySlot(slot = {}) {
  return minutesOfDay(slot.opensAt) === 0 && minutesOfDay(slot.closesAt) === MINUTES_IN_DAY;
}

/**
 * ¿La franja contiene esta hora local?
 *
 * Intervalo SEMIABIERTO `[desde, hasta)`, igual que `time_in_window`: una franja
 * 08:00–14:00 abre a las 08:00 en punto y a las 14:00 ya no toma un pedido. Una
 * franja de ancho cero no contiene nada. `desde > hasta` cruza la medianoche y
 * contiene la cola del día (`hora >= desde`); el arrastre de la madrugada lo
 * aporta la franja del día ANTERIOR, igual que en la base.
 */
export function slotContainsLocalTime(slot = {}, localTime = '') {
  const from = minutesOfDay(slot.opensAt);
  const to = minutesOfDay(slot.closesAt);
  const at = minutesOfDay(localTime);
  if (from === null || to === null || at === null) return false;
  if (from === to) return false;
  if (from < to) return at >= from && at < to;
  return at >= from;
}

/** El arrastre que una franja del día anterior deja en la madrugada de hoy. */
export function slotCarriesIntoLocalTime(slot = {}, localTime = '') {
  const from = minutesOfDay(slot.opensAt);
  const to = minutesOfDay(slot.closesAt);
  const at = minutesOfDay(localTime);
  if (from === null || to === null || at === null) return false;
  return from > to && at < to;
}

/**
 * ¿Este canal está abierto en este momento LOCAL, según la grilla cargada?
 *
 * Es la lectura de presentación de `business_is_open` para el horario
 * recurrente: la franja de hoy —completa, o sólo su cola si cruza— más el
 * arrastre de la de ayer. NO mira excepciones ni feriados: ésos viven en
 * `business_service_exceptions` y sólo el servidor los resuelve, así que esta
 * función se usa para explicar una grilla, nunca para autorizar una compra.
 *
 * `weekday` es 0 = domingo, igual que `extract(dow)` y que la columna.
 */
export function weeklyGridIsOpenAt(slots = [], { weekday, localTime } = {}) {
  const day = Number(weekday);
  if (!Number.isInteger(day) || day < 0 || day > 6) return false;
  if (minutesOfDay(localTime) === null) return false;
  const previousDay = (day + 6) % WEEKDAY_COUNT;
  const list = Array.isArray(slots) ? slots : [];
  return list.some((slot) => (
    (Number(slot?.weekday) === day && slotContainsLocalTime(slot, localTime))
    || (Number(slot?.weekday) === previousDay && slotCarriesIntoLocalTime(slot, localTime))
  ));
}

/** La grilla de un canal abierto las 24 horas: un día completo por día. */
export function buildAlwaysOpenGrid() {
  return Array.from({ length: WEEKDAY_COUNT }, (_, weekday) => ({
    weekday,
    opensAt: FULL_DAY_OPEN,
    closesAt: FULL_DAY_CLOSE,
  }));
}

/**
 * ¿Esta grilla describe un canal abierto las 24 horas?
 *
 * Exige los siete días con su día completo. Seis días completos y uno cortado no
 * son 24/7 y decirlo sería mentir en la primera pantalla, que es donde más caro
 * sale.
 */
export function isAlwaysOpenGrid(slots = []) {
  const list = Array.isArray(slots) ? slots : [];
  if (list.length !== WEEKDAY_COUNT) return false;
  const days = new Set();
  for (const slot of list) {
    if (!isFullDaySlot(slot)) return false;
    const day = Number(slot?.weekday);
    if (!Number.isInteger(day) || day < 0 || day > 6) return false;
    days.add(day);
  }
  return days.size === WEEKDAY_COUNT;
}

/**
 * Cómo se lee una franja. El día completo se dice con palabras: repetir
 * «00:00 – 24:00» obliga a quien lo lee a decodificar un borde que no eligió.
 */
export function describeSlot(slot = {}) {
  if (isFullDaySlot(slot)) return 'Las 24 horas';
  const from = String(slot.opensAt ?? '');
  const to = String(slot.closesAt ?? '');
  if (!isValidOpenTime(from) || !isValidCloseTime(to)) return '';
  return `${from}–${to}`;
}

/** Cómo se lee la grilla entera de un canal. */
export function describeWeeklyGrid(slots = []) {
  const list = Array.isArray(slots) ? slots : [];
  if (!list.length) return 'Sin horario cargado';
  if (isAlwaysOpenGrid(list)) return 'Abierto las 24 horas, todos los días';
  return `${list.length} ${list.length === 1 ? 'tramo cargado' : 'tramos cargados'}`;
}
