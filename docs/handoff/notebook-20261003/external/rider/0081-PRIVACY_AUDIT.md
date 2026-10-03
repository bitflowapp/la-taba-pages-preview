# Task 03 - Auditoría de privacidad y seguridad

## Resultado

PASS para el código local de lectura. Hay una incompatibilidad de datos
staging documentada: el registro asignado observado usa USD y el cliente exige
ARS.

## Superficie de red

Sólo se agregaron estas operaciones de pedidos:

- `POST` al RPC público `list_available_rider_orders`;
- `GET` a `orders` con `order_items` anidado y filtros RLS.

No existen `INSERT`, `UPDATE`, `PATCH` o `DELETE` de pedidos en esta etapa. No
se llama claim, start delivery, GPS, Realtime ni a una tabla de ubicaciones.
`rider_locations` no aparece en el select ni en una operación de red.

## Datos que no cruzan el bridge

- access token y refresh token;
- contraseña;
- UUID del pedido;
- UUID de producto/item;
- `customer_name` y `customer_phone`;
- `assigned_rider_user_id`;
- `rider_locations`, historiales y secuencias GPS.

El GET pide solamente la dirección/instrucciones operativas que el pedido
asignado autoriza para esta pantalla. Los DTOs nativos validan el UUID del
pedido, pero `toMap()` lo omite.

## Sesión y errores

- Tokens quedan en el almacenamiento nativo cifrado existente.
- Refresh y retry de 401 son responsabilidad de `SessionManager`.
- Hay como máximo un retry de la petición después de una rotación.
- Un segundo 401 provoca logout local best-effort y no una cadena de retries.
- Antes de logout se cancela la llamada activa de pedidos.
- Los bodies HTTP sólo viven durante el parseo; no se guardan ni se loguean.
- `BackendError` conserva únicamente categoría, message key, status y SQLSTATE
  permitido.

## UI y almacenamiento

- La UI usa public code, estado, zona/branch, paquetes, ETA, restricciones,
  dirección asignada, instrucciones, items y dinero autorizado.
- No muestra ni persiste una copia local adicional del body HTTP.
- No muestra teléfono, nombre de cliente, UUID, GPS ni historial.
- No hay cola offline en Task 03; sin red se conserva sólo el snapshot en
  memoria de la pantalla y se informa un error retryable.
- El CTA de claim/start es disabled y no tiene callback mutante.

## Permisos

El manifest mantiene únicamente `android.permission.INTERNET`. No se agregaron
ubicación, notificaciones, foreground service, almacenamiento externo ni
AccessibilityService.

## Claves

El smoke real usó solamente la clave pública `anon` del proyecto staging,
obtenida en memoria. Nunca se usó `service_role`, nunca se versionó una clave
y no se guardaron credenciales en la evidencia.

## Auditorías ejecutadas

- búsqueda de `service_role`, `rider_locations`, headers Authorization y campos
  PII en el código de pedidos;
- tests de envelope sin tokens/body crudo;
- tests de select con filtros de rider/business;
- verificación de APK/manifest sin permisos nuevos;
- captura física final sólo de la pantalla vacía de login.

## Riesgos abiertos

1. `currency_code` no forma parte del RPC de disponibles, aunque la UI etiqueta
   `collection_amount` como ARS por requerimiento de producto.
2. La recuperación asignada depende de una lectura PostgREST RLS porque no hay
   RPC pública. Requiere aprobación de backend/producto antes de producción.
3. Las garantías de proceso en Android no incluyen aún GPS ni foreground
   service; esos controles pertenecen a etapas posteriores.
