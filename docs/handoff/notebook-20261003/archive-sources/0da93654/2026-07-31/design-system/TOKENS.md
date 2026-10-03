# TABA — Tokens

Implementación de referencia: **`design-system/taba-tokens.css`** (consumida por los cinco prototipos).
Formato de intercambio: **`design-system/TOKENS.json`**.
Todos los contrastes de esta página están **calculados** con la fórmula WCAG 2.1 de luminancia relativa, no estimados.

---

## 1 · Color

### Neutros “Basalto” (gris frío)

| Token | Valor | Uso | Contraste sobre `paper #fffdfb` |
|---|---|---|---:|
| `--t-ink-900` | `#14161a` | Texto principal, wordmark, barra sticky, app bar del rider | **17,85:1** |
| `--t-ink-700` | `#2a2e35` | Títulos sobre superficie | **13,43:1** |
| `--t-ink-600` | `#414751` | Texto fuerte secundario, iconos activos | **9,22:1** |
| `--t-ink-500` | `#5b6270` | Texto secundario | **6,04:1** |
| `--t-ink-400` | `#656d79` | Atenuado (eyebrow, captions) — **4,87:1 sobre `surface-2`** | 5,15:1 |
| `--t-line-strong` | `#878f9d` | **Borde que porta información** (campos de entrada) | 3,26:1 vs blanco ✔ WCAG 1.4.11 |
| `--t-line-300` | `#d7dbe1` | Borde de control con rótulo visible | decorativo |
| `--t-line-200` | `#e4e7ec` | Borde de superficie | decorativo |
| `--t-line-100` | `#eef0f3` | Separador interno | decorativo |
| `--t-surface-2` | `#f5f7f9` | Fondo estructural, iconos de fila | — |
| `--t-surface-1` | `#fbfcfd` | Fondo de aplicación | — |
| `--t-paper` | `#fffdfb` | Superficie elevada (app bar, hojas, grupos) | — |
| `--t-white` | `#ffffff` | Superficie de producto — **debe ser blanca**: los packshots traen fondo blanco horneado | — |

### Rojo TABA — acción y marca

| Token | Valor | Uso | Contraste |
|---|---|---|---:|
| `--t-red-600` | `#d0000d` | **Acción primaria**, marca, indicador de nav activa | 5,61:1 como texto sobre paper · **blanco encima: 5,69:1** |
| `--t-red-700` | `#a80009` | hover / pressed | blanco encima: **7,87:1** |
| `--t-red-300` | `#f0c2c6` | Borde suave (stepper, botón destructivo) | decorativo |
| `--t-red-100` | `#fff0f1` | Wash (fondo del stepper activo, chip de búsqueda) | — |

**Regla de superficie:** el rojo nunca ocupa un área mayor que un botón o una barra de acción. En una lista con la misma acción repetida (cola de pedidos), la acción se resuelve en `--t-ink-900`; el rojo se reserva para la decisión única del detalle.

### Semánticos

| Rol | Token | Valor | Par de pill | Contraste en pill |
|---|---|---|---|---:|
| Éxito | `--t-success-600` | `#0f7a3d` | texto `--t-success-700 #0f6b36` sobre `--t-success-100 #e8f5ed` | **5,89:1** |
| Advertencia | `--t-warning-600` | `#8a5300` | texto `#7a4a00` sobre `#fff4e0` | **6,86:1** |
| Error / destructivo | `--t-danger-600` | `#b3121b` | texto `#97060f` sobre `#fdeced` | **7,83:1** |
| Información | `--t-info-600` | `#1a5fd0` | texto `#14459c` sobre `#e8f0fd` | **7,76:1** |
| Foco | `--t-focus` | `#1a5fd0` | anillo de 3px + offset 2px | 5,76:1 |

**Rojo de marca vs rojo de error.** Se mantienen ambos, pero **la distinción nunca depende del matiz**:
- Acción primaria = **relleno** rojo, texto blanco.
- Destructivo = **contorno** rojo sobre blanco, con icono y rótulo explícito, y siempre con confirmación.

### Roles semánticos

```
--t-bg              → surface-1        --t-text            → ink-900
--t-bg-elevated     → paper            --t-text-secondary  → ink-500
--t-border          → line-200         --t-text-muted      → ink-400
--t-action          → red-600          --t-on-action       → #ffffff
--t-action-hover    → red-700
```

---

## 2 · Tipografía

**Decisión: no se sirve ninguna webfont. Se usa el stack del sistema.**

```css
--t-font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
```

