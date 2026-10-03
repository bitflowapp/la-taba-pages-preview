# ADR-002 — Room con payload GPS cifrado para cola offline

Estado: Propuesto  
Fecha: 2026-08-02

## Contexto

El backend acepta una muestra por llamada y rechaza muestras demasiado antiguas o fuera de orden. La red móvil puede desaparecer y el proceso puede morir. EncryptedLocationQueueStore y QueueDrainWorker actuales son placeholders. Un JSON o una lista en memoria pierde datos y no soporta lease/ACK transaccional.

## Decisión

Usar Room para esquema, DAO, migraciones y transacciones. Cifrar el payload completo por fila con AES-GCM y Android Keystore; almacenar solo order/rider scopes HMAC, revision, tiempos mínimos y estados operativos. Considerar SQLCipher únicamente si la política exige cifrado de archivo completo y después de aprobar la dependencia. La cola tiene estados PENDING, IN_FLIGHT, RETRY_WAIT y DEAD, lease recuperable, límites de tamaño/edad/intentos y un único uploader por rider.

El ACK borra la fila en una transacción. Un crash antes del delete puede repetir una muestra, pero no se inventa un idempotency RPC; se apoya en validación de captured_at/revision y en observabilidad de sequence.

## Alternativas consideradas

1. DataStore: descartado para una cola ordenada con consultas, leases y lotes.
2. SQLite directo: posible, pero con más riesgo de SQL/migración manual.
3. Cola solo en memoria: descartada por pérdida ante offline/process death.
4. Cifrar solo archivo sin cifrar payload: insuficiente si hay export/backup o diagnóstico parcial.

## Consecuencias

Positivas: durabilidad, migraciones verificables, recovery de leases y acceso transaccional.  
Negativas: dependencia adicional, diseño de claves/migraciones y necesidad de decidir si SQLCipher es obligatorio. Los límites de 2.000 muestras/8 MB son política inicial y deben calibrarse en Moto.

## Requisitos de aceptación

- Airplane mode y retorno de red conservan y drenan la cola.
- Crash/restart recupera IN_FLIGHT.
- 401, 40001, P0001, 429 y 5xx tienen tratamiento diferente.
- Logout/cambio de rider no envía payload de otra identidad.
- Una extracción ordinaria no revela lat/lng, order_id ni tokens.
