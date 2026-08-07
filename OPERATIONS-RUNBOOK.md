# OPERATIONS-RUNBOOK — qué hacer cuando algo se rompe

Siete procedimientos para el piloto de TABA2. Cada uno arranca por el síntoma
que alguien reporta, no por la causa que todavía no conocemos.

**Antes de cualquier otra cosa: abrí el Panel → _Estado del piloto_.** La
pantalla contesta en orden si el sistema está sano, qué necesita una persona y
dónde se rompió un pedido concreto. Casi todos estos runbooks empiezan ahí.

## Convenciones

- **No inventar.** Si un dato no está, el procedimiento dice cómo obtenerlo, no
  cómo suponerlo.
- **No cobrar dos veces.** Ningún paso de estos runbooks emite un cobro nuevo.
- **Dejar rastro.** Toda resolución de alerta lleva nota; toda acción manual
  sobre staging deja el lock actualizado.
- Las consultas SQL de diagnóstico son de **lectura**. Las que escriben están
  marcadas con ⚠ y requieren decisión explícita.
- Los `<uuid del negocio>` y `<LT-XXXX>` se reemplazan por los reales.

---

## R1 — Los pedidos no llegan

**Síntoma.** "Hace horas que no entra nada" o el mostrador dice que la web no
manda pedidos.

### 1. Distinguir día flojo de falla

Panel → _Estado del piloto_ → **Última actividad**.

- Último pedido hace minutos → es un día flojo. Confirmalo con el cliente que
  reportó y cerrá.
- Último pedido hace horas y **último checkout** también → nadie está entrando
  al checkout. Seguí en el paso 2.
- Hay **checkouts recientes y ningún pedido** → el circuito se corta después de
  pagar. Saltá a **R2**.

### 2. ¿El negocio está abierto y tomando pedidos?

Panel → _Abrir el negocio_. Verificá:

- estado del negocio `open`;
- cobros por la web activos;
- la web acepta pedidos (`ordering_enabled` y `ordering_verified`).

Si alguno está apagado, ésa es la causa. Encendelo desde ahí.

### 3. ¿La plataforma responde?

_Estado del piloto_ → **Salud de servicios**:

- `Plataforma Supabase` en rojo → **R6**.
- `Funciones de pago` en "sin señal" o ámbar → nadie creó una preferencia
  reciente. Probá un checkout de prueba desde el storefront; si no llega a
  Mercado Pago, es la Edge Function de creación de preferencia.
- `Aviso de pagos` en rojo con "pagos esperando aviso" → **R5**.

### 4. ¿El storefront está sirviendo el catálogo?

Si hay **0 productos publicados** (`published_total` en la sección de stock), la
web no tiene nada que vender. Panel → _Alta de producto_ / _Recepción_.

### 5. Cerrar

Anotá en la alerta correspondiente qué se verificó. Si no había alerta, el
incidente igual se documenta en el parte del día.

---

## R2 — Un pago se cobró y el pedido no existe

**Síntoma.** El cliente muestra el comprobante de Mercado Pago y en el Panel no
hay pedido. Es la excepción más cara del circuito.

### 1. Confirmarlo en el tablero

_Estado del piloto_ → tarjeta **"Cobrado sin pedido"**. Si está en cero, el pago
no es de este negocio o todavía está dentro del margen de reintento del worker
(5 minutos para el intento de pago, 3 para el checkout). Esperá y recargá.

### 2. Ubicar el caso

Con el código del pedido o el id de la sesión, _¿Dónde se rompió un pedido?_ →
**Seguir el pedido**. La traza dice la etapa exacta:

| Etapa rota | Significa |
|---|---|
| `payment` en `missing` | Nunca se creó un intento de pago: el cobro no salió de este sistema |
| `provider_notice` en `missing` | Mercado Pago cobró y nunca avisó → **R5** |
| `provider_notice` en `stalled`/`failed` | El aviso llegó mal firmado o no se pudo procesar → **R5** |
| `order` en `missing` con `payment` en `ok` | El pago está bien y la finalización no corrió → paso 3 |

### 3. Ver por qué no finalizó

