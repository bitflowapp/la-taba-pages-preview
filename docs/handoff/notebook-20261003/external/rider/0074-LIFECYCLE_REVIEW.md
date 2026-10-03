# Revisión de ciclo de vida Android

## Comportamiento endurecido

| Escenario | Comportamiento esperado/implementado |
|---|---|
| App visible | UI consulta snapshot nativo y backend; eventos nuevos se aplican por generación/ID |
| Background | El `ForegroundService` y actor Kotlin continúan sin depender de Dart vivo |
| Pantalla bloqueada | El servicio mantiene su notificación y ciclo nativo mientras Android no lo detenga |
| Rotación/Flutter recreation | La autoridad permanece en `RiderApplication`; se sustituye el listener y se entrega snapshot inicial |
| Process recreation | Metadata mínima se valida; luego se consulta backend por pedido+revisión antes de recuperar `on_the_way`/`arrived` |
| Swipe de recientes | El comportamiento depende del fabricante/Android; la entrega no se infiere activa sólo desde disco y se reconcilia al reabrir |
| Pérdida de red | Se conserva sólo cola efímera acotada; se informa `network_unavailable` como “Sin red”, sin detalle de transporte, y se reintenta según clasificación segura |
| Regreso de red | El actor drena secuencialmente sin publicaciones paralelas, respetando la vigencia del ciclo |
| Logout | Primero se cancelan servicio, callbacks y llamadas HTTP; después se limpian tokens |
| Pedido terminal | Se detiene publicación y se purgan muestras pendientes |
| Ubicación apagada | Se expone `location_services_disabled`; al reactivar requiere un ciclo vigente/reconciliado |
| Cambio de rider | No se permite mutar la identidad de una sesión activa; se exige logout y teardown |
| Forzar detención | No se promete supervivencia ni autoarranque; Android bloquea componentes hasta reapertura manual |

## Recuperación al reabrir

La secuencia efectiva es:

1. consultar `getDeliveryServiceStatus` nativo;
2. cargar metadata local mínima y validada;
3. consultar el snapshot backend permitido por RLS;
4. reconciliar por identificador interno y revisión dentro de Kotlin;
5. sólo reanudar si backend confirma un estado operativo compatible y existen permisos/servicios de ubicación.

El identificador interno se usa dentro del runtime para la reconciliación, pero no se publica en snapshots/logs de UI. Un archivo corrupto, versión desconocida, revisión inválida, pedido diferente o estado terminal se limpia/detiene de manera segura.

## Persistencia

- Store de sesión: tokens cifrados con AES-GCM mediante almacenamiento Android ya establecido.
- Store de delivery: metadata mínima, sin token, coordenadas ni dirección; escritura atómica y versión de esquema 2.
- Cola GPS: exclusivamente en memoria, acotada; se purga ante terminal, sesión/acceso inválido, revisión conflictiva o stop.

## Pruebas físicas pendientes

Aunque ADB detectó un Moto G15 al cierre, no se instaló ni ejecutó la suite conectada para evitar modificar el equipo sin autorización explícita. Queda validar en dispositivo:

- permiso preciso concedido/denegado y revocado durante entrega;
- GPS apagado y reactivado;
- background, bloqueo/desbloqueo y rotación;
- swipe de recientes y reapertura;
- process recreation real y reboot, según el plan de pruebas;
- pérdida/regreso de Wi-Fi/datos con pedidos reales de staging controlados;
- logout, sesión vencida y cambio de rider durante publicación;
- transición terminal y ausencia posterior de publicaciones;
- política específica del fabricante/batería;
- Forzar detención sólo para confirmar el límite documentado, no supervivencia.
