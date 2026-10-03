# TABA2 Mercado Pago — plan de migraciones remotas de staging

Fecha de consulta y dry-run: 2026-08-03 (America/Buenos_Aires)

Estado: **AUDITADO / NO APLICADO**. El proyecto remoto continúa con 26 migraciones. No se desplegó SQL, Edge Functions, secretos ni frontend.

## Destino autorizado

- Proyecto: `la-taba-staging`
- Project ref verificado: `ukxqbgswjlibmnjemrzd`
- Estado observado: `ACTIVE_HEALTHY`
- PostgreSQL observado: 17.6.1.147
- Producción: fuera de alcance; no se usó ningún ref productivo.

## Historia remota antes del cambio — 26

| # | Versión remota |
|---:|---|
| 1 | `20260531030000` |
| 2 | `20260531040000` |
| 3 | `20260601205707` |
| 4 | `20260725030000` |
| 5 | `20260725050000` |
| 6 | `20260725060000` |
| 7 | `20260725070000` |
| 8 | `20260725080000` |
| 9 | `20260725090000` |
| 10 | `20260725100000` |
| 11 | `20260725110000` |
| 12 | `20260725120000` |
| 13 | `20260725130000` |
| 14 | `20260728090000` |
| 15 | `20260729150000` |
| 16 | `20260729190000` |
| 17 | `20260729203000` |
| 18 | `20260731230000` |
| 19 | `20260731231000` |
| 20 | `20260801020000` |
| 21 | `20260801040000` |
| 22 | `20260802100000` |
| 23 | `20260802101000` |
| 24 | `20260802102000` |
| 25 | `20260802103000` |
| 26 | `20260802104000` |

Las 26 versiones tienen fuente local versionada en el release. `20260801040000` fue recuperada con `supabase migration fetch`, comparada con su fuente histórica y versionada sin modificar el SQL remoto. Las cinco versiones `2026080210…` son las correcciones Rider certificadas.

## Historia local integrada — 30

- 26 versiones que coinciden con la historia remota.
- 3 migraciones Mercado Pago provenientes de la implementación auditada.
- 1 migración incremental del scheduler de staging.
- 0 migraciones fiscales `2026080216…`, `2026080217…` o `20260802171000`.

## Pendientes exactas y orden de aplicación

El dry-run con inclusión histórica enumeró únicamente estas cuatro migraciones, en este orden:

| Orden | Migración | Superficie principal |
|---:|---|---|
| 1 | `20260802090000_mercadopago_checkout_pro_foundation.sql` | `products.price_status`; settings; checkout sessions/items; reservas; intents/attempts/events/receipts; refunds/cancelaciones/disputas; outbox; RLS, policies, grants y RPC de creación/consulta. |
| 2 | `20260802093000_mercadopago_checkout_pro_lifecycle.sql` | liberación/re-adquisición de reservas; preference; receipt; leases/worker; snapshots verificados; finalización exactly-once; reconciliación; refunds/cancelaciones; panel. |
| 3 | `20260802094000_mercadopago_rate_limits.sql` | buckets server-only y RPC de rate limit. |
| 4 | `20260803120000_mercadopago_staging_worker_scheduler.sql` | `pg_cron`, `pg_net`, Vault, HMAC del worker, kick tras outbox, recuperación cada 30 s y alertas operativas. |

No aparecieron seeds, roles, migraciones Rider nuevas, migraciones fiscales ni otros cambios inesperados.

## Resultado de los dry-runs

1. `supabase db push --dry-run` — **rechazo esperado**, 5.735 s. La CLI detectó que las tres migraciones Mercado Pago son anteriores al último timestamp Rider remoto y exigió inclusión histórica explícita. No hubo cambios.
2. `supabase db push --dry-run --include-all` — **PASS**, 4.301 s. Enumeró exactamente las cuatro migraciones de la tabla anterior; `seeds=[]` y `roles=[]`. No hubo cambios.
3. `supabase migration list --linked` posterior — el remoto siguió mostrando 26 versiones; las cuatro permanecen sólo locales.

El dry-run mide conexión, lectura de historia y planificación, no ejecuta DDL y por lo tanto no puede certificar una duración real de aplicación. La única base cuantitativa comprobada es 4.301 s para el control plane. El catálogo remoto observado tiene 9 filas en `public.products` (48 kB de tabla), por lo que el `UPDATE` de clasificación inicial es pequeño, pero no se convierte esa observación en un SLA. Se reserva una ventana operativa conservadora de 15 minutos para preflight, DDL, verificación y eventual forward-fix; la duración real se medirá durante staging.

## Locks y tablas afectadas

