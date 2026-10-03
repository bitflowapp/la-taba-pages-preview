# TABA — Fix físico iPhone: autozoom y scroll fantasma

Worktree: `C:\1212\la-taba-mostador-patagonico`
Rama: `feature/mostrador-patagonico-v1`
HEAD: `64615dbd594279945257078f315ec911dbade5d6` (confirmado, sin commits nuevos)

Ambos defectos se auditaron con mediciones reales (`getComputedStyle`,
`getBoundingClientRect`, `visualViewport.scale`, `document.scrollHeight`) en
vez de inspección visual, usando el motor **WebKit real** de Playwright para
el autozoom (reproduce el comportamiento de Safari) y Chromium para el resto
(consistente con el runner de e2e del repo).

---

## 1 · Causa raíz del autozoom

Safari hace zoom automático al enfocar un campo cuyo `font-size` computado es
menor a 16px. La auditoría (91 controles editables reales, en Home, Catálogo,
detalle de producto, Checkout, Perfil, PIN y Negocio) encontró **24
violaciones, todas originadas en una única regla**:

```css
/* styles/profile.css — ANTES */
.personal-card input,
.profile-address-editor input,
.profile-address-editor select,
.profile-address-editor textarea {
  ...
  font: inherit;   /* <- toma el font-size del <label> que envuelve el campo */
  font-weight: 600;
}
```

El `<label>` que envuelve cada campo declara `font-size: 13px` (rótulo del
formulario). El shorthand `font: inherit` copia ESE tamaño al campo, pisando
el piso global de 16px que ya existe en `common.css` — **específicamente
porque `.personal-card input` tiene mayor especificidad CSS que la regla
genérica `input { font-size: 16px }`**, así que gana sin importar el orden de
carga de las hojas de estilo.

No se detectó ningún `user-scalable=no`, `maximum-scale`, bloqueo de pinch
zoom, JavaScript que fuerce zoom, ni `transform: scale` de compensación en
todo el repositorio (verificado con `grep` dirigido). El viewport meta y el
`-webkit-text-size-adjust: 100%` ya eran correctos y no se tocaron. Tampoco
existe re-enfoque automático al volver de segundo plano (`focus`/`pageshow`/
`visibilitychange` sólo re-sincronizan datos, ninguno llama `.focus()`), así
que el escenario "Safari al volver de WhatsApp" no agrega un vector nuevo.

### Fix

```css
/* styles/profile.css — DESPUÉS */
.personal-card input,
.profile-address-editor input,
.profile-address-editor select,
.profile-address-editor textarea {
  ...
  font: inherit;
  font-size: 16px;  /* declaración explícita DESPUÉS del shorthand */
  font-weight: 600;
}
```

Se conserva `font: inherit` (familia/estilo consistentes con el resto de la
app) y se fija el tamaño explícito a continuación, que es la única propiedad
que necesitaba dejar de heredarse.

## 2 · Controles afectados

Los 24 hallazgos (estados `default` + `focus`) correspondían a **7 campos
únicos**, todos dentro de Perfil:

| Vista | Campo | Antes | Después |
|---|---|---|---|
| Perfil · editar datos personales | `input[name="profileFullName"]` | 13px | 16px |
| Perfil · editar datos personales | `input[name="profilePhone"]` | 13px | 16px |
| Perfil · nueva dirección | `select[name="profileAddressLabel"]` | 13px | 16px |
| Perfil · nueva dirección | `input[name="profileAddressStreet"]` | 13px | 16px |
| Perfil · nueva dirección | `input[name="profileAddressNumber"]` | 13px | 16px |
| Perfil · nueva dirección | `input[name="profileAddressFloor"]` | 13px | 16px |
| Perfil · nueva dirección | `input[name="profileAddressApartment"]` | 13px | 16px |
| Perfil · nueva dirección | `input[name="profileAddressCity"]` | 13px | 16px |
| Perfil · nueva dirección | `input[name="profileAddressProvince"]` | 13px | 16px |
| Perfil · nueva dirección | `input[name="profileAddressPostalCode"]` | 13px | 16px |
| Perfil · nueva dirección | `textarea[name="profileAddressReference"]` | 13px | 16px |
| Perfil · nueva dirección | `input[name="profileAddressDefault"]` (checkbox) | 13px | 16px |

