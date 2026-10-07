# LA TABA · seguimiento premium · 07/10/2026

Seguimiento ahora prioriza el mapa en camino, mantiene Rider y destino visibles y respeta la exploración manual. El canvas permanece conectado en los renders; el marcador sólo responde a GPS nuevo y significativo. Sin merge ni deploy.

## Revisar

- [Comparador antes/después](comparison.html), con estados, motores y resoluciones.
- [Antes móvil](before/chromium/390x844-on-the-way.webp) · [Después móvil](after/chromium/390x844-on-the-way.webp).
- [Video un dedo](motion/tracking-one-finger.mp4) · [Video cámara desktop](motion/tracking-camera-desktop.mp4). WebM originales conservados.
- [Prueba física de iPhone, menos de 3 minutos](IPHONE-3-MINUTOS.md). **IPHONE_REAL: NOT_RUN**.
- 60 capturas de tracking: confirmed, preparing, assigned, on_the_way y delivered × 390×844, 430×932, 1440×900 × Chromium/WebKit × antes/después. Otras 12 de checkout. WebP sin pérdida.

Fuente: main `cd26834b25909a3fbf6b5133af7b70c39a35fc2d`, idéntico al SHA declarado por producción al inicio. #142 seguía abierto, draft y con CI verde: no estaba en este main ni en la identidad productiva observada. Este PR se mantiene separado. La grabación real de Marco mencionada no estaba adjunta; se solicitó su ruta y se avanzó con la app real, las capturas existentes y los estados de QA.

**Los pedidos, cliente y GPS de la evidencia son sintéticos y se siembran sólo en el navegador demo. MapLibre 5.24.0, el adaptador, render y mapa base son reales.** No se generaron pedidos ni pagos productivos. La instrumentación de QA conserva SRI y la librería original: registra la instancia para medir cámara/marker, no reemplaza el motor por un stub.

Las capturas esperan tiles y geometría renderizada; habilitan preserveDrawingBuffer sólo en QA para conservar píxeles de WebGL. Los tests y el benchmark usan la configuración del producto. En este host Windows, la captura de WebKit puede omitir el raster del mapa base aun con tiles/geometry presentes: ocurre también en BEFORE. Las capturas Chromium muestran el mapa pintado; los checks funcionales de WebKit se distinguen de una certificación visual/GPU física de Safari.

## Cambios

- `cooperativeGestures: false`, dragPan y pinch habilitados, rotación/pitch desactivados. Un dedo mueve el mapa con intención horizontal/diagonal. Un primer gesto claramente vertical deja scrollear la página desde cualquier parte del canvas: no hace falta buscar un borde. Pinch controla el zoom. La decisión de intención se fija al principio del gesto y no cancela el default de un scroll de página.
- La misma regla se usa en el selector de ubicación; allí un tap intencional confirma el punto del pin. Hay guarda breve para el click residual del arrastre y limpieza de listeners al destruir el mapa.
- Preparing/confirmed muestran comercio y destino, sin intentar seguir al Rider. Assigned/ready priorizan Rider y local cuando existe GPS. En camino considera Rider + destino con padding derivado del viewport. Al entregar se retira el Rider y se enfoca el destino disponible. No se inventa ningún punto.
- Una transición de cámara corta por fix aceptado, no una por frame/poll. El marker interpola hasta 900ms, con convergencia breve tras una interrupción. Un jitter menor a 3m conserva la posición visual y actualiza la medición/frescura. La coordenada medida no se reescribe como interpolada.
- Pan/zoom/teclado manual pausan follow, sin reactivarlo por inactividad. “Seguir repartidor” vuelve a encuadrar. Entrar de nuevo al seguimiento, cambiar de pedido o pasar a on_the_way pueden reactivar follow. Background/foreground conserva explore y planta el fix actual sin replay histórico.
- El árbol de tracking se actualiza conservando los ancestros y el canvas conectado. Se mantiene abierta la sección de detalles si el cliente la abrió. El CTA conserva una geometría estable al presionarlo.
- En camino, mapa de aproximadamente 46dvh (388px a 390×844, 429px a 430×932), dentro de límites legibles; desktop 460px. En la puerta, el mapa vuelve a ser más compacto para que código de entrega/contacto sigan accesibles.
- Cabecera dinámica, timeline compacto, filas de espera ligeras y panel del Rider bajo el mapa. Destino, local y Rider mantienen siluetas distintas. Disco de Rider refinado y pulse finito por desplazamiento significativo; indicador de señal estático, sin loops decorativos sobre el mapa.
- Checkout: bordes neutrales, radios y focus/error explícitos, sin cambiar formularios, validaciones, direcciones ni pagos.

