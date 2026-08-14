# TABA2 — production candidate launch plan

Este documento describe únicamente la candidate local `release/taba2-production-candidate`.
No autoriza deploy, creación de Supabase production, Mercado Pago production, DNS,
staging ni merge a `main`.

## Estado de blockers MUST-BEFORE-PROD

Los cinco blockers comerciales quedan cerrados en esta candidate:

| Blocker | Estado | Evidencia local |
| --- | --- | --- |
| B1 — catálogo maestro | CLOSED | migraciones aplicadas desde cero; catálogo/stock/estado cubiertos por unit, pgTAP y E2E focal |
| B2 — configuración operativa | CLOSED | fail-closed, ventanas/roles y contrato operativo cubiertos por pgTAP |
| B3 — alta transaccional | CLOSED | RPC y ciclo de pedido cubiertos por suite local de DB, unit y E2E focal |
| B4 — idempotencia/stock | CLOSED | payment/order local DB drill, unit y E2E de doble toque/reintento |
| B5 — estados auditables | CLOSED | pgTAP, transiciones y E2E de inbox/cancelación/rider |

## DB reproducible

- Migraciones canónicas: **98**.
- Primera: `20260531030000_la_taba_phase1_orders.sql`.
- Última: `20260814060000_commercial_contract_remediation_is_private.sql`.
- Base local descartable aplicada desde cero: **PASS**, ledger `98/98`, `0 pending`.
- pgTAP: **208/208** assertions.
- Restore lógico a otra base local: **PASS**; tablas, funciones, triggers, policies, RLS,
  grants públicos críticos, extensiones y ledger compararon iguales.
- BOLA de dos tenants: **PASS**, 87/87 probes, sin lectura ni escritura privada cross-tenant.

## Release/PWA

- Identidad: `la-taba-runtime-v66-production-blockers`.
- Precache firmado: 127 archivos; digest registrado en `release-identity.json`.
- Tokens consistentes: CSS `v50`, `app.js` `v42`, `pwa-update.js` `v3`, `startup-recovery.js` `v2`.
- `npm run release:identity`: PASS, sin diff.
- Cambio de asset sin bump: rechazado por el gate en worktree descartable.
- Upgrade, degradación/recuperación y rollback están cubiertos por unit y E2E focal; no equivalen
  a prueba física de iPhone.

## Gates pendientes de esta certificación

- La corrida completa declarada por Playwright (`357 tests`) alcanzó timeout a los 300 s; no se
  declara PASS global. Los focales ejecutados sí pasaron: Chromium `39/39`, mobile WebKit `53/53`,
  Business `7/7`.
- El arnés histórico de colisiones de migraciones conserva expectativas de un snapshot de 39
  migraciones/`private` ausente; 5 assertions de conteo/huella fallan contra el estado actual de
  98. Las assertions de no duplicación, reconciliación, abort seguro y preservación del trigger pasan.
- El commit Rider solicitado `894267a` no existe en el repositorio local; no se integró la rama Rider.

## No-gates físicos

Permanecen pendientes: Chrome iPhone físico, Safari iPhone físico, Moto G15 físico, GPS físico,
dominio/DNS, catálogo comercial aprobado, Mercado Pago production, ARCA/homologación, y
aprobaciones de Walter/Opus. Este documento no los convierte en PASS.

## Decisión

**NO READY FOR GO-LIVE.** La candidate queda preparada para revisión Opus con los gates pendientes
explícitos arriba; no se despliega ni se autoriza GO-LIVE desde esta fase.
