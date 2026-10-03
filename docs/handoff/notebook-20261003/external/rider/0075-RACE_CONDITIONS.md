# Condiciones de carrera y resolución

## Matriz auditada

| Carrera | Riesgo previo | Defensa resultante | Evidencia automatizada |
|---|---|---|---|
| 50 toques en claim | Más de un claim o dos pedidos activos | Single-flight por operación y lock exclusivo global; un segundo pedido falla explícitamente mientras el primero está activo | Tests Flutter de 50 toques y segundo pedido; test Kotlin de exclusión |
| 50 toques en start | RPC/start del servicio repetidos | Single-flight con cache breve de éxito y `operationId` sólo local | Test Flutter: 50 llamados producen un RPC |
| Start contra stop | Respuesta tardía podía reactivar el servicio | Stop incrementa el serial/generación y supersede el start pendiente | Test Flutter con start en vuelo + stop |
| Stop repetido | Doble teardown o error espurio | Stop idempotente para una misma generación | Tests de controlador/coordinador y ciclo de servicio |
| Dos pedidos activos | Cambio silencioso de autoridad | El coordinador bloquea un pedido distinto cuando existe start/entrega activa | Tests de claim y operación exclusiva |
| Refresh simultáneo | Varias rotaciones o cast inválido | `TokenRefreshMutex` ejecuta una rotación compartida; la sesión se lee bajo lock | Test Kotlin con 50 callers y una rotación |
| Dos publicaciones GPS | Duplicación y secuencia fuera de orden | Actor serial, publisher sincronizado y una publicación en vuelo | Test Kotlin con dos muestras y máximo de concurrencia 1 |
| ACK/callback luego de stop | Evento `fresh` posterior a stop | Generación invalidada, gateway cancelado y chequeo posterior a llamada bloqueante | Test Kotlin de completion tardía |
| Respuesta vieja sobre estado nuevo | Revisión/generación anterior podía sobrescribir UI | Comparación por `generation` y `event_id`; serial de operación en controladores | Tests Flutter de evento duplicado/viejo y refresh tardío |
| Activity recreada | Continuación o permiso pendiente quedaban huérfanos | Bridge de aplicación conserva autoridad; request pendiente finaliza con error sanitizado de recreación | Test instrumentado de bridge y estado recuperado en Flutter |
| Flutter/EventChannel recreado | Listener doble y eventos duplicados | Una registración activa de proceso, detach explícito y token de stream | Test de eventos duplicados/orden; validación de bridge |
| Servicio ya running al reabrir | Reinicio del actor o falsa inferencia local | Se consulta estado nativo, metadata y backend; start del mismo ciclo no recrea actor | Tests de recovery y servicio instrumentados compilados |
| Cambio de perfil/logout | Callbacks del rider anterior podían continuar | Logout detiene coordinador, actor y todos los transports antes de borrar tokens; cambio de sesión exige logout | Tests de sesión y terminal/access stop |
| Ubicación apagada/reactivada | `noSignal` podía convertirse en un estado sin salida | Se emite `location_services_disabled` sin pausar el actor; la siguiente muestra válida vuelve a publicar | Test Kotlin directo de `noSignal` accionable → `fresh` |
| Red perdida durante publicación | El reintento era seguro, pero la UI no recibía una causa accionable | La muestra queda en cola y sólo se propagan claves locales permitidas; `network_unavailable` se presenta como “Sin red” | Test Kotlin de cola+error y test widget de mensajes |

## Reglas de orden

1. `generation` identifica un ciclo nativo de delivery.
2. `event_id` crece dentro de la autoridad nativa y resuelve duplicados del stream.
3. `operationId` conecta fases locales de start, pero nunca es argumento Supabase.
4. `revision` sigue siendo la CAS del contrato backend.
5. Una respuesta sólo puede mutar estado si su operación y generación siguen vigentes.
6. Un fallo de acceso, sesión, revisión o terminal purga la cola efímera y requiere stop.

## Límites conscientes

- Los locks son de proceso; no prometen coordinación después de **Forzar detención**.
- La recuperación posterior a process death depende de metadata mínima válida más reconciliación backend.
- No existe cola persistente GPS en esta etapa, por decisión explícita de alcance.
