# La Taba — transformación comercial del catálogo (2026-10-24)

Rama `feature/taba-catalog-transformation-20261024`, base `bfd64265` (integración unificada local:
MP comercial #151 + vitrina Neuquén + UX premium). Sin merge a `main`, sin push a `integration/*`, sin
producción, sin tocar Mercado Pago, OAuth, webhooks, reembolsos, stock, pedidos reales, precios ni migraciones.

> **LISTO TÉCNICAMENTE: sí** — diseño, código y experiencia de compra comprobados en un Moto G15 físico y en
> las suites completas (resultados en §8).
> **LISTO COMERCIALMENTE: no.** Faltan aprobaciones del responsable del negocio (precios por SKU, stock, el
> documento del acuerdo de fotos, fotos de 10 SKU, autorización de la fotografía editorial) y la
> infraestructura de producción (§9). **Este informe no autoriza ningún lanzamiento.**

## 1. Dispositivo y método

| | |
|---|---|
| Teléfono | Motorola moto g15 (`lamu_g`), Android 15, Chrome 155.0.8059.84, 4 GB de RAM, 8 núcleos |
| Pantalla | 1080×2400 a 400 dpi → viewport CSS **432×960**; con la barra de Chrome visible, **432×815** |
| Cómo se midió | Chrome del teléfono por DevTools (`adb forward`), con eventos táctiles reales (`Input.dispatchTouchEvent`) y capturas reales con `adb screencap`. Red de la propia pestaña emulada por DevTools (no se toca la conectividad ni el plan de datos del teléfono). |
| Preview | `adb reverse` + servidores propios en 8261 (relay del repo) y 8262–8264 (estático comprimido, brotli, ETag, HTTP/2 con certificado propio: `tools/serve-compressed.mjs`) |
| Un solo escritor | Se avisó a las sesiones vivas; antes de cada recorrido se escucha el sensor táctil por si hay una persona usando el teléfono |

Límites declarados: el servidor HTTP/2 local imita a Cloudflare Pages (compresión, revalidación, h2) pero no es
Cloudflare; el catálogo productivo se simuló con el mismo arnés de las e2e (Supabase simulado), así que las
fotos de producto del camino productivo son de relleno; no se hicieron compras reales ni se tocó ninguna base.

## 2. Auditoría real: hallazgos por impacto comercial

| # | Hallazgo (medido en el Moto salvo que se diga) | Impacto | Estado |
|---|---|---|---|
| H1 | **Derechos.** Hero, banners e historias usan 19 fotografías de portfolios y sitios de terceros (otaphotography.com, behance.net, schweppes.it, passionspirits.com, kotyhu.com). El manifiesto acredita el origen, no un permiso, y la única autorización vigente (`TABA-AUT-2026-08-001`) dice expresamente que **no cubre** «material editorial, ambientación o piezas de campaña de terceros». | Alto (legal) | **Corregido**: en producción no se publican (§6) |
| H2 | El catálogo en teléfono muestra **2 productos por pantalla** (cabecera de 256 px + tarjeta de 334 px) | Alto (encontrar rápido) | **Corregido**: vista Lista (§4) |
| H3 | **Primera visita lenta** en el camino productivo: LCP 4,1 s en «4G rápido» y 7,8 s en «4G lento». 128 módulos JS descubiertos en cascada, y el 94 % de los bytes de imagen eran **dos banners a 1.300 y 2.400 px de scroll** (514 KB + 168 KB) | Alto | **Mitigado** (§5); la cascada de módulos queda como recomendación |
| H4 | Buscar dentro de un rubro acota la búsqueda sin decirlo: con «Cervezas» activa, «coca» daba «0 productos en Cervezas» y el chip «Todas» ni se veía | Medio | **Corregido** (§4) |
| H5 | Producto sin foto: placeholder genérico («Imagen pendiente» a 8 px sobre rectángulos anidados) | Medio | **Corregido** (§4) |
| H6 | Un solo combo ocupa 2/3 del ancho y deja un hueco oscuro | Bajo | **Corregido** |
| H7 | Accesibilidad (axe-core, 8 pantallas): 7 violaciones (`heading-order` ×5, `landmark-complementary-is-top-level` ×2) | Medio | **Corregido: 0** (§7) |
| H8 | El Service Worker se registraba al parsear y su precache (≈220 archivos) competía con la carga crítica de la primera visita | Medio | **Corregido** |
| L1 | El aviso «Modo demostración» cuelga sobre el contenido al desplazar (sólo en demo) | Bajo | Sin cambio: es diseño existente y sólo demo |
| L2 | El nombre del producto en la tarjeta es un enlace de 18–36 px de alto (la foto, de 150 px, abre lo mismo) | Bajo | Sin cambio; ya figura como C14 en la matriz GO/NO-GO |
| L3 | Los botones de campaña miden 28 px a la vista y 44 al dedo (pseudo-elemento) | — | Falso positivo de mi métrica: el CSS lo documenta |
| L4 | En demo, `?reset=1` no limpia la búsqueda: el estado vuelve desde IndexedDB `taba-sandbox` | Bajo (sólo demo) | Documentado; no afecta a clientes en producción (allí sólo se persiste el carrito) |

Confirmado **sin problema** en el Moto: sin desborde horizontal; el teclado no tapa el buscador (queda en y=86–130 con el
viewport visual en 493 px); la barra fija del total del checkout (y=609–681) no pisa la navegación (y=759); el stepper y el
carrito flotante son cómodos; las historias ocupan la pantalla entera; el total del checkout suma bien (subtotal $7.700 +
envío $1.990 = $9.690); la PWA se actualiza sola a la versión nueva (el teléfono mostró «Hay una actualización disponible»).

## 3. Qué cambió (commits)

| Commit | Qué |
|---|---|
| `perf(pwa)` | Registro del Service Worker después de `load` (y reposo) cuando el documento todavía carga |
| `feat(vidriera)` | Vista Cuadrícula/Lista, aviso de alcance de la búsqueda, placeholder propio, combo único, gate de derechos editoriales, correcciones de accesibilidad, pruebas |
| `feat(catálogo)` | Validador de preparación comercial de los 52 SKU y su informe |
| `chore(release)` + `fix(vidriera)` | Identidad `v166-catalog-transformation` (220 archivos precacheados) y, después, el ajuste del hero sin foto en tableta (con la identidad re-firmada) |
| `docs/tools` | Este informe, herramientas de medición en el Moto, capturas comparadas |

## 4. Diseño y experiencia de compra

Todo el CSS nuevo vive al final de `styles/ux-premium.css` (secciones 9–12); no se tocó el markup de las tarjetas.

- **Vista Lista** (`js/catalog-layout.js`): un botón dentro del buscador alterna entre Cuadrícula (foto grande, la vista de
  entrada: la foto vende) y Lista (foto de 88 px, nombre, presentación, precio y «Agregar» en un renglón de 110 px).
  **4 productos completos en la primera pantalla y 5–6 al desplazar, contra 2.** Sólo en teléfono (≤699 px), recuerda la
  elección por navegador y no interviene en filtros ni en las tarjetas (cambia un atributo de la grilla).
- **Aviso de alcance**: «Mostrando resultados de Cervezas · [Buscar en todo]» (botón de 44 px) junto a los resultados.
- **Placeholder honesto**: siluetas de botella y lata y «Foto próximamente», legible a 170 px. Mismo archivo y misma ruta
  (`beverage-placeholder.svg`, ~30 referencias intactas); se actualizaron los SHA-256 de `PUBLIC-PRODUCT-ASSETS.json` y
  `catalog-asset-audit.csv`.
- **Combo único** a todo el ancho en teléfono.
- **Hero y banners sin foto editorial** (producción): copy, título y puerta a la categoría sobre fondo de marca; la leyenda
  legal de alcohol se conserva.

Capturas reales del Moto antes/después: `artifacts/catalog-transformation-20261024/comparacion/index.html`.

## 5. Rendimiento (Moto G15, medido, no supuesto)

Camino productivo simulado, caché vacía, HTTP/2, 3 repeticiones, mediana
(`tools/moto-perf.mjs`, `resumen-frio-base-vs-actual.json`):

| | «4G rápido» (9 Mbps, 170 ms) base → actual | «4G lento» (1,6 Mbps, 150 ms) |
|---|---|---|
| FCP | 1.232 → 1.184 ms (−4 %) | 2.540 → 2.412 ms |
| **LCP** | **4.052 → 3.512 ms (−13 %)** | 7.820 → 8.268 ms (ruido; ver nota) |
| Evento `load` | **4.521 → 2.723 ms (−40 %)** | 7.028 → 7.397 ms |
| Bytes transferidos | **1.552 → 843 KB (−46 %)**; imágenes 726 → 11 KB | 776 → 843 KB |
| Elemento LCP | foto del hero (descubierta tarde) → primera foto de producto | igual |

Nota «4G lento»: la base ya tenía las imágenes del hero en la caché de memoria de la corrida anterior (6 KB de imagen),
así que su LCP es optimista; el resultado correcto es «sin cambio significativo». Ahí manda el ancho de banda del JavaScript.

Qué explica los números: el HTML llega a los 230 ms y el CSS a 1,3 s, pero **128 módulos JS tardan hasta 5,6 s** porque cada
uno revela los siguientes (no hay empaquetador) y recién después se pinta la home. Eso es lo que **no** se resolvió:

- **`modulepreload` se probó y se descartó con datos** (en el teléfono, sobre HTTP/2): LCP en frío 4,2 → 3,1 s en «4G rápido»,
  pero **FCP 2,3 → 5,6 s en «4G lento»** (123 peticiones simultáneas compiten con el CSS) y **LCP en caliente 2,4 → 3,3 s** (el
  Service Worker atiende 123 pedidos extra). Peor para quien vuelve, que es la mayoría.
- **Diferir las hojas del panel** (`business.css` 244 KB, 48 KB con brotli, 0 % usado en la home): riesgo alto sobre cientos de
  e2e del panel por un beneficio de ~50 KB. No se hizo.
- **Recomendación** para el responsable técnico: un empaquetado de release (por ejemplo esbuild a 3–4 archivos) es la única
  palanca grande que queda; requiere decidir un paso de build en el despliegue.
- **Fluidez de scroll** (gestos reales, `tools/moto-fluidez.mjs`): mediana de 16,6 ms por cuadro (60 fps) y p95 de 33 ms, **igual antes y después** y sin diferencia entre grilla y lista.

## 6. Catálogo preparado para comercializar: lo aprobado y lo demostrativo

`npm run catalog:commercial:readiness` (`scripts/catalog-commercial-readiness.mjs`, informe en
`docs/catalog/readiness-vitrina-neuquen.{md,json}`) cruza góndola, vitrina, propuesta de precios, manifiesto de imágenes y
registro de autorizaciones. **No inventa ni modifica nada, y no aprueba**: no existe ninguna aprobación por SKU del dueño.

| | |
|---|---|
| SKU evaluados | 52 |
| Completos con foto (derechos **declarados**; falta el documento del acuerdo) | 42 |
| Completos sin foto (placeholder propio) | 10 |
| Defectos técnicos | **0** |
| Precio: mantiene vigente / conflicto de margen / pendiente de comparación | 32 / **14** / **6** (los 14 y los 6 **no se tocaron**: ninguna rebaja automática) |
| Costo derivado (no medido) | 2 (`sprite-zero-2250ml`, `villavicencio-con-gas-500ml`) |
| Antigüedad del costo mayorista | **68 días** (medido el 2026-08-18) |
| **Listos para vender** | **0 de 52** |

**Fotos de producto**: auditadas por hash, formato, relación de aspecto, resolución (≥600 px) y pertenencia al SKU, y
**revisadas a ojo** (hojas de contacto en `artifacts/.../catalogo/`; se ampliaron Aquarius Pera/Manzana y Dadá Caramel para
leer la etiqueta): **ninguna discrepancia de sabor, tamaño, envase ni pack/suelto**; ninguna foto de receta, estirada,
pixelada o rota. Los 10 SKU sin fuente auditada muestran el placeholder, no una foto parecida (p. ej. Andes Origen *Roja* no
reutiliza la *Rubia*). Pendiente: 13 de las 42 no están contrastadas contra el mapa auditado de producción.

**Fotografía editorial** (`docs/catalog/promo-rights.json`, `js/core/promo-rights.js`): 18 piezas `NO_DOCUMENTADOS` y 1
`RETIRADA`. En producción sólo se pintan las `DOCUMENTADOS` con quién cede y referencia (hoy ninguna). Para habilitar una:
documentar la autorización, completar el registro y listarla en `CLEARED_PROMO_PHOTOS` (`tests/promo-rights.test.mjs` exige
que coincidan). En demostración se ve todo como antes.

## 7. Accesibilidad

axe-core 4.10.2 (instalado fuera del repo) sobre 8 pantallas a 432 px: **de 7 violaciones a 0** (h2 «Productos» para lectores
de pantalla antes de las tarjetas; h4→h3 en el checkout; el aviso del pedido mínimo deja de ser un `aside` anidado). Sin
fallas de contraste y todos los controles con nombre accesible. Quedan los enlaces de nombre de producto de 18–36 px de
alto (equivalente: la foto abre lo mismo; WCAG 2.5.8) y los `input` radio/checkbox cuyo `label` es la zona táctil.

## 8. Pruebas ejecutadas

| Compuerta | Resultado |
|---|---|
| `npm run check` | **verde** (sintaxis, config de Supabase, activos estáticos, grafo de precaché, higiene de release, identidad v167, contrato de ubicación, codificación, escáner de secretos) |
| `npm test` | **3.217 / 3.217** (los 3.193 previos + 24 nuevas), dos veces: antes y después del rebase sobre la integración |
| Catálogo e imágenes | `image-sources`, `gondola-imagenes-por-sku`, `catalog-image-pipeline`, `product-sin-imagen` y la nueva `catalog-commercial-readiness` (11 casos: lo real pasa limpio y cada defecto concreto se detecta) |
| Derechos de fotos editoriales | `promo-rights.test.mjs` (registro = manifiesto = lista del código; producción cierra, demo abre) y e2e: en producción cero peticiones a `assets/promos/` |
| Búsqueda y filtros | `catalog-search*`, `product-discovery` (unit) y e2e `product-discovery`, `catalog-commercial-coverage` en Chromium y WebKit; mediciones de la propia prueba en `artifacts/.../e2e/product-discovery/` |
| Carrito y checkout | e2e `cart-*`, `launch-ux-checkout-reorder`, `checkout-*` y el recorrido completo por toques en el Moto hasta «Pedido confirmado» (modo demo) |
| PWA y Service Worker | `pwa-update-lifecycle` (10 casos, sin tocarlos), e2e `service-worker-*` y `pwa-*`; en el Moto: actualización automática a v166, precaché de 275 entradas, caché vieja eliminada, recarga y compra sin conexión |
| Visual responsive | `ux-premium-storefront`, `catalog-transformation` (12), `taba2-brand-home`, `catalog-polish`, `catalog-real-content`; 320–699 px sin desborde horizontal; axe-core en 8 pantallas: 0 violaciones |
| **E2E Chromium** (12 lotes, uno por vez) | **605 pasadas, 6 omitidas, 0 rojas** |
| **E2E WebKit móvil** (8 lotes) | **183 pasadas, 1 omitida, 0 rojas** |
| **E2E recuperación** (4 lotes) | **71 pasadas, 0 rojas** |
| Repetido sobre el árbol final (tras el ajuste del hero y el rebase) | Chromium 5 specs afectados: 60 pasadas · WebKit móvil: `catalog-transformation` 12, `ux-premium-storefront` 7, `catalog-polish` 8 + 1 omitida |
| `npm run migrations:validate` | revisión estática aprobada; **no se modificó ninguna migración** (`supabase/` sin cambios) |

Cómo se corrió y qué se declara:

- La suite se corrió **en lotes con `--shard`, uno por vez**, con un worker, puertos propios y el temporal fuera de las unidades casi llenas
  (`tools/e2e-shard.sh`, `run-all-e2e.sh`); el registro de cada lote y la memoria libre están en `artifacts/catalog-transformation-20261024/e2e/`.
- **Un rojo, repetido y sin ocultarlo**: el lote Chromium 9/12 falló una prueba, `product-discovery.spec.mjs:83` («local search script p50/p95 under 6x CPU…»,
  58,7 s contra un límite de 45 s), en un momento en que la PC tenía ~3 GB libres y varias sesiones activas. Es una prueba de **tiempos bajo CPU 6× estrangulada** y
  no toca nada de lo cambiado; el lote completo se repitió y dio verde (`e2e/chromium-9-primer-intento-fallo.txt` conserva el primer intento).
- **Una prueba de WebKit con salida ≠ 0 y todo verde**: al correr cinco specs juntos en WebKit móvil, Playwright dejó el worker colgado al cerrar («did not exit within
  300000ms after stop»), el cuelgue conocido de WebKit en Windows. No se dio por aprobado: se repitió spec por spec y los tres dieron salida limpia.
- **Omitidas por el propio suite** (no ocultadas): en Chromium 6 — tres de gestos táctiles nativos que el propio spec reserva a WebKit móvil (`tracking-premium` ×2, `premium-storefront` ×1) y tres
  fiscales que piden una base local real (`order-fiscal-real-db`); en WebKit móvil 1 (`catalog-polish`, «el brillo no escribe mientras la página se mueve», que el propio spec declara omitido en WebKit).
- **No ejecutadas**: pgTAP y pruebas de base local (requieren el stack local de Docker; no se usó), `catalog:release:validate` (exige el catálogo real en `TABA_CATALOG_FILE`),
  la CI de GitHub (corre al empujar), iOS físico, y toda prueba con dinero real o con Supabase de QA o producción.
- **Moto G15 físico** (Android 15, Chrome 155): recorrido de compra completo (home, historias, catálogo, categoría, búsqueda con teclado real, ficha, carrito, checkout, confirmación en demo),
  vista Lista, aviso de alcance, red lenta emulada, red caída, actualización del PWA, y fluidez de scroll: **mediana de 16,6 ms por cuadro (60 fps) y p95 de 33 ms, igual antes y después
  y sin diferencia entre grilla y lista**. Falta la prueba física de pago real (no se hace con dinero real).

## 9. Bloqueos reales para comercializar (qué falta y de quién)

Los de infraestructura y operación ya están en `docs/audit/commercial-readiness-20261023/MATRIZ-GO-NO-GO.md` (A1 proyecto de
producción inexistente, A3 app de Mercado Pago, A6 datos del comercio, A7 primer cobro/reembolso reales, A9 sitio publicado
contra una base borrada). Lo que sale de esta etapa y necesita al responsable del negocio:

1. **Aprobar los precios por SKU** (52), con decisión sobre los 14 conflictos de margen y los 6 pendientes de comparación; y
   revisar que el costo mayorista tiene 68 días y 2 SKU con costo derivado.
2. **Confirmar el stock** de los 52 (`BUSINESS_CONFIRMATION_REQUIRED`).
3. **Documentar el acuerdo de fotos** (`TABA-AUT-2026-08-001` y sus ampliaciones están «declaradas»; falta el documento o el
   paquete de packshots de cada marca).
4. **Aportar o aprobar fotos** de los 10 SKU sin foto, o aceptar el placeholder.
5. **Autorizar (o reemplazar) la fotografía editorial** de banners, hero e historias; mientras tanto no se publica en producción.
6. Aprobar el catálogo real (no los 52 de la vitrina demostrativa) y completar `catalog/opening/OWNER-INPUT.md`.

## 10. Cómo ver la preview

```powershell
cd <raíz del repo>
node scripts/realtime-relay.mjs 8261
# http://localhost:8261/?reset=1&demo=1&vitrina=neuquen20261024   (vitrina con fotos reales)
# En el teléfono: adb reverse tcp:8261 tcp:8261 y abrir la misma URL en Chrome.
```

La vista Lista es el botón a la derecha del buscador del catálogo. Sin `?demo=1` la tienda local muestra el cierre honesto
(«La tienda online todavía no está abierta»); el camino productivo se ejerce con el arnés de las e2e
(`tests/e2e/catalog-runtime-fixture.mjs`).

## 11. Compromisos asumidos (para decidir con los ojos abiertos)

- **Registro diferido del Service Worker**: en la primera visita el worker se registra después de `load` (y un respiro de hasta
  3 s), así que la invitación a instalar —que necesita un worker activo— puede demorarse hasta que termine su precache. La
  entrada permanente del Perfil no cambia. En las visitas siguientes el worker ya controla la página y no hay diferencia.
- **Fotografía editorial fuera de producción** hasta que haya autorización documentada: el hero queda sin foto y los banners
  con su copy y su puerta. Es reversible pieza por pieza (§6).
- **Vista Lista sólo en teléfono** (≤699 px): en tableta y escritorio la grilla ya muestra tres columnas o más.

## 12. Observaciones para otras ramas

- Ningún defecto financiero encontrado en lo recorrido; no se auditó código financiero.
- `?reset=1` en demo no limpia la búsqueda persistida en IndexedDB (L4): sólo afecta a quien prepara una presentación.
- El A/B de rendimiento requiere que `git show HEAD:…` apunte a una referencia fija: `serve-compressed.mjs` acepta
  `GIT_BASE_REF`; sin él, tras commitear, el «antes» sirve el «después».

## 13. Revisión de derechos y vitrina (v167, 2026-10-25)

La revisión de GitHub del 25/10 señaló que `promoPhotoCleared()` gobernaba el hero y los banners, pero no las
historias que publica el backend. Se verificó, se corrigió y cada hueco quedó con una regresión que estaba **roja
sobre `5d13b6cf`** y está **verde** ahora.

| Hueco | Qué pasaba | Corrección | Regresión |
| --- | --- | --- | --- |
| Historias del backend | `getHomeStories()` filtraba por vigencia y CTA; una historia publicada con `media_url`/`thumbnail_url` en `assets/promos/` se pintaba en producción (círculo, visor y póster). En producción simulada aparecían 5 historias, 4 editoriales | `storyMediaCleared()`: la historia se descarta entera si su medio o su miniatura no pasan la compuerta | e2e «en producción una historia con foto editorial sin derechos no se publica; la autorizada sí»: sólo queda la autorizada, el visor sólo la muestra, ninguna petición a `/assets/promos/`. Control: en demo las editoriales se siguen viendo |
| Normalización débil | Sólo se quitaban `./` o `/` iniciales. La batería adversarial (marco-63, `adversarial-promo.mjs`) encontró que **15 de 20** variantes de la misma foto pasaban: URL absoluta, otro host, `//host`, `../`, `assets/./promos`, `%2F`/`%70`, mayúsculas, barras invertidas, espacio o tab inicial, `//`, credenciales y puerto | La referencia se resuelve como URL, se decodifica (hasta tres pasadas), se vuelve a resolver, se pasa a minúsculas y se busca el segmento `/assets/promos/` en cualquier host y también en la consulta (proxy de imágenes); lo que no se deja resolver y menciona «promos» falla cerrado | `tests/promo-rights.test.mjs`: 11 variantes bloqueadas y 3 legítimas que pasan. Batería adversarial: **0 de 20 esquivan, 0 legítimas bloqueadas**; ampliada a 24 con rutas envueltas en la consulta de un proxy de imágenes: 23 bloqueadas y la única que pasa va en el hash, que el navegador no envía |
| `?vitrina=` en producción | Sólo miraba el parámetro: en producción `data.js` servía la versión y las categorías de la vitrina (52 SKU), aunque los productos base siguieran vacíos | Exige `isDemoMode()`: demostración pedida y despliegue no productivo | e2e «en producción ?demo=1&vitrina=… no cambia el catálogo base ni las categorías» (modo `production`, versión y categorías aprobadas, precios = los del catálogo simulado). Control: en demo la vitrina sigue con sus 52 SKU |
| Inyección de CSS en la miniatura de una historia | `renderStoryCircles()` armaba `style="background-image:url('${encodeURI(thumbnailUrl)}')"` y `encodeURI` **no escapa `'` ni `(` `)`**: una `thumbnail_url` como `x');background-image:url('assets/promos/<archivo>` cerraba el `url()` y agregaba un segundo `background-image` editorial, y **el control de rutas no lo veía** (delante de `assets` no hay una barra, hay una comilla). Mi batería lo encontró (4 de 4 variantes pasaban sobre `76cbb264`); además permitía escribir cualquier otra regla CSS en el atributo | Dos capas: `js/core/css-url.js` (`cssUrlValue`) escapa `'`, `(` y `)` y se usa en los dos estilos en línea; y `editorialPromoKey()` trata como editorial sin resolver toda referencia que mencione `promos` y traiga comillas, paréntesis, `;`, ángulos, acento grave o llaves | `promo-rights.test.mjs` (inyección, legítimos con paréntesis, claves), `css-url.test.mjs` y e2e «una miniatura con comillas no inyecta CSS ni trae una foto editorial» (roja sobre `a3ed4b69`, verde ahora) |

Lo que **no** se bloquea, a propósito: las URLs de Supabase Storage. Son el canal por el que el comercio publica sus
propias historias; la compuerta gobierna la fotografía editorial de terceros que vive en `assets/promos/`.

**Identidad `la-taba-runtime-v167-catalog-rights-review`** (221 archivos). Desviación consciente del pedido literal de v166: ya está instalada con
otro contenido en el Moto G15 y en la preview, y como `precargar()` borra primero la caché de su propio nombre,
reinstalar «v166» vaciaría la del worker activo.

Sin cambios en Mercado Pago, pagos, stock, precios ni pedidos. #152 sigue en `b070b4ae` (v165).

El catálogo **no** está listo para producción comercial: siguen pendientes las aprobaciones de Walter (precios,
fotografías editoriales con derechos documentados y catálogo real), además de los bloqueos de la sección 9.

v165 (#152, `b070b4ae`) sigue siendo la candidata estable y el respaldo.

Pruebas de esta revisión: `npm test` 3219/0 (sobre `737b14ae`); unitarias dirigidas 387/0 y e2e dirigidas en Chromium 119 + 1 omitida declarada (sobre la punta final); `npm run check` verde. Evidencia: `artifacts/catalog-transformation-20261024/revision-derechos/`.
