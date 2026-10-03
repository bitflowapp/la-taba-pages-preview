# TABA — Sistema de diseño

Extiende `styles/tokens.css`. **No lo reemplaza.** La paleta, los radios, las
sombras y la escala de espacio existentes son buenos; lo que falta son tokens
semánticos, una escala tipográfica explícita y una disciplina de uso del rojo.

Regla general: **cada token nuevo se agrega, ninguno existente se renombra.** Un
rename obliga a tocar los 11 archivos CSS y `tracking.css` está fuera de alcance.

---

## 1. Identidad

TABA es un comercio de bebidas, no una app de software. La estética es
**comercial argentina de barrio, ordenada**: negro/grafito, rojo TABA, blanco
cálido, bordes suaves, sombras mínimas, tipografía fuerte.

De la pantalla Configuración de iPhone se toman **principios de organización**,
nunca la apariencia:

| Se toma | No se toma |
|---|---|
| Título grande y claro | Iconos de Apple |
| Secciones agrupadas por dominio | Azul de sistema iOS |
| Filas de ≥44 px con icono, título, estado y chevron | Componentes propietarios |
| Separadores discretos entre filas del mismo grupo | Tipografía SF |
| Estado visible en la fila, sin entrar | Radios y sombras exactos de iOS |
| Navegación progresiva (lista → detalle) | El gris de fondo de iOS |

Las superficies agrupadas de TABA usan `--taba-warm-white` sobre
`--taba-surface-sunken`, radios de 18 px y `--shadow-xs`. No se parecen a iOS.

---

## 2. Tokens

### 2.1 Existentes que se conservan

Todo `styles/tokens.css` sigue vigente: `--taba-red`, `--taba-red-hover`,
`--taba-red-soft`, `--taba-ink`, `--taba-graphite`, `--taba-muted`,
`--taba-border*`, `--taba-warm-white`, `--taba-success`, `--taba-warning`,
`--taba-danger`, `--taba-focus`, `--radius-*`, `--shadow-*`, `--space-*`,
`--tap`, `--content`, `--topbar`, `--ease`.

### 2.2 Tokens nuevos

```css
:root {
  /* --- Corrección de defecto: usado en business.css:264, nunca definido --- */
  --taba-border-strong: #b4b4bb;

  /* --- Superficies semánticas --- */
  --taba-surface: var(--taba-white);          /* tarjeta / fila */
  --taba-surface-sunken: #f7f6f4;             /* fondo de grupo */
  --taba-surface-raised: var(--taba-warm-white);
  --taba-surface-inverse: #14181e;            /* topbar, nav móvil */
  --taba-separator: #ececef;                  /* línea entre filas hermanas */

  /* --- Tipografía --- */
  --text-display: 26px;   /* un solo H1 por pantalla */
  --text-title: 20px;     /* encabezado de sección */
  --text-body-lg: 16px;   /* nombre de producto, fila de sección */
  --text-body: 15px;      /* texto general */
  --text-meta: 13px;      /* presentación, hora, estado */
  --text-micro: 12px;     /* etiquetas; piso absoluto */
  --leading-tight: 1.15;
  --leading-normal: 1.45;
  --tracking-display: -0.03em;
  --tracking-caps: 0.08em;

  /* --- Densidad de fila (patrón Settings) --- */
  --row-height: 52px;         /* fila de sección en móvil */
  --row-height-compact: 44px; /* piso táctil absoluto */
  --row-icon: 28px;
  --row-gutter: 16px;

  /* --- Superficies fijas: fuente única de verdad --- */
  --nav-height: 62px;
  --nav-inset: 10px;          /* separación del borde inferior */
  --nav-band: calc(var(--nav-height) + var(--nav-inset) + var(--safe-area-bottom));
  --cart-height: 56px;
  --cart-gap: 10px;
  --cart-band: calc(var(--nav-band) + var(--cart-height) + var(--cart-gap));

  /* --- Estados de conexión --- */
  --state-live: var(--taba-success);
  --state-live-soft: #eaf6ee;
  --state-retry: var(--taba-warning);
  --state-retry-soft: #fdf4e3;
  --state-offline: var(--taba-muted);
  --state-offline-soft: #f1f1f2;

  /* --- Prioridad operativa (panel del negocio) --- */
  --prio-new: var(--taba-red);
  --prio-new-soft: var(--taba-red-soft);
  --prio-prep: #9a5a00;
  --prio-prep-soft: #fdf4e3;
  --prio-ready: var(--taba-success);
  --prio-ready-soft: #eaf6ee;
  --prio-transit: #1d5fd1;
  --prio-transit-soft: #eaf1fd;
}
```

