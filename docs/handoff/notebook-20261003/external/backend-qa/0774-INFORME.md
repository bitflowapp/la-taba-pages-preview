# Intake y despacho de pedidos: desplegado y certificado en staging

**2026-08-10 · `la-taba-staging` (`ukxqbgswjlibmnjemrzd`) · rama `fix/taba2-order-intake-dispatch` HEAD `59d8e03`**

Declaración: **`TABA2_REAL_ORDER_INTAKE_AND_DISPATCH_CERTIFIED_ON_STAGING`**

Un cliente puso plata en Mercado Pago, cerró el navegador y **no volvió nunca**.
El pedido apareció solo, el Panel lo vio, el Rider lo llevó y se entregó con el
código del cliente. Dos veces, de punta a punta, sin una sola intervención por
SQL. Eso es lo que se declara.

---

## 1. Lo que se aplicó

Cinco migraciones, de a una, cada una registrada en el ledger y verificada antes
de la siguiente. **62 → 67.** Ninguna otra rama.

| Versión | Nombre | Qué trae |
|---|---|---|
| `20260809180000` | `checkout_provider_truth_sweep` | el barrido que va a buscar el pago + cron cada minuto |
| `20260809190000` | `operational_alerts_intake_and_dispatch` | alertas de intake/despacho + firmas inválidas |
| `20260809200000` | `operator_reconcile_without_payment_id` | reconciliar sin `provider_payment_id`, `can_recover_order` |
| `20260809210000` | `recover_paid_checkout_order` | rearmar el pedido de un cobro que entró |
| `20260809220000` | `resolve_security_review` | salida de `security_review_required` |

**No** se aplicó `20260807155000` (staging ya tiene el esquema `private`).

### Y una cosa que el handoff no decía

La rama **también cambia el Edge Function `mercadopago-payment-worker`** (45
líneas: `paymentForJob`, resolución por `external_reference`,
`record_provider_probe_empty`). Staging corría la v13 del 6-ago.

Se detectó midiendo, no leyendo: apenas se aplicó `20260809180000`, el barrido
encoló su primera sonda y el worker viejo la rechazó con
`Payment_is_not_reconcilable_yet` — porque la ruta vieja **exige**
`provider_payment_id`, que es justamente lo que un checkout abandonado no tiene.
La sonda quedó en `retry_wait` con 3 intentos, rumbo a `dead_letter`.

Se desplegó sólo esa función. A los 2 minutos la misma sonda cerró sola:
`completed` a las 05:06:31, con `payment.provider_probe_empty` registrado — o
sea que la sonda **termina** en vez de consultar para siempre.

**Aplicar las migraciones sin desplegar el worker deja el sistema peor que
antes.** Eso hay que decirlo en cualquier handoff futuro.

---

## 2. Precheck: salud medida, no inferida

| | |
|---|---|
| **Vault** | `taba_payment_worker_url` (80 ch, matchea el regex exacto de `dispatch_payment_outbox_worker`, apunta a staging) · `taba_payment_worker_hmac_secret` (64 ch ≥ 32). Verificado **sin ver un carácter** del valor |
| **pg_cron** 1.6.4 | 1440/1440 barridos de expiración y 2877/2880 despachos en 24 h, todos `succeeded`. Después: **3 jobs activos** en `postgres` |
| **pg_net** 0.20.4 · vault 0.3.1 · pgcrypto 1.3 | presentes |
| **Edge worker** | la última llamada HTTP real era del **6-ago**. No se dio por sano: se probó con un despacho real (HMAC de Vault → pg_net → función → **200**) |
| Edge Functions | 6 ACTIVE; rechazos correctos: `401 WORKER_AUTH_REQUIRED`, `401 INVALID_WEBHOOK`, `400 INVALID_REQUEST` |

---

## 3. Los 14 escenarios

**98 assertions verdes** contra el esquema real de staging (drill P0: 80 ·
cadena e2e: 18). Corrieron dentro de una transacción que termina en `ROLLBACK`:
cada función se ejecutó contra staging de verdad y cada assertion se evaluó,
pero el fixture (negocio, usuarios, productos, pedidos de prueba) no queda.
Verificado después: `negocios_p0=0`, `usuarios_p0=0`, `productos=0`.

