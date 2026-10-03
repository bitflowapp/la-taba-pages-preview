# CRASH-RECOVERY-REPORT

**Sesión recuperada:** `TABA2_REAL_LOCATION_CONTRACT_AND_WALTER_DEMO_CORRECTED`
**Caída:** 2026-08-08, ~15:07 (hora local, UTC−3) — `Bun v1.4.0 · Stack overflow ·
Segmentation fault`
**Recuperación:** 2026-08-08, 15:21 → 16:0x

La caída fue del proceso del agente, no del producto. Nada de lo que estaba en curso
se descartó: no se ejecutó `reset`, `clean`, `stash` ni `checkout` destructivo, y los
archivos que se reemplazaron quedaron respaldados en carpetas fechadas.

---

## 1 · Qué worktree estaba activo

Dos, hermanos, creados por la sesión que cayó. Ninguna rama certificada fue tocada:
`release/taba2-pilot-rc2`, `release/taba2-rider-pilot-rc2`,
`release/taba2-first-physical-e2e` y `release/taba2-rider-first-physical-e2e` sólo se
leyeron.

| Worktree | Rama | Base |
| --- | --- | --- |
| `D:\1212\worktrees\taba2-location-truth-web` | `fix/taba2-location-truth` | `release/taba2-pilot-rc2` |
| `D:\1212\worktrees\taba2-location-truth-rider` | `fix/taba2-rider-location-truth` | `release/taba2-rider-pilot-rc2` |

## 2 · Branch y HEAD en el momento del rescate

`fix/taba2-location-truth` → **f611492**
`fix/taba2-rider-location-truth` → **ff6d014**

Los dos exactamente en su commit base.

## 3 · Cambios commiteados por la sesión caída

**Ninguno.** Cero commits propios en las dos ramas. Todo el trabajo estaba sin
commitear cuando el proceso murió, que es la razón por la que este informe existe.

## 4 · Cambios sin commit encontrados, y preservados

**Repositorio web** — 7 modificados, 4 nuevos:

| Archivo | Qué traía |
| --- | --- |
| `data/business-location.json` *(nuevo)* | el contrato: punto, procedencia, evidencia y los cinco puntos descartados |
| `js/core/business-location.js` *(nuevo)* | el espejo que consume el navegador, con los constructores de enlaces a Maps |
| `scripts/check-location-contract.mjs` *(nuevo)* | el guardián que compara las cinco superficies |
| `tests/business-location-contract.test.mjs` *(nuevo)* | las pruebas del contrato |
| `js/config.js` | deja de escribir la coordenada a mano; la deriva del contrato |
| `js/sandbox/sandbox_map_scenario.js` | origen del contrato, destino público, ruta real de OSRM |
| `js/ui.js` · `index.html` | «Cómo llegar», que abre por coordenadas |
| `supabase/staging-rider-map-pickup-point.sql` | deja de sembrar `qa_fixture` |
| `package.json` | `location:check` enganchado en `npm run check` |
| `tests/config.test.mjs` | el punto viejo ya no puede volver |

**Repositorio del Rider** — 12 modificados, 1 nuevo: la coordenada compilada, el
respaldo del punto de retiro, la corrección del anclaje del pin
(`bottomCenter` → `topCenter`), `test/features/map/stop_pin_anchor_test.dart` y cuatro
goldens.

## 5 · Artefactos que ya existían

- `_work/raw/s4.webm` + `s4.json` (15:07:31) — **la escena 4 ya estaba refilmada y
  completa**: 36,8 s, 1920×1080, con su corte y sus dos cues escritos. Se verificó
  fotograma a fotograma antes de darla por buena.
- `screenshots/13-tracking-en-camino.png` y `14-tracking-detalle.png` (15:07).
- El APK `commercialReview` construido a las **15:08:17**, ya con la corrección del
  pin, pero **sin instalar**: el teléfono tenía la versión de las 14:54.
- `clips/` y los tres `.mp4` finales seguían siendo los de las 05:43. **El montaje no
  se había rehecho.**

## 6 · Último paso completado antes de la caída

La refilmación de la escena 4, terminada a las **15:07:31**. Inmediatamente después la
sesión construyó el APK con el arreglo del pin (15:08:17) y murió antes de instalarlo.

## 7 · Primer pendiente real, y por dónde se retomó

**Certificar el código antes de commitear.** El reloj lo dijo solo:
`rider_map.dart` se editó a las **15:01:16** y los goldens del Rider eran de las
**14:41:52**. Estaban obsoletos respecto de la corrección del anclaje, así que la
suite del Rider no podía estar en verde. Era el primer eslabón del que colgaba todo lo
demás: sin código certificado no hay commit, y sin commit no hay entrega.

Se confirmó: **4 goldens fallaban**, los cuatro con el mismo diff —1,36 % / 3824 px en
dos, 1,37 % / 3856 px en los otros dos—. El `isolatedDiff` mostraba el mismo pin
dibujado dos veces, uno encima del otro, y nada más: la corrección del anclaje. Se
regeneraron acotado a esos dos archivos de prueba, sin `--update-goldens` a ciegas
sobre la suite entera. Al volver a correr la suite entera aparecieron **6** goldens
cambiados: dos más, de `pilot_map_golden_test`, que sólo dependían del anclaje.

