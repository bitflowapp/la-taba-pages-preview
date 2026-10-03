# Panel del negocio — móvil

Prototipo: `prototype-business-mobile.html`
Capturas: `screenshots/business-mobile-390x844.png`, `business-mobile-430x932.png`

---

## 1. Problema que resuelve

Hoy el panel en un teléfono es el layout de escritorio comprimido. Medido en
390×844:

- **53 %** de la navegación de secciones queda fuera de pantalla (Catálogo,
  Promociones, Configuración y Guía son invisibles).
- **59 %** de las pestañas de la bandeja queda fuera; el primer estado oculto es
  **"En preparación"**.
- **Cuatro fichas de estadística en 2×2 ocupan ~390 px** para mostrar cuatro
  ceros.
- **No hay navegación de la app**: `responsive.css:1-10` oculta la nav inferior,
  la de escritorio y las acciones del topbar con `!important`.

El resultado: antes de ver el primer pedido, el operador atraviesa título, dos
acciones secundarias, fecha, sonido, cuatro fichas, dos tiras cortadas y un
buscador.

---

## 2. Dos direcciones evaluadas

**Dirección A — Bandeja primero.** Una sola pantalla: los pedidos arriba, todo
lo demás detrás de un botón "Más". Máxima densidad operativa; el resto del
negocio (caja, catálogo, reportes) queda enterrado y sin jerarquía.

**Dirección B — Home operativa + secciones agrupadas.** Una pantalla principal
que responde "¿cómo viene el turno y qué tengo que hacer ahora?", con los
pedidos nuevos accionables en el primer viewport y el resto del negocio en
grupos navegables al estilo Settings.

**Recomendación: B.** El enunciado pide explícitamente secciones agrupadas, y el
panel tiene nueve dominios: aplastarlos detrás de un "Más" reproduce el problema
actual con otra forma. B además permite la navegación progresiva (lista →
detalle) que hoy no existe.

---

## 3. Pantalla principal

```
┌─────────────────────────────────┐
│ TABA          Operación del local│  header 56px, fondo --taba-surface-inverse
├─────────────────────────────────┤
│ jue 30 de julio   ● Sincronizado│  barra de estado 40px
│                   12:04    🔔   │
├─────────────────────────────────┤
│  3      2       1       2       │  resumen operativo, 4 columnas, 64px
│ Nuevos  Prep.  Listos  Camino   │
├─────────────────────────────────┤
│ Pedidos nuevos              3   │
│ ┌─────────────────────────────┐ │
│ │ #1042            hace 2 min │ │  tarjeta de pedido
│ │ Cliente D. · Delivery       │ │
│ │ 3 productos       $ 24.800  │ │
│ │ [ Aceptar ]         Ver  ›  │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ #1041            hace 6 min │ │
│ └─────────────────────────────┘ │
│                                 │
│ OPERACIÓN                       │
│ ┌─────────────────────────────┐ │
│ │ ▦ Pedidos        8 hoy   › │ │  grupo de secciones
│ │ ─────────────────────────── │ │
│ │ ◷ En preparación     2   › │ │
│ │ ─────────────────────────── │ │
│ │ ⛟ Rider         1 activo › │ │
│ └─────────────────────────────┘ │
│                                 │
│ NEGOCIO                         │
│ ┌─────────────────────────────┐ │
│ │ ▤ Catálogo    22 activos › │ │
│ │ ▣ Stock        3 bajos   › │ │
│ │ ▧ Caja           Abierta › │ │
│ └─────────────────────────────┘ │
│                                 │
│ ANÁLISIS                        │
│ ┌─────────────────────────────┐ │
│ │ ▨ Métricas               › │ │
│ │ ▩ Reportes               › │ │
│ │ ⚙ Configuración          › │ │
│ └─────────────────────────────┘ │
└─────────────────────────────────┘
```

### 3.1 Header — 56 px

Fondo `--taba-surface-inverse`. Izquierda: `TABA` (18 px, 900). Derecha:
"Operación del local" (`--text-micro`, `--tracking-caps`, blanco 72 %).

**No lleva "Vista rider" ni "Salir".** Hoy son lo primero después del título y
compiten con la operación. Se mueven: "Vista rider" pasa a la fila *Rider* del
grupo Operación; "Salir" pasa al pie de Configuración.

### 3.2 Barra de estado — 40 px

Fila única sobre `--taba-surface-sunken`:

- Izquierda: fecha larga (`jue 30 de julio`), `--text-meta`.
- Derecha: `.sync-chip` + botón de sonido de 44×44 px con badge de conteo.

El chip de sincronización sigue §8 del sistema de diseño. En `Sin conexión` o
`Desactualizado` la barra crece a 72 px y aparece **Sincronizar ahora** de ancho
completo debajo.

