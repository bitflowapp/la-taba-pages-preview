const CACHE_PREFIX = 'la-taba-runtime-';
const CACHE_NAME = 'la-taba-runtime-v92-el-panel-abre-sin-red-y-la-bandeja-no-se-rearma';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=56',
  './styles/tokens.css?v=56',
  './styles/common.css?v=56',
  './styles/storefront.css?v=56',
  './styles/catalog.css?v=56',
  './styles/checkout.css?v=56',
  './styles/profile.css?v=56',
  './styles/showcase.css?v=56',
  './styles/tracking.css?v=56',
  './styles/business.css?v=56',
  './styles/rider.css?v=56',
  './styles/responsive.css?v=56',
  './styles/brand-home.css?v=56',
  // `styles.css` la importa desde que existe y nunca estuvo acá: sin red, la
  // home se quedaba sin la capa de movimiento. Lo destapó el guard de la
  // cadena de CSS versionado; no lo introdujo esta integración.
  './styles/motion.css?v=56',
  './manifest.webmanifest',
  './runtime-config.js',
  './pago/resultado/index.html',
  './pago/pendiente/index.html',
  './pago/error/index.html',
  './assets/icon.svg',
  './assets/brand/taba2-emblem.svg',
  /*
   * El icono de la app entra al precache porque la INTERFAZ lo pinta: la hoja
   * de instalación y la tarjeta del Perfil lo muestran a 60 y 44 px. Los otros
   * cinco archivos del juego (512, maskables y el de Apple) no están acá a
   * propósito: los pide el sistema operativo al instalar, no el documento, y
   * precachear lo que nadie va a leer desde la página es peso muerto en la
   * primera visita.
   */
  './assets/brand/taba-app-icon-192.png',
  './assets/products/beverage-placeholder.svg',
  './js/pwa-update.js?v=4',
  './js/startup-recovery.js?v=2',
  './js/app.js?v=48',
  './js/config.js',
  './js/core/address.js',
  './js/core/app-mode.js',
  './js/core/business-config-store.js',
  './js/core/commerce-availability-store.js',
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
  './js/core/haptics.js',
  './js/core/customer-profile.js',
  './js/core/delivery-code.js',
  './js/core/delivery-location.js',
  './js/core/address-capture.js',
  './js/core/delivery-location-draft.js',
  './js/core/delivery-proof.js',
  './js/core/domain.js',
  './js/core/geo-point.js',
  // El contrato de la clave de idempotencia: import estático de
  // `production-operations.js`, que sí está en esta lista.
  './js/core/idempotency-key.js',
  './js/core/loyalty.js',
  './js/core/order-status.js',
  './js/core/order-timeline.js',
  './js/core/order-workflow.js',
  './js/core/catalog-search.js',
  './js/core/merchandising-tags.js',
  './js/core/pricing.js',
  './js/core/product-presentation.js',
  // `state.js` la importa de forma estática: sin ella acá, un cliente con la
  // PWA instalada y sin red no puede ni arrancar la tienda.
  './js/core/production-cart-storage.js',
  './js/core/promotions.js',
  './js/core/pwa-install.js',
  './js/pwa-install-ui.js',
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
  /*
   * Faltaba, y no era una omisión menor: es el catálogo comercial entero
   * (115 KB) y entra al arranque por una cadena de re-exports —`data.js` es una
   * sola línea `export … from`—, que es justo la forma que el guard del grafo no
   * miraba. Con la caché caliente y el borde contestando 503 a los módulos, la
   * tienda NO ARRANCA: el módulo se pide por red, la red contesta mal, no hay
   * copia guardada y el grafo se cae entero. Medido con el worker activo.
   */
  './js/taba2-commercial-pending-data.js',
  './js/state.js',
  './js/cart.js',
  './js/address-capture-controller.js',
  './js/customer-address-sheet.js',
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
  './js/core/browser-resume.js',
  './js/core/business-order-intake.js',
  './js/core/combos.js',
  './js/core/customer-delivery-address-hydration.js',
  './js/core/profile-checkout.js',
  './js/core/purchasable-destination.js',
  './js/core/retail-packaging.js',
  './js/core/sandbox-tracking-presentation.js',
  './js/payments/mercadopago-checkout.js',
  './js/payments/mercadopago-return.js',
  './js/repositories/sandbox_customer_profile_repository.js',
  './js/repositories/sandbox_order_repository.js',
  './js/tracking/customer_tracking_poll.js',
  /*
   * EL PANEL DEL NEGOCIO TAMBIÉN TIENE QUE PODER ABRIR SIN RED.
   * =========================================================================
   * `production-operations.js` estaba en esta lista desde hace tiempo, pero
   * llega por import DINÁMICO y sus imports ESTÁTICOS no estaban. Sin red eso
   * no degrada: un import estático que no está en la caché rompe el grafo
   * entero y el Panel NO ABRE. El comercio se queda sin la herramienta con la
   * que trabaja justo en el momento en que peor está la señal.
   *
   * Son 35 módulos y 393 KB. El guard del grafo lo venía avisando sin cortar;
   * ahora corta (`scripts/check-precache-graph.mjs`), así que un módulo nuevo
   * del Panel sin su entrada acá no llega a publicarse.
   *
   * QUÉ SIGNIFICA «SIRVE SIN RED» ACÁ, Y QUÉ NO
   * -------------------------------------------
   * Esto hace que el Panel ABRA y muestre lo que ya sabía: el estado de la
   * conexión, la cola de comandos pendientes —que es durable, vive en
   * IndexedDB— y los pedidos que la pestaña ya tenía en memoria. NO convierte
   * la aplicación en offline-first: recargando sin red la bandeja arranca
   * vacía porque los pedidos nunca se guardaron localmente, y eso está bien
   * —inventar una copia local de la bandeja es inventar autoridad—.
   *
   * Todo lo que necesita que el servidor decida sigue siendo fail-close: se
   * encola con su clave de idempotencia y su revisión esperada, y no se da por
   * hecho hasta que el servidor lo confirma.
   */
  './js/business/business-access-inbox.js',
  './js/business/business-access-registration.js',
  './js/business/business-capabilities.js',
  './js/business/business-command-outbox.js',
  './js/business/business-connectivity.js',
  './js/business/business-day-control.js',
  './js/business/business-device-check.js',
  './js/business/business-fiscal-assistant.js',
  './js/business/business-operation-language.js',
  './js/business/business-operations-center.js',
  './js/business/business-operations-config.js',
  './js/business/business-packing-verification.js',
  './js/business/business-panel-controller.js',
  './js/business/business-panel-render.js',
  './js/business/business-payments-console.js',
  './js/business/business-product-onboarding.js',
  './js/business/business-tray-patch.js',
  './js/business/business-view-model.js',
  './js/catalog/barcode-normalizer.js',
  './js/catalog/barcode-scanner-service.js',
  './js/core/fiscal-domain.js',
  './js/payments/payment-recovery.js',
  './js/platform/browser-business-platform.js',
  './js/platform/business-platform-adapter.js',
  './js/platform/indexeddb-command-storage.js',
  './js/platform/tauri-business-platform.js',
  './js/pos/fiscal-status-presenter.js',
  './js/repositories/supabase-business-repository.js',
  './js/repositories/supabase-fiscal-repository.js',
  './js/repositories/supabase-inventory-repository.js',
  './js/repositories/supabase-operations-repository.js',
  './js/repositories/supabase-packing-repository.js',
  './js/repositories/supabase-payments-repository.js',
  './js/repositories/supabase-pos-repository.js',
  './js/tracking/production_rider_gps.js',
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
 * `styles.css` y como cada uno de los módulos del arranque. A partir de ahí la defensa de
 * lectura —la que cerró el P1 del retorno desde Mercado Pago— ya no defiende
 * nada: la copia buena que iba a rescatar al documento ES la página del portal.
 *
 * La atomicidad sí es necesaria para un upgrade: activar un worker con algunos
 * módulos nuevos y rescatar el resto desde la caché anterior produce una app
 * que nunca existió. Por eso primero se validan todas las respuestas fuera de
 * CacheStorage y sólo después se escribe el lote. Si falta una, install falla y
 * el worker anterior continúa controlando con su caché intacta.
 *
 * `reload` se conserva: la instalación de un worker nuevo puede ejecutarse
 * mientras el anterior todavía controla la pestaña, y sin eso “Actualizar ahora”
 * precachearía módulos viejos desde la caché HTTP.
 */
