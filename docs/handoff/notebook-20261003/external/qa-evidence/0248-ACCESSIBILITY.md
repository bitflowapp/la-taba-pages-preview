# TABA — Accesibilidad

Requisitos exigibles. Todos los umbrales de esta página se verifican **midiendo**, no revisando visualmente.

---

## 1 · Objetivos táctiles

**Mínimo 44×44 CSS px** en toda superficie táctil, incluida tablet (768×1024 es táctil).

- `--t-ctrl-sm` (36px) existe **sólo** para escritorio con `pointer: fine`. Prohibido en móvil y tablet.
- Los controles dentro de contenedores se dimensionan para que el **elemento interactivo** llegue a 44, no sólo su envoltorio: por eso `.t-field` mide 46 y contiene un `input` de 44.
- El espaciado entre objetivos adyacentes no baja de 8px.

**Verificación automatizada** (implementada en `diagnostics/capture.mjs`): recorre `button, a[href], input, select, [role="button"]` visibles y falla si `height < 43,5` o `width < 23,5`. Encontró 10 incumplimientos reales en la primera versión de estos prototipos — incluidos controles que “parecían” bien.

## 2 · Tipografía de formularios

**Todo `input`, `select` y `textarea` a 16px como mínimo**, en todas las superficies. Por debajo, Safari en iOS hace zoom al enfocar y deja el layout desplazado.

El repositorio ya lo hace bien en `styles.css` bajo `@media (hover:none),(pointer:coarse)`; la propuesta lo sube a regla incondicional del componente, porque una consulta de medios puede no coincidir en dispositivos híbridos.

Mínimo general de texto visible: **11px**. Hoy hay medidos 8px (“PREVIEW INTERNA”) y 10px (etiquetas de categoría).

## 3 · Contraste

| Contenido | Umbral | Estado en la propuesta |
|---|---|---|
| Texto normal | 4,5:1 | Toda la paleta verificada; el par más ajustado es `ink-400` sobre `surface-2` = **4,87:1** |
| Texto grande (≥18,66px bold / ≥24px) | 3:1 | Cumple con margen |
| Componentes de interfaz y estados (WCAG 1.4.11) | 3:1 | Borde de campo `line-strong` = **3,26:1** |
| Elementos decorativos | — | `line-100/200/300` son decorativos y están declarados como tales |

Los 19 pares medidos están en `design-system/TOKENS.json` → `contrastAudit`, con `ratio`, `passAAText` y `passAALarge` por par.

**Debe entrar en CI:** cómputo de la matriz texto×superficie y borde×superficie sobre la tabla de tokens. Un cambio de token que rompa un umbral tiene que fallar el build, no descubrirse en producción.

## 4 · El color nunca es el único canal

- Estados de pedido: **punto + texto** (`● Nuevo`, `● Preparando`), más borde izquierdo como refuerzo.
- Disponibilidad: `● Disponible` / `● Sin precio`, no un color verde a secas.
- Sincronización: `● Sincronizado` / `● Reconectando` / `● Sin conexión` con texto y, si está degradada, franja persistente.
- Categoría activa: fondo `ink-900` + `aria-pressed="true"`, no sólo un cambio de matiz.
- Navegación activa: color **más** barra de 2,5px **más** `aria-current="page"`.

## 5 · Foco

```css
:focus-visible { outline: 3px solid color-mix(in srgb, var(--t-focus) 62%, white); outline-offset: 2px; }
```
- Nunca `outline: none` sin sustituto visible.
- El anillo es visible sobre superficies claras y oscuras (se prueba sobre `ink-900` en la barra sticky y la app bar del rider).
- El orden de foco sigue el orden del DOM; ningún `tabindex` positivo.
- Al abrir hoja o modal: el foco entra, queda atrapado, `Esc` cierra y el foco **vuelve al disparador**.

## 6 · Teclado

| Acción | Teclas |
|---|---|
| Recorrer | `Tab` / `Shift+Tab` |
| Activar | `Enter` / `Espacio` |
| Cerrar hoja o modal | `Esc` |
| Recorrer chips y tabs | flechas ←/→, `Home`/`End` |
| Saltar al contenido | enlace “Saltar al contenido” como primer foco |

Ninguna función depende de hover, arrastre o pulsación larga. **La confirmación deslizante del rider tiene siempre un equivalente por pulsación** — es una protección contra toques accidentales, no una barrera motriz.

## 7 · Lectores de pantalla