```sql
-- Lectura. Sesiones pagas sin pedido y su antigüedad.
select s.id, s.status, s.total, clock_timestamp() - s.updated_at as trabado_hace
  from public.checkout_sessions s
 where s.business_id = '<uuid del negocio>'
   and s.origin = 'production'
   and s.completed_order_id is null
   and s.status in ('payment_approved', 'finalizing_order')
 order by s.updated_at;
```

Revisá la cola de pagos en el tablero (**Trabajo interno → Cobros**):

- `abandonados` > 0 → el worker se rindió. Paso 4.
- `vencidos` > 0 → el worker no está corriendo. Verificá `Agenda automática` en
  Salud de servicios; si está en rojo, la tarea `taba-payment-outbox-worker` no
  se ejecuta.

### 4. Reconciliar contra Mercado Pago

Tomá el `provider_payment_id` de la traza (etapa **Pago**, evidencia) y buscalo
en el panel de Mercado Pago. Compará **importe, moneda y referencia externa**.

- Si el pago **no está aprobado** en Mercado Pago: no hay nada que reconciliar,
  el cliente no pagó. Explicalo con el comprobante a la vista.
- Si **está aprobado**: hay que finalizar la sesión con el estado real del
  proveedor. Esto lo hace el worker; forzá una corrida antes que tocar datos.

⚠ **Reintento del worker** (requiere acceso de servicio):

```sql
-- Devuelve el trabajo abandonado a la cola. NO cobra nada.
update public.payment_outbox
   set status = 'pending', next_attempt_at = clock_timestamp(), attempts = 0
 where id = '<id del outbox>' and status in ('dead_letter', 'failed');
select public.dispatch_payment_outbox_worker('cron');
```

### 5. Lo que no se hace nunca

- No crear el pedido a mano con un `insert`. El pedido lleva reservas de stock,
  correlación, eventos y snapshot de dirección; armarlo a mano deja un pedido
  que el Rider no puede tomar y que la facturación no puede emitir.
- No pedirle al cliente que pague de nuevo.
- No borrar la sesión ni el intento de pago: son la evidencia del cobro.

### 6. Cerrar

Resolvé la alerta `PAYMENT_APPROVED_WITHOUT_ORDER` o
`CHECKOUT_PAID_WITHOUT_ORDER` con la nota de qué se verificó contra el
proveedor y cómo terminó.

---

## R3 — El Rider no ve un pedido

**Síntoma.** El pedido está listo y en la app del Rider no aparece.

### 1. ¿Es un pedido que el Rider puede ver?

_¿Dónde se rompió un pedido?_ con el `<LT-XXXX>`. En la etapa **Pedido**,
mirá la evidencia:

- `origin` = `qa` → **es correcto que no lo vea.** Un pedido de prueba nunca se
  despacha: la dirección es inventada y el cobro no existe. `get_rider_queue` y
  `claim_available_rider_order` lo excluyen a propósito.
- `delivery_mode` = `pickup` → no lleva rider, lo retira el cliente.
- estado distinto de `ready` → la cola sólo ofrece pedidos listos. Si está en
  `preparing`, falta que el mostrador lo marque listo.
- `assigned_rider_user_id` no nulo → **ya lo tomó otro rider**. La cola sólo
  muestra los libres.

### 2. ¿El rider tiene rol activo?

```sql
-- Lectura. Membresía del rider en el negocio.
select bm.role, bm.is_active
  from public.business_members bm
 where bm.business_id = '<uuid del negocio>'
   and bm.user_id = '<uuid del rider>';
```

Sin `role = 'rider'` y `is_active = true`, la cola devuelve vacío por diseño.

### 3. ¿El contrato del Rider está intacto?

_Estado del piloto_ → **Salud de servicios** → `Contratos del Rider`.

- En rojo con "falta una función" → una RPC que la app necesita desapareció o
  dejó de ser ejecutable. Es un incidente de despliegue: revisá la última
  migración aplicada y **R7**.
- En ámbar con "quedó accesible sin iniciar sesión" → una función del Rider
  quedó abierta a anónimos. Es un problema de seguridad, no de disponibilidad;
  hay que revocar el privilegio antes de seguir operando.

### 4. Si el pedido está listo hace rato y nadie lo toma

No es una falla técnica: es la alerta `ORDER_READY_WITHOUT_RIDER`. Asigná un
rider desde el Panel o avisale al cliente que no hay reparto disponible.