**Por qué `--nav-band` reemplaza a `--taba-bottom-nav-clearance`:** el token
actual se calcula desde `--taba-bottom-nav-height: 76px`, pero la barra
renderizada mide 66 px y flota a 10 px del borde. Los 76 px salen por
coincidencia. `--nav-band` deriva de los dos valores que la barra **usa
realmente**, así que mover la barra no desalinea el contenido.

Migración segura: redefinir los tokens viejos en función de los nuevos y dejar
de usarlos en reglas nuevas.

```css
--taba-bottom-nav-clearance: var(--nav-band);
--taba-floating-cart-reserve: var(--cart-band);
```

---

## 3. Tipografía

Familia: Inter (`--font-sans`), sin cambios.

| Rol | Token | Móvil | Desktop | Peso | Uso |
|---|---|---|---|---|---|
| Display | `--text-display` | 26 px | 32 px | 900 | **Un solo H1 por pantalla** |
| Título | `--text-title` | 20 px | 22 px | 850 | Encabezado de sección |
| Cuerpo grande | `--text-body-lg` | 16 px | 16 px | 700 | Nombre de producto, fila |
| Cuerpo | `--text-body` | 15 px | 15 px | 400 | Descripciones |
| Meta | `--text-meta` | 13 px | 13 px | 600 | Presentación, hora, estado |
| Micro | `--text-micro` | 12 px | 12 px | 800 | Etiquetas, chips |
| Precio | — | 18 px | 20 px | 900 | Sólo precio |

Reglas:

1. **Se elimina `clamp()` para títulos.** `clamp(28px, 7.5vw, 42px)` da 42 px en
   un teléfono: es el origen del encabezado gigante. Escalones fijos por
   breakpoint.
2. **Piso de 12 px.** Se retira el `font-size: 8px` de `.home-preview-label`
   junto con el componente.
3. **Un solo peso ≥850 por bloque.** Hoy conviven kicker 850, H1 900,
   contador 800 y "Recomendados" 850 en 200 px de alto.
4. `overflow-wrap: anywhere` deja de ser global y se aplica sólo donde entra
   dato del usuario (direcciones, nombres de cliente).
5. Nombres de producto: `-webkit-line-clamp: 2` con alto reservado.

---

## 4. Espaciado

Se conserva la escala de 4 px de `tokens.css`.

| Contexto | Valor |
|---|---|
| Padding lateral de pantalla (≤560 px) | `--space-4` (16 px) |
| Padding lateral (≤350 px) | `--space-3` (12 px) |
| Padding lateral (≥1024 px) | `--space-6` (24 px) |
| Separación entre secciones (móvil) | `--space-6` (24 px) |
| Separación entre secciones (desktop) | `--space-8` (32 px) |
| Gap de la grilla de productos (móvil) | `--space-3` (12 px) |
| Gap de la grilla de productos (desktop) | `--space-4` (16 px) |
| Padding interno de tarjeta | `--space-3` / `--space-4` |
| Padding de fila de sección | `--space-4` |

**Presupuesto vertical del catálogo móvil (requisito duro):** el encabezado
completo — topbar, título, buscador, categorías, contador — **no puede superar
los 300 px** en 390×844. Hoy son 495 px.

---

## 5. Bordes y radios

Se conservan los radios de `tokens.css`. Asignación:

| Elemento | Radio |
|---|---|
| Chip, píldora, stepper, botón redondo | `--radius-pill` |
| Botón, campo, fila de sección | `--radius-sm` (12 px) |
| Tarjeta de producto, grupo de secciones, tarjeta de pedido | `--radius-md` (18 px) |
| Bottom sheet, modal | `--radius-lg` (24 px), sólo arriba en sheet |
| Ficha de estadística | `--radius-sm` |

Bordes: `--taba-border` para tarjetas, `--taba-separator` entre filas hermanas,
`--taba-border-strong` para campos de formulario que necesitan peso. **Nunca**
borde rojo salvo estado de error o selección activa.

Regla: dentro de un grupo, las filas **no** llevan borde propio; llevan un
separador de 1 px con sangría a la izquierda del ancho del icono.

---

## 6. Sombras

Sombras mínimas. La jerarquía la da el color de superficie, no la profundidad.

| Token | Uso |
|---|---|
| `--shadow-xs` | Tarjetas y filas en reposo |
| `--shadow-sm` | Elemento elevado (tarjeta seleccionada, chip activo) |
| `--shadow-md` | Sólo superficies flotantes: carrito sticky, bottom sheet, modal |

