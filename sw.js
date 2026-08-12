const CACHE_PREFIX = 'la-taba-runtime-';
const CACHE_NAME = 'la-taba-runtime-v61-cliente-comercial-mapa-permanente';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=49',
  './styles/tokens.css?v=49',
  './styles/common.css?v=49',
  './styles/storefront.css?v=49',
  './styles/catalog.css?v=49',
  './styles/checkout.css?v=49',
  './styles/profile.css?v=49',
  './styles/showcase.css?v=49',
  './styles/tracking.css?v=49',
  './styles/business.css?v=49',
  './styles/rider.css?v=49',
  './styles/responsive.css?v=49',
  './styles/brand-home.css?v=49',
  // `styles.css` la importa desde que existe y nunca estuvo acá: sin red, la
  // home se quedaba sin la capa de movimiento. Lo destapó el guard de la
  // cadena de CSS versionado; no lo introdujo esta integración.
  './styles/motion.css?v=49',
  './manifest.webmanifest',
  './runtime-config.js',
  './assets/icon.svg',
  './assets/products/beverage-placeholder.svg',
  './js/pwa-update.js?v=3',
  './js/startup-recovery.js?v=2',
  './js/app.js?v=41',
  './js/config.js',
  './js/core/address.js',
  './js/core/app-mode.js',
  './js/core/business-config-store.js',
  './js/core/business-location.js',
  './js/core/business-metrics.js',
  './js/core/business-ops.js',
  './js/core/business-reports.js',
  './js/core/business-setup.js',
  './js/core/cashbox-store.js',
  './js/core/catalog-store.js',
  './js/core/cart-recommendations.js',
  './js/core/customer-addresses.js',
  './js/core/customer-history.js',
  './js/core/customer-preferences.js',
  './js/core/customer-profile.js',
  './js/core/delivery-code.js',
  './js/core/delivery-location.js',
  './js/core/delivery-location-draft.js',
  './js/core/delivery-proof.js',
  './js/core/domain.js',
  './js/core/loyalty.js',
  './js/core/order-status.js',
  './js/core/order-timeline.js',
  './js/core/order-workflow.js',
  './js/core/pricing.js',
  // `state.js` la importa de forma estática: sin ella acá, un cliente con la
  // PWA instalada y sin red no puede ni arrancar la tienda.
  './js/core/production-cart-storage.js',
  './js/core/promotions.js',
  './js/core/pwa-install.js',
  './js/core/realtime-sync.js',
  './js/core/reorder.js',
  './js/core/rider.js',
  './js/core/runtime-config.js',
  './js/core/showcase-mode.js',
  './js/core/simulation.js',
  './js/core/storage.js',
  './js/core/storefront-filters.js',
  './js/core/stories.js',
  './js/core/validators.js',
  './js/sandbox/sandbox_map_scenario.js',
  './js/map/map_config.js',
  './js/map/maplibre_tracking_map.js',
  './js/map/location_picker_map.js',
  './js/map/map_view.js',
  './js/map/rider_marker.js',
  // El motor de movimiento visual también es import estático del mapa: sin él
  // en la caché, offline el rider se queda sin marcador.
  './js/map/rider_motion.js',
  './js/map/route_geometry.js',
  './js/map/tracking_status.js',
  // El tema nocturno es un import ESTÁTICO de maplibre_tracking_map.js. Sin él
  // acá, offline el importador no evalúa —`Response.error()`— y el cliente
  // pierde el mapa entero, no sólo el color.
  './js/map/taba_map_theme.js',
  './js/data.js',
  './js/beverage-demo-data.js',
  './js/approved-beverage-demo-data.js',
  './js/state.js',
  './js/cart.js',
  './js/customer-delivery.js',
  './js/customer-profile-view.js',
  './js/delivery-location-step.js',
  './js/orders.js',
  './js/repositories/demo_order_repository.js',
  './js/repositories/http_order_repository.js',
  './js/repositories/order_repository.js',
  './js/repositories/realtime_order_repository.js',
  './js/repositories/repository_factory.js',
  './js/repositories/storage_repository.js',
  './js/repositories/customer_profile_repository.js',
  './js/repositories/supabase_order_repository.js',
  './js/repositories/unavailable_order_repository.js',
  './js/services/supabase-auth.js',
  './js/services/supabase-client.js',
  './js/services/customer-geolocation.js',
  './js/vendor/supabase.js',
  './js/business.js',
  './js/delivery.js',
  './js/production-operations.js',
  './js/realtime.js',
  './js/simulation.js',
  './js/showcase-fixtures.js',
  './js/showcase.js',
  './js/ui.js',
  /*
   * Los diecisiete de abajo son imports ESTÁTICOS del grafo del cliente que
   * nunca habían entrado a esta lista. Sin red, el navegador no puede resolver
   * un import estático que no está en la caché y la aplicación no arranca: no
   * se degrada, no arranca. Que nadie lo notara sólo quiere decir que la
   * mayoría de las visitas tienen red.
   *
   * Los descubrió el guard nuevo (`scripts/check-precache-graph.mjs`), que
   * recorre el grafo desde las tres entradas y compara contra esta lista. La
   * lista se mantiene sola de ahora en más: si aparece un import estático
   * nuevo sin su entrada acá, `npm run check` corta.
   */
  './js/back-office.js',
  './js/motion.js',
  './js/combos-data.js',
  './js/preview-promotions-data.js',
  './js/preview-stories-data.js',
  './js/core/beverage-home-sections.js',
  './js/core/business-order-intake.js',
  './js/core/combos.js',
  './js/core/customer-delivery-address-hydration.js',
  './js/core/profile-checkout.js',
  './js/core/purchasable-destination.js',
  './js/core/retail-packaging.js',
  './js/core/sandbox-tracking-presentation.js',
  './js/payments/mercadopago-checkout.js',
  './js/repositories/sandbox_customer_profile_repository.js',
  './js/repositories/sandbox_order_repository.js',
  './js/tracking/customer_tracking_poll.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(precargar());
});

