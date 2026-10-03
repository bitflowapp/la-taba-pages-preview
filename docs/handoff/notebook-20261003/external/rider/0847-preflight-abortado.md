# Preflight abortado — smoke Rider en staging

RUN_ID: `20260805T1435Z-preflight-abort`
Fecha UTC: 2026-08-05
Agente: RIDER_FULL_STAGING_SMOKE

## Resultado

**BLOCKED_BY_CONCURRENT_AGENT — no se inició la corrida y no se mutó staging.**

No se sembró ningún pedido QA, no se adquirió `moto-g15.lock`, no se tocó el dispositivo, no se modificó
ningún worktree y no se ejecutó el orquestador.

## Motivo

El estado canónico declarado en la orden no coincide con el estado real, y la diferencia se produjo
**durante este mismo preflight**.

| Elemento | Declarado | Real |
| --- | --- | --- |
| Automatización HEAD | `1ad7fee` | **`7b189ae`** |
| Automatización Git | limpio | 1 archivo modificado en la primera lectura, limpio en la segunda |

Cronología medida:

```
14:01:17   1ad7fee  test(qa): prove the smoke scaffolding without touching staging   ← HEAD declarado
14:34:31   7b189ae  fix(qa): resolve the QA customer to a single id before seeding   ← HEAD real
14:35:02   hora del sistema al detectarlo
```

El commit `7b189ae` se creó **31 segundos antes** de que lo detectara, entre mi primera y mi segunda
consulta al worktree. En la primera lectura ese worktree tenía un archivo sin commitear; en la segunda ya
estaba commiteado y limpio. Hay otro agente operando ese worktree en este momento.

## Por qué importa para esta corrida en particular

`7b189ae` modifica un único archivo:

```
scripts/qa/run-rider-staging-smoke-25.ps1   | 21 +++++++++++++++++----
```

Es **el orquestador de los 25 pasos** que esta orden manda ejecutar, y el asunto del commit —
*"resolve the QA customer to a single id before seeding"*— indica que se estaba corrigiendo justamente la
resolución del cliente QA **antes de sembrar**, que es el Paso 2 de esta corrida.

Ejecutar ahora significaría una de tres cosas, todas malas:

1. correr `1ad7fee` exacto, es decir la versión que el otro agente acaba de considerar defectuosa para
   sembrar;
2. correr `7b189ae`, que no es el estado que la orden autorizó;
3. correr mientras el archivo vuelve a cambiar a mitad de secuencia.

A esto se suma el riesgo de que ambos agentes siembren pedidos QA en staging a la vez, lo que rompería el
requisito del Paso 1 de **cero pedidos QA activos** y la exigencia de distinguir con certeza QA de datos
humanos. La orden es explícita: *abortar antes de sembrar* si esa certeza no existe.

## Verificaciones que sí se completaron (todas de sólo lectura)

**Dispositivo — OK**

```
adb 1.0.41
ZY32LHS6PS   device   product:lamu_g  model:moto_g15  device:lamu  transport_id:5
```

Estado `device`, no `unauthorized`. No hizo falta pedir desbloqueo ni autorización USB.

**App — OK**

```
D:\1212\worktrees\taba2-rider-map   95294d9   codex/rider-map-staging   limpio
```

Coincide con lo declarado.

**APK — OK, hashes exactos**

```
target       d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299  ✓ coincide
  D:\1212\worktrees\taba2-rider-map\build\app\outputs\apk\staging\debug\app-staging-debug.apk
  mtime 2026-08-05 03:14:01

androidTest  6c28a572eb0760a62682225695657fec9697d151de2990b392a9bb54cd5772ca  ✓ coincide
  D:\1212\la-taba-rider-smoke-automation\build\app\outputs\apk\androidTest\staging\debug\app-staging-debug-androidTest.apk
  mtime 2026-08-05 13:58:40
```

Advertencia menor: existe un segundo `app-staging-debug-androidTest.apk` en el worktree de la app
(`.../taba2-rider-map/build/...`) con hash `bc4679a762f4a087720cd2965312de88962eea7c0d20489ef04d3b8fe8b32916`
y fecha del 4 de agosto. **No es el canónico.** Si se instala el androidTest, debe tomarse el del worktree de
automatización, no el de la app.

**Locks**

`D:\1212_claude-locks` no existe ni es creable (la raíz de `D:\` deniega escritura); la coordinación real
ocurre en `D:\1212\_claude-locks\`. Allí `moto-g15.lock` **no existe**: está libre. **No se adquirió**,
porque esta corrida no llegó a empezar y retenerlo bloquearía al otro agente sin motivo.

## Estado del entorno al abortar

Sin cambios. Staging intacto, sin pedido QA sembrado, sin stock tocado, sin sesión abierta, sin
`adb reverse`/`forward` creados, dispositivo sin instalaciones nuevas, LT-0030 no consultado ni tocado.
