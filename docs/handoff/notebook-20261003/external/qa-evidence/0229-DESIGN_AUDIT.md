# TABA — Auditoría visual y de comportamiento

**Fecha:** 2026-07-30
**Base auditada:** `C:\1212\la-taba-catalog-checkout-premium`
**Rama:** `feature/catalog-checkout-premium`
**HEAD:** `4197bdbc1df7d3eb1328afc4a7a01e1067f14316`
**Estado:** worktree con cambios sin commitear de otro agente (Codex) en curso.
**Modo de trabajo:** sólo lectura. No se modificó ningún archivo del repositorio.

---

## 0. Nota sobre la evidencia

### 0.1 Las cinco imágenes adjuntas no llegaron

El pedido referencia cinco capturas adjuntas. **Ninguna imagen llegó a esta
conversación.** No se auditó "a ciegas" ni se inventó su contenido: en su lugar
se generó evidencia propia y reproducible ejecutando la aplicación real con
Playwright en los seis breakpoints obligatorios.

Esa evidencia **confirma de forma independiente casi todos los síntomas
descritos** en el enunciado (categorías gigantes, packshots chicos, carrito
sticky compitiendo con la barra inferior, "PREVIEW INTERNA" expuesta, panel de
escritorio comprimido en móvil). Donde el enunciado anticipaba un problema que
la medición **no** confirmó, se dice explícitamente (ver §4).

Si las cinco imágenes se adjuntan en un próximo turno, se puede contrastar
contra esta línea de base sin rehacer el trabajo.

### 0.2 Cómo se produjo la evidencia

- Servidor estático **de sólo lectura** propio en `127.0.0.1:8791`
  (`tools/static-server.mjs`). No se tocó el frontend del otro agente en `:8080`,
  ni relay, ni túnel, ni Docker, ni Supabase.
- Capturas y mediciones: `tools/capture-current.mjs`, `tools/measure-current.mjs`,
  `tools/probe-bestsellers.mjs`, `tools/probe-home-stability.mjs`.
- Salidas: `screenshots/current/*.png`, `audit-metrics.json`, `measurements.json`.

Toda cifra de este documento sale de una medición en el navegador, no de una
lectura del CSS. Donde sólo hay lectura de código, se indica.

---

## 1. Qué muestran las capturas

### 1.1 Tabla de hechos medidos

| Métrica | 320×568 | 390×844 | 430×932 | 768×1024 | 1280×900 | 1440×1000 |
|---|---|---|---|---|---|---|
| Primera tarjeta de producto (y) | 494 px | 495 px | 498 px | 485 px | 486 px | 486 px |
| **Primer precio del catálogo (y)** | **813 px** | **798 px** | 801 px | 791 px | 792 px | 792 px |
| **Precios visibles sin scrollear** | **0 / 22** | **0 / 22** | 2 / 22 | 2 / 22 | 4 / 22 | 4 / 22 |
| Banda inferior fija (nav + carrito) | **28 %** | 17 % | 15 % | 14 % | 15 % | 14 % |
| Nav de secciones del negocio oculta | **61 %** | **53 %** | 48 % | 6 % | 0 % | 0 % |
| Pestañas de la bandeja ocultas | **66 %** | **59 %** | 54 % | 17 % | 0 % | 0 % |
| Tira de categorías del catálogo oculta | 48 % | 37 % | 30 % | — | — | — |
| Deriva del control de cantidad | **+14 px** | −2 px | −2 px | −4 px | −4 px | −4 px |

Cero overflow horizontal en todos los breakpoints. Cero controles interactivos
por debajo de 44 px. Ambas cosas están bien y **no** hace falta arreglarlas.

### 1.2 El hallazgo comercial principal

**En 320×568 y 390×844 no hay un solo precio visible sin scrollear.**

En 390×844 el primer precio está en `y = 798` sobre un viewport de 844 px, y la
banda inferior fija empieza en ~700 px. El cliente ve, en su primera pantalla:
barra negra, kicker "CATÁLOGO", un H1 gigante, un buscador de 64 px, cuatro
fichas de categoría de 102 px, el contador "22 productos", un selector de orden
de 52 px, y recién ahí el borde superior de dos tarjetas cuyo precio queda
fuera. Un catálogo de bebidas que no muestra un precio en la primera pantalla
no está vendiendo.