/*
 * Acá vivía la otra mitad del defecto, del lado de la ESCRITURA.
 *
 * `cache.addAll` guarda cualquier respuesta con estado 200 y NO mira el tipo. El
 * portal cautivo de un bar contesta 200 con SU página, así que un cliente que
 * abría la tienda por primera vez sobre esa red guardaba esa página como
 * `styles.css` y como cada uno de los 88 módulos. A partir de ahí la defensa de
 * lectura —la que cerró el P1 del retorno desde Mercado Pago— ya no defiende
 * nada: la copia buena que iba a rescatar al documento ES la página del portal.
 *
 * Y `addAll` es además TODO O NADA: un solo 404 de un despliegue a medio
 * publicar dejaba al cliente sin precache entero, o sea sin tienda offline.
 *
 * Se guarda de a uno y sólo lo que sirve, con el mismo contrato que usa `fetch`.
 * Lo que no bajó no se guarda y no tumba al resto: la primera visita sana
 * completa los huecos, porque `networkFirst` guarda todo lo que le llega bien.
 *
 * `reload` se conserva: la instalación de un worker nuevo puede ejecutarse
 * mientras el anterior todavía controla la pestaña, y sin eso “Actualizar ahora”
 * precachearía módulos viejos desde la caché HTTP.
 */
async function precargar() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(ASSETS.map(async (asset) => {
    const request = new Request(asset, { cache: 'reload' });
    try {
      const response = await fetch(request);
      // `destination` de un Request construido a mano SIEMPRE viene vacío, así
      // que el tipo que se exige sale de la extensión: es lo único que hace que
      // el control valga también acá.
      if (!(await sirve({ destination: destinoEsperado(asset), mode: 'no-cors' }, response))) return;
      await cache.put(request, response);
    } catch (_) {
      // Un asset que no bajó no puede llevarse puesto al precache entero.
    }
  }));
}

self.addEventListener('activate', (event) => {
  event.waitUntil(limpiarCachesViejas().then(() => self.clients.claim()));
});

/*
 * Borrar la caché anterior con el precache nuevo a medias deja al cliente PEOR
 * que antes de actualizar: pierde las 167 entradas buenas que tenía y se queda
 * con las pocas que pudo bajar. `caches.match` recorre todas las cachés del
 * origen, así que conservar la anterior alcanza para que el documento se siga
 * rescatando hasta que una visita sana complete la nueva.
 *
 * Con el precache completo se borran todas, como siempre. Incompleto se conserva
 * SÓLO la más reciente —`caches.keys()` viene en orden de creación—, para que
 * una publicación rota no vaya acumulando cachés versión tras versión.
 */
