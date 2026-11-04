# Mobbex — certificación sin dinero real

Alcance: PR #164 (rama `feat/la-taba-mobbex-checkout`). Nada de esto toca producción ni staging remoto, activa pagos reales ni
despliega. Para el veredicto GO/NO-GO ver [README.md](README.md#go--no-go).

## 1. Qué está certificado y con qué

| Capa | Comando | Qué prueba | Qué NO prueba |
|---|---|---|---|
| Lógica Edge pura | `node --import ./tests/test-bootstrap.mjs --test tests/mobbex-*.test.mjs` | webhook falso/duplicado/tardío, snapshots, cliente HTTP, flujos con puertos falsos, plantilla del cron | nada contra Mobbex ni Supabase reales |
| Contrato Edge ↔ base | `tests/mobbex-edge-sql-contract.test.mjs` (incluido arriba) | cada `enforceRateLimit` usa un scope aceptado por la base; cada `rpc()` nombra una función y argumentos que existen; las RPC del navegador son exactamente las concedidas a `authenticated` | el comportamiento de esas funciones (lo cubre el banco SQL) |
| Tipos bajo Deno | `npm run check:edge` | `deno check` (Deno 2.6.1 fijado, `deno.lock` congelado) de las 19 entradas Edge: **pasa** | ejecución bajo Deno |
| Lógica Edge bajo Deno | `npm run test:mobbex:deno` | las 37 pruebas de `mobbex-core` y `mobbex-flows` ejecutadas **bajo Deno 2.6.1** (versión fijada, lock congelado, sin permiso de red), sin cambiar una línea de las pruebas | `supabase functions serve` ni los `index.ts`; sólo Deno como runtime de la lógica |
| SQL en PostgreSQL real | `TABA_LOCAL_PAYMENT_DB=1 node scripts/mobbex/run-mobbex-db-tests.mjs --native` (o sin `--native` con Docker sano). **En CI:** job `financial_sql` (PostgreSQL 16 del runner) | libro (96 aserciones), huella de funciones preexistentes idéntica, rollback, alerta de salud (22 aserciones) con rollback byte a byte | un Supabase real: el banco nativo usa **stubs** de `pg_cron`/`pg_net`/`supabase_vault` (fixture más débil que la imagen fija); la imagen fija en Docker no se ejecuta en ningún lado |

### Deno en esta máquina

- La unidad C: no tiene espacio. `deno` descarga dependencias a `DENO_DIR`; **definirlo fuera de C:** antes de correr
  `npm run check:edge` (por ejemplo una carpeta `deno-cache` junto al repositorio). Sin eso Deno escribe en `%LOCALAPPDATA%`.
- `npm run check:edge` baja Deno con `npx deno@2.6.1` y los paquetes del lockfile; no modifica `deno.lock` (`--frozen`).
- **Hecho:** la lógica de las funciones (núcleo y flujos, 37 pruebas) también corre bajo el runtime de Deno: `npm run test:mobbex:deno`,
  en el CI. **Pendiente (no hecho):** `supabase functions serve` con los `index.ts` reales y una pila Supabase local sana
  (Docker dañado, ver `INFRA-RECOVERY.md`).

## 2. E2E sin dinero real (preparado, NO ejecutado)

Bloqueo real: **no hay cuenta ni credenciales de prueba de Mobbex** (las emite el titular, ver README §4). Hasta entonces el
recorrido de navegador no se puede completar contra el proveedor. Plan, en orden y todo en modo `test`:

1. Credenciales de **prueba** del titular como secrets del entorno local (`MOBBEX_ENABLED=true`, `MOBBEX_ENVIRONMENT=test`,
   `MOBBEX_API_KEY`, `MOBBEX_ACCESS_TOKEN`, `MOBBEX_WEBHOOK_TOKEN_SECRET` ≥ 32 caracteres). Nunca en el repo.
2. Contrato real del sandbox: `node scripts/mobbex/sandbox-contract-probe.mjs` y luego `scripts/mobbex/sandbox-pay-probe.mjs`
   (el pago aprobado necesita una persona: el checkout alojado está detrás de un desafío anti-bots). Comparar la respuesta
   *aprobada* con el fixture de `tests/mobbex-core.test.mjs`: es la única evidencia que falta sobre la forma real de la lectura.
3. Comprobar en esa misma corrida los dos puntos abiertos del README §8: una compra **en cuotas** (¿`payment.total` incluye
   financiación?) y una referencia con **un intento rechazado y luego uno aprobado** (¿qué operación es la principal?).
4. Navegador: comercio de prueba con `configure_mobbex_business(..., 'test', ...)`, Mobbex visible en el checkout, pago con
   tarjeta de prueba, vuelta a `pago/mobbex/`, pedido creado una sola vez, carrito limpio sólo con `completed` del servidor.
5. Casos negativos en navegador: volver sin pagar, cerrar la pestaña y reabrir, doble clic en «Pagar», reintento con otra tarjeta.
6. Con `MOBBEX_ENABLED` distinto de `true` la opción debe desaparecer sin recargar datos del comercio.

Criterio de salida: ningún paso mueve dinero real (credenciales y tarjetas de prueba), y los puntos 2 y 3 quedan con evidencia escrita.

## 3. Programar la conciliación

`deploy/mobbex/mobbex-worker-cron.template.sql` **está preparado y no se despliega**: no está en `supabase/migrations`, crear su función
no programa nada y la línea de `cron.schedule` está comentada. Antes de activarlo, quien despliega debe:

1. Tener en Vault `taba_payment_worker_hmac_secret` (el mismo de Mercado Pago) y `taba_mobbex_worker_url`
   (`https://<proyecto>.supabase.co/functions/v1/mobbex-worker`).
2. Confirmar que `PAYMENT_WORKER_SECRET` del entorno es ese mismo secreto.
3. Aplicar la plantilla y, **sólo cuando se decida habilitar Mobbex**, ejecutar la línea comentada de `cron.schedule`.

Trampa conocida (cubierta por `tests/mobbex-worker-cron-template.test.mjs`): el validador de firma del worker ata el manifiesto a la ruta
canónica de `mercadopago-payment-worker`, sea cual sea la función llamada. Firmar con la ruta de `mobbex-worker` produce 401 silencioso.

## 4. Habilitar la alerta de salud (cuando se quiera)

```sql
select public.set_mobbex_health_alert('<id del comercio>', true);   -- rol de servicio
select public.set_mobbex_health_alert('<id del comercio>', false);  -- apagarla
```

Por defecto está apagada y la reconciliación de alertas del panel se comporta igual que sin la migración. Con ella encendida el panel
muestra `MOBBEX_PAID_WITHOUT_ORDER` (crítica), `MOBBEX_PAYMENT_NEEDS_REVIEW` y `MOBBEX_RECONCILIATION_STUCK`, con el ciclo
reconocida → resuelta y auto-resolución cuando la condición desaparece. La evidencia es sólo un conteo y códigos de motivo.