Desglose vertical real en 390×844 hasta la primera tarjeta (495 px de 844):

| Bloque | Alto |
|---|---|
| Topbar negro | 70 px |
| Kicker "CATÁLOGO" | 28 px |
| H1 (`clamp(28px, 7.5vw, 42px)`) | 76 px |
| Buscador (`min-height: 64px`) | 82 px |
| Tira de categorías (`min-height: 102px`) | 114 px |
| Contador + barra de orden | 105 px |
| **Total antes del primer producto** | **495 px (59 % del viewport)** |

### 1.3 Catálogo móvil

1. **Doble encabezado sin información.** "CATÁLOGO" (kicker rojo) + H1 con el
   nombre de la categoría ("Todos"). Dos líneas y ~104 px para decir lo que la
   pestaña activa ya dice.
2. **Fichas de categoría de 88×102 px**, con 37 % de la tira fuera de pantalla
   en 390 px y **sin ninguna señal de que se puede desplazar**.
3. **Packshot chico dentro de una tarjeta grande.** La fila de imagen mide
   150 px, pero `.thumb-img` aplica `padding: 11%` y `object-fit: contain` sobre
   una botella (formato alto y angosto). El resultado es una botella de ~90 px
   dentro de una caja de 175×150 px: más de la mitad de la tarjeta es blanco.
4. **Selector de orden desbalanceado.** A ≤560 px la barra pasa a columna, el
   `.sort-field` toma `flex: 1` con `justify-content: flex-end` y el texto
   "Ordenar por" se oculta. Queda una píldora de ancho completo con todo
   apelotonado a la derecha y ~200 px de vacío a la izquierda.
5. **El "+" flota en tierra de nadie**, separado tanto de la imagen como del
   precio, sin pertenecer visualmente a ninguno de los dos.
6. **La barra inferior tapa la última fila de tarjetas** en todos los anchos de
   teléfono.

### 1.4 Carrito sticky y barra inferior

En 320×568 con el carrito activo, **el 28 % del viewport es superficie fija
permanente**. El apilado es: barra de navegación (66 px de alto, a 10 px del
borde) + 14 px de aire + carrito flotante (52 px). La aritmética de los tokens
da bien y **no hay solapamiento real** entre las dos barras — el problema no es
que se pisen, es que **juntas se comen más de un cuarto de la pantalla** en el
teléfono más chico, y en el estado vacío empujan el CTA "Ver todo el catálogo"
contra el borde del carrito.

### 1.5 Estado vacío

- El mensaje y el CTA existen y son correctos ("No encontramos esa bebida." /
  "Ver todo el catálogo"). **No está oculto** — el enunciado sospechaba que sí.
- Pero: se conserva **todo el cromo** (buscador, categorías, contador,
  selector de orden) para una pantalla con cero resultados. **El selector
  "Recomendados" sigue activo sobre 0 productos**, lo cual no significa nada.
- La ficha de categoría "Todos" sigue en rojo activo mientras el resultado es
  vacío: el chip contradice el resultado.
- No hay ilustración, ni sugerencias, ni una acción para limpiar sólo el
  buscador conservando la categoría.

### 1.6 Inicio

- **"PREVIEW INTERNA"** en ámbar, al lado de "CATÁLOGO", visible para cualquier
  visitante (ver §3.1).
- La dirección se trunca a mitad de palabra: "Elegí tu dirección al confirmar el
  pe…".
- **Las categorías de Inicio y de Catálogo no coinciden.** Inicio muestra
  Gaseosas / Mixers / Energizantes / Cervezas. Catálogo muestra Todos /
  Favoritos / Gaseosas / Mixers. Son dos componentes distintos
  (`.home-category-card` y `.category-button`) con dos fuentes de datos y dos
  estéticas.
- "Los más vendidos": tarjetas de 190×78 px con la imagen en una columna de
  **44 px de ancho**. El packshot es un sello, no un producto.
- La segunda tarjeta del rail queda cortada contra el borde derecho sin
  affordance de scroll.

