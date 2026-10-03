# TABA2 Rider — smoke físico de 25 pasos

**No certificado. Bloqueo antes de mutar: `SMOKE_AUTOMATION_ABSENT`.**

RUN_ID `95243dd4-621e-4b50-93ff-8bc3becfd99c` · 2026-08-05 · Moto G15 `ZY32LHS6PS`
Agente RIDER_FULL_STAGING_SMOKE, PID 7116.

**No se creó ningún pedido QA.** Cero mutaciones en staging: toda la Fase 1 fue
de sólo lectura.

---

## El bloqueo

La autorización pedía ejecutar "el smoke físico automatizado completo". Esa
automatización **no existe**. Lo verifiqué de tres maneras antes de tocar nada:

1. Cero coincidencias de `claim_delivery_order`, `mark_delivery_picked_up`,
   `start_rider_delivery`, `mark_rider_arrived` y `confirm_delivery_code` en
   todo `android/app/src/androidTest`. Ningún test instrumentado toca la
   entrega.
2. Los cinco `integration_test/*.dart` son placeholders de una sola línea:
   `// Reserved for the orders integration task.` y equivalentes. Cero código.
3. El único punto de entrada que menciona los 25 pasos los declara pendientes:
   `run-rider-staging-smoke.ps1:129` dice *"La siembra del pedido QA y los 25
   pasos se agregan sobre esta base"* y marca `smoke-25-pasos SKIP`.

Lo que sí existe es el gate de ingreso que certificamos hace un rato, más tests
instrumentados de componentes sueltos (cola offline, recuperación tras
reinicio, almacenamiento cifrado, notificaciones).

**Por qué no sembré igual y probé:** crear el pedido QA habría dejado un pedido
en staging sin nada capaz de consumirlo, y el cleanup habría tenido que
borrarlo sin que el pedido hubiera servido para nada. La regla de la propia
automatización es no mutar a ciegas.

No uso `QA_ORDER_SEED_UNSAFE` porque sería inexacto: la siembra **sí** sería
segura. El fixture QA está perfectamente aislado (ver punto 7). Lo que falta es
el consumidor, no el dato.

---

## Reporte

**1. runId** — `95243dd4-621e-4b50-93ff-8bc3becfd99c`

