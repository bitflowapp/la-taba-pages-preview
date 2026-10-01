# La Taba — Estado actual del backend de e-commerce (baseline de auditoría, Fase 1)

## 1. Encabezado

| Dato | Valor |
|---|---|
| Fecha | 2026-10-01 (snapshots de configuración viva tomados ~16:20Z) |
| Alcance | Estado del backend de e-commerce EN EL BASELINE de la auditoría, antes de cualquier corrección de esta misión |
| Repo | HEAD `2c7ed87` (PR #130, CI verde, corrida 36806761176); `main` `1358188`; `release/taba-controlled-production` `4e215da` |
| Migraciones | Repo 158 = ledger de Staging 158; ledger de CP 157 (falta `20261001010000`) |
| Web | CP sirve `9fae988` (runtime v131) |
| Edge Functions | Repo 13. Staging 10 (faltan `catalog-image-manager`, `print-agent-gateway`, `team-invitation`; `fiscal-artifact-access` está desactualizada: v6 del 2026-09-18 con `verify_jwt=false`). CP 13. Las 9 `mercadopago-*` tienen hash de bundle idéntico en Staging y CP y su fuente no cambió desde la prueba de paridad de CP |
| Última certificación de Staging | Corrida `TABA_E2E_CERT_20261001022224`, pedido LT-0074, 164/164, sólo pipeline de pago manual. Informe: `artifacts/taba-e2e-cert-20261001-022224/final-report.md` |
| Auth (Staging y CP) | Altas anónimas habilitadas, 30 altas anónimas por hora por IP, captcha deshabilitado |
| Headers medidos en Staging | PostgREST recibe `cf-connecting-ip` (no falsificable: uno falso recibe HTTP 403 de Cloudflare), `x-forwarded-for` (primer salto falsificable por el cliente) y `sb-forwarded-for` (falsificable) |

**Entornos.** "Staging" es el proyecto de pruebas. "CP" es CONTROLLED_PRODUCTION, el entorno de la tienda real. En CP el negocio real (slug `la-taba-cp`) está cerrado: 46 productos, 0 disponibles, 0 zonas, 0 filas de horario, sin vendedor de Mercado Pago. CP tiene además dos tenants QA no públicos (`qa-control-cp`, `qa-aislamiento-cp`).

**Cómo se auditó.**

- 12 lectores, uno por área (inventory, pricing_snapshot, checkout, orders_abuse, lifecycle_cancel, payments_db, mp_edge, hours_delivery, security_rls, observability, catalog_pipeline, tests_tooling), leyeron las definiciones VIVAS de una base PG17 local con las 158 migraciones aplicadas, más el código de Edge Functions, cliente web, scripts y tests. Produjeron 128 hallazgos brutos.
- Verificación adversarial: 38 hallazgos, de 8 de los 12 lectores, pasaron por un verificador independiente que intentó refutarlos y los reprodujo en bases privadas PG17 con shims (158/158 migraciones, descartadas al terminar) o en un harness local sin red. Los 38 veredictos dieron `real=true` y `reproduced=true`; 4 cambiaron la severidad del lector y casi todos corrigieron algún detalle del reclamo. Los hallazgos de mp_edge, security_rls, catalog_pipeline y lifecycle_cancel no tienen veredicto propio.
- Nada de esto tocó Staging ni CP, salvo las lecturas de configuración de los snapshots. El repo no se modificó.

**Límites del método.**

- Los lectores no ejecutaron las suites del repo: "probado local" significa que el test existe y se leyó. Las excepciones medidas: el lector de tooling corrió 8 archivos de tests unitarios (35/35), y el verificador de BE-48 corrió los 32 archivos pgTAP canónicos sobre PG17 con shims: 916 de 936 tal cual, 936/936 sólo después de cargar a mano el fixture fiscal heredado que CI carga solo.
- La base local corre como superusuario con shims de auth, storage, cron, net y vault; CI aplica las migraciones como rol no superusuario (ver BE-48).
- El código TypeScript de las Edge Functions se verificó por lectura; el comportamiento real de Mercado Pago (reintento dentro de una preferencia, reenvío de notificaciones) no se pudo ejecutar sin red.

**Convenciones.**

- Severidad: P1, P2, P3. Ningún lector ni verificador clasificó un hallazgo como P0. Cuando hay veredicto, vale la severidad del veredicto.
- Verificación: **REPRODUCIDO** = un verificador lo ejecutó (veredicto propio, alias de un hallazgo reproducido, o comportamiento observado dentro del veredicto de otro hallazgo, que se nombra). **VERIFICADO POR LECTURA** = un verificador distinto del lector confirmó el mecanismo leyendo el código, sin ejecutarlo. **NO VERIFICADO** = sólo existe la lectura del lector.
- Ids: `BE-nn` es el id canónico deduplicado (sección 4). Entre paréntesis van los ids de lector. Dos lectores usaron la misma numeración: `orders_abuse/F1..F7` y `hours_delivery/F-01..F-12`.
- Los hallazgos de pruebas y herramientas que no pertenecen a un dominio figuran en la sección 4 con dominio TRANSVERSAL.

## 2. Tabla resumen por dominio

| Dominio | IMPLEMENTED | TESTED_LOCAL | TESTED_STAGING | PRODUCTION_CONFIGURED | BLOCKED |
|---|---|---|---|---|---|
| CATALOG | PARTIAL | PARTIAL | NO | PARTIAL | Planilla del dueño sin completar |
| PRODUCTS | YES | YES | PARTIAL | PARTIAL | 0 de 46 productos publicados |
| PRICING | YES | PARTIAL | PARTIAL | NO | Precios y envío sin cargar |
| STOCK | YES | PARTIAL | PARTIAL | NO | BE-07; stock sin contar |
| RESERVATIONS | PARTIAL | PARTIAL | PARTIAL | NO | BE-01 y BE-04 abiertos |
| CHECKOUT | YES | PARTIAL | PARTIAL | NO | BE-02; tienda sin verificar |
| ORDERS | YES | PARTIAL | PARTIAL | NO | BE-01 y BE-05 abiertos |
| ORDER_ITEMS | PARTIAL | PARTIAL | PARTIAL | YES | NO |
| PAYMENTS | YES | PARTIAL | PARTIAL | NO | Sin vendedor MP; P1 abiertos |
| REFUNDS | YES | PARTIAL | NO | NO | BE-06; sandbox MP con humanos |
| DELIVERY | YES | YES | PARTIAL | NO | Sin repartidores; falta migración 20261001010000 |
| PICKUP | YES | PARTIAL | PARTIAL | NO | Retiro deshabilitado en CP |
| SERVICE_HOURS | YES | PARTIAL | NO | NO | Horarios sin cargar; BE-10 |
| DELIVERY_ZONES | YES | NO | PARTIAL | NO | Zonas y tarifas sin cargar |
| CUSTOMERS | YES | YES | YES | YES | NO |
| AUTH | YES | YES | PARTIAL | PARTIAL | Equipo sin cargar (sólo owner) |
| RLS | YES | YES | YES | YES | NO |
| RATE_LIMITING | PARTIAL | NO | NO | PARTIAL | BE-01 y BE-02 abiertos |
| WEBHOOKS | PARTIAL | PARTIAL | PARTIAL | PARTIAL | Sandbox MP con cuentas humanas |
| IDEMPOTENCY | YES | PARTIAL | PARTIAL | YES | NO |
| EVENTS | PARTIAL | PARTIAL | PARTIAL | YES | NO |
| OBSERVABILITY | PARTIAL | PARTIAL | NO | PARTIAL | NO |

**Cómo leer la tabla.**

- IMPLEMENTED = existen los objetos y el contrato principal; PARTIAL cuando falta una parte del contrato (detalle en la sección del dominio).
- TESTED_LOCAL = hay tests en el repo (pgTAP, SQL local, node, Deno). TESTED_STAGING = YES sólo si la certificación 164/164 o un runner de Staging con evidencia en los insumos cubrió el contrato principal del dominio; PARTIAL cuando cubrió sólo el camino manual de un dominio que incluye Mercado Pago, o sólo una parte. Los huecos puntuales figuran en "Probado" de cada dominio.
- PRODUCTION_CONFIGURED se refiere al negocio real `la-taba-cp` según el snapshot de CP. En los dominios sin configuración por negocio (ORDER_ITEMS, CUSTOMERS, RLS, IDEMPOTENCY, EVENTS) YES significa que el esquema está desplegado en CP (ledger 157) y no necesita datos del dueño.
- BLOCKED nombra el bloqueo principal: un hallazgo P1 abierto o un insumo externo. NO significa que la auditoría no encontró un bloqueo propio del dominio, no que el dominio esté libre de hallazgos.

## 3. Estado por dominio

### 3.1 CATALOG

- **Qué existe.**
  - Planilla comercial: `apply_commercial_catalog_plan(p_business_id, p_creates, p_updates)`, que delega las actualizaciones en `apply_commercial_catalog_batch(p_business_id, p_rows)`; helper `commercial_catalog_parse_stock`; scripts `scripts/import-commercial-catalog.mjs` y `scripts/controlled-production/opening-publish.mjs` / `opening-dry-run.mjs`. Una sola transacción, todo o nada, sólo owner/admin, hasta 500 altas y 500 actualizaciones; rechaza en el servidor SKU con aspecto de QA y packs de compra.
  - CSV técnico de 21 columnas: `import_catalog_batch` (`register_catalog_assets` + `stage_catalog_products`); scripts `scripts/import-product-catalog.mjs` e `import-pilot-catalog.mjs`.
  - Import puntual de CP: `catalog_admin.import_pending_catalog` (sólo `postgres`, exactamente 46 filas, negocio cerrado). Crea borradores con precio 0 / `pending`, stock NULL y `merchant_available=false`.
  - Borradores escaneados: tabla `catalog_product_drafts`; `create_catalog_product_draft`, `create_manual_catalog_product_draft`, `save_catalog_product_draft_details`, `bind_catalog_product_draft_code`, `publish_catalog_product_draft`, `complete_scanned_product`; trigger `commerce_v3_guard_weight_draft` (función `guard_variable_weight_draft_publication`).
  - Imágenes: `catalog_image_uploads`, `catalog_assets`, `complete_catalog_image_upload`, `approve_catalog_image_upload`, `reject_catalog_image_upload` (aprobación sólo service_role), `product_commercial_image_valid`.
  - Apertura: `get_store_opening_readiness(p_business_id, p_min_products)` (JSON con 18 códigos de ítem), `platform_verify_business_ordering` / `platform_revoke_business_ordering` (sólo service_role, auditadas en `business_config_audit`), `get_business_opening_status` (heredada).
  - Gates por script: `opening:check`, `opening:readiness`, `opening:dry-run`, `opening:publish`, `opening:approve` (apuntan a CP); `catalog:release:ci`, `catalog:release:validate`; `vender:listo` y `commercial:gate` (apuntan al proyecto de producción heredado, no a CP).
- **Estados.** `catalog_product_drafts.status`: pending_review → approved (`publish_catalog_product_draft`); rejected y merged no tienen RPC. `catalog_image_uploads.status`: pending → approved / rejected. Gate de pedidos del negocio: sin verificar → verificado y habilitado (`platform_verify_business_ordering`) → revocado; `ordering_verified` no tiene camino de escritura para personas.
- **Probado.** pgTAP: `supabase/tests/alta_propuesta_comercial_test.sql` (44), `store_opening_readiness_test.sql` (84), `catalog_image_storage_test.sql` (19), `optional_product_assets_test.sql` (14), `gondola_beverage_taxonomy_test.sql` (20). Node: `tests/commercial-catalog-onboarding.test.mjs` (34), `tests/commercial-import-altas.test.mjs` (14), `tests/catalog-import.test.mjs`, `tests/catalog-validator.test.mjs`, `tests/ci-catalog-release-gate.test.mjs`, `tests/catalog-release-gates.test.mjs`, `tests/pilot-preflight.test.mjs`. Certificación viva sólo en el tenant QA de CP: `scripts/controlled-production/opening-cert.mjs`. Staging: nada; el informe 164/164 declara que el catálogo no se ejercitó.
- **Qué NO está.** Rollback de un lote publicado (sin id de lote, sin imagen previa, sin fila de auditoría); clave de idempotencia del import (sólo es idempotente por valor, y el stock es una sobrescritura absoluta); registro de aprobación de catálogo; RPC para rechazar o fusionar borradores; gate único PRODUCTION_READY. Sin test: publicar un producto creado por alta, comportamiento de `publish_catalog_product_draft` y `complete_scanned_product` (sólo estático), `get_business_opening_status`, `catalog_admin.import_pending_catalog`.
- **Configuración viva.** Staging (`la-taba-staging`): 12 productos, 11 disponibles. CP `la-taba-cp`: 46 productos, 0 disponibles, `ordering_verified=false`. CP `qa-control-cp`: 8 productos, 8 disponibles.
- **Hallazgos.**
  - **BE-11** · P1 · NO VERIFICADO · No existe un gate único PRODUCTION_READY: opening:check informa TECHNICAL_READY sin comprobar paridad de migraciones, despliegue de Edge Functions, commit servido, certificación de pagos ni P0/P1 abiertos. (CAT-02)
  - **BE-46** · P2 · NO VERIFICADO · Los cambios de precio, stock y publicación del catálogo no dejan auditoría ni imagen previa: un lote confirmado no se puede revertir. (CAT-04)
  - **BE-78** · P3 · NO VERIFICADO · Las RPC de combos para anon (resolve_business_combo, list_business_combos) saltean las reglas de visibilidad del catálogo. (AUTHZ-05)
  - **BE-83** · P3 · NO VERIFICADO · El destino de validación del importador no está atado al destino de escritura, ni la vista previa confirmada al plan aplicado. (CAT-09)
  - **BE-85** · P3 · NO VERIFICADO · El runbook de apertura ordena la verificación de plataforma antes de publicar, pero el gate de la base exige productos publicados primero. (CAT-12)
  - Ver también (primarios en otro dominio): BE-07, BE-10, BE-24, BE-45, BE-47, BE-75, BE-84.

### 3.2 PRODUCTS

- **Qué existe.** Tabla `products` con invariantes validadas (ninguna NOT VALID): CHECK `products_available_requires_verification` (available exige `merchant_available`, `is_verified`, `is_active`, stock > 0, `price_status='confirmed'` y price > 0), `products_price_check`, `products_price_status_check`, `products_stock_nonnegative`, `products_verified_master_data`, `products_verified_publication_authority`, `products_verified_numeric_ranges`, `products_verified_canonical_beverage_category`, `products_verified_alcohol_coherence`, `products_alcohol_requires_age`, `cp_published_requires_approved_image` (sólo para el UUID fijo del negocio de CP). Triggers `products_fail_close_master_change`, `products_assert_asset_origin`, `products_validate_catalog_asset_binding`, `products_pos_conflict_hold`. Publicación: `set_commercial_product_publication(p_business_id, p_sku, p_publish)`, `publish_catalog_product`, `unpublish_catalog_product`. Estado derivado: `product_commercial_state` (precio_pendiente, stock_pendiente, agotado, no_publicado, publicable_no_publicado, comprable). RLS pública: políticas 'production verified products are public' y 'alcohol verificado con foto se puede mirar'.
- **Máquina de estados (flags).** Borrador (`is_verified=false`) → publicado (verificado, `merchant_available`, `available`) por `apply_commercial_catalog_batch` con publish=true o `set_commercial_product_publication(true)`. Publicado → oculto por el comercio (`merchant_available=false`) por `set_commercial_product_publication(false)`, `unpublish_catalog_product` o una fila con publish=false. Publicado → no disponible cuando el stock llega a 0 (mismo UPDATE que descuenta). Cualquier verificado → borrador ante un cambio de dato maestro o de precio (trigger fail-close). Republicación automática sólo en `release_checkout_session_inventory` y `private.pos_try_reoffer`, y sólo si `merchant_available`.
- **Probado.** `supabase/tests/commercial_publish_merchant_intent_test.sql` (24), `tests/business-commercial-publication.test.mjs`, `tests/commercial-price-contract.test.mjs`, `tests/pos-availability-contract.test.mjs`. Staging: sólo la elegibilidad al crear pedido (NEG_PRODUCT_UNAVAILABLE 55000, NEG_PRODUCT_NONEXISTENT 23503); la publicación no se ejercitó en la certificación.
- **Qué NO está.** Camino del dueño para completar la ficha de un producto dado de alta por planilla o escaneo (BE-47); gate de alcohol en `publish_catalog_product` y `complete_scanned_product` (BE-75); test que combine ocultamiento del comercio con liberación de reserva.
- **Configuración viva.** Igual que CATALOG: Staging 11 de 12 disponibles; CP `la-taba-cp` 0 de 46.
- **Hallazgos.**
  - **BE-45** · P2 · NO VERIFICADO · apply_commercial_catalog_batch deja el producto oculto y sin verificar, en silencio, cuando una fila combina cambio de precio con publish=true sobre un producto verificado pero no disponible. (CAT-03)
  - **BE-47** · P2 · NO VERIFICADO · Los productos creados por el alta de la planilla o por borradores escaneados no tienen un camino accesible al dueño para volverse publicables. (CAT-07)
  - **BE-75** · P3 · NO VERIFICADO · Los caminos secundarios de publicación son inconsistentes: sin gate de alcohol en publish_catalog_product ni complete_scanned_product, no respetan merchant_available, política de imagen atada a un UUID fijo, guarda QA sólo por SKU. (STK-08, CAT-11)
  - Ver también (primarios en otro dominio): BE-07, BE-13, BE-24, BE-34.

### 3.3 PRICING

- **Qué existe.** El precio se decide 100% en el servidor en los dos caminos.
  - Manual: `create_order_with_items_core` acepta 16 claves de primer nivel y sólo `product_id` y `quantity` por ítem; cualquier clave de dinero se RECHAZA con 22023 (no se ignora). El precio unitario se lee de `products` bajo `FOR UPDATE`.
  - Checkout Pro: `create_checkout_session` congela al crear la sesión `checkout_session_items`, `checkout_session_combos`, los totales de `checkout_sessions` y `payment_intents.expected_amount`. `finalize_paid_checkout_session` copia esas filas y no vuelve a leer productos ni zonas. Total del pedido = total de la sesión = `expected_amount` = `paid_amount`.
  - Dinero en `numeric(12,2)`. CHECK `orders_total_matches_parts`, `order_items_subtotal_matches_parts`, `checkout_sessions_money_check`, `order_combos_price_check`.
  - Envío y mínimo: `resolve_delivery_zone`; `set_delivery_pricing`, `upsert_delivery_zone`.
  - Combos (sólo Checkout Pro): `product_combos`, `product_combo_components`; `resolve_business_combo` y `list_business_combos` (anon, sólo para mostrar); precio promocional redondeado hacia abajo según `price_rounding` (1, 10 o 100). Ninguna RPC escribe combos.
  - Fiscal: `private.commercial_order_fiscal_evaluation` y `private.allocate_cents`.
- **Probado.** Staging (certificación, camino manual): DB_ORDER_ITEMS_FROZEN_PRICES, DB_TOTALS (envío 1200), NEG_UNKNOWN_FIELD_PRICE_INJECTION (22023), NEG_DELIVERY_BELOW_MINIMUM (23514), cantidad 0, negativa y sobre stock. SQL local ejecutable, fuera del runner canónico: `supabase/tests/mercadopago_checkout_pro.local.sql`, `order_end_to_end_chain.local.sql`, `order_intake_dispatch_p0.local.sql`. pgTAP en CI: `commercial_order_fiscal_test.sql`. Estáticos (regex sobre migraciones): `tests/supabase-production-orders.test.mjs`, `tests/combo-backend-contract.test.mjs`. Deno: `supabase/functions/_shared/mercadopago-preference.deno.ts`.
- **Qué NO está.** Cupones, códigos promocionales, propinas, descuento por línea, impuesto a nivel pedido y umbral de envío gratis: NO IMPLEMENTADO. Combos en el camino manual. Edición de ítems o total por el staff. Sin test en ningún lado: clave de precio a nivel ítem, cantidad fraccionaria, null o mayor a 1000, líneas duplicadas, combo de punta a punta, tarifa multi-zona. Todo el pricing de Checkout Pro está sin probar en Staging.
- **Configuración viva.** Staging: envío 1200, mínimo 6000, moneda ARS. CP `la-taba-cp`: `delivery_fee` y `minimum_delivery_subtotal` en null, moneda ARS; según el repo los 46 borradores tienen precio pendiente.
- **Hallazgos.**
  - **BE-74** · P3 · NO VERIFICADO · La moneda es una etiqueta libre en pedidos manuales: sin restricción en orders y editable directamente en el negocio. (PRICE-08)
  - Ver también (primarios en otro dominio): BE-23, BE-29, BE-30, BE-46, BE-73, BE-78.

### 3.4 STOCK

- **Qué existe.** `products.stock` es el único contador y significa disponible para vender, no físico. Lo reservado es derivado (`private.pos_reserved_quantity`: ítems de pedidos abiertos con `inventory_released_at` nulo más reservas `active`); físico = stock + reservado (`private.pos_product_row`). Los caminos online descuentan al crear el pedido o la sesión, con `SELECT ... FOR UPDATE` sobre la fila del producto en orden de UUID bajo READ COMMITTED; CHECK `products_stock_nonnegative` es el respaldo. Devolución por cancelación o rechazo previo al despacho: `change_order_status`, una sola vez (`orders.inventory_released_at`). Ledger: `inventory_movements`, que sólo escriben `apply_inventory_movement`, `checkout_pos_sale`, `pos_apply_stock_movements` y `pos_apply_stock_count`. POS Caja Clara: `pos_apply_stock_movements`, `pos_apply_stock_count`, `pos_stock_conflicts`, `private.pos_try_reoffer`. Un producto con stock NULL no se vende por ningún camino.
- **Estados.** Retención de stock del pedido: retenido (`inventory_released_at` nulo) → liberado (cancelado o rechazado antes del despacho) o consumido (picked_up en adelante: cancelar ya no devuelve stock). `pos_stock_conflicts.status`: open → resolved (sólo por conteo de owner/admin).
- **Probado.** Staging: certificación (stock 40 → 37 al crear y 40 al final; 20 altas simultáneas con la misma clave = 1 decremento; carrera aceptar contra cancelar con stock 36 → 37; negativos de sobre stock y producto no disponible). Runner `scripts/e2e-staging/stock-concurrency-pilot.mjs` sin artefacto de corrida en el repo. CP (tenant QA): `scripts/controlled-production/last-unit-race.mjs` (última unidad literal) y `stock-edges.mjs`; de este último hay además una corrida de Staging del 2026-09-24, anterior al ledger actual. Local: `supabase/tests/caja_clara_pos_integration_test.sql` (54), `business_windows_scanner_fiscal_test.sql`, `commercial_catalog_stock_null_test.sql`.
- **Qué NO está.** Las tablas `inventory_receipts`, `inventory_receipt_items`, `stock_count_sessions` y `stock_count_items` existen sin función que las escriba. Cero referencias pgTAP a `apply_inventory_movement`. Sin test: carreras de última unidad checkout contra checkout y manual contra checkout; edición de stock del Panel con unidades reservadas; PATCH directo de `products`.
- **Configuración viva.** Staging: 11 de 12 productos disponibles. CP `la-taba-cp`: 46 productos, 0 disponibles; según el repo los borradores se crearon con stock NULL y la planilla de apertura tiene precio y stock vacíos (el snapshot sólo informa 0 disponibles).
- **Hallazgos.**
  - **BE-07** · P1 · REPRODUCIDO · La edición de stock del Panel (apply_commercial_catalog_batch, también complete_scanned_product) pisa products.stock con el número contado: ignora unidades reservadas, sin control de concurrencia ni fila de ledger; sobrevende. (STK-02, CAT-05)
  - **BE-13** · P2 · REPRODUCIDO · Cancelar o rechazar un pedido devuelve products.stock pero no recalcula available; el producto queda fuera de la tienda hasta republicarlo a mano (la expiración de checkout y el POS sí republican). (STK-06, OSM-02) Nota: observado en los veredictos de orders_abuse/F2 y PRICE-01.
  - **BE-26** · P2 · REPRODUCIDO · inventory_movements no es un ledger completo: los pedidos online (descuento, cancelación, reserva, liberación) no escriben movimientos, y el cierre diario informa las unidades vendidas sin los pedidos online. (STK-07, DIAG-08, OSM-11) Nota: observado en el veredicto STK-02: el pedido online escribió 0 filas; el efecto sobre el cierre diario (DIAG-08) no tiene veredicto.
  - **BE-34** · P2 · NO VERIFICADO · apply_inventory_movement nunca mantiene available: llevar a 0 un producto publicado falla con 23514 crudo. (STK-05)
  - **BE-51** · P2 · NO VERIFICADO · No hay runner de Staging para la carrera literal de última unidad y el piloto de stock de Staging es de un solo disparo. (TOOL-06)
  - **BE-62** · P3 · NO VERIFICADO · Algunos escritores de stock bloquean products en el orden del llamador: posibles deadlocks con el alta de pedidos. (STK-09)
  - Ver también (primarios en otro dominio): BE-01, BE-04, BE-24.

### 3.5 RESERVATIONS

- **Qué existe.** Reservas temporales sólo en el camino Mercado Pago: `create_checkout_session` inserta filas en `inventory_reservations` con `expires_at = now + business_payment_settings.preference_expiration_minutes` (default 15, CHECK 5..60) y descuenta `products.stock`. `release_checkout_session_inventory` devuelve el stock y recalcula `available`; `reacquire_checkout_session_inventory` vuelve a reservar con `reservation_generation + 1`; `finalize_paid_checkout_session` convierte las reservas sin tocar el stock; `recover_paid_checkout_order` reserva una nueva generación (10 minutos). Barrido: cron `taba-checkout-expiry-sweep` → `sweep_expired_checkout_sessions()` → `expire_checkout_sessions(200)`. Alertas: `list_stock_reservation_alerts`, STOCK_RESERVATION_STUCK.
- **Pedido manual.** No tiene fila de reserva ni vencimiento: descuenta al crear y retiene hasta que el staff cancela o rechaza. `release_expired_stock_reservations` existe pero no está en `cron.job` y nada escribe `orders.reservation_expires_at`; `businesses.stock_reservation_minutes` y `abandoned_order_minutes` no tienen lector.
- **Máquina de estados.** `inventory_reservations.status`: active → released (`release_checkout_session_inventory`); active → converted (`finalize_paid_checkout_session`); released y converted son terminales; un reintento inserta una fila nueva. CHECK `inventory_reservations_status_check` e `inventory_reservations_transition_check`; UNIQUE (checkout_session_id, product_id, reservation_generation). No hay unicidad de una sola reserva activa por sesión y producto.
- **Probado.** Local (SQL fuera de CI): `mercadopago_checkout_pro.local.sql` (un solo decremento, doble release devuelve una vez), `order_intake_dispatch_p0.local.sql` (P0-10), `operational_resilience_drills.local.sql` (ensayo 4), `order_end_to_end_chain.local.sql`. Todos corren el barrido ANTES de la aprobación tardía. Staging: fuera de la certificación 164/164. Evidencia parcial: el snapshot muestra 32 sesiones y 32 reservas históricas y la documentación del 2026-09-25 registra sesiones y preferencias creadas en Staging; el runner `scripts/certify-real-order-pipeline.mjs` (Gate 4: reserva, barrido, stock devuelto) no tiene artefacto de corrida en los insumos. Aprobación tardía, `reacquire` y `recover` no tienen cobertura en Staging.
- **Qué NO está.** Vencimiento de pedidos manuales; liberación de reservas de sesiones en `manual_review_required`; test de aprobación después del vencimiento y antes del barrido; test de `reacquire` / `p_new_attempt`.
- **Configuración viva.** Staging: 32 filas en `inventory_reservations`; `reserve_stock=true`; `stock_reservation_minutes=15` (columna sin lector). CP: 0 reservas; `la-taba-cp` no tiene `business_payment_settings` y tiene `stock_reservation_minutes` nulo. El cron de barrido está activo en ambos.
- **Hallazgos.**
  - **BE-04** · P1 · REPRODUCIDO · Una sesión en manual_review_required conserva sus reservas active para siempre; recover_paid_checkout_order descuenta el stock por segunda vez o informa stock_insuficiente falso. (CS-02, STK-04)
  - Ver también (primarios en otro dominio): BE-01, BE-02, BE-03, BE-50, BE-63.

### 3.6 CHECKOUT

- **Qué existe.** Dos caminos de compra.
  - Manual (efectivo / coordinar): el navegador llama `create_order_with_items(payload)`; EXECUTE para authenticated, que incluye a los usuarios anónimos de Auth. El pedido nace `received`.
  - Mercado Pago: Edge Function `mercadopago-create-checkout-session` (JWT, lista de orígenes, límite 12 por 600 s) → `create_checkout_session(p_customer_id, p_payload)` (sólo service_role) → `mercadopago-create-preference` → `prepare_mercadopago_preference_v2`. Lectura del cliente: `get_checkout_session_for_customer` sobre `checkout_session_customer_payload`; sondeo: `mercadopago-checkout-status`.
- **Contrato de `create_checkout_session`.** Claves de primer nivel: business_id, client_request_id, items, fulfillment_type, contact, address, age_confirmed, payment_method ('mercadopago'), notes; cualquier otra: 22023. Errores: 42501, 22023 (incluye DELIVERY_LOCATION_REQUIRED), 23505 (clave reusada con otro checkout), 55000 (BUSINESS_CLOSED, ALCOHOL_WINDOW_CLOSED, OUT_OF_DELIVERY_ZONE, producto no disponible), 54000 (límite), 23514 (stock, mínimo).
- **Máquina de estados de `checkout_sessions.status`.** Vocabulario: created (sólo default de columna, nunca escrito), validating (sólo dentro de la transacción de alta), ready_for_payment, redirected, payment_pending, payment_approved, finalizing_order, completed, expired, cancelled, retrying (nunca escrito), manual_review_required.

| De | A | Lo hace |
|---|---|---|
| validating | ready_for_payment | `create_checkout_session` (misma transacción) |
| ready_for_payment | redirected | `record_mercadopago_preference_created` / `_v2` |
| ready_for_payment, redirected | payment_pending | `record_mercadopago_payment_snapshot` (pending, in_process, authorized) |
| cualquiera con reserva viva y sin vencer | payment_approved | snapshot aprobado y válido |
| payment_approved | finalizing_order → completed | `finalize_paid_checkout_session` |
| created, validating, ready_for_payment, redirected, payment_pending | expired | `expire_checkout_sessions` (cron) |
| cualquiera salvo completed, payment_approved, finalizing_order, manual_review_required | cancelled o expired | `release_checkout_session_inventory` |
| cancelled, expired, retrying | ready_for_payment | `reacquire_checkout_session_inventory` (nuevo intento, mientras no venza) |
| cualquiera, incluido completed | manual_review_required | snapshot inválido, aprobación sin reserva viva, o finalize sin reserva o sin punto confirmado |
| cualquiera sin pedido | payment_approved → completed | `recover_paid_checkout_order` (owner/admin) |

  Lo aplica: CHECK `checkout_sessions_status_check` (sólo vocabulario) y `checkout_sessions_money_check`. NO hay trigger de transición (`checkout_session_status_rank` está definida y no la usa nada); el orden depende de las guardas de cada función y de que sólo service_role escribe la tabla.
- **Probado.** Local ejecutable: `mercadopago_checkout_pro.local.sql`, `order_intake_dispatch_p0.local.sql`, `order_end_to_end_chain.local.sql`, `delivery_location_confirmation.local.sql`, `operational_resilience_drills.local.sql`; Deno `supabase/functions/_shared/checkout-session-availability.deno.ts`; node `tests/mercadopago-checkout.test.mjs`. Staging: el camino manual está certificado (164/164); el camino de sesión sólo por runners (`scripts/certify-real-order-pipeline.mjs`, `scripts/mercadopago/certificacion-app-usr-directo/certificar.mjs`) sin artefacto de aprobación.
- **Qué NO está.** Tope de sesiones abiertas por cliente o por negocio; cancelación de una sesión impaga por el cliente; transición forzada por trigger. Sin test: cantidades límite en la sesión, combos, BUSINESS_CLOSED y ALCOHOL_WINDOW_CLOSED en la sesión, rechazado y luego aprobado en una preferencia, dos finalizaciones realmente concurrentes.
- **Configuración viva.** Staging: 32 sesiones históricas; Mercado Pago habilitado en entorno test. CP: 0 sesiones; `la-taba-cp` con `ordering_enabled=false`, `ordering_verified=false`, sin canales habilitados.
- **Hallazgos.**
  - **BE-02** · P1 · REPRODUCIDO · Sesiones de checkout Mercado Pago impagas reservan todo el catálogo: sin tope de sesiones abiertas ni de unidades; una identidad anónima lo repite cada TTL (15 min por defecto). (CS-04, EDGE-04) Nota: requiere Mercado Pago habilitado y vendedor conectado.
  - **BE-21** · P2 · REPRODUCIDO · La Edge Function mercadopago-create-checkout-session colapsa todo rechazo de la base en CHECKOUT_NOT_AVAILABLE, y el cliente web además descarta el cuerpo de cualquier respuesta no-2xx. (CS-06, hours_delivery/F-04)
  - **BE-64** · P3 · NO VERIFICADO · finalize_paid_checkout_session compara paid_amount con un operador que no es seguro ante NULL (latente, hoy inalcanzable). (CS-09, PRICE-06)
  - Ver también (primarios en otro dominio): BE-01, BE-03, BE-04, BE-05, BE-09, BE-12, BE-14, BE-20, BE-31, BE-50, BE-61, BE-63, BE-65, BE-73.

### 3.7 ORDERS

- **Qué existe.** Cadena de alta: `create_order_with_items` → `create_order_with_items_profile_v2` → `_profile_v1` → `_profile_v1_city_legacy` → `_legacy` → `create_order_with_items_core` (sólo la primera es ejecutable por authenticated). Comandos del negocio: `transition_order` (4 argumentos), `cancel_order`, `acknowledge_order`, `set_preparation_estimate`; internas sólo service_role: `transition_order` (3 argumentos) y `change_order_status`. Concurrencia optimista con `orders.revision` (PT409) y recibos en `business_command_receipts`. Código público `next_order_public_code` (LT-NNNN, secuencia global). `orders` tiene 23 triggers; los que definen el contrato, citados por su función de trigger: `prevent_cancellation_of_collected_manual_payment`, `prevent_paid_order_generic_cancellation`, `prevent_unverified_delivery`, `set_order_status_timestamps`, `bump_order_revision`, `log_order_status_event`, `enqueue_new_order_notification`, `kick_scheduler_watchdog` y el diferido `assert_order_payment_modality`. Origen QA: `classify_order_qa_origin` (función del trigger `order_items_classify_qa_origin`).
- **Máquina de estados de `orders.status`.** Vocabulario del CHECK `orders_status_check`: received, submitted, accepted, preparing, ready, assigned, picked_up, on_the_way, arrived, delivered, cancelled, rejected, más heredados draft, arriving, canceled. Terminales: delivered, cancelled, rejected (ninguna RPC sale de ellos).
  - Negocio (owner, admin y staff, misma matriz): received o submitted (la función los trata como el mismo estado) → accepted / rejected / cancelled; accepted → preparing / cancelled; preparing → ready / cancelled; ready → delivered (sólo retiro); ready → on_the_way (envío sin repartidor); cualquier estado no terminal → cancelled.
  - Repartidor: ready → assigned → picked_up → on_the_way → arrived → delivered (ver DELIVERY).
  - Cliente: ninguna transición alcanzable. Sistema: ninguna transición automática.
  - Lo aplica: matriz de `change_order_status` (23514 / PT409), guardas de cada RPC y los triggers. No hay trigger de tabla que prohíba salir de un terminal; la protección descansa en que authenticated sólo tiene SELECT sobre `orders`.
- **Probado.** Staging: certificación 164/164 (pedido LT-0074 de received a delivered; replays; PT409 por revisión vieja; dos operadores con un ganador; estado terminal bloqueado; 25 negativos); no llamó `acknowledge_order` ni `set_preparation_estimate`. Sin cobertura en Staging: pedidos nacidos de una sesión pagada (`finalize_paid_checkout_session`), la barrera de cancelación de un pedido pagado por Mercado Pago y el cierre de un retiro (ready → delivered). Local: pgTAP `production_operations_control_plane_test.sql` (50) y `business_self_delivery_test.sql` (50); el alta sólo tiene scripts `.local.sql` fuera de CI y tests estáticos (`tests/supabase-production-orders.test.mjs`, `tests/order-revision-gate1.test.mjs`).
- **Qué NO está.** Cancelación por el cliente; vencimiento o auto-cancelación de pedidos desatendidos; edición del pedido; tope de total o de unidades; estado de devolución posterior a la entrega; interruptor por negocio para aceptar efectivo o coordinar.
- **Configuración viva.** Staging: 79 pedidos, 7 abiertos. CP: `la-taba-cp` 0 pedidos; `qa-control-cp` 136 pedidos, 0 abiertos.
- **Hallazgos.**
  - **BE-05** · P1 · REPRODUCIDO · finalize_paid_checkout_session no copia age_confirmed_at ni age_confirmation_policy: los pedidos con alcohol pagados por Mercado Pago llegan al repartidor sin el aviso de verificar mayoría de edad. (CS-03, PRICE-07) Nota: latente mientras la venta de alcohol esté deshabilitada.
  - **BE-30** · P2 · REPRODUCIDO · El snapshot de dinero del pedido es inmutable sólo por grants: ningún trigger protege las columnas de dinero de orders, order_items ni order_combos, y nada concilia el subtotal con las líneas. (PRICE-03)
  - **BE-31** · P2 · REPRODUCIDO · next_order_public_code trunca por encima de 9999: tope de 9.999 códigos por base; después el bucle de código no termina, incluso al finalizar sesiones Mercado Pago ya pagadas. (orders_abuse/F3)
  - **BE-33** · P2 · REPRODUCIDO · La clave address_label se guarda sin límite de longitud en orders.delivery_address_formatted; las notas del camino manual no filtran caracteres de control. (orders_abuse/F6) Nota: el veredicto dejó en P3 la parte de notas: el agente de impresión rechaza el ticket que trae caracteres de control.
  - **BE-50** · P2 · NO VERIFICADO · Las suites SQL del núcleo de pedidos (order_end_to_end_chain, order_intake_dispatch_p0, order_intake_dispatch_audit) están huérfanas: nombran un runner que no existe y ninguna corre en CI. (TOOL-04)
  - **BE-56** · P2 · NO VERIFICADO · La cancelación por el cliente es inalcanzable: la regla existe en change_order_status pero ninguna función invocable por el cliente la expone. (OSM-03)
  - **BE-96** · P3 · NO VERIFICADO · cancel_order sobre un pedido ya cancelado tiene éxito y agrega otro evento business_cancel_reason. (OSM-08)
  - Ver también (primarios en otro dominio): BE-01, BE-13, BE-22, BE-28, BE-29, BE-32, BE-39, BE-53, BE-58, BE-95.

### 3.8 ORDER_ITEMS

- **Qué existe.** `order_items` congela product_id (texto), product_uuid (FK con ON DELETE SET NULL), name, quantity `numeric(12,3)`, unit, unit_price y subtotal. `order_combos` (sólo Checkout Pro) congela nombre, descuento, precio de lista y promocional y un `combo_snapshot`. Sólo dos funciones escriben ítems: `create_order_with_items_core` y `finalize_paid_checkout_session`; ninguna los modifica después. Validación de líneas: cantidad con regex de entero positivo, 1 a 100 líneas, hasta 1000 unidades por producto (combos hasta 100); las líneas duplicadas se suman. Las lecturas (Panel, cliente, ticket, repartidor) usan el snapshot; las excepciones con join vivo son `pos_list_orders` (sku) y `private.commercial_order_fiscal_evaluation`. Empaque: `order_packing_sessions` con `start_packing_session`, `record_packing_scan`, `revert_packing_scan`, `confirm_packing_session_once`, `get_packing_manifest`; es asesor y no condiciona preparing → ready.
- **Probado.** Staging: DB_ORDER_ITEMS_FROZEN_PRICES (sólo precio unitario y subtotal congelados). Local: `durable_offline_packing_test.sql` (28), `caja_clara_pos_integration_test.sql` (DTO de `pos_list_orders`), `commercial_order_fiscal_test.sql`.
- **Qué NO está.** Snapshot de SKU, código de barras, categoría, flag de alcohol e impuesto; trigger de inmutabilidad; conciliación del subtotal del pedido con la suma de líneas; cumplimiento parcial.
- **Configuración viva.** No tiene configuración por negocio. CP: 0 pedidos del negocio real.
- **Hallazgos.**
  - **BE-29** · P2 · REPRODUCIDO · order_items no congela SKU, código de barras, categoría, flag de alcohol ni impuesto; el SKU se pierde al finalizar y pos_list_orders lo lee en vivo. (PRICE-02)
  - **BE-58** · P2 · NO VERIFICADO · Cumplimiento parcial NO IMPLEMENTADO: el empaque es sólo asesor y un faltante no cambia ítems, total ni stock. (OSM-06)
  - **BE-73** · P3 · NO VERIFICADO · Una quantity JSON null no la atrapa el validador de ítems en ningún camino de alta; recién la rechaza una restricción NOT NULL. (PRICE-05)
  - Ver también (primarios en otro dominio): BE-30.

### 3.9 PAYMENTS

- **Qué existe.** Tablas `payment_intents`, `payment_attempts`, `payment_events`, `payment_outbox`, `payment_webhook_receipts`, `payment_refunds`, `payment_cancellations`, `payment_disputes`, `business_payment_settings`, `mp_seller_connections`, `mp_oauth_states`, `daily_reconciliations`. Las tablas de pago no tienen grant para authenticated (la excepción es `daily_reconciliations`, con SELECT bajo RLS): se llega por RPC que verifican el rol dentro.
  - Verdad del proveedor: `record_mercadopago_payment_snapshot` (único escritor; valida id de pago, external_reference, preference_id, collector_id, application_id, moneda ARS, monto = `expected_amount`, live_mode en producción y estado conocido; ante cualquier diferencia falla cerrado a `security_review_required`).
  - Pedido desde un pago: `finalize_paid_checkout_session`, `recover_paid_checkout_order`, `can_recover_paid_checkout`, `list_unfinalized_paid_checkouts`.
  - Preferencia: `prepare_mercadopago_preference_v2`, `record_mercadopago_preference_created_v2`, `record_mercadopago_preference_failed`, `record_mercadopago_preference_uncertain`, `get_mercadopago_payment_authority_v2`.
  - Conciliación: `enqueue_checkout_provider_probes` (cron `taba-checkout-provider-truth-sweep`), `enqueue_payment_reconciliation`, `record_provider_probe_empty`; cierre diario `prepare_daily_reconciliation`, `close_daily_reconciliation`, `daily_reconciliation_snapshot_internal` (sólo conteos locales).
  - Cancelación de pago y disputas: `prepare_payment_cancellation`, `record_payment_cancellation_response`, `mark_payment_cancellation_ambiguous`, `record_mercadopago_dispute_snapshot`.
  - Configuración y vendedor: `configure_mercadopago_settings`, `operator_set_mercadopago_for_business`, `get_mercadopago_checkout_availability`, `get_mercadopago_activation_status`; OAuth con PKCE S256 (`mp_begin_oauth`, `mp_consume_oauth`, `mp_finish_oauth`, `mp_disconnect`, `mp_claim_refresh`, `mp_finish_refresh`); tokens sellados con AES-256-GCM en `mp_seller_connections.protected_tokens`.
  - Pago manual: trigger `orders_initial_manual_payment` (función `set_initial_manual_order_payment`), `confirm_manual_order_payment` (owner/admin/staff), `reverse_manual_order_payment` (owner/admin).
  - Edge Functions (9): `mercadopago-connect`, `mercadopago-oauth-callback`, `mercadopago-create-checkout-session`, `mercadopago-create-preference`, `mercadopago-checkout-status`, `mercadopago-webhook`, `mercadopago-payment-worker`, `mercadopago-refund`, `mercadopago-cancel-payment`.
- **Máquinas de estados.**
  - `payment_intents.internal_status` con rango: created 10, preference_creating 20, ambiguous 25, preference_created 30, redirected 40, pending 50, in_process 60, rejected 70, cancelled 75, expired 80, failed 85, approved 100, approved_order_pending 105, completed 110, partially_refunded 120, refunded 130, charged_back 140, security_review_required 150. `redirected`, `failed` y `approved` nunca se escriben. Guarda: trigger `payment_intents_zz_monotonic_status` (`prevent_payment_intent_status_regression`, 22023) con dos excepciones: salir de security_review_required hacia completed, approved_order_pending, refunded, partially_refunded o charged_back; y de rejected / cancelled / expired / failed a preference_creating con un intento nuevo.
  - Mapeo del proveedor: approved → approved_order_pending (o refunded / partially_refunded); pending → pending; in_process y authorized → in_process; rejected y cancelled → liberan la reserva y cancelan la sesión; expired → libera; cualquier otro estado (incluido in_mediation) → security_review_required.
  - `orders.manual_payment_status`: pending → confirmed → reversed (terminal); cancelar o rechazar está bloqueado mientras esté confirmed (trigger `orders_block_paid_manual_cancellation`).
  - `mp_seller_connections.status`: disconnected, connected, requires_reauthorization. `payment_attempts.status`: prepared → created / ambiguous / failed. `daily_reconciliations.status`: open → closed (inmutable).
- **Probado.** Local: `mercadopago_checkout_pro.local.sql`, `order_intake_dispatch_p0.local.sql`, `payment_method_isolation.local.sql` (5), `mercadopago_operator_switch.local.sql`, `mercadopago_seller_oauth.local.sql`, `mercadopago_clean_business.local.sql`, `security_review_dead_end_probe.local.sql`; Deno `current-payment-authority.deno.ts`, `mercadopago-preference.deno.ts`, `seller-oauth-runtime.deno.ts`, `cancel-runtime.deno.ts`; node `tests/mercadopago-*.test.mjs` (mayormente regex sobre el fuente). Staging: pago manual certificado (confirmación por staff y reverso en la limpieza); OAuth 34/34 (`scripts/mercadopago/certificar-oauth-staging.mjs`) y reconexión 16/16 del 2026-09-25 según `docs/MERCADOPAGO_FINALIZATION_2026-09-25.md`. Ningún pago aprobado de Checkout Pro pasó nunca por la arquitectura productiva.
- **Qué NO está.** Reporte de conciliación proveedor contra local (PAYMENT_MISSING_LOCAL y similares): NO IMPLEMENTADO. Reconciliador de intentos de preferencia ambiguos. Interruptor de estado estable para pagos reales (BE-09). Monto en la confirmación manual (siempre el total del pedido). Sin test: snapshots con estado rejected, cancelled, expired, refunded, charged_back o in_mediation; ramas de diferencia; segundo pago sobre la misma referencia; disputas; el handler de `mercadopago-checkout-status`; el camino de pago del worker.
- **Configuración viva.** Staging: vendedor conectado (test); `business_payment_settings` habilitado (mercadopago, test, `reserve_stock=true`); 32 intents; 0 reembolsos. CP: `la-taba-cp` sin vendedor ni `business_payment_settings`; `qa-control-cp` con vendedor desconectado (entorno production); 0 intents. Cron `taba-payment-outbox-worker` y `taba-checkout-provider-truth-sweep` activos en ambos.
- **Hallazgos.**
  - **BE-03** · P1 · REPRODUCIDO · Un primer intento rechazado dentro de Checkout Pro libera el stock y cancela la sesión; el reintento aprobado en la misma preferencia termina en revisión manual: cobrado y sin pedido. (CS-01, PAY-01, EDGE-02) Nota: la premisa de reintento dentro de la misma preferencia no se pudo ejecutar sin red.
  - **BE-08** · P1 · VERIFICADO POR LECTURA · Un no-2xx al consultar la merchant order (fetchMerchantOrder devuelve null) convierte un pago aprobado legítimo en security_review_required por preference_mismatch, sin camino de recuperación ni de reembolso desde el Panel. (EDGE-01) Nota: sin veredicto propio; el veredicto CS-05 confirmó por lectura que fetchMerchantOrder devuelve null y ejecutó el efecto en la base (preference_id vacío da preference_mismatch sobre un pago completed); PAY-05 y CS-02 ejecutaron la falta de salida de un snapshot inválido.
  - **BE-09** · P1 · NO VERIFICADO · Producción no tiene interruptor de estado estable para pagos reales: toda preferencia de producción exige la variable de smoke que runbooks y herramientas exigen ausente, y la falla ocurre después de reservar stock. (EDGE-03)
  - **BE-14** · P2 · REPRODUCIDO · completed no es terminal: un snapshot inválido posterior (estado in_mediation, preference_mismatch, collector_mismatch) pasa intent y sesión a revisión de seguridad, sin salida y sin reembolso ni cancelación desde el Panel. (CS-05, PAY-05)
  - **BE-15** · P2 · REPRODUCIDO · La identidad del pago del proveedor no queda fijada: un segundo pago con el mismo external_reference la pisa, un doble cobro no se detecta y un rechazo posterior redirige los reembolsos al pago equivocado. (PAY-04, EDGE-07)
  - **BE-17** · P2 · REPRODUCIDO · Los intents completed nunca se vuelven a conciliar, un job en dead_letter no se puede revivir y no existe reporte de conciliación proveedor-vs-local. (PAY-06)
  - **BE-20** · P2 · NO VERIFICADO · Callejones sin salida al crear la preferencia: cualquier 4xx del proveedor (incluidos 408/409/429) marca el intento como failed sin abrir otro; errores locales se registran como timeout; los intentos ambiguous nunca se resuelven. (EDGE-06, PAY-09)
  - **BE-43** · P2 · NO VERIFICADO · La credencial del vendedor se destruye ante señales no concluyentes del proveedor: cualquier 401 sobre cualquier recurso y cualquier resultado ambiguo del refresh. (EDGE-08)
  - **BE-44** · P2 · NO VERIFICADO · Los cobros manuales de pedidos online no entran en el cierre diario de caja ni en las alertas. (PAY-08)
  - **BE-61** · P3 · REPRODUCIDO · Inversión del orden de locks entre record_mercadopago_payment_snapshot (intent, luego sesión) y finalize/release/expire (sesión, luego intent); los reclamos por lease vencido nunca van a dead_letter. (PAY-10, CS-10) Nota: el deadlock 40P01 se produjo en el veredicto PAY-03 forzando el entrelazado.
  - **BE-68** · P3 · NO VERIFICADO · El callback OAuth no queda atado al navegador que inició el flujo y el primer vínculo de vendedor es permanente. (EDGE-12)
  - **BE-71** · P3 · NO VERIFICADO · Cada consulta de estado escribe una fila en payment_events y sube la revisión del intent. (PAY-11)
  - **BE-72** · P3 · NO VERIFICADO · Los registradores de cancelación no tienen guarda terminal ni idempotencia, y la contabilidad de reembolsos puede perder reembolsos hechos del lado del proveedor. (PAY-13)
  - **BE-95** · P3 · NO VERIFICADO · Un cobro manual revertido no se puede volver a confirmar y el pedido sigue plenamente operable. (OSM-07)
  - Ver también (primarios en otro dominio): BE-02, BE-04, BE-06, BE-16, BE-18, BE-19, BE-28, BE-31, BE-53, BE-64, BE-66.

### 3.10 REFUNDS

- **Qué existe.** `prepare_payment_refund_v2(p_payment_intent_id, p_amount, p_idempotency_key, p_reason)` (owner/admin; total o parcial; `p_amount` nulo = saldo), `record_payment_refund_identity` (fija primero el id del proveedor), `record_payment_refund_response_v2`, `mark_payment_refund_ambiguous` (encola un job `refund_reconcile`); Edge Function `mercadopago-refund` (`verify_jwt=true`, 6 por 600 s, confirmación explícita en el cuerpo, `X-Idempotency-Key` = clave persistida).
- **Contrato y estados.** `payment_refunds.status`: requested → approved / rejected / ambiguous / failed; ambiguous → approved / rejected / failed; approved y rejected son finales; processing nunca se escribe. Un solo reembolso en requested / processing / ambiguous por intent. Elegible: intent completed o partially_refunded con pedido, o security_review_required sin pedido sólo por los motivos approved_after_reservation_expired y finalization_without_active_reservation; lo bloquea un contracargo abierto. Efectos: ninguno automático sobre pedido o stock; tras un reembolso total el pedido sólo puede ir a cancelled / rejected y `cancel_order` queda habilitado (`order_payment_is_financially_reversed`, `private.order_payment_state`).
- **Probado.** Deno: `supabase/functions/_shared/refund-runtime.deno.ts` (handler real con fetch simulado: respuesta perdida, 429, rechazo final, un solo POST), `refund-correlation.deno.ts`, `refund-no-guess.deno.ts`. SQL: identidad e idempotencia de la respuesta en `mercadopago_checkout_pro.local.sql`; `prepare_payment_refund_v2` no tiene pgTAP. Staging: NO (el reembolso real no se pudo ejecutar; el proveedor respondió 401).
- **Qué NO está.** Salida operativa para un reembolso ambiguo sin id; reflejo local de reembolsos hechos en el panel de Mercado Pago (sólo ajustan `refunded_amount` del intent); cancelación y devolución de stock automáticas tras el reembolso total.
- **Configuración viva.** 0 filas en `payment_refunds` en Staging y en CP. `la-taba-cp` sin vendedor.
- **Hallazgos.**
  - **BE-06** · P1 · REPRODUCIDO · recover_paid_checkout_order arma un pedido sobre un cobro ya reembolsado o con reembolso en curso; el Panel ofrece la acción (can_recover_order=true). (PAY-02)
  - **BE-19** · P2 · NO VERIFICADO · Un reembolso en requested, o ambiguous sin id del proveedor, no tiene salida: el worker lo lleva a dead_letter y bloquea todo reembolso posterior de ese pago. (PAY-07, EDGE-09)
  - **BE-67** · P3 · NO VERIFICADO · El validador de importe de mercadopago-refund rechaza cerca del 9% de los importes válidos de dos decimales y los informa como 503. (EDGE-11)
  - **BE-70** · P3 · NO VERIFICADO · El Panel envía una clave de idempotencia nueva en cada clic de reembolso: repetir un reembolso parcial tras una respuesta perdida es un segundo reembolso. (EDGE-14)
  - Ver también (primarios en otro dominio): BE-08, BE-14, BE-15, BE-72.

### 3.11 DELIVERY

- **Qué existe.** Asignación: `assign_order_rider`, `offer_order_to_rider`, `withdraw_rider_order_offer`, `list_rider_order_offers`, `accept_rider_order_offer`, `reject_rider_order_offer`, `claim_delivery_order`, `release_or_reassign_delivery`; capacidad de 3 pedidos activos por repartidor (trigger `orders_enforce_rider_active_order_capacity`). Progreso: `mark_delivery_picked_up`, `start_rider_delivery`, `mark_rider_arrived`. Entrega: `issue_order_delivery_code`, `recover_order_tracking_access`, `confirm_delivery_code` (repartidor asignado), `confirm_business_delivery_code` (comercio, sin repartidor); `report_rider_delivery_issue`. Tablas `rider_order_offers`, `rider_delivery_operations`, `order_delivery_handoffs`, `delivery_confirmation_attempts`, `delivery_outbox`, `rider_locations`. Funciones de trigger sobre `orders`: `prevent_unverified_delivery`, `prevent_business_delivery_over_rider`, `prevent_rider_unverified_delivery`; punto confirmado obligatorio (`enforce_confirmed_delivery_location`, DELIVERY_LOCATION_REQUIRED). Seguimiento público: `get_public_order_tracking` (DTO sin PII, ubicación degradada).
- **Estados.** Pedido con repartidor: ready → assigned → picked_up → on_the_way → arrived → delivered. `rider_order_offers.status`: pending → accepted / rejected / withdrawn. Código de entrega (`order_delivery_handoffs`): 4 dígitos, hash bcrypt, vence a lo sumo en 48 h; intentos 1 a 4 devuelven incorrect_code; desde el 5.º, bloqueo de 300 s × 2^(intentos − 5) con tope efectivo de 76800 s; `recover_order_tracking_access` regenera el código y reinicia el contador.
- **Probado.** Local: `rider_multi_order_offer_test.sql` (32), `rider_multi_order_capacity_test.sql` (27), `rider_multi_order_security_test.sql` (27), `rider_multi_order_isolation_test.sql` (38), `business_self_delivery_test.sql` (50), `customer_read_keeps_rider_offer_test.sql` (16), `delivery_location_confirmation.local.sql`. Staging: certificación, fases de repartidor (9), seguimiento (14) y código de entrega (7); `scripts/e2e-staging/rider-canonical-qa.mjs`. No cubierto en Staging: entrega por el comercio, `assign_order_rider`, `release_or_reassign_delivery`, bloqueo por intentos, vencimiento del código, `recover_order_tracking_access`.
- **Qué NO está.** Recuperación de una entrega en curso cuando falta el código o el repartidor (BE-57); comando de devolución al local tras cancelar después del retiro.
- **Configuración viva.** Staging: envío habilitado, 15 repartidores. CP `la-taba-cp`: `delivery_enabled=false`, sin repartidores (único miembro: 1 owner); CP no tiene aplicada la migración `20261001010000` (`delivery_location_guard_runs_as_owner`).
- **Hallazgos.**
  - **BE-57** · P2 · NO VERIFICADO · Sin camino de recuperación para entregas en curso: código perdido o repartidor desactivado después del retiro sólo dejan cancelar. (OSM-04)
  - **BE-97** · P3 · NO VERIFICADO · Las ofertas pendientes a repartidores quedan atadas a la revisión del pedido y no se cierran cuando el pedido cambia. (OSM-09)
  - **BE-98** · P3 · NO VERIFICADO · release_or_reassign_delivery es invocable por clientes de la API, no la usa ningún cliente y cambia el repartidor sin evento de auditoría. (OSM-10)
  - Ver también (primarios en otro dominio): BE-05, BE-23.

### 3.12 PICKUP

- **Qué existe.** Retiro en el local: exige `pickup_enabled` y `business_is_open('pickup')`; envío 0, sin mínimo, sin zona y sin punto. Se completa con `transition_order` ready → delivered por owner/admin/staff, sin código ni verificación de identidad (`prevent_unverified_delivery` sólo aplica a `delivery_mode = delivery`). Errores: 'retiro no habilitado' (manual) y 'modalidad de entrega no habilitada' (Mercado Pago), ambos 55000.
- **Probado.** Local: `business_self_delivery_test.sql` (ready → delivered en retiro), `store_opening_readiness_test.sql` (sólo retiro, BUSINESS_ADDRESS). Staging: se crearon pedidos de retiro en las fases de carreras e idempotencia; el camino feliz de retiro y el rechazo por retiro deshabilitado no se probaron. CP (tenant QA): `scripts/controlled-production/order-lifecycle-cert.mjs` cubre retiro con efectivo.
- **Qué NO está.** Mínimo de retiro; verificación al entregar un retiro prepago.
- **Configuración viva.** Staging: `pickup_enabled=true`. CP `la-taba-cp`: `pickup_enabled=false`.
- **Hallazgos.**
  - Sin hallazgos primarios en este dominio.
  - Ver también (primarios en otro dominio): BE-32.

### 3.13 SERVICE_HOURS

- **Qué existe.** Tablas `business_service_hours` (canales delivery, pickup, alcohol) y `business_service_exceptions` (cierre o horario especial por fecha; canal puede ser 'all'). Motor sólo service_role: `business_is_open`, `business_day_windows`, `business_next_open_at`. Panel: `set_business_service_hours`, `set_business_opening_hours` (la única que usa la UI: misma grilla para envío y retiro), `set_business_service_exception`, `delete_business_service_exception`, `set_service_enforcement`, `set_business_open_state` (open y paused: staff o superior; closed: owner/admin). Público (anon): `commerce_availability(p_business_id, p_channel, p_context)`. Flags `hours_enforced`, `alcohol_hours_enforced`, `operating_timezone`; CHECK `businesses_hours_need_timezone`, trigger `businesses_validate_timezones_trigger`. Alcohol: ventana heredada `alcohol_sales_start` / `alcohol_sales_end` / `alcohol_timezone` más el canal 'alcohol'.
- **Contrato.** Abierto = `is_active`, `status='open'`, `ordering_enabled`, `ordering_verified`, canal habilitado y `business_is_open(canal)`. Intervalos semiabiertos; cruce de medianoche con arrastre del día anterior; 24:00 sólo como cierre. Falla cerrado: canal o negocio desconocido, exigencia con cero filas, zona horaria nula o inválida. Falla abierto por defecto: `hours_enforced=false` = siempre abierto mientras status sea open. Errores al crear: BUSINESS_CLOSED, ALCOHOL_WINDOW_CLOSED y 'venta de alcohol fuera de horario' (55000). `finalize_paid_checkout_session` no comprueba horario ni estado, a propósito.
- **Estados.** `businesses.status`: open, paused, closed (cualquiera a cualquiera por `set_business_open_state`; sin pausa temporizada).
- **Probado.** Local: `supabase/tests/horario_24x7_test.sql` (14, único pgTAP del motor), `store_opening_readiness_test.sql`; `tests/operacion-24x7.test.mjs` (espejo JS y aserciones estáticas, no ejecuta el SQL). Staging: sólo el camino abierto de forma implícita; ningún caso BUSINESS_CLOSED. CP (tenant QA): `opening-cert.mjs`.
- **Qué NO está.** Hora de cierre (`closes_at`), estado público único, estado público de la ventana de alcohol, excepciones en la respuesta pública; corte previo al cierre, pedidos programados y pausa temporizada: NO IMPLEMENTADO. UI de excepciones y de horario de alcohol. Sin test: `business_next_open_at`, excepciones, cruce de medianoche en SQL, BUSINESS_CLOSED efectivamente levantado.
- **Configuración viva.** Staging: 14 filas de horario, 0 excepciones, `hours_enforced=true`, zona horaria de Buenos Aires. CP `la-taba-cp`: 0 filas, 0 excepciones, `hours_enforced=true` (con cero filas el motor responde cerrado), `status=closed`. CP `qa-control-cp`: 14 filas.
- **Hallazgos.**
  - **BE-10** · P1 · NO VERIFICADO · La verificación de plataforma pasa sin horarios ni zonas cuando los flags de exigencia están en false, y set_service_enforcement permite apagarlos después de verificar. (CAT-01) Nota: en CP hoy la-taba-cp tiene hours_enforced=true y delivery_zone_enforced=true.
  - **BE-22** · P2 · REPRODUCIDO · El cliente web no mapea BUSINESS_CLOSED ni OUT_OF_DELIVERY_ZONE en el camino manual y traduce mal ALCOHOL_WINDOW_CLOSED. (hours_delivery/F-05)
  - **BE-53** · P2 · REPRODUCIDO · Un pedido pagado por Mercado Pago se crea después del cierre o de una pausa manual, sin marca, alerta específica ni corte; el alcohol no se vuelve a comprobar después de crear la sesión. (hours_delivery/F-02)
  - **BE-54** · P2 · REPRODUCIDO · No hay contrato público para hora de cierre, estado de la ventana de alcohol ni excepciones por fecha; el estado abierto se reparte en dos booleanos. (hours_delivery/F-03)
  - **BE-55** · P2 · NO VERIFICADO · Las funciones que deciden cada pedido (business_is_open, business_next_open_at, business_day_windows, resolve_delivery_zone, set_service_enforcement) casi no tienen tests a nivel de base; un encabezado de migración declara tests que no existen. (hours_delivery/F-06)
  - **BE-89** · P3 · NO VERIFICADO · Las excepciones por fecha y el horario del canal de alcohol no se pueden administrar desde el Panel. (hours_delivery/F-07)
  - **BE-90** · P3 · NO VERIFICADO · Una excepción de horario especial con canal all también reemplaza la ventana del canal alcohol; excepciones closed y especiales en la misma fecha se resuelven de forma inconsistente. (hours_delivery/F-08)
  - **BE-92** · P3 · NO VERIFICADO · set_service_enforcement trata NULL como apagado para horarios y cobertura. (hours_delivery/F-10)
  - **BE-93** · P3 · NO VERIFICADO · Staff puede reabrir un negocio que el dueño cerró; el UPDATE directo de columnas de businesses saltea la auditoría de open_state y fulfillment. (hours_delivery/F-11)
  - Ver también (primarios en otro dominio): BE-21, BE-25.

### 3.14 DELIVERY_ZONES

- **Qué existe.** Tabla `delivery_zones` (`match_kind` declared_area o polygon; costo y mínimo por zona con caída a los valores del negocio; prioridad; `is_active`). `resolve_delivery_zone(p_business_id, p_lat, p_lng, p_area)` (sólo service_role) devuelve eligible, zona, costo, mínimo y detalle; `normalize_zone_name`; `upsert_delivery_zone`, `set_delivery_zone_active`, `delete_delivery_zone`, `set_delivery_pricing`. Tope duro opcional `businesses.delivery_max_radius_meters` (`haversine_meters`, exige un punto del negocio `human_verified` que sólo escribe un script de operación). Flag `delivery_zone_enforced`; sin exigencia cualquier dirección es elegible con el costo del negocio. Error OUT_OF_DELIVERY_ZONE (55000). El Panel sólo crea zonas declared_area y las activa o desactiva.
- **Probado.** Local: ningún test de base de `resolve_delivery_zone` ni de las RPC de zona; sólo tests de cliente (`tests/business-operations-delivery.test.mjs`). Staging (certificación): zona 'Centro' con costo 1200 puesto por el servidor, NEG_DELIVERY_BELOW_MINIMUM (23514), NEG_DELIVERY_WITHOUT_LOCATION (22023). No cubierto: fuera de zona, zona inactiva, polígono, tope de radio.
- **Qué NO está.** Zonas por radio; UI de polígonos, edición y borrado de zonas; RPC para verificar el punto del negocio.
- **Configuración viva.** Staging: 2 zonas activas, `delivery_zone_enforced=true`, radio máximo 8000 m, envío 1200, mínimo 6000. CP `la-taba-cp`: 0 zonas, `delivery_zone_enforced=true`, radio nulo, envío y mínimo nulos. CP `qa-control-cp`: 2 zonas, radio nulo.
- **Hallazgos.**
  - **BE-23** · P2 · REPRODUCIDO · Con zonas declared_area el cliente elige la zona, y con ella el costo de envío y el mínimo; el punto confirmado no se cruza con el barrio declarado. (PRICE-04, hours_delivery/F-01)
  - **BE-91** · P3 · NO VERIFICADO · La lista pública de zonas muestra name pero el matching usa area_normalized; nada los mantiene iguales. (hours_delivery/F-09)
  - **BE-94** · P3 · NO VERIFICADO · delivery_max_radius_meters se ignora en silencio mientras delivery_zone_enforced sea false. (hours_delivery/F-12)
  - Ver también (primarios en otro dominio): BE-10, BE-21, BE-22, BE-55, BE-92.

### 3.15 CUSTOMERS

- **Qué existe.** Cada cliente web es un usuario anónimo de Auth (`signInAnonymously`; rol authenticated con `is_anonymous`). Tablas `customers` y `customer_addresses` con políticas por `auth.uid()`; RPC `upsert_current_customer_profile`, `upsert_current_customer_address`. El cliente lee sus pedidos por RLS (`can_access_order`: `customer_user_id = auth.uid()`); no existe una RPC de historial. Puede emitir el código de entrega, rotar el acceso al seguimiento y revocarlo (`issue_order_delivery_code`, `recover_order_tracking_access`, `revoke_public_tracking`).
- **Probado.** Local: `customer_profile_isolation_test.sql` (47, fuera del runner canónico), `customer_deletion_delivery_order_test.sql` (12, en CI). Staging: la certificación creó un cliente anónimo con perfil y dirección y cubrió ANONYMOUS_OTHER_CUSTOMER_* y OWNING_CUSTOMER_READS_OWN_ORDER_ONLY; CUSTOMER_CANNOT_READ_OTHER_ORDER y el resto del bloque de cliente son de `rls-final.mjs`. Sin cobertura en Staging: `revoke_public_tracking` y `recover_order_tracking_access`.
- **Qué NO está.** Cancelación o modificación del pedido por el cliente; notificación al cliente y motivo de cancelación visible; límite de intentos de adivinar el token de seguimiento.
- **Configuración viva.** Staging y CP: altas anónimas habilitadas, 30 por hora por IP, captcha deshabilitado.
- **Hallazgos.**
  - Sin hallazgos primarios en este dominio.
  - Ver también (primarios en otro dominio): BE-27, BE-33, BE-56, BE-80.

### 3.16 AUTH

- **Qué existe.** Roles owner, admin, staff y rider (`business_members_role_check`; no hay rol manager). Fuente única del rol efectivo: `identity_member_role`, que en cada llamada exige usuario no anónimo, membresía activa, usuario no deshabilitado, fila de `identity_sessions` registrada y no revocada para el `session_id` del JWT, e `iat` posterior a `sessions_valid_from`. Envoltorios `has_business_role`, `is_business_member`, `can_manage_commercial_settings`, `rider_require_active_membership`, `private.pos_require_terminal`. RPC de equipo: `identity_register_session`, `identity_touch_session`, `identity_close_own_session`, `identity_revoke_session`, `identity_revoke_all_sessions`, `identity_set_member_active`, `identity_set_member_role`, `identity_create_invitation`, `identity_accept_invitation`, `identity_revoke_invitation`, `identity_review_access_request`, `request_business_access`. Tablas `business_members` (trigger `business_members_identity_guard`), `identity_sessions`, `identity_invitations`, `business_access_requests`, `identity_user_security`, `identity_audit_events`, `identity_permissions`, `identity_role_permissions`.
- **Estados.** Membresía: sin membresía → activa → deshabilitada (guarda de último owner). Sesión: sin registrar → registrada → revocada (terminal). Invitación: pending → accepted / revoked / expired. Solicitud de acceso: pending → approved / rejected.
- **Probado.** Local: `owner_handover_test.sql` (12, en CI), `registration_approval_test.sql` (98), `back_office_role_isolation_test.sql` (28). Staging: roles de operador, miembro sin sesión registrada sin rol, registro de sesión negado a ajenos y a anónimos (certificación); `scripts/e2e-staging/pilot-auth-rls.mjs` (22). La revocación de sesión sólo está certificada en CP (`scripts/controlled-production/caja-clara-revocation-e2e.mjs`); deshabilitar un miembro y sondear el acceso no se probó en Staging.
- **Qué NO está.** El catálogo de permisos como contrato aplicado fuera de las RPC `identity_*` (BE-42); captcha.
- **Configuración viva.** Staging: 2 owner, 13 admin, 1 staff, 15 rider. CP `la-taba-cp`: 1 owner y nadie más. Auth: altas anónimas habilitadas, captcha deshabilitado en ambos.
- **Hallazgos.**
  - **BE-41** · P2 · NO VERIFICADO · identity_close_own_session permite a cualquier usuario autenticado (incluido un cliente anónimo) agregar eventos de auditoría sin límite a cualquier negocio. (AUTHZ-03)
  - **BE-42** · P2 · NO VERIFICADO · El catálogo de permisos (identity_role_permissions) no es el contrato aplicado: admin puede autorizar homologación ARCA y staff puede cancelar pedidos. (AUTHZ-04)
  - **BE-81** · P3 · NO VERIFICADO · Lock de fila y oráculo de existencia antes de autorizar; patrón "auth.uid() nulo significa servicio" en varias RPC. (AUTHZ-08)
  - **BE-82** · P3 · NO VERIFICADO · identity_accept_invitation pisa una membresía existente y no limpia la marca de deshabilitado. (AUTHZ-09)
  - Ver también (primarios en otro dominio): BE-25, BE-68, BE-93.

### 3.17 RLS

- **Qué existe.** 112 tablas, todas con RLS. Ninguna tabla de `public` otorga INSERT, UPDATE o DELETE a nivel tabla a anon ni a authenticated; los esquemas `private` y `catalog_admin` no dan USAGE a esos roles. Exactamente 8 funciones SECURITY DEFINER ejecutables por anon: `can_access_order`, `check_scheduler_watchdog`, `commerce_availability`, `get_public_business_contact`, `get_public_order_tracking`, `list_business_combos`, `resolve_business_combo`, `scheduler_heartbeat`. Las tablas de pago (`checkout_sessions`, `checkout_session_items`, `payment_intents`, `payment_refunds`, `payment_cancellations`, `payment_disputes`) no tienen grant para authenticated: se llega sólo por RPC. Grants por columna: `products` UPDATE (available, is_active, sort_order, stock) y `businesses` UPDATE sobre 21 columnas para authenticated; `orders` y `order_items` con SELECT de tabla para anon y authenticated (la privacidad depende sólo de la política de fila).
- **Matriz resumida.** anon: catálogo público y seguimiento con token; nada más. Cliente: lo propio (pedido, perfil, direcciones, sesión de checkout). Staff: operar pedidos, confirmar cobro manual, movimientos de stock; no publica, no reembolsa, no revierte cobros. Admin: lo de staff más catálogo, reembolsos, reverso de cobro, configuración comercial, Mercado Pago y fiscal. Owner: todo, salvo las RPC de repartidor. Rider: sólo su pedido asignado entre assigned y arrived, y la cola sin PII de su negocio. Usuario de otro negocio o revocado: todo denegado.
- **Probado.** Local: `production_least_privilege_test.sql` (44, en CI), `back_office_role_isolation_test.sql` (28), `customer_profile_isolation_test.sql` (47), `rider_multi_order_security_test.sql` (27). Staging: fase RLS de la certificación (31 chequeos con la sesión de cada actor) y `scripts/controlled-production/rls-final.mjs` (44 chequeos base; corre contra Staging o CP; la evidencia de Staging es del 2026-09-24).
- **Qué NO está.** Privacidad por columna en `orders`; test del PATCH directo de columnas de `products` y `businesses` por staff o admin.
- **Configuración viva.** Es esquema: Staging está en el ledger 158 y CP en 157; la única diferencia es `20261001010000` (guarda de ubicación de entrega ejecutada como owner).
- **Hallazgos.**
  - **BE-24** · P2 · REPRODUCIDO · Grant heredado de UPDATE por columna sobre products (stock, available, is_active, sort_order) para authenticated: owner, admin y staff saltean ledger, RPC de publicación y auditoría. (STK-03, AUTHZ-02, CAT-06) Nota: ejecutado en los veredictos STK-02 y orders_abuse/F2; AUTHZ-02 cubre además businesses, ver BE-25.
  - **BE-25** · P2 · NO VERIFICADO · Habilitación de alcohol, límites de abuso, moneda y estado abierto/pedidos se escriben por UPDATE directo de columnas de businesses, sin auditoría y sin pasar por las RPC auditadas. (CAT-08)
  - **BE-79** · P3 · NO VERIFICADO · check_scheduler_watchdog, invocable por anon, escribe alertas y persiste texto controlado por el llamador. (AUTHZ-06)
  - **BE-80** · P3 · NO VERIFICADO · orders no tiene privacidad por columna y anon conserva un SELECT de tabla innecesario. (AUTHZ-07)
  - Ver también (primarios en otro dominio): BE-42, BE-74, BE-76, BE-78, BE-81, BE-93.

### 3.18 RATE_LIMITING

- **Qué existe.**

| Control | Dónde vive | Dónde se aplica en el baseline |
|---|---|---|
| `businesses.order_rate_limit_per_10_minutes` | columna, nula por defecto | sólo `create_checkout_session` (54000); NULL = sin límite; cuenta sesiones, no pedidos |
| `businesses.max_pending_orders_per_customer` | columna | ninguna función la lee |
| `stock_reservation_minutes`, `abandoned_order_minutes`, `captcha_required` | columnas | ninguna función las lee |
| `order_abuse_events`, `orders.abuse_fingerprint_hash` | tabla y columna | nadie las escribe |
| `enforceRateLimit` → `consume_payment_rate_limit` → `payment_rate_limit_buckets` | Edge Functions de Mercado Pago | checkout_session 12/600 s; preference 12/600 s; checkout_status 60/60 s; refund y cancellation 6/600 s; webhook 240/60 s; worker 30/60 s. Ventana fija; falla cerrado |
| Intentos del código de entrega | `order_delivery_handoffs` | bloqueo exponencial desde el 5.º intento |
| Altas anónimas de Auth | configuración del proyecto | 30 por hora por IP; captcha deshabilitado |

  El camino manual (`create_order_with_items` y sus cinco capas) no aplica ningún límite, tope, chequeo de IP ni registro de abuso. La única función que lee `request.headers` es `request_order_token()`, para el token de seguimiento.
- **Medición de baseline.** En PostgREST de Staging `cf-connecting-ip` no es falsificable y el primer salto de `x-forwarded-for` sí. La clave del bucket de Edge prefiere justamente ese primer salto. La misma medición sobre el gateway de Edge Functions no figura en los insumos.
- **Probado.** Nada que ejercite un límite: cero referencias pgTAP; los tests Deno simulan `consume_payment_rate_limit` como siempre permitido; la certificación de Staging registró la falta de límite en el camino manual por inspección, no por ejecución.
- **Configuración viva.** Staging `la-taba-staging`: límite 20, tope de pendientes 5, `captcha_required` nulo. CP `la-taba-cp`: límite 20, tope de pendientes 5, `captcha_required` nulo. En ambos `order_abuse_events` tiene 0 filas. Esos valores no tienen efecto en el camino manual, y el tope de pendientes no tiene efecto en ninguno.
- **Hallazgos.**
  - **BE-01** · P1 · REPRODUCIDO · El camino manual (efectivo/coordinar) no aplica límite de frecuencia, tope de pendientes, tope de unidades ni vencimiento: una sesión anónima vacía el stock público con pedidos impagos y nada lo devuelve solo. (STK-01, PRICE-01, AUTHZ-01, orders_abuse/F1, orders_abuse/F2, OSM-01) Nota: sin exposición hoy en CP: la-taba-cp está cerrado y con ordering_enabled=false.
  - **BE-12** · P2 · REPRODUCIDO · El único limitador existente (camino Mercado Pago) es débil: NULL = sin límite, conteo no seguro ante concurrencia e ignora pedidos; la clave del bucket Edge mezcla IP y usuario y toma el primer salto de x-forwarded-for; el webhook, sin autenticar, guarda una fila por cada solicitud con firma rechazada; ni los buckets ni esos recibos se purgan y la ventana fija permite ráfaga 2x. (orders_abuse/F5, EDGE-05, orders_abuse/F7) Nota: la falsificación del header en el gateway de Edge Functions no se ejecutó; la fila por rechazo en el webhook y la falta de purga (EDGE-05, orders_abuse/F7) no tienen veredicto.
  - Ver también (primarios en otro dominio): BE-02, BE-25.

### 3.19 WEBHOOKS

- **Qué existe.** Edge Function `mercadopago-webhook`: HMAC del header `x-signature` validado con el SDK oficial más ventana propia (300 s hacia atrás, 60 s hacia adelante); 401 INVALID_WEBHOOK ante firma inválida; 503 si falta el secreto; límite 240/60 s antes de validar la firma; en modo OAuth ignora con 200 todo evento que no sea `payment`. Recibo y cola en una sola RPC: `record_mercadopago_webhook_receipt` y `mp_record_seller_webhook` (ruteo por vendedor). Dedupe: UNIQUE (provider, environment, webhook_event_id, event_type, resource_id) en `payment_webhook_receipts` e índice parcial `payment_outbox_webhook_receipt_key`. Cola `payment_outbox`: `claim_payment_outbox_v2` (lease de 90 s, hasta 20 jobs), `start_payment_outbox_job`, `complete_payment_outbox_job`, `fail_payment_outbox_job` (espera 15·2^intentos s con tope de 3600; dead_letter a los 8 intentos). Despacho: cron `taba-payment-outbox-worker` cada 30 s más trigger `payment_outbox_worker_kick`, con HMAC y secretos en Vault, hacia la Edge Function `mercadopago-payment-worker` (HMAC propio; ventana de 120 s hacia atrás y 30 s hacia adelante). El webhook sólo dispara: el estado siempre sale de una lectura al proveedor.
- **Estados.** `payment_webhook_receipts.processing_status`: received o rejected_signature al insertar; rejected_signature → received si luego llega una entrega válida; received → queued → processing → completed / retry_wait / dead_letter (espeja el job). `payment_outbox.status`: pending → claimed → processing → completed / retry_wait / dead_letter; un lease vencido se vuelve a reclamar sin tope por ese camino.
- **Probado.** Deno: `mercadopago-webhook-signature.deno.ts`, `seller-webhook-runtime.deno.ts`, `payment-worker-signature.deno.ts`, `webhook-notification.deno.ts`; node `tests/mercadopago-webhook-routing.test.mjs`; SQL de dedupe y promoción en `mercadopago_checkout_pro.local.sql`. Staging: evento sintético firmado respondió 200 y uno inválido 401 según la documentación del 2026-09-25; ninguna notificación de pago real firmada fue aceptada nunca. Sin test: el camino `payment` / `payment_reconcile` del worker y el salto a merchant order.
- **Qué NO está.** Procesamiento de chargeback y claim en modo OAuth; reactivación de un job en dead_letter; purga de `payment_rate_limit_buckets` y de recibos rechazados.
- **Configuración viva.** Staging: 22 recibos. CP: 3 recibos. Las 9 funciones `mercadopago-*` son idénticas por hash entre Staging y CP; el cron del worker está activo en ambos. `la-taba-cp` no tiene vendedor conectado; el lector registra que una notificación simulada y firmada llegó hasta el ruteo en CP y respondió 503 por falta de vendedor.
- **Hallazgos.**
  - **BE-16** · P2 · REPRODUCIDO · El reintento de un job de webhook no es idempotente: el segundo snapshot viola la clave única de payment_events y el job termina en dead_letter. (PAY-03)
  - **BE-66** · P3 · VERIFICADO POR LECTURA · En modo OAuth las notificaciones de chargeback y claim no se procesan, y las ramas no-payment del worker ignoran finalize_required. (EDGE-10) Nota: la parte de modo OAuth quedó confirmada por lectura en los veredictos DIAG-02 y PAY-06.
  - **BE-69** · P3 · NO VERIFICADO · El worker reclama 20 jobs con lease de 90 s y los procesa en serie; los jobs que no llega a iniciar igual consumen intentos. (EDGE-13)
  - Ver también (primarios en otro dominio): BE-08, BE-12, BE-17, BE-18.

### 3.20 IDEMPOTENCY

- **Qué existe.**

| Operación | Clave y mecanismo |
|---|---|
| Alta de pedido manual | `orders.client_request_id` + `client_request_fingerprint`; `pg_advisory_xact_lock`; UNIQUE `orders_business_client_request_key`. Replay devuelve el pedido; otro payload, cliente o token: 23505 |
| Sesión de checkout | advisory lock; UNIQUE (business_id, customer_id, client_request_id); `normalized_intent_hash`; otro payload: 23505 |
| Pedido de una sesión pagada | lock de la fila de sesión; atajo por `completed_order_id`; `client_request_id` derivado del id de sesión bajo el índice único de pedidos; UNIQUE `payment_intents_checkout_session_id_key` |
| Preferencia | `payment_attempts.idempotency_key` enviada como `X-Idempotency-Key`; compare-and-set sobre `authority_version` |
| Webhook | recibo único; un job por recibo |
| Comandos del Panel | `business_command_receipts` UNIQUE (business_id, idempotency_key) + `request_hash`; revisión esperada (PT409) |
| Comandos del repartidor | `rider_delivery_operations` PK (order_id, rider_user_id, operation, idempotency_key) |
| Reembolso y cancelación de pago | `idempotency_key` UNIQUE en `payment_refunds` y `payment_cancellations`; id de reembolso del proveedor único |
| Movimientos de stock | `inventory_movements` UNIQUE (business_id, idempotency_key); `pos_stock_receipts`; `pos_sales` |
| Devolución y liberación de stock | `orders.inventory_released_at`; guarda `status = 'active'` en reservas |

  Sin clave (sólo compare-and-set): `assign_order_rider`, `offer_order_to_rider`, `withdraw_rider_order_offer`, `release_or_reassign_delivery`. El import de catálogo no tiene clave.
- **Probado.** Staging (certificación): replay, 20 replays concurrentes, carreras de 2, 5 y 20 altas con la misma clave, misma clave con otro payload o de otro cliente (23505), respuesta perdida en el alta y en una transición, replays de transiciones y de pasos del repartidor. Local: `order_intake_dispatch_p0.local.sql` (P0-4), `mercadopago_checkout_pro.local.sql` (misma clave y mismo payload; doble finalize; doble release), `tests/supabase-repository.test.mjs`, `tests/idempotency-key-contract.test.mjs`. Sin probar en Staging: sesión, preferencia, reembolso.
- **Configuración viva.** No tiene configuración por negocio.
- **Hallazgos.**
  - **BE-32** · P2 · REPRODUCIDO · El replay idempotente de un pedido de retiro no es neutro: cada replay sube orders.revision y updated_at y puede reescribir columnas fuera de la huella; el cliente puede hacer fallar con PT409 los comandos del operador. (orders_abuse/F4)
  - **BE-63** · P3 · NO VERIFICADO · La liberación "al usar" dentro de prepare_mercadopago_preference(_v2) se revierte por su propio RAISE; algunos replays idempotentes no verifican el payload. (CS-08, STK-10)
  - **BE-65** · P3 · VERIFICADO POR LECTURA · El cliente web nunca reusa client_request_id en el camino Mercado Pago: un reintento tras respuesta perdida crea otra sesión y otra reserva. (CS-07) Nota: confirmado por lectura en los veredictos CS-04 y CS-06.
  - Ver también (primarios en otro dominio): BE-16, BE-70.

### 3.21 EVENTS

- **Qué existe.** `order_events` (función de trigger `log_order_status_event`; tipos como 'order.received', 'order.status_changed', 'business_cancel_reason', 'order.manual_payment_confirmed', 'order.manual_payment_reversed'; legible sólo por owner/admin/staff; sin `correlation_id`). `payment_events` con UNIQUE (payment_intent_id, webhook_receipt_id, event_type). `operational_alert_events`. `identity_audit_events` (sólo anexar). `business_config_audit` (ámbitos hours, exception, zone, delivery_pricing, enforcement, permission, payments, printing, fulfillment, contact, open_state, platform_verification; no hay ámbito de catálogo ni de alcohol). `scanned_product_audit`. Colas de salida: `notification_outbox` (función de trigger `enqueue_new_order_notification`, evento 'new_order') y `delivery_outbox` (escriben `confirm_delivery_code` y `report_rider_delivery_issue`).
- **Estados.** `notification_outbox.state`: pending, processing, processed, failed, dead_letter; sólo se inserta pending y la única función que lo mueve es la clasificación QA (a processed, suprimido).
- **Probado.** Staging: fase de eventos de la certificación (9 chequeos: cadena exacta de cambios de estado, actores, secuencia monótona, sin duplicados) y la constatación de que nadie consume `notification_outbox`. Local: `tests/order-timeline.test.mjs`, `tests/order-qa-origin-migration.test.mjs`, `tests/rider-delivery-server-contracts.test.mjs` (aserciones sobre los inserts).
- **Qué NO está.** Consumidor de `notification_outbox` y de `delivery_outbox`; emisor de `service_health_signals`; movimientos de stock de pedidos online en `inventory_movements`; `correlation_id` en `order_events`, `payment_events` y tablas de repartidor.
- **Configuración viva.** No tiene configuración por negocio.
- **Hallazgos.**
  - **BE-27** · P2 · VERIFICADO POR LECTURA · notification_outbox y delivery_outbox no tienen consumidor y service_health_signals no tiene emisor: ni alertas ni pedidos nuevos salen por un canal fuera del Panel; el cliente no recibe aviso ni motivo al cancelar. (DIAG-09, OSM-05) Nota: confirmado por lectura en el veredicto hours_delivery/F-02; filas pending observadas en orders_abuse/F1.
  - Ver también (primarios en otro dominio): BE-26, BE-41, BE-46, BE-71, BE-96, BE-98.

### 3.22 OBSERVABILITY

- **Qué existe.** Salud: `build_operational_health` (service_role) y `get_operational_health` (owner/admin/staff). Centro de operaciones: `get_production_operation_center` (recalcula alertas antes de leer). Alertas: `reconcile_operational_alerts_for_business` (19 códigos según el lector, entre ellos PAYMENT_APPROVED_WITHOUT_ORDER, PAYMENT_OUTBOX_STALLED, PAYMENT_WORKER_IDLE, STOCK_RESERVATION_STUCK, ORDER_NOT_ACCEPTED, ORDER_STALLED, SCHEDULER_JOB_FAILING, SCHEDULER_JOB_STALLED, MERCADOPAGO_SELLER_CANNOT_CHARGE), `evaluate_operational_alerts_sweep`, `refresh_operational_alerts`, `transition_operational_alert`; tablas `operational_alerts`, `operational_alert_events`, `operational_sweep_runs`. Watchdog: `scheduler_heartbeat`, `check_scheduler_watchdog` (ambas anon), `kick_scheduler_watchdog` (función de trigger sobre `orders`), `list_scheduler_health`. Secretos: `list_operational_secret_status` (sólo presencia de dos entradas de Vault). Pipeline: `list_operational_pipeline`, `order_pipeline_state`, `checkout_pipeline_state`. Correlación: `assign_operation_correlation`, `propagate_paid_order_correlation`; `correlation_id` en 9 tablas. Scripts: `scripts/production-health-check.mjs`, `scripts/controlled-production/ops-pulse.mjs`, `.github/workflows/scheduler-watchdog.yml`, `services/scheduler-watchdog/worker.js`.

| Job de cron | Frecuencia | Comando |
|---|---|---|
| `taba-payment-outbox-worker` | 30 segundos | `dispatch_payment_outbox_worker('cron')` |
| `taba-checkout-expiry-sweep` | cada minuto | `sweep_expired_checkout_sessions()` |
| `taba-checkout-provider-truth-sweep` | cada minuto | `enqueue_checkout_provider_probes()` |
| `taba-operational-alerts-sweep` | cada minuto | `evaluate_operational_alerts_sweep()` |
| `taba-qa-window-expiry` | cada minuto | `close_expired_qa_windows()` |

- **Estados.** `operational_alerts.status`: open → acknowledged → resolved; resolved → open si la condición reaparece. Estado derivado de cada job: apagado, sin ninguna corrida exitosa, detenido, fallando, con fallos recientes, al día; sólo SCHEDULER_JOB_FAILING y SCHEDULER_JOB_STALLED llegan a alerta, y ambas exigen el job activo.
- **Probado.** Local: `production_operations_control_plane_test.sql` (50, en CI), `operational_resilience_drills.local.sql` (13 ensayos; requiere Docker, fuera de CI), `tests/scheduler-watchdog-probe.test.mjs`, `tests/controlled-production-ops-pulse.test.mjs`. Staging: sólo el negativo de autorización del centro de operaciones en la certificación y `list_operational_pipeline` por runner; salud, alertas, scheduler y correlación no se ejercitaron.
- **Qué NO está.** Traza de un pedido por identificador: NO IMPLEMENTADO. Canal fuera de banda para alertas críticas. Inventario de jobs esperados. Chequeos de salud de base, Auth, disponibilidad de checkout, estado del vendedor y recibos de webhook. Purga de `cron.job_run_details`. Test de `scripts/production-health-check.mjs`.
- **Configuración viva.** Los 5 jobs de cron están activos en Staging y en CP.
- **Hallazgos.**
  - **BE-18** · P2 · REPRODUCIDO · Los jobs de payment_outbox originados en webhooks (payment_intent_id NULL) son invisibles para alertas, salud y Panel; los rechazos de firma no generan alerta ni figuran en salud y sólo dejan un aviso en la consola de pagos (owner/admin, y sólo para pagos ya conocidos). (DIAG-02, PAY-12)
  - **BE-28** · P2 · REPRODUCIDO · No hay contrato de traza de un pedido: no existe búsqueda por identificador, list_business_payments corta en 200 filas y el resto del diagnóstico exige SQL de service_role sobre tablas con PII. (DIAG-01) Nota: el lector lo clasificó P1; el veredicto lo bajó a P2.
  - **BE-35** · P2 · REPRODUCIDO · scripts/production-health-check.mjs no puede dar verde (espera 4 cron, las migraciones crean 5) ni ver una alerta CRITICAL (compara en minúscula) y está fijado a otro proyecto. (DIAG-03)
  - **BE-36** · P2 · REPRODUCIDO · Abrir el centro de operaciones del Panel auto-resuelve SCHEDULER_WATCHDOG_STALE mientras el scheduler sigue caído. (DIAG-04)
  - **BE-37** · P2 · REPRODUCIDO · Un job de cron deshabilitado o desprogramado no genera alerta y cierra la que estuviera abierta; la base no tiene inventario de jobs esperados. (DIAG-05)
  - **BE-38** · P2 · NO VERIFICADO · cron.job_run_details nunca se purga y list_scheduler_health agrega toda su historia cada minuto. (DIAG-06)
  - **BE-39** · P2 · NO VERIFICADO · ORDER_NOT_ACCEPTED y ORDER_STALLED se auto-resuelven a las 24 h mientras el pedido sigue abierto y reteniendo stock. (DIAG-07)
  - **BE-40** · P2 · NO VERIFICADO · Los watchdogs externos y los scripts de salud apuntan por defecto a proyectos distintos del de producción controlada. (DIAG-10) Nota: el veredicto DIAG-03 sí ejecutó el rechazo del ref de CP en production-health-check.mjs.
  - **BE-76** · P3 · NO VERIFICADO · El JSON de salud filtra fallas del barrido de otros tenants. (DIAG-11)
  - **BE-77** · P3 · NO VERIFICADO · Etiquetas de diagnóstico inconsistentes: checkouts pagados en revisión manual figuran como expired, correlation_id falso en list_business_payments y clave de contacto equivocada. (DIAG-12) Nota: el correlation_id sintético se observó en el veredicto DIAG-01.
  - **BE-84** · P3 · NO VERIFICADO · get_business_opening_status cuenta repartidores desde una tabla heredada muerta e informa pagos como failed cuando sólo se usa pago manual. (CAT-10)
  - Ver también (primarios en otro dominio): BE-11, BE-17, BE-26, BE-27, BE-44, BE-79.

## 4. Hallazgos consolidados (deduplicados)

Los 12 lectores entregaron 128 hallazgos; varios describen el mismo defecto desde ángulos distintos. Agrupados quedan 98 hallazgos canónicos. La severidad es la del veredicto cuando existe; si no, la más alta entre los alias. El dominio es el primario; TRANSVERSAL agrupa pruebas y herramientas.

| Severidad | Total | REPRODUCIDO | VERIFICADO POR LECTURA | NO VERIFICADO |
|---|---|---|---|---|
| P1 | 11 | 7 | 1 | 3 |
| P2 | 47 | 25 | 1 | 21 |
| P3 | 40 | 3 | 2 | 35 |
| **Total** | **98** | **35** | **4** | **59** |

Totales brutos antes de deduplicar, con la severidad que puso cada lector: P1 21, P2 60, P3 47 (128). Ningún P0.

| ID | Sev. | Verificación | Dominio | Hallazgo | Alias (ids de lector) |
|---|---|---|---|---|---|
| BE-01 | P1 | REPRODUCIDO | RATE_LIMITING | El camino manual (efectivo/coordinar) no aplica límite de frecuencia, tope de pendientes, tope de unidades ni vencimiento: una sesión anónima vacía el stock público con pedidos impagos y nada lo devuelve solo | STK-01, PRICE-01, AUTHZ-01, orders_abuse/F1, orders_abuse/F2, OSM-01 |
| BE-02 | P1 | REPRODUCIDO | CHECKOUT | Sesiones de checkout Mercado Pago impagas reservan todo el catálogo: sin tope de sesiones abiertas ni de unidades; una identidad anónima lo repite cada TTL (15 min por defecto) | CS-04, EDGE-04 |
| BE-03 | P1 | REPRODUCIDO | PAYMENTS | Un primer intento rechazado dentro de Checkout Pro libera el stock y cancela la sesión; el reintento aprobado en la misma preferencia termina en revisión manual: cobrado y sin pedido | CS-01, PAY-01, EDGE-02 |
| BE-04 | P1 | REPRODUCIDO | RESERVATIONS | Una sesión en manual_review_required conserva sus reservas active para siempre; recover_paid_checkout_order descuenta el stock por segunda vez o informa stock_insuficiente falso | CS-02, STK-04 |
| BE-05 | P1 | REPRODUCIDO | ORDERS | finalize_paid_checkout_session no copia age_confirmed_at ni age_confirmation_policy: los pedidos con alcohol pagados por Mercado Pago llegan al repartidor sin el aviso de verificar mayoría de edad | CS-03, PRICE-07 |
| BE-06 | P1 | REPRODUCIDO | REFUNDS | recover_paid_checkout_order arma un pedido sobre un cobro ya reembolsado o con reembolso en curso; el Panel ofrece la acción (can_recover_order=true) | PAY-02 |
| BE-07 | P1 | REPRODUCIDO | STOCK | La edición de stock del Panel (apply_commercial_catalog_batch, también complete_scanned_product) pisa products.stock con el número contado: ignora unidades reservadas, sin control de concurrencia ni fila de ledger; sobrevende | STK-02, CAT-05 |
| BE-08 | P1 | VERIFICADO POR LECTURA | PAYMENTS | Un no-2xx al consultar la merchant order (fetchMerchantOrder devuelve null) convierte un pago aprobado legítimo en security_review_required por preference_mismatch, sin camino de recuperación ni de reembolso desde el Panel | EDGE-01 |
| BE-09 | P1 | NO VERIFICADO | PAYMENTS | Producción no tiene interruptor de estado estable para pagos reales: toda preferencia de producción exige la variable de smoke que runbooks y herramientas exigen ausente, y la falla ocurre después de reservar stock | EDGE-03 |
| BE-10 | P1 | NO VERIFICADO | SERVICE_HOURS | La verificación de plataforma pasa sin horarios ni zonas cuando los flags de exigencia están en false, y set_service_enforcement permite apagarlos después de verificar | CAT-01 |
| BE-11 | P1 | NO VERIFICADO | CATALOG | No existe un gate único PRODUCTION_READY: opening:check informa TECHNICAL_READY sin comprobar paridad de migraciones, despliegue de Edge Functions, commit servido, certificación de pagos ni P0/P1 abiertos | CAT-02 |
| BE-12 | P2 | REPRODUCIDO | RATE_LIMITING | El único limitador existente (camino Mercado Pago) es débil: NULL = sin límite, conteo no seguro ante concurrencia e ignora pedidos; la clave del bucket Edge mezcla IP y usuario y toma el primer salto de x-forwarded-for; el webhook, sin autenticar, guarda una fila por cada solicitud con firma rechazada; ni los buckets ni esos recibos se purgan y la ventana fija permite ráfaga 2x | orders_abuse/F5, EDGE-05, orders_abuse/F7 |
| BE-13 | P2 | REPRODUCIDO | STOCK | Cancelar o rechazar un pedido devuelve products.stock pero no recalcula available; el producto queda fuera de la tienda hasta republicarlo a mano (la expiración de checkout y el POS sí republican) | STK-06, OSM-02 |
| BE-14 | P2 | REPRODUCIDO | PAYMENTS | completed no es terminal: un snapshot inválido posterior (estado in_mediation, preference_mismatch, collector_mismatch) pasa intent y sesión a revisión de seguridad, sin salida y sin reembolso ni cancelación desde el Panel | CS-05, PAY-05 |
| BE-15 | P2 | REPRODUCIDO | PAYMENTS | La identidad del pago del proveedor no queda fijada: un segundo pago con el mismo external_reference la pisa, un doble cobro no se detecta y un rechazo posterior redirige los reembolsos al pago equivocado | PAY-04, EDGE-07 |
| BE-16 | P2 | REPRODUCIDO | WEBHOOKS | El reintento de un job de webhook no es idempotente: el segundo snapshot viola la clave única de payment_events y el job termina en dead_letter | PAY-03 |
| BE-17 | P2 | REPRODUCIDO | PAYMENTS | Los intents completed nunca se vuelven a conciliar, un job en dead_letter no se puede revivir y no existe reporte de conciliación proveedor-vs-local | PAY-06 |
| BE-18 | P2 | REPRODUCIDO | OBSERVABILITY | Los jobs de payment_outbox originados en webhooks (payment_intent_id NULL) son invisibles para alertas, salud y Panel; los rechazos de firma no generan alerta ni figuran en salud y sólo dejan un aviso en la consola de pagos (owner/admin, y sólo para pagos ya conocidos) | DIAG-02, PAY-12 |
| BE-19 | P2 | NO VERIFICADO | REFUNDS | Un reembolso en requested, o ambiguous sin id del proveedor, no tiene salida: el worker lo lleva a dead_letter y bloquea todo reembolso posterior de ese pago | PAY-07, EDGE-09 |
| BE-20 | P2 | NO VERIFICADO | PAYMENTS | Callejones sin salida al crear la preferencia: cualquier 4xx del proveedor (incluidos 408/409/429) marca el intento como failed sin abrir otro; errores locales se registran como timeout; los intentos ambiguous nunca se resuelven | EDGE-06, PAY-09 |
| BE-21 | P2 | REPRODUCIDO | CHECKOUT | La Edge Function mercadopago-create-checkout-session colapsa todo rechazo de la base en CHECKOUT_NOT_AVAILABLE, y el cliente web además descarta el cuerpo de cualquier respuesta no-2xx | CS-06, hours_delivery/F-04 |
| BE-22 | P2 | REPRODUCIDO | SERVICE_HOURS | El cliente web no mapea BUSINESS_CLOSED ni OUT_OF_DELIVERY_ZONE en el camino manual y traduce mal ALCOHOL_WINDOW_CLOSED | hours_delivery/F-05 |
| BE-23 | P2 | REPRODUCIDO | DELIVERY_ZONES | Con zonas declared_area el cliente elige la zona, y con ella el costo de envío y el mínimo; el punto confirmado no se cruza con el barrio declarado | PRICE-04, hours_delivery/F-01 |
| BE-24 | P2 | REPRODUCIDO | RLS | Grant heredado de UPDATE por columna sobre products (stock, available, is_active, sort_order) para authenticated: owner, admin y staff saltean ledger, RPC de publicación y auditoría | STK-03, AUTHZ-02, CAT-06 |
| BE-25 | P2 | NO VERIFICADO | RLS | Habilitación de alcohol, límites de abuso, moneda y estado abierto/pedidos se escriben por UPDATE directo de columnas de businesses, sin auditoría y sin pasar por las RPC auditadas | CAT-08 |
| BE-26 | P2 | REPRODUCIDO | STOCK | inventory_movements no es un ledger completo: los pedidos online (descuento, cancelación, reserva, liberación) no escriben movimientos, y el cierre diario informa las unidades vendidas sin los pedidos online | STK-07, DIAG-08, OSM-11 |
| BE-27 | P2 | VERIFICADO POR LECTURA | EVENTS | notification_outbox y delivery_outbox no tienen consumidor y service_health_signals no tiene emisor: ni alertas ni pedidos nuevos salen por un canal fuera del Panel; el cliente no recibe aviso ni motivo al cancelar | DIAG-09, OSM-05 |
| BE-28 | P2 | REPRODUCIDO | OBSERVABILITY | No hay contrato de traza de un pedido: no existe búsqueda por identificador, list_business_payments corta en 200 filas y el resto del diagnóstico exige SQL de service_role sobre tablas con PII | DIAG-01 |
| BE-29 | P2 | REPRODUCIDO | ORDER_ITEMS | order_items no congela SKU, código de barras, categoría, flag de alcohol ni impuesto; el SKU se pierde al finalizar y pos_list_orders lo lee en vivo | PRICE-02 |
| BE-30 | P2 | REPRODUCIDO | ORDERS | El snapshot de dinero del pedido es inmutable sólo por grants: ningún trigger protege las columnas de dinero de orders, order_items ni order_combos, y nada concilia el subtotal con las líneas | PRICE-03 |
| BE-31 | P2 | REPRODUCIDO | ORDERS | next_order_public_code trunca por encima de 9999: tope de 9.999 códigos por base; después el bucle de código no termina, incluso al finalizar sesiones Mercado Pago ya pagadas | orders_abuse/F3 |
| BE-32 | P2 | REPRODUCIDO | IDEMPOTENCY | El replay idempotente de un pedido de retiro no es neutro: cada replay sube orders.revision y updated_at y puede reescribir columnas fuera de la huella; el cliente puede hacer fallar con PT409 los comandos del operador | orders_abuse/F4 |
| BE-33 | P2 | REPRODUCIDO | ORDERS | La clave address_label se guarda sin límite de longitud en orders.delivery_address_formatted; las notas del camino manual no filtran caracteres de control | orders_abuse/F6 |
| BE-34 | P2 | NO VERIFICADO | STOCK | apply_inventory_movement nunca mantiene available: llevar a 0 un producto publicado falla con 23514 crudo | STK-05 |
| BE-35 | P2 | REPRODUCIDO | OBSERVABILITY | scripts/production-health-check.mjs no puede dar verde (espera 4 cron, las migraciones crean 5) ni ver una alerta CRITICAL (compara en minúscula) y está fijado a otro proyecto | DIAG-03 |
| BE-36 | P2 | REPRODUCIDO | OBSERVABILITY | Abrir el centro de operaciones del Panel auto-resuelve SCHEDULER_WATCHDOG_STALE mientras el scheduler sigue caído | DIAG-04 |
| BE-37 | P2 | REPRODUCIDO | OBSERVABILITY | Un job de cron deshabilitado o desprogramado no genera alerta y cierra la que estuviera abierta; la base no tiene inventario de jobs esperados | DIAG-05 |
| BE-38 | P2 | NO VERIFICADO | OBSERVABILITY | cron.job_run_details nunca se purga y list_scheduler_health agrega toda su historia cada minuto | DIAG-06 |
| BE-39 | P2 | NO VERIFICADO | OBSERVABILITY | ORDER_NOT_ACCEPTED y ORDER_STALLED se auto-resuelven a las 24 h mientras el pedido sigue abierto y reteniendo stock | DIAG-07 |
| BE-40 | P2 | NO VERIFICADO | OBSERVABILITY | Los watchdogs externos y los scripts de salud apuntan por defecto a proyectos distintos del de producción controlada | DIAG-10 |
| BE-41 | P2 | NO VERIFICADO | AUTH | identity_close_own_session permite a cualquier usuario autenticado (incluido un cliente anónimo) agregar eventos de auditoría sin límite a cualquier negocio | AUTHZ-03 |
| BE-42 | P2 | NO VERIFICADO | AUTH | El catálogo de permisos (identity_role_permissions) no es el contrato aplicado: admin puede autorizar homologación ARCA y staff puede cancelar pedidos | AUTHZ-04 |
| BE-43 | P2 | NO VERIFICADO | PAYMENTS | La credencial del vendedor se destruye ante señales no concluyentes del proveedor: cualquier 401 sobre cualquier recurso y cualquier resultado ambiguo del refresh | EDGE-08 |
| BE-44 | P2 | NO VERIFICADO | PAYMENTS | Los cobros manuales de pedidos online no entran en el cierre diario de caja ni en las alertas | PAY-08 |
| BE-45 | P2 | NO VERIFICADO | PRODUCTS | apply_commercial_catalog_batch deja el producto oculto y sin verificar, en silencio, cuando una fila combina cambio de precio con publish=true sobre un producto verificado pero no disponible | CAT-03 |
| BE-46 | P2 | NO VERIFICADO | CATALOG | Los cambios de precio, stock y publicación del catálogo no dejan auditoría ni imagen previa: un lote confirmado no se puede revertir | CAT-04 |
| BE-47 | P2 | NO VERIFICADO | PRODUCTS | Los productos creados por el alta de la planilla o por borradores escaneados no tienen un camino accesible al dueño para volverse publicables | CAT-07 |
| BE-48 | P2 | REPRODUCIDO | TRANSVERSAL | El gate canónico de base (936 pgTAP, migraciones como no-superusuario, drills de rollback y restore) no corre en esta notebook (sin Docker) y CI no se dispara para la rama de hardening | TOOL-01 |
| BE-49 | P2 | REPRODUCIDO | TRANSVERSAL | El certificador de Staging exige ledger de Staging == ledger del repo y la promoción a Staging es manual, sin script | TOOL-03 |
| BE-50 | P2 | NO VERIFICADO | ORDERS | Las suites SQL del núcleo de pedidos (order_end_to_end_chain, order_intake_dispatch_p0, order_intake_dispatch_audit) están huérfanas: nombran un runner que no existe y ninguna corre en CI | TOOL-04 |
| BE-51 | P2 | NO VERIFICADO | STOCK | No hay runner de Staging para la carrera literal de última unidad y el piloto de stock de Staging es de un solo disparo | TOOL-06 |
| BE-52 | P2 | NO VERIFICADO | TRANSVERSAL | No hay baseline de capacidad aprobado en Staging y la herramienta de capacidad no tiene p99 ni umbrales por operación | TOOL-07 |
| BE-53 | P2 | REPRODUCIDO | SERVICE_HOURS | Un pedido pagado por Mercado Pago se crea después del cierre o de una pausa manual, sin marca, alerta específica ni corte; el alcohol no se vuelve a comprobar después de crear la sesión | hours_delivery/F-02 |
| BE-54 | P2 | REPRODUCIDO | SERVICE_HOURS | No hay contrato público para hora de cierre, estado de la ventana de alcohol ni excepciones por fecha; el estado abierto se reparte en dos booleanos | hours_delivery/F-03 |
| BE-55 | P2 | NO VERIFICADO | SERVICE_HOURS | Las funciones que deciden cada pedido (business_is_open, business_next_open_at, business_day_windows, resolve_delivery_zone, set_service_enforcement) casi no tienen tests a nivel de base; un encabezado de migración declara tests que no existen | hours_delivery/F-06 |
| BE-56 | P2 | NO VERIFICADO | ORDERS | La cancelación por el cliente es inalcanzable: la regla existe en change_order_status pero ninguna función invocable por el cliente la expone | OSM-03 |
| BE-57 | P2 | NO VERIFICADO | DELIVERY | Sin camino de recuperación para entregas en curso: código perdido o repartidor desactivado después del retiro sólo dejan cancelar | OSM-04 |
| BE-58 | P2 | NO VERIFICADO | ORDER_ITEMS | Cumplimiento parcial NO IMPLEMENTADO: el empaque es sólo asesor y un faltante no cambia ítems, total ni stock | OSM-06 |
| BE-59 | P3 | REPRODUCIDO | TRANSVERSAL | El certificador de Staging no se puede reusar como librería: no exporta nada y se ejecuta al importarlo | TOOL-02 |
| BE-60 | P3 | REPRODUCIDO | TRANSVERSAL | npm test muta el worktree: un test reescribe en el lugar .github/workflows/ci.yml y supabase/config.toml | TOOL-05 |
| BE-61 | P3 | REPRODUCIDO | PAYMENTS | Inversión del orden de locks entre record_mercadopago_payment_snapshot (intent, luego sesión) y finalize/release/expire (sesión, luego intent); los reclamos por lease vencido nunca van a dead_letter | PAY-10, CS-10 |
| BE-62 | P3 | NO VERIFICADO | STOCK | Algunos escritores de stock bloquean products en el orden del llamador: posibles deadlocks con el alta de pedidos | STK-09 |
| BE-63 | P3 | NO VERIFICADO | IDEMPOTENCY | La liberación "al usar" dentro de prepare_mercadopago_preference(_v2) se revierte por su propio RAISE; algunos replays idempotentes no verifican el payload | CS-08, STK-10 |
| BE-64 | P3 | NO VERIFICADO | CHECKOUT | finalize_paid_checkout_session compara paid_amount con un operador que no es seguro ante NULL (latente, hoy inalcanzable) | CS-09, PRICE-06 |
| BE-65 | P3 | VERIFICADO POR LECTURA | IDEMPOTENCY | El cliente web nunca reusa client_request_id en el camino Mercado Pago: un reintento tras respuesta perdida crea otra sesión y otra reserva | CS-07 |
| BE-66 | P3 | VERIFICADO POR LECTURA | WEBHOOKS | En modo OAuth las notificaciones de chargeback y claim no se procesan, y las ramas no-payment del worker ignoran finalize_required | EDGE-10 |
| BE-67 | P3 | NO VERIFICADO | REFUNDS | El validador de importe de mercadopago-refund rechaza cerca del 9% de los importes válidos de dos decimales y los informa como 503 | EDGE-11 |
| BE-68 | P3 | NO VERIFICADO | PAYMENTS | El callback OAuth no queda atado al navegador que inició el flujo y el primer vínculo de vendedor es permanente | EDGE-12 |
| BE-69 | P3 | NO VERIFICADO | WEBHOOKS | El worker reclama 20 jobs con lease de 90 s y los procesa en serie; los jobs que no llega a iniciar igual consumen intentos | EDGE-13 |
| BE-70 | P3 | NO VERIFICADO | REFUNDS | El Panel envía una clave de idempotencia nueva en cada clic de reembolso: repetir un reembolso parcial tras una respuesta perdida es un segundo reembolso | EDGE-14 |
| BE-71 | P3 | NO VERIFICADO | PAYMENTS | Cada consulta de estado escribe una fila en payment_events y sube la revisión del intent | PAY-11 |
| BE-72 | P3 | NO VERIFICADO | PAYMENTS | Los registradores de cancelación no tienen guarda terminal ni idempotencia, y la contabilidad de reembolsos puede perder reembolsos hechos del lado del proveedor | PAY-13 |
| BE-73 | P3 | NO VERIFICADO | ORDER_ITEMS | Una quantity JSON null no la atrapa el validador de ítems en ningún camino de alta; recién la rechaza una restricción NOT NULL | PRICE-05 |
| BE-74 | P3 | NO VERIFICADO | PRICING | La moneda es una etiqueta libre en pedidos manuales: sin restricción en orders y editable directamente en el negocio | PRICE-08 |
| BE-75 | P3 | NO VERIFICADO | PRODUCTS | Los caminos secundarios de publicación son inconsistentes: sin gate de alcohol en publish_catalog_product ni complete_scanned_product, no respetan merchant_available, política de imagen atada a un UUID fijo, guarda QA sólo por SKU | STK-08, CAT-11 |
| BE-76 | P3 | NO VERIFICADO | OBSERVABILITY | El JSON de salud filtra fallas del barrido de otros tenants | DIAG-11 |
| BE-77 | P3 | NO VERIFICADO | OBSERVABILITY | Etiquetas de diagnóstico inconsistentes: checkouts pagados en revisión manual figuran como expired, correlation_id falso en list_business_payments y clave de contacto equivocada | DIAG-12 |
| BE-78 | P3 | NO VERIFICADO | CATALOG | Las RPC de combos para anon (resolve_business_combo, list_business_combos) saltean las reglas de visibilidad del catálogo | AUTHZ-05 |
| BE-79 | P3 | NO VERIFICADO | RLS | check_scheduler_watchdog, invocable por anon, escribe alertas y persiste texto controlado por el llamador | AUTHZ-06 |
| BE-80 | P3 | NO VERIFICADO | RLS | orders no tiene privacidad por columna y anon conserva un SELECT de tabla innecesario | AUTHZ-07 |
| BE-81 | P3 | NO VERIFICADO | AUTH | Lock de fila y oráculo de existencia antes de autorizar; patrón "auth.uid() nulo significa servicio" en varias RPC | AUTHZ-08 |
| BE-82 | P3 | NO VERIFICADO | AUTH | identity_accept_invitation pisa una membresía existente y no limpia la marca de deshabilitado | AUTHZ-09 |
| BE-83 | P3 | NO VERIFICADO | CATALOG | El destino de validación del importador no está atado al destino de escritura, ni la vista previa confirmada al plan aplicado | CAT-09 |
| BE-84 | P3 | NO VERIFICADO | OBSERVABILITY | get_business_opening_status cuenta repartidores desde una tabla heredada muerta e informa pagos como failed cuando sólo se usa pago manual | CAT-10 |
| BE-85 | P3 | NO VERIFICADO | CATALOG | El runbook de apertura ordena la verificación de plataforma antes de publicar, pero el gate de la base exige productos publicados primero | CAT-12 |
| BE-86 | P3 | NO VERIFICADO | TRANSVERSAL | validate-supabase-migrations tiene un falso positivo entre sentencias con grant all, y su chequeo de SECURITY DEFINER es sólo advertencia y depende del formato | TOOL-08 |
| BE-87 | P3 | NO VERIFICADO | TRANSVERSAL | El escáner de secretos marca como token cualquier literal `TEST-` seguido de 20 o más caracteres y recorre evidencia no versionada | TOOL-09 |
| BE-88 | P3 | NO VERIFICADO | TRANSVERSAL | Los archivos de rollback son sólo convención: ningún gate exige uno y los nuevos no se ensayan salvo que se agregue un bloque a mano al runner de CI | TOOL-10 |
| BE-89 | P3 | NO VERIFICADO | SERVICE_HOURS | Las excepciones por fecha y el horario del canal de alcohol no se pueden administrar desde el Panel | hours_delivery/F-07 |
| BE-90 | P3 | NO VERIFICADO | SERVICE_HOURS | Una excepción de horario especial con canal all también reemplaza la ventana del canal alcohol; excepciones closed y especiales en la misma fecha se resuelven de forma inconsistente | hours_delivery/F-08 |
| BE-91 | P3 | NO VERIFICADO | DELIVERY_ZONES | La lista pública de zonas muestra name pero el matching usa area_normalized; nada los mantiene iguales | hours_delivery/F-09 |
| BE-92 | P3 | NO VERIFICADO | SERVICE_HOURS | set_service_enforcement trata NULL como apagado para horarios y cobertura | hours_delivery/F-10 |
| BE-93 | P3 | NO VERIFICADO | SERVICE_HOURS | Staff puede reabrir un negocio que el dueño cerró; el UPDATE directo de columnas de businesses saltea la auditoría de open_state y fulfillment | hours_delivery/F-11 |
| BE-94 | P3 | NO VERIFICADO | DELIVERY_ZONES | delivery_max_radius_meters se ignora en silencio mientras delivery_zone_enforced sea false | hours_delivery/F-12 |
| BE-95 | P3 | NO VERIFICADO | PAYMENTS | Un cobro manual revertido no se puede volver a confirmar y el pedido sigue plenamente operable | OSM-07 |
| BE-96 | P3 | NO VERIFICADO | ORDERS | cancel_order sobre un pedido ya cancelado tiene éxito y agrega otro evento business_cancel_reason | OSM-08 |
| BE-97 | P3 | NO VERIFICADO | DELIVERY | Las ofertas pendientes a repartidores quedan atadas a la revisión del pedido y no se cierran cuando el pedido cambia | OSM-09 |
| BE-98 | P3 | NO VERIFICADO | DELIVERY | release_or_reassign_delivery es invocable por clientes de la API, no la usa ningún cliente y cambia el repartidor sin evento de auditoría | OSM-10 |

## 5. Lo que el baseline SÍ sostiene

Lo que lectores y verificadores comprobaron como correcto, con su evidencia.

- **Precio decidido por el servidor.** Ninguna clave de dinero del cliente se acepta: se rechaza con 22023 en ambos caminos. Evidencia: definiciones vivas; NEG_UNKNOWN_FIELD_PRICE_INJECTION en Staging; `mercadopago_checkout_pro.local.sql` rechaza un total enviado por el cliente. El lector de precios no encontró forma de alterar precio, subtotal, envío ni total.
- **Lock de última unidad.** Todos los caminos toman `FOR UPDATE` sobre el producto en orden de UUID antes de comprobar stock; `products_stock_nonnegative` es el respaldo. Evidencia: carrera de última unidad literal en el tenant QA de CP (`last-unit-race.mjs`: un solo ganador, stock nunca negativo); en Staging, la certificación cubrió las altas simultáneas con la misma clave (un solo decremento) y el rechazo por cantidad mayor al stock; la carrera de sobreventa entre dos pedidos distintos es del runner `stock-concurrency-pilot.mjs`, sin artefacto de corrida en el repo. En las reproducciones de abuso del alta (BE-01, BE-02) los contadores de stock quedaron correctos; los defectos de stock conocidos están en otros caminos (BE-04, BE-07).
- **Idempotencia del alta de pedido.** Clave única por negocio, advisory lock y huella del payload. Evidencia: Staging, 20 altas simultáneas con la misma clave = 1 pedido y 1 decremento; payload distinto u otro cliente = 23505; reintento tras respuesta perdida. El veredicto de BE-32 confirmó que los replays no crean pedidos, eventos ni movimientos de stock extra (el defecto es sólo la revisión en retiro).
- **Exactamente un pedido por sesión pagada.** Lock de la fila de sesión, atajo por `completed_order_id` y dos índices únicos. Evidencia: doble finalize y doble recover secuenciales en SQL local (un pedido, stock sin segundo decremento, una reserva convertida). No hay test con dos conexiones realmente concurrentes.
- **Devolución de stock exactamente una vez.** `orders.inventory_released_at` bajo el lock del pedido; la liberación de reservas exige `status = 'active'`. Evidencia: Staging (carrera aceptar contra cancelar en la certificación; cancelación doble idempotente en `stock-concurrency-pilot.mjs`, sin artefacto de corrida); CP (DOUBLE_STOCK_RETURN); doble release en SQL local; en el veredicto de BE-02 el barrido devolvió el stock exacto.
- **RLS por rol y aislamiento entre negocios.** 112 tablas con RLS, cero grants de escritura a nivel tabla, rol resuelto en cada llamada. Evidencia: 31 chequeos RLS de la certificación de Staging con la sesión de cada actor; `production_least_privilege_test.sql` (44) en CI; en el veredicto de BE-30 un owner autenticado recibió 42501 al intentar escribir `orders`, `order_items` y `order_combos`. La revisión de más de 150 funciones SECURITY DEFINER no encontró un IDOR entre tenants.
- **Aislamiento entre clientes.** Pedido, ítems, perfil, direcciones y sesión de checkout atados a `auth.uid()`. Evidencia: `customer_profile_isolation_test.sql` (47) y los negativos de cliente de la certificación.
- **Token de seguimiento.** 256 bits generados en el cliente, guardado sólo como SHA-256, 30 días de vigencia, ventana terminal de 30 minutos, DTO sin PII. Evidencia: TRACKING_DTO_HAS_NO_PII, TRACKING_WRONG_TOKEN_IS_NULL, TRACKING_ENUMERATION_RETURNS_NOTHING y afines en Staging.
- **Revocación inmediata.** Deshabilitar un miembro o revocar una sesión corta el acceso en la llamada siguiente aunque el JWT siga vigente. Evidencia: lectura de `identity_member_role`; `rider_multi_order_security_test.sql`; revocación de caja y de repartidor certificada en CP.
- **Verificación del pago antes de marcarlo.** Monto, moneda, collector, preferencia y referencia se validan contra una lectura al proveedor; cualquier diferencia falla cerrado y no crea pedido. Evidencia: lectura de `record_mercadopago_payment_snapshot`; en el veredicto de BE-04 un snapshot con monto distinto no generó pedido. Las ramas de diferencia no tienen pgTAP.
- **Estado del intent monótono.** El trigger bloqueó completed → pending (22023) en el veredicto de BE-14.
- **Webhooks.** Dedupe de recibos correcto bajo concurrencia; una firma inválida se guarda y no se encola; una entrega válida posterior la promueve una sola vez. Evidencia: `mercadopago_checkout_pro.local.sql` y tests Deno de firma.
- **Comandos del Panel y del repartidor.** Revisión esperada más recibo idempotente. Evidencia: Staging, replay, no-op, PT409 y dos operadores con un ganador.
- **Código de entrega.** Código incorrecto, correcto, replay y ya entregado certificados en Staging; sólo el repartidor asignado puede cerrar su entrega.
- **Pago manual.** pending → confirmed → reversed con guardas; staff no puede revertir, el cliente no puede confirmar. Evidencia: certificación y `pilot-auth-rls.mjs`.
- **Motor de horarios y cobertura falla cerrado.** En los veredictos de BE-54 y BE-53 el servidor rechazó correctamente fuera de horario (0 pedidos, stock intacto) y una sesión nueva tras el cierre. El lector de horarios no encontró P0 ni P1 propios.
- **Un producto no vendible no se vende.** Precio 0 o pendiente, stock NULL, sin verificar u oculto: lo impiden los CHECK y lo vuelven a comprobar las dos funciones de alta bajo lock.
- **OAuth del vendedor.** Matriz de seguridad 34/34 y reconexión 16/16 en Staging (2026-09-25); estado de un solo uso, PKCE S256, tokens sellados.
- **Salud sin secretos.** El JSON de salud sólo devuelve nombre, booleano y frase fija (ensayo 9 de los drills).
- **Paridad de Edge Functions de pago.** Las 9 `mercadopago-*` son idénticas por hash entre Staging y CP.

## 6. Gates externos conocidos

No se cierran con software; surgen de los insumos.

- **Mercado Pago sandbox con cuentas humanas.** Cualquier pago aprobado, rechazado o pendiente de Checkout Pro por la arquitectura OAuth exige un vendedor y un comprador de prueba operados por una persona (login, segundo factor, desafío de dispositivo); el lector registra además un bloqueo del lado del proveedor (WCS-51579). De eso depende todo lo posterior a un pago real: notificación firmada por la aplicación integradora, ruteo por vendedor, payload real del worker, finalize, reintento rechazado y luego aprobado, doble pago, reembolso, cancelación, chargeback y claim.
- **Consentimiento y secretos del vendedor real.** Primer consentimiento OAuth del dueño (o reconsentimiento tras desconexión); secreto de webhook y client secret de producción desde el panel de desarrolladores de Mercado Pago; pago de control con dinero real y su reembolso, que requieren autorización explícita del dueño.
- **Datos del dueño** (`catalog/opening/OWNER-INPUT.md`): identidad y correo del titular comercial; dirección de retiro; WhatsApp del local; equipo (encargados, empleados, repartidores); horarios por día y fechas especiales; envío (zonas, costo, mínimo, quién entrega); planilla de los 46 productos (precio, stock, publicar) y fotos propias; medios de pago aceptados y consentimiento de Mercado Pago; decisión sobre alcohol (edad mínima, ventana, ordenanza o licencia); datos de facturación ARCA (no necesarios para abrir); equipos (impresora, PC, teléfonos).
- **Verificación de plataforma.** `platform_verify_business_ordering` sólo la ejecuta service_role después de que el readiness quede sin pendientes.
- **Promoción a CP.** La migración `20261001010000` no está aplicada en CP; el procedimiento probado (restore drill, `db push` en seco y real, verificación) es manual y la restauración de un backup sobre CP exige decisión humana.
- **Infraestructura de pruebas.** Sin Docker en la notebook de trabajo el gate canónico de 936 sólo corre en GitHub Actions, y CI se dispara con PR a `main`, push a `main`, `integration/**` o `release/**`, o ejecución manual. Staging tiene 10 de 13 Edge Functions.
- **Decisiones de producto pendientes.** Vencimiento automático de pedidos manuales y republicación al devolver stock; cancelación por el cliente; precios distintos por zona; política para un pedido pagado que llega tras el cierre; configuración permanente de la variable de smoke de pagos reales (BE-09); cuál backend es el que vende (los gates de apertura miran CP; `commercial:gate`, `vender:listo` y los watchdogs miran otro proyecto); cumplimiento parcial; si el campo de stock del Panel es conteo físico o disponible.
- **Comportamiento del proveedor no verificable sin red.** Reintento dentro de la misma preferencia tras un rechazo; si el reenvío de una notificación reusa el id y vuelve a firmar; si `X-Idempotency-Key` se respeta al crear preferencias.
- **Decisión contable.** IVA evaluado al momento de facturar y prorrateo del descuento de combos entre todas las líneas.
