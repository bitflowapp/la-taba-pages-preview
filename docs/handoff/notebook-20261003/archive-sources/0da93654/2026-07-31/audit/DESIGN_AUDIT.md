# TABA — Auditoría de diseño

**Fecha:** 2026-07-31 · **Worktree auditado (sólo lectura):** `C:\1212\la-taba-catalog-checkout-premium` · rama `feature/catalog-checkout-premium` · HEAD `4197bdb`
**Naturaleza:** propuesta. Ningún hallazgo fue corregido en el repositorio.

## Base de evidencia

Las cinco imágenes descritas en el encargo **no llegaron adjuntas a esta sesión**. La auditoría se apoya en:

1. **Capturas reales del estado actual en disco** — `C:\1212\artifacts\taba-opus-design-review\screenshots\current\` (46 PNG, generados el 2026-07-30 con Playwright contra la app real, 6 viewports × 6 vistas). Inspeccioné visualmente `home-390x844`, `catalog-390x844`, `catalog-cart-390x844`, `catalog-empty-390x844`, `business-390x844` y `detail-bestsellers-390`. Corresponden 1:1 con las imágenes 1, 2, 3 y 5 descritas.
2. **Mediciones instrumentadas** — `screenshots/current/audit-metrics.json` (overflow, superficies fixed/sticky con z-index y alturas, targets, textos recortados, textos diminutos) en 320/390/430/768/1280/1440.
3. **Lectura dirigida del código** — `styles/tokens.css`, `styles/responsive.css`, `styles/catalog.css`, `styles.css`, `index.html`, `js/ui.js`.

La imagen 4 (Ajustes de iPhone) se usó como **referencia de principios estructurales**, no como diseño a copiar: agrupación por secciones, fila con icono/título/valor/chevron, separadores discretos, densidad controlada. No se replica ningún icono, color, material ni componente de Apple.

---

## Resumen por severidad

| Nivel | Cantidad | Qué significa |
|---|---|---|
| **P0** | 3 | Bloquea o degrada gravemente el uso/compra |
| **P1** | 11 | Fricción comercial u operativa importante |
| **P2** | 9 | Inconsistencia visual o de sistema |
| **P3** | 5 | Pulido |

**Bugs funcionales probables identificados:** 4 (F-01 a F-04).
**El caso “Todos / 0 productos / carrito con 4 productos” NO es un bug de estado ni de render** — diagnóstico completo en **P1-06**.

---

# P0 — Bloqueantes

## P0-01 · La reserva de espacio inferior está calculada con un token muerto: el stack fijo tapa contenido

- **Evidencia:** `audit-metrics.json` registra en todos los viewports móviles tres superficies fijas simultáneas: `header.topbar` (sticky, z1000, h71) · `nav.mobile-nav` (fixed, z1150, **h68**) · `button.floating-cart` (fixed, z1200, h52) · `div.toast` (fixed, z3000, h48–69). En `catalog-cart-*` y `catalog-empty-*` la métrica `covers` no está vacía para `floating-cart` y `mobile-nav`.
- **Pantalla:** catálogo e inicio, móvil (≤820px), con carrito no vacío.
- **Causa probable (verificada en código):** hay **cuatro fuentes de verdad distintas** para la altura de la nav inferior:
  - `styles/tokens.css:45` → `--taba-bottom-nav-height: 104px`
  - `styles/responsive.css:63` → `--taba-bottom-nav-height: 76px` (≤820px)
  - `styles/responsive.css:110` → `.mobile-nav { min-height: calc(70px + safe) }`
  - `styles/showcase.css:467,480` → fallback literal `82px`
  - **Altura real medida: 68px.**

  Y sobre todo: `--taba-bottom-nav-clearance` y `--taba-floating-cart-reserve` se **declaran en `:root`** (`tokens.css:50`, `responsive.css:65`). La sustitución de una custom property ocurre **en el elemento donde se declara**, no donde se usa. Por eso `--taba-floating-cart-reserve` resuelve `var(--taba-bottom-nav-clearance)` con los valores de `:root` y las reglas que la consumen (`responsive.css:1121`, `1125`) reservan menos de lo que ocupa el stack real (nav 68 + gap + carrito 52 + gap ≈ **140px** necesarios).
- **Tipo:** funcional + visual.
- **Impacto:** el último precio de la grilla, la CTA del empty state y el pie de las listas quedan bajo la barra roja de carrito. En una tienda, tapar el precio del último producto es pérdida directa de conversión.
- **Corrección recomendada:** una sola fórmula, declarada en el **mismo scope** donde varían sus entradas.
  ```css
  :root { --nav-h: 56px; --cta-h: 56px; --gap: 8px; --safe-b: env(safe-area-inset-bottom,0px);
          --nav-block: calc(var(--nav-h) + var(--safe-b)); }
  body   { --cta-block: 0px;
           --bottom-reserve: calc(var(--nav-block) + var(--cta-block) + var(--gap)); }
  body[data-cart="filled"] { --cta-block: calc(var(--cta-h) + var(--gap)); }
  ```
  Invariante: **la altura de la nav se declara una sola vez y todo lo demás se deriva**; ningún `bottom:` ni `padding-bottom:` vuelve a llevar un número literal.
  Este mismo error se reprodujo espontáneamente en el prototipo de esta propuesta y quedó documentado como regla del sistema en `design-system/taba-tokens.css`.
- **Archivo probable:** `styles/tokens.css`, `styles/responsive.css` (61-122, 200-220, 1111-1134), `styles/showcase.css` (460-485).
- **Prueba requerida:** E2E que, con carrito ≠ 0, haga `scrollTo(bottom)` y verifique que ningún nodo de texto dentro de `main` intersecta el borde superior de `.floating-cart` ni de `.mobile-nav`, en 320/375/390/430/768.

## P0-02 · El control de cantidad se superpone al nombre del producto

- **Evidencia:** `screenshots/current/catalog-cart-390x844.png` — el stepper (papelera · 1 · +) atraviesa literalmente el texto “Coca-Cola Original”, y el toast tapa la presentación de la tarjeta contigua.
- **Pantalla:** catálogo móvil, cualquier producto con cantidad ≥ 1.
- **Causa probable (verificada):** `styles/catalog.css:252` →
  ```css
  .product-media-control { position: absolute; z-index: 4; right: 10px; bottom: 136px; }
  ```
  `136px` es un número mágico derivado de las filas fijas de `.product-card` (`grid-template-rows: 190px minmax(78px,1fr) 62px`, línea 221). Cuando el cuerpo crece — título de 2 líneas + presentación + disponibilidad + precio superan los 78px — el cuerpo sube pero el control sigue anclado a 136px del borde inferior. El stepper además es ~3× más ancho que el botón `+`, así que invade horizontalmente toda la franja del título.
- **Tipo:** visual con consecuencia funcional (el nombre del producto deja de leerse en el momento exacto de comprar).
- **Impacto:** P0. Ocurre en el estado más importante del catálogo: el producto ya agregado.
- **Corrección recomendada:** eliminar el posicionamiento absoluto. La acción vive **en flujo normal**, en el pie de la tarjeta, y el stepper ocupa exactamente el mismo lugar que la CTA. Con el pie apilado (precio arriba, acción abajo) el solape es **imposible por construcción**, no por ajuste de números.
- **Archivo probable:** `styles/catalog.css:218-262, 381-465`; render de tarjeta en `js/ui.js`.
- **Prueba requerida:** test que, para cada tarjeta con cantidad ≥1, compare los rects de `.product-body h3` y del control de cantidad y falle ante cualquier intersección. Ejecutar con nombres largos (“Red Bull Energy Drink”, “Imperial Cream Stout”).

## P0-03 · El primer precio queda debajo del pliegue en móvil

- **Evidencia:** `home-390x844.png` y `catalog-390x844.png` — a 390×844 se ven tarjetas completas con nombre, presentación y “Disponible”, **pero ningún precio**. Coincide con el defecto medido pendiente “0 precios sobre el pliegue”.
- **Pantalla:** inicio y catálogo, móvil.
- **Causa probable:** consumo de altura antes de la grilla — header 71 + eyebrow/H1 ~96 + buscador ~65 + tarjetas de categoría ~105 + contador ~30 + barra de orden ~68 = **~435px** antes del primer producto; más una tarjeta de 330px con el precio en su última fila.
- **Tipo:** visual con impacto comercial directo.
- **Impacto:** el usuario debe hacer scroll para ver el primer precio de una tienda de bebidas, donde el precio es el principal criterio de decisión.
- **Corrección recomendada:** header 56, sin eyebrow, H1 de 22px, buscador 46, categorías como chips de 44, y tarjeta con media cuadrada + pie compacto. En la propuesta el primer precio aparece a ~y=560 de 844 (`screenshots/catalog-mobile-390x844.png`): **dos precios completos sobre el pliegue**.
- **Archivo probable:** `styles/catalog.css`, `styles/storefront.css`, `styles/responsive.css`.
- **Prueba requerida:** aserción “al cargar el catálogo en 390×844, al menos un `[data-price]` tiene `rect.bottom <= 844`”.

---

# P1 — Fricción comercial u operativa importante

## P1-01 · El panel del negocio móvil es el dashboard de escritorio comprimido

- **Evidencia:** `business-390x844.png`. Cuatro tarjetas de métrica de ~130px cada una mostrando **cuatro ceros** (~260px), luego una fila de tabs horizontales cortada (`Pedidos · Métricas · Reportes · Caja`, con más elementos fuera de pantalla), luego una **segunda** fila de tabs también cortada (`Todos 0 · Nuevos 0 · En preparación 0`), y recién después la cola. La cola de pedidos —la única razón por la que existe la pantalla— empieza cerca de **y≈700 de 844**.
- **Causa probable:** el layout se diseñó para escritorio y se adaptó por breakpoints, no por arquitectura.
- **Impacto:** en hora pico, el encargado ve **cero pedidos** en el primer viewport.
- **Corrección recomendada:** banda operativa única de 52px que es **resumen y filtro a la vez** (Nuevos/Preparando/Listos/En camino), reemplazando las 4 tarjetas (260px) y las dos filas de tabs (~120px) por 52px. Cola inmediatamente después. Módulos secundarios a una sección “Local” con filas agrupadas. Ver `business/BUSINESS_MOBILE_SPEC.md`. En la propuesta se ven **3 pedidos completos** sobre el pliegue.
- **Prueba requerida:** “en 390×844 con ≥3 pedidos, al menos 2 tarjetas de pedido son totalmente visibles sin scroll”.

## P1-02 · Tabs horizontales cortadas como navegación principal del negocio

- **Evidencia:** `business-390x844.png`, ambas filas de tabs llegan al borde sin affordance de scroll.
- **Impacto:** secciones invisibles y no descubribles; el usuario no sabe que hay más.
- **Corrección recomendada:** bottom navigation de 4 destinos fijos (Pedidos · Riders · Local · Caja) + stack jerárquico. Las tabs horizontales quedan sólo para **filtros de estado**, no para navegación, y con máscara de degradado que indica continuidad.

## P1-03 · El toast tapa contenido en lugar de flotar sobre el stack

- **Evidencia:** `catalog-cart-390x844.png` (toast sobre la tarjeta) y `business-390x844.png` (“Acceso del negocio activado.” sobre el empty state). `audit-metrics.json`: `div.toast (fixed, z3000, h48) covers: 1–2`.
- **Causa probable:** `styles/responsive.css:119-122` posiciona el toast en `bottom: var(--taba-bottom-nav-clearance)` — el mismo valor mal calculado de P0-01.
- **Corrección recomendada:** `bottom: calc(var(--bottom-reserve) + 8px)`, derivado, siempre por encima de todo el stack inferior.

## P1-04 · “PREVIEW INTERNA” visible en la experiencia del cliente

- **Evidencia:** `home-390x844.png`, badge amarillo junto a “CATÁLOGO”. `audit-metrics.json` lo mide además con **font-size: 8px**.
- **Impacto:** destruye la confianza comercial; comunica “esto es una demo”. Además incumple el mínimo tipográfico.
- **Corrección recomendada:** eliminar de la superficie cliente. Si se necesita marcar entornos, usar un indicador fuera del área de contenido, controlado por flag de entorno, nunca en producción.
- **Archivo probable:** `js/ui.js` / `index.html` (`.home-preview-label`).

## P1-05 · La home renderiza dos carruseles de “Los más vendidos” con markup distinto, uno visualmente roto

- **Evidencia:** `home-390x844.png` y el recorte `detail-bestsellers-390.png`: una primera fila de tarjetas **de ~85px de alto** con un packshot de ~15px y un botón `+`, sin nombre ni precio; y debajo, una segunda fila de tarjetas completas con corazón, nombre y “Disponible”.
- **Causa probable:** dos componentes distintos para la misma función (`.home-best-sellers.offers-rail` según `audit-metrics.json`, y la grilla `.product-card`), uno de ellos con altura colapsada.
- **Tipo:** visual + probable bug de render (ver **F-01**).
- **Impacto:** la sección más comercial de la home parece rota.
- **Corrección recomendada:** un único componente de tarjeta con dos densidades (`rail` y `grid`) sobre el mismo markup.

## P1-06 · “Todos” + “0 productos” + carrito con productos — diagnóstico

**Clasificación: problema de arquitectura de información y comunicación visual. NO es un bug de filtros, ni de render, ni de estado.**

- **Evidencia:** `catalog-empty-390x844.png`. El buscador contiene la consulta `zzzzqqq`; el H1 dice **“Todos”**; el chip **“Todos” está activo en rojo**; el contador dice **“0 productos”**; el carrito muestra 1 producto ($ 17.100) — en la imagen descrita por el encargo, 4.
- **Causa verificada en código:**
  - `js/ui.js:986` → `setText('[data-catalog-title]', activeCategoryName())`. **El título refleja siempre la categoría y nunca la búsqueda activa.**
  - `js/ui.js:987-991` → el contador sí refleja el resultado filtrado (categoría ∩ consulta). El cálculo es correcto.
  - `js/ui.js:1017-1046` → el empty state distingue correctamente favoritos / búsqueda / categoría y da el copy adecuado. **La lógica funciona.**
  - El carrito es un objeto global y persistente: 4 productos guardados con 0 resultados de búsqueda es semánticamente correcto.
- **Por qué se percibe como contradicción — cinco factores concurrentes:**
  1. El H1 dice “Todos” mientras el filtro real es “Todos ∩ zzzzqqq”.
  2. El chip “Todos” sigue en rojo/activo, reforzando “no hay ningún filtro aplicado”.
  3. El contador “0 productos” está ~250px por encima del mensaje que explica la causa, separado por la barra de orden a ancho completo.
  4. El empty state no nombra la consulta ni ofrece “Limpiar búsqueda”: sólo “Ver todo el catálogo”, cuyo rótulo no dice que también borra la búsqueda.
  5. La barra roja de carrito, adyacente al contador, hace leer ambos números como un mismo sistema.
- **Impacto:** el usuario concluye que la tienda está vacía o rota, con productos ya en el carrito.
- **Corrección recomendada (implementada en el prototipo):** con consulta activa, el H1 pasa a ser **la consulta entre comillas**; ninguna categoría figura como activa; aparece un **chip de búsqueda removible** antes de las categorías; el contador se lee `0 productos en Gaseosas`; la barra de orden se oculta con 0 resultados; el empty state nombra la consulta y ofrece **“Limpiar búsqueda”** como acción primaria más sugerencias de categoría. Ver `screenshots/catalog-mobile-empty-390x844.png`.
- **Prueba requerida:**
  1. Con `searchQuery ≠ ''`, `[data-catalog-title]` contiene la consulta y **ningún** `[data-category-id]` tiene estado activo.
  2. Con 0 resultados y búsqueda activa, existe un control accesible cuyo nombre es “Limpiar búsqueda” y al activarlo `searchQuery === ''` y el contador vuelve a 22.
  3. Con 0 resultados, la barra de orden no está en el árbol de accesibilidad.
  4. El contador del carrito es independiente del filtro (regresión: agregar 4 productos, buscar `zzzzqqq`, el carrito sigue en 4).

## P1-07 · El packshot ocupa ~15% de la tarjeta

- **Evidencia:** `catalog-390x844.png` — botella de ~50×100 CSSpx dentro de una tarjeta de 173×330.
- **Causa probable (verificada):** `.product-card { grid-template-rows: 190px minmax(78px,1fr) 62px; min-height: 330px }` (`catalog.css:218-223`) + `.thumb-img { padding: 11%; object-fit: contain }` (`catalog.css:271-279`). En una caja **ancha y baja** (173×190) con `contain`, una botella vertical ajusta por altura y desperdicia todo el ancho; el `padding: 11%` (≈19px por lado) le quita otro 22%.
- **Cálculo:** área útil de imagen ≈ 60×148 = 8.880px² sobre 173×330 = 57.090px² → **15,5%**.
- **Corrección recomendada:** media **cuadrada** por `aspect-ratio: 1/1` (sin altura fija), `padding: 4px`, pie compacto. Resultado: tarjeta ~171×292 con el producto ocupando ~55% del ancho y ~58% del alto del media. La percepción de “tienda” cambia por completo (comparar `catalog-mobile-390x844.png`).
- **Hallazgo de assets relevante:** los packshots de TABA son **WebP con fondo blanco horneado**, no transparente. Cualquier fondo tintado, “estante” o degradado detrás del producto queda **tapado por el propio bitmap**. La superficie del media debe ser blanca y el encuadre debe darlo el borde. Un fondo tintado exigiría reproducir los 22 assets con canal alfa: es una tarea de assets, no de CSS.

## P1-08 · La tarjeta de dirección desperdicia un viewport y trunca

- **Evidencia:** `home-390x844.png` — tarjeta de ~92px con “ENVIAR A  Elegí tu dirección al confirmar el pe…”. `audit-metrics.json` lo confirma: `strong "Elegí tu dirección al confirmar el pedid" scroll:244 client:169`.
- **Corrección recomendada:** integrar la dirección al app bar como control de 44px con etiqueta pequeña + valor truncado + chevron (patrón fila-valor-chevron de la imagen 4, adaptado). Ahorra ~92px y mantiene el acceso.

## P1-09 · Categorías como tarjetas de 105px con etiquetas de 10px

- **Evidencia:** `home-390x844.png` y `catalog-390x844.png`; `audit-metrics.json` mide `font-size: 10` en “Gaseosas”, “Mixers”, “Energizantes”, “Cervezas”.
- **Impacto:** consumen ~105px de altura, sólo muestran 4 categorías con la cuarta cortada, y el texto está por debajo del mínimo legible.
- **Corrección recomendada:** chips de 44px, scroll horizontal con máscara de continuidad, etiqueta de 13px. Ahorro ~60px y se ven 5 categorías.

## P1-10 · Duplicación visual entre Inicio y Catálogo

- **Evidencia:** ambas pantallas repiten hero + buscador + categorías + rail de productos con estilos y componentes distintos.
- **Impacto:** el usuario no distingue en qué pantalla está; se duplica el costo de mantenimiento.
- **Corrección recomendada:** Inicio = descubrimiento (un buscador, categorías, 2 rails curados). Catálogo = búsqueda y filtro (toolbar persistente, grilla). Los componentes de tarjeta y chip son los mismos; cambia la composición.

## P1-11 · Dos productos distintos se muestran idénticos

- **Evidencia (dato real del catálogo):** `speed-original-lata-473ml` y `speed-zero-lata-473ml` se renderizan ambos como **“Speed Unlimited · Lata · 473 ml · Unidad · $ 2.925”**. Nombre, presentación y precio idénticos: el cliente no puede distinguir la versión Zero.
- **Tipo:** datos de producto + presentación.
- **Corrección recomendada:** la variante ya existe en el identificador (`-original` / `-zero`). Exponerla como línea de variante o sufijo de nombre (“Speed Unlimited Original” / “Speed Unlimited Zero”) — es **mostrar dato existente, no inventar dato**. Añadir una validación de catálogo que falle ante `(nombre, presentación)` duplicado.
- **Prueba requerida:** test de datos: `assert(new Set(products.map(p => p.name+'|'+p.presentation)).size === products.length)`.

---

# P2 — Inconsistencias de sistema

## P2-01 · Se declara la tipografía Inter y nunca se sirve

- **Evidencia:** `styles/tokens.css:24` → `--font-sans: Inter, ui-sans-serif, system-ui, …`. Búsqueda en `styles/`, `styles.css` e `index.html`: **cero `@font-face`, cero `fonts.googleapis`, cero `fonts.gstatic`**. Los únicos `<link rel="stylesheet">` son `maplibre-gl.css` y `styles.css`.
- **Impacto:** el diseño se ve distinto en cada plataforma (Segoe UI en Windows, Roboto en Android, SF en iOS) con métricas verticales, altura de x y ancho diferentes. Todo el ajuste tipográfico hecho sobre un dispositivo se rompe en los demás.
- **Corrección recomendada:** **quitar `Inter` del stack** y declarar sólo fuentes del sistema, ordenadas por plataforma real. Justificación: TABA es una PWA para Android de gama media sobre red móvil en Neuquén; un subset variable de Inter suma ~60-90KB y riesgo de FOIT/FOUT sin ganancia de identidad, y la app **ya** se ve con fuente de sistema, así que nada regresa. Los números se resuelven con `font-variant-numeric: tabular-nums`, disponible en las tres. Si más adelante se decide una tipografía propia, el token es el único punto de cambio y debe auto-hospedarse con `font-display: swap` + `preload`.

## P2-02 · Escala de z-index arbitraria

- **Evidencia:** 1000 (topbar) · 1150 (nav) · 1200 (carrito) · 3000 (toast) · 500 (mapa sandbox) · 40 (panel sandbox) · 8 (button-row del checkout).
- **Corrección recomendada:** escala documentada de 9 niveles (0/100/200/300/400/500/510/600/700). Ver `design-system/TOKENS.md`.

## P2-03 · Radios y sombras excesivos

- **Evidencia:** `--radius-lg: 24px`, `.product-card { border-radius: 22px }`, `--shadow-md: 0 18px 48px`. Produce el aspecto “plantilla flotante”.
- **Corrección recomendada:** radios 6/10/14/18 + pill; el borde de 1px hace el trabajo de separación y la sombra queda como apoyo (`0 1px 2px` / `0 4px 12px`), reservando `0 12px 32px` para modales.

## P2-04 · Contraste: el verde sí cumple; los bordes de campo no

- **Medición calculada, no estimada:** `--taba-success: #18864b` da **4,55:1** sobre `#fffdfb` y **4,61:1** sobre blanco puro. **Cumple AA para texto normal.** Se corrige aquí una estimación previa de esta misma auditoría que lo daba por debajo del umbral.
- **Lo que sí es un hallazgo real:** WCAG 1.4.11 exige **3:1** al límite visual que identifica un componente de interfaz. Un borde de campo del orden de `#d7dbe1` da **1,39:1** sobre blanco: para baja visión, el área de entrada no se distingue del fondo. Aplica a los campos de búsqueda, a los inputs del checkout y a cualquier control cuyo borde sea su único límite.
- **Y un tercer punto medido:** un gris atenuado `#6c7480` sobre superficie `#f5f7f9` da **4,40:1** — por debajo de AA para texto normal.
- **Corrección recomendada:**
  - Verde: pasar a `#0f7a3d` (**5,35:1**) para tener margen a 12px, y mantener siempre punto + texto.
  - Campos: token de borde dedicado `#878f9d` (**3,26:1** sobre blanco). Los botones secundarios con rótulo visible pueden conservar el borde tenue: su identificación no depende del borde.
  - Texto atenuado sobre superficie gris: `#656d79` (**4,87:1**).
