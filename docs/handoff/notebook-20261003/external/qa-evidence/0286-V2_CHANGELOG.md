# TABA v2 — Delta contra la v1

Base: `2026-07-31/`. Esta versión **no la modifica**. Todo vive en `2026-07-31-v2/`.

## Resumen del delta

| | v1 | v2 |
|---|---|---|
| Prototipos | 5 | **1 nuevo + 3 actualizados** en v2; los otros 2 siguen vigentes en v1 sin cambios |
| Pantallas del rider | 14 | **19** |
| Estados del catálogo | 8 | **9** |
| Capturas | 39 | **24 nuevas o rehechas** |
| Tokens de diseño | — | **cero cambios** |
| Superficies del cliente prototipadas | catálogo, inicio, detalle | **+ carrito, checkout, confirmación** |

---

## Sistema de diseño

**`design-system/taba-tokens.css` — sin cambios.** `diff` contra la v1 devuelve vacío. La dirección "Mostrador Patagónico" queda intacta: color, tipografía, espaciado, radios, elevación, controles, z-index y la fórmula del stack inferior son idénticos.

**`prototypes/proto-shared.css` — 4 cambios acotados:**

| Selector | v1 | v2 | Motivo |
|---|---|---|---|
| `.p-body` | `display: grid; align-content: start` | `display: flex; flex-direction: column` | El pie se ancla abajo |
| `.p-foot` | `margin-top: 8px` | `margin-top: auto; padding-top: 8px` | Precios alineados entre tarjetas de la fila |
| `.t-chip--query .t-chip-x` | `font-size: 15px` (glifo `✕`) | `display: grid; place-items: center` (SVG) | El glifo U+2715 cambia de métrica por plataforma |
| `.r-map`, `.r-map::before`, `::after`, `.r-route` | trama rotada 7° | manzanas en dos densidades + avenida + capa de ruta | Mapa legible como ciudad |

Ninguno afecta a las superficies aprobadas: el cambio de `.p-body`/`.p-foot` sólo reubica el pie dentro de la tarjeta y no altera su caja externa.

---

## Nuevo · `prototypes/prototype-checkout-mobile.html`

Cierra el flujo de compra, que la v1 dejaba sin prototipar.

**Vistas:** carrito · carrito vacío · checkout · checkout con error · sin dirección guardada · retiro en el local · confirmado.

**Carrito**
- Línea con miniatura de 68px, nombre a 2 líneas, presentación, stepper de 44px, precio unitario e importe de línea.
- A cantidad 1 el "−" pasa a papelera.
- "Agregar más productos" vuelve al catálogo.
- Resumen con subtotal, envío y total; el envío dice "Sin cargo" en retiro.

**Checkout** — cinco secciones numeradas en una sola página:
1. **Entrega** — envío ($ 1.500) o retiro (sin cargo).
2. **Dirección** — direcciones guardadas del Perfil como opciones `role="radio"`, más "Usar otra dirección" y referencia opcional para el rider. La sección desaparece en retiro.
3. **Contacto** — nombre y teléfono precargados del Perfil, con error en línea.
4. **Pago** — efectivo o transferencia; con efectivo, cálculo de vuelto en vivo.
5. **Resumen** — artículos, envío y total.

**Barra de acción** — total siempre visible + una sola primaria. Su altura se **mide en tiempo de ejecución** y alimenta `--t-cta-block`, en vez de un literal.

**Confirmación** — código de entrega destacado, número de pedido, dirección y total.

---

## `prototype-business-desktop.html` — hoja de detalle en tablet

**El hueco:** la spec de la v1 decía *"≤1023: el detalle pasa a hoja lateral"*; el prototipo tenía `.d-detail { display: none }`. A 768px se podía elegir un pedido y no pasaba nada.

**Ahora:**
- A ≤1023 el detalle es `position: fixed` fuera de pantalla y entra con `transform: translateX(0)`.
- Barra propia con "← Cola de pedidos".
- Cierra con el botón, con `Escape`, y devuelve el foco a la tarjeta seleccionada.
- Acción primaria al pie de la hoja (Aceptar y preparar · Demorar · Rechazar).
- **Sin backdrop:** quedaba totalmente cubierto por la hoja.
- A ≥1024 nada cambia: el detalle sigue en su panel.

Parámetro para capturas: `?sheet=1`.

---

## `prototype-rider-android.html` — de 14 a 19 pantallas

**Nuevas** (completan los 25 flujos y las pantallas listadas en la v1):