### 1.7 Panel del negocio en móvil

Es la superficie más dañada. En 390×844:

- **No hay navegación.** `responsive.css:1-10` oculta con `!important` la nav
  inferior, la nav de escritorio, las acciones del topbar y el carrito para
  `body[data-active-view="business"]`. La única navegación que queda son dos
  tiras horizontales que **están cortadas**.
- **La nav de secciones oculta el 53 %**: se ven Pedidos / Métricas / Reportes /
  Caja; quedan fuera Catálogo, Promociones, Configuración y Guía. En 320 px se
  oculta el 61 % y el primer ítem invisible es "Caja".
- **Las pestañas de la bandeja ocultan el 59 %**: el primer estado fuera de
  pantalla es **"En preparación"**, que es donde vive la operación real.
- **Cuatro fichas de estadística en 2×2 consumen ~390 px** para mostrar cuatro
  ceros. Antes del primer pedido hay: título, dos acciones secundarias, fecha,
  sonido, 4 fichas, 2 tiras de pestañas y un buscador.
- "Nuevos pendientes 0" y "Buscar pedido" quedan desalineados en la misma fila
  flex.
- El toast se dibuja encima del contenido sin posición segura.

### 1.8 Panel del negocio en escritorio

El problema es el opuesto y **es igual de grave**: a 1280×900 el panel es **una
sola columna centrada**. Cuatro fichas estiradas a ~440 px cada una para
mostrar un dígito, dos tiras de pestañas de ancho completo, y por debajo
**~500 px de blanco vacío**. No hay sidebar, ni cola, ni inspector, ni densidad.
Es el layout móvil estirado.

---

## 2. Qué problemas son puramente visuales

Se arreglan con CSS y no cambian comportamiento ni contrato de datos.

| # | Problema | Dónde |
|---|---|---|
| V1 | H1 del catálogo a `clamp(28px, 7.5vw, 42px)` + kicker redundante | `styles/catalog.css:9-23` |
| V2 | Buscador de 64 px de alto | `styles/catalog.css:25-31` |
| V3 | Fichas de categoría de 88×102 px | `styles/catalog.css:67-77` |
| V4 | `padding: 11%` en el packshot achica la botella | `styles/catalog.css:271-279` |
| V5 | Barra de orden a ancho completo con todo a la derecha | `styles/responsive.css:577-593` |
| V6 | Fichas de estadística de 84 px de alto en móvil | `styles/business.css:126-149` |
| V7 | Panel de negocio sin layout de escritorio | `styles/business.css` (no hay `@media min-width`) |
| V8 | Contraste duro topbar negro → contenido blanco | `styles/common.css:22-39` |
| V9 | Tarjeta con mucho blanco (`min-height: 316px`, `190px` de media) | `styles/catalog.css:218-231, 514-556` |
| V10 | "PREVIEW INTERNA" a `font-size: 8px` | `styles/storefront.css:631-637` |
| V11 | Rojo como color de estado activo *y* de acción primaria *y* de precio | transversal |

---

## 3. Qué problemas parecen bugs funcionales

Estos **no** se arreglan moviendo píxeles.

### 3.1 `PREVIEW INTERNA` es incondicional y está fijada por un test — **crítico**

```html
<!-- index.html:132-135 -->
<p class="taba-home-eyebrow">
  <span>CATÁLOGO</span>
  <span class="home-preview-label">PREVIEW INTERNA</span>
</p>
```

No está detrás de `isDemoMode()`, ni de `data-demo-only`, ni de ninguna
condición. Se renderiza en el shell HTML para **todo** visitante, incluido el
despliegue público de GitHub Pages.

Y está **bloqueado por una aserción de e2e**:

```js
// tests/e2e/beverage-storefront.spec.mjs:21
await expect(page.locator('.home-preview-label')).toHaveText('PREVIEW INTERNA');
```

Quitarlo del cliente exige actualizar ese test en el mismo commit. Es una fuga
de identidad interna hacia el cliente final, no un detalle estético.

### 3.2 `aria-current="page"` se aplica a botones de contenido — **alto**

