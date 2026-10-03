# TABA Rider Android — Registro de riesgos

Severidad: **A** alta / **M** media / **B** baja. Probabilidad igual.

| # | Riesgo | Sev. | Prob. | Detección | Mitigación | Owner |
|---|---|---|---|---|---|---|
| R-01 | **Se empieza por Flutter sin formalizar la máquina de estados** y a mitad de camino el contrato no cierra | A | **A** | Aparece en la fase 4, cuando ya hay semanas invertidas | Fase 0 obligatoria y bloqueante: RPCs formalizados y **probados por la web** antes de la primera línea de Dart | Arquitectura |
| R-02 | El **foreground service es detenido** por el fabricante (Xiaomi, Samsung) y se pierde el seguimiento | A | **A** | `location_service_killed_by_system` en telemetría | Certificación en matriz real; detección al reanudar; aviso al rider; exclusión del ahorro de batería guiada | Android |
| R-03 | **Acciones perdidas** por fallo de la cola durable | A | M | `outbox_rejected` / comandos expirados; auditoría del local | Escritura local antes de la UI; `cmd_id` + `command_log`; sin descarte silencioso; cola visible | Android |
| R-04 | **Consumo de batería** inaceptable en turno largo | A | M | `battery_sample`; medición en turno real | Muestreo por estado; modo detenido a 60 s; envío por lotes; servicio apagado fuera de la ventana; bloqueo de release > 12 %/h | Android |
| R-05 | **Divergencia de estados entre web y Android** durante la convivencia | A | M | Auditoría de `order_events` con origen | Un solo juego de RPCs; ninguna superficie escribe tablas; validación de autoría | Backend |
| R-06 | **Fuga de PII** por telemetría, logs o notificación | A | M | Revisión de eventos; test de scrubbing | `beforeSend` obligatorio + test; payload de push sin PII; base local cifrada | Seguridad |
| R-07 | **Rechazo del permiso de ubicación** en el campo | A | M | `permission_result` | Explicación previa; solicitud en el primer retiro, no en el login; sin permiso de segundo plano | Producto |
| R-08 | **El código de entrega falla** con frecuencia (el cliente no lo encuentra) | M | **A** | `delivery_code_attempt` | 3 intentos; salida por incidencia auditada; el cliente ve el código de forma prominente en su seguimiento | Producto |
| R-09 | **Muerte del proceso** con pérdida de contexto | A | M | `process_death_recovered` | Estado durable en Drift; restauración de ruta; pantalla `recovered`; pruebas con “no conservar actividades” | Android |
| R-10 | **Relojes de dispositivo desfasados** provocan ordenamientos incorrectos | M | M | Diferencia `at` vs `server_time` | El servidor ordena por su propia llegada; `p_at` es informativo | Backend |
| R-11 | **Ubicación simulada** para falsear entregas | M | B | `src: "mock"` en la auditoría | Marcado y alerta al negocio; la decisión es del local, con evidencia | Seguridad |
| R-12 | **Play Store demora o rechaza** por uso de ubicación | M | M | Revisión de la ficha | Sin permiso de segundo plano; declaración con vídeo; distribución interna hasta certificar | Producto |
| R-13 | **Certificate pinning** mal rotado deja a la flota sin app | A | B | Fallo masivo de red tras rotar | Flag remoto para desactivar el pinning; procedimiento de rotación documentado y ensayado | Seguridad |
| R-14 | **Realtime pierde eventos** y el rider no ve un pedido | M | M | Diferencia entre eventos y `rpc_sync_state` | Realtime es acelerador, no fuente de verdad; reconciliación al reconectar y al volver del segundo plano | Backend |
| R-15 | **Notificación crítica silenciada** por el usuario o por el sistema | A | M | Consulta del estado del canal al arrancar | Aviso persistente en `home` si el canal está silenciado; sonido propio; repetición | Android |
| R-16 | **MapLibre** cambia de API o el estilo deja de estar disponible | B | B | Fallo del mapa en CI | Estilo auto-hospedado; versión fijada; el mapa no es imprescindible para entregar | Android |
| R-17 | **El relay de demostración se usa por error** como backend Android | A | B | Revisión de configuración por flavor | Sin URL del relay en ningún flavor de Android; test de configuración | Arquitectura |
| R-18 | **Sesión duplicada en dos dispositivos** con acciones en conflicto | M | B | `session.revoked` y auditoría | Sesión ligada a `device_id`; revocación de la anterior; recuperación del pedido activo desde el servidor | Backend |
| R-19 | **Los tokens de diseño divergen** entre web y Android | B | **A** | Diferencia en CI al regenerar | `taba_tokens.dart` **generado** desde `TOKENS.json`; el build falla si hay diferencias sin commitear | Diseño |
| R-20 | **El rider trabaja sin señal más tiempo del previsto** y la cola crece | M | M | Tamaño de la cola en telemetría | Sin límite de reintentos; diezmado sólo de puntos de ubicación; expiración a 24 h **con aviso**, nunca silenciosa | Android |
| R-21 | **Se retira la vista rider web demasiado pronto** y un fallo deja al local sin operar | A | M | Métricas del despliegue progresivo | La web no se apaga antes de la etapa 8.4; 4 semanas sin incidencias como condición | Producto |
| R-22 | **Cobertura de dispositivos insuficiente**: funciona en el Moto G15 y falla en otros | M | M | Matriz de certificación | Matriz obligatoria con Samsung y Xiaomi, que son los peores casos conocidos | QA |

## Riesgos que se aceptan explícitamente

| Riesgo aceptado | Por qué |
|---|---|
| Sin pedidos múltiples simultáneos en v1 | Multiplica la complejidad de la máquina de estados y de la ruta; se pospone hasta tener datos reales de volumen |
| Sin foto de prueba de entrega en v1 | El código de entrega ya da trazabilidad; la foto añade almacenamiento, permisos de cámara y revisión de privacidad |
| Sin chat con el cliente | La llamada telefónica cubre el caso y ya funciona |
| Ubicación sólo en primer plano | Renuncia deliberada a algo de precisión con la app cerrada, a cambio de mucha mejor tasa de concesión y menos fricción con Play Store |