| # | Escenario | Cómo se demostró |
|---|---|---|
| 1 | pago aprobado → exactamente 1 pedido | P0-1 + LT-0123 y LT-0128 reales |
| 2 | cliente no vuelve → barrido recupera | **cadena viva: navegador cerrado, pedido solo** |
| 3 | webhook duplicado/tardío → converge | «el repetido se reconoce y no encola», «un aviso viejo no hace retroceder» |
| 4 | double-click → exactly-once | P0-4: misma sesión, stock descuenta una vez |
| 5 | stock concurrente → no oversell | «la segunda compra se rechaza en vez de sobrevender», stock nunca negativo |
| 6 | pedido aparece en Panel | P0-6 + bandeja real con LT-0123/LT-0128 |
| 7 | realtime fallido → polling | **0 sockets de realtime vivos** (cortados con `routeWebSocket`), respaldo cada ~5,3 s, pedido recibido a **1,2 s** |
| 8 | Panel listo → Rider recibe | P0-8 + las dos cadenas reales |
| 9 | dos Riders claim → uno gana | P0-9 + «un segundo Rider no se lo puede quitar» |
| 10 | cancel/timeout → stock coherente | barrido devuelve el stock entero, liberar dos veces no lo infla |
| 11 | pago sin pedido → `recover_paid_checkout_order` | se arma, es idempotente, la reserva queda `converted` |
| 12 | sin stock antes del recovery → no inventa | `stock_insuficiente` + qué falta + 0 pedidos + queda `can_refund` |
| 13 | `security_review_required` → sólo lo permitido | resuelve a `refunded` y `partially_refunded`; sigue bloqueado retroceder |
| 14 | refund reflejado, sin `dead_letter` infinito | «puede reembolsarlo sin haber creado el pedido» · `dead_letter = 0` al final |

---

## 4. La cadena continua, dos veces

Producto real del catálogo (`Speed Unlimited`, `demo_fixture` — **no**
`test_only`, que clasificaría el pedido como QA y lo escondería del Rider).
Entrega con punto confirmado: `DELIVERY_LOCATION_REQUIRED` **satisfecho, no
relajado** (lat/lng, `location_source=map_pin`, `location_confirmed_at`).

### LT-0123 — latencia de 6,1 s

```
05:08:49.36  checkout creado · stock 72 -> 71 · reserva activa
05:10:55     Mercado Pago aprueba (pago 172072655315, $3.075)
             >>> el navegador se cierra. El cliente NO vuelve. <<<
05:11:00.04  el barrido encola la sonda
05:11:01.08  pago verificado por external_reference
05:11:01.14  PEDIDO LT-0123
05:11:01.16  reserva convertida      05:11:01.23  outbox completed, 1 intento
05:14:47     ENTREGADO
```

### LT-0128 — segunda corrida, pago `172073213071`

Aprobado 05:29:47 → pedido 05:31:01 → entregado 05:35:15.

Las dos: 17/17 verde en Panel → Rider (`accepted`/`preparing`/`ready`, revisión
atrasada rechazada, claim idempotente, segundo claim perdedor, código incorrecto
que no cierra, código correcto que entrega) y **el dinero igual de punta a
punta**: subtotal 2925 · descuento 0 · total 3075.

---

## 5. Integridad

| | antes | después |
|---|---|---|
| pedidos | 95 | 97 (los dos de esta misión, ambos `delivered`) |
| stock góndola | 762 | 760 (exactamente 2 unidades) |
| reservas activas | 0 | 0 · 2 convertidas |
| outbox | 2 completed | 12 completed · **`dead_letter` = 0** |
| LT-0030 | `arrived` $550 | idéntico, sólo lectura |
| ARCA | 0/0 | 0/0 |
| residuo QA | — | 0 negocios, 0 usuarios, 0 pedidos sonda, 0 actores activos |

Sin producción. Sin push. Sin dinero real (MP TEST, «Mercadopago*fake»).

### Alertas