- **Prueba requerida:** cómputo automático de contraste sobre la tabla de tokens en CI — matriz texto×superficie y borde×superficie — en lugar de revisión visual. Toda la paleta propuesta se validó así; los números están en `design-system/TOKENS.md`.

## P2-05 · Rojo de marca y rojo de error indistinguibles

- **Evidencia:** `--taba-red: #d0000d` vs `--taba-danger: #c51620`.
- **Corrección recomendada:** mantener ambos pero **diferenciar por tratamiento**: rojo relleno = acción primaria; rojo con contorno + icono de alerta + rótulo = destructivo/error. La distinción no puede depender del matiz.

## P2-06 · Cadena de 11 `@import` en `styles.css`

- **Evidencia:** `styles.css:1-11`.
- **Impacto:** cascada de descargas en serie que bloquea el render; en 3G se nota.
- **Corrección recomendada:** concatenar en build (esbuild ya es dependencia) o pasar a `<link>` paralelos.

## P2-07 · Regla global gigantesca en el archivo raíz

- **Evidencia:** `styles.css`, bloque `@media (hover:none),(pointer:coarse)` con ~35 selectores enumerados para aplicar `touch-action: manipulation`.
- **Corrección recomendada:** aplicar por clase base de componente (`.t-btn`, `.t-chip`, `.t-row`…), no por enumeración.