Se elimina la sombra por tarjeta de producto (`0 8px 18px rgb(24 28 35 / 7%)` en
`catalog.css:229`): 22 sombras en una grilla ensucian la pantalla. Una tarjeta
en reposo lleva sólo borde.

---

## 7. Uso del rojo — la regla más importante

El rojo TABA es el activo de marca más fuerte y **hoy está devaluado por
sobreuso**. En una sola pantalla de catálogo aparece en: kicker, icono del
buscador, chip de categoría activa, badge del carrito, texto del selector de
orden, chevron del selector, precio, botón "+" en hover, carrito sticky e ítem
activo de la nav.

### Jerarquía de uso

| Nivel | Uso permitido | Ejemplo |
|---|---|---|
| **1 — Acción** | **Una** acción primaria por pantalla | Carrito sticky; "Aceptar pedido" |
| **2 — Precio** | Precio de venta | `$ 17.100` |
| **3 — Marca** | Subrayado del logo TABA | Topbar |
| **4 — Alerta operativa** | Pedidos nuevos sin atender | Contador "Nuevos" |

### Prohibido

- Rojo como color de **selección** (categoría activa, pestaña activa). La
  selección se marca con superficie `--taba-ink` sobre blanco, o superficie
  blanca elevada sobre `--taba-surface-sunken`.
- Rojo en iconos decorativos (lupa del buscador, chevron del orden).
- Dos superficies rojas grandes visibles a la vez.
- Rojo para "En preparación" o "Listos": esos son `--prio-prep` y
  `--prio-ready`.

**Prueba de aceptación:** en cualquier captura, el área roja no debe superar el
**10 %** de los píxeles del viewport, y no debe haber más de **una** superficie
roja mayor a 44×44 px.

---

## 8. Estados de conexión

Cuatro estados, un solo componente (`.sync-chip`), presente en toda superficie
operativa (negocio y rider).

| Estado | Color | Punto | Etiqueta | Acción |
|---|---|---|---|---|
| Sincronizado | `--state-live` | lleno | `Sincronizado · 12:04` | ninguna |
| Reconectando | `--state-retry` | pulsante | `Reconectando…` | ninguna (automático) |
| Sin conexión | `--state-offline` | hueco | `Sin conexión · desde 11:58` | **Sincronizar ahora** |
| Desactualizado | `--state-retry` | lleno | `Última actualización 11:41` | **Sincronizar ahora** |

Reglas:

1. La hora de última actualización es **siempre visible**, no sólo en error.
2. "Sincronizar ahora" aparece **sólo** en `Sin conexión` y `Desactualizado`.
   Un botón siempre presente entrena a ignorarlo.
3. El chip **nunca** es rojo: el rojo significa "pedido nuevo", y confundir
   ambas señales es peligroso en operación.
4. El estado se anuncia con `aria-live="polite"`, sin robar foco.
5. Al pasar a `Sin conexión`, las acciones que escriben pedidos se deshabilitan
   con motivo visible, no en silencio.

Base existente: `renderRealtimeSyncControl()` (`js/business.js:262`) y `.rt-chip`
ya modelan `connected` / `pendingSnapshot`. Se extiende, no se reemplaza.

---

## 9. Estados vacíos

Todo estado vacío tiene cuatro partes: **qué pasó · por qué · qué hacer ·
acción**. Sin ilustraciones genéricas.

| Superficie | Título | Cuerpo | Acción |
|---|---|---|---|
| Catálogo, búsqueda sin resultados | `No encontramos "fernet"` | `Probá con la marca o la presentación.` | `Limpiar búsqueda` (conserva categoría) |
| Catálogo, categoría vacía | `No hay bebidas en Energizantes` | `Puede que se haya agotado hoy.` | `Ver todo el catálogo` |
| Favoritos | `Todavía no guardaste favoritos` | `Tocá el corazón en un producto.` | `Ver catálogo` |
| Cola del negocio vacía | `Sin pedidos en la cola` | `Cuando entre un pedido aparece acá.` | ninguna + chip de sincronización |
| Sin conexión | `No pudimos actualizar` | `Última actualización 11:41.` | `Sincronizar ahora` |

Reglas:

1. En un resultado vacío **se ocultan los controles que no operan sobre nada**:
   el selector de orden desaparece con 0 productos.
2. El chip de categoría activa no queda en estado seleccionado si el resultado
   es vacío por búsqueda: manda el filtro más restrictivo.
