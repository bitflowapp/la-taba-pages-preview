# Referencia visual vs. TABA2 Rider

Se recibieron **3** de las 4 capturas mencionadas en el encargo. Falta la del drawer;
esa parte se resuelve con la especificación estructural del §14 del encargo.

| # | Captura recibida | Contenido |
|---|---|---|
| 1 | `IMG_5142` | Mapa principal, estado *Repartiendo*, menú, soporte, brújula, recenter, sheet *Buscando pedidos…* |
| 2 | *(no recibida)* | Drawer |
| 3 | `IMG_5139` | Modal de aviso de conexión + estado *No repartiendo* + sheet Comenzar/Agendar |
| 4 | `IMG_5140` | Modal *horario comenzado* + sheet *Buscando pedidos…* + *Logros en curso* |

---

## 1. Qué se adopta (lógica de experiencia)

| Patrón de la referencia | Adopción en TABA2 | Estado previo |
|---|---|---|
| Mapa a pantalla completa como fondo | `RiderMapView` elevado a pantalla raíz | Existía sólo por pedido |
| Botón circular de menú arriba-izquierda | `MapCircleButton` con `Icons.menu` que abre el drawer | No existía |
| Cápsula de estado flotante arriba-centro | `MapStatusCapsule` (ya existe, se reutiliza) | Ya existía en el detalle |
| Botón de soporte arriba-derecha | Botón de ayuda → hoja de ayuda **local** | Existía sólo en el detalle |
| Control de recentrado abajo-derecha | `map-recenter` (ya existe) | Ya existía |
| Bottom sheet contextual | `RiderSheet` con contenido por estado A–I | Existía con 3 variantes |
| Drawer con saludo, tarjetas y secciones | `RiderDrawer` con datos reales únicamente | No existía |
| Modal grande, 1 acción, fondo oscurecido | `showTaba2Modal()` | Existían 3 `AlertDialog` sueltos |
| Una acción principal por estado | Ya es una invariante del código; se documenta y se prueba | Ya existía |
| Uso con una mano | CTA fijo al pie del sheet, targets ≥ 48 dp | Parcial |

## 2. Qué NO se copia

Marca PedidosYa · nombre *PeYa Rider* · paleta rosa (`#FF0080` y derivados) · logotipos ·
ilustraciones (banderín *START*, pin rosa) · textos literales · promociones · logros ·
íconos propietarios · diseño píxel por píxel.

TABA2 mantiene su identidad: crema `#FAF7F2`, tinta `#14171B`, rojo TABA `#BC1F2D`,
verde `#1FA45B`, ámbar `#925F00`. Ninguno de esos valores cambia en este rediseño.

## 3. Funciones de la referencia que NO se implementan (no existen en TABA2)

| En la referencia | Por qué no se implementa |
|---|---|
| *Comenzar* / *Agendar* / *Ver todos los horarios* | No hay sistema de turnos ni agenda |
| *Recordá: tu horario de conexión comienza en 4 minutos* | No hay horarios de conexión |
| *El horario de conexión ha comenzado* | ídem |
| *Logros en curso*, *¡Ganá hasta $135.000 extras!* | No hay logros, bonos ni objetivos |
| *En las áreas rojas podrás recibir pedidos más rápido* | No hay heatmap de demanda |
| *103 pedidos para alcanzar nivel 1* | No hay niveles |
| Mensajes (55), balance, pagos, horas, ganancias | No existen esos datos |
| Estado *No repartiendo* como toggle de conexión | No hay conectarse/desconectarse |

El estado *No repartiendo* se traduce al equivalente honesto **Sin pedidos**, que sí
corresponde a un estado real (`ready` + cola vacía + sin asignación), y cuyo único CTA
real es *Actualizar*.

## 4. Diferencias deliberadas de composición

1. **Un solo punto de retiro.** La referencia muestra comercios variables; TABA2 fija
   *La Taba 2 · Mendoza 827* y no dibuja selector ni listado.
2. **Sin ruta ni ETA.** La referencia insinúa recorridos; TABA2 sólo puede mostrar
   distancia en línea recta y la etiqueta *aprox.* (`formatMapDistance`).
3. **Zona en vez de punto pre-claim.** TABA2 dibuja un círculo de 450 m sobre una grilla
   pública; la referencia no tiene esa restricción de privacidad.
4. **Verde reservado.** En TABA2 `Taba2Colors.live` sólo se usa para un estado activo
   confirmado por el servidor, nunca decorativo.
5. **El color nunca es el único indicador.** La cápsula repite el tono con un punto y con
   el texto del estado; la referencia depende más del color.
