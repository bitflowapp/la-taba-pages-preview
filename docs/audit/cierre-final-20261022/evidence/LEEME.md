# Evidencia del cierre final (22/10/2026)

Salida cruda de las herramientas, sin rutas locales ni credenciales. Todo lo alojado es el proyecto QA
`ixewllzzuzpqrkxzmfzx` y el preview `recovery-20261020.taba2-staging.pages.dev`; los datos son sintéticos y
ningún archivo contiene un pago, una devolución o un cobro auténtico.

| Archivo | Qué es |
|---|---|
| `qa-migrations.jsonl` | Aplicación en QA de `20261022130000` y `20261022140000` (versión y SHA-256 de cada una), después del respaldo cifrado y del ensayo con *rollback*. |
| `qa-functions.jsonl` | Despliegue de las 6 Edge Functions afectadas (`ACTIVE`, versión, `verify_jwt`). |
| `qa-functions-gates.json` | Las 13 funciones activas rechazan pedidos sin autenticar o malformados; el worker rechaza una llamada sin firma y otra con firma alterada (401). Sin llamada firmada: QA está en uso. |
| `qa-cron-enable.json` | Estado de las tareas `pg_cron` de QA y sus últimas corridas. La herramienta de migraciones las pausa a propósito; se reactivaron las 5 que estaban activas (ver informe). |
| `qa-drill-late-changes.jsonl` | Simulacro alojado con el planificador real: pago pendiente sin vendedor conectado → ningún reencolado, UN hallazgo y la alerta `PAYMENT_DISCREPANCY_OPEN`; trabajo de un worker muerto recuperado por el worker nuevo (despacho firmado desde Vault → 200). |
| `qa-order-realtime-first-after-idle.json` | Pedido en efectivo por las RPC reales: la primera suscripción del dueño tras un rato quieto no recibió eventos (el comprador sí). Riesgo residual documentado. |
| `qa-order-realtime-warm.json` | La misma prueba enseguida: 11/11, el dueño recibe INSERT/UPDATE. Pedido cancelado y stock devuelto una sola vez. |
| `preview-deployment.json` | Lo que sirve el preview, byte a byte contra el artefacto (commit, runtime, `sw.js`, cabeceras) y la puerta de acceso recorrida como un navegador. |
| `preview-panel.json` | El panel del dueño QA en Chromium real a través de la puerta: ingreso, Pagos, service worker y cachés. |
| `storefront-*.json` | Recorrido de compra en la interfaz real: catálogo → carrito → checkout en efectivo; Mercado Pago no se ofrece sin vendedor conectado. |
