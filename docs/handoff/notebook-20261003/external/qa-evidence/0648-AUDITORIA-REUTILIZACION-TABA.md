# Auditoría de reutilización de TABA → Hamburguesería Neuquén

**Fecha:** 2026-09-03
**Origen auditado:** `C:\Users\marco\dev\la-taba-business-panel-automation`
**Repo:** `la-taba-pages-preview` · rama `feature/taba-business-panel-automation`
**HEAD verificado:** `523d3d00bc303c9333f4c2f77aefb2b3b0e24f89`
**Estado del árbol al auditar:** limpio (único no rastreado: `promo-video/`)
**TABA no fue modificada.** Cero escrituras, cero commits, cero migraciones ejecutadas sobre ese árbol.

---

## 0. Método

No se asumió la arquitectura: se leyó. Las afirmaciones de este documento salen
de archivos y líneas concretas del repo auditado, no de los `.md` de handoff (que
en varios casos describen intenciones, no el código vigente).

---

## 1. Arquitectura real (verificada)

TABA **no es** una app React/Next/Vite. Es un **sitio estático de módulos ES
nativos, sin bundler**, servido tal cual.

| Capa | Qué es realmente |
|---|---|
| Entrada | `index.html` (71 KB) — SPA de una sola página con TODAS las vistas inline (`data-view="home\|catalog\|cart\|tracking\|profile\|business\|rider"`) |
| Arranque | `runtime-config.js` (config de despliegue) → `js/startup-recovery.js` → `js/app.js` (módulo ES) |
| Render | `js/ui.js` — **217 KB, 62 exports**. Monolito de render por `innerHTML` |
| Dominio | `js/core/*` — **~50 módulos puros, sin DOM, sin framework** ← el oro |
| Datos | `js/repositories/*` — patrón repositorio con backends intercambiables (demo / sandbox / http / supabase / realtime) |
| Backend | Supabase: **116 migraciones**, **~280 funciones RPC**, RLS, triggers, Realtime |
| Pagos | 7 Edge Functions Deno (Checkout Pro de Mercado Pago) + `_shared/` con firma HMAC |
| PWA | `sw.js` (24 KB), `manifest.webmanifest`, `js/core/pwa-install.js` |
| Tests | **235** archivos con el runner nativo de Node + Playwright E2E + pgTAP (`supabase/tests/*.sql`) |
| Deploy | GitHub Actions → Cloudflare Pages (`Validate release candidate` → `workflow_run` → deploy → smoke) |
| Extra | `src-tauri/` (build de escritorio), `services/arca-fiscal-bridge` (facturación ARCA) |

**Multi-tenant desde el diseño.** Todas las tablas de negocio llevan
`business_id uuid references public.businesses(id)`. Esto es determinante para
la estrategia de aislamiento (§4).

**Autoridad de precio del lado del servidor — ya existe y es real.**
En `supabase/migrations/20260725030000_taba_production_orders.sql` la RPC
`create_order_with_items` **ignora el precio que manda el navegador**: lee
`products.price`, verifica stock, y calcula
`v_line_subtotal := v_product.price * v_item.quantity`.
El comentario de la línea 327 lo dice explícito: *"prices, totals, status, IDs,
product names, and stock are never taken from the client"*. Ese contrato se
recicla entero.

---

## 2. Clasificación módulo por módulo

### ✅ REUTILIZAR DIRECTAMENTE (copiar sin tocar la lógica)

| Módulo | Por qué |
|---|---|
| `js/core/validators.js` | Saneo de texto, teléfono argentino, nombre, dirección. Cero acoplamiento a bebidas |
| `js/core/geo-point.js` | Contrato de coordenada. Impide que `null` se convierta en 0,0. Lección cara ya pagada |
| `js/core/idempotency-key.js` | `^[A-Za-z0-9_-]{8,128}$` — el contrato que valida el servidor en 12 RPC. Ya documenta el bug de los dos puntos |
| `js/core/order-workflow.js` | Máquina de estados de 11 estados + matriz de transiciones. Sirve igual para hamburguesas |
| `js/core/storage.js` | Persistencia local con namespace |
| `js/core/delivery-location.js`, `address.js` | Punto de entrega confirmado (origen + momento + coordenada como una pieza) |
| `js/core/haptics.js`, `browser-resume.js`, `pwa-install.js` | Infraestructura de navegador, agnóstica del rubro |
| `js/repositories/*` (el patrón) | Fábrica + interfaz común. Permite demo/producción sin ramificar la UI |
| Esquema SQL: `orders`, `order_events`, `riders`, `rider_locations`, `delivery_zones`, `business_service_hours`, `customer_profiles`, `customer_addresses`, identidad | Genéricos de delivery. Ninguno sabe qué se vende |
| Edge Functions de Mercado Pago (`supabase/functions/`) | Checkout Pro completo con firma de webhook, outbox, conciliación y reintentos |