async function limpiarCachesViejas() {
  const cache = await caches.open(CACHE_NAME);
  const completa = (await cache.keys()).length >= ASSETS.length;
  const viejas = (await caches.keys())
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
  const aBorrar = completa ? viejas : viejas.slice(0, -1);
  await Promise.all(aBorrar.map((key) => caches.delete(key)));
}

// Permite forzar la activación inmediata de un SW nuevo desde la página.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

// Network-first: el contenido fresco gana, así una versión recién publicada se
// ve sin trucos de "borrar caché". El cache respalda dos casos, no uno: la red
// que no contesta y la red que contesta mal (ver `networkFirst`).
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(networkFirst(request));
});

/*
 * Acá vivía la mitad del problema: el respaldo estaba dentro de un `catch`, y un
 * `catch` sólo corre cuando la red RECHAZA.
 * Un borde que contesta 503, un despliegue a medio publicar que contesta 404 y
 * un portal cautivo que contesta 200 con su propio HTML son promesas
 * RESUELTAS: el worker las devolvía tal cual —una página de error donde el
 * documento esperaba una hoja de estilos— teniendo la copia buena en la caché,
 * al lado.
 *
 * Dónde se veía: al volver de Mercado Pago con el botón atrás. Medido en
 * WebKit, esa vuelta es `back_forward` con `persisted=false` —la página tiene
 * realtime abierto, así que no entra al back-forward cache—, o sea que el
 * documento se rearma entero y vuelve a pedir sus ~120 subrecursos de golpe,
 * justo en el instante en que el teléfono retoma la red desde otra aplicación.
 * `styles.css` volvía con el cuerpo del error: el `<link>` seguía en su lugar y
 * `link.sheet` existía, pero con CERO reglas y CERO `@import`. El HTML quedaba
 * entero y sin estilos —fondo blanco, iconos de 55 px, la barra inferior sin
 * fijar, 424 px de ancho sobre una pantalla de 390— con el carrito intacto
 * detrás. Ningún test lo veía porque el gate corre con `serviceWorkers: 'block'`.
 *
 * Cada rama nueva termina en `|| response`: cuando no hay nada mejor que
 * ofrecer, el cliente recibe exactamente lo que recibía antes. Esta función no
 * puede devolver algo peor que la versión que reemplaza.
 */
/*
 * Cuánto se espera a una red que ni contesta ni rechaza.
 *
 * Es el tercer estado, y el que no tenía salida: el `catch` cubre la red que
 * RECHAZA y el control de tipo cubre la que contesta MAL, pero una radio que
 * reengancha —justo lo que hace el teléfono al volver de Mercado Pago— deja el
 * `fetch` colgado sin error, y el documento esperaba para siempre teniendo la
 * copia buena al lado.
 *
 * Cuatro segundos: bien por debajo de los ocho que espera `startup-recovery.js`
 * antes de dar el arranque por perdido, y muy por encima de cualquier respuesta
 * sana. El costo de equivocarse es casi nulo: el precache está versionado
 * (`?v=49`), así que una copia guardada es el MISMO contenido que iba a traer la
 * red, no una versión vieja.
 */
const PLAZO_DE_RED_MS = 4000;

async function networkFirst(request) {
  const red = fetch(request).then(
    (response) => ({ response }),
    (error) => ({ error }),
  );

  const aTiempo = await conPlazo(red, PLAZO_DE_RED_MS);
  if (!aTiempo) {
    const guardada = await cachedFallback(request);
    if (guardada) {
      // La red sigue viva: cuando conteste, actualiza la caché para la próxima.
      red.then(({ response }) => guardarSiSirve(request, response)).catch(() => undefined);
      return guardada;
    }
    // Sin nada mejor que ofrecer, esperar es lo correcto. Cortar acá rompería
    // una carga lenta que iba a terminar bien.
  }

  const { response, error } = await red;
  if (error || !response) return (await cachedFallback(request)) || Response.error();
  if (await sirve(request, response)) {
    guardar(request, response.clone());
    return response;
  }
  return (await cachedFallback(request)) || response;
}

