# Matriz de pruebas Mercado Pago

Auditoría local de este turno: `npm run test:payments` pasó 17/17 y `npm run migrations:validate` pasó con 30 migraciones ordenadas. La matriz remota sigue pendiente; no se generaron pagos.

Estado: **LOCAL VERDE / STAGING REMOTO PENDIENTE**.

## Local ejecutado

- `npm test`: 705/705 PASS en HEAD `0587712be87bc32ebae6be75220eeb863780387c`.
- `npm run test:payments`: 17/17 PASS.
- `npm run test:webhook`: PASS (8 Deno + 8 Node en su composición actual).
- `npm run migrations:validate`: PASS, 30 migraciones ordenadas, 0 errores.
- `npm run check`: PASS.
- Secret scan: PASS.

Los tests locales verifican payload mínimo, recuperación, redirect no autoritativo, modelo/RLS, reservas, estado monotónico, idempotencia financiera, gates productivos, scheduler, firma y contratos de finalización.

## Staging pendiente

Preference real test; approved; pending; in_process; rejected; cancelled; expired; duplicación; fuera de orden; discrepancias de importe/moneda/referencia/preference/live_mode; timeouts; orden de retorno/Webhook; pestaña cerrada; dos pestañas; reserva vencida; aprobación tardía; caída/reintento del worker.

No se simuló finalización directa por SQL y no se creó ningún pago real.
