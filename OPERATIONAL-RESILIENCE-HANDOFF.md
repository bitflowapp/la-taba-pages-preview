# TABA2 · Resiliencia operativa del piloto

**Rama:** `fix/taba2-operational-resilience` · **Base:** `release/taba2-pilot-rc1` (`f4588f9`, verificado)

Este documento responde una sola pregunta: **¿puede un fallo importante de pagos,
pedidos o del procesador de cobros ser detectado sin que una persona abra el Panel?**

Antes de esta rama: **no**. Ahora: sí, con los tiempos de la tabla de abajo.

---

## 1. Lo que se encontró

### P1 · El aviso de actualización quedaba pegado en el teléfono

`js/pwa-update.js` sólo tenía camino de IDA. `announceWaitingUpdate` MOSTRABA el
aviso; **nada lo retiraba**. Cuando el worker en espera desaparecía —activó por su
cuenta, lo activó otra pestaña, o una publicación más nueva lo dejó obsoleto— el
aviso sobrevivía a su propio motivo: 115 px fijos sobre un viewport de 664 en
iPhone, sin botón de descarte, comiéndose el toque de «Agregar». Y «Actualizar
ahora» hacía `return` en la primera línea, porque `registration.waiting` ya era
`null`.

**Reproducido antes de tocar nada**, contra un Service Worker real
(`tests/e2e/pwa-update-lifecycle.spec.mjs`), en dos escenarios que fallaban:

| Escenario | Resultado sobre `f4588f9` |
| --- | --- |
| Dos pestañas, una actualiza | la otra queda con el aviso **para siempre** |
| El worker en espera activa solo | el aviso **sobrevive** al motivo que lo puso |

### P0 operativo · Las alertas sólo existían si alguien miraba

```
public.get_production_operation_center(business)      <- ÚNICO llamador
  └─ perform public.refresh_operational_alerts(business)
       └─ if not public.has_business_role(...) then raise 42501
```

`refresh_operational_alerts` era el único lugar donde se calculaban las alertas
operativas, exigía un operador con sesión iniciada, y su único invocador era la
pantalla del Centro de operación. Consecuencia exacta: un pago aprobado sin
pedido, una cola de cobros trabada o un Rider sin señal **existían en la base
desde el minuto cero y nadie los miraba** hasta que una persona abría el Panel.
De noche, horas.

No es una hipótesis: el cierre de la sesión de RC1 registra que las dos alertas
de reconciliación pendientes «pasaron a `resolved` POR EL PROPIO SISTEMA al
recalcular **al abrir el Panel**».

### Gate roto en la punta de la release

`npm run check` estaba **ROJO** en `f4588f9`: `RELEASE-MANIFEST-RC1.md` entró con
cuatro rutas de disco local y `check-release-hygiene` las prohíbe. Corregido sin
perder la información.

### El barrido se denunciaba a sí mismo (lo encontró el despliegue)

En la **primera corrida** después de aplicar la migración en staging
(`2026-08-10T18:04:00Z`), `taba-operational-alerts-sweep` abrió una alerta
**CRÍTICA** contra sí mismo:

```
alert_code ....... SCHEDULER_JOB_STALLED
job .............. taba-operational-alerts-sweep
last_start ....... 18:04:00.033Z   <- la corrida que se estaba ejecutando
last_success_at .. sin ninguno todavía
resuelta ......... 18:05:00Z, sola, por la corrida siguiente
```

Una tarea recién programada no tiene ningún éxito, y el guardián de «el
planificador sigue vivo» se cumplía porque las otras tres sí habían corrido.
Dura un minuto, pero aparecería en cada despliegue y en cada restauración: es
exactamente la alarma que enseña a ignorar el tablero.

**El arnés local no podía verlo**: el fixture siembra historial de corridas antes
de medir, justamente para no medir el reloj del fixture. Corregido en
`20260810140000` —«detenida» exige haber estado en marcha alguna vez— y agregado
al arnés, junto con el caso contrario (una tarea colgada media hora sin terminar
sí se detecta).

### Otros hallazgos, anotados y no maquillados

* Ocho códigos de alerta que ya se emitían **no tenían traducción** para el
  operador y caían en el texto genérico «el sistema detectó algo». Ahora la
  tienen.