## P2-08 · El carrito vacío ocupa el 55% del app bar

- **Evidencia:** `catalog-390x844.png` — “Mi pedido $ 0” con badge “0”.
- **Corrección recomendada:** icono con badge que sólo aparece con contenido; el resumen vive en la barra sticky, que **no existe** si el carrito está vacío.

## P2-09 · Barra de orden a ancho completo casi vacía

- **Evidencia:** `catalog-390x844.png` — píldora de ~68px con el control alineado a la derecha y ~70% vacío.
- **Corrección recomendada:** control de orden en la fila del título; se recupera un renglón completo.

---

# P3 — Pulido

- **P3-01** · `--taba-warm-white: #fffefa` casi no se usa; el fondo dominante es blanco puro y negro. Definir roles de superficie explícitos.
- **P3-02** · El corazón de favoritos es un círculo blanco sobre fondo blanco: sin contraste de superficie.
- **P3-03** · Los `min-height` encadenados del cuerpo de la tarjeta (`h3:38` + `p:16` + `availability:16`) inflan la altura aun con contenido corto.
- **P3-04** · La nav inferior flotante en píldora deja ver contenido deslizándose por debajo; una barra a sangre con hairline es más limpia y cuesta 48px menos de reserva.
- **P3-05** · `scroll-behavior: smooth` global sin `prefers-reduced-motion`; sí existe el ajuste de `font-size:16px` para inputs táctiles, que es correcto y debe conservarse.

