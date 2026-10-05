# PWA instalada: arranque, causa del `ERR_FAILED` y reparación

## Qué pasaba

La app instalada (WebAPK) de La Taba mostraba **`ERR_FAILED`** al lanzarla desde el
ícono. Medido en el Moto G15 con el service worker de producción (v97).

1. El manifiesto arrancaba en `./index.html` y Cloudflare Pages contesta
   `/index.html` con un **308 a `/`**.
2. `install` precacheaba `./index.html` con un `fetch` que sigue la redirección: la
   respuesta guardada trae `redirected === true`.
3. Una navegación pasa por `networkFirst`; la red devuelve la redirección sin
   seguirla (`opaqueredirect`, no `ok`) y el worker cae en `cachedFallback`, que
   entregaba esa copia.
4. **El navegador prohíbe responder una navegación con una respuesta `redirected`**:
   la trata como error de red.

El mismo respaldo (`caches.match('./index.html')`) servía a cualquier otra
navegación sin copia propia, así que **sin conexión la app tampoco abría**.

Sólo ocurre con el worker activo. El gate E2E corre con `serviceWorkers: 'block'`,
por eso nadie lo veía.

## Qué cambia (v141)

- `manifest.webmanifest`: `start_url: "./"` y `id: "./index.html"`. El `id` fija la
  identidad que ya tienen los teléfonos (el `start_url` implícito era
  `/index.html`); sin él Chrome vería otra aplicación y no actualizaría la
  instalada.
- `sw.js`
  - `/index.html` (navegación) se contesta con un 308 a la raíz, igual con red que
    sin red.
  - Nada marcado `redirected` se guarda en el precache ni se entrega a una
    navegación: se sanea al escribir **y** al leer (la copia que dejó v97 en la
    caché de un teléfono viejo también se sanea).
  - El respaldo de una navegación es la shell canónica `./`, no `./index.html`.
  - Una redirección del borde (`/cuenta` → `/cuenta/`) se entrega tal cual para que
    el navegador la siga.
- `scripts/realtime-relay.mjs` imita el 308 de Pages: el servidor de pruebas ya no
  es más indulgente que producción.

## Pruebas

| Capa | Archivo |
|---|---|
| Unitaria (worker simulado, regla del navegador incluida) | `tests/service-worker-navigation-redirect.test.mjs` |
| Chromium real con worker real | `tests/e2e/pwa-launch-redirect.spec.mjs` |
| Control negativo: el worker v97 de producción (bytes idénticos) falla | `tests/fixtures/sw-runtime-v97-production.js` |
| Ensayo en el teléfono | `tests/e2e-infra/pwa-rehearsal-server.mjs` |

El control negativo es deliberado: si Chrome dejara de fallar con v97, las pruebas
de migración dejarían de demostrar algo.

## Migración desde v97 (lo que vive una persona)

Medido en el Moto G15 (Chrome) con v97 → v141 sobre un origen HTTPS de ensayo:

1. Con v97 la app **falla** (`ERR_FAILED`).
2. La propia navegación fallida hace que el navegador busque `sw.js` y **instale** el
   worker nuevo. La instalación descarga 208 archivos: en una red lenta puede
   tardar decenas de segundos; contra el CDN de Pages son unos pocos.
3. Cuando **no queda ninguna pestaña ni ventana del sitio abierta**, el worker nuevo
   se activa solo.
4. El siguiente lanzamiento abre en `/`. Carrito y sesión intactos.

En el ensayo hicieron falta 9 lanzamientos en ~55 s porque el túnel de prueba
tardó ~36 s en instalar; la lógica no necesitó intervención.

### Si no se recupera

- **Hay otra pestaña de Chrome con La Taba abierta**: es cliente del worker viejo y
  mantiene al nuevo en espera. Cerrar esa pestaña, o usar «Actualizar ahora» en el
  aviso de actualización de esa misma pestaña.
- **Procedimiento seguro de reparación** (no borra nada del cliente): abrir
  `https://la-taba.pages.dev/` en Chrome → ⋮ → *Información del sitio* → no tocar
  «Borrar datos». Cerrar todas las ventanas de La Taba (también la instalada) y
  volver a abrirla desde el ícono. Sólo si después de unos minutos con buena red
  sigue fallando: desinstalar el ícono y volver a instalarlo desde Chrome (el
  carrito persiste en el almacenamiento del sitio mientras no se borren los datos).
- Para el equipo, sin tocar el teléfono: `adb forward` + DevTools del Chrome del
  teléfono, `ServiceWorker.unregister` del scope. No borrar `localStorage`.
