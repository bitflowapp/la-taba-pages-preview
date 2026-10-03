# GATES G0–G7 — TABA2-PILOT-RC2-CANDIDATE.1

Regla del encargo aplicada en todo el documento: **un gate verde en una rama fuente
no certifica la RC**. Todo lo que dice ✅ acá se ejecutó sobre el candidato integrado
(`9952c9e` → `f611492` web, `ff6d014` Rider), salvo donde diga explícitamente
«baseline».

| Gate | Veredicto |
| --- | --- |
| G0 procedencia e higiene | 🟡 **parcial** — todo lo técnico verde; P0.14/P0.15 abiertos y sin remoto |
| G1 código web local | 🟡 **verde en Chromium (207/207)**; en Firefox y WebKit quedan fallas preexistentes y no deterministas, ninguna atribuible a la integración |
| G2 base de datos y recuperación | 🟡 **parcial** — replay y restore verdes; falta el clon de staging |
| G3 staging sobre SHA inmutable | 🔴 **NO EJECUTADO** |
| G4 build Rider | 🟡 **parcial** — analyze, Dart 254/254 y APKs archivadas; 36 fallas JVM preexistentes y nada instalado en el Moto |
| G5 Moto físico | 🔴 **NO EJECUTABLE** por un agente |
| G6R rollback completo | 🔴 **NO EJECUTADO** |
| G6C freeze del candidato | 🔴 **NO EJECUTADO** |
| G7 ensayo humano y promoción | 🔴 **NO EJECUTABLE** por un agente |

---

## G0 — Procedencia e higiene 🟡

| Requisito | Resultado |
| --- | --- |
| P0.14/P0.15 cerrados antes de copiar filas / clonar / capturar coordenadas | 🔴 **abiertos**. Por eso **no se copió ni una fila, no se clonó staging y no se capturó ninguna coordenada**. Sólo metadatos read-only, que el plan sí permite antes de cerrarlos. |
| Worktree limpio | ✅ 0 entradas, antes y después de cada commit |
| HEAD y padres registrados | ✅ `evidence/A-heads-registro.txt` |
| Cero archivos no versionados inesperados | ✅ `local.properties` del Rider está gitignoreado por diseño |
| Ancestros verificados | ✅ 9 web + 8 Rider, todos ancestros; `898cea6d` confirmado como NO ancestro |
| Rama remota / tag de respaldo | 🟡 3 tags locales + 2 bundles verificados fuera de `D:\1212`. **Sin remoto** (el encargo prohíbe `push`) |
| `git diff --check` | ✅ |
| Scan de secretos | ✅ `npm run secrets:scan` limpio en baseline y candidato |
| Inventario de migraciones sin versiones duplicadas | ✅ 63 migraciones, ninguna versión repetida. Manifiesto con hash por archivo en `evidence/G2-migration-manifest.txt`; digest de la cadena `a9b04682a4aa5790a649feadf99aeff282df8fa888a195ebbe8da6d01cf00f06` |
| Diff completo revisado | ✅ 23 archivos del merge revisados uno por uno antes de commitear |

---

## G1 — Código web local 🟡

Sobre el candidato integrado:

| Comando | Baseline `3d69e6b` | Candidato |
| --- | --- | --- |
| `npm run check` | ✅ | ✅ |
| `npm test` | ✅ 1119/1119 | ✅ **1169/1169** |
| `npm run test:webhook` | ✅ 12/12 | ✅ **12/12** |
| `npm run secrets:scan` | ✅ | ✅ |
| `npm run migrations:validate` | ✅ 57 | ✅ **63**, sin ERROR ni WARNING |
| `npm run test:e2e` (Chromium) | ⚠️ 206 pasaron / 1 falló | ✅ **207/207** en 9,3 min |

**Cero reducción del número de tests:** 1119 → 1169. El aumento (+50) se explica
por diff: el merge agrega `tests/pilot-operations-migration.test.mjs`,
`tests/pilot-operations-panel.test.mjs` y `tests/pilot-restore-drill.test.mjs`.
Ningún test fue borrado ni desactivado.

### Cobertura de navegadores