async function cachedFallback(request) {
  const cached = await caches.match(request);
  // Una copia guardada tampoco se cree por estar guardada. Hasta esta versión
  // `install` aceptaba cualquier 200, así que cualquier cliente que instaló la
  // PWA sobre una red con portal cautivo tiene esa página metida en la caché.
  // Como el nombre de la caché no cambia, ese envenenamiento se HEREDA: revisarlo
  // en la lectura es lo que lo desactiva sin obligar a nadie a bajar todo de nuevo.
  if (cached && (await sirve(request, cached))) return cached;
  if (request.mode === 'navigate') return (await caches.match('./index.html')) || null;
  return null;
}

function guardar(request, respuesta) {
  caches.open(CACHE_NAME).then((cache) => cache.put(request, respuesta)).catch(() => undefined);
}

async function guardarSiSirve(request, response) {
  if (response && await sirve(request, response)) guardar(request, response.clone());
}

function conPlazo(promesa, ms) {
  let temporizador;
  const vencimiento = new Promise((resolve) => { temporizador = setTimeout(() => resolve(null), ms); });
  return Promise.race([
    promesa.then((valor) => { clearTimeout(temporizador); return valor; }),
    vencimiento,
  ]);
}

function destinoEsperado(url) {
  const ruta = String(url).split('?')[0].toLowerCase();
  if (ruta.endsWith('.css')) return 'style';
  if (ruta.endsWith('.js') || ruta.endsWith('.mjs')) return 'script';
  return '';
}

/*
 * Un 200 no alcanza para decir que la respuesta sirve. El portal cautivo de una
 * red pública contesta 200 con SU página: el navegador la rechaza —«non CSS
 * MIME types are not allowed in strict mode»— y la hoja queda vacía. Y si se
 * cacheara, el cliente arrastraría esa página como hoja de estilos hasta la
 * próxima publicación. Por eso el tipo declarado tiene que coincidir con lo que
 * el documento pidió. Un navegador sin `request.destination` no pierde nada:
 * cae en el `return true` y se comporta como antes.
 */
function isUsable(request, response) {
  if (!response || !response.ok) return false;
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (request.destination === 'style') return type.includes('text/css');
  if (request.destination === 'script') return type.includes('javascript') || type.includes('ecmascript');
  return true;
}

/*
 * El tipo declarado más, para las hojas de estilo, el arranque del cuerpo.
 *
 * Hasta acá el worker contrastaba el tipo DECLARADO y nada más, y estaba escrito
 * como límite conocido: un borde que además MIENTE en el `content-type` pasaba.
 * Se cierra sólo para `style` y por una razón asimétrica, no por prolijidad:
 *
 *   - `styles.css` es una cadena de trece `@import`. Si llega HTML, el navegador
 *     no avisa a nadie: la hoja queda con cero reglas y la tienda se apaga
 *     entera. Es EXACTAMENTE la pantalla que reportó la persona.
 *   - Un módulo que llega como HTML falla fuerte, y ese fallo ya tiene salida:
 *     `startup-recovery.js` lo escucha en fase de captura y le da al cliente un
 *     botón. Leer el cuerpo de los ~90 módulos del grafo para cubrir un caso que
 *     ya está cubierto cuesta más de lo que evita.
 *
 * Sólo se lee el PRIMER trozo del cuerpo, sobre un clon, y se cancela enseguida:
 * no se buferea la respuesta ni se pierde el streaming. Cualquier tropiezo del
 * stream se resuelve a favor de la respuesta —ante la duda, el contrato viejo—.
 */
async function sirve(request, response) {
  if (!isUsable(request, response)) return false;
  if (request.destination !== 'style') return true;
  return !(await pareceDocumentoHtml(response));
}

async function pareceDocumentoHtml(response) {
  if (!response || !response.body) return false;
  try {
    const lector = response.clone().body.getReader();
    const { value } = await lector.read();
    lector.cancel().catch(() => undefined);
    if (!value || !value.byteLength) return false;
    const inicio = new TextDecoder('utf-8', { fatal: false })
      .decode(value.subarray(0, 96))
      .trimStart()
      .toLowerCase();
    // Un CSS de verdad puede empezar con comentarios, `@charset`, `@import` o
    // espacios. Ninguna de esas formas puede confundirse con un documento.
    return inicio.startsWith('<!doctype html') || inicio.startsWith('<html');
  } catch (_) {
    return false;
  }
}
