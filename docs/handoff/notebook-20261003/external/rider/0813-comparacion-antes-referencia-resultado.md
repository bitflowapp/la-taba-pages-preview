# Antes · Referencia · TABA2 Rider

Capturas nuevas en `screenshots/`, 12 estados × 3 anchos (320 / 390 / 432 dp),
renderizadas a 2× con Roboto real.

**Sobre los mapas de las capturas:** los tiles salen en blanco a propósito. Un
widget test no puede descargar tiles reales y dibujar calles falsas
representaría mal lo que ve el rider. Los pines, la zona aproximada, la brújula
y los controles sí son los reales.

**Sobre las capturas «antes»:** no existen capturas previas de la app en el
repositorio. Los goldens `test/goldens/*.png` de HEAD `95294d9` son el registro
visual del estado anterior; nueve de ellos se regeneraron en esta rama y su
versión previa sigue disponible en `git show 95294d9:test/goldens/<archivo>`.

---

## 1. Mapa principal

| | Antes (`95294d9`) | Referencia (IMG_5142) | TABA2 ahora |
|---|---|---|---|
| Pantalla raíz | `AppBar` + lista de tarjetas | Mapa a pantalla completa | Mapa a pantalla completa |
| Menú | — (popup con «Cerrar sesión») | Botón circular arriba-izquierda | Botón circular → drawer |
| Estado | Banner de texto en la lista | Cápsula flotante arriba-centro | Cápsula flotante con punto de tono |
| Soporte | — | Botón circular arriba-derecha | Botón circular → ayuda local |
| Recentrar | Sólo dentro del pedido | Botón circular abajo-derecha | Botón circular abajo-derecha |
| Sheet | — | Sheet contextual | Sheet contextual por estado |

Captura: `01-sin-pedidos@390.png`, `03-pedido-disponible@390.png`.

**Diferencia deliberada:** la referencia dibuja zonas rojas de demanda y un
estado *No repartiendo* que es un interruptor de conexión. TABA2 no tiene
demanda por zona ni turnos, así que el estado equivalente honesto es **Sin
pedidos** y su única acción real es *Actualizar*.

## 2. Drawer

| | Antes | Referencia (no recibida) | TABA2 ahora |
|---|---|---|---|
| Acceso | `PopupMenuButton` con 1 opción | Botón de menú | Botón de menú + gesto de borde |
| Saludo | — | «Hola, <nombre>» | «Hola» + TABA2 Rider + entorno |
| Tarjetas | — | Mensajes, balance, pagos, horas | Estado de conexión, última sincronización |
| Secciones | Cerrar sesión | Muchas | Inicio, Entregas, Ayuda, Cerrar sesión |

Captura: `11-drawer@390.png`.

**Diferencia deliberada:** no hay nombre de rider en la sesión nativa (ver
`riesgos.md` R-02), así que el saludo queda impersonal en vez de inventado. No
hay balance, pagos, horas ni mensajería en TABA2: esas tarjetas no existen.
Perfil y Configuración se omiten porque no hay pantallas detrás.

## 3. Modal operativo

| | Antes | Referencia (IMG_5139) | TABA2 ahora |
|---|---|---|---|
| Forma | 3 `AlertDialog` distintos | Modal grande, 1 acción | `showTaba2Modal`, forma única |
| Ilustración | — | Ilustración de marca | Ícono Material en disco de tono |
| Fondo | Scrim por defecto | Fondo oscurecido | Scrim TABA2 `#101215` al 60 % |
| Salida | Variable | OK | Atrás y scrim resuelven a «no» |

Captura: `12-modal-operativo@390.png`.

**Diferencia deliberada:** la referencia usa el modal para un aviso de horario.
TABA2 lo reserva para decisiones que bloquean: permisos, ubicación apagada y la
confirmación de detener el seguimiento. La pérdida de conexión y los errores de
sincronización siguen siendo avisos sobre el mapa, porque bloquear a un rider
en la calle por algo que se recupera solo es peor que decírselo.

## 4. Buscando pedidos

| | Antes | Referencia (IMG_5140) | TABA2 ahora |
|---|---|---|---|
| Título | «Buscando pedidos disponibles…» centrado | «Buscando pedidos…» en sheet | «Buscando pedidos…» en sheet |
| Bajada | — | «En las áreas rojas…» | «Te avisamos cuando haya una entrega disponible.» |
| Debajo | — | Logros en curso, ganancias | Última confirmación del servidor |

Captura: `02-buscando-pedidos@390.png`.

## 5. Estados de la entrega

Sin equivalente en las referencias recibidas; son propios de TABA2.

| Estado | Cápsula | Encabezado | CTA | Captura |
|---|---|---|---|---|
| `assigned` | Yendo a La Taba 2 | Retirá el pedido | Confirmar retiro | `05-…` |
| `pickedUp` | Pedido retirado | Iniciá el recorrido | Iniciar recorrido | `06-…` |
| `onTheWay` | Yendo al cliente | Llevá el pedido al cliente | Llegué | `07-…` |
| `arrived` | Llegaste | Cerrá la entrega | Ingresar código | `08-…` |
| `arrived` + código | Llegaste | Cerrá la entrega | Confirmar entrega | `09-…` |
| `delivered` | Entrega completada | Entrega finalizada | Volver a la cola | `10-…` |

## 6. Lo que no se copió

Marca PedidosYa, nombre *PeYa Rider*, paleta rosa, logotipos, ilustraciones
(banderín *START*, pin rosa), textos, promociones, logros e íconos propietarios.
La paleta TABA2 —crema `#FAF7F2`, tinta `#14171B`, rojo `#BC1F2D`, verde
`#1FA45B`, ámbar `#925F00`— no cambió ni un valor en este rediseño.
