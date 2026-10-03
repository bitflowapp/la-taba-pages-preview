# OFFLINE_QUEUE — Cola GPS durable, cifrada y reintentable

## Decisión

Usar Room como acceso transaccional a una cola local, con el payload GPS cifrado por fila mediante AES-GCM y una clave protegida por Android Keystore. Room no cifra por sí mismo. No se deben persistir lat/lng, order_id ni tokens en columnas de texto legibles; las columnas operativas usarán identificadores opacos/HMAC y timestamps mínimos. Si la política exige cifrado completo del archivo SQLite, evaluar SQLCipher como dependencia aprobada antes de implementarlo; no asumir que “Room” equivale a cifrado.

DataStore es adecuado para preferencias/snapshot pequeño, no para una cola ordenada con reintentos y claims transaccionales. SQLite directo sería viable pero deja sin verificación de esquema, migraciones y DAO; Room reduce esos riesgos. La cola no debe vivir en memoria ni en un JSON que el proceso pueda perder.

## Modelo lógico

Tabla queue_item:

| Campo | Persistencia | Uso |
|---|---|---|
| local_id | claro, autogenerado | Orden interno, sin significado de negocio. |
| rider_scope_hmac | claro | Evitar que una sesión/rider consuma otra cola. |
| order_scope_hmac | claro | Particionar sin exponer order_id. |
| revision | claro | Reconciliación/CAS; no es secreto. |
| captured_at_epoch_ms | claro, mínimo | Orden y expiración; no guarda coordenadas. |
| state | claro | PENDING, IN_FLIGHT, RETRY_WAIT, DEAD. |
| attempts | claro | Límite de reintentos. |
| next_attempt_at | claro | Backoff. |
| payload_version | claro | Migración de cifrado/DTO. |
| payload_ciphertext | cifrado | order_id, revision, lat, lng, accuracy, heading, speed, captured_at. |
| iv/tag | asociado al ciphertext | AES-GCM. |
| last_error_kind | whitelist | Diagnóstico sanitizado, sin body. |

El AAD debe incluir payload_version, rider_scope_hmac, order_scope_hmac y revision. La clave de cifrado debe estar separada por instalación/rider scope; al cerrar sesión se invalida o se borra el material que ya no puede ser utilizado. No incluir access_token ni refresh_token en la cola.

Límites iniciales a validar con negocio:

- máximo 2.000 muestras o 8 MB, el menor;
- máximo 24 horas de edad local para una muestra, además del límite server-side de tres minutos;
- máximo 8 intentos por fila o 30 minutos de backoff acumulado;
- dead-letter acotada a 100 filas, solo con reason code;
- ante overflow, descartar primero muestras intermedias de una orden conservando la más reciente válida y emitir queue_overflow; nunca bloquear el hilo de ubicación.

Los números son políticas iniciales, no hechos del backend. Deben medirse en Moto y aprobarse en Task10.

## Máquina de estados

~~~
PENDING -> IN_FLIGHT -> ACKED (delete)
PENDING -> RETRY_WAIT -> IN_FLIGHT
IN_FLIGHT -> PENDING        (crash/lease vencido)
IN_FLIGHT -> DEAD           (error permanente)
PENDING/RETRY_WAIT -> DEAD  (stale, revision conflict, permission policy)
~~~

La transición a IN_FLIGHT debe ser transaccional y tener lease/lease_until para que una muerte de proceso no deje filas bloqueadas. Solo un uploader activo por rider scope. Al recibir una respuesta válida, registrar resultado y borrar la fila en una transacción; si el proceso muere antes del delete puede existir un retry, pero el servidor rechazará datos viejos o la secuencia servirá para medir duplicados. No inventar una idempotency RPC que el backend no ofrece.

## Uploader

El uploader vive en el proceso nativo y usa SessionManager. No depende del Dart isolate, del estado de una pantalla ni de un callback de conectividad. Un servicio foreground puede drenar con red; WorkManager puede ejecutar un drain acotado cuando hay red y la app no está visible. WorkManager no reemplaza el FGS para captura continua y cada Worker debe terminar dentro de su límite operativo.

Reglas:

1. Seleccionar filas por order_scope, next_attempt_at y captured_at.
2. Revalidar sesión, active order y revision antes de cada lote.
3. Enviar lotes pequeños o una muestra por llamada según contrato; el RPC actual recibe una muestra, no un array.
4. Aplicar backoff exponencial con jitter: base 5 s, máximo 5 min, respetando Retry-After si existe.
5. No repetir indefinidamente errores de validación.
6. Despertar al retornar la red, sin crear múltiples drains.
7. Publicar métricas agregadas: queue depth, oldest age bucket, upload success/failure kind, retry count; nunca payload.

## Mapeo de respuestas Gate2

| Resultado | Acción |
|---|---|
| 2xx con sequence | Confirmar y borrar; emitir last_server_sequence/recorded_at. |
| 401 | Refresh single-flight y una repetición controlada; si falla, pausar upload y pedir login. |
| 403 | Detener publicación, conservar solo reason code y reconciliar membership/order. |
| 40001 | Marcar stale y borrar la fila; refrescar assigned/revision. |
| P0001 de frecuencia | RETRY_WAIT con floor de seis segundos; no generar loop. |
| 422/400 de payload/estado | DEAD y mostrar diagnóstico accionable; no retry ciego. |
| 429 | RETRY_WAIT usando Retry-After o backoff. |
| 5xx, timeout, sin red | RETRY_WAIT; preservar hasta límite de edad/tamaño. |

El cliente actual conoce errores HTTP sanitizados; extender esa taxonomía sin devolver body SQL. La revisión obsoleta puede requerir una consulta assigned, pero no una mutación inventada.

## Cierre de sesión y orden terminal

Antes de limpiar tokens, detener captura y uploader. La cola queda vinculada al rider/session scope; por seguridad no debe enviarse con otra cuenta. La política recomendada es borrar las filas pendientes al sign-out explícito y registrar solo queue_cleared_count. Si producto necesita continuidad tras re-login, requiere una política aprobada de retención/transferencia; no reutilizar silenciosamente credenciales antiguas.

Al detectar estado delivered/cancelled o permiso perdido, detener captura. La información pendiente que el servidor ya no aceptaría se mueve a DEAD, no se reintenta para siempre.

## Tests de aceptación

- Inserción concurrente desde callbacks sin pérdida ni duplicado lógico.
- Reinicio de proceso con filas PENDING e IN_FLIGHT: lease recuperable.
- DB corrupta o clave Keystore inválida: fail closed, no publicar y mensaje accionable.
- Sin red durante 15 minutos: captura limitada, cola acotada, sin ANR; retorno de red drena.
- 401 con refresh concurrente: una sola actualización y no se filtran tokens.
- 40001/P0001/429/5xx con respuestas MockWebServer exactas.
- Logout, cambio de rider y orden terminal no envían filas con identidad equivocada.
- Inspección del filesystem/logcat demuestra ausencia de coordenadas, order_id legible, tokens y cuerpos SQL.
- Physical Moto: medir batería, cola máxima, edad de muestra y retorno a Fresh después de red.

Referencias Android:

- https://developer.android.com/training/data-storage/room
- https://developer.android.com/codelabs/android-preferences-datastore
- https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work
- https://developer.android.com/reference/androidx/work/WorkManager.html
- https://developer.android.com/privacy-and-security/cryptography
