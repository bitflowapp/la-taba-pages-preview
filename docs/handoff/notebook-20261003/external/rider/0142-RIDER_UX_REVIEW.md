# RIDER_UX_REVIEW — Revisión operativa y propuesta

## Diagnóstico actual

La app ya tiene un flujo entendible de autenticación, lista de órdenes, detalle y banner de servicio. El problema es que el banner actual solo comunica el estado técnico starting/running/error/stopped. No comunica si existe una ubicación reciente, si la publicación fue aceptada por servidor, si hay cola, si se perdió la sesión, cuánto consume el servicio ni qué ocurrirá al pulsar detener.

El detalle no tiene mapa, freshness badge, navegación externa, estado de permiso/GPS/red/batería ni recuperación después de proceso muerto. complete_delivery_use_case.dart es placeholder y el bridge no demuestra un contrato de completion. No agregar un RPC de completion por intuición: primero leer la firma real disponible en el backend y decidir si se consume o si el cierre queda fuera del alcance.

## Principios de UX para un rider

- Una pantalla activa debe responder “¿estoy entregando?”, “¿me están viendo?” y “¿qué debo hacer ahora?” en menos de tres segundos.
- El estado comercial de la orden y el estado técnico de tracking son distintos y deben usar etiquetas distintas.
- No usar solo rojo/verde: cada estado incluye icono, texto y acción.
- Acciones críticas deben ser grandes, visibles y confirmables; target mínimo recomendado 48 dp, preferido 56–64 dp para Start/Pause/Complete.
- Mostrar montos ARS con formato consistente y no esconder restricciones operativas.
- No mostrar coordenadas crudas ni detalles de seguridad del backend.
- Un problema de GPS/red no debe borrar la orden ni simular una entrega completada.

## Pantalla de detalle propuesta

Orden: public code, zona/branch, restricciones, packages, payment method y collection amount.  
Tracking: estado del servicio, freshness, último ACK del servidor, queue badge, red, GPS y batería aproximada.  
Mapa: adaptador provider-neutral. Si no existe proveedor/style/key aprobado, mostrar una tarjeta de estado y conservar “Abrir navegación”; no agregar una clave inventada.  
Acciones: Start delivery, Pause tracking, Resume tracking, Open navigation y Complete solo cuando exista contrato backend comprobado.

Flujo:

~~~text
Assigned/Picked up
  -> permiso preciso + notificación
  -> Iniciar entrega
  -> Starting / buscando GPS
  -> Running + Fresh
  -> Pausar seguimiento -> confirmación -> Paused (orden sin mutación)
  -> Resume -> revalidar sesión/revision/permisos
  -> estado terminal -> detener captura y cerrar queue
~~~

El botón Start debe quedar disabled mientras haya una orden activa distinta. Si Flutter recibe un active snapshot después de recreación, debe mostrar RecoveryCard antes de permitir otra acción.

## Estados y copy recomendado

| Estado | Texto breve | Acción |
|---|---|---|
| Starting | “Preparando seguimiento…” | Esperar/cancelar solo si startup falla. |
| Searching GPS | “Buscando ubicación precisa” | Abrir permisos/Location settings. |
| Fresh | “Seguimiento activo · actualizado hace X s” | Ver detalle/pausar. |
| Delayed | “Seguimiento retrasado · hay datos pendientes” | Revisar red; no afirmar Fresh. |
| Stale | “Sin actualización reciente” | Revisar GPS/red; contacto soporte si persiste. |
| Queued | “X actualizaciones esperan conexión” | Mostrar edad más antigua, no coordenadas. |
| Session required | “Volvé a iniciar sesión para continuar” | Sign in; detener upload. |
| Paused | “Seguimiento pausado; la orden sigue abierta” | Reanudar con confirmación. |
| Error | Reason accionable | Retry/Settings/Support. |

El copy debe explicar que “Pausar seguimiento” no cancela ni completa la orden. La notificación usa el mismo lenguaje y abre la pantalla de recovery.

## Navegación externa

La acción Open navigation debe usar el dato de dirección que la orden ya autorice y delegar mediante un intent/URI externo aprobado por producto. No hacer geocoding silencioso, no guardar la dirección en logs y no interpretar el resultado de la app de mapas como prueba de entrega. Si falta dirección utilizable, mostrar “Navegación no disponible” y la zona/branch textual.

El rider debe poder volver a la app desde la notificación. La notificación debe tener acción de abrir, estado de actividad y una acción de pausa con confirmación en app cuando sea posible.

## Mapa y privacidad

El backend público expone latest location redondeada y limitada temporalmente; esa salida no debe convertirse en una historia local completa en el rider. El mapa del rider puede mostrar el fix propio más reciente y datos de la orden autorizados. Cualquier destino geográfico exacto, proveedor de tiles, API key, cache o retención necesita decisión de producto/seguridad. Usar un adapter para que el release no dependa de una clave o SDK no aprobado.

## Accesibilidad y operación

- Contraste alto y tipografía escalable.
- Labels para iconos; no depender de color.
- Reintentos con debounce y progreso visible.
- Mensajes en español simple, con valores ARS locales.
- No pedir al rider leer un error SQL/HTTP.
- La pantalla no debe bloquearse por un spinner si el servicio trabaja en background.
- En estado offline, permitir revisar órdenes y recovery, pero deshabilitar mutaciones que requieran revisión fresca.

## Validación UX

- Prueba moderada con al menos dos riders: iniciar, bloquear pantalla, perder red, pausar, reanudar, proceso muerto y orden terminal.
- Instrumented/UI tests para todos los estados y eventos desordenados.
- Golden/screenshot de notificación, RecoveryCard y badges en español.
- Verificación TalkBack, font scale 200 %, display size grande, modo oscuro y permission denial.
- Physical Moto: todas las acciones con una mano mientras el teléfono está montado; medir que Start/Resume no dependa de Flutter vivo.

## Gaps que bloquean aprobación

- Fuente GPS y freshness real inexistentes.
- No hay contrato de completion confirmado.
- Proveedor de mapa/navegación no elegido.
- Detener servicio no tiene semántica operacional clara.
- No existe recovery UX después de process death/force-stop.