### 🔧 REUTILIZAR CON ADAPTACIÓN

| Módulo | Qué hay que cambiar |
|---|---|
| `js/core/pricing.js` | El contrato precio-pendiente/stock-pendiente se conserva **entero** (es excelente). Se agrega el precio por modificadores |
| `js/core/order-status.js` | Los estados sirven; falta el eje de **cocina** (`ready` en TABA = "listo para enviar"; en cocina hay `en preparación` → `listo`) |
| `js/core/domain.js` | `toDomainOrderItem` asume línea = producto × cantidad. Necesita modificadores |
| `js/cart.js` | **Está indexado por `productId`.** Dos hamburguesas iguales con extras distintos serían la misma línea. Hay que reindexar por línea |
| `js/core/combos.js` | Motor de combos derivado del catálogo vivo (nunca guarda precio). El concepto se conserva; la forma cambia: un combo de hamburguesería es *"elegí papas + elegí bebida"*, no *"6 latas con 10% off"* |
| `js/core/business-ops.js` | Filtros y metadatos del panel. Vocabulario a cambiar |
| `delivery_zones` + `business_service_hours` (SQL) | Se usan tal cual: polígono nativo, fee y mínimo por zona, prioridad, ventanas por canal y día con cruce de medianoche |
| `create_order_with_items` | Se conserva la autoridad de precio; se extiende para derivar también el precio de los modificadores |
| `js/repositories/supabase_order_repository.js` (155 KB) | Trae mucho TABA. Se recicla el patrón y las partes de pedidos/rider |

### ❌ NO REUTILIZAR (específico de TABA o de otro rubro)

| Módulo | Por qué |
|---|---|
| `js/ui.js` (217 KB), `index.html`, `styles/*` (20.867 líneas) | Identidad visual de tienda de bebidas. **La arquitectura se recicla, la identidad no** (encargo explícito) |
| Compuerta de alcohol: `ALCOHOLIC_CATEGORY_IDS`, `alcohol_policy_readable`, +18, licencia | No aplica |
| Taxonomía de góndola de bebidas, `retail-packaging.js` (pack vs. unidad), código de barras GTIN | Modelo de kiosco/almacén, no de cocina |
| `services/arca-fiscal-bridge`, homologación ARCA, notas de crédito | Facturación electrónica: fuera del alcance inicial |
| POS/mostrador (`js/pos/*`), `packing` con escáner, `cashbox` | Operación de local de retail |
| `loyalty`, `stories`, `merchandising-tags`, `showcase` | Marketing de TABA |
| `src-tauri/` (escritorio Windows) | No hace falta para una hamburguesería |
| Datos demo de bebidas (`js/data.js`, `approved-beverage-demo-data.js`, 41 KB) | Catálogo ajeno |

### 🆕 FALTA IMPLEMENTAR (no existe en TABA)

| Falta | Detalle |
|---|---|
| **Variantes y extras por línea** | **El hueco central.** `order_items` tiene `constraint order_items_subtotal_matches_parts check (subtotal = quantity * unit_price)` y ninguna columna de modificadores. Un "Doble Bacon + cheddar − cebolla" no se puede representar |
| **Grupos de opciones configurables** | TABA no tiene `product_option_groups` / `product_options`. Los combos son un manifiesto de componentes con descuento, no una elección del cliente |
| **KDS (Kitchen Display System)** | No existe. El panel de TABA es una bandeja de pedidos de retail, no una pantalla de cocina |
| **Stock por insumo** | TABA descuenta stock del **producto vendido** (una lata = una lata). Una hamburguesería descuenta **insumos** (pan, medallón, cheddar). Arquitectura a preparar |
| **Tiempos de cocina** | No hay `preparation_estimate` por producto ni acumulado por pedido |

