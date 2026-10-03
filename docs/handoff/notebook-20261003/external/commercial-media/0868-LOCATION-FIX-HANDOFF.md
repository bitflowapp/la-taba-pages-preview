# LOCATION-FIX-HANDOFF

Qué se entregó, dónde está, qué falta y qué **no** hay que hacer.

---

## 1 · Dónde está el trabajo

| Repositorio | Worktree | Rama | HEAD |
| --- | --- | --- | --- |
| Web / Panel / tracking | `D:\1212\worktrees\taba2-location-truth-web` | `fix/taba2-location-truth` | `9621d83` |
| Rider (Android) | `D:\1212\worktrees\taba2-location-truth-rider` | `fix/taba2-rider-location-truth` | `4ad0b55` |

Los dos árboles están **limpios**. **No hay push**: las ramas viven sólo acá.

**Commits**

```
web    9621d83  fix(ubicación): un archivo vigilado que desaparece dejaba de vigilarse en silencio
web    8ec120f  fix(ubicación): La Taba 2 estaba a 793 m de donde el sistema la ponía
web    7d515d4  fix(config): una coordenada vacía dejaba de ser vacía y pasaba a ser 0,0
rider  4ad0b55  fix(mapa): el Rider ya sabe dónde está La Taba 2, y ahora lo dibuja ahí
```

Base intacta: `release/taba2-pilot-rc2` (f611492) y `release/taba2-rider-pilot-rc2`
(ff6d014). Ninguna rama certificada fue modificada.

---

## 2 · Qué se corrigió, en una línea cada uno

1. **El punto.** Estaba escrito a mano en cuatro archivos, las cuatro copias decían lo
   mismo y lo mismo equivocado, y caía a 793 m de la puerta, junto a Parque Central.
   Ahora entra una sola vez, en `data/business-location.json`, con su procedencia
   declarada, y todo lo demás lo deriva.
2. **El pin del Rider.** Aun con la coordenada correcta, el mapa de la app lo dibujaba
   74 dp al sur: `flutter_map` invierte la lectura ingenua de `Marker.alignment`, y el
   pin del negocio usaba `bottomCenter` donde el de la entrega usaba `topCenter`. Es de
   donde salía «Islas Malvinas».
3. **El enlace a Maps.** Se agregó «Cómo llegar» en la ficha del comercio, y abre por
   **coordenadas**: el texto «Mendoza 827» resuelve en Zapala, a 175 km.
4. **El sembrado de staging.** Dejó de escribir el punto como `qa_fixture` y lo escribe
   con origen, confianza y nota de procedencia. No pisa un punto ya verificado.
5. **Una coordenada vacía.** `Number(null)` vale 0, y 0 es finito: el saneador aceptaba
   un punto ausente y lo guardaba como 0,0. Corregido en su propio commit.
6. **El guardián se guardaba a sí mismo mal.** Un archivo vigilado que no existe se
   salteaba con `continue`: un renombre bastaba para dejar de mirar una superficie sin
   que nada avisara. Ahora es un fallo con nombre.
7. **El video.** Escenas 3 y 4 refilmadas. Las otras nueve, intactas.

El detalle, la evidencia y los puntos descartados están en
**`LOCATION-TRUTH-MANIFEST.md`**.

---

## 3 · Qué se certificó, y con qué números

| | |
| --- | --- |
| `npm run check` (web) | **verde**, con `location:check` adentro |
| `npm test` (web) | **1175 / 1175** |
| `npx playwright test` (web, navegador real) | **207 / 207** |
| `flutter test` (Rider) | **256 / 256** |
| Superficies comparadas por `location:check` | **5**, en 4 lenguajes |
| Verificación en el equipo real | Moto G15, Android 15, build `commercialReview` |

Los goldens del Rider se regeneraron **acotados**: se miró primero el `isolatedDiff`,
que mostraba el mismo pin dibujado dos veces —uno encima del otro— y nada más. No se
corrió `--update-goldens` a ciegas sobre la suite.