### 5. Lo que no se hace

No se modifica `orders.status` ni `assigned_rider_user_id` con un `update`
directo: las transiciones tienen guardas de revisión y eventos, y saltearlas
deja al Rider y al Panel viendo cosas distintas.

---

## R4 — El stock que muestra el sistema no es el real

**Síntoma.** La web dice que hay stock y no hay, o al revés.

### 1. ¿Hay reservas vencidas sin liberar?

_Estado del piloto_ → tarjeta **"Reservas vencidas"**. Si es mayor que cero, hay
stock comprometido por checkouts que nadie completó. Es la causa más común de
"el sistema dice que tengo menos de lo que tengo".

Verificá la agenda: **Salud de servicios → Agenda automática**. La tarea
`taba-checkout-expiry-sweep` corre cada minuto y libera esas reservas.

⚠ Si la agenda está caída, forzá un barrido (acceso de servicio):

```sql
select public.sweep_expired_checkout_sessions();
```

Volvé a mirar la tarjeta: tiene que bajar a cero.

### 2. ¿El producto está publicado y con stock declarado?

```sql
-- Lectura. Estado de publicación y stock.
select p.name, p.is_active, p.is_verified, p.available, p.stock, p.price_status
  from public.products p
 where p.business_id = '<uuid del negocio>'
   and p.name ilike '%<parte del nombre>%';
```

- `is_verified = false` → no está publicado: no se ve en la web.
- `stock` nulo en un producto publicado → **rompe un invariante del catálogo**.
  El tablero lo cuenta en `unknown_stock`, que debería ser siempre 0.
- `available = false` con `stock > 0` → falta confirmar el precio.

### 3. Corregir el stock

Siempre por el Panel: _Recepción_ para lo que entró, _Ajuste_ para diferencias,
_Conteo físico_ para recontar. Los tres dejan movimiento de inventario con
motivo y actor.

⚠ **Nunca** `update public.products set stock = …`. Un `update` directo no deja
movimiento, no explica la diferencia y hace imposible el arqueo del día.

### 4. Reponer lo que falta

Tarjetas **"Stock a reponer"** y **"Sin stock"**. "Sin stock" es lo más urgente:
son productos publicados que el cliente ve y no puede comprar, y cada intento
termina en una cancelación.

---

## R5 — El webhook de pagos está caído

**Síntoma.** `Aviso de pagos` en rojo o ámbar, o pagos que no se convierten en
pedidos.

### 1. Leer el veredicto

_Estado del piloto_ → **Salud de servicios** → `Aviso de pagos`. El motivo
distingue cuatro situaciones:

| Motivo | Qué pasó |
|---|---|
| "Hay pagos esperando aviso hace más de media hora" | Mercado Pago no está avisando o el endpoint no responde |
| "Hubo avisos que no se pudieron procesar" | Llegaron y el worker falló |
| "Llegaron avisos con firma inválida en la última hora" | Secreto desincronizado, o alguien manda avisos falsos |
| "Todavía no llegó ningún aviso" | Nunca funcionó; no es una caída, es que no está probado |

### 2. Firma inválida

Es lo más grave del cuadro: significa que **el secreto del webhook no coincide**
con el que firma Mercado Pago, o que alguien externo está enviando avisos.

- Verificá el secreto configurado en la Edge Function `mercadopago-webhook`
  contra el del panel de Mercado Pago.
- Mientras no coincidan, **ningún pago se confirma**. El sistema rechaza los
  avisos a propósito: aceptar uno sin firmar sería aceptar que cualquiera
  marque pagos como aprobados.
- Los avisos rechazados quedan registrados en `payment_webhook_receipts` con
  `processing_status = 'rejected_signature'`. Son evidencia; no se borran.

### 3. Avisos que no se procesan

```sql
-- Lectura. Avisos con problema en las últimas 24 h.
select r.event_type, r.processing_status, r.attempt_count, r.received_at
  from public.payment_webhook_receipts r
 where r.received_at > clock_timestamp() - interval '24 hours'
   and r.processing_status in ('failed', 'dead_letter', 'retry_wait')
 order by r.received_at desc;
```