3. `Limpiar búsqueda` y `Ver todo el catálogo` son acciones **distintas**. Hoy
   hay una sola (`data-clear-catalog-filters`) que borra ambos filtros mientras
   el texto sugiere limpiar sólo el buscador.
4. Nunca se apila un estado vacío debajo de una barra sticky sin `--cart-band`
   de separación.

---

## 10. Accesibilidad

| Requisito | Regla | Estado hoy |
|---|---|---|
| Objetivo táctil | ≥44×44 px | ✅ cumple (medido) |
| Contraste de texto | ≥4.5:1 normal, ≥3:1 ≥24 px | Revisar `--taba-muted` #626269 sobre blanco = 6.4:1 ✅ |
| Contraste de texto rojo | `--taba-red` #d0000d sobre blanco = 6.9:1 ✅ | ✅ |
| Foco visible | `:focus-visible` 3 px | ✅ ya existe |
| Tamaño mínimo | 12 px | ❌ `.home-preview-label` a 8 px |
| `aria-current` | **Un solo** elemento por documento | ❌ ver auditoría §3.2 |
| Estado de nav | Toda vista tiene un ítem activo | ❌ vista carrito |
| Región en vivo | Estado de sync y toasts con `aria-live="polite"` | Parcial |
| Orden de foco | Sigue el orden visual; el sheet atrapa el foco | Verificar en el detalle nuevo |
| Movimiento | Respetar `prefers-reduced-motion` | ❌ no existe |
| Zoom | Legible al 200 % sin scroll horizontal | Verificar |

Añadir:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

(`tokens.css` fija `scroll-behavior: smooth` en `html` sin excepción.)

---

## 11. Breakpoints

Cinco escalones. **Mobile-first**: la base es 320 px y cada `@media` es
`min-width`. Hoy es al revés (base de 4 columnas y `max-width` para bajar), lo
que obliga a sobrescribir en cada nivel.

| Nombre | Rango | Cambio estructural |
|---|---|---|
| `xs` | 320–359 | Base. 2 columnas, padding 12 px. |
| `sm` | 360–599 | 2 columnas, padding 16 px. |
| `md` | 600–899 | 3 columnas. Nav inferior sigue. Negocio: 4 fichas en fila. |
| `lg` | 900–1279 | Nav superior reemplaza a la inferior. Catálogo 4 col + sidebar de categorías. Negocio: master-detail de 2 paneles. |
| `xl` | ≥1280 | Catálogo 5 col + carrito lateral persistente. Negocio: 3 paneles. |

```css
/* Un único bloque por breakpoint, en orden ascendente. */
@media (min-width: 360px) { /* sm */ }
@media (min-width: 600px) { /* md */ }
@media (min-width: 900px) { /* lg */ }
@media (min-width: 1280px) { /* xl */ }
```

Regla de higiene: **un solo bloque `@media` por breakpoint y por archivo**. Hoy
`responsive.css` repite `max-width: 820px` cinco veces y genera reglas muertas.

---

## 12. Componentes nuevos

| Componente | Clase | Dónde |
|---|---|---|
| Grupo de secciones | `.taba-group` | Negocio móvil |
| Fila de sección | `.taba-row` (icono · título · estado · chevron) | Negocio móvil |
| Chip de sincronización | `.sync-chip` | Negocio, rider |
| Ficha de estadística compacta | `.stat-pill` | Negocio móvil |
| Tarjeta de pedido | `.order-card` | Negocio |
| Detalle de pedido | `.order-detail-sheet` | Negocio móvil |
| Cola de pedidos (desktop) | `.queue-list` / `.queue-item` | Negocio desktop |
| Inspector (desktop) | `.order-inspector` | Negocio desktop |
| Sheet de producto | `.product-sheet` | Catálogo móvil |
| Skeleton | `.skeleton` | Catálogo, Inicio |
| Barra de categorías compacta | `.cat-bar` / `.cat-chip` | Catálogo |
| Carrito lateral | `.cart-aside` | Catálogo desktop |

## 13. Componentes reutilizados

`.product-card` (reproporcionada), `.qty-stepper`, `.empty-state`,
`.stat-tile` (como base de `.stat-pill`), `.rt-chip` (como base de `.sync-chip`),
`.primary-button` / `.secondary-button` / `.ghost-button`, `.thumb` /
`.thumb-img`, `.mobile-nav`, `.topbar`, `.sr-only`, `.toast`, `.product-modal`
(como base de `.product-sheet`).
