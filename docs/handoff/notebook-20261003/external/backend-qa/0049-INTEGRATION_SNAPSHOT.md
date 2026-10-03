# TABA2 Mercado Pago staging — snapshot de integración

Fecha de auditoría: 2026-08-03 (America/Buenos_Aires)

Estado: Fase 0 completada en modo de sólo lectura. No se creó la rama de integración, no se modificó código, no se desplegó y no se alteró staging.

## Proyecto remoto autorizado

- Proyecto: `la-taba-staging`
- Project ref verificado por Supabase CLI: `ukxqbgswjlibmnjemrzd`
- Estado observado: `ACTIVE_HEALTHY`
- PostgreSQL observado: 17.6.1.147
- Edge Functions remotas observadas: 0
- Producción: fuera de alcance y no consultada para cambios

## Worktrees auditados

| Propósito | Worktree real | Rama | HEAD | Estado | `git diff --check` |
|---|---|---|---|---|---|
| Mercado Pago local | `C:\1212\la-taba2-mercadopago-checkout` | `feature/taba2-mercadopago-checkout` | `051413a24839c9c916a457bce77cf65898041f27` | limpio | 0 |
| Rider certificado | `C:\1212\la-taba-rider-staging-certification-backend` | `fix/rider-staging-certification` | `d0b995eaa642a8c78a28a0a9d966a3bdd89b6e7b` | limpio | 0 |
| RC existente | `C:\1212\la-taba-production-rc1` | `release/taba2-production-rc1` | `d8ffc55e74857da361ecbbd86cf39e4dd873ee5b` | merge de Mercado Pago incompleto; conflictos `UU` | 2 |
| Storefront canónico de la implementación MP | `C:\1212\la-taba2-storefront-motion` | `feature/taba2-storefront-motion` | `cb3751bf8f35b1878c316e3b3ef89f88b3d99903` | limpio | 0 |
| Canal de lectura remoto | `C:\1212\la-taba-staging-pilot` | `release/taba-staging-pilot` | `ed722463a44498a9bd5d1e7b4ebdac145b89d5b5` | sólo `supabase/.temp/` no versionado | 0 |
| Staging histórico de pedidos | `C:\1212\la-taba-real-orders-staging` | `staging/real-orders-walter` | `c6270589756214eac617515248e93a8e8819190b` | cambios Rider no versionados; no se tocaron | 0 |
| Staging histórico de piloto | `C:\1212\la-taba-real-pilot-staging` | `release/taba-real-pilot-staging` | `9a99698ddbe7ef5de10c779699ca58e74f3b379a` | cambios y assets locales; no se tocaron | 0 |

El worktree RC existente contiene `MERGE_HEAD=051413a24839c9c916a457bce77cf65898041f27`. Los conflictos están en `package.json` y `js/production-operations.js`. No se ejecutó abort, reset, clean, stash, checkout, resolución ours/theirs ni modificación alguna sobre ese índice.

## Grafo y ancestros

- Merge-base Mercado Pago ↔ Rider: `c6d6a7b56df46fb6989b7e6584a165ff915de6c1`.
- Merge-base Mercado Pago ↔ RC `d8ffc55`: `cb3751bf8f35b1878c316e3b3ef89f88b3d99903`.
- Merge-base Rider ↔ RC `d8ffc55`: `d0b995eaa642a8c78a28a0a9d966a3bdd89b6e7b`.
- `d8ffc55` es merge de `5ceba0c` y `d0b995e`.
- `5ceba0c` incluye Windows/fiscal; su ancestro `7df4643c2e0bbcccb2eff435217fb43a5663c1a6` contiene storefront TABA2, catálogo y la corrección reproducible de clean-clone, sin las tres migraciones fiscales posteriores.
- `git log --graph --decorate --oneline --all` fue ejecutado completo. La implementación MP es una línea de siete commits desde `cb3751b`; Rider es una línea desde `c6d6a7b`; el RC existente une storefront, fiscal y Rider.

## Base elegida

