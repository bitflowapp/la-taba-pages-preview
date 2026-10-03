/*
 * EL INTERRUPTOR DE DINERO REAL (EDGE-03): la única definición de «se puede
 * crear un cobro» y de «puede moverse dinero real», escrita como función pura.
 *
 * LA DECISIÓN DEL DUEÑO (2026-10-02)
 * ---------------------------------
 * «Quiero una compuerta explícita y permanente. […] Sólo si TODAS son
 * verdaderas puede existir dinero real. REAL_MONEY_ENABLED debe venir de
 * secreto/configuración de backend. NO frontend. NO base pública. NO código
 * hardcodeado. Si falta: MONEY_MOVEMENT_POSSIBLE: NO».
 *
 * En `production` un cobro se crea sólo si se cumplen las tres cosas:
 *   1. la revisión productiva del proyecto está aprobada
 *      (MERCADOPAGO_PRODUCTION_REVIEW_STATUS = approved), como hasta ahora;
 *   2. el comercio tiene Mercado Pago encendido en producción, con su revisión,
 *      y su vendedor productivo conectado, como hasta ahora;
 *   3. el secreto de backend MERCADOPAGO_REAL_MONEY_ENABLED vale EXACTAMENTE
 *      `enabled`. Ausente, vacío, `true`, `ENABLED`, ` enabled` o cualquier otra
 *      cosa: cerrado. No se recorta ni se pasa a minúsculas, a propósito: la
 *      herramienta de release lo lee por la huella SHA-256 que devuelve la
 *      Management API, y sólo una comparación exacta dice lo mismo de los dos
 *      lados. Si una huella no es la de `enabled`, el valor no es `enabled`.
 *
 * En `test` no existe dinero real y el interruptor no se pide. Lo que impide
 * que una credencial de prueba cobre de verdad, o que una real entre en un
 * proyecto de prueba, no es este interruptor: es que el entorno declarado y el
 * de la credencial tienen que coincidir. El proyecto está atado a un solo
 * entorno (DEPLOYMENT_BINDINGS en seller-oauth.ts); el token tiene que traer
 * `live_mode` igual al entorno (tokenGrant) y la cuenta del vendedor tiene que
 * ser `test_user` sólo en test (sellerIdentity); la conexión y la
 * configuración del comercio se guardan por entorno y la autoridad del pago las
 * compara con el del proyecto; y el pago que vuelve tiene que ser del collector
 * configurado (y `live_mode` en producción) o va a revisión, sin pedido.
 *
 * ES PURA: no lee el entorno ni la base, no llama a nadie y no mira el reloj
 * (la hora la pasa quien llama). La usan, y por eso no se pueden separar:
 *   - assertPaymentCreationGate (seller-oauth.ts): la compuerta de la sesión de
 *     checkout (antes de reservar stock) y de la preferencia;
 *   - validatePaymentAuthority (seller-oauth.ts): el comercio y su vendedor;
 *   - assertPreparationEnvironment y createPreference (mercadopago.ts): justo
 *     antes del único POST que crea un cobro.
 *
 * LA PLATA QUE VUELVE NO PASA POR ACÁ. Reembolsos, cancelaciones de cobros que
 * ya existen, el webhook, el worker, la conciliación y la pantalla de estado no
 * consultan el interruptor: apagar el dinero real nunca puede dejar trabado el
 * reembolso de un cliente.
 *
 * La variable vieja MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION ya no abre
 * nada. Si está puesta es un error de configuración: lo informan
 * scripts/mercadopago/verificar-configuracion.mjs y la compuerta de release
 * REAL_MONEY_GATE, y sincronizar-worker-hmac.mjs se niega a correr.
 */

/** El secreto de backend que abre el dinero real. */
export const REAL_MONEY_SWITCH = 'MERCADOPAGO_REAL_MONEY_ENABLED';
/** El ÚNICO valor que lo abre, comparado tal cual. */
export const REAL_MONEY_SWITCH_OPEN_VALUE = 'enabled';
/** La variable vieja de la prueba de humo: ya no abre nada. */
export const LEGACY_SMOKE_CONFIRMATION = 'MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION';

export type RealMoneyEnvironment = 'test' | 'production';
type Row = Record<string, unknown> | null | undefined;

/** Lo que hace falta saber de un comercio para decir si puede cobrar. */
export type RealMoneyBusiness = {
  businessId: string;
  /** La aplicación de Mercado Pago del proyecto (`MERCADOPAGO_CLIENT_ID`). */
  applicationId: string;
  settings: Row;
  seller: Row;
  /** La hora, en milisegundos: la pasa quien llama. */
  nowMs: number;
};

export type RealMoneyGateInput = {
  /** MERCADOPAGO_ENVIRONMENT tal como lo tiene el proyecto. */
  environment?: string | null;
  /** MERCADOPAGO_PRODUCTION_REVIEW_STATUS tal como lo tiene el proyecto. */
  reviewStatus?: string | null;
  /** MERCADOPAGO_REAL_MONEY_ENABLED crudo: no se recorta ni se pasa a minúsculas. */
  realMoneySwitch?: string | null;
  /** La foto de autoridad de un comercio, si se la quiere evaluar también. */
  business?: RealMoneyBusiness | null;
};