Revisá la cola de pagos (**Trabajo interno → Cobros**) y la
`Agenda automática`. El worker se dispara por cron cada 30 segundos y también
al insertarse trabajo nuevo.

### 4. Mercado Pago no avisa

Mientras el aviso no llega, el pago igual se puede confirmar consultando al
proveedor: ése es el camino de `mercadopago-checkout-status`. No hace falta
esperar al webhook para cerrar un caso puntual.

Para el problema de fondo: verificá en el panel de Mercado Pago que la URL de
notificaciones apunte al proyecto correcto y que responda 200.

### 5. Cerrar

Cada pago que quedó sin pedido durante la caída se resuelve por **R2**, uno por
uno, comparando contra el proveedor.

---

## R6 — Supabase caído

**Síntoma.** El Panel no carga, o todo devuelve error.

### 1. Confirmar el alcance

- Si el Panel **no carga nada**: es la plataforma o la red del local. Probá
  desde otra conexión antes de declarar incidente.
- Si el Panel carga y _Estado del piloto_ muestra `Plataforma Supabase` en rojo:
  el motivo dice cuál de las tres piezas falta (identidades, extensiones, o
  seguridad por fila).

### 2. Verificar el estado de la plataforma

Consultá el estado del proyecto en el panel de Supabase y su página de estado.
Una caída de la plataforma no se arregla desde acá; lo que corresponde es
**medir el impacto y proteger la operación**.

### 3. Operar mientras dura

- **El mostrador sigue vendiendo.** TABA para Windows tiene outbox durable: los
  comandos se encolan y se confirman cuando vuelve la conexión. No repitas una
  acción porque "no respondió": el outbox la va a mandar una sola vez.
- **La web no toma pedidos.** Si la caída se extiende, pausá el negocio para no
  acumular checkouts que van a vencer (Panel → _Abrir el negocio_ → pausar).
- **No borres nada** para "destrabar". Lo pendiente está pendiente, no perdido.

### 4. Al volver

1. _Estado del piloto_ → **Actualizar**. Verificá que `Plataforma Supabase`,
   `Agenda automática` y `Procesador de pagos` vuelvan a verde.
2. Revisá **Trabajo interno**: las colas tienen que drenar solas. Si quedan
   `vencidos` o `abandonados` después de 15 minutos, seguí **R2**.
3. Revisá **"Cobrado sin pedido"**: los pagos aprobados durante la caída son los
   candidatos a haber quedado sin finalizar.
4. Revisá **"Reservas vencidas"**: el barrido tiene que ponerlas en cero.

### 5. Recuperación de datos

Si hubo pérdida de datos —no sólo indisponibilidad— el camino es la
restauración del proyecto. Ver **Backups y recuperación** más abajo.

---

## R7 — Rollback de un despliegue

**Síntoma.** Después de publicar algo, el Panel, el storefront o el Rider
dejaron de funcionar.

### 1. Identificar qué se movió

Un despliegue de TABA2 tiene tres piezas independientes y **se revierten por
separado**:

| Pieza | Cómo se revierte |
|---|---|
| Web (Cloudflare Pages) | Volver al deploy anterior desde Pages. Inmediato y sin efectos de datos |
| Edge Functions | Redesplegar la versión anterior de la función |
| Migraciones de base | **No se revierten solas.** Ver paso 3 |

### 2. Revertir la web primero

Es lo más rápido y lo que resuelve la mayoría de los casos. Un deploy anterior
de Pages sigue hablando con el mismo backend.

Después de revertir, verificá en _Estado del piloto_ que `Panel del negocio`
vuelva a registrar comandos.

### 3. Migraciones

Una migración aplicada **no se deshace con un rollback de git**. Si el problema
viene de una migración:

1. Identificá qué cambió: `git log --oneline supabase/migrations/`.
2. Escribí una **migración nueva** que restituya el comportamiento anterior. No
   edites la ya aplicada: en el proyecto real ya corrió y el archivo editado no
   se vuelve a ejecutar.
3. Verificala localmente antes de aplicarla:
   `TABA_PILOT_RESTORE_DRILL=I_UNDERSTAND_THIS_IS_LOCAL_ONLY npm run pilot:ops:drill`
   El simulacro replica la cadena completa desde cero y aborta si se corta.

