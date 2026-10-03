# TABA2_RIDER_STAGING_SMOKE_AUTOMATION_READY_FOR_QA_RUN

Construcción cerrada. **Cero pedidos QA creados. Cero mutaciones en staging.**

2026-08-05 · Moto G15 `ZY32LHS6PS` · agente RIDER_SMOKE_AUTOMATION_BUILD, PID 7116

---

## 1. Arquitectura final

Cuatro responsabilidades separadas, sin mezclar:

| | Qué maneja | Dónde vive |
|---|---|---|
| **A. Instrumentación** | Todo lo que pasa dentro de la app | `androidTest/.../qa/` |
| **B. Orquestador** | Locks, siembra, pantalla, ciclo de vida, red, evidencia | `scripts/qa/lib/SmokeRun.ps1` + `run-rider-staging-smoke-25.ps1` |
| **C. Verificador backend** | Baseline, exactly-once, datos humanos | `scripts/qa/lib/SmokeBackend.ps1` |
| **D. Cleanup** | Obligatorio, idempotente, acotado al run-id | `SmokeBackend.ps1`, invocado desde `finally` |

El corte entre A y B no es estético: apagar la pantalla, mandar la app a
background y cortar la red **suspenden o matan el proceso de prueba**. Una
instrumentación monolítica que tuviera que sobrevivir a eso sería frágil por
construcción. Por eso el smoke son diez fases reanudables y esos cuatro pasos
los hace el host, con las fases de ambos lados verificando que la entrega
sobrevivió.

## 2. Archivos creados

**Instrumentación** (5): `QaSmokePhase.kt` (fases + vocabularios cerrados),
`QaSmokeTrace.kt` (traza de 20 campos), `QaSmokeManifest.kt` (canal privado),
`QaScreen.kt` (lectura y accionamiento de UI), `RiderSmokePhaseTest.kt` (driver).

**Host** (3): `SmokeRun.ps1` (manifiesto, fases, lifecycle, red),
`SmokeBackend.ps1` (baseline, siembra, exactly-once, cleanup),
`run-rider-staging-smoke-25.ps1` (orquestador de los 25 pasos).

**Pruebas** (3): `QaSmokeContractTest.kt` (22), `RiderSmokePreflightTest.kt` (5),
`Test-SmokeGuards.ps1` (32).

**Documentación** (1): `delivery-state-machine.md`.

Ningún archivo del worktree target fue tocado.

## 3. Máquina de estados

Documentada en `delivery-state-machine.md` a partir del código real, con estado
previo, acción, estado posterior, CTA exacto, llamada, persistencia local y
remota, tolerancia offline y checkpoint por transición.

Los nombres del contrato son los reales: `claim_delivery_order`,
`mark_delivery_picked_up`, `start_rider_delivery`, `mark_rider_arrived`,
`confirm_delivery_code`, `publish_rider_location_receipt`.

Tres hallazgos que cambiaron el diseño:

1. **No hay cola offline persistente.** `EncryptedLocationQueueStore.kt` es un
   stub de una línea. `OfflineLocationQueue` es un `ArrayDeque` en memoria de
   proceso, 32 items, TTL 3 minutos. Así que "la cola sobrevive a un
   force-stop" **es falso** y el smoke no lo afirma. Mide lo que el producto sí
   garantiza: durante un corte breve la acción se acepta local y al reconectar
   se aplica una sola vez.
2. **Ninguna acción de entrega funciona sin red.** La única con tolerancia
   offline es la publicación de ubicación durante entrega activa. Se identificó
   inspeccionando la implementación, no eligiendo la más cómoda.
3. **Recentrar y encuadre son el mismo control.** El handler de
   `Recentrar mapa` llama `fitCamera(CameraFit.coordinates(...))`. Los pasos 11
   y 12 comparten afordancia; el smoke acciona una vez y no inventa dos.

## 4. División instrumentación / orquestador

Pasos 1-14, 19, 21, 23-25 → fases instrumentadas.
Pasos 15-18, 20, 22 → host (pantalla, background, corte y restauración de red).

## 5. Checkpoints

Diez fases, cada una con estado inicial y final exigidos. Cada fase valida el
inicial contra el manifiesto y **falla cerrada** si no coincide, de modo que
reanudar una fase mutante ya aplicada es imposible por construcción, no por
convención. Las cuatro mutantes son exactamente las que cambian de estado, y
una prueba lo verifica campo por campo.

