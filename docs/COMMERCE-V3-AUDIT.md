# Commerce V3 — auditoría y baseline

## Preservación

- Repositorio: https://github.com/bitflowapp/la-taba-pages-preview.git.
- `origin/main` verificado: `a4d54dea45c8822a2c50956fad86ac90c1610292`.
- La copia principal local estaba en `main`, `31c900b`, con cinco archivos modificados. Se preservaron estado, hashes, remotos, diff binario e imágenes originales en el respaldo local `taba-commerce-v3-20260912-214546`.
- Trabajo aislado: worktree aislado de implementación, rama `feat/taba-commerce-v3`. Copia inmutable del baseline: worktree aislado de baseline, detached en `a4d54de`. Ningún cambio de otras ramas se incorpora ni descarta.
- Evidencia de comandos, pruebas y capturas: carpeta local de evidencia `taba-commerce-v3`. No se publica ni se versiona información privada.

## Mapa técnico

PWA estática, ES modules y DOM, sin React ni router externo. `index.html` contiene vistas por hash; `js/app.js` coordina eventos, carga y navegación. `state.js` y módulos puros de `core/` manejan catálogo, carrito, preferencias y presentación. `ui.js` renderiza catálogo/home/carrito/historial; CSS modular y assets propios. Hay estados de carga, recuperación, vacío, error, offline y reintento. El panel se carga diferido desde `back-office.js` y comparte contratos con escritorio Tauri, rider y tracking.

Supabase es autoridad de precios, stock, pedidos y permisos. `supabase_order_repository.js` carga catálogo, Auth, realtime, RPC y seguimiento; `supabase-business-repository.js` y el repositorio de perfiles median operaciones autenticadas. Tablas incluyen businesses, products, product_barcodes, catalog_product_drafts, customer_profiles, customer_addresses, orders, order_items, business_members, checkout_sessions, payment_intents, payment_refunds, payment_outbox y conexiones seller. Hay inventario, POS, caja, impresión, puente fiscal y controles de preparación: no se reemplazan.

Las migraciones evolucionan el esquema de forma incremental. Creación de pedidos valida ownership, stock y totales en servidor y usa bloqueos de filas; direcciones exigen dueño y punto confirmado. Precios son numeric(12,2), pero cantidades, stock, items de pago, POS y packing son enteros. Contenido en kg no significa venta fraccionada. Peso variable requeriría un contrato nuevo de pesaje, reserva, cobro y devolución; no se habilita suponiendo un kilo por unidad.

Mercado Pago usa Checkout Pro, OAuth seller, comprobación de autoridad actual antes del I/O, HMAC en webhooks, correlación de refunds, idempotencia y protocolo de releases V5. La auditoría usa pruebas locales/mocks y cluster Docker propio con `--network none`; no usa credenciales de cobro. No se cambian flags financieros ni Edge productivas.

## Datos y publicación

Fuentes: `catalog/products.*`, snapshot público, autoridad de catálogo, planilla-negocio.csv, pendientes, manifiesto de imágenes/derechos, `data/combos.csv` y RPC de importación comercial atómica. Hay importadores con dry-run y validación; no hace falta un segundo motor.

Consulta pública de solo lectura del 2026-09-12: producción devuelve 50 filas visibles y 33 disponibles con precio/stock; todas pertenecen a bebidas. Alcohol visible sigue no disponible. No hay carnes ni limpieza verificables en la consulta pública. Los nombres de familias pedidos no acreditan productos, marcas, precios, stock, SKU o permisos de imágenes. Deben permanecer necesidades de relevamiento, no productos simulados en producción.

Hosting vigente: Cloudflare Pages. `la-taba.pages.dev` es producción; `taba2-staging.pages.dev` usa otra base y negocio. GitHub Pages existe como preview histórico. El despliegue de producción es manual y separado de Edge. Commerce V3 requiere preview HTTPS de Cloudflare o staging, manteniendo separación de datos y gates.

## Baseline

- BASELINE_BRANCH: origin/main (copia auditada a4d54de).
- BASELINE_HEAD: a4d54dea45c8822a2c50956fad86ac90c1610292.
- BASELINE_WORKTREE: CLEAN en la copia aislada; cambios de la copia principal respaldados.
- BASELINE_TESTS: 2515/2515 PASS.
- Check sintaxis/config/assets/precache/higiene/identidad/secretos: PASS.
- Validación estática de migraciones: PASS, con advertencias del analizador no equivalentes a ejecución SQL.
- PREEXISTING FAILURE: `catalog:release:validate` exige TABA_CATALOG_FILE aprobado; no se suplanta con fixtures.
- BASELINE_E2E: 544 casos; ejecución local interrumpida por bloqueo nativo de browser tras 422. CI del baseline exacto pasó sus gates. Se investigaron timeouts de contexto y un salto de scroll del panel.
- BASELINE_PAYMENT_SAFETY: PASS: matriz histórica aislada V5, 294 aserciones pgTAP, compatibilidad, concurrencia y restauración; webhooks locales y mocks sin provider I/O.
- Frontend no tiene formatter/lint/typecheck independientes: `check` es el gate canónico. El puente fiscal sí usa TypeScript.

