import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('artifacts/tracking-helmet-20261007');
const report=`# Unificación del casco del Rider · La Taba

El marcador del mapa reutiliza literalmente los trazos del casco existente en la tarjeta. La moto fue retirada del mapa; el marcador mantiene 50×50 px y su anclaje. En la tarjeta el SVG estaba escalado de forma desigual; ahora el avatar mide 40×40 px dentro del contenedor circular de 46×46 px. Ambos comparten geometría; el cuello queda sólo en el retrato.

El dark mode mantiene el disco rojo, aro blanco y casco blanco. El disco de la tarjeta usa el mismo rojo y recibe un borde claro y sombra suave. No se añadieron filtros, imágenes, assets remotos ni animaciones continuas.

## Comparación

- Abrí [comparison.html](comparison.html) para mover la cortinilla antes/después, elegir los estados assigned/on_the_way, 390×844, 430×932 o 1440×900 y Chromium/WebKit.
- On the way: [antes mobile 390](before/chromium/390x844-on-the-way.webp) · [después mobile 390](after/chromium/390x844-on-the-way.webp); [antes mobile 430](before/chromium/430x932-on-the-way.webp) · [después mobile 430](after/chromium/430x932-on-the-way.webp); [antes desktop 1440](before/chromium/1440x900-on-the-way.webp) · [después desktop 1440](after/chromium/1440x900-on-the-way.webp).
- Assigned: [antes mobile 390](before/chromium/390x844-assigned.webp) · [después mobile 390](after/chromium/390x844-assigned.webp); [antes mobile 430](before/chromium/430x932-assigned.webp) · [después mobile 430](after/chromium/430x932-assigned.webp); [antes desktop 1440](before/chromium/1440x900-assigned.webp) · [después desktop 1440](after/chromium/1440x900-assigned.webp).
- Card on the way: [antes](before/chromium/390x844-on-the-way-card.webp) · [después](after/chromium/390x844-on-the-way-card.webp). Marker 5×: [antes](before/chromium/390x844-on-the-way-marker-5x.png) · [después](after/chromium/390x844-on-the-way-marker-5x.png).
- Matriz: 2 estados × 3 viewports × 2 motores × 2 versiones; incluye mapa, tarjeta y recorte del marker. WebKit es emulado en Windows, no una certificación física.

En assigned la tarjeta sí identifica al Rider, pero la UI todavía no muestra ubicación ni marker porque no hay GPS de reparto publicado. La suite conserva ese comportamiento y prueba que no invente una ubicación; el marker se compara únicamente en on_the_way.

Antes se usa el SVG y CSS capturados de PR #143 head \`f85ca90f\`; después el candidato de este ajuste. Se bloquea la cámara con el mismo centro y zoom en ambas capturas para aislar la identidad del ícono. Los pedidos y el GPS son de QA local; el engine y mapa base son reales. preserveDrawingBuffer sólo está habilitado por el script de screenshot para leer el buffer; la ejecución normal y la medición conservan el default del mapa.

## Archivos

- \`js/map/rider_marker.js\`: sustituye \`riderScooterSvg\` por \`riderMapHelmetSvg\`. El perfil comparte \`riderHelmetProfileMarkup\` con el avatar; el casco del marcador se centra dentro del disco. Etiqueta accesible actualizada a casco.
- \`styles/tracking-premium.css\`: tamaños, disco rojo unificado, borde claro y sombra suave del avatar en \`on_the_way\`/\`picked_up\`.
- \`tests/map.test.mjs\`, \`tests/tracking-always-on-map.test.mjs\`, \`tests/operational-hardening.test.mjs\`, \`tests/e2e/tracking-arriving.spec.mjs\`, \`tests/e2e/direct-ordering-growth.spec.mjs\`: verifican identidad del casco/ARIA y ausencia del SVG de moto, preservando el ciclo de vida/actualizaciones del marker.
- CSS/PWA: se incrementa \`styles.css\` a v76 y CACHE a v147; actualizados \`sw.js\`, \`index.html\`, preflight, páginas de retorno y tests de precache. Es necesario para que el SVG compartido no quede viejo en una cache instalada; el service worker y checkout/payment authority no cambian.

## Verificación

- Tests de mapa/presentación: **68 PASS**, sin fallas. [Log](unit-tests.log).
- PWA, precache, paquete de retorno, versión CSS e identidad: **28 PASS**. [Log](pwa-tests.log).
- Seguimiento/follow/updates GPS: la matriz responsive Android Chromium, iPhone WebKit emulado y desktop Chromium/WebKit tuvo **8 PASS**. [Log](browser-responsive-retest.log). La corrida local completa sumó **7 PASS y 2 SKIP** (interacciones táctiles nativas fuera de Chromium desktop); auto-follow aislado PASS. [Logs](browser-tests.log) y [marker](tracking-marker-browser-retest.log).
- Corrección colateral del parent #143: marca/home dark surface **1 PASS** y vista arriving/CTA viewport **1 PASS**. [Logs](brand-home-retest.log) y [tracking-arriving-retest.log).
- Flujo adicional de tracking público, terminal states y hardening: **5 PASS**. [Log](e2e-retest.log).
- \`npm run check\`, release hygiene, mapa de precache y scan de secretos: PASS. [Log](check.log).
- Manifiestos [BEFORE](before/manifest.json) / [AFTER](after/manifest.json): assigned y on_the_way sin errores JS ni overflow, marker 50×50, card 46×46, SVG avatar 40×40, casco único en mapa, moto ausente.
- Contraste blanco sobre rojo del disco: **4.39:1**. Reduced motion no crea loops.

La revisión de la clase “moto” en el test precedente corrigió únicamente stale assertions; ninguna lógica del tracking cambia. El mapa, la tarjeta, el GPS, smoothing, auto-follow, override, estados y API permanecen iguales a #143. PR #143 CI mostraba dos fallas de E2E —fondo de la card y altura de arriving—; ambos casos se reprodujeron y pasaron ya en este árbol. El PR #143 original sigue separado y sin modificar.

## Estado

\`\`\`text
HELMET_ICON_UNIFIED: YES
OLD_MOTORCYCLE_REMOVED: YES
MAP_MARKER_UPDATED: YES
RIDER_CARD_CONSISTENCY: PASS
TRACKING_REGRESSION: PASS
AUTO_FOLLOW: PASS
MANUAL_OVERRIDE: PASS
BACKGROUND_FOREGROUND: PASS
MOBILE_VISUAL: PASS (390, 430; Chromium y WebKit emulado)
DESKTOP_VISUAL: PASS (1440×900)
IPHONE_REAL: NOT_RUN
READY_FOR_REVIEW: YES
\`\`\`

## Límite y reproducción

La geometría del SVG se verifica en los tests, y Chromium sí pinta el basemap en la matriz. WebKit en este host puede dejar el raster vacío aun cuando el mapa tiene geometría/tiles cargados; no es prueba física de Safari/iOS. El video/mapa no se edita ni recompone.

Repetir con main en 18250 y el candidato en 18251 mediante \`node scripts/realtime-relay.mjs PORT\`:

\`\`\`powershell
node scripts/qa-tracking-helmet.mjs before
node scripts/qa-tracking-helmet.mjs after
node scripts/qa-tracking-helmet-report.mjs
npm run check
node --import ./tests/test-bootstrap.mjs --test tests/map.test.mjs tests/tracking-always-on-map.test.mjs tests/location-picker-map.test.mjs tests/operational-hardening.test.mjs
\`\`\`

PR #143 está abierto y no integrado. La rama fix/tracking-rider-helmet-visual-20261007 parte del head verificado de PR #143 para heredar el refinamiento previo; este PR queda apilado sobre PR #143. Ningún cambio se desplegó.
`;
fs.writeFileSync(path.join(root,'README.md'),report);
const variants=[process.cwd(),process.env.TABA_QA_BASELINE_ROOT].filter(Boolean).flatMap(p=>[
  p,p.replaceAll('\\','/'),JSON.stringify(p).slice(1,-1),new URL(`file:///${p.replaceAll('\\','/')}`).href.replace(/\/$/,'')]);
function scrub(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);if(entry.isDirectory())scrub(file);
  else if(/\.(json|log|html|md)$/.test(entry.name)){
    let text=fs.readFileSync(file,'utf8');for(const pathText of variants)text=text.split(pathText).join('<repo>');
    text=text.replace(/(?:[A-Za-z]:[\\/][^\s`"'<>|]+|\/(?:home|Users)\/[^/\s]+(?:\/[^\s`"'<>|]*)*)/g,'<local-path>');
    text=text.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'');
    if(entry.name.endsWith('.log'))text=text.split(/\r?\n/).map(line=>line.trimEnd()).join('\n');
    fs.writeFileSync(file,text);
  }
}}
scrub(root);console.log('Helmet report written; evidence paths sanitized');