### 3.3 Resumen operativo — 64 px, una fila

**Cambio clave: de 2×2 (~390 px) a 1×4 (64 px).** Cuatro columnas iguales, cada
una con número (22 px, 900) sobre etiqueta (11 px, 800, mayúsculas). Separadores
verticales de 1 px. Sin tarjetas, sin sombras, sin bordes.

Color sólo en el número, según `--prio-*`: Nuevos `--prio-new` (rojo, única
alerta), En preparación `--prio-prep`, Listos `--prio-ready`, En camino
`--prio-transit`. Con valor 0 el número va en `--taba-muted`: **cero no alarma**.

Cada columna es un filtro: toca y abre Pedidos con ese estado.

Ahorro medido frente a hoy: **~326 px** de primer viewport.

### 3.4 Pedidos nuevos

Sólo pedidos en estado `received`, máximo 3, ordenados por antigüedad. Si no hay,
la sección entera no se renderiza (no un estado vacío gigante).

Tarjeta (`.order-card`), ~124 px:

| Zona | Contenido |
|---|---|
| Fila 1 | `#1042` (17 px, 900) · derecha: `hace 2 min` (`--text-meta`) |
| Fila 2 | `Cliente D. · Delivery` (`--text-meta`) |
| Fila 3 | `3 productos` · derecha: `$ 24.800` (17 px, 900) |
| Fila 4 | `[ Aceptar ]` (primario, 44 px, ~60 % del ancho) · `Ver ›` (fantasma) |

**Prioridad sin exceso de rojo:** la tarjeta lleva un filete izquierdo de 3 px en
`--prio-new` y fondo `--taba-surface`. El único elemento rojo lleno es el botón
"Aceptar". Nada de fondo rojo en la tarjeta.

Los nombres de cliente se muestran como `Nombre + inicial` (`Cliente D.`) en la
lista; el nombre completo sólo en el detalle.

### 3.5 Secciones agrupadas

Tres grupos con encabezado en `--text-micro`, mayúsculas, `--taba-muted`:

| Grupo | Filas |
|---|---|
| **Operación** | Pedidos · En preparación · Rider |
| **Negocio** | Catálogo · Stock · Caja |
| **Análisis** | Métricas · Reportes · Configuración |

Fila (`.taba-row`), 52 px:

```
[icono 28px] [título 16px/700] ······ [estado 13px/muted] [chevron]
```

- Superficie del grupo: `--taba-surface`, radio 18 px, `--shadow-xs`.
- Separador de 1 px `--taba-separator` entre filas, con sangría izquierda de
  `--row-gutter + --row-icon` (44 px) — no de borde a borde.
- El estado de la derecha es dato real, nunca decorativo: `8 hoy`, `2`,
  `1 activo`, `22 activos`, `3 bajos`, `Abierta`.
- Un estado que exige atención (`3 bajos`, `Caja sin cerrar`) va en
  `--prio-prep`, no en rojo.
- Iconos de trazo monocromo de TABA. Ninguno de Apple.

### 3.6 Navegación

**Sin pestañas horizontales.** Se elimina `.business-jump-nav` como navegación
principal: las nueve secciones son filas verticales.

Dentro de una sección (por ejemplo Pedidos) los estados no son una tira
scrolleable sino un **selector de segmento de ancho completo** con como máximo 4
opciones visibles (`Nuevos · Prep. · Listos · Todos`), y "En reparto",
"Finalizados" y "Cancelados" detrás de un filtro explícito. Ninguna opción queda
cortada en 320 px.

La navegación hacia atrás es un header de detalle con `‹ Volver` de 44 px. Se
mantiene oculta la nav inferior del cliente (correcto: son dos apps distintas),
pero **cada pantalla del negocio tiene retorno explícito**.

### 3.7 Una sola acción primaria por pantalla

En la home operativa la única acción primaria es **Aceptar** en la primera
tarjeta de pedido nuevo. Todo lo demás es secundario o fantasma. Hoy compiten la
pestaña activa (botón rojo lleno), "Vista rider" y las acciones de cada pedido.

---

## 4. Detalle de pedido

Pantalla completa (no sheet: hay demasiado contenido y acciones destructivas).
Operable con una mano: **todo lo accionable en el tercio inferior**.

