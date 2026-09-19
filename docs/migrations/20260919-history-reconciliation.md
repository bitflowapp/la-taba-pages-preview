# Reconciliación del historial de migraciones — 2026-09-19

La reconciliación es de artefactos. No requiere `migration repair`, borrado de
historial ni renumeración.

| Versión | Staging | Producción | Artefacto local recuperado | Origen Git | SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `20260913011340` | Aplicada | Aplicada | `20260913011340_commerce_v3_product_draft_details.sql` | `f00edbc384b5ae20d46183b03f9c41887ac89b9b` | `a0cf556b75964f3a4bc258816ed11590d628e5dce16c18ab24e2af6bdfcbf161` |
| `20260918010000` | Ausente | Aplicada | `20260918010000_merchant_availability_separate_from_stock.sql` | `b9d8866c5deac35b4750cb14f27fa3d7bc2748d6` | `11cf34278f1667ede737b0898a3e36e3c30df1905b38900047f60729adce62b8` |
| `20260919120000` | Pendiente | Pendiente | `20260919120000_business_self_delivery_and_finished_today.sql` | PR #94 | Candidato |

Los artefactos recuperados son byte a byte iguales a sus blobs históricos.
`tests/migration-history-reconciliation.test.mjs` fija sus hashes y comprueba
que no haya versiones duplicadas. En un deploy, Supabase debe omitir las
versiones ya registradas y aplicar únicamente las pendientes para cada proyecto.

Inventario observado en modo lectura antes de esta reconciliación:

- Staging: 127 versiones; incluye `20260913011340`; no incluye
  `20260918010000` ni `20260919120000`.
- Producción: 128 versiones; incluye `20260913011340` y `20260918010000`; no
  incluye `20260919120000`.
- Candidato local anterior: 127 archivos; faltaban los dos artefactos remotos.
- Candidato reconciliado: 129 archivos, incluida la migración pendiente.