Base de composición elegida: `7df4643c2e0bbcccb2eff435217fb43a5663c1a6` + merge explícito de `d0b995eaa642a8c78a28a0a9d966a3bdd89b6e7b`, antes de integrar Mercado Pago.

Motivos:

1. `7df4643` contiene el storefront TABA2 y corrige el baseline de clean-clone mediante outputs versionados y generación de `validation.json` en un directorio temporal; no fabrica artefactos vacíos ni hace depender el runner de archivos ignorados.
2. `d0b995e` es el HEAD Rider indicado y certificado.
3. Partir de `d8ffc55` incorporaría tres migraciones fiscales que no están entre las 26 remotas y expondría el despliegue a cambios fuera de alcance.
4. El worktree que apunta a `d8ffc55` está además ocupado por un merge conflictivo, por lo que no es una superficie segura de trabajo.
5. El merge explícito preserva ambos historiales y permite revisar el único estado remoto faltante en Git antes de pagos.

La rama y el worktree sugeridos no existían al auditar:

- Rama: `release/taba2-mercadopago-staging-rc1`
- Worktree: `C:\1212\la-taba2-mercadopago-staging-rc1`

La creación posterior falló limpiamente por falta de espacio en `C:` (0,081 GiB libres) antes de registrar un worktree. No se borró ningún dato. Se conservó la rama recién creada en `7df4643` y se materializó el worktree real en `D:\1212\la-taba2-mercadopago-staging-rc1`, unidad con espacio suficiente.

## Migraciones presentes

### Mercado Pago `051413a` — 23 locales

- 20 migraciones base hasta `20260801020000`.
- `20260802090000_mercadopago_checkout_pro_foundation.sql` — SHA-256 `02fdf8bca9db1fe494e649227a23967e870baa5f2194973fd1b5ac678644f8ea`.
- `20260802093000_mercadopago_checkout_pro_lifecycle.sql` — SHA-256 `8ca962e693f02ce8f552e72cbbd85b94c84dd9aaac5612c72df0bb4f15a71a07`.
- `20260802094000_mercadopago_rate_limits.sql` — SHA-256 `25662f1f3543a3a8011eaf79f5cf0a60bf137bb1f95ea29fb2e951f81ef15ea2`.

### Rider `d0b995e` — 25 locales

- Las mismas 20 migraciones base.
- `20260802100000_rider_delivery_server_contracts.sql`.
- `20260802101000_rider_delivery_legacy_start_revocation.sql`.
- `20260802102000_rider_delivery_legacy_claim_gps_revocation.sql`.
- `20260802103000_rider_queue_read_lock_mode.sql`.
- `20260802104000_rider_location_receipt_revision.sql`.

### RC versionado `d8ffc55` — 28 locales

- Las 25 anteriores.
- `20260802160000_business_windows_scanner_fiscal.sql`.
- `20260802170000_fiscal_document_closure.sql`.
- `20260802171000_fiscal_document_closure_hardening.sql`.

Estas tres migraciones fiscales no están aplicadas en staging según la historia remota observada y quedan excluidas del plan de despliegue de pagos.

## Migraciones remotas observadas — 26

1. `20260531030000`
2. `20260531040000`
3. `20260601205707`
4. `20260725030000`
5. `20260725050000`
6. `20260725060000`
7. `20260725070000`
8. `20260725080000`
9. `20260725090000`
10. `20260725100000`
11. `20260725110000`
12. `20260725120000`
13. `20260725130000`
14. `20260728090000`
15. `20260729150000`
16. `20260729190000`
17. `20260729203000`
18. `20260731230000`
19. `20260731231000`
20. `20260801020000`
21. `20260801040000`
22. `20260802100000`
23. `20260802101000`
24. `20260802102000`
25. `20260802103000`
26. `20260802104000`