async function precargar() {
  const staged = await Promise.all(ASSETS.map(async (asset) => {
    const request = new Request(asset, { cache: 'reload' });
    const response = await fetch(request);
    // `destination` de un Request construido a mano SIEMPRE viene vacío, así
    // que el tipo que se exige sale de la extensión: es lo único que hace que
    // el control valga también acá.
    const destination = destinoEsperado(asset);
    if (!isUsable({ destination }, response)) throw new Error(`precache_unusable:${asset}`);
    // En la ESCRITURA se mira el cuerpo de hojas Y módulos, siempre: es una
    // sola vez por publicación y es el momento en que un borde mentiroso
    // envenena la caché para todas las visitas que vengan después.
    if ((destination === 'style' || destination === 'script') && await pareceDocumentoHtml(response)) {
      throw new Error(`precache_html:${asset}`);
    }
    return [request, response];
  }));

  // Ningún byte se escribe hasta que TODOS los assets pasaron. Con un nombre
  // nuevo por publicación esto deja al worker anterior activo y su caché intacta
  // si el borde está incompleto, en vez de activar una mezcla de módulos.
  await caches.delete(CACHE_NAME);
  const cache = await caches.open(CACHE_NAME);
  try {
    for (const [request, response] of staged) await cache.put(request, response);
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(limpiarCachesViejas().then(() => self.clients.claim()));
});

