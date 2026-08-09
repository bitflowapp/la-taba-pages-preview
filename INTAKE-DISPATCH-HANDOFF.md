# El circuito de pedidos: qué se midió, qué se rompió, qué falta

Rama `fix/taba2-order-intake-dispatch`, base `e59ac1c` (superset de `da56ce9`,
que es lo que sirve staging hoy). Diez commits. Sin push. Staging **no** se mutó.

---

## 1. El flujo real, reconstruido midiendo

```
Cliente arma el carrito
      │
      ▼
create_checkout_session ──► RESERVA stock (15 min)   ← el stock sale ACÁ, antes de pagar
      │                     lock por producto en orden de UUID, idempotente
      │                     por (business, customer, client_request_id)
      ▼
prepare_mercadopago_preference ──► el cliente se va a Mercado Pago
      │
      │   TRES vías nos enteran del pago, redundantes a propósito:
      ├── (1) el cliente vuelve ──► mercadopago-checkout-status
      ├── (2) webhook firmado ────► recibo idempotente ─► outbox ─► worker
      └── (3) barrido cada minuto ► outbox ─► worker           ← NUEVO
      │
      ▼
record_mercadopago_payment_snapshot   ← toda assertion comercial vive acá:
      │   importe, moneda, referencia, collector, orden de eventos por
      │   provider_event_at + rank de estados
      │
      ├── reserva viva ──► finalize_paid_checkout_session ──► PEDIDO
      └── reserva vencida ──► manual_review_required (dinero adentro, sin pedido)
      │
      ▼
PANEL  ← realtime sobre `orders` + consulta de respaldo cada 5 s
      │   + recuperación por online / pageshow / visibilitychange
      │
   aceptar → preparar → listo
      │
      ▼
COLA RIDER ──► claim (revisión optimista: gana uno solo)
      │
   retirado → en camino → llegó → código del cliente → ENTREGADO
```

Tres tareas de fondo lo sostienen: `taba-payment-outbox-worker` (30 s),
`taba-checkout-expiry-sweep` (1 min) y `taba-checkout-provider-truth-sweep`
(1 min, nueva).

---

## 2. Lo que ya funcionaba, verificado y no asumido

Medido sobre base efímera con las 66 migraciones, no leído de un handoff:

| | |
|---|---|
| Pago aprobado → exactamente un pedido | ✅ |
| `finalize` repetido | ✅ idempotente, stock una sola vez |
| Webhook duplicado | ✅ un solo trabajo encolado |
| Aviso viejo después del aprobado | ✅ no retrocede, no duplica |
| Doble click del cliente | ✅ misma sesión, un descuento |
| Stock insuficiente | ✅ rechazo limpio, nunca negativo |
| Panel ve el pedido al nacer | ✅ y con vocabulario único |
| Panel acepta → Rider recibe | ✅ |
| Dos Riders sobre el mismo pedido | ✅ gana uno solo |
| Expiración devuelve el stock | ✅ liberar dos veces no lo infla |
| Muere el worker | ✅ otro retoma por lease vencido |

---

## 3. Los defectos que aparecieron al medir

### P0 · El pago que nadie fue a buscar
El comprador paga en Mercado Pago y no vuelve. A los 15 minutos el barrido
libera el stock. De este lado: `internal_status=expired`,
`provider_payment_id=NULL`, **cero** reconciliaciones, **cero** alertas.

Las dos vías que existían eran pasivas —el webhook, que en TEST no valida firma
porque la notificación viene firmada por la aplicación de prueba
autoprovisionada, y el cliente volviendo—. No había una activa.

**Contra staging, en sólo lectura:** de 80 `payment_intents`, 66 llegaron a
Mercado Pago y **47 quedaron sin pedido, los 47 con `provider_payment_id` en
NULL**. No significa 47 cobros perdidos —son checkouts de prueba abandonados,
casi con certeza—. Significa que para 47 checkouts reales el sistema no tenía
idea, y no la iba a tener nunca.

*Corregido:* barrido por minuto que consulta al proveedor por `external_reference`
y pasa el resultado por la misma verificación de siempre. Acotado: 90 s de
gracia, una sonda activa por intent, 8 consultas vacías como techo, una cada
2 minutos, ventana de 48 h.

### P0 · Descubrir el pago tarde costaba el pedido
Pago aprobado **antes** de que venciera la sesión, avisado **después** del
barrido → revisión manual, dinero adentro y ningún pedido. Ventana de 15 minutos.

*Corregido, y no blindando la carrera sino dejando de correrla:* al preguntar
cada minuto, el pago se descubre con la reserva **todavía viva** y termina en un
pedido normal. Certificado: sesión de 3 minutos → sonda → aprobado → pedido, sin
intervención.

### P0 · El cobro sin pedido era invisible justo cuando importaba
`list_unfinalized_paid_checkouts` existe para «dinero cobrado sin operación» y
devolvía **cero filas** en ese caso: exigía `internal_status in
('approved_order_pending','approved')` y la revisión manual mueve el intent a
`security_review_required`. El peor estado era el único invisible.

### P0 · El botón de reconciliar, apagado en el único caso que lo necesita
`can_reconcile` y `enqueue_payment_reconciliation` exigían `provider_payment_id`,
que por definición del problema es NULL. Ahora alcanza con `external_reference`.
Los estados terminales de dinero siguen cerrados.

### P1 · Listo y sin Rider no producía nada
Cuarenta minutos listo, cero alertas. Sólo aparecía dentro de `delayed_orders`,
que mide la preparación contra su estimación: «la cocina va lenta» y «no hay
quien lo lleve» son problemas distintos.