Map north-up estable. No se orienta el marker a partir de coordenadas aproximadas: el contrato público puede redondear GPS y no entrega un heading fiable para esta evidencia. La ruta existente verificada de sandbox se conserva; **no se dibuja una supuesta ruta real** ni ETA donde el dominio no las trae. Frescura/offline siguen siendo textuales y el último Rider conocido no desaparece por una señal vieja. La atribución del mapa base se conserva.

Las opciones de cámara y gestos siguen la [API oficial de MapLibre](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/) y sus [opciones de mapa](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/). La separación de intención se verifica sobre los handlers y el canvas reales.

## Pruebas y límites

- `npm test`: **2905 PASS**, sin fallas. [Log](unit-tests-final.log). Retest final de mapa/motion/terminal: **100 PASS**. [Log](map-unit-final.log).
- Suite específica del mapa: **26 PASS, 6 omisiones de driver**. [Log](map-tests-final.log). Además **4 PASS** del retest que exige cero animaciones infinitas sobre el mapa. [Log](finite-motion-final.log).
- Teclado/foco: **4/4 PASS**. [Log](keyboard-final.log). Retest final de cámara, follow y background con conservación de zoom: **8/8 PASS**. [Log](camera-final.log).
- Pan/pinch **nativos**: Chromium móvil por protocolo de navegador. TouchEvent sintéticos ejercen pan/pinch y el default vertical sin cancelar en ambos motores, incluido WebKit. Mouse, follow/override, recenter, keyboard, resize, identidad/conexión de canvas y lifecycle usan MapLibre real.
- Las seis omisiones corresponden a los dos gestos nativos en tres proyectos que no son Chromium móvil. No se declaran como pruebas físicas de Safari. El cambio de foreground se dispara como evento de lifecycle: falta el cambio real de app de iOS.
- Regresión amplia: 166 casos observados, 162 PASS y 4 FAIL iniciales. La copia de cabecera y la composición de llegada se corrigieron; el retest de esos flujos pasó **3/3**. [Log](arrival-honesty-final.log). Checkout/Mercado Pago entry/handoff, dirección, carrito, PWA y worker activo ante red degradada pasaron en los casos ejecutados.
- **Dos fallas previas permanecen:** los tests de expiración de tracking esperan una lectura inicial y reciben dos. Se reprodujeron en main sin cambios; [baseline](terminal-main-baseline.log) y [retest del candidato](tracking-regression-retest.log). No se cambió autoridad de pedidos, polling/expiry ni backend para forzar un PASS. La corrida amplia terminó sus 166 casos pero se interrumpió su teardown colgado; el informe usa los veredictos observados, no inventa un exit code exitoso.
- `npm run check`: identidad/precache/CSS, sintaxis, higiene, encoding y secretos. [Log](check.log). CSS v75 y CACHE v146 incluyen el módulo de intención y la nueva hoja. Las tres rutas de retorno de pago sólo cambian el token del stylesheet.

## Performance

[Medidas reproducibles](performance.json): un navegador por vez, mismos estados/tiles y viewport, tres muestras rAF en reposo y tres durante GPS nuevo (mediana del p95). Se miden CLS, long tasks, renders de canvas en reposo, desconexiones y animaciones infinitas.

