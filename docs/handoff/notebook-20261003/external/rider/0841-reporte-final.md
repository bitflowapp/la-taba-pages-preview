# TABA2_RIDER_STAGING_SMOKE_AUTOMATION_READY_FOR_QA_RUN

Cierre de trazabilidad. 2026-08-05 · agente PID 7116.

**Cero pedidos QA. Cero mutaciones en staging. Cero contraseñas generadas o
rotadas. No se ejecutó el smoke de 25 pasos.**

---

## Bloqueo 1 — conteo de pruebas: resuelto

**`A. REPORTING_ARITHMETIC_ERROR`**

Las cinco categorías son independientes y el total correcto es **152
descubiertos / 150 ejecutados**. El `TOTAL=127` anterior salía de sumar cuatro
de las cinco: `22 + 5 + 32 + 68 = 127`. Los **25 casos de
`Test-CleanupPathGuard` figuraban en la tabla pero quedaron fuera de la suma**.

No es una suite faltante ni un conteo solapado, y eso está demostrado:
androidTest y JVM viven en source sets distintos y **comparten 0 nombres de
clase**; las dos suites host **comparten 0 nombres de caso**.

Además apareció una distinción que el reporte anterior no hacía: la suite JVM
**descubre 68 pero ejecuta 66**. `SupabaseAuthStagingTest` y
`RiderOrdersStagingTest` se saltean solos cuando no hay credenciales de staging
inyectadas — comportamiento correcto, pero descubiertos ≠ ejecutados.

Detalle por suite, con comando, archivos, descubiertos, ejecutados, passed,
failed, skipped, superposición y exit code: `test-accounting.md`.

Se corrigió el informe. **No se tocó código ni se creó commit**: era un error de
redacción, no de la automatización.

## Bloqueo 2 — heavy-compute lock: NO saneado, con motivo

**`HEAVY_COMPUTE_LOCK_STILL_ACTIVE`**

```
STALE_HEAVY_COMPUTE_LOCK_REMOVED=false
STALE_OWNER_PID=23856
OWNER_PROCESS_ALIVE=false
```

El PID 23856 está muerto y no tiene hijos. Pero la regla exige las tres cosas
—PID muerto, sin hijos y **sin trabajo asociado**— y la tercera no se cumple:

| PID | Proceso | Creado | Qué es |
|---|---|---|---|
| 25012 | `node.exe` | 17:06:34Z | **Suite Playwright en ejecución** sobre el worktree del propietario, `--workers=1` |
| 23452 | `bash.exe` | 17:06:29Z | hijo de `claude.exe` 20132 |
| 16768 | `bash.exe` | 17:06:29Z | hijo del anterior |
| 25592 | `powershell.exe` | 17:08:03Z | referencia el mismo worktree |

El proceso que adquirió el lock murió, pero **el trabajo que el lock protege lo
continúa otro agente vivo**, y arrancó cinco minutos después de crearse el
lock. Borrarlo habilitaría un build pesado en paralelo con esa suite, que es
exactamente lo que el lock existe para impedir.

El lock quedó intacto (`LastWriteTime` sin cambios). Tampoco se tocaron
`moto-g15.lock` ajeno, `storefront-pending.txt` ni
`rc1-business-certification-pending.txt`. No se creó ningún lock nuevo salvo el
propio, ya liberado.

Evidencia completa: `stale-lock-evidence.txt`.

Cuando esa suite termine, el lock quedará realmente huérfano —mismo PID muerto
y ya sin trabajo— y recién ahí corresponde sanearlo repitiendo esta
verificación.

---

## Las tres categorías, separadas

### A. Pruebas de construcción (host, sin dispositivo, sin staging)

| Suite | Casos | Resultado | Exit |
|---|---|---|---|
| `Test-SmokeGuards.ps1` | 32 | 32 passed | 0 |
| `Test-CleanupPathGuard.ps1` | 25 | 25 passed | 0 |
| JVM `testStagingDebugUnitTest` (14 suites) | 68 descubiertos / 66 ejecutados | 66 passed, 2 skipped | 0 |