Discrepancia crítica: `20260801040000` está aplicada remotamente pero no existe en ninguna referencia Git. Sólo se halló el archivo no versionado `C:\1212\la-taba-real-orders-staging\supabase\migrations\20260801040000_rider_gps_tracking_gate2.sql`, SHA-256 `397f2785c4d0a9ac8dcde09418cdf87a55fc88018d639fb701c4e7f580e65470`. La migración Rider `20260802104000` usa `rider_locations.order_revision`, contrato introducido por `20260801040000`; por tanto no es un artefacto prescindible. Se deberá contrastar el archivo con `supabase_migrations.schema_migrations` mediante `supabase migration fetch` en un directorio aislado antes de versionarlo en el release.

## Archivos solapados

Comparación `cb3751b..051413a` contra `cb3751b..d8ffc55`: Mercado Pago cambia 52 archivos, el RC cambia 163 y sólo se solapan cinco:

1. `js/app.js`
2. `js/production-operations.js`
3. `js/repositories/supabase_order_repository.js`
4. `package.json`
5. `styles/business.css`

`package.json` y `js/production-operations.js` ya demostraron conflictos reales en el merge incompleto ajeno. Ninguno será resuelto automáticamente.

## Funciones solapadas

- `js/app.js`: ambos lados modifican `bootstrap`/`bindEvents`; MP agrega recuperación de checkout y Rider/RC agrega inicialización operacional.
- `js/production-operations.js`: ambos lados modifican `handleProductionOperationsAction`, `resetProductionOperationsForTests`, `activateAuthorizedAccess`, `stopBusinessIntake` y `businessWorkspaceMarkup`; MP agrega pagos/refunds y Rider/RC agrega contratos operativos/Rider.
- `js/repositories/supabase_order_repository.js`: ambos lados amplían `createSupabaseOrderRepository`; MP agrega checkout/pagos y Rider agrega RPC y revisión de entrega.
- `styles/business.css`: MP agrega superficies de pagos y el RC agrega tokens/base operacional.
- `package.json`: ambos lados agregan o cambian scripts de prueba/verificación.

La resolución prevista es semántica y por contrato, con pruebas focales por archivo; no se usará `ours` ni `theirs` global.

## RPC solapadas

Se extrajeron las funciones SQL añadidas por ambos lados:

- Mercado Pago: 34 funciones/RPC nuevas.
- RC/Rider/fiscal: 54 funciones/RPC nuevas.
- Colisiones por nombre: 0.

Sí existen superficies de datos compartidas que exigen prueba transaccional: `businesses`, `business_members`, `products`, `orders`, `order_items`, `order_events`, stock/inventario y tracking. La finalización de pagos debe componer con las revisiones monotónicas y no invocar rutas Rider legadas revocadas.

## Riesgos de integración

1. Merge ajeno incompleto en `C:\1212\la-taba-production-rc1`; no debe reutilizarse ni alterarse.
2. Migración remota `20260801040000` ausente de Git; aplicar desde una copia no verificada rompería la trazabilidad.
3. Las tres migraciones MP tienen versiones menores que el último registro remoto; el dry run debe usar el modo explícito de inclusión histórica y demostrar exactamente qué aplicaría.
4. Las tres migraciones fiscales del RC no están remotas y no deben entrar en el push de pagos.
5. Conflictos semánticos en el panel operativo, repositorio Supabase, scripts y bootstrap.
6. Staging no tiene Edge Functions desplegadas; ningún flujo remoto de pagos existe todavía.
7. No se verificaron aún aplicación Mercado Pago, cuenta vendedora, credenciales test, Webhook secret ni dominio HTTPS.
8. WebKit y Firefox no están certificados en el baseline informado; el release no puede desplegarse hasta 149/149 en cada motor.
9. El scheduler de `payment_outbox` aún requiere un disparador periódico independiente de Webhooks.
10. No se ejecutará una preferencia remota hasta verificar que todos los secrets son de prueba y que `MERCADOPAGO_ENVIRONMENT=test`.

## Plan exacto