---

# Bugs funcionales probables

| # | Síntoma | Hipótesis | Cómo confirmarlo |
|---|---|---|---|
| **F-01** | Fila de tarjetas colapsadas en “Los más vendidos” (imagen 2 / `detail-bestsellers-390.png`) | El rail (`.home-best-sellers.offers-rail`) renderiza antes de tener datos completos, o su tarjeta usa una plantilla distinta que no reserva altura y colapsa al fallar la imagen | Instrumentar el render del rail y comparar el markup emitido contra el de la grilla; test de estabilidad a 400/900/2500ms (ya existen capturas `stability-home-*` que sugieren que se investigó) |
| **F-02** | Contenido tapado por el stack inferior | Reserva calculada con token no resuelto (P0-01) | Test de intersección al final del scroll |
| **F-03** | El control de cantidad tapa el título | Offset absoluto de 136px acoplado a filas fijas (P0-02) | Test de intersección de rects con nombres largos |
| **F-04** | Dos productos indistinguibles en el catálogo | Variante presente en el id pero ausente en el nombre visible (P1-11) | Validación de unicidad `(nombre, presentación)` |

---

# Rider web actual — qué migrar a Android

Inspección de superficie (`index.html:458-...`, `styles/rider.css`, 352 líneas). La vista rider web es un **panel operativo dentro de la misma PWA**, con acceso por PIN en modo demo y por credenciales en producción.