- `public.products`: `ALTER TABLE` para `price_status`, `UPDATE` de las 9 filas observadas, default, `NOT NULL` y check. Los `ALTER` requieren lock fuerte y el `UPDATE` toma locks de fila. No cambia `price`, imágenes ni catálogo comercial.
- `public.businesses`, `public.products`, `public.orders` y `auth.users`: locks de catálogo/referencia al crear foreign keys desde tablas nuevas.
- Tablas nuevas de pagos: locks DDL propios al crear tablas, índices, RLS, policies, triggers y grants; no existe backfill remoto de pagos.
- Catálogos de extensiones/cron: locks breves al habilitar `pg_cron`, `pg_net` y Vault y registrar el job.
- `public.payment_outbox`: trigger de kick y funciones de scheduler, creada por la primera migración.

Preflight obligatorio inmediato antes de aplicar: revisar `supabase inspect db locks`, blocking queries y long-running queries; abortar si existe contención no explicada.

## Configuración segura del scheduler

- `MERCADOPAGO_ACCESS_TOKEN` y `MERCADOPAGO_WEBHOOK_SECRET` permanecen exclusivamente como secretos de Edge Functions; nunca entran en SQL ni Vault.
- `PAYMENT_WORKER_SECRET` es independiente de Mercado Pago. Debe existir como secreto Edge y la misma clave debe guardarse cifrada en Vault bajo `taba_payment_worker_hmac_secret`.
- La URL exacta del worker se guarda bajo `taba_payment_worker_url` y debe apuntar al ref staging autorizado.
- `pg_net` transporta timestamp, nonce y firma HMAC; no transporta el secreto compartido.
- Si faltan ambas entradas Vault, el scheduler es fail-closed y no hace solicitudes.

## Procedimiento de aplicación forward-only

Condiciones previas, todas obligatorias:

1. aplicación TABA2 y cuenta vendedora autorizada verificadas;
2. sólo Access Token test y Webhook secret test disponibles;
3. dominio HTTPS de staging separado y estable;
4. Edge secrets preparados con `MERCADOPAGO_ENVIRONMENT=test`;
5. bundle público y configuración sin secretos;
6. base, Node y tres navegadores verdes;
7. locks remotos sin contención;
8. repetir `migration list` y ambos dry-runs; el conjunto debe seguir siendo exactamente cuatro.

Aplicación prevista:

1. registrar hora, HEAD y estado Git limpio;
2. ejecutar `supabase db push --include-all` contra el worktree enlazado explícitamente a `ukxqbgswjlibmnjemrzd`;
3. no usar `--include-all` si la lista previa cambia;
4. verificar que la historia remota pasa de 26 a 30 y conserva las 26 originales;
5. verificar tablas, constraints, RLS, grants, RPC, extensiones y cron;
6. desplegar las Edge Functions sólo después del SQL y cargar únicamente secretos test;
7. configurar las dos entradas Vault sin imprimir sus valores;
8. probar el worker firmado y recién entonces habilitar la configuración no secreta del comercio en ambiente test.

## Rollback operativo

No se editará ni eliminará una migración aplicada. Ante defecto después de aplicar:

1. mantener `business_payment_settings.enabled=false`;
2. desprogramar o desactivar el job con `cron.unschedule` mediante una migración incremental;
3. deshabilitar el trigger de kick mediante migración incremental si fuera necesario;
4. retirar o corregir Edge Functions sin borrar receipts, intents, eventos ni auditoría;
5. liberar reservas sintéticas exactamente una vez con las RPC previstas;
6. preservar tablas de auditoría y no borrar pedidos legítimos;
7. corregir esquema/funciones sólo mediante una migración forward-fix con timestamp nuevo;
8. repetir RLS, grants, exactly-once, cleanup y reconciliación.

No se propone `DROP TABLE`, reescritura de historia, `migration repair`, reset, restore destructivo ni rollback de datos como operación normal.

## Bloqueos actuales

- No hay aplicación Mercado Pago/cuenta vendedora verificadas desde una sesión autorizada.
- Supabase staging no contiene secretos custom de Mercado Pago ni del worker.
- El único dominio Pages observado está en demo fail-closed y no está conectado al ref staging; no se identificó un dominio HTTPS de staging separado.
- Docker Desktop no respondió a `docker ps` dentro del timeout del host; el SQL nuevo aún no se ejecutó sobre PostgreSQL local. El dry-run remoto sí pasó, pero no sustituye la aplicación local/remota controlada.

Por estos bloqueos, este plan **no autoriza todavía** `db push`, despliegue de Functions ni configuración del Webhook.