```js
// js/ui.js:219-227
$$('[data-nav-view]').forEach((control) => {
  const isActive = control.dataset.navView === activeView;
  control.classList.toggle('active', isActive);
  if (isActive) control.setAttribute('aria-current', 'page');
  ...
});
```

El selector toma **todos** los `[data-nav-view]` del documento, no sólo los de
la barra de navegación. Con `activeView === 'catalog'` reciben `.active` y
`aria-current="page"` al mismo tiempo:

- el botón de la nav inferior (correcto),
- el CTA de contenido "Ver catálogo completo" (`index.html:199`),
- el botón "Seguir comprando" del carrito (`index.html:260`).

Múltiples `aria-current="page"` simultáneos rompen el anuncio del lector de
pantalla, y un CTA de contenido hereda el estilo de "sección activa".

### 3.3 En la vista carrito no hay ningún ítem de navegación activo — **medio**

La nav inferior tiene cuatro botones: `home`, `catalog`, `tracking`, `profile`.
No hay `data-nav-view="cart"`. Pero `cart` **es** una vista real y el
`:is(...)` de `responsive.css:1263` la incluye para estilarla. Al entrar al
carrito, `renderNavigation('cart')` no encuentra coincidencia y **la barra
queda sin selección**. Es exactamente la "navegación activa confusa" del
enunciado.

### 3.4 `--taba-border-strong` no existe — **medio**

```css
/* styles/business.css:264 */
.production-rider-assignment select { border: 1px solid var(--taba-border-strong); }
```

Medido en el navegador: `--taba-border-strong` resuelve a **`(UNDEFINED)`**. Es
la única aparición en todo el repositorio. Un `var()` inválido dentro del
shorthand `border` invalida la declaración completa, así que **el selector de
asignación de rider se queda sin borde**. `tokens.css` define `--taba-border`,
`--taba-border-soft` y `--taba-border-medium`, pero no `-strong`.

### 3.5 Salto de layout de +451 px en Inicio — **medio**

Medido (`tools/probe-home-stability.mjs`):

| t | Tarjetas en el rail | Alto del documento |
|---|---|---|
| 400 ms | 0 | 877 px |
| 900 ms | 3 | **1328 px** |
| 2500 ms | 3 | 1328 px |

El rail de "Los más vendidos" está vacío hasta ~900 ms y al poblarse empuja el
documento **451 px (+51 %)**. No hay skeleton ni alto reservado. Si el cliente
toca algo en esos 900 ms, toca otra cosa.

### 3.6 El control de cantidad se despega de la imagen en 320 px — **medio**

`.product-media-control` está en `position: absolute` con `bottom: 166px`
medido **desde el fondo de la tarjeta**, no desde el borde de la imagen:

```css
/* styles/catalog.css:252-257 + 537-540 */
.product-media-control { position: absolute; right: 10px; bottom: 136px; }
@media (max-width: 560px) { .product-media-control { right: 8px; bottom: 166px; } }
```

La tarjeta es `grid-template-rows: 150px minmax(74px,1fr) 92px` con
`min-height: 316px`, pero la fila del medio es `1fr` y la tarjeta tiene
`height: 100%`: **crece hasta la tarjeta más alta de la fila**. Medido:

- 390–1440 px → tarjeta de 339–347 px, desfase **−2 a −4 px** (correcto).
- **320 px → tarjeta de 355 px, desfase +14 px**: el "+" cae por debajo del
  borde de la imagen, encima del nombre del producto.

Cualquier nombre largo que estire una fila reproduce el defecto en cualquier
ancho. Es un acoplamiento por número mágico, no un problema de estética.

### 3.7 Reglas muertas por orden de cascada en `responsive.css` — **medio**

`@media (max-width: 820px)` aparece **cinco veces** (líneas 61, 721, 865, 1091,
1111), `max-width: 560px` **tres veces**, `max-width: 360px` **dos**. El
comportamiento depende del orden en el archivo, no de la especificidad. Efecto
concreto:

| Selector | Regla temprana | Regla tardía (gana) |
|---|---|---|
| `.taba-home-hero h1` | `:741` `clamp(31px, 9.6vw, 40px)` | `:1176` `clamp(27px, 7.3vw, 31px)` |
| `.taba-home-search` | `:753` `min-height: 52px` | `:1188` `height: 50px` |
| `.home-category-card` | `:761` `min-width/height: 84px` | `:1201` `min-width: 72px; min-height: 40px` |

Las reglas tempranas son **código muerto que aparenta estar vigente**. Quien lea
`:741` va a creer que el H1 mide 40 px cuando mide 31.

> Nota de honestidad: el `min-height: 40px` de `:1201` **no** produce un target
> menor a 44 px en la práctica — la medición no encontró ningún control por
> debajo de 44 px. El `padding-block` y el contenido lo empujan por encima. Es
> deuda de mantenimiento, no un defecto de accesibilidad hoy.

### 3.8 `body { overflow-x: hidden }` enmascara desbordes — **bajo**

`tokens.css` lo aplica en `html` y `body`. Hoy no hay overflow horizontal en
ningún breakpoint, pero la regla garantiza que un desborde futuro **no se vea**
en vez de fallar visiblemente. Además puede romper `position: sticky` en
descendientes según el contenedor de scroll.

### 3.9 CSS muerto: `.icon-store` — **bajo**

`responsive.css:182-189` estila `.icon-store`. Ningún botón de la nav lo usa
(los cuatro son home / catalog / track / profile).

---

## 4. Sospechas del enunciado que la medición **no** confirmó

Se listan para que nadie gaste tiempo en ellas.

| Sospecha | Veredicto |
|---|---|
| "Carrito sticky tapando precios o mensajes" | **No.** La aritmética de tokens deja 14 px de aire real entre carrito y nav. El problema es el **área total** (28 % en 320 px), no un solapamiento. |
| "Estado 0 productos parcialmente oculto" | **No.** Se ve completo. El problema es el cromo que sobrevive alrededor. |
| "Overflow horizontal" | **No.** Cero desborde en los seis breakpoints. |
| "Controles menores a 44 px" | **No.** Cero controles por debajo de 44 px. |
| "Tarjetas de 'Los más vendidos' vacías / rotas" | **No.** Contienen nombre y precio. Lo que se ve vacío en una captura temprana es el salto de layout de §3.5. |
| "Barra inferior y carrito compitiendo por el mismo espacio" | **Parcial.** No se pisan; sí compiten por el presupuesto vertical. |

---

## 5. Auditoría de código

### 5.1 Componentes reutilizables (conservar)

| Componente | Archivo | Nota |
|---|---|---|
| Capa de tokens | `styles/tokens.css` | Base sólida: paleta, radios, sombras, escala de espacio, `--tap: 44px`. |
| `.product-card` | `styles/catalog.css:218` | Estructura correcta; el problema son las proporciones. |
| `.qty-stepper` / `.quantity-control` | `styles/catalog.css:428-464` | Grilla `44px 1fr 44px` bien resuelta. |
| `.empty-state` | `styles/common.css:418-444` | Genérico y reutilizable. |
| `.stat-tile` | `styles/business.css:126` | Sirve como base del resumen operativo. |
| `.rt-chip` (sincronización) | `js/business.js:262-280` | Ya modela conectado / reconectando / sin conexión. |
| `.sr-only` | `styles/common.css:10-20` | Correcto. |

### 5.2 Duplicaciones

1. **Dos sistemas de categorías**: `.home-category-card` vs `.category-button`
   (`[data-view="catalog"]`), con datos y estética distintos.
2. **Dos sistemas de tarjeta de producto**: `.product-card` (grilla) vs
   `.home-best-card` / `.home-catalog-card` / `.offer-card` (rails).
3. **Tres familias de pestañas** con reglas idénticas:
   `.business-jump-nav`, `.inbox-tabs`, `.report-period-tabs`
   (`styles/business.css:86-116`).
4. **Media queries repetidas** (§3.7).
5. **Dos títulos "¿Qué vas a pedir hoy?"**: uno en Inicio (`index.html:136`) y
   otro como valor por defecto del catálogo (`index.html:215`), este último
   reemplazado en runtime por `activeCategoryName()` (`js/ui.js:986`). El shell
   muestra el título equivocado hasta que hidrata.