---

## Lo que se hizo después, en orden

| # | Paso | Resultado |
| --- | --- | --- |
| 1 | `npm run check` + `npm test` en el repo web | 1175/1175 · check en verde, con el contrato incluido |
| 2 | `flutter test` en el Rider, goldens acotados | 256/256 |
| 3 | Prueba nueva del enlace «Cómo llegar» | destapó un defecto real (ver abajo) |
| 4 | APK `commercialReview` reconstruido e instalado en el Moto G15 | ADB autorizado; instalado al lado de staging |
| 5 | Recaptura de la escena 3 en el teléfono | 9 pantallas, una sola corrida |
| 6 | Refilmación de la escena 3 y remontaje | 4:52 · sólo cambiaron los clips 5 y 6 |
| 7 | Tres commits en web, uno en el Rider | git limpio en los dos worktrees |
| 8 | `npx playwright test` — el gate de navegador entero | **207 / 207** (ver abajo) |

### El defecto que apareció recuperando

Al escribir la prueba del enlace «Cómo llegar» —la única superficie de esta corrección
que no tenía ninguna—, el caso «un patch sin coordenada» falló. `Number(null)` vale 0,
y 0 es finito: el saneador de la config aceptaba un punto ausente y lo guardaba como
**0,0**, que es un lugar real en el Golfo de Guinea. Hoy no es alcanzable desde el
producto, pero es exactamente la clase de error que hace que una ubicación sea falsa
sin que nada avise. Va corregido en su propio commit (`7d515d4`).

### El test que falló una vez, y cómo se cerró

La primera corrida del gate de navegador terminó **206 / 207**. El que cayó fue
`business-windows-operations.spec.mjs › panel fiscal … y nota de crédito fixture`:
después de abrir la vista previa de un PDF, bajar el archivo y disparar una
reimpresión que acepta un diálogo del navegador, hace click en un `<summary>` y
escribe en el campo que ese `<details>` debería haber abierto. El campo nunca se hizo
visible.

La tentación era declararlo flaky y seguir. En vez de eso se midió:

| Corrida | Resultado |
| --- | --- |
| Mi rama · suite completa (1ª) | **206 / 207** |
| Mi rama · ese spec solo | 4 / 4 en 7,3 s |
| Base sin este cambio · ese spec solo | 4 / 4 |
| **Base sin este cambio · suite completa** | **207 / 207** en 8,0 min |
| **Mi rama · suite completa (2ª)** | **207 / 207** en 8,0 min |

La cuarta fila es la que importaba: la base pasa entera bajo la misma carga, así que
«en la base también falla» habría sido falso. Con una sola observación no alcanzaba
para descartar el cambio, y por eso se repitió la suite completa sobre la rama. **Pasó
207 / 207 sobre exactamente el mismo código.** El fallo es intermitente y no
reproducible.

La causa material, además, es identificable: durante la primera corrida se estaba
decodificando el master de 46 MB con ffmpeg para armar una grilla de control. El primer
test de ese archivo tardó **21,2 s** en una corrida y **1,6 s** en otra sobre el mismo
código — eso es contención del host, no comportamiento. Y el propio test tiene una
carrera latente: acepta un diálogo del navegador y hace el click siguiente sin esperar
a que se haya cerrado.

**Queda anotado como deuda ajena a este cambio**, no como algo resuelto: ese
`page.once('dialog', …)` seguido de un click inmediato va a volver a caer en una
máquina cargada. Otra sesión ya dejó artefactos de fallo de **otro** test del mismo
archivo en `D:\1212\la-taba2-pilot-rc\test-results\`.

### El alcance que creció, y por qué

La escena 3 iba a necesitar **una** captura nueva. Al mirarlas todas, seis de las nueve
estaban obsoletas: unas mostraban el comercio «Tercera Docena — Diag. España 115», que
ya no existe en el repositorio, con el pin junto a Parque Central; otras decían «no hay
coordenadas autorizadas», que era cierto hasta este arreglo y dejó de serlo con él. Se
recapturaron las nueve de una sola corrida sobre un solo build, así la escena quedó
internamente coherente. Las anteriores se conservan en
`_work/overlay/stills/_reemplazadas-20260808/`.

---

## Estado final

| | |
| --- | --- |
| `fix/taba2-location-truth` | `9621d83` · árbol limpio |
| `fix/taba2-rider-location-truth` | `4ad0b55` · árbol limpio |
| Web | `npm run check` en verde · `npm test` 1175/1175 · `playwright test` 207/207 |
| Rider | `flutter test` 256/256 |
| Video | `TABA2-WALTER-DEMO.mp4` · 4:52 · 46 MB |

**Sin push. Sin producción. Sin mutar staging. Sin datos de ninguna persona.**

Nada de lo preservado se perdió, y nada de lo que estaba bien se tocó: las nueve
escenas no afectadas se re-codificaron desde su mismo crudo y conservan su duración al
décimo de segundo.
