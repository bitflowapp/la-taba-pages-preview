# TABA — Panel del negocio móvil

Prototipo: `prototypes/prototype-business-mobile.html`
Capturas: `business-mobile-home-390x844`, `-430x932`, `business-mobile-order-detail-390x844`, `business-mobile-offline-390x844`, `business-mobile-empty-390x844`, `business-mobile-sections-390x844`.

## Premisa

**No es el dashboard de escritorio comprimido.** Es una aplicación operativa para una persona que atiende el mostrador con una mano y mira el teléfono de reojo.

Criterio medible: **al menos 2 tarjetas de pedido completas sobre el pliegue en 390×844.** Hoy la cola empieza cerca de y≈700 de 844 — cero pedidos visibles.

---

## Presupuesto vertical — antes y después (390×844)

| Bloque | Actual | Propuesto |
|---|---:|---:|
| Header negro | 70 | **56** |
| Eyebrow + H1 “Central de pedidos” | ~90 | 0 — el contexto va en el app bar |
| Fila “Vista rider / Salir” | ~60 | 0 — a menú y a la sección Local |
| Fecha + “Cola al día” + “Sonido” | ~70 | 0 — en el app bar |
| 4 tarjetas de métrica | **~260** | **52** (banda que además filtra) |
| Tabs de sección (cortadas) | ~60 | 0 — bottom nav |
| Fila “Nuevos pendientes” + buscador | ~90 | **66** |
| Tabs de estado (cortadas) | ~60 | 0 — fusionadas con la banda |
| **Antes del primer pedido** | **~700** | **~186** |

Resultado verificado: **3 tarjetas de pedido visibles** en 390×844.

---

## App bar — 56px

`[TABA] [Operación / Jue 31 jul · 18 pedidos] [● Sincronizado] [🔊] [⋮]`

- Contexto en dos líneas de 16px/11px, con `nowrap` + elipsis (a pantalla angosta el texto se recorta, no rompe el layout en tres líneas).
- **Estado de sincronización siempre visible** como punto + texto, tocable para forzar sincronización.
- **Sonido** como conmutador con `aria-pressed`: es la función más crítica del turno.
- `⋮` para lo secundario: vista rider, cambiar local, salir.

## Franja de conexión — sólo cuando hace falta

Aparece **únicamente** si el estado no es “Sincronizado”:

- **Sin conexión** — franja `warning`: “Sin conexión · último dato 14:32” + botón “Sincronizar”.
- **Reconectando** — franja `info`: “Reconectando · 2 cambios en cola”.

Honesta: dice **la hora del último dato**, no un genérico “actualizando”. Persistente mientras dure. Silenciosa cuando todo está bien.

## Banda operativa — 52px, resumen y filtro a la vez

```
┌────────┬────────────┬────────┬───────────┐
│   4  ● │     2      │   1    │     3     │
│ Nuevos │ Preparando │ Listos │ En camino │
└━━━━━━━━┴────────────┴────────┴───────────┘   ← subrayado rojo en el activo
```

Reemplaza **cuatro tarjetas de ~260px y una fila de tabs de estado de ~60px por 52px**. El número es la métrica y el segmento es el filtro: no hay dos controles diciendo lo mismo. El punto rojo señala novedades sin sonido.

`role="group"` + `aria-pressed` por segmento. Los números usan `tabular-nums` para que no bailen al actualizarse.

## Buscador — 66px

Un campo de 46px: “Buscar por ID, cliente o dirección”. Sin la fila redundante “Nuevos pendientes 0” (ese dato ya está en la banda).

## Cola de pedidos — la prioridad

Cada tarjeta (~150px):

```
#A-1042  ● Nuevo  ● Demorado          14:18 · 20′
M. Álvarez · Envío
Ministro González 233
6 artículos                          $ 58.900
[ Aceptar ]                                     ← ancho completo, 44px
```

Contenido obligatorio: **ID · hora · minutos transcurridos · cliente · entrega o retiro · dirección resumida · cantidad de artículos · total · estado · demora · acción primaria.**

- Borde izquierdo de 3px codificando el estado **más** la pill textual (nunca sólo color).
- Demora: pill `● Demorado` + fondo levemente cálido.
- Dirección truncada a una línea con elipsis: en la cola importa reconocerla, no leerla entera.
- **La acción de la cola va en tinta (`--dark`), no en rojo.** Cuatro botones rojos apilados anulan el significado del rojo y saturan la pantalla. El rojo se reserva para la decisión única del detalle. Esto se detectó mirando la primera captura del prototipo.

Acción por estado: Nuevo → **Aceptar** · Preparando → **Marcar listo** · Listo → **Entregar a rider** · En camino → **Ver seguimiento**.

## Navegación — bottom nav + stack

**Cuatro destinos fijos: Pedidos · Riders · Local · Caja.**

