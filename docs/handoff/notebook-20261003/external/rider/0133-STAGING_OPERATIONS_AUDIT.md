# Auditoría de operaciones activas de staging

Fecha: 2026-08-03. Lecturas remotas read-only sobre `la-taba-staging`, ref `ukxqbgswjlibmnjemrzd`, business `00000000-0000-4000-8000-000000000001`.

No se encontraron operaciones activas después de la limpieza. La auditoría inicial había encontrado exactamente cinco:

| Pedido | Estado/revisión inicial | Rider | Evidencia de origen | Actividad/GPS | Pago | Clasificación | Acción |
|---|---|---|---|---|---|---|---|
| LT-0002 | `on_the_way` / 2 | `d1c72b84-1ab5-4a0a-989f-80f6843b609f` | Lote Task 03, `demo_fixture`, `production_checkout`, cliente fixture | Último evento `2026-08-01T01:37:41Z`; 0 GPS | `cash`; sin payment separado | `CONFIRMED_SYNTHETIC_STALE_ORDER` | Cancelado por RPC; stock sin liberar por estar retirado |
| LT-0003 | `assigned` / 8 | `f9e25d87-7986-421e-a171-b3bfbf025a38` | Lote Task 03, `demo_fixture`, `production_checkout`, referencia `Fixture reversible Gate 2` | Último evento `2026-08-01T06:56:35Z`; 0 GPS | `cash`; sin payment separado | `CONFIRMED_SYNTHETIC_STALE_ORDER` | Cancelado por RPC; stock liberado |
| LT-0005 | `arrived` / 16 | `d1c72b84-1ab5-4a0a-989f-80f6843b609f` | Lote Task 03, `demo_fixture`, `production_checkout` | Último evento `tracking_access_recovered` `2026-08-01T16:31:54Z`; 47 GPS, último `2026-08-01T16:29:39Z` | `cash`; sin payment separado | `CONFIRMED_SYNTHETIC_STALE_ORDER` | Cancelado por RPC; stock sin liberar por estar retirado |
| LT-0009 | `assigned` / 7 | `f2f45193-f4f0-4370-9937-e841358cabe5` | Task 04, producto `staging_only`, request `task` | Último evento `2026-08-02T02:08:13Z`; 0 GPS | nulo; sin payment separado | `CONFIRMED_SYNTHETIC_STALE_ORDER` | Cancelado por RPC; stock liberado |
| LT-0010 | `assigned` / 7 | `f2f45193-f4f0-4370-9937-e841358cabe5` | Task 04, producto `staging_only`, request `task` | Último evento `2026-08-02T02:11:28Z`; 0 GPS | nulo; sin payment separado | `CONFIRMED_SYNTHETIC_STALE_ORDER` | Cancelado por RPC; stock liberado |

Las identidades customer, nombres/teléfonos y productos se evaluaron junto con origen, eventos, referencias QA y certificaciones históricas; no se usó la apariencia de PII como criterio único. No hubo `ACTIVE_OPERATIONAL_ORDER` ni `ORDER_PROVENANCE_UNCLEAR` en el alcance activo.

## Verificación posterior

- Pedidos activos del business: `0`.
- Cada pedido objetivo: `cancelled`; último evento canónico `order.status_changed`; GPS `0`; operaciones `0`; outbox `0`.
- Locks operativos: tuple `0`, advisory `0`, relation locks no-read `0`.
- Stock previo/posterior: Coca-Cola Original `87→88`; Bebida QA Task 04 `18→20`. No existe tabla pública de reservas.
- Rider QA original y Rider QA alternativo: membership activa `rider`; ambos sin entrega activa. Sólo el Rider QA original queda seleccionado para la próxima corrida.
