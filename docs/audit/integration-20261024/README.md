# Integración final La Taba — 2026-10-24

Rama: `integration/taba-unified-20261024`
Commits de integración: `747f9999` (UX hasta `c8f05a95`, v164) y `bfd64265` (UX hasta `46e5ff2f`, v165).
Cierre final: ver [§ Cierre final](#cierre-final--v165-y-pwa-webkit) al pie.
Base: `eade6022` (punta del PR #151, que ya contiene #148, #149 y #150).
No hay merge a `main` y no se modificó producción ni Supabase QA.

## Qué se integró

| Origen | Punta | Qué aporta |
| --- | --- | --- |
| PR #148 → #149 → #150 → #151 | `eade6022` | Núcleo financiero, QA, correcciones de Mercado Pago, preparación comercial y vinculación segura de comercios. |
| `feature/catalog-pricing-images-20261024` | `ec4962e1` | Propuesta de precios Neuquén, auditoría de imágenes y vitrina con fotos reales. |
| `feature/ux-premium-storefront-20261024` | `46e5ff2f` | Capa UX premium (`ba07f995`, `875b440d`, `dda4e943`), corrección del banner Andes Origen y el spec de la vidriera en WebKit (`d2aaeba1`, `c8f05a95`). |

La rama UX ya contenía, como ancestro, la rama de catálogo. Por eso se hizo **un merge**
de `feature/ux-premium-storefront-20261024` sobre `eade6022`: se preservan los commits
originales y su antecedente, sin cherry-picks ni squash. No se volvieron a aplicar
#148, #149 ni #150.

## Conflictos resueltos

Solo hubo tres archivos en conflicto. Ninguno toca lógica financiera, OAuth, webhooks,
reservas ni reembolsos.

| Archivo | Resolución | Por qué |
| --- | --- | --- |
| `sw.js` | Se conserva el grafo de precache de UX (`styles.css?v=82`, `js/app.js?v=54`, `styles/ux-premium.css`, `js/vitrina-neuquen-20261024.js`) y se renombra `CACHE_NAME` a `la-taba-runtime-v164-unified-commercial`. | Las dos ramas habían reclamado identidades distintas (v162 para Mercado Pago, v163 para UX). Reutilizar cualquiera deja dos artefactos distintos bajo la misma identidad: se rompe el rollback y la certificación. v164 es una identidad nueva y única. |
| `scripts/preflight-staging-package.mjs` | `app: '?v=54'`, `css: '?v=82'`, `recovery: '?v=3'`, `cache: 'la-taba-runtime-v164-unified-commercial'`. | Espeja exactamente lo que sirven `index.html` y `sw.js`; un token distinto parte el precache. |
| `release-identity.json` | Regenerado con `node scripts/check-release-identity.mjs --write`. | La firma se deriva del contenido real del worker y de todos sus precaches, no se elige a mano. Resultado: 218 archivos, digest `a22c0d1716c293e4170af8e37a444d3f4cf8e7db56df52c41aa0d0d9165b1204`. |

Además se corrigió un defecto de higiene que ya venía en la rama UX:
`artifacts/ux-premium-20261024/tools/e2e-shard.sh` fijaba una ruta absoluta de un
disco local para el temporal. Ahora usa `TABA_UX_TMP` o un temporal del sistema, para
que el artefacto publicado no
dependa de una máquina concreta. Sin este cambio, `npm run check` fallaba por
`local-drive-path`.

## Service worker, caché y firma

- Identidad de runtime: `la-taba-runtime-v165-unified-ux-final` (v164 quedó superada por `bfd64265`).
- Precache: 218 archivos; el grafo estático del cliente (126 módulos) y el diferido del
  Panel (64) están completos.
- `sw.js`, `index.html` y `preflight-staging-package.mjs` coinciden en `?v=54` (app),
  `?v=82` (CSS), `?v=4` (actualización PWA) y `?v=3` (recuperación).
- `npm run check` verifica sintaxis, assets estáticos, grafo de precache, higiene,
  identidad firmada, contrato de ubicación, encoding SQL y secretos: **PASS**.
- Los tests de service worker, PWA, actualización y recuperación degradada pasan en
  Chromium y WebKit.

## Validaciones ejecutadas

| Validación | Resultado | Evidencia |
| --- | --- | --- |
| `npm test` | **3196 passed, 0 failed, 0 skipped** (8m 38s) | `artifacts/integration-20261024/npm-test.log` |
| `npm run check` | **PASS** | `artifacts/integration-20261024/npm-check.log` |
| Imágenes y catálogo (suite dirigida) | **159 passed, 0 failed** | `artifacts/integration-20261024/tests-imagenes-catalogo.log` |
| Carrito y checkout (suite dirigida) | **105 passed, 0 failed** | `artifacts/integration-20261024/tests-carrito-checkout.log` |
| Financiero, Mercado Pago y OAuth (suite dirigida) | **279 passed, 0 failed** | `artifacts/integration-20261024/tests-financiero-oauth.log` |
| Service worker y PWA (suite dirigida) | **130 passed, 0 failed** | `artifacts/integration-20261024/tests-pwa-sw.log` |
| E2E Chromium completo (4 shards) | **593 passed, 6 skipped, 0 failed** | `artifacts/integration-20261024/e2e-chromium-shard-1..4.log` |
| E2E WebKit completo (2 shards, 243 casos) | **242 passed, 1 skipped, 0 failed** | `artifacts/integration-20261024/e2e-webkit-shard-1..2.log` |
| `npm run catalog:images:verify` | 22 productos y 44 WebP demo; 114 imágenes con fuente, derechos y SHA-256 | `artifacts/integration-20261024/catalog-images-verify.log` |
| `npm run catalog:images:audit:check` | Auditoría al día: 33 SKU visibles | `artifacts/integration-20261024/catalog-images-audit-check.log` |
| `npm run catalog:prices:check` | Planilla al día: 9 unidades bloqueadas por precio unitario | `artifacts/integration-20261024/catalog-prices-check.log` |
| Integridad de la vitrina (script ad hoc) | 52 SKU; 42 con foto; 0 archivos faltantes; 0 hash distinto; 0 derechos fuera de `LICENCIA_COMERCIAL` | salida en la sesión de integración |

El E2E se ejecutó por shards para acotar memoria y reciclar el proceso del navegador.
Los seis casos salteados de Chromium y el de WebKit son omisiones declaradas por los
propios specs (por ejemplo, gesto táctil nativo fuera de Chromium), no fallas.

## Verificación visual

Se recorrieron las dos superficies en móvil (390×844) y escritorio (1280×800):

- Modo demo aprobado: home, góndola, ficha, carrito, checkout e historias.
- Vitrina Neuquén: home, góndola con fotos reales, ficha, carrito y checkout.

Capturas: 26/26 generadas en `artifacts/ux-premium-20261024/capturas/integracion-20261024-v164/`.
Se versionaron 15 piezas representativas en
`artifacts/integration-20261024/capturas/` (WebP, sin rutas locales).

Verificado visualmente:

- El diseño UX premium se mantiene: encabezado, chips, tarjetas, historias a pantalla
  completa, carrito y checkout con total siempre a mano.
- La vitrina Neuquén conserva las fotografías autorizadas. Los SKU sin foto aprobada
  muestran el placeholder honesto, no una imagen inventada.
- El banner de Andes Origen usa la foto de producto autorizada
  (`TABA-AUT-2026-08-001`), no la tarjeta de receta que traía la pieza anterior.
- No hay desborde horizontal en 320, 360, 390, 412 y 432 px; los tests responsive de
  móvil y escritorio pasan en ambos motores.

## Precios y catálogo

- La vitrina usa los **precios vigentes** de `catalog/gondola-neuquen.mjs`.
- `PROPUESTA-PRECIOS-NEUQUEN-20261024.md` sigue en
  `pendiente_aprobacion_comercial`; sus precios **no** se publicaron ni se mezclaron
  con la góndola. La vitrina solo se activa con
  `?demo=1&vitrina=neuquen20261024` y el modo demo no se habilita en producción.
- No se agregó ningún catálogo ficticio al comercio real.

## Cómo probarlo en localhost

```bash
npm ci
node scripts/realtime-relay.mjs 8232
```

Luego abrir:

- Tienda demo unificada: `http://127.0.0.1:8232/?demo=1`
- Vitrina Neuquén con fotos reales:
  `http://127.0.0.1:8232/?demo=1&vitrina=neuquen20261024`
- Comparación sin fotos:
  `http://127.0.0.1:8232/?demo=1&vitrina=neuquen20261024&fotos=antes`

El relay sirve el worktree de integración; `release-identity.json` debe responder
`la-taba-runtime-v165-unified-ux-final`.

## Pendientes y observaciones

1. **PR apilado.** Este PR se abre contra `feature/mp-commercial-onboarding-20261024`
   (#151) para que el diff revisable sea solo el de catálogo + UX. Cuando #151 se
   integre, hay que reapuntar la base antes de mergear; no se mergea `main` desde acá.
2. **`catalog:release:validate` no corre sin el catálogo real.** Falla con
   `Falta el catálogo real. Indicá TABA_CATALOG_FILE…`. Es una dependencia de entorno
   preexistente, no una regresión: el resto de los gates de catálogo sí pasan.
3. **WebKit y el cierre del worker.** Una corrida WebKit no shardeada de 25 casos
   terminó con todos los tests en verde pero el worker no salió en 300 s y Playwright
   lo mató (`worker-0 process did not exit within 300000ms after stop`). Es el
   comportamiento de WebKit en Windows que el propio `playwright.config.mjs` documenta.
   Con shards (la forma en que se validó el gate completo) las dos mitades cerraron
   limpias: 125 y 117 casos.
4. **Medición de 44 px en WebKit.** Una vez, dentro de una corrida larga, el botón
   «Agregar» midió `43.999969` px contra un mínimo de 44. El CSS declara `height: 44px`.
   El caso pasó 3/3 aislado y en las dos mitades del gate. Es una diferencia de
   redondeo de motor, no un cambio de layout; no se tocó la prueba.
5. **Placeholders en modo demo.** Varios productos del catálogo demo no tienen foto
   aprobada y muestran el placeholder «Imagen pendiente». Es el comportamiento previo
   y honesto del modo demo; la vitrina con derechos verificados es la que muestra las
   42 fotos reales.
6. **Artefactos de test.** Las corridas E2E reescriben PNGs versionados bajo
   `artifacts/taba2-*`; se restauraron y no forman parte del commit. Quedan carpetas
   untracked de evidencia de test que no se versionan.

## Cierre final — v165 y PWA WebKit

### Qué se agregó sobre `ed227273`

| Commit | Qué |
| --- | --- |
| `bfd64265` | Merge de los commits finales de UX (`e2d93455`, `923c8893`, `46e5ff2f`): combos sin renglones huérfanos en escritorio, `e2e-shard.sh` sin ruta fija, informe final. Conflictos en `release-identity.json` (re-firmado) y `e2e-shard.sh` (se conservan el temporal portable y los puertos propios). Identidad nueva `la-taba-runtime-v165-unified-ux-final`, 218 archivos, digest `3451c0de…`. |
| `fe8a6dbe` | `scripts/qa-final-pwa-update.mjs`: el modo sin conexión cierra el listener del origen en vez de resetear sockets a mitad de pedido. |

Respecto de #151 (`eade6022`), la integración **no cambia ninguna línea** de `supabase/`, `js/business/`, `js/core/`, `catalog/`, `data/`, `scripts/production/` ni `deploy/`: pagos, stock, reservas, reembolsos, OAuth y precios quedan exactamente como en #151.

### Fallo de «Native PWA update» en WebKit (run 40140930475)

No era intermitente al azar ni defecto del producto. Diagnóstico en el mismo runner de Linux, con matriz de 36 jobs
y `DEBUG=pw:browser`; detalle en `artifacts/integration-20261024/final/pwa-webkit-diagnostico/RESUMEN.md`:

- 31 ms después del primer `res.destroy()` (la forma en que el arnés simulaba «sin red») el proceso de red de WebKitGTK
  falla aserciones de libsoup/GObject; desde ahí toda carga muere en `internallyFailedLoadTimerFired` («WebKit
  encountered an internal error») y la CacheStorage efímera de ese proceso se lee vacía.
- `context.setOffline(true)` no sirve: con la caché v165 completa y el worker controlando, WebKit falla la navegación
  sin consultar al worker (4/4).
- La app no usa CacheStorage; el worker sólo borra cachés con otro nombre.

Corrección: sin conexión = origen cerrado (toda conexión rechazada). Las aserciones no cambiaron. Resultado en CI:
**16/16 verdes** con el método nuevo contra **2/8 rojos** del control con el método viejo (3/12 sumando corridas).

### Validaciones sobre la candidata final

| Validación | Resultado | Evidencia |
| --- | --- | --- |
| `npm run check` | PASS (v165, 218 archivos, precache 126 + 64) | `artifacts/integration-20261024/final/npm-check.log` |
| `npm test` | **3196 passed, 0 failed, 0 skipped** | `artifacts/integration-20261024/final/npm-test.log` |
| Financiero / Mercado Pago / OAuth | **279 passed** | `artifacts/integration-20261024/final/tests-financiero-oauth.log` |
| Protocolo de release de Edge (`test:release`) | **92 passed** | `artifacts/integration-20261024/final/test-release.log` |
| Imágenes y catálogo | **455 passed** | `artifacts/integration-20261024/final/tests-imagenes-catalogo.log` |
| Carrito y checkout | **109 passed** | `artifacts/integration-20261024/final/tests-carrito-checkout.log` |
| Service worker y PWA | **130 passed** | `artifacts/integration-20261024/final/tests-pwa-sw.log` |
| Gates de catálogo | 114 imágenes con derechos y SHA-256; 33 SKU visibles; planilla de precios al día | `artifacts/integration-20261024/final/catalog-*.log` |
| Vitrina | 52 SKU, **42 con foto**, 0 faltantes, 0 hash distinto, 42 `LICENCIA_COMERCIAL`; precios = `GONDOLA` 52/52 | script de verificación |
| E2E local del delta, Chromium | **71 passed, 1 skipped (declarado)** | `artifacts/integration-20261024/final/e2e-chromium-delta.log` |
| E2E local del delta, WebKit móvil + recovery | **64 passed** | `artifacts/integration-20261024/final/e2e-webkit-delta.log` |
| Actualización PWA v153 → v165 + recarga sin red, WebKit Windows | PASS | local |
| Ídem, WebKit Linux (CI) | **16/16** | runs 40146680494 |
| E2E completo Chromium + WebKit | en CI del PR (job «Web, backend, fiscal and security gates») | ver PR #152 |

Capturas finales (WebP, móvil 390 y escritorio 1280): `artifacts/integration-20261024/final/capturas/`, 26/26
generadas; incluye `pwa-webkit-linux-offline-v165.webp`, la tienda servida sin red desde la caché v165 en CI.

### Pendientes

1. El job Web de CI venía tardando 72–84 min con límite de 90: riesgo de timeout que no depende de esta integración.
2. Modo demo con placeholders «Imagen pendiente» en productos sin foto aprobada (comportamiento previo y honesto).
3. `catalog:release:validate` requiere el catálogo real (`TABA_CATALOG_FILE`).
4. Comercial: la propuesta de precios sigue `pendiente_aprobacion_comercial`; Walter debe vincular Mercado Pago en
   producción (exige `REVIEW_STATUS=approved`); no hay proyecto de producción creado.
