# Tracking GPS real de producción

Este documento describe el único flujo admitido para seguir un pedido real
entre un rider y un cliente en dispositivos distintos. No usa `?demo=1`,
IndexedDB, `BroadcastChannel` ni el relay local: esos mecanismos siguen
aislados para la sandbox.

## Arquitectura

```text
Moto G15 rider (Auth + membership rider + pedido asignado)
  watchPosition
  -> publish_rider_location RPC
  -> rider_locations (hora del servidor)
  -> get_public_order_tracking RPC + x-order-token
  -> iPhone cliente (polling tokenizado)
  -> marcador Leaflet incremental
```

- `js/tracking/production_rider_gps.js` controla el GPS de producción. Sólo
  inicia `watchPosition` para el rider autenticado asignado, en `on_the_way` o
  `arrived`; publica `lat`, `lng`, precisión, rumbo y velocidad. No confía en
  el timestamp del cliente.
- `publish_rider_location` vuelve a validar en PostgreSQL Auth, membership,
  asignación, estado, rango, precisión y frecuencia. El navegador no inserta
  filas directamente.
- `js/tracking/customer_tracking_poll.js` consulta exclusivamente
  `get_public_order_tracking` con el token de la orden. No hay SELECT ni canal
  Realtime a `rider_locations` desde el cliente.
- El DTO público contiene únicamente estado operativo, ETA confiable y último
  punto redondeado. No contiene datos de contacto, dirección, ítems, totales,
  UUID internos, token ni historial de coordenadas.

## Ciclo de vida del cliente

El polling se inicia al abrir la vista Tracking de un pedido delivery en estado
`on_the_way` o `arrived`, consulta de inmediato y luego usa un único ciclo de
cinco segundos. Cada petición nueva aborta la anterior. El ciclo se detiene al:

- salir de Tracking o destruir la vista;
- recibir `delivered` o `canceled`;
- no disponer de token, token revocado o token vencido;
- pasar el pedido a un estado fuera de reparto.

Al recuperar foco, visibilidad o `pageshow`, la consulta se reanuda de
inmediato. En segundo plano no se mantiene un ciclo agresivo.

## Frescura y mapa

La edad se calcula con el timestamp recibido del servidor, incluso entre dos
respuestas HTTP:

| Edad del último fix | Estado de UI | Mapa |
| --- | --- | --- |
| hasta 15 s | Actualizando | marcador actual |
| 16–45 s | Última ubicación | último marcador, sin movimiento inventado |
| más de 45 s | Ubicación sin actualizar | último marcador, sin ETA inventada |
| sin fix válido | Ubicación no disponible | no se muestra mapa productivo |

Producción no calcula rutas, no geocodifica direcciones y no muestra comercio,
destino ni polilínea: todavía no existe un contrato consentido para esas
coordenadas. Leaflet sólo centra el mapa en la posición real publicada por el
rider. La ruta ficticia permanece exclusivamente en sandbox.

## Corte y revocación

El controller corta `clearWatch` si el rider abandona la vista Rider, cierra
sesión, es reasignado, deja de estar en reparto, deniega el permiso o entrega.
Al pasar la orden a terminal, el trigger de base revoca los tokens públicos y
purga las ubicaciones. Un polling posterior recibe respuesta no disponible y
libera su request/timer.

## Procedimiento físico seguro (Moto G15 + iPhone)

Usar una URL HTTPS de producción configurada explícitamente y cuentas QA, sin
domicilios, teléfonos ni coordenadas reales en evidencias.

1. Crear un pedido QA delivery desde el iPhone cliente y avanzar el negocio.
2. Iniciar sesión rider en el Moto G15, tomar la orden y cambiarla a En camino.
3. Tocar Compartir GPS y aceptar el permiso. Registrar sólo hora, precisión
   aproximada y resultado; no la latitud/longitud.
4. Cambiar cinco veces de posición de forma controlada. En el iPhone verificar
   que cada cambio llega en hasta un ciclo de cinco segundos y que Leaflet
   conserva su instancia y zoom.
5. Pausar conectividad o detener el GPS: comprobar las bandas demorada y
   perdida sin movimiento ni ETA falsos.
6. Entregar con código QA. Confirmar `clearWatch`, ausencia de consultas
   posteriores y que el token ya no devuelve ubicación.

Guardar la evidencia local no versionada en
`.local-staging/cross-device-tracking-evidence/`: horas redondeadas, estado,
precisión, resultado de cada paso y capturas sin coordenadas ni credenciales.

## Límites móviles

La geolocalización exige HTTPS. Android/iOS pueden suspender una pestaña al
bloquear la pantalla: el producto comunica última ubicación o pérdida de señal,
no promete tracking en segundo plano. Un requisito de background confiable
necesita una aplicación nativa o una PWA con una estrategia específica de
permisos.