Traza de 20 campos con vocabulario cerrado, escrita en `finally` pase o falle:
`runId, phase, startedAt, finishedAt, initialState, expectedInitialState,
initialStateMatch, action, interactionMethod, localMutationObserved,
remoteMutationExpected, finalState, expectedFinalState, finalStateMatch,
privacyCheck, offlineQueueCount, sessionPresent, authenticatedStateVisible,
durationMs, classification`.

## 6. Estrategia offline

Corte con `svc wifi disable` + `svc data disable` por separado, **nunca modo
avión**: en varios Motorola el modo avión también tumba el transporte USB de
adb y la corrida perdería el control del teléfono a mitad de camino. Estado
inicial leído antes del corte y restaurado literal en `finally`. El offline se
prueba preguntándole al servicio de conectividad, no confiando en el toggle.

## 7. Exactly-once

Tres anclas reales, ninguna inventada: `operationId` (tabla
`rider_delivery_operations`) para start y confirm; `revision` (conflicto
`40001`) como concurrencia optimista, que es cómo un segundo submit se vuelve
no-op seguro; y `sequence` del recibo de publicación para las ubicaciones.

El verificador compara baseline contra final sobre la fila del pedido, las
ubicaciones y el stock QA. Falla ante doble evento terminal, doble decremento,
pedido duplicado por run-id o pedido no terminalizado. Los cuatro casos están
probados con dobles.

## 8. Código de entrega

Exactamente 4 dígitos (`^\d{4}$`), campo `obscureText` — el mismo tipo de nodo
donde `ACTION_SET_TEXT` ya está probado por el gate de ingreso. `QaScreen.setText`
**sólo** usa `ACTION_SET_TEXT` y devuelve `false` si el nodo no la soporta: no
hay caída a `input text` ni al portapapeles. El segundo submit se verifica por
ausencia del CTA de confirmación.

## 9. Guard de siembra

`New-TabaQaOrder` exige el literal `-I_AUTHORIZE_QA_ORDER_SEED` y lanza
`QA_ORDER_SEED_BLOCKED` antes de cualquier llamada. Probado con un doble que
registra cada request: **cero llamadas** cuando el guard actúa.

El orquestador corta después del baseline si falta el literal. El fixture se
prueba aislado antes de sembrar: exactamente un producto para el sku QA, con
`catalog_origin=staging_only` y stock restaurable; cualquier otra cosa aborta.

## 10. Cleanup

Idempotente, en `finally`, acotado al `client_request_id` del run. Un run-id que
resuelva a un código protegido aborta **antes del primer delete** —LT-0030 es la
trampa más fácil de pisar: es el único pedido activo de staging y es de un rider
humano. Restaura el stock QA exactamente al baseline y una segunda pasada
reporta lo mismo sin fallar.

## 11. Pruebas

**127 en total, todas verdes**, ninguna toca staging.

| Suite | Cantidad | Dónde |
|---|---|---|
| `QaSmokeContractTest` | 22 | instrumentada, Moto |
| `RiderSmokePreflightTest` | 5 | instrumentada, Moto |
| `Test-SmokeGuards` | 32 | host |
| `Test-CleanupPathGuard` | 25 | host |
| JVM (`testStagingDebugUnitTest`) | 68 (14 suites) | host |

Las 24 áreas exigidas quedan cubiertas. Las de privacidad de enmascarado ya
estaban cubiertas por `delivery_privacy_test.dart` (4 tests) y la cola offline
por `OfflineLocationQueueTest.kt` (4 tests). Los asserts de privacidad
pre/post-claim contra pantalla real y la escritura del código sólo se ejercitan
dentro del driver de fases, que necesita un pedido sembrado: **quedan sin
ejecutar hasta la corrida real**, y eso está declarado, no disimulado.

Dos defectos aparecieron mientras las escribía:

- el host aceptaba un run-id en mayúsculas porque `-match` es case-insensitive
  en PowerShell mientras el lado Kotlin no lo es; habría aparecido a mitad de
  corrida como un manifiesto rechazado sin causa visible;
- el chequeo de fugas del preflight dio alarma falsa porque el código centinela
  `0000` era subcadena del run-id centinela `00000000-…`.

## 12. Commits

Cuatro, pequeños y coherentes, sin `git add .`, sin amend, **sin push**:

| | |
|---|---|
| `ef7208f` | instrumentación y máquina de fases (5 archivos, +1017) |
| `42ee2f1` | verificadores backend y cleanup (1 archivo, +279) |
| `f978a94` | orquestador host de los 25 pasos (2 archivos, +617) |
| `1ad7fee` | pruebas del andamiaje (3 archivos, +815) |

## 13. HEAD

