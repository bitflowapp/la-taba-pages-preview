# TABA checkout-profile migration log

Generated: 2026-07-30
Worktree: C:\1212\la-taba-catalog-checkout-premium
Branch: feature/catalog-checkout-premium

| Spec | Contrato anterior | Contrato nuevo | Estado | Observación |
| --- | --- | --- | --- | --- |
| tests/e2e/customer-delivery.spec.mjs | Inputs de nombre/teléfono/calle/barrio como fuente principal en checkout | Perfil sandbox + selección de dirección | Migrado | En curso previo: validaciones por modalidad y bloqueo |
| tests/e2e/customer-profile.spec.mjs | Snapshot y perfil base con campos legacy de ediciÃ³n directa | Perfil + direcciÃ³n con helpers nuevos | Migrado | Mantiene `name`, `phone`, `street`, `neighborhood` como compatibilidad de API de helper |
| tests/e2e/direct-ordering-growth.spec.mjs | Orden de checkout con flujo antiguo | Checkout unificado con direcciones persistidas | Migrado | Enfoque de crecimiento y entrega/retiro |
| tests/e2e/delivery-code.spec.mjs | Ordenes creadas por helper legacy | Ordenes via checkout real | Migrado | Corresponde al LOTE 4 |
| tests/e2e/tracking-arriving.spec.mjs | Seguimiento con pedidos de fixture legacy | Tracking con ordenes reales del checkout nuevo | Migrado | Corresponde al LOTE 4 |
| tests/e2e/tracking-terminal-expiry.spec.mjs | tracking code/expiración con setup legacy | tracking code/expiración con contrato nuevo | Migrado | Corresponde al LOTE 4 |
| tests/e2e/showcase.spec.mjs | Showcase con datos directos | Showcase reutilizando arquitectura principal y perfil sandbox | Migrado | En curso previo: retorno a checkout, direcciones y estados |
| tests/e2e/showcase-map-lifecycle.spec.mjs | Map lifecycle de showcase | Map lifecycle con arquitectura principal | Migrado | Sin cambios de producto |
| tests/e2e/business-inbox.spec.mjs | Cliente fijo "Walter Cliente"/tel 2995551234 | Cliente sintético "Cliente Demo"/2990000001 | Migrado | Alineado con contrato de checkout por Perfil |
| tests/e2e/cancel-confirmation.spec.mjs | Estado semilla legacy | Cliente sintético actual | Migrado | Alineado para contrato sandbox actual |
| tests/e2e/honesty-mode.spec.mjs | Validaciones con set de datos legacy mixtos | Mantiene algunas rutas de teléfono legacy | Parcial | Revisar estandarización de teléfonos legacy auxiliares |
| tests/e2e/realtime.spec.mjs | Estado `live` con nombres auxiliares legacy | Escenario de tracking intacto, sin migración completa | Parcial | No bloqueante: casos de integración de simulación |