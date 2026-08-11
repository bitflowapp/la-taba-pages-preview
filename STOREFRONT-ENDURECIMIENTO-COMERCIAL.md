# Endurecimiento comercial del storefront TABA2

Base: `eda13f8`. Rama: `feature/taba2-commercial-production-hardening`.
Trabajo iniciado por Codex y terminado acá sobre el MISMO worktree, sin reset,
sin descartar nada y sin tocar el frente de tracking/mapa/GPS.

---

## 1. Lo que estaba roto y qué se hizo

### P1 — El carrito se perdía al recargar (producción)

**Reproducido sobre el comportamiento anterior**, con el mismo recorrido en los
dos árboles y el mismo backend simulado:

| | `eda13f8` | ahora |
|---|---|---|
| carrito antes de recargar | 2 líneas | 2 líneas |
| claves en `localStorage` | `sb-…-auth-token` | `sb-…-auth-token`, `la_taba_production_cart_v1` |
| carrito **después** de recargar | **vacío** | 2 líneas |

La causa: en producción el estado NO se persiste —pedidos, catálogo y PII viven
sólo en memoria y se reconstruyen desde Supabase en cada arranque, que es el
contrato que evita renderizar datos de otra persona desde el disco—. El carrito
estaba adentro de esa regla sin necesitarlo: un id de catálogo y una cantidad no
son datos de nadie.

Lo que se hizo:

- `js/core/production-cart-storage.js`: clave separada que admite **solamente**
  ids de catálogo y cantidades. Nombre, teléfono, dirección, notas, precios,
  pedidos y tokens no tienen forma de entrar; hay un test que lo afirma sobre el
  JSON crudo escrito.
- **Vencimiento a 72 h**, contado desde el último cambio REAL del carrito. La
  aplicación persiste en cada cambio de estado (abrir un filtro, buscar); si
  cada guardado refrescara la marca de tiempo el plazo no llegaría nunca, así
  que el guardado conserva la marca anterior cuando las líneas no cambiaron.
- Un carrito vencido, corrupto, de esquema viejo o con marca de tiempo ilegible
  **se borra en la lectura**, no se ignora.
- Reconciliación contra el catálogo verificado en cada carga: el producto que
  salió del catálogo, el que se quedó sin stock y el que perdió el precio
  publicado no vuelven, y el disco queda reconciliado también.
- `sanitizeCart` ahora usa `isProductOrderable`, **la misma compuerta que
  `addToCart`**. Con la anterior, un producto que perdía el precio mientras el
  carrito estaba guardado no se podía agregar pero sí reaparecer al recargar, y
  el checkout lo cobraba a cero.
- Un catálogo que **no carga** (503) ya no vacía el carrito: sin catálogo no hay
  con qué reconciliar, y un error del backend no es "el cliente vació su
  carrito". (Los dos `replaceProductionCatalog([])` de las ramas de error los
  había quitado Codex; se conservan quitados y ahora hay una prueba que lo fija.)

### Fallback de arranque — códigos internos y una tarjeta ilegible

El panel de recuperación **nacía visible** en el shell servido y lo escondía el
bootstrap. En loopback no se nota; con el módulo demorado 3 s —una red de barrio
cualquiera— sí:

| a los 1,5 s con `app.js` demorado 3 s | `eda13f8` | ahora |
|---|---|---|
| cartel de error visible | **sí, en los 4 anchos** | no |

Y cuando el arranque falla de verdad, lo que se leía era:

> No pudimos cargar TABA2 · Podés reintentar ahora. **Tus datos de prueba** no se
> borraron. · **TABA2-BOOT-01**

sobre una tarjeta casi blanca (`#fff9f9`) con la tinta CLARA del shell heredada:
el título daba **1,07:1** y "Reiniciar prueba" era blanco sobre blanco, o sea
invisible. La única pantalla que puede quedar entre un cliente y la tienda era la
menos legible de todas.

Lo que se hizo:

- El panel nace `hidden`. Lo muestra `startup-recovery.js` ante un fallo real:
  el módulo no baja (detectado en **fase de captura** —un fallo de carga de
  recurso no burbujea y por eso `window.onerror` no lo veía—), el módulo
  revienta, o pasan **8 s** sin que la aplicación pinte ni falle.
- Después del primer pintado los detectores pasivos se callan: un error suelto
  de cualquier pantalla ya no puede tapar una tienda que funciona.
- Copy sin jerga y sin "datos de prueba" para clientes reales. El código técnico
  (`TABA2-BOOT-01/02/03`) viaja en `data-app-recovery-code` y en
  `console.warn`, no en la pantalla.
- Superficie y tinta declaradas juntas y explícitas (grafito de góndola). El
  selector nombra las dos clases (`.card.app-recovery`) porque `.card` está
  declarada más abajo en la misma hoja y le ganaba el fondo: **ése** es el
  motivo real por el que el panel nunca fue del color que decía su regla.
