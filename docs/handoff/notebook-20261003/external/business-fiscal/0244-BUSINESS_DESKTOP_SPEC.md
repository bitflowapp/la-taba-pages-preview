# TABA — Panel del negocio desktop

Prototipo: `prototypes/prototype-business-desktop.html`
Capturas: `business-desktop-1024x768`, `-1280x900`, `-1440x1000`, `-1920x1080`, `business-tablet-768x1024`.

## Premisa

No es la versión móvil ampliada. En escritorio el operador **no debería navegar** para trabajar: ve la cola y el detalle a la vez, y actúa sin perder de vista lo que entra. La arquitectura es **master-detail**, con el número de paneles gobernado por el ancho disponible.

---

## Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Barra superior 56px · TABA · local · abierto · buscador · sync · 🔔 · 👤 │
├──────────┬─────────────────────┬───────────────────────┬─────────────────┤
│ Sidebar  │ Métricas 46px       │  Detalle del pedido   │ Riel de acciones│
│ 224px    ├─────────────────────┤  seleccionado         │ 300px (≥1440)   │
│          │ Tabs de estado      │                       │                 │
│ Pedidos  ├─────────────────────┤  cliente · dirección  │ [Aceptar]       │
│ Riders   │                     │  código · rider       │ [Demorar]       │
│ Catálogo │  Cola de pedidos    │  productos · totales  │ [Rechazar…]     │
│ Stock    │  360–380px          │  línea de tiempo      │                 │
│ Caja     │  scroll propio      │                       │ tiempos         │
│ Métricas │                     │                       │ observaciones   │
│ Reportes │                     │                       │                 │
│ Config.  │                     │                       │                 │
└──────────┴─────────────────────┴───────────────────────┴─────────────────┘
```

Cada panel tiene **scroll propio** (`min-height: 0` + `overflow: auto`): la cola se recorre sin mover el detalle.

## Barra superior — 56px

`[TABA] [TABA Neuquén Centro / jueves 31 · abierto hasta 23:30] [● Abierto] [buscador] —— [● Sincronizado] [🔔] [👤]`

Al angostarse, **suelta contexto secundario antes que la búsqueda**: por debajo de 1120px desaparecen el nombre del local y la pill de estado (que siguen disponibles en la sección Local), y el buscador se reduce con `clamp()`. Es la corrección de un desbordamiento de 37px detectado al medir a 768px.

## Sidebar — 224px

Ocho secciones con contador: **Pedidos 10 · Riders 3 · Catálogo 22 · Stock ⚠1 · Caja · Métricas · Reportes · Configuración**, y “Salir” al pie separado por una línea.

Filas de 44px, activo `ink-900` con texto blanco. Los contadores son datos, no decoración: “Stock ⚠1” señala el producto sin precio sin entrar a la sección.

Por debajo de 1280px colapsa a **riel de iconos de 68px** manteniendo 44px de área táctil.

## Métricas — 46px, sólo accionables

`4 Nuevos · 2 Preparando · **1 Demorados** · 1 Listos · $21.400 Ticket prom. · 17′ Prep. media`

Una banda, no tarjetas. Reglas:

1. **Sólo métricas sobre las que se puede actuar ahora.** “Demorados” en `danger` porque exige una decisión; “ticket promedio” y “tiempo medio” porque calibran la operación del día.
2. Nada de tarjetas decorativas, sparklines ni comparativas de período: eso es la sección Reportes.
3. `tabular-nums` para que los números no salten al actualizarse.

## Columna de cola — 360–380px

- **Tabs de estado**: Todos 10 · Nuevos 4 · Preparando 2 · Listos 1 · En camino 3. Densidad de escritorio (34px) que **sube a 44px por debajo de 1024**, donde la pantalla es táctil.
- **Búsqueda**: en la barra superior (el ancho lo permite), no duplicada acá.
- **Lista**: la misma `o-card` que en móvil, con selección (`aria-selected`, borde `ink-900` + halo de 1px) y sin botón de acción — en escritorio la acción vive en el detalle o en el riel, no repetida por fila.
- Densidad operativa: ~132px por tarjeta, ~6 pedidos visibles a 900px de alto.

## Panel central — detalle

Ancho máximo de 780px para que las líneas de texto no se estiren. Contenido:

1. **Encabezado**: `#A-1042`, pill de estado, “Recibido 14:18 · hace 6 min · Envío a domicilio · Efectivo”.
2. **Dos columnas** (una sola por debajo de 1180px):
   - Cliente (con teléfono enmascarado: `+54 ··· ··4821`) y dirección con referencia y distancia.
   - **Código de entrega** destacado y fila “Rider · 2 disponibles · [Asignar]”.
