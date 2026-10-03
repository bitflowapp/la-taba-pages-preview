# TABA Rider Android — Especificación de producto

**Estado: propuesta. La aplicación no existe.** No hay proyecto Flutter creado ni código Android en ningún repositorio.

## Qué significa “migrar”

Hoy existe una **vista rider web** dentro de la PWA (`index.html` → `[data-view="rider"]`, `js/delivery.js`, `styles/rider.css`, ~352 líneas de CSS). No hay una app Android nativa que portar línea por línea. Migrar significa:

1. **Extraer los flujos** que la vista web ya resuelve conceptualmente.
2. **Preservar los contratos válidos** — sobre todo el código de entrega y la máquina de estados del pedido.
3. **Diseñar una app Android independiente**, con su propia navegación, su propio ciclo de vida y su propia persistencia.
4. **Integrar contra Supabase** (staging y producción), no contra el relay de demostración.
5. **Reemplazar progresivamente** la vista web, que se mantiene como respaldo hasta que la app cubra el 100% de los estados.

## Por qué una app y no la PWA

| Necesidad | PWA | App Android |
|---|---|---|
| Ubicación con la pantalla apagada | No fiable: el navegador suspende la pestaña | Foreground service con notificación persistente |
| Aviso de pedido nuevo con la app cerrada | Notificaciones web frágiles en Android, bloqueadas por políticas de autoplay | FCM + canal de notificación de alta prioridad |
| Sobrevivir a que el sistema mate el proceso | Se pierde el estado en memoria | Estado durable en SQLite + restauración |
| Trabajar sin señal en zonas ciegas | Depende del service worker y su caché | Cola durable propia con reintento e idempotencia |
| Batería en un turno de 5–8 h | Sin control | Estrategia de muestreo por estado |

Los cuatro primeros son bloqueantes para un producto de reparto real. No son preferencias.

## Usuario y contexto

- Reparto urbano en Neuquén capital, en moto o auto.
- Teléfono Android de gama media (referencia: Moto G15 o similar), pantalla ~6,7", Android 13–15.
- Turnos de 5–8 horas, batería compartida con navegación GPS.
- Conectividad intermitente: zonas sin cobertura, cambios entre 4G y Wi-Fi del local.
- **Interacción real:** detenido con el motor en marcha, con guantes ligeros, al sol, con una mano.

## Principios de producto

1. **Una decisión por pantalla.** Si hay dos cosas que decidir, son dos pantallas.
2. **La acción primaria está siempre abajo**, a 56px de alto, alcanzable con el pulgar.
3. **Casi no se escribe.** El único texto libre opcional es una nota. El código de entrega usa un teclado numérico propio; las incidencias son una lista.
4. **Las acciones irreversibles se confirman deslizando**, con equivalente por pulsación para accesibilidad.
5. **Offline es el caso normal, no el error.** La app nunca se bloquea por falta de red.
6. **Nada se pierde.** Toda acción se registra localmente antes de intentar enviarse.
7. **El rider ve sólo lo que necesita** para el pedido activo. Nada de otros clientes, nada de datos históricos ajenos.

## Alcance de la versión 1

**Incluye:** inicio de sesión, turno disponible/no disponible, lista de pedidos, aceptación, navegación al local, retiro, entrega, código de entrega, incidencias, offline con cola durable, recuperación tras cierre de la app, historial del día, fin de turno.

**No incluye (v1):** chat con el cliente, foto de prueba de entrega, propinas, múltiples pedidos simultáneos (batching), optimización de ruta multi-parada, pagos con tarjeta en la puerta, modo bicicleta/a pie.

## Los 25 flujos

| # | Flujo | Pantalla | Resultado |
|---|---|---|---|
| 1 | Inicio de sesión | `login` | Sesión persistida, turno cerrado |
| 2 | Sesión expirada | `login` con aviso | Reautenticación conservando la cola local |
| 3 | Disponible / no disponible | `home` | Conmutador de turno; sin turno no se reciben pedidos |
| 4 | Pedidos disponibles | `orders` | Lista de trabajos ofrecidos por el local |
| 5 | Pedido asignado | `orders` → `detail` | `assigned`, exclusivo del rider |
| 6 | Detalle | `detail` | Recorrido en 3 pasos, productos, pago |
| 7 | Navegación al local | `atstore` | Mapa + ETA + “Navegar” a la app externa |
| 8 | Llegada al local | `atstore` | Se habilita “Llegué al local” |
| 9 | Confirmación de retiro | `pickup` | Verificación de artículos + deslizar para confirmar → `picked_up` |
| 10 | Inicio de entrega | `ontheway` | Se activa el servicio de ubicación |
| 11 | GPS activo | `ontheway` | Notificación persistente; el cliente ve el seguimiento |
| 12 | Navegación al cliente | `ontheway` | Mapa + ETA |
| 13 | Llegando | `arriving` | `arriving`; se avisa al cliente |
| 14 | Llegada | `arriving` | Se habilita pedir el código |
| 15 | Código de entrega | `code` | 4 dígitos con teclado propio |
| 16 | Código incorrecto | `codeerror` | Contador de intentos; salida por incidencia |
| 17 | Entregado | `code` → confirmación | `delivered`, ubicación detenida |
| 18 | Incidencia | `incident` | Motivo de una lista; el local lo ve al instante |
| 19 | Cancelación | `detail` / `ontheway` | Cancelado por el local: aviso y liberación |
| 20 | Cliente ausente | `incident` | Protocolo de espera y resolución |
| 21 | Sin conexión | `offline` | Cola visible; el trabajo continúa |
| 22 | Reconexión | `recovered` | Cola drenada, confirmación explícita |
| 23 | Recuperación tras cerrar la app | `recovered` | Se retoma el estado exacto |
| 24 | Cambio de dispositivo | `login` | La sesión anterior se cierra; se recupera el pedido activo del servidor |
| 25 | Fin de turno | `shiftend` | Resumen, ubicación apagada, cola vacía verificada |

## Métricas de producto

| Métrica | Objetivo |
|---|---|
| Tiempo de aceptación de un pedido | < 15 s desde el aviso |
| Toques desde “llegué” hasta “entregado” | ≤ 6 |
| Acciones perdidas por falta de red | **0** |
| Recuperaciones correctas tras muerte del proceso | 100% |
| Consumo de batería por hora con ubicación activa | < 8% en el dispositivo de referencia |
| Fallos de entrega por código no disponible | < 2% de las entregas |

## Prototipo

`prototypes/prototype-rider-android.html` — 14 pantallas navegables con estados reales, mapa simulado, cola offline y teclado de código. Capturas en `screenshots/rider-*.png`.