### P1 · El árbol no se podía replicar desde cero
`schema "private" does not exist` en `20260807170000`. La migración que lo cierra
existía certificada en `release/taba2-pilot-rc2` y nunca aterrizó en la línea de
la candidata comercial. Sin esto no se podía medir nada.

### P1 · Stock atrapado y webhook mudo, sin superficie
`list_stock_reservation_alerts` es `service_role`: el negocio no la ve. Y una
notificación cuya firma nunca valida —o sea, la vía principal de cobro muerta—
no se notaba desde ningún lado.

---

## 4. Un defecto mío que encontró la medición

`CHECKOUT_PROVIDER_UNVERIFIED` miraba 7 días y el barrido sólo 24 horas. Al
desplegarlo, el Panel se habría llenado de ~42 alertas **críticas** de golpe por
checkouts viejos que ninguna sonda iba a consultar jamás. Alertas críticas que no
se apagan nunca no son observabilidad: son la razón por la que la gente deja de
mirar las alertas.

Las dos ventanas son ahora 48 h, y la alerta se apaga cuando existe un
`payment.provider_probe_empty`: si el proveedor ya contestó, la duda se terminó.

También fallaba el propio simulacro de carga al arrancar, una de cada varias
corridas: `pg_isready` contesta que sí contra el Postgres temporal del `initdb`,
que después reinicia. Un arnés que falla por su propio arranque entrena a leer
rojo como mala suerte.

---

## 5. Evidencia

| Gate | Resultado |
|---|---|
| `order_intake_dispatch_p0.local.sql` | **54/54**, base limpia de 66 migraciones |
| `run-100-user-load-drill.mjs` | **25/25**, dos corridas consecutivas, exit 0 |
| `npm test` | **1214/1214** |
| `npm run check` · `migrations:validate` · `secrets:scan` | verde · 66 · limpio |

**Carga**, contenedor efímero propio, una conexión real por sesión:

- **A** 100 personas sobre 40 unidades → 40 vendidas, cero sobreventa, lo vendido
  y lo descontado coinciden.
- **B** 80 envíos de doble click → 40 pedidos, 40 unidades.
- **C** 100 sesiones mixtas → p50 1518 ms, p95 1924 ms.
- **D** *(nuevo)* 60 pagos concurrentes con cada aviso entregado **dos veces**,
  120 envíos → 60 sesiones, 60 pedidos, stock −60 exacto, cero reservas vivas.
  p50 1340 ms, p95 4607 ms.
- **E** *(nuevo)* avisos viejos sobre los 60 → 0 pedidos nuevos, 0 retrocesos.
- **F** *(nuevo)* el worker muere con 30 trabajos tomados → 30/30 retomados, 0 perdidos.
- Integridad tras 330 intentos concurrentes: sin stock negativo, sin ítems
  huérfanos, sin pedidos sin ítems, sin `client_request_id` duplicado.

---

## 6. Lo que falta para operar de verdad

**Bloqueante, y no es técnico:** aplicar las tres migraciones a staging y
certificar con un pedido QA de punta a punta. No se hizo porque
`taba2-staging-mutation.lock` está **tomado y activo** por
`TABA2_RIDER_HUMAN_PHYSICAL_CERTIFICATION_DF44DAF` desde las 17:10:18Z, corriendo
un pedido humano real con el Moto G15. Mis migraciones redefinen
`refresh_operational_alerts` y `list_business_payments`, dos superficies que esa
sesión está usando en vivo.

Cuando el lock se libere:

1. Aplicar `20260809180000`, `20260809190000` y `20260809200000`. Son aditivas y
   ninguna borra datos. **No** aplicar `20260807155000`: staging ya tiene el
   schema `private` desde el repo del Rider; esa migración es para que este árbol
   se replique desde cero.
2. Cargar en Vault `taba_payment_worker_url` y `taba_payment_worker_hmac_secret`
   si no están: sin eso el worker no se despacha y el barrido encola sin que nadie
   consuma. Es la dependencia más fácil de olvidar y la que deja todo mudo.
3. Verificar que los tres cron corren.
4. Compra QA de punta a punta con Mercado Pago TEST, incluido el caso de cerrar
   el navegador después de pagar: es el que esto viene a arreglar.

**Deuda que queda, sin maquillar:**

- **Materializar a mano un pedido cuyo cobro entró y cuya reserva venció no tiene
  botón.** Reembolsar sí. Es el hueco más caro que queda.
- La salud de pg_cron, Vault y las Edge Functions no se ve en el Panel: se
  *infiere* de las alertas.
- `list_webhook_signature_alerts()`, `list_stock_reservation_alerts()` y
  `list_unfinalized_paid_checkouts()` no tienen superficie en la UI.
- El barrido cubre 48 h. Los 47 checkouts sin confirmar que ya existen en staging
  quedan fuera y habría que revisarlos una vez a mano contra Mercado Pago.
- La firma del webhook no valida en TEST. En producción tiene que validar, y si
  no valida el sistema queda apoyado sólo en el barrido y en que el cliente
  vuelva. `list_webhook_signature_alerts()` avisa; nadie la mira todavía.

---

## 7. Declaración

**No se declara `TABA2_REAL_ORDER_INTAKE_AND_DISPATCH_READY`.**

El circuito recorre Cliente → Panel → Rider automáticamente y las fallas
principales convergen de forma segura —está certificado 54/54 y 25/25—, pero
todo eso se probó en base efímera. Nada de esto está aplicado a staging todavía,
y un sistema que no corrió nunca donde va a correr no está listo, por más verde
que esté el arnés. La declaración corresponde después del paso 1 al 4 de arriba.
