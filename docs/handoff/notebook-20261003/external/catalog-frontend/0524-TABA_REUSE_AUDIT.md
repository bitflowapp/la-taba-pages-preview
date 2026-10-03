# Auditoría de reutilización · 4 septiembre 2026

## Fuente e integridad

`C:\1212\la-taba-pages` existe pero no es un repositorio: sólo contiene supabase/. Los comandos solicitados fallaron allí sin modificar nada. `git worktree list` desde mobile-brand-refresh localizó el repositorio principal en `C:\Users\marco\dev\la-taba-pages-preview`, remoto bitflowapp/la-taba-pages-preview. Main está en 31c900b y tiene cinco archivos modificados. Otros worktrees contienen cambios de catálogo, runtime y migraciones: no se copian ni se alteran.

Comparación por historia, no por fecha del directorio:

| Fuente | Commit | Evaluación |
|---|---|---|
| mobile-brand-refresh | 0e2e328 | Corrección móvil del 4 agosto; anterior a las integraciones comerciales. |
| main | 31c900b | Checkout MP y dirección integrados; working tree con cambios ajenos. |
| ci-release-stability | 7e31794 | Integra checkout simplificado, panel y correcciones E2E posteriores a main. |
| commercial-activation | f39b6e2 | Incluye lo anterior y compuertas comerciales de precio/foto; fuente estable seleccionada. |
| business-panel-automation | 523d3d0 | Descendiente de commercial-activation; bandeja móvil y alertas más recientes, inspeccionadas como referencia UX. |

Baseline ejecutado en commercial-activation antes de implementar: `node --import ./tests/test-bootstrap.mjs --test tests/cart.test.mjs tests/catalog-search.test.mjs tests/catalog-validator.test.mjs tests/business-order-intake.test.mjs tests/mercadopago-checkout.test.mjs tests/validators.test.mjs`: **51 pruebas, 51 correctas, 0 fallidas**, 13.59 s. No se ejecutaron smokes de producción ni scripts de escritura remota.

## Qué se reutiliza

Inventario final reproducible: `artifacts/audit/worktrees.json`, generado por `node scripts/audit-worktrees.mjs`: 110 worktrees registrados, 13 con cambios locales preservados. Auditoría de dependencias de la demo: Vite actualizado a 7.3.6; 0 vulnerabilidades reportadas por npm audit. Corrección de Windows verificada contra [aviso oficial de Vite](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff).

- `js/core/validators.js`: validadores puros de contacto/texto, copiados con trazabilidad.
- `js/business/business-order-store.js`: snapshots y protección frente a revisiones antiguas, copia literal.
- `js/core/pricing.js`: reglas de cantidad, subtotal y distinción null/cero, adaptadas sin configuración global de TABA.
- `js/core/catalog-search.js`: normalización de acentos y coincidencia de todos los términos por prefijo; se eliminan sinónimos de bebidas y litros.
- Carrito: identidad por producto ampliada a producto + variante, reconciliación de stock y validación al confirmar. Se conserva el patrón, no el grafo global de imports.
- Repositorios: separación entre dominio y persistencia. Pedidos con snapshot de líneas, request ID idempotente y revisiones. La implementación local reemplaza el repositorio de TABA, que incluye riders.
- Panel: bandeja simple, estados visibles, snapshots autoritativos y formularios táctiles. No se porta el ERP completo.
- Playwright y tests nativos Node, con puertos propios; se conservan criterios de stock, recuperación, contacto y overflow.

## Backend real de TABA

Supabase JS 2.110.8, Auth, PostgreSQL con RLS/RPC, Realtime y Storage. Tablas principales verificadas en migraciones/repositorios: businesses, business_members, products, catalog_assets, orders, order_items, order_events, customers, customer_addresses, order_public_tokens. Pedidos se crean por RPC `create_order_with_items`, transiciones por `transition_order` y `cancel_order`; catálogo consulta products y disponibilidad por `commerce_availability`. Panel usa roles del negocio y repositorios de operaciones/inventario/pagos. Snapshots y revisiones evitan duplicados o retrocesos por eventos desordenados.

Mercado Pago: Checkout Pro vía backend, `checkout_sessions`, `checkout_session_items`, `inventory_reservations`, `payment_intents`, `payment_attempts`, `payment_webhook_receipts`, `payment_events`, refunds y outbox. El navegador manda identificadores/cantidades, el servidor resuelve precios y reservas. El retorno del proveedor no prueba el pago: consulta estado del servidor y reconciliación. No es seguro copiar sólo el botón ni el runtime-config.

## Decisiones y descartes

Repositorio Git independiente sin remoto, en vez de un worktree que heredaría historial, credenciales públicas de TABA, workflows de despliegue y miles de activos ajenos. Sólo se exportan módulos explícitos; así puede convertirse en producto independiente. Ningún archivo .env/runtime-config, credencial, imagen de bebida ni workflow de TABA se copia.

Se excluyen riders, GPS/mapas, Android/Tauri, ARCA/fiscal, POS, escáner, alcohol/edad, combos de bebidas y despacho. UI nueva mobile-first: la UI existente depende de estado global y terminología de bebidas. Se reutilizan contratos y utilidades maduras, no sus dependencias accidentales.

## Modelo y migración futura

Categorías jerárquicas administrables; colecciones por flags. Productos con campos opcionales y variantes `{id, sku, attributes, price, stock}`; null significa desconocido. Origen demo/client_status separado. El catálogo local y pedidos viven en un documento versionado del navegador; el panel es una simulación explícita sin autenticación real, no un backoffice productivo.

Para conectar backend: crear proyecto Supabase nuevo; categories(parent_id), products, product_variants, product_images, orders, order_items, order_events y business_members propios; RPC transaccional que recalcule precios/reserve stock y haga idempotencia; RLS de miembros y acceso público sólo al catálogo activo; bucket de fotos con políticas de escritura de dueño; Auth y sesiones del panel. No reutilizar en bloque las migraciones de TABA. Configurar claves públicas sólo en cliente y secretos sólo en funciones. Para MP agregar test credentials, webhook firmado, idempotencia y conciliación antes de habilitar sandbox; producción requiere habilitación aparte.

## Riesgos y límites

Persistencia local no comparte datos entre dispositivos ni reemplaza un servidor; la demo sí sincroniza pestañas del mismo navegador y bloquea escrituras concurrentes con Web Locks cuando están disponibles. Cambiar a backend exige autoridad de precios y stock del lado servidor. El importador nunca publica OCR sin revisión; una captura sin recorte aprobado no sale al sitio. No hay material del cliente preinstalado. Pago coordinado funciona sin MP. Los tests existentes son baseline parcial de TABA, no certificación global de producción.
