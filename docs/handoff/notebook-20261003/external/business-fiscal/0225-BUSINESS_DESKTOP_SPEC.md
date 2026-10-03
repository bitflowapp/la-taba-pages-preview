# Panel del negocio — escritorio

Prototipo: `prototype-business-desktop.html`
Captura: `screenshots/business-desktop-1280x900.png`

---

## 1. Problema que resuelve

Medido a 1280×900, el panel actual es **una sola columna centrada**:

- Cuatro fichas de estadística estiradas a ~440 px cada una para mostrar un
  dígito.
- Dos tiras de pestañas de ancho completo, una debajo de la otra.
- Por debajo del contenido, **~500 px de blanco vacío**.
- Sin sidebar, sin cola persistente, sin inspector, sin búsqueda visible junto a
  los resultados.

Es el layout móvil estirado. El operador de mostrador trabaja en una pantalla
grande y tiene que navegar como si estuviera en un teléfono: para ver el detalle
de un pedido pierde de vista la cola.

**No** se propone un dashboard de tarjetas decorativas. Se propone la
herramienta de trabajo real: ver la cola y operar un pedido **al mismo tiempo**.

---

## 2. Layout master-detail de tres paneles

```
┌──────┬──────────────────────────────────────────────────────────────┐
│      │ TABA · Sucursal Centro    jue 30 jul   ● Sincronizado 12:04 │ 56
│      ├──────────────────────────────────────────────────────────────┤
│ ▦ 3  │ 3 Nuevos │ 2 Prep. │ 1 Listos │ 2 Camino │ $124.500 hoy     │ 56
│ Ped. ├───────────────────────┬──────────────────────────────────────┤
│      │ 🔍 Buscar pedido      │  #1042              ● Nuevo         │
│ ⛟ 1  │ [Nuevos][Prep][Listos]│  hace 2 min                          │
│ Rider│───────────────────────│──────────────────────────────────────│
│      │ ┃#1042      hace 2 min│  Cliente Demo                        │
│ ▤    │ ┃Cliente D. · Delivery│  299 000 0001            [Llamar]    │
│ Catál│ ┃3 prod.     $ 24.800 │                                      │
│      │───────────────────────│  Delivery                            │
│ ▣    │  #1041     hace 6 min │  Avenida Argentina 450               │
│ Stock│  Cliente M. · Retiro  │  Portón negro, timbre 2              │
│      │  1 prod.    $ 17.100  │                                      │
│ ▧    │───────────────────────│  ─────────────────────────────────── │
│ Caja │  #1040    hace 14 min │  PRODUCTOS                           │
│      │  Cliente R. · Delivery│  2× Coca-Cola Original    $ 34.200   │
│ ▨    │  5 prod.    $ 41.900  │  1× Sprite                $ 17.100   │
│ Métr.│───────────────────────│  Total                    $ 51.300   │
│      │                       │                                      │
│ ▩    │                       │  CÓDIGO DE ENTREGA   4 7 2 9         │
│ Rep. │                       │                                      │
│      │                       │  HISTORIAL                           │
│ ⚙    │                       │  ● 12:02  Pedido recibido            │
│ Conf.│                       │                                      │
│      │                       │  [ Aceptar y preparar ]  Rechazar    │
└──────┴───────────────────────┴──────────────────────────────────────┘
  216px         360px                      resto (fluido)
```

### 2.1 Sidebar — 216 px fija

Fondo `--taba-surface-inverse`. Arriba el logo TABA. Debajo, las nueve secciones
como filas verticales de 44 px con icono + etiqueta + badge numérico.

Los mismos nueve dominios que en móvil, en el mismo orden y con los mismos
nombres: **Pedidos, En preparación, Rider, Catálogo, Stock, Caja, Métricas,
Reportes, Configuración**. Móvil y escritorio comparten el modelo mental; sólo
cambia la disposición.

Sección activa: fondo blanco 8 % + filete izquierdo de 3 px en `--taba-red`.
Es el único uso de rojo de la sidebar.

A ≥1440 px la sidebar crece a 240 px. A <1024 px colapsa a 64 px (sólo iconos
con tooltip).

### 2.2 Barra superior — 56 px

- Izquierda: nombre del negocio y sucursal.
- Centro: fecha.
- Derecha: `.sync-chip`, botón de sonido, avatar/salir.

Sticky. Fondo `--taba-surface`, borde inferior `--taba-border`.

### 2.3 Franja de métricas — 56 px

**Una fila, no cuatro tarjetas.** Cinco celdas separadas por líneas de 1 px:
Nuevos · En preparación · Listos · En camino · Facturado hoy. Número 20 px/900 a
la izquierda, etiqueta 12 px a la derecha, en la misma línea.

Cada celda es un filtro de la cola, con `aria-pressed`.