- Un solo `<h1>` por pantalla; jerarquía de encabezados sin saltos.
- Puntos de referencia: `<header>`, `<nav aria-label>`, `<main>`, `<aside aria-label>`.
- Los iconos que acompañan texto llevan `aria-hidden="true"`; los controles de sólo icono llevan `aria-label` **que nombra el objeto concreto**: “Agregar Coca-Cola Original al pedido”, no “Agregar”.
- Contadores y estados que cambian solos: `role="status"` con `aria-live="polite"`. Reservado a lo importante: contador de resultados, estado de sincronización, avisos efímeros.
- Los avisos efímeros no son el único canal de una confirmación relevante: el estado también queda reflejado en la interfaz persistente.
- Chips y segmentos usan `aria-pressed`; la navegación usa `aria-current="page"`.
- El precio se anuncia junto al producto, en el mismo contenedor semántico, para que no quede huérfano.

## 8 · Movimiento

`prefers-reduced-motion: reduce` está en los tokens, no repartido por componente: reduce toda duración a `0.001ms` y desactiva `scroll-behavior: smooth`. Los esqueletos dejan de animarse pero siguen reservando espacio.

## 9 · Zoom y reflujo

- Debe soportarse **zoom hasta 200%** sin pérdida de contenido ni funcionalidad, y hasta 400% con reflujo a una columna (WCAG 1.4.10).
- Ningún `maximum-scale` ni `user-scalable=no`. El `<meta viewport>` actual del repositorio es correcto en esto.
- Ninguna altura fija que corte texto ampliado: por eso desaparecen `min-height: 330px` y `grid-template-rows: 190px …` de la tarjeta.
- **Cero desbordamiento horizontal** en 320px. Ojo: `body { overflow-x: hidden }` **enmascara** los desbordes; el test debe medir `scrollWidth` con esa regla desactivada.

## 10 · Superficies pegajosas

Regla dura: **una superficie pegajosa nunca puede tapar contenido al final del scroll.**

Verificación implementada: se hace scroll al fondo del documento, se calcula el borde superior del stack (`.t-bottomnav`, `.t-sticky-cta`, `.b-actionbar`) y se busca cualquier nodo de texto de `main` que lo cruce. Es una aserción, no una inspección.

Debe ejecutarse en 320/375/390/393/412/430/768, con carrito vacío y con carrito lleno, y con el teclado virtual abierto en el paso de checkout.

## 11 · Formularios

- Etiqueta visible asociada (`<label for>` o envolvente). El `placeholder` **no** es etiqueta.
- Errores: texto explícito junto al campo, `aria-describedby`, `aria-invalid`, foco al primer campo con error. Nunca sólo borde rojo.
- `autocomplete` correcto: `username`, `current-password`, `tel`, `street-address`, `postal-code`.
- `inputmode` acorde: `numeric` para el código de entrega, `tel` para teléfono, `email` para correo.

## 12 · Específico del rider (Android / TalkBack)

- Objetivo mínimo 48dp (equivale a 44px CSS con margen), y las acciones primarias a 56.
- Contraste elevado por uso a la intemperie: la barra superior usa blanco sobre `ink-900` (**18,11:1**).
- La confirmación deslizante expone `role="button"` + `aria-label` explicativa y acepta `Enter`/`Espacio`.
- El teclado numérico del código de entrega es **de la aplicación**: teclas de 56px, sin depender del teclado del sistema. Se usa con guantes ligeros y sin escribir texto libre.
- El servicio en primer plano se anuncia con notificación persistente y texto claro sobre qué se comparte y hasta cuándo.

## 13 · Plan de verificación

| Nivel | Qué | Herramienta |
|---|---|---|
| Automático por PR | Objetivos táctiles, tamaño de fuente de inputs, desbordamiento, solape del stack, errores de consola | El propio `capture.mjs` de esta propuesta, portado a Playwright del repositorio |
| Automático por PR | Contraste de la matriz de tokens | Script sobre `TOKENS.json` |
| Automático por PR | Reglas ARIA e infracciones comunes | `axe-core` sobre las vistas principales |
| Manual por release | Recorrido completo con teclado | Persona |
| Manual por release | VoiceOver en iPhone y TalkBack en Android en catálogo, checkout y rider | Persona |
| Manual por release | Zoom 200% y 400% | Persona |
| Manual por release | Safe areas en iPhone con barra de gestos | **Dispositivo físico** — la emulación devuelve 0 |