**2. Lock** — Adquirido atómicamente 2026-08-05T16:07:41Z en
`D:\1212\_claude-locks\moto-g15.lock` con `OWNER=RIDER_FULL_STAGING_SMOKE`,
`PID=7116`, `HEAD=9c80f98`, `PURPOSE=RIDER_STAGING_25_STEP_SMOKE`. Liberado en
`finally` tras verificar el PID. La ruta canónica `D:\1212_claude-locks` sigue
sin poder crearse: la raíz de `D:\` concede sólo `ReadAndExecute` y la sesión no
está elevada. `heavy-compute.lock` no se tocó.

**3. Ramas, HEAD y Git**

| Repo | Rama | HEAD | Estado |
|---|---|---|---|
| app | `codex/rider-map-staging` | `95294d9d36a6429a21a562ea6a48b8c9ecbf8523` | limpio |
| automatización | `test/taba2-rider-staging-smoke-automation` | `9c80f98c11ea1f51dc2af57fcd543b9d0aeaf6c9` | limpio |

Sin cambios en esta corrida. Sin push.

**4. Hashes**

| | Local | Instalado |
|---|---|---|
| target | `d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299` | idéntico (verificado en la corrida previa) |
| androidTest | `dba68a9af31ff957d94ed5b0b72ba9161f215ad75e0d9b055a02732f03468d79` | idéntico |

**5. Sesión inicial** — La tercera sesión del gate anterior sigue vigente.
Verificada con `force-stop` + relanzamiento: `rider_session.enc` presente (1125
bytes), cola visible, banner de sincronización autenticada, formulario de login
ausente. **Se conserva**: el smoke la va a necesitar.

**6. Pedido QA creado** — Ninguno. Bloqueo antes de la Fase 2.

**7. Baseline (sólo lectura)**

Producto QA — aislado y restaurable, sin ambigüedad posible:

| campo | valor |
|---|---|
| sku | `QA-TASK04-STAGING-ONLY` |
| external_id | `qa-task04-staging-only` |
| catalog_origin | `staging_only` |
| marca / subcategoría | `TABA QA` / `Prueba QA` |
| descripción | "Fixture sintético exclusivo de staging para concurrencia." |
| **stock** | **19** |
| available / is_active | True / True |

Backend:

| | |
|---|---|
| Negocio | `La Taba`, id `00000000-0000-4000-8000-000000000001` (único) |
| Pedidos totales | 31 |
| Pedidos del Rider QA | 2 (históricos) |
| Pedidos en estado activo | 1 — **LT-0030** |
| Activos del Rider QA | 0 |
| Claims del Rider QA | 0 |
| Ubicaciones del Rider QA | 0 |
| Membership | rider, activa, 1 total, 0 otros negocios |
| Clientes | 19 (16 marcados QA, 3 humanos) |
| Direcciones | 10 |

Dispositivo: `cache/qa-smoke` 0 entradas, `cache/qa-trace` 0 entradas, DPAPI
temporal 0 archivos, `no_backup` sólo con `rider_session.enc`, sin
`active_delivery.json`, sin cola offline.

**8. Tabla de 25 pasos** — Sin ejecutar. Los 25 pasos quedan pendientes.

**9. GPS_LIVE_STATIONARY** — Sin ejecutar. No se afirma nada sobre movimiento.

**10. Offline / exactly-once** — Sin ejecutar.

**11. Entrega terminal** — Sin ejecutar.

**12. Stock antes/después** — 19 / 19. Sin tocar.

**13. Pedidos / claims / locks antes y después** — Idénticos: 31 pedidos, 2 del
Rider QA, 0 activos del QA, 0 claims, 0 ubicaciones. Nada creado, nada
modificado, nada borrado.

**14. Cleanup** — No hubo nada que limpiar: cero mutaciones. Estado final
verificado igual al inicial. Sin `adb reverse`/`forward` creados, red del
teléfono sin tocar, app estable con su sesión.

**15. Rotación final** — No ejecutada, deliberadamente. El smoke no corrió, así
que rotar sólo habría destruido la tercera sesión preservada que el smoke
necesita como punto de partida.

**16. Secret scan** — La `service_role` vivió sólo en memoria del proceso: no
pasó por argv, ni `.env`, ni Git, ni logcat, ni artefactos. Este reporte no
contiene emails, user ids, tokens, claves, direcciones ni nombres humanos.

**17. Datos humanos y LT-0030** — **LT-0030 intacto**: es el único pedido en
estado activo, status `arrived`, asignado a un rider que **no** es el QA.
Identificado explícitamente y excluido de toda mutación — que en esta corrida
fue trivial de garantizar, porque no hubo ninguna. Los 3 clientes humanos y los
29 pedidos que no son del Rider QA no se tocaron ni se imprimieron.

**18. Errores o reintentos** — Ninguno. Un solo intento, detenido por
precondición.

**19. Artefactos** —
`D:\1212\artifacts\taba2-rider-staging-smoke-95243dd4-621e-4b50-93ff-8bc3becfd99c\`

**20. Declaración** — **No se certifica.**
`TABA2_RIDER_STAGING_AUTOMATED_SMOKE_CERTIFIED` no corresponde: 0 de 25 pasos
ejecutados. Bloqueo exacto: `SMOKE_AUTOMATION_ABSENT`.

Clasificación según la Fase 6: `AUTOMATION_DEFECT` — capacidad ausente, no
defecto de la app. Nada indica regresión en TABA2 Rider.

---

## Qué haría falta

Los 25 pasos no se pueden manejar sólo con adb. Lo comprobé: `uiautomator` sí
ve el árbol de Flutter vía `exec-out`, así que taps y lecturas de pantalla son
viables — así resolví el logout del gate anterior. Pero el paso 24 exige
escribir el código de entrega en un campo, y las dos vías disponibles desde adb
(`input text` y el portapapeles) están prohibidas por las reglas vigentes. La
escritura aprobada es `ACTION_SET_TEXT` desde instrumentación, que es
justamente lo que hay que construir.

Sugiero un test instrumentado que maneje la máquina de estados completa
—cola → claim → pickup → start → arrival → código → entrega— con los asserts
de privacidad pre/post claim adentro, más orquestación PowerShell para lo que
vive fuera de la app: pantalla, background/foreground, corte de red y
verificación backend de exactly-once.

Eso implica recompilar androidTest, o sea `heavy-compute.lock`. Y según tu
propia Fase 6, el cambio va fuera de una corrida activa: por eso liberé el lock
en vez de dejarlo tomado mientras se construye.

El pedido QA se siembra recién cuando el consumidor exista, en una corrida
nueva y completa.