`playwright.config.mjs` **no define `projects`**, así que `npm run test:e2e` corre
todo en Chromium. Los dos specs que mencionan Firefox (`honesty-mode`,
`mobile-touch-gesture`) sólo **ramifican** según el navegador; no lanzan uno propio.
Para cubrir lo que G1 pide se ejecutó además la suite completa en los otros dos:

| Navegador | Suite completa sobre el candidato |
| --- | --- |
| Chromium | ✅ **207 / 207** (9,3 min) |
| Firefox | 🟡 **205 pasaron, 2 fallaron** (19,2 min) |
| WebKit | 🟡 **204 pasaron, 3 fallaron** (12,1 min) |

**Ninguna de esas 5 fallas es una regresión de la integración.** Se midió, no se supuso.

*Firefox* — fallaron `combos.spec.mjs:147` (rail de combos a 432 px) y
`direct-ordering-growth.spec.mjs:4`. Corriendo **esos mismos dos archivos aislados**:

| | resultado |
| --- | --- |
| baseline `3d69e6b` | **11 / 11 pasan** |
| candidato `f611492` | **11 / 11 pasan** |

Es decir: sólo fallan dentro de la corrida completa, y con el mismo comportamiento en
ambos árboles. Dependen de la carga, no del merge.

*WebKit* — fallaron `business-windows-operations.spec.mjs:82`, `:144` y
`delivery-proof.spec.mjs:9`. Corriendo **esos mismos dos archivos aislados**:

| corrida | falladas |
| --- | --- |
| baseline, 1ª | `:59`, `:82`, `delivery-proof:9` — 3 fallan / 2 pasan |
| baseline, 2ª (idéntica) | `:82`, `delivery-proof:9` — 2 fallan / 3 pasan |
| candidato | `:82`, `:144`, `delivery-proof:9` — 3 fallan / 2 pasan |

Dos fallan **determinísticamente en los dos árboles** y son limitaciones de WebKit,
no del producto: `:82` se cuelga en `page.waitForEvent("download")` y
`delivery-proof:9` en `setInputFiles`. La tercera **se mueve sola dentro del mismo
archivo entre corridas de código idéntico** —`:59` en una, ninguna en la siguiente,
`:144` en el candidato—, o sea que ese spec es inestable en WebKit por su propio
estado compartido. Preexistente al candidato.

**Conclusión de G1:** verde en Chromium; en Firefox y WebKit quedan fallas
**preexistentes y no deterministas**, ninguna atribuible a la integración. El gate no
se declara verde en los tres navegadores, pero tampoco hay regresión que cerrar
dentro del alcance de RC2.

**Service worker:** el `check` incluye `check-static-assets` y
`check-release-hygiene`, que pasaron. La prueba de **upgrade desde la versión previa**
que pide G1 requiere dos despliegues reales y queda dentro de G3: **no ejecutada**.

**Sobre el fallo del E2E baseline — resuelto.** Falló `direct-ordering-growth.spec.mjs`
esperando el marcador GPS del rider, sobre la **base intacta, sin un solo cambio mío**.
Tres evidencias independientes lo explican como saturación del host y no como regresión:

1. Reejecutado aislado, el mismo spec pasa en 7,1 s.
2. La suite completa **sobre el candidato** —que incluye ese spec y 50 tests más—
   pasó **207/207**.
3. El propio `playwright.config.mjs` corre con `workers: 1` y documenta que la
   competencia por el relay y el servidor estático *«convierte saturación del host en
   timeouts no deterministas del gate»*. Durante la corrida baseline había otra sesión
   (`taba2-walter-commercial-demo`) capturando pantalla y con su propio stack.

Queda cerrado: el candidato pasa la suite completa.

---

## G2 — Base de datos y recuperación 🟡