| Elemento | Estado | Destino |
|---|---|---|
| Lista de entregas | Reutilizable como concepto | Android: lista de trabajos con una acción primaria |
| Pedido asignado | Reutilizable | Android: pantalla de detalle con recorrido en 3 pasos |
| Mapa | MapLibre desde CDN (`unpkg`) | Android: MapLibre nativo, estilo auto-hospedado |
| Estados | Reutilizable, hay que **formalizarlo** | `RIDER_ANDROID_STATE_MACHINE.md` |
| Código de entrega | Contrato válido, conservar | Android: teclado numérico propio, 4 casilleros grandes |
| GPS | Depende de la pestaña abierta | Android: foreground service con notificación persistente |
| Navegación | Dentro del shell de la PWA | Android: stack propio |
| Offline | No hay cola durable | Android: outbox en SQLite con idempotencia |
| Interacción en movimiento | Controles pequeños, mucha información simultánea | Android: una decisión por pantalla, deslizar para confirmar acciones irreversibles |
| Información excesiva | Sí | Android: sólo lo necesario para el paso actual |

**Riesgo transversal:** la vista rider web comparte CSS global con cliente y negocio (`styles.css` importa `rider.css` junto a todo lo demás). Cualquier cambio de tokens afecta las tres superficies a la vez. Ver `audit/CSS_RISK_MAP.md`.
