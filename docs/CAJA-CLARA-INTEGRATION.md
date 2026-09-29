# Caja Clara como terminal operativa del local

Caja Clara (POS nativo de Windows, repo `bitflowapp/bitflow-inspecciones`, carpeta `CajaClara/`) opera La Taba
desde el mostrador: bandeja de pedidos online, catálogo online, stock compartido, estado de la tienda y reparto.
El Panel web **no cambia**: la caja usa las mismas RPC y lo que hace aparece en el Panel y al revés.

## Contrato `caja-clara-taba/1`

Migración `supabase/migrations/20260929120000_caja_clara_pos_integration.sql`:

- **Identidad**: la caja entra como miembro del equipo (owner/admin/staff) con una sesión registrada
  `client = 'caja_clara_windows'` y el SHA-256 de su DeviceId. `identity_register_session` rechaza un rider o una
  sesión de Caja Clara sin hash. Las RPC `pos_*` exigen esa sesión, de ese comercio, de esa PC y no revocada
  (`private.pos_require_terminal`). Sin service_role, sin Edge Function nueva.
- **RPC** (SECURITY DEFINER, ejecutables por `authenticated`, nunca por `anon`): `pos_get_catalog_state`,
  `pos_apply_stock_movements`, `pos_apply_stock_count`, `pos_list_orders`, `pos_get_store_overview`.
- **Tablas**: `pos_stock_receipts` (recibo idempotente de cada movimiento/conteo con sesión y dispositivo) y
  `pos_stock_conflicts` (faltantes). RLS activa, sin privilegios directos para anon/authenticated.
- **Trigger** `products_pos_conflict_hold`: un producto con conflicto abierto no queda `available`.

### Stock

`products.stock` sigue siendo el disponible online. Reservado = reservas de checkout activas + ítems de pedidos en
`received/submitted/accepted/preparing/ready/assigned` sin `inventory_released_at`. Físico = disponible + reservado.
La caja manda deltas idempotentes; si un delta dejaría el disponible negativo (venta sin conexión de lo que la tienda
reservó) se aplica hasta 0, se abre el conflicto con los pedidos que retienen reserva y el producto queda retenido
hasta un conteo (`pos_apply_stock_count`, owner/admin). Reponer un producto que el comercio quiere publicado lo vuelve
a ofrecer sólo si cumple todas las compuertas (imagen, verificación, precio, alcohol).

### Pedidos

`pos_list_orders` devuelve un DTO minimizado (sin GPS ni código de entrega; teléfono y dirección sólo mientras el
pedido está activo), el estado del pago como palabra, el rider, la oferta pendiente, `stock_left_store` y
`allowed_actions` (ayuda de pantalla; la autoridad sigue siendo `change_order_status`). Cursor por `updated_at`; el
cliente relee con 30 s de solapamiento y deduplica por revisión.

## Certificación

| Prueba | Resultado |
|---|---|
| pgTAP `supabase/tests/caja_clara_pos_integration_test.sql` | 54/54 (PG17) y en CI; runner canónico 870 → 924 |
| Suites pgTAP existentes | sin regresiones (1163 OK; 5 archivos fallan igual sin la migración por límites del arnés local, no del cambio) |
| `npm run check` y `npm test` | verde, 2778/2778 |
| Rollback `docs/migrations/rollback/20260929120000_caja_clara_pos_integration.rollback.sql` | drill local: se niega con conflictos abiertos; limpio restituye `identity_register_session` idéntica (md5) y el CHECK; re-aplicar funciona |
| E2E en vivo en CONTROLLED_PRODUCTION (tenant QA) | 40/40 — `docs/evidence/controlled-production/caja-clara-e2e-cp-20260929.json` |

`scripts/controlled-production/caja-clara-e2e.mjs --agent <CajaClara.TabaAgent.dll>` usa el motor real de Caja Clara,
un cliente web anónimo, dos riders QA con las RPC del Android y el Panel como staff; limpia cada pedido QA con
`cleanupQaOrder`, restituye el stock, cierra los conflictos y deja cerrada la ventana QA. La tienda real no se toca.

## Aplicación en CONTROLLED_PRODUCTION (2026-09-29)

1. Backup + restore drill: PASS (156 migraciones, 113 tablas, 10246 filas;
   `docs/evidence/controlled-production/restore-drill-pre-cajaclara-20260929.json`).
2. `db push --linked --dry-run`: una sola migración.
3. `db push --linked`: aplicada; CP = 157 migraciones. `pos_*` sin EXECUTE para anon.
4. `opening:check`: `TECHNICAL_READY: YES` sin cambios de bloqueantes comerciales.
5. E2E 40/40 (y entrega con el Rider Android físico: PASS, `caja-clara-physical-rider-cp-20260929.json`).

Rollback: correr el archivo de rollback (se niega si hay conflictos abiertos: primero contar desde Caja Clara).

## Fuera de alcance / humano

- La cuenta de dueño de Walter (correo) para conectar la caja del local real.
- Mercado Pago del vendedor (Walter comercial, nunca Marco), ARCA producción, impresora y lector físicos, teléfono
  Rider desbloqueado para el E2E físico.
- Una sesión QA de Caja Clara quedó abierta por una corrida interrumpida (token destruido); no existe todavía una RPC
  para que el dueño revoque la sesión de otro dispositivo.