```
┌─────────────────────────────────┐
│ ‹ Volver              #1042     │  header 56px sticky
├─────────────────────────────────┤
│ ● Nuevo · hace 2 min            │  píldora de estado
│                                 │
│ Cliente Demo                    │  20px/850
│ 299 000 0001            [Llamar]│  teléfono + acción 44px
│                                 │
│ Delivery                        │
│ Avenida Argentina 450           │
│ Portón negro, timbre 2          │
│                          [Mapa] │
├─────────────────────────────────┤
│ PRODUCTOS                       │
│ 2× Coca-Cola Original  $ 34.200 │
│ 1× Sprite               $ 17.100│
│ ─────────────────────────────── │
│ Total                  $ 51.300 │  20px/900
├─────────────────────────────────┤
│ CÓDIGO DE ENTREGA               │
│        4 7 2 9                  │  36px/900, tabular
├─────────────────────────────────┤
│ HISTORIAL                       │
│ ● 12:02  Pedido recibido        │
│ ○ —      Aceptado               │
├─────────────────────────────────┤
│ Rider                        ›  │  fila de sección
├─────────────────────────────────┤
│ [ Aceptar y preparar ]          │  CTA sticky, 52px
│ Rechazar                        │  texto, 44px
└─────────────────────────────────┘
```

### 4.1 CTA de estado

Una sola acción primaria sticky al pie, sobre `--safe-area-bottom`. La etiqueta
depende del estado, y **avanza el pedido un paso**:

| Estado | CTA | Secundaria |
|---|---|---|
| Nuevo | `Aceptar y preparar` | `Rechazar` |
| En preparación | `Marcar listo` | `Volver a nuevo` |
| Listo | `Asignar rider` | `Entregado en local` |
| En reparto | `Marcar entregado` | `Ver seguimiento` |
| Entregado | — (sin CTA) | `Ver comprobante` |

`Rechazar` y `Volver a nuevo` son texto plano, nunca botones rojos llenos:
una acción destructiva no debe tener más peso visual que la constructiva.

### 4.2 Contenido

- **Número**: `#1042` en el header, junto a `‹ Volver`.
- **Estado**: píldora con punto de color `--prio-*` + tiempo relativo.
- **Cliente y teléfono**: nombre completo; el teléfono es un `tel:` de 44 px.
- **Modalidad y dirección**: `Delivery` o `Retiro en local`. En retiro, el bloque
  de dirección no se renderiza.
- **Productos**: cantidad · nombre · subtotal. Total en 20 px/900.
- **Código de entrega**: 36 px, cifras tabulares, muy separadas. Es lo que el
  operador lee en voz alta.
- **Historial**: línea de tiempo con hora real; los pasos futuros en hueco.
- **Rider**: fila de sección; abre asignación y contacto.

### 4.3 Una sola mano

- CTA y secundaria en los últimos 120 px.
- `Llamar`, `Mapa` y la fila `Rider` a la derecha, dentro del alcance del pulgar.
- Nada accionable entre 0 y 200 px desde arriba salvo `‹ Volver`.

---

## 5. Comportamiento por breakpoint

| Ancho | Estructura |
|---|---|
| **320** | Padding 12 px. Resumen en 4 columnas con número 20 px. Grupos a ancho completo. Tarjeta de pedido: `Aceptar` a ancho completo y `Ver ›` debajo. |
| **390** | Padding 16 px. Resumen 4 columnas, número 22 px. `Aceptar` + `Ver ›` en la misma fila. |
| **430** | Igual que 390 con más aire. Se agrega la presentación del producto en la lista. |
| **768** | Los tres grupos pasan a **2 columnas**. Los pedidos nuevos pasan a 2 columnas. El resumen se mantiene en una fila. |
| **≥900** | Cambia la estructura: master-detail (ver `BUSINESS_DESKTOP_SPEC.md`). |

---

## 6. Presupuesto vertical en 390×844

| Bloque | Alto |
|---|---|
| Header | 56 px |
| Barra de estado | 40 px |
| Resumen operativo | 64 px |
| Encabezado "Pedidos nuevos" | 32 px |
| Primera tarjeta de pedido | 124 px |
| **Total hasta la primera acción** | **316 px (37 %)** |

Quedan ~528 px visibles: segunda tarjeta completa y el arranque del grupo
Operación. Hoy, en esos mismos 844 px, no se ve un solo pedido.

---

## 7. Accesibilidad

- Filas de sección: `<a>` o `<button>` de 52 px con el estado dentro del nombre
  accesible (`Stock, 3 productos con stock bajo`).
- Chevron `aria-hidden`.
- Resumen operativo: `role="group"` con `aria-label="Cola operativa"`; cada
  columna es un botón con `aria-pressed`.
- Chip de sincronización: `aria-live="polite"`.
- El sonido de pedido nuevo se acompaña de cambio visual (nunca sólo audio).
- Un único `aria-current="page"` por documento.
- El foco vuelve a la tarjeta de origen al cerrar el detalle.