Frente a hoy: **de ~200 px de tarjetas a 56 px**, y se agrega el dato que
faltaba (facturación del día).

### 2.4 Panel izquierdo — cola, 360 px

Encabezado fijo con:

- Campo de búsqueda (`ID, cliente o dirección`), 40 px.
- Selector de segmento de estados: `Nuevos · Prep. · Listos · Todos`. Con 360 px
  entran cuatro sin cortarse. "En reparto", "Finalizados" y "Cancelados" van en
  un menú `Más filtros`.

Lista scrolleable independiente. Ítem (`.queue-item`), 92 px:

```
┃ #1042                    hace 2 min
┃ Cliente D. · Delivery
┃ 3 productos               $ 24.800
```

- Filete izquierdo de 3 px con el color `--prio-*` del estado.
- Seleccionado: fondo `--taba-surface-sunken` + filete de 3 px en
  `--taba-ink`. **No rojo**: el rojo ya significa "nuevo" en el filete.
- `↑` / `↓` navegan la cola; `Enter` acepta el pedido enfocado.

### 2.5 Panel derecho — inspector, fluido

El mismo contenido del detalle móvil, en dos columnas cuando el ancho lo
permite:

| ≥1280 px | Columna A (60 %) | Columna B (40 %) |
|---|---|---|
| | Cliente, modalidad, dirección, productos, total | Código de entrega, historial, rider |

Pie de acciones sticky dentro del panel: `[ Aceptar y preparar ]` + `Rechazar`
alineados a la derecha.

Sin selección: estado vacío honesto — `Elegí un pedido de la cola` y, si la cola
está vacía, `Sin pedidos en la cola` con el chip de sincronización.

---

## 3. Módulos separados

**Pedidos, En preparación y Rider** usan el layout master-detail de tres paneles.

**Catálogo, Stock, Caja, Métricas, Reportes y Configuración** usan un layout de
**un panel de contenido** (sidebar + barra superior + área única). No fuerzan una
cola que no tienen.

| Módulo | Layout | Contenido |
|---|---|---|
| Catálogo | Tabla densa | Producto · categoría · precio · stock · estado · acciones |
| Stock | Tabla densa | Producto · disponible · mínimo · acción rápida ±  |
| Caja | 2 columnas | Movimientos del día / Resumen y cierre |
| Métricas | Grilla 2×2 | Ventas por hora, productos top, ticket medio, canal |
| Reportes | 1 columna | Selector de período + tabla exportable |
| Configuración | 2 columnas | Formulario / Vista previa (ya existe: `.business-setup-layout`) |

Las tablas usan `.data-table`: fila de 44 px, encabezado sticky, alineación
numérica a la derecha, cifras tabulares. **No** se comprimen a móvil: por debajo
de 900 px cada fila se convierte en tarjeta.

---

## 4. Comportamiento por breakpoint

| Ancho | Estructura |
|---|---|
| **<900** | Sin master-detail. Layout móvil completo (`BUSINESS_MOBILE_SPEC.md`). |
| **900–1279** | Sidebar 64 px (iconos). **Dos** paneles: cola 320 px + inspector. La franja de métricas muestra 4 celdas (sin facturación). |
| **1280–1439** | Sidebar 216 px con etiquetas. Cola 360 px + inspector. Inspector en 1 columna. |
| **≥1440** | Sidebar 240 px. Cola 380 px. **Inspector en 2 columnas.** Franja con 5 celdas. |

El cambio entre 899 y 900 px es **estructural**, no de escala: se pasa de una
pila vertical con navegación por filas a tres paneles con scroll independiente.

---

## 5. Densidad — comparación

| Métrica a 1280×900 | Hoy | Propuesto |
|---|---|---|
| Alto del encabezado hasta el contenido | ~660 px | 112 px |
| Pedidos visibles sin scrollear | 0 | **7** |
| Detalle visible junto a la cola | no | sí |
| Espacio vertical vacío | ~500 px | 0 |
| Superficies rojas grandes | 1 (pestaña activa) | 0 |

---

## 6. Accesibilidad

- Sidebar: `<nav>` con `aria-label="Secciones del negocio"`; un solo
  `aria-current="page"`.
- Cola: `role="listbox"` con `aria-activedescendant`; el inspector es
  `aria-live="polite"` para anunciar el cambio de selección.
- Los tres paneles tienen `tabindex="-1"` y un salto de teclado
  (`Alt+1` cola, `Alt+2` inspector).
- Encabezados de tabla con `scope="col"`; orden con `aria-sort`.
- Foco visible sobre fondo oscuro: `--taba-focus` aclarado, ya resuelto por
  `:focus-visible` en `tokens.css`.
- Contraste sobre `--taba-surface-inverse`: etiquetas de sidebar a blanco 88 %
  (≥7:1); badges en blanco pleno.