export type RealMoneyGateState = {
  /** El entorno que leen las funciones (`providerEnvironment`), o null si no es uno válido. */
  environment: RealMoneyEnvironment | null;
  review_approved: boolean;
  real_money_switch: boolean;
  /** La parte del proyecto de la compuerta de creación: en test siempre, en producción con las dos llaves. */
  creation_allowed: boolean;
  /** El proyecto permite cobrar dinero real: producción con revisión y el interruptor en `enabled`. */
  real_money: boolean;
  /** Con una foto de comercio: Mercado Pago encendido para él en este entorno. Sin foto, null. */
  business_enabled: boolean | null;
  /** Con una foto de comercio: su vendedor conectado y vigente en este entorno. Sin foto, null. */
  seller_connected: boolean | null;
  /** Con una foto de comercio: ese comercio puede cobrar dinero real ahora. Sin foto, null. */
  money_movement_possible: boolean | null;
  /** Lo que falta, por nombre. Nunca un valor. */
  reasons: string[];
};

/**
 * Mercado Pago encendido para ese comercio en ese entorno. Es, negada, la
 * condición con la que validatePaymentAuthority responde PAYMENTS_NOT_ENABLED.
 */
export function businessPaymentsEnabled(settings: Row, businessId: string, environment: string): boolean {
  return Boolean(settings) && settings!.business_id === businessId && settings!.provider === 'mercadopago'
    && settings!.enabled === true && settings!.environment === environment
    && settings!.checkout_mode === 'checkout_pro' && settings!.currency === 'ARS'
    && settings!.reserve_stock === true
    && (environment !== 'production' || settings!.production_review_status === 'approved');
}

/**
 * El vendedor del comercio conectado, con su credencial vigente, sin un
 * refresh en curso y siendo el mismo collector y la misma aplicación que la
 * configuración. Es, negada, la condición con la que validatePaymentAuthority
 * responde SELLER_REAUTHORIZATION_REQUIRED.
 */
export function sellerConnected(
  seller: Row, settings: Row, businessId: string, environment: string, applicationId: string, nowMs: number,
): boolean {
  return Boolean(seller) && Boolean(settings) && seller!.business_id === businessId
    && seller!.environment === environment && seller!.status === 'connected'
    && Boolean(seller!.protected_tokens) && Boolean(seller!.seller_id) && Boolean(seller!.generation)
    && !seller!.refresh_owner && Date.parse(String(seller!.expires_at)) > nowMs
    && seller!.seller_id === settings!.collector_id
    && seller!.application_id === applicationId && settings!.application_id === applicationId;
}

/**
 * El estado de la compuerta, con sus razones. Pura: los valores crudos entran
 * por parámetro.
 *
 * El entorno y la revisión se leen como los lee `providerEnvironment()`
 * (recortados; el entorno, en minúsculas). El interruptor, NO: sólo la cadena
 * exacta `enabled` lo abre.
 */
export function realMoneyGateState(input: RealMoneyGateInput): RealMoneyGateState {
  const declared = String(input.environment ?? '').trim().toLowerCase();
  const environment: RealMoneyEnvironment | null = declared === 'test' || declared === 'production' ? declared : null;
  const review_approved = String(input.reviewStatus ?? '').trim() === 'approved';
  const real_money_switch = input.realMoneySwitch === REAL_MONEY_SWITCH_OPEN_VALUE;
  const reasons: string[] = [];
  if (environment === null) {
    reasons.push(declared ? 'MERCADOPAGO_ENVIRONMENT_INVALID' : 'MERCADOPAGO_ENVIRONMENT_MISSING');
  } else if (environment === 'test') {
    reasons.push('TEST_ENVIRONMENT');
  } else {
    if (!review_approved) reasons.push('PRODUCTION_REVIEW_NOT_APPROVED');
    if (!real_money_switch) {
      const absent = input.realMoneySwitch === undefined || input.realMoneySwitch === null || input.realMoneySwitch === '';
      reasons.push(absent ? 'REAL_MONEY_SWITCH_ABSENT' : 'REAL_MONEY_SWITCH_NOT_ENABLED');
    }
  }
  const creation_allowed = environment === 'test'
    || (environment === 'production' && review_approved && real_money_switch);
  const real_money = environment === 'production' && creation_allowed;

  let business_enabled: boolean | null = null;
  let seller_connected: boolean | null = null;
  let money_movement_possible: boolean | null = null;
  if (input.business) {
    const { businessId, applicationId, settings, seller, nowMs } = input.business;
    business_enabled = environment !== null && businessPaymentsEnabled(settings, businessId, environment);
    seller_connected = environment !== null
      && sellerConnected(seller, settings, businessId, environment, applicationId, nowMs);
    if (!business_enabled) reasons.push('BUSINESS_PAYMENTS_NOT_ENABLED');
    if (!seller_connected) reasons.push('SELLER_NOT_CONNECTED');
    money_movement_possible = real_money && business_enabled && seller_connected;
  }
  return {
    environment, review_approved, real_money_switch, creation_allowed, real_money,
    business_enabled, seller_connected, money_movement_possible, reasons,
  };
}