**Por qué.** El repositorio declara hoy `--font-sans: Inter, …` y **nunca carga Inter**: no hay `@font-face` ni enlace a Google Fonts en todo el proyecto. Es decir, la app ya se renderiza con fuente de sistema. Se elimina `Inter` del stack para que la declaración deje de mentir, y no se introduce una webfont porque:

- TABA es una PWA para Android de gama media sobre red móvil; un subset variable pesa ~60–90KB y añade riesgo de FOIT/FOUT sin aportar identidad diferencial;
- nada regresa visualmente, porque hoy ya se ve así;
- los números —lo único crítico— se resuelven con `font-variant-numeric: tabular-nums`, soportado por SF, Roboto y Segoe UI.

**Si más adelante se decide una tipografía propia:** el token es el único punto de cambio; debe auto-hospedarse en `assets/fonts/`, con `font-display: swap` y `<link rel="preload">`, y revalidarse toda la escala, porque cambian métricas verticales y altura de x.

### Escala

| Token | Definición | Uso |
|---|---|---|
| `--t-display-l` | `700 28px/1.15` | H1 de escritorio |
| `--t-title-l` | `700 22px/1.2` | Título de pantalla móvil (hoy ~48px) |
| `--t-title-m` | `700 18px/1.25` | Título de sección |
| `--t-title-s` | `700 16px/1.3` | Nombre de producto, encabezado de tarjeta |
| `--t-body` | `400 15px/1.45` | Texto general |
| `--t-body-s` | `400 13.5px/1.45` | Texto denso operativo |
| `--t-label` | `600 13px/1.2` | Botones, chips, filas |
| `--t-caption` | `500 12px/1.3` | Metadatos |
| `--t-eyebrow` | `700 11px/1.2` + `letter-spacing .09em` | Marca sobre el producto, rótulo de grupo |
| `--t-price-l` | `800 18px/1.1` + tabular | Precio en tarjeta y total |
| `--t-price-m` | `800 16px/1.1` + tabular | Precio secundario |
| `--t-metric` | `800 22px/1` + tabular | Métrica operativa |

**Mínimos absolutos:** 11px para cualquier texto visible (hoy hay 8px y 10px medidos). **16px para todo `input`, `select` y `textarea`** — no negociable: por debajo, iOS hace zoom al enfocar.

---

## 3 · Espaciado, radios, elevación

```
Espaciado (base 4): 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48
Radios: xs 6 · sm 10 · md 14 · lg 18 · pill 999   (antes 8/12/18/24)
Elevación:
  e1  0 1px 2px  rgb(20 22 26 / 6%)    superficies
  e2  0 4px 12px rgb(20 22 26 / 8%)    barras sticky, popovers
  e3  0 12px 32px rgb(20 22 26 / 14%)  sólo modales y hojas
```
La separación la produce el **borde de 1px**; la sombra es apoyo. Se elimina `0 18px 48px`.

---

## 4 · Controles y alturas

| Token | Valor | Uso |
|---|---|---|
| `--t-ctrl-lg` | 48px | CTA primaria (56px en el rider) |
| `--t-ctrl-md` | 44px | **Mínimo táctil** — todo control interactivo |
| `--t-ctrl-sm` | 36px | Sólo escritorio con `pointer: fine`; prohibido en superficie táctil |
| `--t-tap` | 44px | Botón de icono |
| app bar | 56px | Cliente y negocio (hoy 71px) |
| barra superior rider | 56px | Fondo `ink-900` |
| fila agrupada `.t-row` | 56px | Patrón icono·título·valor·chevron |
| campo `.t-field` | 46px | Contiene un `input` de 44px con `font-size:16px` |

---

## 5 · Iconografía

Familia **lineal**, trazo `1.7–1.8`, `stroke-linecap: round`, caja de 24, dibujada a 16/18/20/21/22. **Prohibido el emoji** como icono de interfaz: rompe el color, cambia por plataforma y no hereda `currentColor`. Los iconos heredan color del texto y nunca son el único portador de significado.

---

## 6 · Estados

| Estado | Expresión |
|---|---|
| Reposo | borde `line-200` |
| Hover | oscurece fondo o borde; nunca desplaza layout |
| Foco | `outline: 3px solid color-mix(in srgb, var(--t-focus) 62%, white)` + `outline-offset: 2px` |
| Activo/seleccionado | fondo `ink-900` + texto blanco (chips, tabs) o barra roja de 2,5px (nav) |
| Deshabilitado | `opacity: .45` + `cursor: not-allowed` + `aria-disabled` |
| Cargando | esqueleto con reserva de espacio idéntica al contenido final |
| Error | contorno `danger` + icono + texto; nunca sólo color |

---

## 7 · Movimiento

