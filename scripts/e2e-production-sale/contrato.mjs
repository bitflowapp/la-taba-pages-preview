/*
 * EL CONTRATO DE LA PRUEBA DE VENTA REAL.
 *
 * Todo lo que esta automatización tiene permitido tocar está acá y en ningún
 * otro lado. No se parametriza desde la línea de comandos a propósito: un
 * pedido de producción no es una variable de entorno.
 *
 * Si mañana hay que probar otro producto, se cambia acá, se lee el diff y se
 * vuelve a autorizar. Ese roce es la característica, no el defecto.
 */

export const PRODUCCION = Object.freeze({
  host: 'https://la-taba.pages.dev',
  supabaseRef: 'wwcpogltfgzgkrlilbcd',
  businessId: '00000000-0000-4000-8000-000000000001',
});

/** El único producto que esta versión puede comprar, y en qué condiciones. */
export const PRODUCTO_AUTORIZADO = Object.freeze({
  externalId: 'coca-cola-original-pet-1500ml',
  gtin: '7790895000430',
  nombreVisible: 'Coca-Cola Original',
  presentacionVisible: '1,5 L',
  precioEsperado: 4990,
  cantidad: 1,
  cantidadMaxima: 1,
});

/**
 * La dirección de entrega permitida. NO se inventa una nueva en cada corrida:
 * el harness verifica que la dirección elegida en el checkout sea ésta y falla
 * cerrado si difiere, para que una prueba no termine mandando un repartidor a
 * un domicilio que nadie revisó.
 *
 * Se declara por su calle y altura tal como las muestra el Customer. El punto
 * del mapa ya quedó confirmado en el perfil de la cuenta de prueba: esta
 * automatización no confirma ubicaciones nuevas.
 */
/*
 * Se lee del entorno EN CADA LLAMADA, no al importar el módulo: una constante
 * congelada al arranque hace que fijar la variable después no tenga efecto, y
 * eso es exactamente la clase de silencio que no se puede tener en la compuerta
 * que decide a qué domicilio va un repartidor.
 */
export function direccionPermitida(env = process.env) {
  return Object.freeze({
    descripcionEsperada: String(env.TABA2_E2E_DIRECCION_TEXTO || '').trim(),
  });
}

/** Medios de pago que esta automatización acepta. Mercado Pago queda afuera. */
export const PAGOS_PERMITIDOS = Object.freeze(['coordinate', 'cash']);
export const PAGOS_PROHIBIDOS = Object.freeze(['mercadopago', 'transfer', 'qr']);

/** Las cuatro llaves que tienen que estar juntas para crear un pedido real. */
export const AUTORIZACION = Object.freeze({
  variable: 'TABA2_PRODUCTION_SALE_E2E',
  valor: 'I_AUTHORIZE_ONE_REAL_PRODUCTION_ORDER',
  flags: Object.freeze(['production', 'create-real-order', 'confirmado-por-humano']),
});

export const RIDER = Object.freeze({
  serie: 'ZY32LHS6PS',
  paquete: 'com.lataba.rider',
  paquetesProhibidos: Object.freeze(['com.lataba.rider.staging', 'com.lataba.rider.review']),
  /*
   * Cuántas entregas puede llevar a la vez. La AUTORIDAD es el servidor
   * (`rider_max_active_orders()`, hoy 3) y el Panel, que deshabilita al
   * repartidor sin lugar. Este número está acá sólo para que el informe previo
   * pueda decir «lleva 1 de 3» sin invocar una función desde el runner de sólo
   * lectura, que —con razón— no acepta llamar funciones.
   */
  maximoDeEntregasActivas: 3,
});

export const RUTAS = Object.freeze({
  sesionCustomer: '.local/e2e-auth/customer.json',
  sesionBusiness: '.local/e2e-auth/business.json',
  lock: '.local/locks/production-sale-e2e.lock',
  evidencia: 'artifacts/production-sale-e2e',
});

/** Lo que jamás puede aparecer en un artefacto o en un log. */
export const PATRONES_SENSIBLES = Object.freeze([
  { nombre: 'pin', patron: /\b\d{4}\b/g, reemplazo: '[PIN-REDACTADO]' },
  { nombre: 'jwt', patron: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, reemplazo: '[TOKEN-REDACTADO]' },
  { nombre: 'clave-publicable', patron: /sb_publishable_[A-Za-z0-9_-]+/g, reemplazo: '[CLAVE-REDACTADA]' },
  { nombre: 'clave-secreta', patron: /sb_secret_[A-Za-z0-9_-]+/g, reemplazo: '[SECRETO-REDACTADO]' },
  { nombre: 'telefono', patron: /(?<!\d)(?:\+?54\s?)?(?:9\s?)?(?:11|2\d{2,3}|3\d{2,3})[\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/g, reemplazo: '[TELEFONO-REDACTADO]' },
]);