| | Inicial | Final |
|---|---|---|
| automatización | `9c80f98` | `1ad7feee5eb1427bd325334ce25efd6d10a0e29a` |
| app target | `95294d9` | `95294d9d36a6429a21a562ea6a48b8c9ecbf8523` (sin cambios) |

## 14. Hash androidTest

| | |
|---|---|
| anterior | `dba68a9af31ff957d94ed5b0b72ba9161f215ad75e0d9b055a02732f03468d79` |
| nuevo | `6c28a572eb0760a62682225695657fec9697d151de2990b392a9bb54cd5772ca` |
| instalado en el Moto | idéntico al nuevo, extraído y comparado |

470.503 bytes. Sólo se recompiló androidTest.

## 15. Target intacto

`d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299` — local e
instalado, verificado por extracción después de todo el trabajo. No se
recompiló ni se reinstaló.

## 16. Preflight físico

`RiderSmokePreflightTest`: **OK (5 tests)**, 50,8 s. Sesión vigente y cola
accesible; cero entregas en vuelo; árbol de Flutter legible con controles
resueltos hasta su nodo accionable; manifiesto y checkpoint funcionando contra
la cache real; cero residuos. Aborta antes de cualquier claim por construcción:
no contiene ninguna acción mutante.

## 17. Secret scan

- **Repositorio**: las únicas coincidencias en el diff de los cuatro commits son
  las *listas de claves prohibidas* de mi propio validador (`service_role`,
  `apikey`, `token`, `publishable`, `password`, `email`) — el código que las
  rechaza. El único hex largo es el hash público del APK.
- **argv**: ningún secreto viaja como argumento; el manifiesto entra por stdin
  de `adb exec-in`. En `-e` sólo viajan `qaRunId` y `qaPhase`.
- **logcat**: sin coincidencias en 400 líneas.
- **Artefactos**: sin coincidencias.
- **Temporales del host**: DPAPI con 0 archivos; scratchpad limpiado.
- **Cache de la app**: `qa-smoke` 0 entradas, `qa-trace` 0 entradas.

## 18. Git

Ambos worktrees limpios. `git diff --check` sin errores. Sin push, sin reset,
sin clean, sin stash, sin amend.

## 19. Locks

| Lock | Adquirido | Liberado |
|---|---|---|
| `heavy-compute.lock` | 16:41:34Z para compilar y tests JVM; retomado brevemente para la recompilación | sí, apenas terminó cada build |
| `moto-g15.lock` | 16:46:50Z para instalar y preflight | sí, tras verificar PID 7116 |

Ruta canónica `D:\1212_claude-locks` sigue sin poder crearse (ACL de la raíz de
`D:\`, sesión sin elevar); se usa el fallback ya autorizado.

**Dos observaciones sobre locks ajenos, no tocados:**

- Al empezar, `heavy-compute.lock` era un **archivo** de `PANEL_RECERTIFICATION`
  (PID 8448) con el proceso ya muerto. Se liberó solo antes de que hiciera
  falta.
- Al terminar, `heavy-compute.lock` es un **directorio** de
  `RC1_BUSINESS_INTEGRATION` (PID 23856), **también con el proceso muerto**.
  Va a bloquear al próximo agente que quiera compilar.

Dos huérfanos en una sesión sugiere que a los agentes les falta liberar el lock
en `finally` ante terminación abrupta.

## 20. Artefactos

`D:\1212\artifacts\taba2-rider-smoke-automation-build\`

- `delivery-state-machine.md` — la máquina de estados real
- `reporte.md` — este archivo
- `contract-test.log`, `preflight-test.log` — instrumentadas
- `gradle-androidtest.log`, `gradle-jvm-tests.log` — builds

## 21. Declaración

**TABA2_RIDER_STAGING_SMOKE_AUTOMATION_READY_FOR_QA_RUN**

- el automatizador de 25 pasos existe;
- las diez fases están implementadas;
- la instrumentación compila;
- androidTest instalado y verificado byte a byte;
- preflight no mutante pasa;
- la siembra está protegida por autorización explícita;
- el cleanup está implementado y es idempotente;
- las pruebas locales pasan (127);
- el secret scan pasa;
- el target quedó intacto;
- cero pedidos QA creados;
- cero mutaciones en staging (31 pedidos antes y después, stock QA en 19,
  LT-0030 en `arrived` sin tocar);
- Git limpio.

**No se declara** `TABA2_RIDER_STAGING_AUTOMATED_SMOKE_CERTIFIED`: los 25 pasos
no se ejecutaron.

Detenido acá. El pedido QA se siembra recién con una autorización nueva y
explícita.
