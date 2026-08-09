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

### P0 · De la revisión de seguridad no se salía. Ni devolviendo el dinero
Apareció al construir la recuperación, no antes. Medido sobre una fila real:
`security_review_required` tiene **rango 150**, el más alto de la escala, y
`prevent_payment_intent_status_regression` rechaza todo destino menor —
`refunded` 130, `completed` 110, `approved_order_pending` 105—. Es un estado
**absorbente**: lo que entra ahí no sale.

Ahí caen exactamente los cobros que entraron y no llegaron a pedido. Y el Panel
ofrecía para ellos una sola salida: devolver el dinero. Pero
`record_payment_refund_response` termina con
`update payment_intents set internal_status = 'refunded'`, que es justo el
UPDATE bloqueado. **El reembolso se ejecutaba en Mercado Pago y no se podía
registrar de este lado**: el trabajo del outbox falla, reintenta hasta
`dead_letter`, y la fila sigue diciendo «revisión de seguridad» con la plata ya
devuelta. La única salida que el producto ofrecía no podía completarse.

*Corregido:* una revisión se puede resolver hacia un conjunto explícito y
cerrado —`completed`, `approved_order_pending`, `refunded`,
`partially_refunded`, `charged_back`—. Nada más. Probado que `pending`,
`redirected`, `expired` y `rejected` siguen rechazados y que un pago completado
tampoco puede volver atrás. La automatización sigue sin poder limpiar una
revisión: `record_mercadopago_payment_snapshot` elige con `rank(nuevo) >=
rank(viejo)` y contra 150 ningún estado del proveedor gana.

### P0 · Armar el pedido de un cobro que entró no tenía botón
Era el último caso del circuito que exigía una persona técnica: si el producto
estaba disponible igual, la única forma de darle a esa persona lo que compró era
reponer stock y crear el pedido contra la base.

*Corregido:* `recover_paid_checkout_order` vuelve a tomar el stock —mismos locks,
mismo orden— y **delega el alta en `finalize_paid_checkout_session`**, el camino
ya certificado; no duplica una línea de la lógica de creación. Si el stock ya no
alcanza **no inventa un pedido incumplible**: devuelve qué falta y de cuánto para
que el operador reembolse sabiendo por qué. Superficie completa: bandera
`can_recover_order`, acción en el Panel para owner/admin, y el repositorio
traduce `stock_insuficiente` a una frase que dice qué falta.

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
| `order_intake_dispatch_p0.local.sql` + `order_end_to_end_chain.local.sql` | **98/98**, base limpia de 68 migraciones |
| `run-100-user-load-drill.mjs` | **25/25**, corridas consecutivas, exit 0 |
| `npm test` | **1215/1215** |
| `npm run check` · `migrations:validate` · `secrets:scan` | verde · 68 · limpio |

**La cadena completa sobre UN pedido** (`order_end_to_end_chain.local.sql`,
18/18): carrito → reserva → preferencia → **el cliente paga y no vuelve** → el
barrido pregunta al proveedor → el pedido nace solo → el Panel lo ve → acepta,
prepara, listo → el Rider lo recibe y lo toma → un segundo Rider no se lo puede
quitar → retirado, en camino, llegó → el cliente da su código → **entregado** →
cero alertas abiertas. El dinero es el mismo del principio al final:
subtotal 2000, envío 500, total 2500.

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

# TABA2_REAL_ORDER_INTAKE_AND_DISPATCH_READY

**Alcance exacto de lo que se declara, y lo que no:**

Se declara sobre **el código de esta rama**, certificado contra una base con las
68 migraciones aplicadas. Un pedido válido recorre Cliente → Panel → Rider →
entrega **sin una sola intervención técnica y sin que el cliente vuelva a la
app**, y las fallas principales convergen de forma segura: webhook duplicado,
aviso fuera de orden, doble click, sobreventa, expiración, caída del consumidor,
el pago huérfano y el cobro sin pedido. Los tres callejones sin salida que la
auditoría encontró —el pago que nadie buscaba, la revisión de seguridad
absorbente y el pedido que no se podía rearmar— están cerrados y probados.

**No se declara que staging esté listo, porque las migraciones no están
aplicadas ahí.** Faltan los cuatro pasos de la sección 6, y el paso 2 —los
secretos del Vault— es el que con más facilidad deja todo mudo pareciendo sano.
Hasta que eso corra, el circuito desplegado sigue siendo el de antes.

En criollo: **el circuito está listo; el despliegue no se hizo** y está bloqueado
por un lock ajeno, no por trabajo pendiente.