Dos abiertas, **ninguna de esta misión**: LT-0030 (`arrived` desde el 6-ago) y
LT-0118 (`on_the_way` desde el 9-ago), las dos `RIDER_SIGNAL_STALE`.

Un detalle que importa: la fila de LT-0118 se creó recién a las **05:19**,
cuando abrí el Panel — la condición existía desde hacía horas. **Las alertas se
recalculan cuando alguien abre el Panel, no solas.** Si nadie lo abre, nadie se
entera.

---

## 6. Los 48 checkouts históricos

No se mutaron en masa. Inventario aparte en `03-checkouts-historicos.json`.

- **48**, no 47 (los 47 conocidos + uno del 9-ago 17:59Z).
- **Ninguno figura cobrado**: los 48 con `provider_payment_id` y
  `provider_status` en NULL; `provider_status='approved'` da **0**.
- 43 `expired`, 5 `cancelled`. Rango 6-ago 07:26 → 9-ago 17:59.
- **1** cae dentro de la ventana de 48 h del barrido: el sistema lo consultó
  solo, Mercado Pago respondió que no hay pago, y quedó cerrado con
  `payment.provider_probe_empty`. **47 quedan fuera de la ventana** y siguen
  intactos.
- Techo teórico si todos hubieran pagado: **$337.035**. No es deuda: es el peor
  caso si cada uno hubiera cobrado, y por lo que sabemos ninguno cobró.

**Comparación contra Mercado Pago: no se pudo hacer.** El access token de MP
vive sólo como secreto de Edge Function y no se puede leer de vuelta. La única
vía sería `mercadopago-checkout-status`, que **crea pedidos o revisiones
manuales** — mutar los 48, justo lo prohibido. Queda como revisión manual.

---

## 7. Deuda que queda abierta

1. **El front de esta rama no está desplegado.** Los botones nuevos del Panel
   («Armar el pedido de este cobro», reconciliar sin `provider_payment_id`)
   están en `js/` de la rama y Pages sirve **v56**, de
   `feature/taba2-live-tracking-production-ux`. Desplegar habría pisado el
   deploy de otra sesión con una prueba física pendiente. El backend está
   certificado; **esas dos afordancias no existen todavía en la UI publicada**.
2. **Las alertas sólo se recalculan al abrir el Panel** (ver §5).
3. `list_webhook_signature_alerts()`, `list_stock_reservation_alerts()` y
   `list_unfinalized_paid_checkouts()` siguen sin superficie en la UI.
4. **La firma del webhook no valida en TEST.** En producción tiene que validar.
5. Los 47 checkouts fuera de ventana necesitan una revisión manual contra MP.
6. La salud de pg_cron/Vault/Edge no se ve en el Panel: se infiere.

---

## 8. Credenciales

El PAT de management de `C:\1212\secrets` estaba **expirado (401)**; se
sobrescribió su valor y se borró el archivo. El acceso salió de la sesión que el
CLI ya tenía en el Administrador de credenciales de Windows, usada **sólo en
memoria**; nunca se imprimió ni se guardó.

La cuenta business QA (owner `542f6931`) devolvía `invalid_credentials`: se rotó
por Admin API con contraseña nueva de 40 caracteres, guardada **sólo** en
`C:\1212\secrets\la-taba-staging-business-login.txt`, login verificado. No se
tocaron pedidos ni stock para comprobarlo. Las cuentas de rider quedaron como
estaban.

---

## Evidencia

| Archivo | Qué es |
|---|---|
| `01-snapshot-antes.json` | estado inmediatamente antes de migrar |
| `02-vault-antes.json` | Vault validado contra su contrato, sin valores |
| `03-checkouts-historicos.json` | los 48, uno por uno |
| `04-snapshot-despues-migraciones.json` | 67 migraciones, datos idénticos |
| `05-snapshot-final.json` | cierre, residuo QA en cero |
| `06-p0-80-assertions.json` | drill P0 contra staging |
| `07-cadena-18-assertions.json` | cadena e2e contra staging |
| `08-timeline-LT-0123.json` | la línea de tiempo del pago que nadie fue a buscar |
| `09-panel-respaldo.json` | realtime cortado, respaldo cada 5,3 s |