```
--t-ease:      160ms cubic-bezier(.2,0,0,1)   cambios de estado
--t-ease-slow: 240ms cubic-bezier(.2,0,0,1)   hojas y modales
```
`@media (prefers-reduced-motion: reduce)` reduce toda duración a `0.001ms` y desactiva `scroll-behavior: smooth`. Está en los tokens, no en cada componente.

---

## 8 · Breakpoints

| Rango | Nombre | Comportamiento |
|---|---|---|
| ≤ 359 | `xs` | Catálogo a 1 columna con tarjeta horizontal |
| 360–639 | `sm` | Móvil: 2 columnas, bottom nav |
| 640–1023 | `md` | Tablet: negocio a 2 paneles con riel de iconos; catálogo sin sidebar |
| 1024–1279 | `lg` | Negocio a 3 paneles con sidebar colapsado; catálogo con sidebar |
| 1280–1439 | `xl` | Negocio a 3 paneles completos; catálogo con drawer |
| ≥ 1440 | `2xl` | Negocio + riel de acciones; catálogo con grilla más ancha |
| ≥ 1920 | — | Ancho máximo 1800 (negocio) / 1680 (catálogo), centrado |

**Regla de cascada obligatoria:** las reglas `@media` se escriben **después** de la definición base del componente, en el mismo archivo. Un `@media` con la misma especificidad colocado antes no tiene efecto y falla en silencio. Ocurrió dos veces durante la construcción de estos prototipos y sólo se detectó midiendo.

---

## 9 · Z-index

| Token | Valor | Capa |
|---|---:|---|
| `--t-z-base` | 0 | Contenido |
| `--t-z-sticky-section` | 100 | Encabezados de sección pegajosos |
| `--t-z-appbar` | 200 | Barra superior |
| `--t-z-bottomnav` | 300 | Navegación inferior |
| `--t-z-sticky-cta` | 400 | Barra de carrito / acción primaria |
| `--t-z-backdrop` | 500 | Fondo de hoja |
| `--t-z-sheet` | 510 | Hoja inferior |
| `--t-z-modal` | 600 | Modal |
| `--t-z-toast` | 700 | Aviso efímero |

Reemplaza a 8 / 40 / 500 / 1000 / 1150 / 1200 / 3000. **Ningún `z-index` literal fuera de esta tabla.**

---

## 10 · Safe areas y stack inferior — la pieza crítica

```css
:root {
  --t-safe-b: env(safe-area-inset-bottom, 0px);
  --t-nav-h: 56px;     /* ÚNICA declaración de la altura de la nav */
  --t-cta-h: 56px;
  --t-stack-gap: 8px;
  --t-nav-block: calc(var(--t-nav-h) + var(--t-safe-b));
}
body {
  --t-cta-block: 0px;
  --t-bottom-reserve: calc(var(--t-nav-block) + var(--t-cta-block) + var(--t-stack-gap));
}
body[data-cart="filled"] { --t-cta-block: calc(var(--t-cta-h) + var(--t-stack-gap)); }
body[data-chrome="none"] { --t-nav-block: 0px; --t-cta-block: 0px; }
```

Consumo:
```css
.t-bottomnav { height: var(--t-nav-block); padding-bottom: var(--t-safe-b); }
.t-sticky-cta { bottom: calc(var(--t-nav-block) + var(--t-stack-gap)); height: var(--t-cta-h); }
main          { padding-bottom: var(--t-bottom-reserve); }
.t-toast      { bottom: calc(var(--t-bottom-reserve) + 8px); }
```

**Invariante 1 — una sola fuente de verdad.** `--t-nav-h` se declara una vez. Ningún `bottom:` ni `padding-bottom:` de chrome vuelve a llevar un literal.

**Invariante 2 — el token derivado vive donde varían sus entradas.**
`--t-bottom-reserve` está declarado en `body`, **no** en `:root`. La sustitución de una custom property se resuelve en el elemento donde se declara: si estuviera en `:root`, resolvería `var(--t-cta-block)` con el 0px de `:root` y el override de `body[data-cart="filled"]` no tendría ningún efecto. Es exactamente el mecanismo por el que `--taba-floating-cart-reserve` quedó inerte en el repositorio actual, y volvió a ocurrir en el primer intento de estos prototipos. Se detecta midiendo al final del scroll, no leyendo el CSS.

**Invariante 3 — con carrito vacío la reserva es 0.** No queda espacio muerto al pie.

**Invariante 4 — el aviso efímero flota sobre todo el stack.** Nunca sobre contenido.

**Verificación en dispositivo real.** Chromium en escritorio devuelve `env(safe-area-inset-bottom) = 0`. La reserva **debe** verificarse en iPhone con barra de gestos y en Android con navegación por gestos; la emulación no lo prueba.