3. **Productos**: cantidad, nombre + presentación atenuada, importe; subtotal, envío, pago con vuelto calculado, total.
4. **Seguimiento**: línea de tiempo vertical con el paso actual en rojo.

**Sin pedido seleccionado**: estado vacío centrado — “Elegí un pedido de la cola”. No una pantalla en blanco.

## Riel de acciones — 300px, sólo ≥1440

- **Acción**: una primaria roja (“Aceptar y preparar”) + secundaria (“Demorar 10 minutos”) + destructiva con contorno (“Rechazar pedido…”).
- **Tiempos**: espera del cliente · promesa de entrega · distancia.
- **Observaciones**: nota del cliente en una tarjeta legible.

Por debajo de 1440px estas acciones se integran al pie del panel de detalle. **Nunca se duplican**: o riel, o detalle.

## Comportamiento por breakpoint

| Viewport | Paneles | Sidebar | Cola | Detalle | Riel | Notas |
|---|---|---|---|---|---|---|
| **768×1024** (tablet vertical, táctil) | 2 | Riel de iconos 68px | Ocupa el resto | **Oculto** — se abre como hoja al elegir | No | Tabs de estado suben a 44px; la barra superior suelta nombre y pill |
| **1024×768** | 3 | Riel 68px | 330px | Flexible | No | Detalle a una columna (<1180) |
| **1280×900** | 3 | 224px completo | 360px | Flexible | No | Acciones al pie del detalle |
| **1440×1000** | 4 | 232px | 380px | Flexible | **300px** | Configuración de referencia |
| **1920×1080** | 4 | 232px | 380px | Flexible | 300px | Contenido limitado a **1800px** centrado con bordes laterales |

En 1920 se limita el ancho: una cola de 700px y un detalle de 1000px sólo alejan la información entre sí.

## Estados

- **Sin pedidos** — estado vacío en la columna de cola; el detalle muestra su propio vacío.
- **Sin conexión** — punto e etiqueta en la barra superior pasan a `warning`; la cola muestra “Sin conexión · último dato 14:32” con “Sincronizar ahora”.
- **Reconectando** — `info`, con cambios en cola contabilizados.
- **Búsqueda sin resultados** — nombra la consulta y ofrece limpiarla.

## Qué NO se hace

- No hay tabla de pedidos: una tabla obliga a leer en horizontal y no cabe el estado, la demora y la acción sin scroll lateral.
- No hay dashboard de KPIs en la pantalla de operación.
- No se repite la acción primaria en la fila de la cola **y** en el detalle **y** en el riel.
- No se usan modales para el detalle: bloquean la vista de la cola, que es justamente lo que hay que seguir mirando.

## Verificación

| Aserción | Umbral |
|---|---|
| Desbordamiento horizontal en 768/1024/1280/1440/1920 | 0 px |
| Objetivos táctiles en 768 | ≥ 44px |
| Pedidos visibles sin scroll en 1280×900 | ≥ 5 |
| Acciones primarias visibles a la vez | 1 |
| Scroll independiente por panel | sí |
| Errores de consola | 0 |
| Barra superior a 768 | sin desbordar, con buscador utilizable |