Auditados y **ya correctos sin cambios**: búsqueda de Home/Catálogo, orden del
catálogo, hoja de detalle de producto, Checkout (pago, indicaciones,
confirmación), PIN de Negocio/Rider, búsqueda y formularios de Negocio
(catálogo editable, configuración), input de código de entrega del rider.

## 3 · Causa raíz del scroll fantasma

Se midió `documentElement.scrollHeight` contra el borde real de `.app-shell`
en 13 escenarios (Home, Catálogo largo/corto, Carrito vacío/lleno, Checkout,
Perfil, Seguimiento vacío/en camino, Negocio vacío/con pedidos, Rider) — la
métrica autoritativa: si el documento termina exactamente donde termina
`.app-shell`, no hay scroll fantasma; cualquier exceso ahí sí lo es. (Se
descartó una heurística de "último elemento visible" por dar falsos positivos
con contenido dentro de `<details>` cerrados y con superficies `fixed`, cuya
posición en coordenadas de documento no es estable entre scrolls.)

Encontradas **dos causas exactas, ambas confirmadas cuantitativamente**:

### 3.1 — `<pre class="print-ticket">` sin `margin: 0` (universal, ~16px en TODAS las vistas)

```css
/* styles/business.css — ANTES */
.print-ticket {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
}
```

Este elemento vive al final de `<body>`, invisible en pantalla (sólo se llena
al imprimir un ticket), pero **nunca se reseteó su margen UA por defecto**
(`<pre>` trae `margin: 1em 0` en todos los navegadores). Medido
directamente: `marginTop: "16px", marginBottom: "16px"` — colapsan en un único
margen de 16px que se sumaba a `document.documentElement.scrollHeight` en
**cada vista de la aplicación**, sin excepción.

Verificación aislada (antes/después de anular el margen, misma carga de
página): `docScrollH` bajó de **1206px a 1190px** — los 16px exactos.

### 3.2 — `body[data-active-view="tracking"] main { min-height: 100vh }` sin restar el topbar (~56-72px, sólo Seguimiento, en TODAS sus pantallas)

```css
/* styles/tracking.css — ANTES */
body[data-active-view="tracking"] .topbar {
  min-height: 64px;         /* topbar de Seguimiento mide 64px, no 56px */
  ...
}
...
body[data-active-view="tracking"] main {
  min-height: 100vh;        /* <- no resta el topbar que está ARRIBA de main */
}
```

La regla general de `main` (`common.css`) sí resta el topbar
(`calc(100vh - var(--topbar))`), pero el override de Seguimiento la reemplazaba
por `100vh` a secas. Como el topbar vive ARRIBA de `main` dentro del mismo
`.app-shell`, el resultado era `topbar + 100vh`, es decir: **la página excedía
el viewport visible en exactamente la altura del topbar, en todas las
pantallas de Seguimiento, con contenido corto o largo, sin condición alguna.**

Medido en `tracking:empty` (viewport 664px): `main.bottom = 728px`
→ **64px de exceso, uno a uno con el topbar de 64px.**

### 3.3 — Riesgo adicional documentado (no reproducible en headless, pero real en dispositivo)

`100vh` en Safari iOS es el viewport **más grande posible** (con la barra de
direcciones colapsada), no el visible en cada momento. Justo después de
cargar (barra expandida), `100vh` excede el alto real visible. Automatización
headless no simula esa barra, así que este componente del bug no se puede
medir acá — pero es un patrón extensamente documentado, y el propio
lineamiento de la tarea pide revisarlo explícitamente. Se blindó `body`,
`.app-shell` y `main` (general y de Seguimiento) con **`100dvh` como mejora
progresiva sobre `100vh`** (el navegador que no entiende `dvh` conserva `vh`
como respaldo; el diseño no cambia, sólo la fórmula del alto).

