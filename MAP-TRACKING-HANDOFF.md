# MAP-TRACKING-HANDOFF · El tracking sobre lienzo nocturno TABA2

Worktree de dirección visual, rama `feature/taba2-tracking-visual-polish`,
base `11a0b02` (la RC de piloto integrada). Todo local: sin push, sin deploy,
sin `amend`, `reset`, `clean`, `stash` ni `git add .`.

**Alcance respetado:** cero cambios en backend, pedidos, contratos GPS,
Supabase o contratos Rider. Los archivos tocados son de mapa (presentación),
CSS del tracking, PWA (versionado de caché) y herramientas de captura/QA.

---

## 1. El problema

El tracking usaba el estilo Positron claro de OpenFreeMap dentro de una
interfaz grafito: un parche blanco flotando en el único momento en que el
cliente mira la app con más ansiedad. Los overlays (píldora de estado, ETA,
recentrado) también eran blancos, heredados del tema papel.

## 2. El sistema

### 2.1 El lienzo: tema nocturno aplicado, no estilo nuevo

`js/map/taba_map_theme.js`. El estilo público sigue siendo el Positron de
OpenFreeMap; el tema es un **post-proceso** que recolorea las 55 capas ya
cargadas, aplicado en el evento `load` del mapa y **antes de revelar el
canvas**: como ese bloque es síncrono, el primer frame visible ya es grafito
—sin flash claro— y no hubo que volver asíncrono el montaje ni agregar un
fetch propio. Si el tema no puede aplicarse, queda el estilo claro original:
**un mapa legible, nunca uno roto**.

Decisiones del lienzo:

- **El fondo es el mismo negro del shell** (`--taba-ink`, #14161a): el mapa se
  funde con la interfaz en vez de flotar. Un test lo ata al token: si la marca
  cambia el negro, avisa.
- **La jerarquía vial se cuenta por luminancia** (calle < avenida < autopista) y
  los casings se hunden respecto del fondo: separan sin iluminar.
- **La legibilidad no se sacrifica por oscurecer.** Cada color de texto rinde
  **≥ 4,5:1 (AA)** sobre el fondo —verificado por test contra el volcado real
  del estilo, no contra una maqueta— con halo grafito universal que despega los
  nombres de la trama.
- **Los escudos de ruta (RP7, RN22…) quedan intactos**: su texto vive sobre la
  chapa clara del sprite y oscurecerlo lo volvería ilegible dentro del propio
  escudo.
- **El único dorado del lienzo son los nombres de avenidas** (#c9a45f, 7:1).
  El resto del color queda reservado para la ruta y los marcadores, que son la
  historia que el tracking cuenta.
- Capas desconocidas caen a un tema por familia (`source-layer`); sin regla, no
  se inventa pintura: fail-open a legible.

### 2.2 La ruta: jerarquía en dos capas

La ruta sandbox pasó de una línea plana a **casing casi negro + línea roja
encima**, del MISMO source de geometría (la producción sigue sin inventar
rutas; la cantidad de capas es presentación). El rojo (#e8273a) es un paso más
luminoso que el institucional: sobre grafito, #d0000d se apaga. Ancho
interpolado por zoom.

### 2.3 Marcadores

- **Rider:** el casco TABA sobre pastilla blanca (contrato existente, intacto)
  con sombra más profunda para despegar del lienzo; **pulso rojo** sólo con GPS
  fresco y en camino (`is-location-fresh` + `.on-the-way`), apagado con
  `prefers-reduced-motion`. Con GPS perdido, el marcador se atenúa
  (grayscale + opacidad): última posición conocida, contada como tal.
- **Destino:** pin rojo TABA con glifo blanco — el protagonista del reparto.
- **Local:** pin en negativo (blanco con glifo grafito) y **hairline dorado**:
  identifica al comercio sin competir con el destino.

### 2.4 Overlays y controles

Todos los flotantes comparten una sola superficie: grafito translúcido
`rgb(18 21 26 / ~90%)` + blur + hairline `--shelf-line` + sombra profunda.

| Pieza | Estado |
| --- | --- |
| Píldora de ubicación | grafito; **dorado** en `delayed`, **rojo** en `lost` |
| ETA | grafito con el número en blanco: el dato que el cliente vino a buscar |
| Recentrar | 46px, grafito, foco visible dorado, hover rojo |
| Zoom nativo MapLibre | **nuevo**, sólo escritorio (≥768px): en táctil mandan los gestos y los botones taparían mapa; 44px, glifos del vendor en negativo por `filter: invert` |
| Atribución | grafito translúcido; botón con área táctil 44px y glifo 24px |
| Carga | shimmer grafito sobre `--shelf-sunken` hasta `is-ready`; sin animación con reduced-motion |
| Mapa no disponible | tarjeta `--shelf-raised` (fallback honesto existente, integrado) |

Regla dura de la sección (comentada en el CSS): **ningún overlay decorativo
captura gestos** (`pointer-events: none`), y **no se declara `touch-action`
sobre la superficie del mapa** — el único `touch-action: manipulation` del
repo aplica a botones concretos (recenter incluido), nunca al canvas. Zoom,
pan, recenter y gestos cooperativos de MapLibre quedan como estaban.

### 2.5 Estados del reparto

Los seis estados pedidos, capturados en ambos motores:

1. **Tracking vacío** — sheet grafito con CTA al catálogo.
2. **Esperando rider** — "El pedido sigue en el local" + "Repartidor aún no
   asignado" (sin mapa: no hay ubicación que mostrar).
3. **Rider asignado** — ídem con "Rider asignado".
4. **En camino** — mapa nocturno + ruta + ETA + pulso del rider.
5. **GPS perdido** — píldora roja "Ubicación temporalmente no disponible",
   **velo** que atenúa el lienzo sin capturar gestos, marcador atenuado, sin
   ETA (no se inventan minutos). Pasado el umbral de descarte, el producto
   degrada a la tarjeta sin mapa: ese diseño previo (tracking honesto) se
   respeta y se estila.
6. **Llegó** — mapa de última ubicación + código de entrega.

Los hairlines claros heredados del tema papel (`#ececef`, `#e7e7ea`,
`#e5e4e2`) pasaron a `--shelf-line` en el layout, la cabecera, el stage y la
tarjeta de espera: eran las costuras que delataban el parche.

### 2.6 Safe areas

La sheet del tracking respeta `env(safe-area-inset-left/right)` (notch en
apaisado) y suma `env(safe-area-inset-bottom)` al pie. Los overlays del mapa
viven dentro del stage con sus márgenes; el `viewport-fit=cover` ya estaba.

## 3. PWA

`CACHE_NAME` → `la-taba-runtime-v46-tracking-nocturno`; hojas a `?v=42` en
`index.html`, `styles.css` y el precache de `sw.js`. Sin esto, un cliente con
la app instalada seguiría viendo el mapa claro servido por el service worker
viejo. Tests de `pwa` y `github-pages` actualizados al valor nuevo (el
contrato de versionado es lo protegido; el valor es el que rota).

## 4. Contratos actualizados a propósito

| Test | Antes | Ahora | Qué protege sigue intacto |
| --- | --- | --- | --- |
| `map.test.mjs` ruta sandbox | 1 capa | 2 capas (casing + línea), visibilidad en conjunto | **una sola fuente de geometría** |
| `pwa` / `github-pages` | v45 / v=41 | v46 / v=42 | el versionado de caché |

Nuevos: `tests/taba-map-theme.test.mjs` (9 tests contra el volcado real del
estilo: cobertura de capas, AA de todos los textos, halo universal, jerarquía
por luminancia, dorado único, fondo = token de marca, fallbacks, resiliencia) y
`tests/fixtures/openfreemap-positron-style.json` (55 capas volcadas 2026-08).

## 5. Validación

| Gate | Resultado |
| --- | --- |
| `npm test` | **1095/1095** |
| `npm run test:e2e` | **206/206** |
| `npm run check` | pasa |
| Capturas Chromium | 6 estados × 320/375/390/414/432/1280 = **36** |
| Capturas WebKit | 6 estados × los mismos anchos = **36** |
| Auditoría por estado (overflow, touch ≥44px, superficies claras en overlays) | **0 hallazgos** en ambos motores tras corregir el botón de atribución (20px → 44px) |

Capturas en `artifacts/taba2-tracking-visual/final/{chromium,webkit}/<ancho>/`
(no versionadas, como todo `artifacts/`; se regeneran con el script). Baseline
del estado previo conservada en `.../baseline/` para comparación.

```
node scripts/realtime-relay.mjs 8246 &
AUDIT=1 BASE=http://127.0.0.1:8246 WIDTHS=320,375,390,414,432,1280 \
  node scripts/taba2-tracking-screenshots.mjs
AUDIT=1 ENGINE=webkit BASE=... node scripts/taba2-tracking-screenshots.mjs
```

El script recorre el flujo REAL de la demo (pedido → Panel acepta y prepara →
rider toma y sale → simulación → llegada); lo único inyectado es el
envejecimiento del fix GPS para el estado "perdido", que es exactamente lo que
queda cuando el teléfono del rider deja de reportar.

## 6. Riesgos y notas para integrar

1. **El tema depende de los ids del Positron de OpenFreeMap.** Si el proveedor
   renombra capas, el fallback por familia cubre lo típico y lo no cubierto
   queda claro pero legible. El fixture versionado permite detectar el drift
   re-volcando el estilo y corriendo los tests.
2. **`applyTabaMapTheme` corre una vez por montaje** (evento `load`). Si algún
   flujo futuro llama `map.setStyle()` en caliente, tiene que reaplicar el
   tema; hoy ningún flujo lo hace.
3. **El zoom nativo se oculta bajo 768px por CSS.** Si aparece un tablet-modo
   donde se quiera visible, es una media query, no JS.
4. **El pin del local cambió de color** (grafito → blanco con dorado). Los
   specs E2E cuentan clases (`is-store`/`is-destination`), no colores, así que
   no hubo contratos que tocar.
5. **La captura del estado "GPS perdido" vive en la ventana `lost`** (fix >45s,
   antes del descarte). Más viejo, el producto degrada a la tarjeta sin mapa:
   comportamiento previo, deliberado, del tracking honesto.
6. **Los screenshots usan `dispatchEvent('click')`** porque los paneles demo
   re-renderizan por intervalo y despegan los nodos entre resolución y gesto de
   Playwright; los handlers del producto son delegados a nivel document, así
   que es el mismo código el que corre. No es un patrón para specs de
   interacción real (esos siguen con clicks actionables).

---

TABA2_TRACKING_VISUAL_SYSTEM_READY_FOR_INTEGRATION