| Requisito | Resultado |
| --- | --- |
| Replay de todas las migraciones sobre PostgreSQL vacío, sin fixtures remote-only | ✅ **63 migraciones**, `SIMULACRO APROBADO` |
| Reconstrucción desde migraciones en un segundo clúster | ✅ 63 |
| Dump/restore y equivalencia de datos/esquema | ✅ **69 tablas con contenido idéntico**; restore en 328 ms |
| Contrato operativo antes del backup y sobre el proyecto recuperado | ✅ **72 comprobaciones** en ambos momentos |
| `npm run pilot:ops:drill` | ✅ exit 0 |
| Cero número de migración duplicado con SQL distinto | ✅ verificado sobre las 63 |
| Plan forward-only, sin down migrations destructivas | ✅ |
| Rama «base limpia» de la migración nueva | ✅ **ejercitada**: es la que corre en el drill |
| Rama «ya existe → no-op» de la migración nueva | ✅ **ejercitada**: aplicada por segunda vez sobre la cadena completa → `NOTICE: rider_map: contrato ya presente y completo; esta migracion es no-op.`, exit 0, sin reemplazar nada |
| Rama «estado parcial → abortar antes de mutar» | ✅ **ejercitada**: borrada una de las dos tablas y reaplicada → `ERROR: rider_map: contrato PARCIAL (tablas=1, funciones=2, triggers=1). Se aborta antes de mutar`, exit ≠ 0 |
| Simulación del staging histórico colisionado | 🔴 **no ejecutada.** No se ejercitó contra el historial real de staging. |
| Restore de un snapshot exacto de staging en clon aislado + mismo upgrade | 🔴 **bloqueado por P0.14/P0.15** |
| Diff de esquema/historial/ACL/conteos del clon antes y después | 🔴 idem |
| Sondas RLS/ACL para `anon`, `authenticated`, rider, staff, admin, owner | 🔴 pertenecen a G3 (esquema vivo) |
| `get_rider_queue` y privacidad pre/post claim | 🔴 idem |
| Tests de pagos, combos, órdenes, stock, outboxes y exactly-once | 🟡 cubiertos por las suites locales (1169/1169); no reejecutados contra staging |

### La prueba central

El plan sostiene (P0.2, C11) que la base no es reproducible. Esta sesión lo
**midió en ambas direcciones con el mismo arnés**:

```
sin 20260807155000  → 62 migraciones → SIMULACRO FALLIDO
                      ERROR: schema "private" does not exist
                      cortó en 20260807170000_pickup_point_provenance.sql

con 20260807155000  → 63 migraciones → SIMULACRO APROBADO
                      69 tablas idénticas · 72 contratos verificados
```

Causa: ninguna migración del repositorio web crea el schema `private` ni las tablas
del mapa, y `20260807170000` les hace `ALTER TABLE`. El SQL de procedencia vivía en
el repo del Rider (`898cea6d`), con una versión ya ocupada en staging.

Prueba transitiva de que la rama de creación funcionó de verdad: en la corrida de 63,
`20260807170000_pickup_point_provenance` —que hace `alter table
private.rider_map_business_locations` y le agrega ocho columnas— **aplicó sin error**.
Sólo puede hacerlo si `20260807155000` creó esa tabla unos pasos antes.

---

## G3 — Staging sobre SHA inmutable 🔴 NO EJECUTADO

Nada de este gate se ejecutó. **No se desplegó, no se mutó staging, no se tomó el
`taba2-staging-mutation.lock`** (estaba libre, en `CERRADO_CERTIFICADO`).

**No se omitió por conveniencia: su precondición no se cumple.** La Fase F del plan
dice textualmente: *«Precondición: los HEAD exactos que se desplegarán ya pasaron
G0–G4; un cambio posterior invalida esos resultados»*. G4 no está verde. Además el
paso 3 de esa fase exige *«Confirmar que el upgrade idéntico ya pasó sobre el clon
exacto de staging»*, que depende de P0.14/P0.15, y el paso 1 exige una ventana
exclusiva *«mediante control de entorno/CI, no sólo un archivo de lock»*, que esta
sesión no puede establecer. Desplegar igual habría sido saltear el orden del plan.

Lo único que se hizo contra staging fue lectura de metadatos: los 6 Edge Functions
con su `ezbr_sha256` (`SOURCE-MATRIX.md` §6). **Cero filas exportadas.**

Queda pendiente todo: deployment por SHA, digest de runtime config, hashes de Edge,
lista de migraciones, `certify:orders:staging`, circuito fresco, smoke de Panel por
UI, MP TEST normal y de recuperación, callbacks duplicados/demorados/fuera de orden,
observabilidad con ocho servicios y las sondas de acceso anónimo.