Descartado explícitamente:
- tabs horizontales de navegación (hoy cortadas y no descubribles);
- tablas;
- scroll horizontal para navegar;
- más de una acción primaria por pantalla.

El detalle de pedido es una **pantalla apilada**: entra con “volver”, y **la barra de navegación se retira** para dejar el ancho completo a la acción primaria.

## Sección “Local” — filas agrupadas

Adaptación del principio estructural de Ajustes de iPhone: agrupación temática, fila `icono · título · resumen · valor · chevron`, separadores discretos, densidad controlada. **Iconografía lineal TABA; ningún icono, color ni componente de Apple.**

| Grupo | Filas | Valor a la derecha |
|---|---|---|
| **Operación** | Estado del local · Riders · Caja | Abierto · 3 · $ 184.300 |
| **Catálogo** | Productos · Stock | 22 · pill `● 1` |
| **Negocio** | Métricas del día · Reportes · Configuración | 18 · — · — |

Cierra con “Salir del panel” como acción destructiva separada.

Cada fila mide 56px, con área táctil completa y `aria-label` implícito por su contenido.

## Detalle de pedido

Pantalla apilada con encabezado `#A-1042` + pill de estado + “Recibido 14:18 · hace 6 min · Envío a domicilio”, y luego grupos:

1. **Cliente y entrega** — nombre, historial, botón “Llamar” (`tel:`); dirección, referencia, botón “Mapa”.
2. **Productos** — cantidad en caja de 30px, nombre, presentación, importe; subtotal, envío, **método de pago con el vuelto calculado** (“Efectivo · abona con $ 50.000”), total en `price-l`.
3. **Entrega** — **código de entrega en grande** con `letter-spacing` amplio y `tabular-nums`; fila “Asignar rider” con disponibles.
4. **Seguimiento** — línea de tiempo vertical: Confirmado ✓ → *Esperando aceptación* (ahora) → Preparando → En camino → Entregado.

### Acción primaria sticky

Barra fija al pie con **una sola** primaria a ancho completo según el estado:

| Estado | Primaria | Secundarias |
|---|---|---|
| Nuevo | **Aceptar y comenzar preparación** | Demorar 10 min · **Rechazar…** |
| Preparando | **Marcar listo** | Demorar 10 min · Cancelar… |
| Listo | **Entregar a rider** | Asignar otro rider · Cancelar… |
| En camino | **Ver seguimiento** | Llamar al rider |

Las destructivas van en la **fila secundaria**, con estilo `--danger` (contorno, no relleno), con puntos suspensivos que anuncian confirmación, y **siempre** con diálogo de confirmación que nombra el pedido.

Reserva de espacio: en esta pantalla `--t-nav-block: 0` (no hay nav) y `--t-cta-block: 122px` (altura real de la barra). Verificado: cero contenido tapado al final del scroll.

## Estados vacíos

| Situación | Título | Explicación | Acción |
|---|---|---|---|
| Sin pedidos en la cola activa | No hay pedidos en esta cola | Cuando entre uno nuevo aparece acá y suena la alerta | Ver todos los estados |
| Sin conexión | Sin conexión | Últimos pedidos recibidos a las 14:32. No se pierden: se sincronizan solos | Sincronizar ahora |
| Búsqueda sin resultados | Sin resultados para «X» | Probá con el número completo o el nombre | Limpiar búsqueda |
| Filtro sin resultados | No hay pedidos en esta cola | — | Ver todos los estados |
| Local cerrado | El local está cerrado | No se reciben pedidos online hasta las 18:00 | Abrir ahora |
| Error de carga | No pudimos cargar los pedidos | Los datos guardados siguen disponibles | Reintentar |

## Sonido y notificaciones

Un pedido nuevo con la app en segundo plano debe **sonar**. La campana es el canal primario; la interfaz es la confirmación. Conmutador en el app bar con estado explícito, y advertencia si el navegador bloqueó el audio (política de autoplay): “El sonido está bloqueado — tocá para activarlo”.

## Uso con una mano

- Todo lo accionable en el tercio inferior: banda (filtro), acción de cada tarjeta, barra de acción del detalle, navegación.
- El app bar es informativo, no operativo, salvo sonido y sincronización.
- Objetivos de 44px con 8px de separación mínima.
- Nada depende de pulsación larga ni de arrastre.

## Verificación

| Aserción | Umbral |
|---|---|
| Tarjetas de pedido completas sobre el pliegue en 390×844 | ≥ 2 |
| Altura consumida antes del primer pedido | ≤ 200px |
| Desbordamiento horizontal en 320/390/430 | 0 px |
| Objetivos táctiles < 44px | 0 |
| Elementos de navegación con scroll horizontal | 0 |
| Texto tapado por la barra de acción en el detalle | 0 nodos |
| Franja de conexión con estado “Sincronizado” | ausente |
| Franja de conexión sin red | presente, con hora del último dato |
| Acciones primarias visibles simultáneamente en el detalle | 1 |
