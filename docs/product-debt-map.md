# Product Debt Map

| Área | Archivo/s | Deuda | Riesgo real | Prioridad | PR recomendado |
| --- | --- | --- | --- | --- | --- |
| Auth/PIN | `js/business.js`, `js/core/business-setup.js`, `js/core/business-config-store.js` | PIN configurable pero local y en texto plano. No hay roles ni sesión real. | Cualquier persona con acceso al dispositivo puede operar el panel. | Alta | Delivery PIN v1 + Auth Readiness v1 |
| Backend/persistencia | `js/repositories/*`, `js/state.js`, `supabase/migrations/*` | Demo local por defecto; Supabase/API opt-in sin backend obligatorio. | Pérdida de pedidos/eventos si se borra storage o cambia dispositivo. | Alta | Backend Readiness v1 |
| Storage de fotos | N/A | No existe almacenamiento de prueba visual de entrega. | Reclamos de entrega sin evidencia. | Alta | Delivery Proof Photo v1 |
| Realtime/relay | `js/realtime.js`, `js/repositories/realtime_order_repository.js` | Relay/demo útil para QA, no infraestructura productiva garantizada. | Negocio/rider pueden quedar desincronizados. | Alta | Backend Realtime v1 |
| Offline | `js/state.js`, `js/orders.js`, `js/repositories/*` | No hay cola de eventos ni reconciliación. | Cambios de estado o entregas se pierden con mala señal. | Alta | Offline Event Queue v1 |
| Notificaciones | `js/business.js`, `js/ui.js` | Sin push ni cola de avisos; depende de pantalla abierta. | Pedidos nuevos no atendidos si el comercio no mira la pantalla. | Media | Notifications v1 |
| Privacidad | `docs/*`, `js/state.js`, `js/simulation.js` | No hay política explícita para teléfono, dirección, GPS o pruebas de entrega. | Riesgo legal/comercial al operar con datos reales. | Alta | Privacy Readiness v1 |
| Datos demo | `js/data.js`, `js/config.js`, `docs/checklist-demo-walter.md` | Productos, destinos y seed orders siguen visibles como demo. | Confusión entre datos reales y demo en un piloto. | Media | Demo Data Boundary v1 |
| Multi-comercio | `js/core/business-config-store.js`, `js/config.js`, `js/repositories/*` | Config editable pero sin tenant, slug, dominio ni separación segura. | Mezcla de datos si se intenta operar más de un comercio. | Alta | Multi-business Slug/QR v1 |
| Configuración | `js/core/business-setup.js`, `js/state.js` | Wizard guarda identidad/operación pero no valida todas las condiciones operativas reales. | Comercio mal configurado genera pedidos imposibles o contacto incorrecto. | Media | Business Setup Hardening v2 |
| Seguridad | `supabase/migrations/*`, `js/repositories/supabase_order_repository.js` | RLS documentada como demo/piloto; no hay modelo final de permisos. | Exposición o modificación indebida de pedidos reales. | Alta | Supabase Security Hardening v1 |
| Testing | `tests/*`, `tests/e2e/*` | Buena cobertura demo; faltan contratos end-to-end con backend real y fallas offline. | Bugs productivos aparecen recién en piloto. | Media | Backend Contract Tests v1 |
| UX mobile | `styles.css`, `js/ui.js`, `js/business.js`, `js/delivery.js` | Mobile demo pulido, pero faltan pruebas reales de una mano, sol, mala señal y pantalla bloqueada. | Rider/negocio no pueden operar en condiciones reales. | Media | Field QA Polish v1 |
