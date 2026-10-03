# Artefactos · TABA2 mobile brand refresh

Fuera de Git a propósito. Generados contra el build real del worktree
`la-taba2-mobile-brand-refresh`, rama `feature/taba2-mobile-brand-refresh`.

## shots/

Capturas reales del producto (no maquetas), `NN-estado--ANCHOxALTO.png`.

Viewports: 320×568 · 360×800 · 390×844 · 393×852 · 412×915 · 768×1024 · 1440×1000

| Prefijo | Estado |
| --- | --- |
| `01-home-normal` | Home tal como carga |
| `02-carrito-vacio` | Carrito vacío (sin barra sticky) |
| `03-carrito-con-productos` | Carrito con producto (barra sticky roja sobre la nav) |
| `04-busqueda-activa` | Búsqueda escrita desde la home |
| `05-categoria-seleccionada` | Categoría elegida desde la fila |
| `06-precio-pendiente` | Catálogo filtrado por precio pendiente |
| `07-historias-inactivas` | Sin historias publicadas: logo sin aro, sin acceso |
| `08-historias-activas` | Con fixture de test: aro encendido + acceso |
| `09-historias-visor` | Visor de historias abierto |
| `10-reduced-motion` | `prefers-reduced-motion: reduce` |

## zoom/

Recortes por componente a 3× para revisión de detalle: encabezado, fila de
categorías, banner, título de sección, tarjeta destacada, tarjeta de catálogo y
navegación inferior.

## Cómo se regeneran

Con el servidor estático local levantado sobre el worktree, se ejecutan los
scripts de captura del scratchpad de la sesión. No forman parte del repositorio
porque no son parte del producto.
