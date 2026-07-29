# Inventario de desacople QA — 2026-07-29

Baseline: `npm test` falla porque los módulos de dominio inicializan el catálogo
comercial de `?demo=1`, mientras los tests heredados esperaban la antigua semilla
`qa-*`. No se detectó un fallo de Supabase, producción o backend.

| Test | SKU antiguo | Comportamiento probado | Solución recomendada |
| --- | --- | --- | --- |
| `business-config-store`: migración conserva orders/products/cart | `qa-jugo-naranja` | Hidratación y preservación de estado | `REQUIERE_FIXTURE_QA_AISLADO`: estado artificial de migración |
| `business`: acciones, bajo stock, pedido activo | `qa-hielo`, `qa-jugo-naranja`, `qa-cerveza` | Stock, disponibilidad y ciclo de pedido | `REQUIERE_FIXTURE_QA_AISLADO`: niveles de stock artificiales |
| `cart`: add/increment/remove; agotado; totales | `qa-jugo-naranja`, `qa-hielo`, `qa-agua-mineral` | Carrito y límites de stock | `REQUIERE_FIXTURE_QA_AISLADO`: agotado y precios de prueba |
| `catalog`: restauración demo | `qa-gaseosa-cola` | Restaurar catálogo base y descartar una edición | `REUTILIZAR_SKU_APROBADO`: validar contra SKU aprobado |
| `customer-profile`: consentimiento, perfil y señales | `qa-gaseosa-cola`, `qa-jugo-naranja` | Historial y perfil local | `REQUIERE_FIXTURE_QA_AISLADO`: datos repetibles para historial |
| `customer`: recompra, cupón, pago, observaciones e historial (12 fallos) | `qa-gaseosa-cola`, `qa-jugo-naranja` | Checkout e historial | `REQUIERE_FIXTURE_QA_AISLADO`: flujos de dominio no comerciales |
| `data`: consistencia, QA, sólo unidades, categorías y tiers de precio (5 fallos) | catálogo QA completo | Contrato del catálogo visible | `ASSERTION_OBSOLETA`: reemplazar por el contrato aprobado de 22 productos, packs y precio pendiente |
| `delivery-code`: pedido delivery y retiro | `qa-gaseosa-cola` | Código de entrega | `REQUIERE_FIXTURE_QA_AISLADO`: pedido sintético |
| `orders`: mensaje, delivery/retiro, mínimo, ticket, doble confirmación y transiciones (10 fallos) | `qa-gaseosa-cola`, `qa-agua-mineral` | Checkout y pedido | `REQUIERE_FIXTURE_QA_AISLADO`: escenarios sintéticos de pedido |
| `product-image-fallback`: ruta de imagen aprobada | catálogo completo | Validar rutas locales de imagen | `FALLO_REAL_DE_IMPLEMENTACION`: el matcher heredado no acepta `assets/catalog/beverages/<sku>/` |
| `promotions`: total centralizado y delivery gratis | `qa-promo-bebidas` | Promoción temporal sintética | `REQUIERE_FIXTURE_QA_AISLADO` |
| `reorder`: precio vigente, faltantes, doble toque y reemplazo (5 fallos) | `qa-gaseosa-cola`, `qa-jugo-naranja` | Recompra | `REQUIERE_FIXTURE_QA_AISLADO` |
| `repository`: creación, estado, suscripción y preparación (5 fallos) | `qa-gaseosa-cola` | Repositorio demo | `REQUIERE_FIXTURE_QA_AISLADO` |
| `sandbox-repository`: creación y claim de rider | `qa-gaseosa-cola` | Coordinación sandbox | `REQUIERE_FIXTURE_QA_AISLADO` |
| `simulation`: GPS, rutas, watchers y estados terminales (15 fallos) | `qa-gaseosa-cola` | Simulación de entrega | `REQUIERE_FIXTURE_QA_AISLADO`: producto sólo habilita el pedido previo |
| `state`: reparación e upgrade de catálogo (2 fallos) | `qa-agua-mineral`, `qa-gaseosa-cola`, `qa-jugo-naranja`, `qa-promo-bebidas` | Saneamiento y migración | `REQUIERE_FIXTURE_QA_AISLADO` para corrupción; `REUTILIZAR_SKU_APROBADO` para upgrade visible |
| `ticket`: ticket delivery y retiro | `qa-gaseosa-cola`, `qa-agua-mineral` | Impresión de pedido | `REQUIERE_FIXTURE_QA_AISLADO` |

## Decisión

1. El catálogo comercial seguirá siendo el único cargado por navegador, `?demo=1`,
   service worker y E2E.
2. La antigua semilla se moverá a `tests/fixtures/` y se inyectará desde el
   bootstrap de Node test, antes de importar módulos de dominio. No se servirá al
   navegador, no se precacheará y no tendrá assets nuevos.
3. Las pruebas de contrato de catálogo e imagen se desacoplarán de la semilla y
   verificarán directamente `approved-beverage-demo-data.js` y sus 22 assets.
4. Las pruebas E2E se migrarán a selectores de propiedades/SKU aprobado; no se
   usarán fixtures QA en el navegador.