**Sobre el gate de navegador.** La primera corrida dio 206 / 207: cayó
`business-windows-operations › panel fiscal … nota de crédito fixture`. Se corrió la
suite completa sobre la base sin este cambio (**207 / 207**) y después otra vez sobre la
rama (**207 / 207**, mismo código). El fallo no se reproduce; durante la primera corrida
el host estaba decodificando el master de 46 MB con ffmpeg. Ese test tiene una carrera
propia —acepta un diálogo del navegador y hace el click siguiente sin esperar a que se
cierre— y va a volver a caer en una máquina cargada. **Es deuda de ese spec, no de este
cambio, y sigue abierta.**

---

## 4 · El video

`TABA2-WALTER-DEMO.mp4` · 1920×1080 · 30 fps · **4:52** · 46 MB
`TABA2-WALTER-DEMO-sin-musica.mp4` · sin audio
`TABA2-WALTER-DEMO-720p.mp4` · 1280×720 · **7,3 MB** (para mandar por WhatsApp)

**Sólo cambiaron dos clips.** Los otros nueve se re-codificaron desde su mismo crudo y
conservan la duración al décimo de segundo:

| Clip | Antes | Ahora | |
| --- | --- | --- | --- |
| `00-apertura` | 10,1 s | 10,1 s | intacto |
| `01-cliente` | 49,4 s | 49,4 s | intacto |
| `02-prueba-mercado-pago` | 18,4 s | 18,4 s | intacto |
| `03-negocio` | 22,8 s | 22,8 s | intacto |
| **`04-reparto`** | 29,7 s | **29,5 s** | **refilmado** |
| **`05-seguimiento`** | 23,1 s | **17,2 s** | **refilmado** |
| `06-operacion` | 36,0 s | 36,0 s | intacto |
| `07-ventas-y-stock` | 21,0 s | 21,0 s | intacto |
| `08-facturacion` | 39,9 s | 39,9 s | intacto |
| `09-whatsapp` | 23,0 s | 23,0 s | intacto |
| `10-cierre` | 24,8 s | 24,8 s | intacto |

**Escena 4** (seguimiento): el recorrido arranca ahora en Mendoza 827; antes arrancaba
793 m al sudoeste. El destino es una plaza declarada como punto de demostración y la
ruta es la que devuelve OSRM sobre calles reales.

**Escena 3** (reparto): las **nueve** capturas del teléfono se rehicieron en una sola
corrida. Seis estaban obsoletas —unas mostraban el comercio «Tercera Docena — Diag.
España 115», que ya no existe en el repositorio, con el pin junto a Parque Central;
otras decían «no hay coordenadas autorizadas», que era cierto hasta este arreglo—. Las
anteriores se conservan en `_work/overlay/stills/_reemplazadas-20260808/`, y el crudo
anterior de la escena en `_work/raw/_reemplazadas-20260808/`.

**Una línea de narración cambió**, en 01:52:

> antes: «Sale a la calle con el mapa y su posición real.»
> ahora: «Sale a la calle con el mapa, y el retiro cae en Mendoza 827.»

Porque estas capturas no llevan fix de GPS, y el punto azul de la versión anterior era
la ubicación real de quien sostenía el teléfono ese día. Rótulos actualizados en
consecuencia: chips «App Android real» + «Datos de prueba», pie «Capturas del
dispositivo real · Moto G15 · Android 15 · pedido de prueba».

Se reproduce con `_work/capturar-rider.ps1` + `node _work/s3.mjs` + `node _work/build.mjs`.

---

## 5 · Lo que falta

### a) La verificación humana del pin — **el único pendiente que importa**

Nadie del comercio confirmó todavía el punto contra la puerta. Hasta que eso pase,
`human_verified` es `false` y la precisión declarada es de 20 m. **No hay que subirlo
desde un escritorio.** El procedimiento exacto está en el manifiesto, sección «Cómo se
sube a verificación humana».

Antes del primer pedido humano físico, ese escalón hay que darlo.

### b) Aplicar el sembrado a staging