* La rama contiene una migración (`20260807155000`) que **no está aplicada en
  staging** (ledger remoto: 67; árbol local: 68). No es de este encargo y **no se
  aplicó**: aplicarla como efecto colateral habría cambiado el backend
  certificado sin que nadie lo pidiera.

---

## 2. Qué se detecta ahora sin abrir el Panel

`taba-operational-alerts-sweep` corre **cada minuto** con pg_cron —el mismo
mecanismo que este proyecto ya usaba para otras tres tareas— y evalúa todos los
negocios activos. El cálculo se separó de la autorización:

* `reconcile_operational_alerts_for_business(uuid)` tiene el cuerpo entero y no
  pregunta por sesión: la corre el planificador;
* `refresh_operational_alerts(uuid)` queda como envoltorio con el **mismo nombre,
  firma, permisos y verificación de rol**. El Panel no cambia en nada.

| Condición | Alerta | Ventana propia | Detección total |
| --- | --- | --- | --- |
| Pago aprobado sin pedido | `PAYMENT_APPROVED_WITHOUT_ORDER` | 5 min | **≤ 6 min** |
| Cobro abandonado en la cola | `PAYMENT_OUTBOX_STALLED` | inmediata | **≤ 1 min** |
| Cobro reintentando sin avanzar | `PAYMENT_OUTBOX_STALLED` | 15 min | **≤ 16 min** |
| **Procesador de cobros sin actividad** | `PAYMENT_WORKER_IDLE` | 5 min | **≤ 6 min** |
| Checkout sin confirmación del proveedor | `CHECKOUT_PROVIDER_UNVERIFIED` | 20 min | **≤ 21 min** |
| **Tarea automática fallando** | `SCHEDULER_JOB_FAILING` | 3 fallos (~3 min) | **≤ 4 min** |
| **Tarea automática detenida** | `SCHEDULER_JOB_STALLED` | 15 min | **≤ 16 min** |
| **Pedido que nadie aceptó** | `ORDER_NOT_ACCEPTED` | 10 min | **≤ 11 min** |
| **Pedido aceptado que no avanza** | `ORDER_STALLED` | prometido + 30 min | **≤ prometido + 31 min** |
| Pedido listo sin Rider | `ORDER_READY_WITHOUT_RIDER` | 15 min | **≤ 16 min** |
| Rider sin señal en entrega activa | `RIDER_SIGNAL_STALE` | 5 min | **≤ 6 min** |
| Stock retenido por checkout vencido | `STOCK_RESERVATION_STUCK` | 5 min | **≤ 6 min** |
| Cola fiscal / PDF / impresión / ARCA ambiguo | 4 alertas ya existentes | según cada una | **ventana + 1 min** |

Las **cinco en negrita** son nuevas. El resto ya existía y **ahora se evalúa
solo**; antes su tiempo de detección era «hasta que alguien abra el Panel», es
decir, sin techo.

### Lo que NO se hizo, a propósito

* **No se alerta por firma de webhook rechazada.** En TEST la notificación de
  Checkout Pro la firma la aplicación de prueba y nunca valida (documentado en
  `20260809180000`). Prenderla sería una alarma permanente que enseña a ignorar
  el tablero.
* **No se duplica ninguna alerta existente.** El dinero cobrado sin pedido sigue
  siendo `PAYMENT_APPROVED_WITHOUT_ORDER` y no se emite otra desde
  `checkout_sessions`. Un job roto produce UNA alerta, no dos.
* **Los pedidos de prueba (`origin = qa`) no suenan**, igual que no suenan en la
  bandeja. Verificado en los dos sentidos.
* **Techo de 24 horas** para las alertas de pedidos: un pedido de anteayer que
  nadie aceptó es historia, no una acción de hoy. Sin ese techo, el primer
  barrido sobre una base con meses de pedidos abriría una avalancha que nadie va
  a resolver, y un tablero con cuarenta cosas viejas se ignora entero.
* **No se automatizó ninguna acción económica.** El sistema detecta, dice qué
  hacer, y recupera sólo lo que es seguro recuperar.

---

## 3. Cómo viene el sistema (superficie de salud)

Un tablero vacío puede querer decir dos cosas muy distintas: que no pasa nada, o
que **hace seis horas que nadie mira**. La sección «Cómo viene el sistema», debajo
de «Qué resolver», es la que las separa. Todo lo que dice sale de datos medidos:

| Fila | De dónde sale |
| --- | --- |
| Vigilancia automática | última fila de `operational_sweep_runs` y su antigüedad |
| Tareas automáticas | `cron.job` + `cron.job_run_details`, tarea por tarea |
| Cobros automáticos | estado real de la cola y del último trabajo completado |
| Dinero cobrado sin pedido | `list_unfinalized_paid_checkouts()`, acotado al negocio |
| Pedidos que necesitan una persona | mismo criterio que las alertas |
| Mercadería apartada de más | reservas activas de checkouts vencidos |
| Configuración de cobros | **existencia y forma**, nunca el valor |

**Nada está en verde por defecto.** Si no hay dato, el estado es «Sin datos», no
«al día». Si el servidor no devuelve la salud, la sección lo dice en vez de
callarse. Está probado en las dos direcciones: con el barrido corriendo dice «al
día»; envejeciendo la última corrida, la MISMA función dice «detenido».

**Secretos:** de la bóveda salen dos booleanos y una frase de estado. El ensayo 9
carga un secreto con un valor conocido y comprueba que ese valor **no aparece en
ninguna parte** de la respuesta; el test del Panel comprueba lo mismo del lado
del navegador.

---

## 4. Recuperación, condición por condición

Cada fila se provocó de verdad contra PostgreSQL real y se midió qué pasa cuando
el servicio vuelve (`supabase/tests/operational_resilience_drills.local.sql`).

| Condición | Detecta | Recupera | Quién |
| --- | --- | --- | --- |
| Procesador de cobros caído | `PAYMENT_WORKER_IDLE` + el cobro concreto | al volver, **las dos alertas se cierran solas** | sistema |
| Tarea automática fallando | `SCHEDULER_JOB_FAILING` | al primer éxito, se cierra sola | sistema |
| Tarea automática detenida | `SCHEDULER_JOB_STALLED` | al primer éxito, se cierra sola | sistema |
| Pago que entra y pedido que no nace | `PAYMENT_APPROVED_WITHOUT_ORDER` + `paid_without_order` en salud | `finalize_paid_checkout_session` arma el pedido; la alerta se cierra sola | **persona**, con acción clara |
| Stock que desaparece antes del recovery | `STOCK_RESERVATION_STUCK` | `sweep_expired_checkout_sessions` devuelve el stock **solo** | sistema |
| Rider que deja de reportar | `RIDER_SIGNAL_STALE` | vuelve la señal → se cierra sola | sistema |
| Pedido que nadie acepta | `ORDER_NOT_ACCEPTED` | aceptarlo la cierra | **persona** |
| Pedido que no avanza | `ORDER_STALLED` | moverlo la cierra | **persona** |
| Aviso duplicado / tardío | — | el barrido es idempotente: cuatro corridas dejan **una** fila, sin inflar contador ni escribir un evento por corrida | sistema |
| Dos barridos a la vez | — | lock consultivo: el segundo **se retira sin escribir** | sistema |
| La red vuelve | — | la corrida siguiente reconcilia y cierra lo que ya no está | sistema |

**Nunca se automatiza un reembolso ni ninguna acción económica irreversible.**
Donde hay dinero de por medio, el sistema detecta, conserva la evidencia y le
dice a una persona exactamente qué mirar.

---

## 5. Aplicado y verificado en staging

Las tres migraciones están **aplicadas en `la-taba-staging`**. El ledger remoto
pasó de 67 a 70 con exactamente estas tres y ninguna más:

```
20260810120000_autonomous_operational_alert_evaluation
20260810130000_operational_health_surface
20260810140000_scheduler_stalled_needs_history
```

`supabase db push` habría arrastrado además `20260807155000` (ajena a este
encargo, presente en el árbol y ausente en staging). Se la sacó de la carpeta
durante cada push y se la devolvió inmediatamente: **sigue sin aplicar**, y el
árbol quedó limpio.

**La prueba que no se puede dar localmente** —que pg_cron alojado ejecuta el
barrido por su cuenta— quedó medida:

| corrida | estado | hallazgos | críticas | duración |
| --- | --- | --- | --- | --- |
| 18:04:00 | ok | 3 | 1 | 422 ms |
| 18:05:00 | ok | 2 | 0 | 121 ms |
| 18:06:00 … 18:11:00 | ok | 2 | 0 | 109–215 ms |

