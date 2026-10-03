# TABA2 Rider — gate de login 3 de 3

**Resultado: `TABA2_RIDER_STAGING_LOGIN_3_OF_3_SUCCEEDED` NO declarado.**
Bloqueo duro: el Moto G15 no está conectado. 0 de 3 iteraciones ejecutadas.

Fecha: 2026-08-05 (UTC). Agente: RIDER_LOGIN_3_OF_3, PID 7116.

---

## 1. Proceso pendiente encontrado

Ninguno. El "1 shell still running" del reporte anterior ya no existe.

Verificado por cuatro vías independientes:

- no hay `adb.exe` ni `logcat.exe` en ejecución;
- el puerto 5037 no estaba escuchando al iniciar la sesión, o sea que no había
  servidor adb vivo;
- no hay daemon Gradle ni proceso de instrumentación anterior;
- ningún proceso previo a las 12:08 tiene relación con la corrida Rider.

No se terminó ningún proceso: no había nada que terminar. Tampoco se tocó
ningún proceso ajeno.

Sí hay **otras dos sesiones `claude.exe` corriendo en paralelo** (PID 7600 y
20132), lanzadas desde otras terminales al mismo tiempo que ésta. No son mías y
no se tocaron.

## 2. Locks adquiridos y liberados

La ruta canónica `D:\1212_claude-locks` **no se pudo crear**: la raíz de `D:\`
sólo concede `ReadAndExecute` al usuario `marco` y la sesión no está elevada.
No es un problema de sandbox; falla igual sin él. Los tres agentes chocan con
lo mismo.

Con tu decisión explícita se usó el fallback `D:\1212\_claude-locks`.

| Lock | Adquirido | Liberado |
|---|---|---|
| `moto-g15.lock` | 15:14:57Z, atómico con `New-Item -ItemType Directory` sin `-Force` | sí |
| `heavy-compute.lock` | antes de compilar androidTest | sí, apenas terminó el build |

Ambos con `owner.txt` (`RIDER_LOGIN_3_OF_3`, PID, fecha UTC). No se borró
ningún lock ajeno.

Nota: en `D:\1212\_claude-locks` apareció `storefront-pending.txt`, de otro
agente. Sólo se leyó. Dice `PENDING=CHROMIUM_CONTRACTS_AND_MOTO_VALIDATION` /
`REASON=WAITING_FOR_PANEL_AND_RIDER`: ese agente también está esperando el
mismo teléfono.

## 3. Espacio

| Unidad | Inicial | Final |
|---|---|---|
| C: | 13,38 GB | 13,37 GB |
| D: | 81,37 GB | 81,28 GB |
| E: | 2,70 GB | 2,76 GB |

`E:` aloja `GRADLE_USER_HOME` y `PUB_CACHE` con menos de 3 GB libres. No frenó
esta compilación incremental, pero es un margen fino para un build limpio.

## 4. Ramas, HEAD y Git

| Repo | Rama | HEAD | Estado |
|---|---|---|---|
| `D:\1212\worktrees\taba2-rider-map` | `codex/rider-map-staging` | `95294d9d36a6429a21a562ea6a48b8c9ecbf8523` | limpio, **sin cambios** |
| `D:\1212\la-taba-rider-smoke-automation` | `test/taba2-rider-staging-smoke-automation` | `610ad72` (era `9576c49`) | limpio |

El worktree de la app quedó intacto, en el HEAD obligatorio. Sin push en
ninguno de los dos.

## 5. Hash del APK target

- Local: `d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299` —
  coincide exactamente con el congelado. Verificado antes y después de
  compilar: el target no se recompiló.
- Instalado en el Moto: **no verificable**, no hay dispositivo.

## 6. Hash del APK androidTest

- Antes: `510ba3c66c12602af8e8e9dafbc5cb3c191c2f892d9edfdf30b558096351ce3b` —
  coincide con el conocido del brief. Capturado antes de que el build lo
  rotara.
- Después: `dba68a9af31ff957d94ed5b0b72ba9161f215ad75e0d9b055a02732f03468d79`

`BUILD SUCCESSFUL in 2m 24s`, sólo `:app:assembleStagingDebugAndroidTest`. El
Kotlin nuevo compiló sin errores; los cuatro warnings son preexistentes, en
líneas que no se tocaron.

## 7. Commit de observabilidad

`610ad72` — *test(qa): write the sanitized login trace on success, not only on
failure*. 4 archivos, +503 / −8. Sin `git add .`, sin amend, sin push.

- `QaLoginTrace.kt` (nuevo): junta la corrida y la escribe.
- `QaLoginTraceTest.kt` (nuevo): prueba focal.
- `RiderQaLoginTest.kt`: escribe la traza desde `finally`, en éxito y en fallo.
  El consumo de la credencial pasó adentro del `try`, así que un canal roto
  también deja traza en vez de morir antes de que haya algo que escribir.
- `DeviceSmoke.ps1`: pasa `qaIteration` y trae la traza del dispositivo.

La traza lleva los 21 campos pedidos y nada más, en `cache/qa-trace` —
directorio propio, para que `cache/qa-smoke` pueda quedar vacía. Ningún valor
es texto libre: cada uno es booleano, entero o término de un vocabulario
cerrado, y por eso los motivos de aborto pasan por `classify()` en vez de
copiarse, que es donde se colaría la explicación que va detrás del código.

La prueba focal cubre archivo existente, runId correcto, campos completos y
cero secretos — esto último por forma, no sólo buscando centinelas, así que un
campo futuro con contenido de un campo rompe la prueba.

**La prueba focal no se ejecutó: es instrumentada y necesita el dispositivo.**
Está compilada, no verificada en ejecución.

## 8. Tabla de 3 iteraciones

| Iteración | Contraseña | Estado | Clasificación |
|---|---|---|---|
| 1 | no generada | NO EJECUTADA | — |
| 2 | no generada | NO EJECUTADA | — |
| 3 | no generada | NO EJECUTADA | — |

## 9. PASSWORDS_ALL_DISTINCT

No aplica. No se generó ni se rotó ninguna contraseña. El Rider QA conserva la
credencial que tenía; no se tocó el canal administrativo.

## 10. Aislamiento entre logins

No aplica, sin corridas.

Resuelto offline el punto abierto del Paso 4: **la app tiene cierre de sesión
normal y es automatizable**. En `orders_page.dart` hay un `PopupMenuButton` con
tooltip `Cuenta y sesión` y un ítem `Cerrar sesión` que llama a
`signOut()` → canal `signOut` → `SessionManager.signOut()`. Se resuelve con el
recorrido de árbol de accesibilidad que la instrumentación ya tiene, así que
**no hace falta borrar `rider_session.enc` con `run-as`**.

## 11. Tercera sesión preservada

No aplica, sin corridas.

## 12. Secret scan

Sobre el diff commiteado: sin `service_role`, sin `sb_secret`/`sb_publishable`,
sin `apikey`, sin `Bearer`, sin JWT, sin claves privadas, sin hex de 40+.

Única coincidencia de email: `qa-centinela@ejemplo.invalido`, el centinela
ficticio de la prueba focal, que existe justamente para demostrar que la traza
no lo filtra.

## 13. Cleanup

- Ambos locks propios liberados.
- Servidor adb detenido — el mismo estado que al empezar (no había ninguno).
- 0 procesos adb/logcat colgados.
- Quedan 2 daemons Gradle, que es lo normal; salen solos por timeout. No se
  mataron para no romperle el build a los otros dos agentes.
- DPAPI temporal `C:\1212\taba-device-test-runtime\private`: 0 archivos.
- Nada que limpiar en el dispositivo: no se tocó.

## 14. Pedidos y claims antes/después

**Cero llamadas al backend en toda la sesión.** No se pidió la service key, no
se consultó Supabase, no se rotó ninguna contraseña. Pedidos QA, claims, stock,
LT-0030 y datos humanos quedan exactamente como estaban, sin haber sido
consultados ni modificados.

## 15. Bloqueos

**`BLOCKED_NO_DEVICE`** — el Moto G15 no está conectado.

- `adb devices` vacío, con el servidor recién reiniciado.
- `adb mdns services` vacío: tampoco por Wi-Fi.
- Ningún dispositivo Motorola (VID_22B8) en el árbol PnP de Windows. Los USB
  presentes son un pendrive (VID_18A5), un teclado (VID_1A2C) y un mouse
  (VID_1BCF).

O sea: no es depuración USB apagada ni autorización pendiente. El teléfono no
está enchufado.

Bloqueo secundario ya resuelto por decisión tuya: la ruta canónica de locks
necesita elevación (ver punto 2).

## 16. Ruta de artefactos

`D:\1212\artifacts\taba2-rider-login-3of3\`

- `reporte.md` — este archivo
- `gradle-androidtest.log` — build completo de androidTest

---

## Qué falta para el gate

1. Conectar el Moto G15 con depuración USB y autorizar la clave RSA.
2. Verificar precondiciones en dispositivo: hash instalado, sesión ausente,
   `cache/qa-smoke` vacía, sin entrega activa.
3. Instalar el androidTest recién compilado (`dba68a9a…`).
4. Correr la prueba focal `QaLoginTraceTest` — 5 casos, todavía sin ejecutar.
5. Las tres iteraciones con tres contraseñas distintas.

El paso 4 conviene hacerlo antes de las iteraciones: valida la observabilidad
sin gastar una rotación de credencial.