- El botón secundario del panel recibe el tratamiento del shell oscuro, que ya
  existía en `brand-home.css` pero acotado a `.app-view`/`.modal-card`.
- `app.js` ya no abre el panel cuando falla la sincronización de pedidos
  DESPUÉS de pintar: ponía "No pudimos abrir la tienda" encima de una tienda
  abierta y, al mismo tiempo, un aviso que decía que se podía seguir. Ahora sólo
  avisa por toast, con acentos y diciendo qué se perdió.

Contraste del panel medido en la prueba: **0 textos por debajo de AA**, ambos
botones ≥ 44 px.

### Copy y rutas

- **Promesa inexistente.** Perfil decía "Podés agregarlas ahora o completar una
  dirección manualmente durante el checkout". El checkout **sólo elige** entre
  direcciones guardadas; ese formulario no existe ni existió. Ahora: "Agregá una
  acá y después la elegís al hacer el pedido."
- **Jerga.** "Esta vista no tiene una sesión de cliente disponible" describía el
  motivo técnico a alguien que quiere comprar. Ahora: "Todavía no podemos tomar
  pedidos online / Esta tienda aún no tiene habilitados los pedidos por la app.
  Podés seguir mirando el catálogo."
- **Ruta inválida.** `#promos-verano` dejaba a la persona en el inicio sin decir
  nada y con la URL rota intacta: recargar repetía el silencio y volver atrás
  también. Ahora `resolveRoute` distingue `ok` / `blocked` / `unknown`; lo
  desconocido avisa ("No encontramos esa página. Te dejamos en el inicio.") y
  corrige la URL con `replaceState`, así atrás vuelve al último lugar real. Una
  vista operativa bloqueada por el modo corrige la URL **sin** anunciarse: no es
  un error de quien navega y nombrarla publicita una puerta que no le toca.

| hash tras `#no-existe-esta-vista` | `eda13f8` | ahora |
|---|---|---|
| URL | `#no-existe-esta-vista` | `#home` |
| aviso al cliente | ninguno | toast comercial |

### Responsive 320 / 360 / 390 / 432

Se construyó `scripts/taba2-commercial-responsive-audit.mjs`: mide desborde del
documento y de cada elemento, objetivo táctil < 44 px **contando el label que
envuelve al control**, campos con tipografía < 16 px (autozoom de iOS) y CTAs
inalcanzables por **hit test real** (`elementFromPoint` después de llevar el
control al centro), no por geometría.

11 estados × 4 anchos = 44 mediciones, en Chromium y WebKit:

| | `eda13f8` | ahora |
|---|---|---|
| hallazgos (chromium) | 0 / 44 | 0 / 44 |
| hallazgos (webkit) | — | 0 / 44 |
| overflow horizontal del documento | 0 px | 0 px |

**La "compresión de Perfil a 320px" no reproduce.** Perfil, el editor de datos
personales y el editor de dirección a 320 px: sin desborde, sin recorte, sin
objetivo táctil corto, sin autozoom, sin CTA tapado. Lo digo con la medición
porque el reporte previo la daba por confirmada.

Dos hallazgos que la herramienta reportó y **no** son defectos, documentados
porque cuestan tiempo a quien los vuelva a ver:

- `span.brand-logo-ring` "asoma" 3 px a 320. Es un cuadrado de 64 px
  enmascarado en círculo que **gira sin parar**: a 45° su caja alineada a los
  ejes mide 90 px. La máscara recorta el círculo mucho antes; no se ve y no
  genera scroll.
- `button.primary-button.compact` medía 43 px en vez de 44 mientras la ficha de
  producto está abierta. Es la escala de profundidad del shell de atrás, sobre
  un control que en ese momento no se toca.

La herramienta ahora descarta los dos casos por su causa, no por su síntoma.

### Sistema de diseño

Sólo lo demostrable, y todo en el panel de recuperación: contraste 1,07:1,
botón secundario invisible, superficie fuera de la identidad. Nada de la
identidad, las cards, el hero ni el catálogo se tocó.

La auditoría de superficie (contraste/superficies claras/tap) da el **mismo**
resultado antes y después: un único hallazgo repetido, `span.product-age-tag`
con fondo blanco al 92 %. Es deliberado —la pastilla del +18 vive sobre el plato
blanco del packshot, con borde dorado y tinta `#7c4a00`, sin ningún hallazgo de
contraste asociado— y se deja como está.

### Dos defectos de despliegue que aparecieron al cerrar

1. `js/core/production-cart-storage.js` **no estaba en la lista de precache** de
   `sw.js`. `state.js` la importa de forma estática: un cliente con la PWA
   instalada y sin red no habría podido ni arrancar la tienda. Agregada.
