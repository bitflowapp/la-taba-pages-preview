# TABA — Inventario técnico de componentes

Alcance: sólo los componentes tocados por esta propuesta. `M` = móvil, `D` = desktop.

## Cliente — chrome y navegación

| Componente | Ruta | Función | Estado | Reutiliz. | Refactor | Riesgo | Dependencias | Superficie |
|---|---|---|---|---|---|---|---|---|
| `header.topbar` | `index.html:25-57` · `storefront.css` · `responsive.css:1140` | Marca, nav desktop, botón carrito | 70-72px; carrito ocupa ~55% del ancho aun vacío | Sí | **Sí** — compactar a 56px, integrar dirección | Medio | `--topbar`, `data-cart-count` | M+D |
| `nav.mobile-nav` | `responsive.css:101-205` | Bottom nav 4 destinos | Píldora flotante, alto real 68px ≠ tokens (104/76/70/82) | Sí | **Sí** — barra a sangre 56px + safe area | **Alto** (P0-01) | `--taba-bottom-nav-*` | M |
| `button.floating-cart` | `responsive.css:207-233` · `storefront.css` | Resumen sticky del carrito | fixed z1200, tapa contenido | Sí | **Sí** — altura fija, `bottom` derivado, oculto si vacío | **Alto** | reserva rota | M+D |
| `div.toast` | `common.css` · `responsive.css:119-122` | Feedback efímero | z3000; tapa tarjetas y empty states | Sí | Sí — `bottom` derivado | Medio | reserva rota | M+D |
| `.pwa-banner` ×4 | `index.html:59-104` | Instalar / iOS / offline / update | Correctos, insertados sobre `main` | Sí | No | Bajo | `pwa-install.js`, `pwa-update.js` | M+D |
| `.app-recovery` | `index.html:113-124` | Fallback si falla el bootstrap | Bien resuelto; conservar tal cual | Sí | No | Bajo | `startup-recovery.js` | M+D |

## Cliente — catálogo

| Componente | Ruta | Función | Estado | Reutiliz. | Refactor | Riesgo | Dependencias | Superficie |
|---|---|---|---|---|---|---|---|---|
| `.product-grid` | `catalog.css:207-216` · `responsive.css:263-266` | Grilla | 4 col desktop / 2 col ≤820 | Sí | Menor — `auto-fill minmax` | Bajo | — | M+D |
| `.product-card` | `catalog.css:218-241` | Tarjeta | Filas fijas `190/78/62`, `min-height:330`; imagen ≈15% del área | Parcial | **Sí — rehacer** | **Alto** (P0-02, P1-07) | `.product-media`, `.thumb` | M+D |
| `.product-media` + `.thumb` + `.thumb-img` | `catalog.css:243-288` | Contenedor de packshot | Caja ancha y baja + `padding:11%` ⇒ producto minúsculo | Parcial | **Sí** — `aspect-ratio:1/1`, `padding:4px` | Alto | assets WebP **con fondo blanco horneado** | M+D |
| `.product-media-control` | `catalog.css:252-257` | Ancla de la acción | `position:absolute; bottom:136px` — solapa el título | **No** | **Sí — eliminar** | **Alto** (P0-02) | filas de `.product-card` | M+D |
| `.qty-stepper` / `.quantity-control` | `catalog.css:381-465, 558-` | Cantidad | Dos implementaciones; botones <44px | Parcial | **Sí — unificar** | Alto | — | M+D |
| `.product-favorite` | `catalog.css:466-495` | Favorito | Círculo blanco sobre blanco, sin contraste | Sí | Menor | Bajo | — | M+D |
| `.product-body` | `catalog.css:314-345` | Nombre/presentación/disponibilidad | `min-height` encadenados que inflan altura | Sí | Menor | Bajo | — | M+D |
| `.stock-pill` | `catalog.css:297-312` | Estado de stock | OK; verde por debajo de AA en “Disponible” | Sí | Menor — color | Medio (a11y) | `--taba-success` | M+D |
| Empty state del catálogo | `js/ui.js:1017-1046` | 3 variantes (favoritos/búsqueda/categoría) | **La lógica es correcta**; falta nombrar la consulta y ofrecer “Limpiar búsqueda” | Sí | Menor — copy y acciones | Medio (P1-06) | `getFilteredProducts` | M+D |
| Meta del catálogo | `js/ui.js:985-995` | Título + contador + orden | El título usa **sólo** la categoría, nunca la consulta | Sí | **Sí** | Medio (P1-06) | `activeCategoryName()` | M+D |
| Rail de ofertas | `js/ui.js:955-983` | Ofertas de la categoría | Se oculta con búsqueda activa (decisión correcta y documentada en el código) | Sí | No | Bajo | promociones | M+D |
| Rail “Los más vendidos” | `storefront.css` (`.home-best-sellers.offers-rail`) | Destacados en home | **Colapsado**: tarjetas de ~85px con packshot de ~15px, sin nombre ni precio | **No** | **Sí** | Alto (P1-05 / F-01) | markup propio ≠ `.product-card` | M |
| `.home-catalog-card`, `.offer-card`, `.recommendation-card` | `storefront.css` | Variantes de tarjeta | 5 markups para la misma función | Parcial | **Sí — consolidar** | Alto | — | M+D |
| Categorías (home y catálogo) | `storefront.css` / `catalog.css` | Filtro | Tarjetas de ~105px, etiquetas de 10px, duplicadas entre vistas | Parcial | **Sí** — chips de 44px | Medio | — | M+D |
| Tarjeta de dirección | `storefront.css` | Dirección de envío | ~92px y texto truncado a media palabra | Parcial | **Sí** — fila en el app bar | Medio | `customer-addresses.js` | M |
| `.home-preview-label` | `js/ui.js` / `index.html` | Badge “PREVIEW INTERNA” | Visible al cliente, 8px | **No** | **Sí — quitar** | Medio (P1-04) | modo demo | M+D |

