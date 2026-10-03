# GPS_PIPELINE — Diseño de captura y publicación nativa

## Objetivo

Garantizar que una entrega activa produzca muestras GPS útiles con pantalla apagada, las valide localmente, las persista cuando no hay red y las publique con el contrato exacto de Supabase. Flutter consume estado y frescura; no captura ni sube GPS.

## Pipeline objetivo

~~~
RiderForegroundService
  -> FusedLocationProviderClient
  -> LocationSampler (intervalo/distancia/adaptación)
  -> LocationQualityFilter (accuracy, edad, coordenadas, mock)
  -> single-order actor
  -> encrypted Room queue
  -> authenticated uploader
  -> publish_rider_location(order_id, revision, lat, lng, accuracy, heading, speed, captured_at)
  -> server sequence/recorded_at
  -> sanitized service event -> Flutter
~~~

El actor debe ser único por servicio/orden. La entrega actual, la revisión esperada y el último captured_at aceptado deben pertenecer a esa instancia. No se permite que dos callbacks publiquen o que una orden nueva reutilice el actor anterior.

## Decisiones de captura

| Situación | Prioridad inicial | Intervalo deseado | Distancia mínima | Política |
|---|---:|---:|---:|---|
| Warm-up al iniciar | HIGH_ACCURACY | 5 s | 10 m | Esperar fix válido; mostrar “buscando GPS”. |
| En movimiento | HIGH_ACCURACY | 5–10 s | 10–25 m | Publicar como máximo una muestra cada 6 s por orden. |
| Quieto o precisión estable | BALANCED/HIGH según fix | 20–30 s | 25–50 m | Reducir batería sin declarar tracking detenido. |
| Red caída | Igual que captura local | Igual | Igual | Seguir muestreando dentro del límite de cola; no intentar HTTP por callback. |

Los intervalos son sugerencias al proveedor, no una promesa de entrega exacta. El floor de publicación de seis segundos es necesario para no chocar con el rechazo server-side de cinco segundos. El adaptador debe poder cambiar la política sin recrear el servicio.

La primera implementación debe usar FusedLocationProviderClient con requestLocationUpdates y un LocationRequest moderno. getCurrentLocation puede servir para warm-up o recuperación, pero no sustituye el stream. El proyecto actual no incluye Play Services Location: agregar la dependencia requiere revisión de versión, tamaño, licencia y prueba en el Moto objetivo.

## Reglas de calidad

Antes de encolar:

1. latitude/longitude finitas y dentro de los rangos del RPC.
2. hasAccuracy true, accuracy entre 0 y 250 metros; preferido <=100 m.
3. captured_at derivado del timestamp de la ubicación, normalizado a UTC.
4. no aceptar una muestra futura más allá de una tolerancia local de 20 segundos.
5. descartar muestras con edad local mayor a 120 segundos; el backend rechaza las que superan tres minutos.
6. no publicar si solo hay permiso aproximado. Para tracking operacional se requiere ACCESS_FINE_LOCATION; COARSE puede ser obfuscado/throttled y no es un “fix aceptable”.
7. heading solo si es finito y está en [0,360); speed solo si es finita y está en [0,70]. Si no hay valor, usar null.
8. rechazar mock location según la política acordada; si el dispositivo/OEM no permite distinguirla, marcar quality=unknown en evento local y no bloquear por una suposición no verificable.
9. descartar duplicados por order/revision/captured_at y por una huella local de coordenada-tiempo.

El orden local se basa en captured_at y una secuencia local. La autoridad de orden de aceptación es la sequence devuelta por el servidor. Nunca se debe sustituir recorded_at por el reloj del teléfono.

## Publicación y respuesta

La llamada debe usar exactamente:

publish_rider_location(
  p_order_id,
  p_expected_revision,
  p_lat,
  p_lng,
  p_accuracy,
  p_heading,
  p_speed,
  p_captured_at
)

No añadir idempotency_key ni cambiar el nombre de los parámetros. El payload debe incluir apikey pública, Bearer del SessionManager, Content-Type y body JSON generado por el cliente actual. La respuesta debe validarse como DTO mínimo: order_id, sequence, recorded_at, captured_at y campos aceptados por la migración. No guardar ni loggear el body completo.

Manejo recomendado:

- 2xx: ACK y borrar la fila solo dentro de la misma transacción que registra sequence/recorded_at.
- 401: una sola actualización single-flight; repetir solo si el registro continúa vigente y el token observado era el actual.
- 40001 por captured_at antiguo/revisión: marcar stale, borrar o mover a dead-letter y pedir reconciliación del order revision.
- P0001 por frecuencia: no reintentar inmediatamente; recalcular el floor y conservar la muestra más nueva.
- 4xx de validación: no hacer loop; diagnosticar calidad/estado y notificar estado accionable.
- 429/5xx/network: conservar, aplicar backoff y continuar capturando con límites.

La lógica de publicación no debe depender de que Flutter permanezca vivo.

## Permisos y límites Android

El servicio debe arrancarse desde una Activity visible después de que el usuario conceda ubicación precisa y notificaciones. El manifest ya declara FOREGROUND_SERVICE_LOCATION y el tipo location. No solicitar ACCESS_BACKGROUND_LOCATION para el MVP: una ubicación foreground service permite seguir con pantalla apagada/Home; añadir background location cambia el modelo de privacidad y la revisión de permisos. Si el producto exige tracking después de force-stop o sin FGS, eso es otro requisito y no se puede prometer con esta arquitectura.

La app debe tratar como fallos distintos:

- permiso fine denegado;
- permiso solo coarse;
- notificación denegada;
- ForegroundServiceStartNotAllowedException/SecurityException;
- proveedor de ubicación desactivado;
- precisión insuficiente;
- servicio detenido por el usuario;
- sesión vencida.

Cada caso tiene que producir un evento sanitizado y una acción visible en la app.

## Batería y frescura

No pedir intervalos de pocos segundos durante toda la ruta sin medir. La aplicación debe registrar únicamente buckets: sampling mode, duración, porcentaje aproximado de batería al inicio/fin y último upload age. Nunca registrar coordenadas para diagnóstico. La UX muestra Fresh (<30 s desde recorded_at), Delayed (30–120 s), Stale (>120 s) y No signal; los umbrales de UI no alteran el límite de tres minutos del servidor.

Cuando el dispositivo esté quieto, usar distancia/intervalo mayor con histéresis para evitar alternancia rápida. Cuando la velocidad o desplazamiento aumente, volver al modo activo. Si el queue size o la batería crítica lo requieren, reducir captura y explicar el estado; no fingir que el tracking sigue fresco.

## Cambios previstos

Archivos primarios:

- android/app/build.gradle.kts: Play Services Location y dependencias aprobadas.
- AndroidManifest.xml/MainActivity.kt: permisos y arranque visible.
- native/location/LocationModels.kt, FusedLocationSource.kt, LocationPermissionManager.kt, LocationQualityFilter.kt, LocationSampler.kt.
- native/delivery/RiderForegroundService.kt, DeliveryServiceCoordinator.kt, DeliveryStateMachine.kt.
- native/data/LocationPublisher.kt, OfflineLocationQueue.kt, QueueDrainWorker.kt, EncryptedLocationQueueStore.kt.
- native/auth/SessionManager.kt y cliente HTTP nativo para que el uploader no dependa de Dart.
- bridge DTO/eventos para freshness/queue/service status sin datos sensibles.

## Tests y aceptación

- Unit: coordenadas límite, NaN/infinito, accuracy 0/250/>250, captured_at futuro/viejo, heading/speed, dedupe, floor de seis segundos, revisión obsoleta y mapeo de errores.
- Android instrumented: Fused fake, Keystore/queue, service start/stop, notification action, process recreation.
- Contract: verificar URL, firma y body del RPC Gate2 contra MockWebServer y una instancia staging aplicada.
- Physical: pantalla apagada, Home, otra app, lock/unlock, permiso preciso, pérdida/retorno de red, desplazamiento, Doze/battery saver, notificación, process kill.
- Exit: al menos una muestra aceptada por sequence del servidor en staging, sin token/coordenada en logs, cola drenable y evidencia Moto adjunta a Task10.

Referencias Android:

- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
- https://developer.android.com/develop/background-work/services/fgs/launch
- https://developer.android.com/develop/background-work/services/fgs/declare
- https://developer.android.com/develop/sensors-and-location/location/permissions
- https://developers.google.com/android/reference/com/google/android/gms/location/FusedLocationProviderClient
- https://developers.google.com/android/reference/com/google/android/gms/location/LocationRequest