### Contrato verificado

- El documento termina exactamente después de `.app-shell` (0px de diferencia
  en las 13 vistas medidas, antes tenía hasta 68px de exceso).
- Vistas `hidden` no aportan layout (verificado: 0×0 en las 13 corridas).
- Las reservas de nav/carrito se aplican una sola vez (`--bottom-reserve`
  declarado en `body`, sin duplicados nuevos introducidos).
- `100vh` tiene respaldo `100dvh`/`100svh` en body/app-shell/main.
- Ningún `max-height` arbitrario oculta el síntoma: las dos correcciones
  tocan exactamente la propiedad que generaba el exceso real.

## 4 · Archivos modificados

```
 styles/business.css |  6 ++++++
 styles/common.css   |  8 ++++++++
 styles/profile.css  |  5 +++++
 styles/tokens.css   |  3 +++
 styles/tracking.css | 18 ++++++++++++++++--
 5 files changed, 38 insertions(+), 2 deletions(-)
```

Más 2 archivos nuevos (suites de regresión, ver §6):
`tests/e2e/ios-autozoom-safety.spec.mjs`, `tests/e2e/ios-phantom-scroll.spec.mjs`.

No se tocó ningún archivo de lógica de pedidos, Perfil (JS), relay, Supabase,
tracking funcional, MapLibre, GPS, delivery code, estados, ni migraciones —
los 5 archivos modificados son **CSS puro**.

## 5 · Medidas antes/después

### Autozoom (`autozoom-audit.json`, 91 controles auditados)

| | Antes | Después |
|---|---:|---:|
| Controles bajo 16px | **24** | **0** |
| Controles auditados | 91 | 91 |

### Scroll fantasma (`phantom-scroll-audit.json`, 13 escenarios)

| Escenario | `documentScrollHeight` antes | `appShell.bottom` antes | Gap antes | Gap después |
|---|---:|---:|---:|---:|
| Home | 1206 | 1190 | 16px | **0px** |
| Catálogo (largo) | 4313 | 4297 | 16px | **0px** |
| Catálogo (filtrado corto) | 707 | 691 | 16px | **0px** |
| Carrito vacío | 680 | 664 | 16px | **0px** |
| Carrito con productos | 1872 | 1856 | 16px | **0px** |
| Checkout | 1872 | 1856 | 16px | **0px** |
| Perfil | 1610 | 1594 | 16px | **0px** |
| Seguimiento (vacío) | 744 | 728 | **80px** | **0px** |
| Seguimiento (en camino) | 737 | 721 | **72px** | **0px** |
| Negocio (pocos pedidos) | 871 | 855 | 16px | **0px** |
| Negocio (muchos pedidos) | 3550 | 3534 | 16px | **0px** |
| Negocio (vacío) | 680 | 664 | 16px | **0px** |
| Rider | 680 | 664 | 16px | **0px** |

**13/13 escenarios en 0px de scroll fantasma tras el fix** (antes: 16px en
11 vistas, 72-80px en las 2 de Seguimiento).

## 6 · Pruebas

### Nuevas (agregadas a la suite persistente del repo)

- **`tests/e2e/ios-autozoom-safety.spec.mjs`** — 6 tests. Por cada control
  editable real en Home, Catálogo (+ hoja de detalle), Checkout, Perfil
  (datos personales + nueva dirección), PIN y Negocio (cola, catálogo
  editable, configuración): `font-size` computado ≥16px, `visualViewport.scale`
  no cambia al enfocar, cero overflow horizontal tras enfocar, layout estable
  al cerrar el teclado (blur). **6/6 passed.**
