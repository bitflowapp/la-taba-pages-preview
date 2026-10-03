# TABA — Corrección final precommit

Worktree: `C:\1212\la-taba-mostador-patagonico`
Rama: `feature/mostrador-patagonico-v1`
HEAD: `425c4aedd9b5d3b418e7949cf1f511c8077368b4` (sin commits nuevos)

Todos los cambios previos se conservan. No se rediseñó nada: se corrigieron los
cuatro puntos pedidos.

---

## 1 · Negocio 320×700

`Aceptar pedido` quedaba a `top=693` con el viewport en 700 y la barra de
navegación empezando en 644: fuera de pantalla y detrás de la nav.

Se recuperaron 137px **quitando sólo información repetida**, no funciones:

| Recorte | Por qué es redundante | Ahorro |
|---|---|---|
| Banda a dos filas de 44px (etiquetas 10,5px, número 16px) | El objetivo táctil sigue en 44px y los siete estados siguen completos | 25px |
| `Nuevo / pendiente` oculto en la tarjeta prioritaria | La pill ya dice `Pedido nuevo` | 26px |
| Encabezado `Pedidos nuevos` de la sección | La banda ya muestra `Nuevos 1` con su punto de novedad | 23px |
| Rótulo del tiempo de preparación en la misma fila del control | Mismo dato, una fila menos | 24px |
| Padding de tarjeta 12→10 y gaps 10→8 | — | 10px |

Resultado medido: **CTA en `556–604`, nav en `644`** → entera dentro del
viewport y con 40px de aire sobre la navegación.

Header a 320: `TABA · OPERACIÓN · 1 nuevo · Sólo este equipo · 🔊1`, sin ninguna
elipsis. Targets: 0 controles por debajo de 44px.

## 2 · Negocio 360×800

El contexto del app bar ya no se recorta nunca. Las tres variantes se eligen
por umbral **medido**, no estimado: la columna de texto vale
`ancho − 258px`, y las frases necesitan 49px, 96px y 202px.

| Ancho | Rótulo | Contexto |
|---|---|---|
| ≤340 | `OPERACIÓN` | `1 nuevo` |
| 341–519 | `OPERACIÓN` | **`1 pedido nuevo`** |
| ≥520 | `OPERACIÓN DEL LOCAL` | `Hoy, 31 de julio · 1 pedido nuevo` |

Cada variante es una frase completa: el texto se acorta por diseño, nunca con
elipsis. Verificado en 320, 340, 360, 390, 430, 519, 520, 768 y 1280:
**cero recortes en el header operativo**.

## 3 · Checkout

`Confirmar pedido` ya era el último nodo del formulario, pero
`position: sticky` lo levantaba sobre los datos: en pantalla aparecía antes que
el cliente, el teléfono, la dirección, el pago y el resumen.

Ahora va **en flujo**, al final. Verificado por `compareDocumentPosition`:

```json
{"contacto":true,"direccion":true,"pago":true,"indicaciones":true,"resumen":true}
```

- El resumen se muestra antes de poder confirmar (`resumenVisible: true`).
- **Perfil sigue siendo la autoridad**: el formulario no expone ningún campo
  editable de nombre o teléfono (`perfilEsAutoridad: true`).
- **Contratos `data-*` intactos**: `data-checkout-form`, `data-checkout-submit`,
  `data-order-summary`, `data-address-field`, `data-customer-addresses`,
  `data-checkout-warning`, `data-age-confirmation`, `data-checkout-mode-note`.
- Al llegar a la CTA queda entera en pantalla (`642–694`) y por encima de la
  navegación (`788`).

## 4 · Desktop

`OPERACIÓN DEL LOCAL` aparecía dos veces: en el app bar y como eyebrow del
panel. Se retira el eyebrow y el contexto queda una sola vez, en la barra
superior, con la fecha y la cola. El panel conserva `Central de pedidos` como
título.

---

## Validación

### Validador precommit (`tools/precommit.mjs`)

Mide con `getBoundingClientRect`:

- **CTA dentro del viewport** — `top ≥ 0` y `bottom ≤ innerHeight`.
- **CTA no cubierta por la navegación** — `ctaRect.bottom ≤ navRect.top`.
- **Texto sin recorte** — hojas de texto desbordadas **y** cualquier caja con
  `text-overflow: ellipsis` desbordada (ahí vive la elipsis aunque el texto sea
  un hijo). Excluye `<details>` cerrado y `.sr-only`, que conservan caja
  medible en Chromium pero no se ven.
- **Confirmar posterior a los datos** — `compareDocumentPosition` contra
  contacto, dirección, pago, indicaciones y resumen.
- **Cero desbordamiento horizontal y cero `pageerror`.**
- Además: objetivos táctiles ≥44px y contenido tapado por la navegación al
  final del scroll.

```text
node tools/precommit.mjs
escenarios=4 fallos=0
```

| Escenario | CTA | Nav | En viewport | Cubierta | Recortes | Targets <44 | Overflow | Consola | pageerror |
|---|---|---|---|---|---|---|---|---|---|
| `business-mobile-320x700` | 556–604 | 644 | sí | no | 0 | 0 | 0 | 0 | 0 |
| `business-mobile-360x800` | 643–691 | 744 | sí | no | 0 | 0 | 0 | 0 | 0 |
| `business-desktop-1280x900` | 804–852 | — | sí | no | 0 | 0 | 0 | 0 | 0 |
| `checkout-mobile-390x844` | 642–694 | 788 | sí | no | 0 | 0 | 0 | 0 | 0 |

> En el panel la CTA se mide **sin desplazar**: la decisión tiene que verse al
> entrar. En el checkout se mide **al llegar a ella**, porque el requisito es
> justamente que esté después de los datos; lo que se verifica ahí es que entre
> entera y no quede bajo la navegación. Ambos valores quedan registrados en
> `precommit-results.json` (`ctaDesplazada`).

### Suite del repositorio

```text
npm run check      → Release hygiene check passed
npm test           → tests 605 · pass 605 · fail 0 · skipped 0
git diff --check   → sin problemas
```

### Focales E2E — `--workers=1 --retries=0`

| Lote | Resultado |
|---|---|
| Negocio: `business-inbox`, `business-catalog`, `business-setup`, `business-reports-cashbox`, `promotions`, `cancel-confirmation`, `direct-ordering-growth` | 10 passed |
| Checkout, Perfil y responsive: `la-taba`, `customer-delivery`, `customer-profile`, `mobile-touch-gesture`, `commercial-polish`, `beverage-storefront`, `approved-beverage-demo` | 51 passed |
| Resto: `showcase`, `honesty-mode`, `delivery-code`, `delivery-proof`, `tracking-arriving`, `honest-map`, `simulation`, `realtime`, `ios-blank-screen`, `sandbox-flow` | 36 passed |

**97 pruebas E2E, 0 fallos.**

### Regresión visual completa

```text
node tools/capture.mjs
capturas=17 fallos=0
```

Las 17 capturas conservan 0 desbordamiento horizontal, 0 textos cortados,
0 objetivos por debajo de 44px, 0 campos por debajo de 16px, 0 solapes con
superficies sticky, 0 errores de consola y 0 `pageerror`.

## Riesgos pendientes

- Packshots sin normalizar (fuera del alcance de estas tareas).
- Sin prueba en dispositivo físico: safe area real, teclado abierto,
  TalkBack/VoiceOver y zoom.
- No se ejecutaron las dos suites E2E completas.
