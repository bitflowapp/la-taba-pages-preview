# Runbook · algo salió mal

Ordenado por lo que ve el operador, no por la causa técnica. Cada entrada dice
**cómo se detecta**, **qué hacer ahora** y **qué NO hacer**.

Regla que no se negocia: **nunca marcar como hecho algo que no pasó.** Un pago
sin confirmar es «sin confirmar», una factura sin emitir es «sin emitir».

**Este documento no reemplaza a los de pagos, los precede.** Cubre el circuito
completo desde lo que ve el operador. Para el detalle de un problema de cobro, la
fuente sigue siendo:

- `docs/payments/mercadopago/TROUBLESHOOTING.md` — síntoma → acción segura;
- `docs/payments/mercadopago/DAILY_RECOVERY_RUNBOOK.md` — recuperación diaria,
  con los permisos de owner/admin/staff;
- `docs/payments/mercadopago/INCIDENT_RESPONSE.md` — contener, preservar,
  clasificar, reconciliar;
- `docs/payments/mercadopago/REFUNDS.md` y `CHARGEBACKS.md`.

---

## 0 · Rollback del frente (lo primero si el sitio quedó roto)

El despliegue es Cloudflare Pages, proyecto `taba2-staging`, rama `staging`.

| | |
|---|---|
| Actual | `8241b56f-532c-41ba-8482-ef96a3299549` · source `1d26c4b` · v61 |
| Anterior (rollback) | `c184ffb6-325e-44d1-8c2e-3ae245b09d50` · source `399d0cc` · v60 |

Rollback = **volver a promover el deployment anterior** desde el panel de
Cloudflare Pages (Deployments → el `c184ffb6…` → *Rollback to this deployment*).
Es reversible: el `8241b56f…` sigue existiendo y se puede volver a promover.

**Después de cualquier deploy o rollback, verificar el runtime-config:**

```bash
curl -s https://taba2-staging.pages.dev/runtime-config.js | sha256sum
# tiene que dar  57d8a007289a31cc334b77d2431aa45f126c39e1d760137d273dbcfa640c8716
```

Si NO da eso, el deploy pisó la configuración con el template vacío del
repositorio, que **falla cerrado a propósito**. El sitio no va a arrancar.
Restaurar desde `artifacts/ci/staging-v61/preserva/runtime-config.live.js`.

---

## 1 · El cliente pagó y no aparece el pedido

**Detección:** el cliente muestra comprobante de Mercado Pago y el Panel no lo
tiene. También lo levanta la alerta `payment_id_missing` / el barrido.

**Qué hacer:** el Panel tiene la consola de cobros con **rearmado** de pedido a
partir del pago (`recover_paid_checkout_order`). Es idempotente: rearmar dos
veces no crea dos pedidos, y la segunda vez no anuncia un pedido nuevo — está
cubierto por test e2e.

**Qué NO hacer:** cargar el pedido a mano por otro camino. Se duplica.

---

## 2 · El pago quedó `pending` y no se mueve

**Detección:** estado de pago en el Panel; alerta `payment_outbox_failed`.

**Qué hacer:** esperar la reconciliación —el worker reintenta con backoff— y
mirar la cola. Si el pago está aprobado en Mercado Pago pero el pedido no
avanzó, es el caso 1.

**Qué NO hacer:** entregar la mercadería como si estuviera cobrado.

---

## 3 · El worker de pagos está caído / la cola crece

**Detección:** `payment_outbox` con filas en `retry_wait` o `dead_letter`
acumulándose; alerta `worker_failed`.

**Qué hacer:** revisar los secretos Edge y volver a desplegar la función. Las
filas en `dead_letter` **no se borran**: se resuelven una por una y queda el
rastro.

---

## 4 · No hay Rider / el Rider quedó stale

**Detección:** pedido en `ready` sin tomar; posición del rider vieja; alerta de
rider stale.

**Qué hacer:** hoy el reparto es manual (cola/claim). Si nadie lo toma, el
negocio puede cancelar con motivo desde el Panel, o entregarlo por fuera y
cerrarlo con el código. **El auto-dispatch NO está desplegado**: no esperar que
asigne solo.

---

## 5 · El Panel está cerrado y entró un pedido

**Detección:** el pedido existe y nadie lo tocó.

Los pedidos **no se pierden**: el Panel los lee de la base al abrir, con poll
incondicional cada 5 s además del realtime. Abrir el Panel y seguir.

---

## 6 · El cliente ve una versión vieja de la app

**Detección:** el cliente reporta algo que ya se arregló.

Es el service worker. La versión servida hoy es
`la-taba-runtime-v61-cliente-comercial-mapa-permanente`. Pedirle **recargar dos
veces** o cerrar y abrir la app. Si persiste, verificar que el `sw.js` servido
declare esa versión.

---

## 7 · El motor de alertas dejó de correr

**Detección:** la sonda pública deja de decir `healthy: true`.

```bash
curl -s -X POST https://ukxqbgswjlibmnjemrzd.supabase.co/rest/v1/rpc/scheduler_heartbeat \
  -H "apikey: <publishableKey del runtime-config>" -H 'Content-Type: application/json' -d '{}'
```

`age_seconds` > 600 = el barrido está atrasado. Hay tres capas de detección; dos
están vivas (tráfico real y sonda pública) y **las dos externas todavía no
corren** — ver `GO-LIVE-AUDITORIA.md`, requieren un clic humano cada una.

---

## 8 · Stock que quedó retenido

**Detección:** producto sin stock disponible pero sin pedidos que lo expliquen.

Las reservas se liberan por su propio vencimiento. Si una quedó colgada, se
resuelve desde el Panel; el esquema impide stock negativo
(`check (stock is null or stock >= 0)`), así que el riesgo es vender de menos,
no de más.

---

## 9 · Se emitió mal un comprobante

**No aplica todavía:** el fiscal automático **no está desplegado** y hay **0
documentos emitidos**. Ver `FISCAL-PILOTO-MANUAL.md`.

---

## Siempre, antes de cerrar un incidente

1. `LT-0030` intacto: `arrived`, revisión 11, total 550.
2. Ningún pedido `origin='qa'` nuevo.
3. Las alertas que se abrieron, cerradas o explicadas.
4. El lock del entorno pasado a `CERRADO` con lo que pasó.