| Pantalla | Flujo | Qué resuelve |
|---|---|---|
| `expired` | 2 · Sesión expirada | Reingreso conservando la cola; lista lo pendiente y promete reenvío automático |
| `cancelled` | 19 · Cancelación del local | Aviso irruptivo + qué hacer con el pedido que ya lleva encima |
| `absent` | 20 · Cliente ausente | Protocolo con espera de 5 min, contador, 3 intentos sugeridos y registro auditado |
| `history` | Historial | Entregas del día; declara que **no guarda datos del cliente** |
| `settings` | Perfil/configuración | Privacidad, ubicación, telemetría desactivable, cola pendiente, cierre de sesión |

**Mapa:** trama de manzanas en dos densidades, avenida diagonal y polilínea SVG local → posición → cliente. Variante punteada ámbar para GPS obsoleto (`MAP(label, {stale:true})`). La ruta se dibuja en la mitad superior para no quedar bajo la tarjeta de ETA.

**Accesos añadidos:** turno → historial; turno → perfil; "Llegando" → cliente ausente (antes iba a incidencia genérica).

---

## `prototype-catalog-mobile.html` — correcciones focales

| Cambio | Antes | Ahora |
|---|---|---|
| Alineación del precio | El precio quedaba a distinta altura según la presentación ocupara 1 o 2 líneas | Pie anclado abajo: precios alineados en toda la fila |
| Variantes de producto | "Speed Unlimited" ×2, idénticos | "Speed Unlimited Original" / "Speed Unlimited Zero" + estado `variants` que lo demuestra |
| Glifo de cierre | `✕` (U+2715) | SVG |

---

## Capturas nuevas (24)

**Compra (11):** `checkout-cart-390x844` · `-320x568` · `checkout-empty-390x844` · `checkout-form-390x844` · `-430x932` · `checkout-invalid-390x844` · `checkout-noaddress-390x844` · `checkout-pickup-390x844` · `checkout-success-390x844` · **`checkout-keyboard-390x420`** · **`checkout-cart-keyboard-390x420`**

**Negocio (3):** `business-tablet-768x1024` · **`business-tablet-sheet-768x1024`** · `business-desktop-1440x1000`

**Rider (6):** `rider-on-the-way-390x844` (mapa nuevo) · **`rider-expired`** · **`rider-cancelled`** · **`rider-absent`** · **`rider-history`** · **`rider-settings`**

**Catálogo (4):** `catalog-mobile-390x844` · `-cart-390x844` · `-320x568` · **`catalog-mobile-variants-390x844`**

---

## Prototipos: qué vive dónde

`2026-07-31-v2/prototypes/` contiene **sólo lo que cambió**. Los dos que no necesitaban corrección siguen siendo válidos en la v1.

| Prototipo | Ubicación vigente | Estado |
|---|---|---|
| `prototype-checkout-mobile.html` | **v2** | **Nuevo** |
| `prototype-business-desktop.html` | **v2** | Actualizado — hoja de detalle en tablet |
| `prototype-rider-android.html` | **v2** | Actualizado — 5 pantallas nuevas + mapa |
| `prototype-catalog-mobile.html` | **v2** | Actualizado — pie anclado + estado de variantes |
| `prototype-catalog-desktop.html` | v1 | **Sin cambios** — sigue vigente |
| `prototype-business-mobile.html` | v1 | **Sin cambios** — sigue vigente |
| `proto-shared.css` | **v2** | 4 cambios acotados (ver arriba) |

⚠️ **Nota para implementación.** La copia de `proto-shared.css` de la v2 tiene 4 cambios; los dos prototipos que quedan en la v1 usan la copia de la v1 y por eso no se ven afectados. En el producto real el CSS es uno solo: **aplican los 4 cambios de la v2**. Si se quiere ver el catálogo desktop o el negocio móvil con el pie de tarjeta anclado, hay que copiarlos a la v2 o aplicarles el mismo delta.

## Lo que NO cambió

- Los 118 artefactos de la v1, incluidos auditoría, sistema de diseño, las 4 especificaciones, los 14 documentos del rider y los 8 de implementación.
- Los tokens.
- La arquitectura del catálogo, del negocio móvil y del negocio desktop.
- La arquitectura conceptual del rider, Flutter + Supabase, y los principios de seguridad, offline, GPS e idempotencia.
- El plan de implementación por etapas: la v2 **añade** un delta, no lo reemplaza.
- **El repositorio.** HEAD sigue en `4197bdb`, con 33 modificados y 6 sin seguimiento, exactamente como estaba.