### 4. Verificación después de cualquier rollback

_Estado del piloto_ tiene que mostrar:

- `Contratos del Rider` en verde (ninguna RPC desapareció ni quedó abierta);
- `Plataforma Supabase` en verde (RLS activo en las 9 tablas operativas);
- `Panel del negocio` registrando comandos;
- ninguna alerta nueva de las últimas horas.

### 5. Lo que no se hace

- No aplicar una migración directamente en producción sin haberla replicado
  desde cero localmente.
- No revertir la base "restaurando un backup viejo" por un bug de código: se
  perderían los pedidos reales posteriores.

---

## Backups y recuperación

### Qué está verificado en este repo

`npm run pilot:ops:drill` ejecuta un simulacro completo, local y con datos
sintéticos (cero datos humanos). En cada corrida comprueba:

1. **Reconstrucción desde cero.** Las 60 migraciones se replican en orden sobre
   un Postgres limpio. Aborta al primer corte.
2. **Contrato operativo antes del backup.** 72 aserciones sobre los números del
   tablero, las alertas, la salud, la traza y el reporte.
3. **Backup.** `pg_dump --format=custom` de los esquemas operativos, con su
   sha256.
4. **Proyecto de recuperación.** Un clúster **nuevo**, con el esquema
   reconstruido desde las mismas migraciones. Es el escenario real: no se
   restaura al lado del original.
5. **Restauración** con `pg_restore --exit-on-error --single-transaction`.
6. **Equivalencia.** Filas por tabla y huella de contenido de pedidos, items,
   pagos, alertas y productos.
7. **Contrato operativo otra vez**, sobre el proyecto recuperado.

La evidencia queda en `artifacts/pilot-ops-restore-drill.json` con hashes y
tiempos.

### Qué NO cubre y hay que verificar en el proyecto real

El simulacro prueba **el procedimiento**, no la configuración del proyecto
hospedado. Antes del piloto hay que confirmar en el panel de Supabase, y
anotarlo con fecha:

- [ ] Backups automáticos habilitados y su frecuencia.
- [ ] Retención configurada (cuántos días atrás se puede volver).
- [ ] Point-in-time recovery: si está disponible en el plan y si está activo.
- [ ] Fecha y hora del último backup exitoso.
- [ ] Quién tiene permiso para restaurar.

Sin esas cinco respuestas escritas, **no hay política de backup**: hay una
suposición. Este runbook no puede verificarlas por su cuenta porque viven en la
consola del proveedor.

### Procedimiento de recuperación real

1. **Decidir el alcance.** ¿Se perdió todo el proyecto o unas tablas? Restaurar
   entero por un problema parcial destruye lo bueno.
2. **Elegir el punto.** El más reciente anterior al incidente.
3. **Restaurar a un proyecto nuevo**, nunca encima del que está operando. Así se
   puede comparar antes de cortar.
4. **Verificar antes de cortar**, con las mismas preguntas del simulacro:
   ¿coinciden las cantidades de pedidos, pagos y productos? ¿El tablero devuelve
   números coherentes? ¿La traza de un pedido conocido llega hasta la entrega?
5. **Cortar** apuntando la web y las funciones al proyecto restaurado.
6. **Reconciliar la ventana perdida**: los pagos aprobados entre el punto de
   restauración y el incidente existen en Mercado Pago y no en la base. Se
   recuperan uno por uno con **R2**.

---

## Anexo — Consultas de diagnóstico

Todas de lectura. Requieren rol `owner`, `admin` o `staff` del negocio.

```sql
-- Tablero completo
select public.get_pilot_operations_dashboard('<uuid del negocio>');

-- Sólo salud, con la evidencia de cada veredicto
select public.get_pilot_service_health('<uuid del negocio>');

-- Dónde se rompió un pedido
select public.trace_pilot_order('<uuid del negocio>', 'LT-0086');

-- Cómo rindió la semana
select public.get_pilot_commercial_report(
  '<uuid del negocio>', current_date - 6, current_date,
  'America/Argentina/Buenos_Aires');

-- Ajustar un umbral (owner o admin)
select public.configure_pilot_ops_thresholds(
  '<uuid del negocio>', '{"low_stock_units": "12"}'::jsonb);
```
