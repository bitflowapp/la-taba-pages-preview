# Supabase QA actualizado y Mercado Pago preparado — 22/10/2026

Proyecto `ixewllzzuzpqrkxzmfzx` (org. Free). Sin producción, sin cuentas ajenas, sin pagos, reembolsos ni OAuth.
La salida cruda (respaldo cifrado, recibos, claves) queda fuera del repositorio. **Se mantienen NO-GO de
producción y NO-GO comercial.**

## Acceso

El acceso local (API de gestión con el token del CLI, receta `deploy/recovery-free-hosted.json`) funcionó: proyecto y
organización verificados, rol `postgres`. La denegación del conector de GPT-6.1 no se reprodujo por este canal.

## Migración y función

| Paso | Resultado |
|---|---|
| Antes | 169 migraciones (ledger estándar = ledger de recuperación); `ordering_verified_by` y `products.verified_by` en `ON DELETE SET NULL`; 0 negocios con configuración inválida |
| Respaldo | `pg_dump` cifrado AES-GCM + roles, fuera del repo; ida y vuelta, SHA-256 y TOC (4.354 entradas) correctos; restaurado en PostgreSQL local aislado: 7 usuarios, 3 negocios, 3 productos, 6 pedidos, 1 negocio verificado, 3 productos con verificador, idénticos a QA |
| Defecto reproducido | Sobre esa copia, borrar el verificador falla con `23514` (`products_verified_master_data`) |
| Ensayo | Local sobre la copia (pasa a `23503`) y alojado con rollback (`passed_and_rolled_back`, nada persistió) |
| Aplicación | `sync-hosted --migrations --apply`: 1 migración `20261022233526`, sha256 `dcf2cd84…090ac9`; ledgers 170/170 |
| Verificación | Ambas FK `ON DELETE RESTRICT`, validadas; índices parciales `businesses_ordering_verified_by_idx` y `products_verified_by_idx`; CHECK originales intactos; datos y conteos sin cambios |
| Edge | Solo `catalog-image-manager` v5→v6; las otras 12 sin cambios; 13/13 activas |

El runner pausó los 6 cron ~2 s. Se reactivaron de inmediato los 5 que estaban activos
(`checkout-expiry-sweep`, `checkout-provider-truth-sweep`, `operational-alerts-sweep`, `payment-outbox-worker`,
`qa-window-expiry`); `security-retention-sweep` sigue apagado. 60 min posteriores: 0 fallas.

## Pruebas

- **Alojado, con datos propios y limpieza**: simulacro de recuperación (1 pedido, stock una vez, reintento con backoff)
  y de cambios tardíos (pendiente vencido → hallazgo visible + alerta CRITICAL, lease vencido recuperado). Cron + Vault +
  HMAC + worker reales, proveedor simulado. Quedaron 0 alertas, 0 discrepancias, 0 trabajos en cola.
- **Alojado, SQL**: 6 suites MP (rollback) y asesores de seguridad (0 errores).
- **Alojado, escenarios financieros en transacción con rollback** (mismos escenarios de `tests/db`): 89/89 (forensic 26,
  p0 19, p1 25, contratos astra2 17, efectivo 2). La suite p2 no se ejecutó en alojado: inserta secretos en el Vault.
- **API alojada**: 18/18 (un fallo aislado de «Realtime delivers database change» en la 1.ª corrida; 2 repeticiones 18/18).
- **Aislamiento**: 15/15; **gestor de imágenes** autenticado: `list` 200 en el negocio propio, 403 cruzado, sin cambios.
- **Local**: 12/12 SQL afectadas (con plantilla de 170 migraciones; una plantilla vieja da 6 falsos fallos), 63/63 JS.
- `npm run check:edge` no pudo repetirse (falló la descarga de JSR); no cambió código.
- Efectivo: disponible en el negocio QA (retiro, 3 productos con stock); circuito verificado con rollback. No se creó pedido.

## Preview

`1c8d0635` / `v159`: 375/375 archivos idénticos, 16/16 controles de la puerta, panel 8/8. No se republicó.

## Mercado Pago: estado y herramientas

Estado: vendedor `disconnected`, ambiente `test`; sin intents ni recibos; checkout MP no disponible por diseño hasta
vincular vendedor; webhook devuelve 503 en los 6 casos falsos (fail-closed) porque falta
`MERCADOPAGO_OAUTH_WEBHOOK_SECRET`. Preflight: `serverConfigurationReady=false`, 2 pasos humanos pendientes.

Las tres herramientas se validaron contra el código actual (nombre del secreto, acciones de `mercadopago-connect`,
confirmaciones de refund/cancel, lista blanca de `create_checkout_session`, RPC de ventana QA, selectores del panel):
compatibles. `qa-panel-connect.mjs --status-only` y `qa-mp-e2e.mjs counts|status|activation|forged-webhooks` se
ejecutaron sin efectos.

## Pasos humanos para la ronda auténtica

1. Titular de la app 2691240967769590 (MFA): registrar en el panel de MP la redirección OAuth exacta
   `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback` y activar PKCE.
2. Mismo titular: configurar el webhook `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-webhook`
   (solo pagos) y copiar la firma al portapapeles, sin pegarla en chat.
3. Autorizar escribir ese secreto en QA: `node scripts/recovery/store-webhook-secret-from-clipboard.mjs`.
4. `node scripts/recovery/qa-mp-e2e.mjs forged-webhooks`: debe dar 6×401.
5. Autorizar OAuth con un vendedor de **prueba**: `qa-panel-connect.mjs`; el titular consiente en su navegador.
6. Autorizar compras de prueba y devoluciones por caso (RUNBOOK, tabla de casos).