Ocho corridas seguidas, **una por minuto, sin que nadie las pidiera**, a ~120 ms
cada una. La crítica de la primera es el defecto de la sección 1, ya corregido.

Lo demás verificado sobre el entorno alojado: la salud operativa responde con las
cuatro tareas «al día», informa los dos secretos como cargados **sin devolver
ningún valor** (2.332 caracteres revisados, ni la credencial usada ni ninguna
cadena con pinta de secreto), y sin sesión contesta **401**.

**Estado de la base, antes y después:**

| | antes (17:58Z) | después (18:11Z) |
| --- | --- | --- |
| negocios · pedidos · checkouts · cobros | 1 · 97 · 83 · 83 | idénticos |
| reservas activas | 0 | 0 |
| alertas abiertas | 2 (`RIDER_SIGNAL_STALE`) | 2 (las mismas) |
| cola de cobros | 12, todas completadas | idéntica |
| LT-0030 | `arrived` $550, `updated_at` 2026-08-06T19:31:47Z | **sin tocar** |

Ni una fila de negocio se escribió. Cero Edge Functions redesplegadas, cero
publicación a Pages, cero producción, cero ARCA, cero WhatsApp, cero dinero real.

**El frente todavía no está publicado.** «Cómo viene el sistema» vive en esta
rama; Pages sigue sirviendo la RC1. El backend ya responde `health` dentro de
`get_production_operation_center` y la RC1 publicada **ignora esa clave sin
romperse** (lee `metrics`, `alerts` y `recent_closures`). Publicar el frente es un
paso aparte, con su propio lock.

## 6. Cómo reproducir

```bash
# Ensayos contra PostgreSQL real y descartable (contenedor propio, 71 migraciones)
TABA_LOCAL_OPS_DB=1 node scripts/run-operational-resilience-drills.mjs

# El aviso de actualización contra un Service Worker real
npx playwright test tests/e2e/pwa-update-lifecycle.spec.mjs --project=chromium
```

El arnés levanta su **propio** contenedor: apuntar `cron.database_name` al efímero
exige reiniciar el servidor, y hacerlo sobre el stack de otra sesión le reinicia
la base abajo de los pies.

---

## 7. Gates

| Gate | Resultado |
| --- | --- |
| `npm run check` | verde (**estaba rojo en `f4588f9`**) |
| `npm test` | **1289/1289** (base 1268 · +21 nuevas) |
| Playwright | **243/243** en 11,7 min (base 238 · +5 nuevas) |
| `npm run migrations:validate` | 71 en orden, revisión estática aprobada |
| `npm run secrets:scan` | limpio |
| Ensayos de resiliencia | **11 ensayos · 58 afirmaciones**, verdes desde cero |
| Idempotencia y concurrencia | cuatro barridos → una fila; dos simultáneos → el segundo se retira |
| Árbol de trabajo | limpio · sin `push` |

## 8. Deuda que queda

1. **Quién vigila al vigilante.** Si pg_cron se muere entero, el barrido tampoco
   corre, y esta rama no puede avisarlo desde adentro. La salud operativa lo hace
   visible en un solo dato (antigüedad de la última evaluación), pero **un aviso
   fuera de la base —que llegue al teléfono— sigue faltando**. Es el paso
   siguiente natural y no está hecho.
2. **`ORDER_READY_WITHOUT_RIDER` y las alertas anteriores no excluyen `origin =
   qa`.** Las cinco nuevas sí. No se tocaron las existentes para no cambiar
   comportamiento certificado; queda anotado.
3. **`20260807155000` sigue sin aplicar en staging.** No es de este encargo. Hay
   que decidirla explícitamente: mientras esté en el árbol y no en el ledger,
   cualquier `supabase db push` futuro la va a querer aplicar de arrastre.
4. **El frente de esta rama no está publicado.** El backend ya vigila; la
   sección «Cómo viene el sistema» se ve recién cuando se publique.
5. **Un fallo del planificador entero sigue siendo invisible desde adentro**
   (ver punto 1). Hoy la única forma de enterarse es mirar la antigüedad de la
   última evaluación en el Panel.
4. **La firma del webhook no valida en TEST.** Sin cambios: es del proveedor.
5. **El handler de `production-operations.js` para
   `[data-production-payment-recover]` sigue inalcanzable** (deuda heredada de la
   sesión del Panel de recuperación).
