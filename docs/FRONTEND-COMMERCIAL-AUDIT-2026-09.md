# Frontend comercial · revalidación de la auditoría de septiembre

Fecha: 2026-09-26. Rama: `fix/taba-commercial-frontend-and-fiscal`.

## Fuente de verdad

| Dato | Valor |
|---|---|
| Auditoría histórica | `audit/FRONTEND_AUDIT.md`, hecha sobre `main` `61cc57d` (135 commits detrás del release). Se usó sólo como lista de hipótesis. |
| Base de esta revalidación | `release/taba-controlled-production` `de5c9f2` (Merge #100). Durante el trabajo el release avanzó a `8271035` (Merge #101: sólo `deploy/controlled-production.json` y un documento; ningún archivo del frontend). |
| Desplegado en CONTROLLED_PRODUCTION al empezar | `de5c9f2` (`CP_DEPLOY_SHA`, deploy run 36203037951 OK), identidad `la-taba-runtime-v118-online-payments-gate`. |
| Backend real consultado (sólo lectura) | negocio `La Taba`, `status=closed`, pedidos sin habilitar, 0 productos, sin horario ni WhatsApp publicados. |

Cómo se midió:

- **En vivo, sólo lectura**: la web de CONTROLLED_PRODUCTION en Chromium a 390, 1440 (raíz, `#business`, `#rider`, `#tracking`, `#profile`, `?demo=1`, `/pago/resultado/`).
- **Producción simulada**: la misma build servida local con `runtime-config` productivo (`deploymentEnvironment: pilot`) y Supabase interceptado, en cuatro escenarios: tienda abierta con catálogo real de fotos, datos idénticos a CP hoy, cerrada con próxima apertura, y backend caído (503). Chromium en 390×844, 430×932, 768×1024, 1366×768, 1440×900 y WebKit iPhone 13.
- **Panel**: `scripts/business-panel-responsive.mjs` (12 anchos × 12 pantallas, contraste, áreas táctiles, desborde) y el Panel en navegador sin el shell de Windows.

## Hallazgos de la auditoría vieja, uno por uno

| # | Hallazgo histórico | Estado en el release | Qué pasó |
|---|---|---|---|
| P0-1 | Pantalla negra en la raíz | **STILL_PRESENT → corregido** | En CP la raíz mostraba una tarjeta suelta: «Pedidos online no disponibles · El catálogo verificado todavía no está disponible. Los pedidos permanecen bloqueados.» Ahora es la entrada del local (nombre, estado, dirección publicada, contacto si está verificado, «Seguir un pedido») con los datos que ya contestó el backend. `cd32103`. |
| P0-2 | Dos paneles (PIN demo vs Supabase) | **ALREADY_FIXED** | En producción `#business` es sólo el ingreso con cuenta; `?demo=1`, `?showcase=1`, el PIN y la presentación se ignoran (verificado en vivo y en código). |
| P0-3 | Catálogo del panel ≠ catálogo del cliente | **DEMO_ONLY** | En producción los dos leen `products` del mismo negocio. La diferencia era de los datos de la demo. |
| P1-1 | «Precio pendiente» masivo | **DEMO_ONLY en volumen; residual en producción → corregido** | La consulta productiva ya excluye casi todo lo no vendible; quedaba el camino de vidriera de alcohol. En producción un precio no confirmado ya no se publica. `b02265c`. |
| P1-2 | Toast tapa la barra del comercio | **STILL_PRESENT (otra forma) → corregido** | En el Panel productivo el aviso se apoyaba sobre la barra inferior y era blanco sobre gris claro (1,16:1). `bf6eb84`. |
| P1-3 | Doble buscador en escritorio | **STILL_PRESENT → corregido** | Home y catálogo tenían el de la barra y el de la vista. `12cf725`. |
| P1-4 | Contraste del modal de PIN | **DEMO_ONLY / REGRESSION en el ingreso real → corregido** | El modal es de la demo. El ingreso productivo tenía «Creá tu cuenta» y «Olvidé mi contraseña» a 1,66:1 y «Esperando» a 2,22:1. `0666396`, `809ded5`. |
| P1-5 | Mercado Pago «opaco» en checkout | **NO_LONGER_RELEVANT** | CP opera con cobro manual y el checkout lo dice: «El pago se coordina directamente con el local» y el cobro queda pendiente hasta registrarlo. No se tocó (Mercado Pago está fuera de esta misión). |
| P2-1 | «Cliente Demo» y direcciones ficticias | **ALREADY_FIXED en producción** | El checkout productivo arranca vacío y lleva el foco al primer campo inválido. Los datos ficticios existen sólo en la demo. |
| P2-2 | Vista previa de configuración cruda | **DEMO_ONLY** | Es del panel de la demo. |
| P2-3 | Tres lenguajes visuales | **Parcial** | Los dos casos ilegibles medidos (toast del Panel, enlaces del ingreso) se corrigieron. No se hizo un rediseño. |
| P2-4 | Slugs técnicos en el panel | **DEMO_ONLY** | El panel productivo no los muestra. |
| P2-5 | Chip de 28px sin nombre accesible | **NO_LONGER_RELEVANT / corregido** | El botón de sonido ya tiene nombre. El chip «Sólo este equipo» es del relay de la demo y afirmaba algo falso en producción: ahora es sólo de la demo. `0666396`. |
| P3-2 | Mojibake | **NO_LONGER_RELEVANT** | No se reprodujo en el release. |

## Hallazgos nuevos del release

| Pri | Hallazgo | Resolución |
|---|---|---|
| P1 | Nombre interno «La Taba 2» en cada arranque productivo y cuando falla la configuración; «TABA2» en las páginas de retorno de pago y en la tarjeta del rider; «Cobertura no publicada» en el mapa | `2f5311b` |
| P1 | Panel: la primera tarjeta de pedido empezaba a 494px en 390×844 y a 589px en 1366×768 | 390px y 509px, acción principal visible en la primera pantalla. `12e09cb` |
| P1 | Panel: jerga de sistema («Acceso seguro requerido · cuenta owner», «Sin comandos pendientes», «Última reconciliación: sin reconciliación confirmada», «Revisión contable: approved · Gate: blocked», «el cliente envía sólo IDs y cantidades») | `0666396`, `12e09cb`, `91c1004` |
| P1 | Una línea de 1px cruzaba el catálogo de escritorio de arriba abajo; el orden «Recomendados» se recortaba | `12cf725` |
| P2 | Una bebida alcohólica agotada decía «Próximamente / Todavía no está a la venta» | `a0d5086` |
| P2 | Con el backend caído, la entrada quedaba en «cargando» para siempre (ningún render repintaba el error) | `cd32103` |
| P2 | La web espera a `maplibre-gl.js` (1 MB, unpkg, `defer`) antes de ejecutar `app.js`: con el CDN lento la tienda tarda en arrancar | **Documentado, no corregido**: toca el mapa de seguimiento, que está certificado. Recomendado: carga diferida o auto-hospedada. |
| P2 | El E2E `panel-access-registration` reescribe capturas versionadas en `artifacts/` | Documentado; no se versionaron esas capturas. |

## Resultado medido después

- Panel (`scripts/business-panel-responsive.mjs`, 144 combinaciones): contraste < 4,5:1 **19 → 0**, áreas táctiles < 44px **0**, desborde horizontal **0**.
- Tienda productiva simulada, Chromium 5 anchos + WebKit iPhone 13: sin desborde, sin «Precio pendiente», sin «Cliente Demo», sin nombres internos, un solo buscador en escritorio.
- Identidad PWA: `la-taba-runtime-v119-commercial-frontend`, `app.js?v=51`, cadena CSS `?v=61`. `npm run check` pasa; actualización del worker, recuperación degradada, instalación e iOS en Chromium y WebKit: 87/87.

## Lo que no se tocó a propósito

Pedidos, stock, RLS, esquema, contratos del Rider, Mercado Pago, pago manual, OAuth, webhooks, worker de pagos, idempotencia y roles. Ningún cambio de esta rama toca el backend.