2. Ningún rompe-caché estaba subido. Un cliente que vuelve habría seguido con el
   CSS y el `app.js` viejos, o sea sin ninguno de estos arreglos. Subidos:
   `CACHE_NAME` → `la-taba-runtime-v61-endurecimiento-comercial`,
   `styles.css` y las 11 hojas → `?v=49`, `startup-recovery.js` → `?v=2`,
   `app.js` → `?v=41`, con los tests que los fijan alineados.

---

## 2. Archivos

**Nuevos**

```
js/core/production-cart-storage.js
tests/production-cart-storage.test.mjs
tests/e2e/production-cart-persistence.spec.mjs
tests/e2e/arranque-sin-jerga.spec.mjs
tests/e2e/rutas-y-promesas.spec.mjs
scripts/taba2-commercial-hardening-shots.mjs
scripts/taba2-commercial-responsive-audit.mjs
STOREFRONT-ENDURECIMIENTO-COMERCIAL.md
```

**Modificados**

```
index.html                                   panel de recuperación oculto, sin código a la vista, ?v
js/app.js                                    resolveRoute + recuperación de ruta; el fallo de sync no abre el panel
js/config.js                                 clave productionCart (default y showcase)     [Codex]
js/state.js                                  carga/persistencia del carrito productivo; sanitizeCart usa isProductOrderable
js/startup-recovery.js                       muestra por fallo real, no por defecto; códigos a consola
js/customer-delivery.js                      copy del bloque sin autoridad de datos
js/customer-profile-view.js                  quita la promesa del formulario inexistente
js/repositories/supabase_order_repository.js no vacía el catálogo ante error de red       [Codex]
styles/common.css                            superficie, tinta y botón secundario del panel
styles.css, sw.js                            rompe-caché + precache del módulo nuevo
playwright.config.mjs                        dos specs del cliente suman a mobile-webkit
scripts/measure-local-rc-performance.mjs     selector del inicio actualizado + alcance «storefront»
tests/{startup-recovery,pwa,github-pages}.test.mjs, tests/e2e/ios-blank-screen.spec.mjs
```

`js/config.js` y `js/repositories/supabase_order_repository.js` conservan los
cambios de Codex tal cual; `js/state.js` los conserva y los completa.

---

## 3. Evidencia

**Capturas** — mismo recorrido, mismos 18 estados, mismos 4 anchos, generadas
por el mismo script contra los dos árboles:

```
artifacts/taba2-commercial-audit/before/   72 PNG   servidas desde eda13f8
artifacts/taba2-commercial-audit/after/    72 PNG   servidas desde este árbol
```

Estados: home, combos, catálogo, búsqueda, búsqueda vacía, filtros, producto,
producto sin precio, carrito vacío, carrito, **carrito tras recargar**, checkout,
checkout total, perfil, editor de dirección, **ruta inválida**, **arranque
fallido**, **arranque lento**. Los cuatro en negrita no existían en el set
anterior y son los que motivan este trabajo. Las imágenes no se versionan
(`artifacts/taba2-commercial-audit/` está en `.gitignore`); el recorrido sí.

**Auditorías**

```
artifacts/taba2-commercial-audit/responsive-base-eda13f8/   0/44 hallazgos
artifacts/taba2-commercial-audit/responsive-after/          0/44 chromium · 0/44 webkit
artifacts/taba2-commercial-audit/before|after/audit-chromium.md   idénticos
```

---

## 4. Performance

**Medición determinista** (bytes del inicio en `?demo=1#home`, mismo servidor):

| | `eda13f8` | ahora | Δ |
|---|---|---|---|
| peticiones | 165 | 166 | +1 |
| total | 2885,1 KB | 2898,7 KB | **+13,6 KB (+0,47 %)** |
| mapa + tracking | 124,5 KB | 124,5 KB | 0 |

La petición extra es el módulo nuevo del carrito.

**Medición temporal**: se corrieron 3 pares antes/después intercalados en la
misma sesión (7 iteraciones cada uno, p95). Los dos perfiles se mueven en
DIRECCIONES OPUESTAS —escritorio da hasta −19 % y móvil hasta +38 %—, lo que
identifica deriva del host, no efecto del cambio: en el tercer par, el más
asentado, móvil da 961 ms vs 972 ms de inicio y 118 vs 117 ms de catálogo. La
dispersión entre corridas del MISMO árbol supera cualquier efecto atribuible.

**Las 6 corridas, de los dos árboles, quedaron dentro del presupuesto local de
regresión.** No hay regresión material, y el camino de render no recibió trabajo
nuevo: una lectura de `localStorage` en el arranque, una escritura en un
`persist()` que ya corría, una resolución de ruta y CSS sobre un panel oculto.

Las seis mediciones quedan versionadas —son la única parte de la evidencia que
no se puede regenerar sin volver a montar el árbol base—:

```
artifacts/performance/quiet-antes-{1,2,3}.json     medidas sobre eda13f8
artifacts/performance/quiet-despues-{1,2,3}.json   medidas sobre este árbol
```

Dos arreglos en el medidor, ambos necesarios para poder medir:
`[data-home-catalog-preview]` ya no existe —la vidriera de marca lo reemplazó— y
dejaba la corrida en timeout **sin medir nada**; y el alcance `storefront`
(`TABA_PERFORMANCE_SCOPE=storefront`) no exige el PDF fiscal, que necesita un
bridge compilado que este trabajo tiene prohibido tocar. La corrida completa del
RC no cambia: sin la variable, corta igual que siempre.

---

## 5. Gates

| Gate | Resultado |
|---|---|
| `npm run check` | ✅ |
| `npm test` | ✅ **1308/1308** (1304 en la base + 4 nuevos de unidad) |
| Playwright chromium | ✅ **246/246** |
| Playwright mobile-webkit | ✅ **19/19** (era 11; suman los 8 del cliente) |
| Carrito reload probado | ✅ unidad + e2e en los dos motores + reproducción del defecto en `eda13f8` |
| 0 CTA tapado | ✅ 44/44 mediciones, hit test real, dos motores |
| 0 overflow crítico | ✅ 0 px en los 4 anchos |
| 0 fallback técnico visible | ✅ ningún `TABA2-BOOT-*` pintado; cartel oculto en carga lenta |
| Sin regresión material de performance | ✅ +0,47 % de bytes; tiempos dentro del presupuesto en las 6 corridas |
| Capturas AFTER equivalentes | ✅ 72 = 72 |

---

## 6. Deuda documentada (NO se tocó)

- **Mapa y tracking en el inicio.** 124,5 KB en 11 archivos (`js/map/*`,
  `js/tracking/*`) se descargan en Home aunque el cliente no vaya a seguir
  ningún pedido, medido en `?demo=1`. Es el frente protegido: **documentado, no
  tocado**. El arreglo natural es carga diferida al entrar a Seguimiento, y hay
  que hacerlo junto con `36b6f3d`, no antes.
- **`scripts/check-static-assets.mjs` no valida que cada módulo importado esté
  en el precache de `sw.js`.** El módulo nuevo del carrito faltaba y ningún gate
  lo detectó; lo encontré leyendo `sw.js`. Un guard que recorra el grafo de
  imports y lo compare contra `ASSETS` cierra toda una clase de fallo offline.
- **El presupuesto de performance local no es medible en este host con
  confianza.** El desvío entre corridas idénticas llega al 40 % en las métricas
  chicas. Para afirmar un ±5 % hace falta un host dedicado o muchas más
  iteraciones.
- **`js/state.js` tiene 830 líneas** y concentra estado, saneamiento,
  persistencia y migración. No se refactorizó: no era el pedido y el riesgo no
  se paga solo.
- **`span.product-age-tag`**: blanco al 92 % sobre el plato del packshot.
  Deliberado, sin hallazgo de contraste, idéntico antes y después.

---

## 7. Conflictos potenciales con `36b6f3d` (tracking always-map)

No se integró nada de esa rama. Del diff de este trabajo, lo que puede rozarla:

| Archivo | Riesgo | Por qué |
|---|---|---|
| `js/app.js` | **medio** | `resolveRoute`/`recoverFromUnservedRoute` reemplazan a `normalizeView` y agregan una línea al bootstrap. Si `36b6f3d` toca `syncViewFromLocation` o el arranque para el mapa siempre presente, el conflicto es textual y de resolución obvia: la vista `tracking` sigue siendo `ok` en `VIEWS` y su resolución no cambió. |
| `sw.js` | **medio** | Las dos ramas suben `CACHE_NAME` y tocan `ASSETS`. Al integrar: un solo `CACHE_NAME` nuevo y la unión de las dos listas. Los `js/map/*` que agregue `36b6f3d` tienen que quedar. |
| `index.html` / `styles.css` / `tests/{pwa,github-pages}` | **medio** | Si `36b6f3d` también subió `?v=`, gana el número más alto y hay que alinear los tres tests que los fijan. |
| `styles/common.css` | **bajo** | Sólo `.app-recovery`. Ninguna vista de tracking. |
| `playwright.config.mjs` | **bajo** | Sólo el `testMatch` de mobile-webkit: unir las alternativas. |
| `js/state.js`, `js/core/production-cart-storage.js`, `js/cart.js` | **nulo** | El carrito no cruza con el mapa. |

Recomendación de orden: integrar `36b6f3d` **sobre** esta rama y resolver
`sw.js` a mano (unión de listas + un `CACHE_NAME` nuevo). Después, recién ahí,
atacar la carga diferida del mapa, que necesita las dos partes en el mismo
árbol.
