# TABA — Plan de pruebas web

Complementa `rider-android/RIDER_ANDROID_TEST_PLAN.md`. **No se ejecutó la suite del repositorio en esta sesión**, por indicación explícita del encargo.

## Breakpoints obligatorios

`320×568 · 375×667 · 390×844 · 393×852 · 412×915 · 430×932 · 768×1024 · 1024×768 · 1280×900 · 1440×1000 · 1920×1080`

## Unitarias

| Módulo | Qué se prueba |
|---|---|
| `js/core/storefront-filters` | Intersección categoría × consulta; el contador coincide con la longitud de la lista |
| `js/ui` — meta del catálogo | El título usa la consulta si existe, la categoría si no |
| `js/ui` — estado vacío | Las tres variantes (favoritos, búsqueda, categoría) con su copy y su acción |
| `js/ui` — estado del carrito | `document.body.dataset.cart` refleja el contador |
| `js/core/order-status` | Tabla de transiciones válidas e inválidas |
| Datos de catálogo | `(nombre, presentación)` es único — **hoy falla**: “Speed Unlimited · Lata · 473 ml · Unidad” está duplicado |
| Tokens | Contraste de la matriz texto×superficie y borde×superficie |

## E2E

### Cliente

1. Home → catálogo → agregar 2 productos → carrito → checkout → confirmar.
2. Buscar sin resultados → el título muestra la consulta → “Limpiar búsqueda” → vuelven los 22.
3. Con 4 productos en el carrito, buscar sin resultados → **el contador del carrito sigue en 4** (regresión de P1-06).
4. Producto sin precio → no se puede agregar → “Consultar” abre el detalle.
5. Favoritos vacíos → guardar uno → aparece en la categoría.
6. Detalle: abrir, `Esc` cierra, el foco vuelve al disparador.
7. Recargar con carrito lleno → el carrito persiste y la reserva inferior es la correcta.

### Negocio

8. PIN → cola → aceptar → preparar → listo → entregar a rider.
9. Filtrar por cada estado de la banda; el contador coincide con la lista.
10. Buscar un pedido por ID, cliente y dirección.
11. Detalle → acción primaria sticky → confirmación de la acción destructiva.
12. Simular pérdida de conexión → franja con la hora del último dato → recuperar → franja verde.

### Seguimiento

13. Recorrido completo de estados con los nombres de la tabla de vocabulario único.

## Responsive

Para cada uno de los 11 breakpoints, en las 6 vistas:

| Aserción | Umbral |
|---|---|
| `documentElement.scrollWidth - clientWidth` (**con `overflow-x` desactivado**) | 0 px |
| Objetivos interactivos `< 44px` en superficie táctil | 0 |
| `input`/`select`/`textarea` con `font-size < 16px` | 0 |
| Texto visible `< 11px` | 0 |
| Nodos de texto cruzados por el stack inferior al final del scroll | 0 |
| Errores de consola y `pageerror` | 0 |

## Sticky y safe areas

- Stack inferior en las 7 anchuras móviles × carrito vacío/lleno.
- Toast por encima del stack, nunca sobre contenido.
- `button-row` del checkout visible con el teclado virtual abierto.
- **iPhone físico con barra de gestos** y **Android físico con navegación por gestos**: la emulación devuelve `env(safe-area-inset-bottom) = 0` y no prueba nada.

## Regresión visual

6 vistas × 11 breakpoints = 66 capturas por corrida, con `deviceScaleFactor: 2` y `reducedMotion: 'reduce'`. Umbral de diferencia del 0,1 % con aprobación manual de los cambios esperados.

**Incluir obligatoriamente la vista de seguimiento**, aunque no se modifique: hereda los tokens y es el archivo CSS más grande del proyecto.

## Accesibilidad

| Nivel | Qué | Cómo |
|---|---|---|
| Automático | Reglas ARIA, roles, nombres accesibles | `axe-core` en las 6 vistas |
| Automático | Contraste de la matriz de tokens | Script sobre `TOKENS.json` |
| Automático | Objetivos, fuente de inputs, desbordamiento, solape | El `capture.mjs` de esta propuesta portado |
| Manual | Recorrido completo con teclado | Por release |
| Manual | VoiceOver (iPhone) en catálogo y checkout | Por release |
| Manual | TalkBack (Android) en catálogo y checkout | Por release |
| Manual | Zoom 200 % y 400 % | Por release |
| Manual | Orientación horizontal en móvil | Por release |

## Offline y conexión

- Service worker: primera carga, recarga, actualización disponible, sin conexión.
- Panel del negocio: pérdida y recuperación de Realtime, con la franja y la hora del último dato.
- **Verificar que un cambio de CSS invalida la caché del SW**: es un riesgo real de la etapa 1.

## Estados vacíos

Cada uno con captura de referencia: catálogo sin resultados por búsqueda · sin resultados por categoría · favoritos vacíos · catálogo no disponible · carrito vacío · negocio sin pedidos · negocio sin conexión · negocio con búsqueda sin resultados · local cerrado.

## Herramienta reutilizable

`diagnostics/capture.mjs` de esta propuesta ya implementa desbordamiento, objetivos táctiles, fuente de inputs, inventario de superficies fijas con z-index y altura, detección de solape al final del scroll, y errores de consola. Usa el Playwright que el repositorio ya tiene instalado. **Portarlo es trabajo mecánico ideal para Codex.**

Encontró 10 incumplimientos reales de objetivos táctiles y un caso de solape en la primera versión de estos prototipos — incluidos controles que a simple vista parecían correctos.