/*
 * Un install normal sólo llega hasta activate con todas las entradas. La
 * comprobación exacta queda como segunda defensa: contar claves era incorrecto,
 * porque una imagen dinámica podía compensar un módulo ausente. Si por una
 * implementación anómala llegara incompleto, no se borra ninguna caché vieja.
 */
async function limpiarCachesViejas() {
  const cache = await caches.open(CACHE_NAME);
  const presentes = new Set((await cache.keys()).map((request) => request.url));
  const completa = ASSETS.every((asset) => presentes.has(new URL(asset, self.location).href));
  const viejas = (await caches.keys())
    .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
  const aBorrar = completa ? viejas : [];
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

  if (esArteDeProducto(url)) {
    event.respondWith(cachePrimero(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

/*
 * El arte de producto es INMUTABLE: el nombre del archivo lleva la huella de su
 * contenido, así que una ruta dada devuelve siempre los mismos bytes. Cambiar el
 * dibujo cambia la ruta.
 *
 * Por eso no entra al precache —treinta y un archivos más en un `addAll`, que es
 * todo-o-nada, es riesgo de instalación a cambio de nada— y sí sale de la caché
 * primero: la góndola vuelve a dibujarse al instante en la segunda visita y no
 * gasta datos del teléfono repitiendo imágenes que no pueden haber cambiado.
 */
function esArteDeProducto(url) {
  return url.pathname.includes('/assets/products/');
}

async function cachePrimero(request) {
  const guardada = await cachedFallback(request);
  if (guardada) return guardada;
  try {
    const response = await fetch(request);
    if (isUsable(request, response)) guardar(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

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
 * (`?v=56`), así que una copia guardada es el MISMO contenido que iba a traer la
 * red, no una versión vieja.
 */
const PLAZO_DE_RED_MS = 4000;

/*
 * El plazo solo no alcanza, y esto se midió con el worker activo.
 *
 * El navegador abre unas seis conexiones por origen. Con el borde colgado, los
 * ~120 subrecursos de la tienda no esperan cuatro segundos en paralelo: esperan
 * cuatro segundos DE A SEIS. Veinte rondas, más de un minuto de pantalla vacía
 * para algo que estaba entero en la caché, y muy por encima de los ocho
 * segundos tras los cuales `startup-recovery.js` da el arranque por perdido.
 *
 * Después de tres plazos vencidos se deja de molestar a la red por unos
 * segundos y se sirve directo lo guardado. Como los primeros pedidos vencen
 * todos juntos —van en paralelo—, el corte se abre a los ~4 s y el resto de la
 * pantalla llega de la caché sin esperar. La primera respuesta que llega lo
 * cierra. Nunca se responde peor: sin copia guardada se va a la red igual.
 */
const PLAZOS_PARA_CORTAR = 3;
const CORTE_MS = 10_000;
let plazosSeguidos = 0;
let cortadoHasta = 0;

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
async function networkFirst(request) {
  if (Date.now() < cortadoHasta) {
    const guardada = await cachedFallback(request);
    if (guardada) return guardada;
  }

  const red = fetch(request).then(
    (response) => ({ response }),
    (error) => ({ error }),
  );

  const aTiempo = await conPlazo(red, PLAZO_DE_RED_MS);
  if (aTiempo) {
    plazosSeguidos = 0;
    cortadoHasta = 0;
  } else {
    plazosSeguidos += 1;
    if (plazosSeguidos >= PLAZOS_PARA_CORTAR) cortadoHasta = Date.now() + CORTE_MS;
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
  if (isUsable(request, response) && !(await elCuerpoDesmienteAlTipo(request, response))) {
    guardar(request, response.clone());
    return response;
  }
  return (await cachedFallback(request)) || response;
}

async function cachedFallback(request) {
  const cached = await caches.match(request);
  /*
   * Una copia guardada tampoco se cree por estar guardada. Hasta esta versión
   * `install` aceptaba cualquier 200, así que cualquier cliente que instaló la
   * PWA sobre un borde que contesta HTML a todo tiene esa página metida en la
   * caché. Aunque las publicaciones nuevas rotan el nombre, revisar al leer
   * sigue protegiendo clientes que aún están controlados por un worker previo.
   *
   * El tipo declarado alcanza para el caso realista —el borde contesta
   * `text/html`— así que el cuerpo sólo se mira para las hojas de estilo, que es
   * donde la mentira no avisa. Mirarlo para todo destino agregaría una lectura
   * por cada respaldo, incluidas las imágenes.
   */
  const desmentida = cached && request.destination === 'style' && await pareceDocumentoHtml(cached);
  if (cached && isUsable(request, cached) && !desmentida) return cached;
  if (request.mode === 'navigate') {
    const paymentReturn = await paymentReturnFallback(request);
    if (paymentReturn) return paymentReturn;
    return (await caches.match('./index.html')) || null;
  }
  return null;
}

async function paymentReturnFallback(request) {
  const state = paymentReturnState(request);
  return state ? (await caches.match(`./pago/${state}/index.html`)) || null : null;
}

function paymentReturnState(request) {
  try {
    return new URL(request.url).pathname.match(/\/pago\/(resultado|pendiente|error)\/?$/)?.[1] || '';
  } catch (_) {
    return '';
  }
}

function esAccionDeCuenta(request) {
  try {
    return /\/cuenta\/?$/.test(new URL(request.url).pathname);
  } catch (_) {
    return false;
  }
}

function guardar(request, respuesta) {
  // Mercado Pago vuelve con ids en la query. La página está precacheada por
  // ruta y no necesita retener una clave distinta por pago en CacheStorage.
  if (paymentReturnState(request)) return;
  // /cuenta/ llega con el hash del enlace del correo en la query. Guardarla
  // dejaría ese hash escrito en CacheStorage, que sobrevive a la pestaña.
  if (esAccionDeCuenta(request)) return;
  caches.open(CACHE_NAME).then((cache) => cache.put(request, respuesta)).catch(() => undefined);
}

async function guardarSiSirve(request, response) {
  if (!response || !isUsable(request, response)) return;
  if (await elCuerpoDesmienteAlTipo(request, response)) return;
  guardar(request, response.clone());
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
async function elCuerpoDesmienteAlTipo(request, response) {
  if (request.destination === 'style') return pareceDocumentoHtml(response);
  if (request.destination !== 'script') return false;
  /*
   * Para los módulos la inspección se hace SÓLO si hay algo mejor guardado.
   *
   * Sin copia en la caché, mirar el cuerpo no cambia nada —la respuesta se
   * entrega igual porque no hay con qué reemplazarla— y es puro costo. Y ese
   * costo se paga entero en la visita FRÍA, que es exactamente cuando la caché
   * está vacía: medido con el worker activo, inspeccionar siempre llevaba la
   * primera visita de 167 a 182 pedidos y de 1993 a 2576 KB transferidos.
   *
   * Con copia guardada —el cliente recurrente, que es quien tiene algo que
   * perder— sí se mira, y por una razón concreta: `startup-recovery.js` es un
   * script clásico, así que un borde que miente el tipo de los `.js` también lo
   * rompe A ÉL. Sin esto, ese cliente se queda con la tienda muerta y sin el
   * cartel que le daría una salida.
   */
  const guardada = await caches.match(request);
  if (!guardada) return false;
  return pareceDocumentoHtml(response);
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