### 5.3 CSS global peligroso y selectores demasiado amplios

| Patrón | Archivo | Riesgo |
|---|---|---|
| `body { overflow-x: hidden }` | `tokens.css:76-86` | Oculta desbordes; puede romper `sticky`. |
| `h1,h2,h3,strong { overflow-wrap: anywhere }` | `tokens.css` | Corta palabras a mitad en cualquier título. |
| `.example-data-banner, .demo-guide { display: none !important }` | `business.css:453-456` | `!important` global sobre componentes completos. |
| `body[data-active-view="business"] … { display: none !important }` | `responsive.css:1-10` | Deja el panel **sin navegación** en móvil. |
| `body:is([data-active-view="home"],[…="catalog"],[…="cart"],[…="profile"]) .mobile-nav` | `responsive.css:1263+` | Repetido 4 veces; altísima especificidad, muy difícil de sobrescribir. |
| `.product-grid { repeat(4, …) }` como base | `catalog.css:207-212` | Desktop-first: móvil depende de sobrescribir. |
| `.business-stat-grid { repeat(4, …) }` como base | `business.css:118-124` | Ídem. |

### 5.4 Acoplamientos

- `.product-media-control { bottom: 166px }` acoplado por número mágico a
  `grid-template-rows` de `.product-card` (§3.6).
- `--taba-bottom-nav-clearance` se calcula con `--taba-bottom-nav-height: 76px`,
  pero la nav renderizada mide 66 px de alto a 10 px del borde. La suma **da
  76 px por coincidencia**. Cambiar `bottom: 10px` desalinea todo el apilado en
  silencio.
- `renderNavigation()` acopla navegación y contenido por el atributo
  `data-nav-view` (§3.2).
- `js/business.js` (104 KB) concentra render, estado y eventos de nueve
  secciones en un solo `innerHTML`.

### 5.5 Archivos que probablemente haya que modificar

| Archivo | Alcance |
|---|---|
| `styles/tokens.css` | Agregar `--taba-border-strong`, tokens de superficie y de barra inferior. |
| `styles/business.css` | Reescritura mobile-first + capa desktop nueva. |
| `styles/catalog.css` | Proporciones de tarjeta, packshot, categorías, encabezado. |
| `styles/responsive.css` | Consolidar media queries duplicadas. |
| `styles/storefront.css` | Inicio: hero, rails, chip de dirección. |
| `index.html` | Quitar `PREVIEW INTERNA`; alinear el título por defecto del catálogo. |
| `js/ui.js` | Acotar `renderNavigation` a la barra de navegación; skeletons. |
| `js/business.js` | Estructura de secciones agrupadas + detalle de pedido. |
| `tests/e2e/beverage-storefront.spec.mjs` | Quitar la aserción de `PREVIEW INTERNA`. |

### 5.6 Archivos que **no** deberían tocarse

`styles/tracking.css` (64 KB, recién estabilizado en `feature/tracking-onthe-way-premium-visual`),
`js/map/*`, `js/tracking/*`, `js/realtime.js`, `js/core/realtime-sync.js`,
`scripts/realtime-relay.mjs`, `js/repositories/*`, `js/core/domain.js`,
`js/core/pricing.js`, `js/vendor/supabase.js`, `supabase/`.

---

## 6. Prioridad

| Prioridad | Ítem |
|---|---|
| **P0** | §3.1 `PREVIEW INTERNA` expuesta al cliente |
| **P0** | §1.2 Ningún precio en el primer viewport (320 y 390 px) |
| **P0** | §1.7 Panel del negocio sin navegación usable en móvil (53–66 % oculto) |
| **P1** | §1.8 Panel del negocio sin layout de escritorio |
| **P1** | §3.2 `aria-current` en botones de contenido |
| **P1** | §1.3 Proporción del packshot y densidad de la tarjeta |
| **P2** | §3.5 Salto de layout de +451 px |
| **P2** | §3.3 Vista carrito sin ítem de nav activo |
| **P2** | §3.6 Deriva del control de cantidad |
| **P3** | §3.4 `--taba-border-strong`, §3.7 reglas muertas, §3.8, §3.9 |
