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

## 5. Cómo reproducir

```bash
# Ensayos contra PostgreSQL real y descartable (contenedor propio, 70 migraciones)
TABA_LOCAL_OPS_DB=1 node scripts/run-operational-resilience-drills.mjs

# El aviso de actualización contra un Service Worker real
npx playwright test tests/e2e/pwa-update-lifecycle.spec.mjs --project=chromium
```

El arnés levanta su **propio** contenedor: apuntar `cron.database_name` al efímero
exige reiniciar el servidor, y hacerlo sobre el stack de otra sesión le reinicia
la base abajo de los pies.

---

## 6. Deuda que queda

1. **Quién vigila al vigilante.** Si pg_cron se muere entero, el barrido tampoco
   corre, y esta rama no puede avisarlo desde adentro. La salud operativa lo hace
   visible en un solo dato (antigüedad de la última evaluación), pero **un aviso
   fuera de la base —que llegue al teléfono— sigue faltando**. Es el paso
   siguiente natural y no está hecho.
2. **`ORDER_READY_WITHOUT_RIDER` y las alertas anteriores no excluyen `origin =
   qa`.** Las cinco nuevas sí. No se tocaron las existentes para no cambiar
   comportamiento certificado; queda anotado.
3. **`20260807155000` sigue sin aplicar en staging.** No es de este encargo.
4. **La firma del webhook no valida en TEST.** Sin cambios: es del proveedor.
5. **El handler de `production-operations.js` para
   `[data-production-payment-recover]` sigue inalcanzable** (deuda heredada de la
   sesión del Panel de recuperación).