## Negocio

| Componente | Ruta | Función | Estado | Reutiliz. | Refactor | Riesgo | Dependencias | Superficie |
|---|---|---|---|---|---|---|---|---|
| `[data-view="business"]` | `index.html:405-456` | Contenedor + puertas de acceso | Demo por PIN + producción por credenciales; correcto | Sí | No | Bajo | `app-mode.js` | M+D |
| `.admin-lock-card` | `index.html:406-439` | Bloqueo/ingreso | Correcto | Sí | Menor | Bajo | — | M+D |
| `[data-business-dashboard]` | `js/business.js` + `business.css` | Dashboard completo | **Escritorio comprimido**: 4 tarjetas de métrica (~260px) + 2 filas de tabs cortadas antes de la cola | **No** | **Sí — rearquitectura móvil** | **Alto** (P1-01, P1-02) | `business-metrics.js`, `business-ops.js`, `order-workflow.js` | M+D |
| Tarjetas de métrica ×4 | `business.css` | Nuevos/Prep/Listos/Camino | 130px c/u mostrando ceros | **No** | **Sí** — banda de 52px que además filtra | Alto | `business-metrics.js` | M |
| Tabs de sección | `business.css` | Pedidos/Métricas/Reportes/Caja | Scroll horizontal cortado, sin affordance | **No** | **Sí** — bottom nav + stack | Alto | — | M |
| Tabs de estado | `business.css` | Todos/Nuevos/En preparación | Segunda fila cortada; duplica el filtro de las métricas | **No** | **Sí** — fusionar con la banda | Medio | — | M |
| Cola de pedidos | `js/business.js` | Lista operativa | Empieza a ~y700 en 390×844 | Sí | **Sí** — subir y compactar | Alto | repositorio de pedidos | M+D |
| Detalle de pedido | `js/business.js` | Detalle + acciones | Sin acción primaria sticky | Parcial | **Sí** | Medio | `order-workflow.js` | M+D |
| Estado de sincronización | `js/core/realtime-sync.js` + `js/realtime.js` | Online/reconectando/offline | Existe; la presentación no es persistente ni honesta en móvil | Sí | Menor | Medio | relay / Supabase | M+D |
| Caja | `js/core/cashbox-store.js` | Caja del día | Fuera del alcance visual de esta propuesta | Sí | No | Bajo | — | M+D |
| Reportes | `js/core/business-reports.js` | Cierres | Fuera del alcance visual | Sí | No | Bajo | — | D |

## Rider (web actual)

| Componente | Ruta | Función | Estado | Reutiliz. | Refactor | Riesgo | Dependencias | Superficie |
|---|---|---|---|---|---|---|---|---|
| `[data-view="rider"]` | `index.html:458-...` | Vista rider | Panel dentro de la PWA | Concepto sí | Migrar | Medio | `app-mode.js` | M |
| Lista de entregas | `js/delivery.js` + `rider.css` | Trabajos | Reutilizable como modelo | Concepto | Migrar | Medio | repositorio | M |
| Mapa | `js/map/*` + MapLibre CDN | Ubicación | Depende de `unpkg` | Concepto | Migrar a MapLibre nativo | Medio | CDN externo | M |
| Código de entrega | `js/core/delivery-code.js` | Verificación | **Contrato válido — conservar** | Sí | No | Bajo | backend | M |
| Prueba de entrega | `js/core/delivery-proof.js` | Evidencia | Conservar contrato | Sí | No | Bajo | backend | M |
| Estados de pedido | `js/core/order-status.js`, `order-workflow.js` | Máquina de estados | **Fuente de verdad a formalizar** | Sí | Formalizar | **Alto** | negocio + cliente + rider | Todas |
| GPS | `js/delivery.js` | Posición | Vive mientras la pestaña esté abierta | **No** | Reemplazar por foreground service | Alto | permisos del navegador | M |

## Compartido / transversal

| Componente | Ruta | Nota |
|---|---|---|
| Tokens | `styles/tokens.css` | 136 líneas; declara `Inter` sin servirla; 4 valores contradictorios de altura de nav |
| Breakpoints | `styles/responsive.css` | 1.385 líneas; gobierna las tres superficies a la vez |
| Seguimiento cliente | `styles/tracking.css` | 2.981 líneas; **no se toca en esta propuesta**, pero comparte tokens: cualquier cambio de token lo impacta |
| Realtime | `js/realtime.js`, `js/core/realtime-sync.js` | Modificados sin commitear por otro agente; **no tocar** |
| Perfil / checkout | `js/customer-profile-view.js`, `js/core/profile-checkout.js` | Trabajo en curso de otro agente; la propuesta sólo consume la dirección |

## Regla de consolidación propuesta

De **5 tarjetas + 3 steppers + 2 favoritos + 4 medias** se pasa a:

- `p-card` con densidades `grid` (2 col móvil / auto-fill desktop) y `rail` (scroll horizontal)
- `p-media` con `aspect-ratio` fijo y fondo blanco (impuesto por los assets)
- `p-step` único (44px por control)
- `p-fav` único
- `o-card` para el pedido del negocio, con variante de selección en desktop
- `t-row` para todas las filas agrupadas de configuración (negocio y rider)