**125 descubiertos / 123 ejecutados.** Los guards mutantes se prueban con un
doble del HTTP que registra cada request, así un guard que fallara abierto se
detecta por la **ausencia de un delete**, no por inspección.

### B. Pruebas instrumentadas no mutantes (Moto G15, sin staging)

| Suite | Casos | Resultado | Exit |
|---|---|---|---|
| `QaSmokeContractTest` | 22 | 22 passed | 0 |
| `RiderSmokePreflightTest` | 5 | 5 passed | 0 |

**27 descubiertos / 27 ejecutados**, contra el APK androidTest
`6c28a572…` que está instalado. Ninguna acciona una transición: el preflight no
contiene ninguna acción mutante y aborta antes de cualquier claim por
construcción.

### C. Comprobaciones de una corrida real — TODAVÍA NO EJECUTADAS

Implementadas y compiladas, sin correr nunca:

- `RiderSmokePhaseTest.runSmokePhase` — el driver de las 10 fases. Necesita un
  pedido QA sembrado.
- Los 25 pasos completos.
- Privacidad pre-claim y post-claim **contra pantalla real** (la lógica de
  enmascarado sí está cubierta por `delivery_privacy_test.dart`, que no se
  ejecutó en esta fase y no se suma al total).
- Escritura del código de entrega por `ACTION_SET_TEXT` en el campo real.
- `GPS_LIVE_STATIONARY`.
- Ciclo pantalla / background / foreground.
- Corte y restauración de red con acción offline.
- Exactly-once end-to-end contra la base.
- Entrega terminal única y segundo submit convertido en no-op.
- Siembra y cleanup ejecutándose de verdad.

---

## Verificación final

| Comprobación | Resultado |
|---|---|
| HEAD app | `95294d9d36a6429a21a562ea6a48b8c9ecbf8523` en `codex/rider-map-staging` |
| HEAD automatización | `1ad7feee5eb1427bd325334ce25efd6d10a0e29a` en `test/taba2-rider-staging-smoke-automation` |
| Git limpio | sí, ambos worktrees |
| Hash target (local) | `d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299` |
| Hash androidTest (local) | `6c28a572eb0760a62682225695657fec9697d151de2990b392a9bb54cd5772ca` |
| Pedidos totales | **31**, sin cambios |
| Pedidos QA (`QA-SMOKE-*`) | **0** |
| Pedidos activos | **1** — `LT-0030` en `arrived`, intacto |
| Stock QA | **19**, igual al baseline; `available=True`, `is_active=True` |
| Membership Rider QA | `rider`, activa, 0 otros negocios |
| Ubicaciones del Rider QA | 0 |
| Credenciales temporales | DPAPI 0 archivos, scratchpad 0 archivos |
| Mutaciones backend | ninguna |

**Un hueco declarado:** los hashes instalados en el dispositivo no se pudieron
reverificar en este cierre. El Moto pasó a `offline` y luego a `unauthorized`
durante el intento de recontar las instrumentadas: el transport se reinició
(`transport_id` 1 → 4 → 6 → 2) y quedó pidiendo autorización de depuración USB
en pantalla. `adb reconnect` y el reinicio del servidor no lo recuperan; hace
falta aceptar el diálogo en el teléfono.

La verificación byte a byte de ambos APK instalados **sí se hizo hoy a las
13:59**, contra exactamente estos binarios, y quedó registrada. Lo que no se
pudo es repetirla ahora.

---

## Declaración

**TABA2_RIDER_STAGING_SMOKE_AUTOMATION_READY_FOR_QA_RUN** — se conserva.

- el conteo quedó demostrado (152 / 150, causa identificada);
- las cinco suites están completas y ninguna faltaba;
- el lock huérfano quedó correctamente identificado y **no** saneado, con
  motivo verificable;
- el target quedó intacto;
- cero pedidos QA, cero mutaciones en staging;
- Git limpio.

**No se declara** `TABA2_RIDER_STAGING_AUTOMATED_SMOKE_CERTIFIED`.
**No se incluye** `I_AUTHORIZE_QA_ORDER_SEED`.

Antes de la corrida real hace falta reautorizar el dispositivo: desbloquear el
Moto y aceptar el diálogo de depuración USB.