| Motor | Ancho | p95 rAF en reposo antes → después | p95 durante GPS antes → después | Desconexiones de canvas | Loops infinitos del mapa |
|---|---|---|---|---|---|
| chromium | 390 | 16.7 → 16.7 ms | 16.7 → 16.8 ms | 6 → 0 | 2 → 0 |
| chromium | 430 | 16.7 → 16.8 ms | 16.8 → 16.7 ms | 6 → 0 | 2 → 0 |
| chromium | 1440 | 16.8 → 16.8 ms | 16.8 → 16.8 ms | 6 → 0 | 2 → 0 |
| webkit | 390 | 16.0 → 32.0 ms | 34.0 → 31.0 ms | 6 → 0 | 2 → 0 |
| webkit | 430 | 18.0 → 32.0 ms | 32.0 → 32.0 ms | 6 → 0 | 2 → 0 |
| webkit | 1440 | 27.0 → 32.0 ms | 48.0 → 34.0 ms | 6 → 0 | 2 → 0 |

Chromium conserva aproximadamente 16.7–16.8ms por cuadro. El **p95 durante GPS** de WebKit no muestra una regresión material en esta muestra. La cadencia rAF en reposo de WebKit varía y **no permite afirmar 60fps físicos**; se muestra aparte, sin ocultarla. El candidato no tiene animaciones decorativas infinitas en el mapa y su propia interpolación no mantiene un rAF al quedar quieto. CLS 0 en las muestras. PASS de performance es comparativo para las actualizaciones activas probadas, no una certificación de Safari/iPhone físico ni una prueba de carga de toda la app.

## Aislamiento y entrega

No se modificaron OAuth, MP worker/webhook/seller/activación, checkout authority, Supabase/migraciones/RLS, estados de pedido/stock, Rider Android ni Caja Clara. Cambios principalmente frontend público; las fixtures son locales. La evidencia de artifacts no viaja en el release web.

```text
PROJECT_PATH: . (absolute path in delivery report)
BRANCH: feat/tracking-premium-map-20261007
SOURCE_MAIN_SHA: cd26834b25909a3fbf6b5133af7b70c39a35fc2d
FINAL_SHA: PR head; see external delivery report
ONE_FINGER_PAN: PASS
PINCH_ZOOM: PASS
PAGE_SCROLL: PASS
RIDER_AUTO_FOCUS: PASS
RIDER_AUTO_FOLLOW: PASS
USER_OVERRIDE: PASS
RECENTER_CONTROL: PASS
NO_HISTORY_REPLAY: PASS
BACKGROUND_FOREGROUND: PASS
GPS_SMOOTHING: PASS
TRACKING_VISUAL_REFINEMENT: PASS
CHECKOUT_VISUAL_REFINEMENT: PASS
CHROMIUM: PASS
WEBKIT_EMULATION: PASS
IPHONE_REAL: NOT_RUN
PERFORMANCE: PASS
PR: pending creation
READY_FOR_VISUAL_REVIEW: YES
DEPLOYED: false
```

FINAL_SHA, PROJECT_PATH absoluto y PR están en el reporte externo de entrega y en el HEAD del PR. READY_FOR_VISUAL_REVIEW no equivale a aprobación de merge/deploy: faltan revisión visual, CI remoto completo y prueba física si se exige iPhone real.

## Repetir

Servir main cd26834b en 18250 y el candidato en 18251 con `node scripts/realtime-relay.mjs PORT`. Luego:

```powershell
npx playwright test -c playwright.tracking-premium.config.mjs
node scripts/qa-tracking-captures.mjs before
node scripts/qa-tracking-captures.mjs after
node scripts/qa-tracking-checkout-captures.mjs
node scripts/qa-tracking-motion.mjs
# Benchmark sólo sin otras suites de navegador activas.
node scripts/qa-tracking-performance.mjs
node scripts/qa-tracking-gallery.mjs
node scripts/qa-tracking-report.mjs
```

Los MP4 se convierten con ffmpeg desde los WebM originales conservados.