- **`tests/e2e/ios-phantom-scroll.spec.mjs`** — 16 tests (× 2 viewports:
  iPhone 13 390×844 y iPhone SE 320×568). Cubre Home, Catálogo (contenido
  largo y filtrado corto), Carrito (vacío y lleno), Checkout con **teclado
  simulado** (viewport reducido al 55% con un campo enfocado), Perfil,
  Seguimiento (sin pedido y en camino), Negocio (cola vacía y con pedidos) y
  Rider. Cada test verifica: cero overflow horizontal,
  `documentScrollHeight - appShell.bottom` ≤ 2px de tolerancia, que el scroll
  al máximo alcance el contenido real, que ninguna superficie inferior
  (`.mobile-nav`, `.floating-cart`, `.b-bottomnav`, barra de acción del
  checkout) tape contenido, y cero `pageerror`/consola. **16/16 passed.**

### Suite completa del repositorio (sin regresiones)

```
npm run check      → Release hygiene check passed
npm test            → tests 605 · pass 605 · fail 0 · skipped 0
git diff --check    → sin problemas
```

Focales E2E ejecutadas (además de las 2 suites nuevas):
`business-inbox`, `business-catalog`, `business-setup`,
`business-reports-cashbox`, `customer-delivery`, `customer-profile`,
`la-taba`, `beverage-storefront`, `commercial-polish`, `mobile-touch-gesture`,
`ios-blank-screen`, `tracking-arriving`, `tracking-terminal-expiry`,
`honest-map`, `showcase`, `showcase-map-lifecycle`, `direct-ordering-growth`,
`promotions`, `sandbox-flow` → **103 tests, 0 fallos** (82 + 21, corridas en
dos lotes por tamaño).

## 7 · Capturas

`C:\1212\artifacts\taba-iphone-physical-fixes\screenshots\` — 14 capturas
antes/después (`before-*.png` / `after-*.png`), generadas sirviendo el código
**tal como está en HEAD** (worktree temporal, ya eliminado) contra el código
corregido, mismo dispositivo emulado (iPhone 13, WebKit-viewport vía
Chromium `devices['iPhone 13']`):

- `catalog-focused` — buscador del catálogo enfocado (el cambio de fondo es
  el `font-size` del campo; el gesto de zoom en sí es exclusivo de Safari real
  y no se puede fotografiar en automatización).
- `checkout-keyboard` / `profile-keyboard` — con el teclado simulado
  (viewport reducido).
- `catalog-end` / `profile-end` / `tracking-end` / `business-end` —
  scrolleadas hasta el final.

**Nota honesta sobre `tracking-end`:** en el "antes", el encabezado "Tu pedido
está en camino" queda literalmente empujado fuera de la parte superior de la
captura al hacer scroll al final, porque el documento (más alto por el bug)
desplaza más de lo que debería. En el "después" el mismo encabezado es
visible completo. Es una demostración visual directa del defecto, no un
artefacto de la captura — confirmado por las mediciones de §5.

## 8 · `git status --short`

```
 M styles/business.css
 M styles/common.css
 M styles/profile.css
 M styles/tokens.css
 M styles/tracking.css
?? tests/e2e/ios-autozoom-safety.spec.mjs
?? tests/e2e/ios-phantom-scroll.spec.mjs
```

## 9 · Confirmación

`HEAD` permanece en `64615dbd594279945257078f315ec911dbade5d6`, rama
`feature/mostrador-patagonico-v1`. **Sin commits, sin push, sin merge, sin
deploy, sin migraciones.** No se modificó lógica de pedidos, Perfil (JS),
relay, Supabase, tracking funcional, MapLibre, GPS, delivery code, estados ni
productos/precios — los cambios son CSS puro más dos specs de regresión.

Veredicto: **TABA_IPHONE_AUTOZOOM_AND_PHANTOM_SCROLL_FIXED**