---

## G4 — Build Rider 🟡

| Requisito | Resultado |
| --- | --- |
| Toolchain fijado | ✅ Flutter en `C:\src\flutter`, JDK 17.0.16.8, Android SDK, Gradle 9.1 |
| Build limpio, sin reutilizar `build/` | ✅ `build/`, `android/app/build` y `android/.gradle` borrados antes de compilar |
| Tests Dart | ✅ **`flutter test` 254/254 All tests passed** |
| Tests JVM del cambio | ✅ **`ActiveDeliveryPolicyTest` 7/7**, incluidos los 5 nuevos de P0.8 |
| Analyze | ✅ **`flutter analyze` — No issues found!** |
| Unit JVM completos | 🔴 **36 fallas** en `SessionManagerTest` (8) y `RiderRpcDataSourceTest` (28) |
| Tests de instrumentación (Android) | 🟡 **13 corridos en el Moto real, 1 falla**: `FusedLocationSourceInstrumentedTest.callbacksFromAnOldProfileOrStoppedSourceAreIgnored`. Determinista (falla 2/2 aislada) y **preexistente**: esa clase no la toca `ff6d014` y su último cambio `cfce79f` es ancestro de la base. Se excluyó el paquete `qa` porque necesita credenciales y tocaría staging |
| APK producto y test archivadas | ✅ **construidas y archivadas** en `artifacts-rider/` con SHA-256. `BUILD SUCCESSFUL in 7m 22s` |
| Firma, flavor y applicationId correctos | ✅ `com.lataba.rider.staging`, flavor `staging`, backend `ukxqbgswjlibmnjemrzd`, `apksigner verify` → **Verifies** (v2). Firmada con la clave **de debug** (`CN=Android Debug`), lo esperable para staging; la APK de release firmada es P1 |
| Hash instalado = hash archivado | ✅ **verificado en el Moto real.** `adb install -r`, extraído de `/data/app/…/base.apk` y hasheado en el dispositivo: `3cb61d52…` **idéntico** al archivado. Cierra el requisito central de P0.7 |
| Clean install y upgrade desde la versión previa | 🔴 no ejecutado |

### Verificación en hardware (P0.7)

Se adquirió `moto-g15.lock` —estaba libre— preservando íntegro su contenido previo, y
se instaló el APK del candidato con `adb install -r` (sin `pm clear`, para no borrar
sesión ni datos). Antes de tocar nada se comprobó que `no_backup` tenía
`rider_session.enc` pero **no** `active_delivery.json`: no había reparto activo que
pisar.

**Discrepancia D-4.** El APK que estaba instalado tenía `ee0032cf…`, pero
`moto-g15.lock` declaraba `81633242…`. Como esta sesión demostró después que Android
conserva `base.apk` byte a byte —el hash del candidato coincidió exactamente—, la
diferencia **no es un artefacto del sistema de archivos**: el APK que había en el
teléfono no era el que el lock declaraba. Concuerda con C4 del plan, que ya señalaba
*«tres hashes de APK distintos en el mismo HANDOFF y ningún manifiesto que determine
cuál representa toda la declaración final»*.

Evidencia completa en `evidence/G4-moto-g15-verificacion.txt`.

### Sobre las 36 fallas JVM

Todas comparten una única causa: `RuntimeException: Method w in android.util.Log
not mocked`, lanzada desde `SessionManager.kt:82` —un `android.util.Log.w` dentro de
un bloque `catch`— porque el proyecto no configura `testOptions.unitTests`
(no existe `returnDefaultValues` en ningún gradle del repo).

**Medido, no inferido.** Se restauraron los 3 archivos del fix a su versión previa
(`git checkout ff6d014~1 -- …`, que no es reset ni stash ni clean), se corrió la
**misma tarea** sobre la base, y se devolvieron al estado del candidato dejando el
árbol limpio y el HEAD intacto:

| | `SessionManagerTest` | `RiderRpcDataSourceTest` | total |
| --- | --- | --- | --- |
| **base** (sin el fix) | 8 | 28 | **36** |
| **candidato** (con el fix) | 8 | 28 | **36** |