---

## 3. El hueco central, medido

TABA vende SKU: *una lata de Heineken es una lata de Heineken*. La línea de
pedido es `producto × cantidad` y el subtotal es un producto de dos números,
impuesto por un `CHECK` de PostgreSQL.

Una hamburguesería vende **configuraciones**:

```
2 × Doble Bacon           $ 11.800   ($ 5.900 c/u)
    + cheddar extra          $ 800    (× 2 = $ 1.600)
    − cebolla                  —
1 × Papas grandes          $ 3.200
```

El precio unitario de una línea es `base + Σ(deltas de las opciones elegidas)`,
y ese número **lo tiene que derivar el servidor**, igual que hoy deriva
`products.price`. Si el navegador puede proponer el precio de un extra, puede
proponer $ 0.

Por eso el proyecto nuevo agrega:

- `menu_option_groups` / `menu_options` — grupos configurables desde el panel
  (mínimo, máximo, obligatorio, delta de precio por opción).
- `order_item_options` — qué se eligió en cada línea, con el precio **que fijó
  el servidor**.
- `create_burger_order` — misma doctrina que `create_order_with_items`: el
  cliente manda `{producto, cantidad, opciones[]}` y **ningún precio**.

---

## 4. Supabase: cómo reutilizar sin contaminar TABA

**Lo verificado:**
- Proyecto de TABA en producción: host real `la-taba.pages.dev`, Supabase productivo propio.
- Todas las tablas de negocio llevan `business_id`. La RLS ya aísla por comercio.
- Las claves viven en `runtime-config.js` (público) y `.env` (herramientas).
  El repo versiona el archivo **vacío**, para fallar cerrado.

**Tres opciones evaluadas:**

| Opción | Aislamiento | Riesgo para TABA | Veredicto |
|---|---|---|---|
| Mismo proyecto, mismo `business_id` | Ninguno | **Altísimo** — mezcla pedidos, clientes y productos | ❌ Descartada |
| Mismo proyecto, `business_id` distinto | Por RLS | Medio — un solo bug de política mezcla datos productivos; además hereda la compuerta de alcohol, la taxonomía de góndola y los triggers fiscales de TABA | ⚠️ Sólo como último recurso |
| **Proyecto Supabase propio, linaje de esquema forkeado** | **Físico** | **Cero** | ✅ **Elegida** |

**Decisión:** proyecto Supabase independiente. El esquema **se porta desde el
SQL real de TABA** (no se reescribe simplificado), quitando lo específico de
bebidas y sumando modificadores. El código habla con él por
`runtime-config.js`, así que el mismo build corre contra un stack local de
Docker, contra staging o contra producción sin tocar una línea de lógica.

**Regla operativa:** este proyecto **nunca** apunta al `SUPABASE_URL` de TABA.
Hay una comprobación automática que lo impide (`npm run check`).

---

## 5. Seguridad que se hereda (y se conserva)

De TABA se conserva, verbatim en doctrina:

1. **El precio lo pone el servidor.** El navegador manda identificadores y
   cantidades. Nunca importes.
2. **Fail-closed sobre el precio:** `price_status = 'pending'` o `price <= 0`
   ⇒ el producto no se puede comprar, aunque la otra mitad del dato diga que sí.
3. **Stock ausente ≠ stock cero.** `null` es "nadie lo contó"; `0` es "se agotó".
4. **Idempotencia con contrato de formato**, validada en el servidor.
5. **RLS + `security definer` con `search_path` fijado** en cada RPC.
6. **Coordenada medida o nada.** Nunca 0,0 por ausencia de dato.
7. **Separación de roles** (cliente / negocio / rider) por la capa de identidad.

---

## 6. Veredicto

TABA es una base **excelente** para esto: el 100% de la infraestructura de
delivery (pedidos, estados, rider, GPS, tracking, zonas, horarios, pagos,
identidad, realtime, PWA, deploy) es genérica y está endurecida por meses de
gates físicos reales.

Lo específico de bebidas es el **catálogo** y su vocabulario. Y el único hueco
estructural real es el de **variantes y extras**, que es exactamente el corazón
de una hamburguesería.

Plan: reciclar el dominio y el backend, escribir el motor de modificadores que
falta, y **no** reciclar una sola línea de identidad visual.