## Recorridos y fricción

Conteos aproximados: decisiones/taps, excluyen letras escritas y permisos del sistema; confirmar ubicación y pedido cuentan. Se deben contrastar con E2E final.

| Escenario | Actual | Objetivo |
|---|---|---|
| A nuevo | Comprar exige pasar historias/banner antes de búsqueda; completar identidad y dirección dentro del checkout | Búsqueda y producto al principio; conservar captura integrada |
| B autenticado sin dirección | Alta integrada y confirmación del punto, sin salir del carrito | Misma integridad; edición y predeterminada disponibles en la hoja |
| C recurrente con dirección | +, abrir carrito, confirmación (3 taps si producto visible) | Conservar 3; reducir scroll y ruido |
| D recurrente con pedido | Repetir desde home/historial; carrito y revisión | Historial directo y refresco real del catálogo antes de reconstruir |
| E varios productos | Agregar y steppers compartidos; botones anchos | Precio y + compactos; dos columnas cómodas |
| F cantidades | Un tap por suma/resta; stock limita | Mantener un tap y sincronización de todas las vistas |
| G checkout | Carrito y entrega/pago en la misma vista; modal de sugerencias antiguo ya inactivo | Sugerencias inline, confirmación explícita única |
| H editar dirección | Hoja permite seleccionar; editar dirección confirmada no tiene acceso visible en esa hoja | Editar y principal en la misma hoja |
| I repetir | Precio del catálogo en memoria; confirmación de reemplazo sólo detecta líneas normales | Actualizar catálogo, incluir combos en detección y limpiar sólo con autorización |

## Findings accionables

1. Recomendaciones repiten taxonomía vieja y su gate acepta disponibilidad no explícita; centralizar autoridad.
2. Repetición no considera carrito compuesto sólo por combos y no limpia selecciones al reemplazar.
3. No se refresca el catálogo al repetir; realtime no garantiza frescura si hubo desconexión.
4. Hoja de direcciones tiene handler de editar pero no acción visible para direcciones confirmadas.
5. Formulario de alta escaneada mezcla datos y pide categorías como texto libre; preview/error redibuja campos sin preservar todos sus valores.
6. Venta por peso no soportada en contratos operativos existentes. Mantener carnes por peso como borrador explícito hasta tener política comercial y flujo compatibles.
7. El historial local/demo existe, pero falta un host accesible y consulta del historial real autenticado. “Seguir” no comunica pedidos anteriores.

La implementación y resultados finales se documentan junto a esta evidencia; un pendiente nunca cuenta como PASS.

## Resultado de implementación y validación local

Identidad oscura, superficies cálidas, rojo denso en acciones, cards compactas y navegación de cuatro destinos. Búsqueda/categorías preceden las historias. Cantidades inmediatas; no se descartan taps rápidos. Direcciones editables y predeterminadas en la hoja del checkout. Historial real acotado por negocio y cliente, invalidado al cambiar sesión; repetir refresca catálogo y requiere revisión, sin crear pedidos ni pagos.

Panel con secciones, validación, borradores manuales y duplicación sin copiar datos comerciales sensibles. Migración aditiva `20260913011340` sólo para metadatos de borradores; peso variable y carnes no se publican sin contrato comercial completo. Importación existente reutilizada; el script de staging comprueba hashes y autoridad mediante sesión real, rollback por defecto, sin cambios financieros.

Validación: check canónico PASS; 2528 unitarias cubiertas (una identidad stale durante firma, revalidada en 81/81 PASS); seguridad MP 172/172; nuevos drafts DB 16/16. E2E completo 554: 552 PASS y dos fallos investigados, corregidos y repetidos tres veces cada uno (6/6 PASS). Un fallo era expectativa antigua de CTA y el otro foco que desplazaba el panel; se corrigió con preventScroll. Sin retries para ocultar fallos. Los tests publicados se registran después del deploy.

Métricas reproducidas en navegador mobile contra baseline y candidato, mismo producto y dos unidades, sin enviar pedido: nuevo 12 → 12 taps; recurrente con búsqueda 5 → 5; repetir desde acceso de home demo 2 → 2. Incluyen foco de campos y confirmación final; excluyen escritura, permisos del sistema y scroll. La mejora comprobada es visibilidad, acceso al historial real, frescura de precios y edición contextual, no una reducción inventada del recorrido mínimo ya existente. Producto visible y dirección guardada conserva el mínimo de 3 taps.