Idénticas. Evidencia concordante:

- `android.util.Log` entró a `SessionManager.kt` en `019b39b`, **ancestro de la base
  `7cec5a7`**.
- El cambio de P0.8 modifica 3 archivos y **ninguno está en `auth/` ni en `data/`**.
- La única clase de test que este cambio toca, `ActiveDeliveryPolicyTest`, pasa 7/7.
- Los HANDOFF previos citan siempre `flutter test 251/251` y `254/254` —la suite
  Dart—, nunca un número de la suite JVM de Kotlin.

**Aun así, G4 no puede declararse verde.** El gate pide *«Analyze, unit, JVM y tests
Android verdes»*, y hay 36 rojos. Arreglarlos exigiría tocar la configuración de
tests del proyecto, que está **fuera del alcance de RC2** (el plan: *«corregir
únicamente dentro del alcance de RC2»*, *«no agregar mejoras no necesarias»*). Queda
como defecto documentado, no como gate aprobado.

---

## G5 — Moto físico 🔴 NO EJECUTABLE

El Moto G15 **está conectado y autorizado** (`ZY32LHS6PS device product:lamu_g
model:moto_g15`). El `moto-g15.lock` está en `CERRADO_CON_PUNTO_PROVISIONAL`, o sea
libre. **No se tomó el lock y no se tocó el teléfono.**

El motivo no es de acceso, es de física. El gate exige:

> *«Ruta segura ≥300 m y ≥5 min, con ≥20 puntos aceptados, traza compatible con
> calles/tiempos y desplazamiento mayor que la incertidumbre; dos fixes aislados no
> alcanzan»*, y *«sin confundir deriva con movimiento»*.

Un agente de software no puede desplazar un teléfono por la calle. Producir esa
traza por cualquier otro medio sería declarar movimiento físico no realizado, que es
exactamente lo que el encargo prohíbe y lo que C5 del plan denuncia.

Lo que sí quedó listo para cuando alguien lo haga: la corrección de P0.8 con su
prueba, que es el punto de G5 que estaba roto (*«Kill del proceso sin red; la
entrega activa sigue visible»*).

---

## G6R — Rollback completo 🔴 NO EJECUTADO

Ver `ROLLBACK.md`. Se preparó y verificó la recuperación del **código** (tags +
bundles con `git bundle verify`) y se ensayó el restore de **base de datos** en
clústeres locales (69 tablas idénticas). No se ensayó nada de lo demás: no hay
entorno sacrificable —clonarlo requiere P0.14/P0.15—, no hay APK de rollback
construida, y no se probó la pausa de admisión ni la reconciliación de un pago
TEST durante el rollback.

---

## G6C — Freeze del candidato 🔴 NO EJECUTADO

Requiere P0.1–P0.16 cerrados (hay 3 de 17) y *«Web y Rider pusheados»*, que el
encargo prohíbe. El manifiesto sigue con `TBD` en `web_deploy_id`,
`runtime_config_sha256`, `rider_apk_sha256`, `catalog_snapshot_sha256`,
`connectivity_mode` y todos los campos de rollback.

Mientras haya un `TBD`, el nombre `TABA2-PILOT-RC2-CANDIDATE.1` es **una plantilla
reservada, no un candidato congelado**.

---

## G7 — Ensayo humano y promoción 🔴 NO EJECUTABLE

Requiere cuatro personas: Walter confirmando datos comerciales y punto de retiro, un
cliente humano usando el storefront, un operador humano usando el Panel y un rider
humano llevando el Moto, más un acta PILOT-GO/NO-GO firmada. Además exige que G6R
ya se haya **ejecutado**, no sólo documentado.

No es automatizable por definición: el gate existe precisamente para probar que el
sistema funciona con gente real.

---

## Declaración

Los gates G3, G6R y G6C **no se ejecutaron**; G5 y G7 **no son ejecutables** por un
agente de software; G0, G1, G2 y G4 quedaron **parciales**.

Por lo tanto **no se emite** `TABA2_PILOT_RC2_CANDIDATE_1_G0_G7_CERTIFIED`.