1. Crear el worktree aislado `D:\1212\la-taba2-mercadopago-staging-rc1` y la rama `release/taba2-mercadopago-staging-rc1` desde `7df4643`, sin tocar el RC conflictivo.
2. Ejecutar baseline focal en `7df4643`; revisar commits y archivos Rider; mergear `d0b995e` preservando historial; ejecutar suites Rider/PostgreSQL y `git diff --check`.
3. Usar un directorio temporal aislado y el link staging autorizado para `supabase migration fetch`; comparar hash y contenido de `20260801040000`; abortar ante cualquier divergencia; versionar sólo la fuente remota verificada.
4. Confirmar que el árbol base resultante tiene exactamente las 26 migraciones remotas y ninguna fiscal pendiente.
5. Ejecutar las 688 pruebas Node y cerrar Chromium/WebKit/Firefox 149/149 antes de Mercado Pago. La corrección `7df4643` será validada, no asumida.
6. Integrar los siete commits Mercado Pago en orden, revisando antes de cada operación commits, archivos, migraciones y pruebas focales. Resolver manualmente los cinco archivos solapados.
7. Añadir scheduler durable de `payment_outbox` y defectos de staging sólo mediante migraciones/commits incrementales.
8. Investigar exclusivamente documentación oficial vigente de Mercado Pago Argentina y verificar aplicación/cuenta. Detenerse únicamente ante login, MFA, CAPTCHA, identidad o aceptación humana.
9. Resolver dominio HTTPS de staging; configurar sólo credenciales test en Supabase secret manager; comprobar bundles y logs.
10. Generar `REMOTE_MIGRATION_PLAN.md`; ejecutar dry run contra `ukxqbgswjlibmnjemrzd`; abortar si lista algo distinto de las tres migraciones MP y las migraciones incrementales de staging explícitamente aprobadas.
11. Desplegar sólo staging: migraciones esperadas, Edge Functions, scheduler, frontend y configuración Webhook test.
12. Certificar firma, receipt, outbox, API verification, estados, exactly-once, stock, pedido, panel, refunds test, disputes simuladas, Rider y contrato fiscal sin ARCA.
13. Ejecutar métricas, observabilidad, cleanup, todos los gates, secret scan, dependency audit, release hygiene y commits locales pequeños. No hacer push.

## Condiciones de aborto antes del despliegue

- `project ref` distinto de `ukxqbgswjlibmnjemrzd`.
- Divergencia entre la fuente remota y local de `20260801040000`.
- Dry run con migraciones fiscales o cualquier versión no enumerada.
- Secret productivo o ambiente distinto de `test`.
- Dominio no HTTPS/estable.
- Cualquier suite base o cross-browser con fallos.
- Falta de aplicación/cuenta vendedora autorizada o intervención humana pendiente.

## Observaciones posteriores al snapshot inicial

- Mientras se preparaba el worktree aislado, otra operación externa a esta tarea completó el merge del RC ajeno: `release/taba2-production-rc1` avanzó primero a `b4da753` (`merge(rc): integrate Mercado Pago Checkout Pro`) y luego a `e8a2591` (`test(rc): apply integrated migrations in isolated Supabase clone`). El worktree quedó limpio. No se usó ni modificó; sigue excluido porque contiene las tres migraciones fiscales no remotas.
- El merge Rider se realizó en el release aislado como `a1fcbfd`, después de `npm run check`, 675/675 Node en la base, 9/9 pruebas focales de catálogo y 12/12 pruebas Rider.
- `supabase migration fetch --linked` se ejecutó en el worktree temporal aislado `D:\1212\la-taba-migration-fetch-audit`. Las primeras 21 migraciones son equivalentes a las fuentes locales salvo separación de sentencias. Las cinco Rider difieren sólo por un `;` vacío que agrega la serialización del historial; no hay cambio SQL.
- `20260801040000_rider_gps_tracking_gate2.sql` coincide exactamente con la fuente histórica después de preservar UTF-8 y CRLF: SHA-256 `397f2785c4d0a9ac8dcde09418cdf87a55fc88018d639fb701c4e7f580e65470`. Se incorporó al release en `cb855e5` sin modificar versiones aplicadas.