`supabase/staging-rider-map-pickup-point.sql` está corregido pero **no se aplicó**: el
lock `taba2-staging-mutation` no lo tomó esta sesión. Es idempotente, no destructivo y
aborta si el punto cae fuera de Neuquén Capital. Al aplicarlo, invalida las
comprobaciones de presencia anteriores, que es lo correcto: se habían hecho contra otra
coordenada.

### c) Los pedidos ya emitidos

`rider_map_capture_order_location` fotografía la ubicación en el alta del pedido, y esa
foto es inmutable a propósito. **Los pedidos anteriores al 2026-08-08 llevan
fotografiado el punto equivocado de Parque Central.** No se corrigen y no hay que
corregirlos: la instantánea es histórica.

### d) Una carrera en un test ajeno

`business-windows-operations.spec.mjs`, en el bloque de la nota de crédito, hace
`page.once('dialog', …)`, dispara la reimpresión y hace click en el `<summary>`
siguiente sin esperar a que el diálogo se haya cerrado. En una máquina cargada el click
se traga, el `<details>` no abre y el `fill` agota su tiempo. Cayó una vez acá y otra
sesión ya dejó artefactos de fallo de otro test del mismo archivo. **No se tocó**: está
fuera del alcance de esta corrección y arreglarlo de paso habría mezclado dos cosas.

### e) Sin fusionar

Las dos ramas están sin push y sin merge. Nadie más las ve todavía.

---

## 6 · Lo que NO hay que hacer

- **No subir `human_verified` a true** sin una persona del comercio confirmando el pin
  contra la puerta. Falla en cuatro lugares, y bien.
- **No escribir la coordenada a mano** en ninguna superficie. Ese es el error que se
  acaba de corregir. Se cambia el contrato y se corre `npm run check`.
- **No abrir Maps por el texto de la dirección.** «Mendoza 827» sin acotar la ciudad
  devuelve Zapala, a 175 km.
- **No volver a usar** `-38.9516, -68.0591`, `-38.95172, -68.05942`, Parque Central,
  `qa_fixture` ni Islas Malvinas 145. El chequeo los rechaza en código ejecutable; en
  comentarios y en la nota de procedencia están escritos a propósito.
- **No mostrar un fix de GPS en el video.** El punto azul es la ubicación real de quien
  sostiene el teléfono.
- **No reemplazar las capturas de la escena 3 de a una.** Si hay que rehacer alguna, se
  rehacen las nueve de una corrida: mezclar épocas del producto es lo que dejó la
  escena mostrando un comercio que ya no existe.

---

## 7 · Declaraciones de esta sesión

| | |
| --- | --- |
| Producción tocada | **no** |
| Staging mutado | **no** |
| ARCA tocado | **no** |
| Mercado Pago tocado | **no** |
| Pedidos reales tocados | **ninguno** |
| Datos de una persona | **ninguno** |
| Push | **ninguno** |
| Ramas certificadas modificadas | **ninguna** (sólo lectura) |

**Moto G15** (serial ZY32LHS6PS): se instaló únicamente la variante
`commercialReview` (`com.lataba.rider.review`), que va **al lado** de staging, no lleva
ninguna configuración de backend y se alimenta de fixtures locales. No se instaló
staging ni producción; no se tocó ningún pedido. El pedido que aparece en las capturas,
`LT-1042`, y el domicilio «Los Álamos 1450, Confluencia» son fixtures del build de
revisión.

**Puertos usados:** 8481 (servidor estático de captura, cerrado al terminar). Se
declararon 8541/18841 para Playwright E2E; no hizo falta usarlos.

---

## 8 · Para el que siga

Leer, en este orden:

1. **`LOCATION-TRUTH-MANIFEST.md`** — el punto, su evidencia y qué no afirma.
2. **`CRASH-RECOVERY-REPORT.md`** — de dónde venía esto y qué se recuperó.
3. `data/business-location.json` — el contrato mismo, que se explica solo.
4. `scripts/check-location-contract.mjs` — lo que impide que vuelva a desviarse.

Y correr, antes de creerle a nadie:

```bash
cd D:\1212\worktrees\taba2-location-truth-web
$env:TABA_RIDER_REPO='D:\1212\worktrees\taba2-location-truth-rider'
npm run check
```
