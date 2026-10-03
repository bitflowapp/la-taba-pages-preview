# SESSION_SECURITY — Sesión, secretos y límites de confianza

## Resumen

La frontera actual de autenticación es una de las partes más sólidas del rider: los tokens permanecen en Kotlin, el almacenamiento usa Android Keystore y el bridge expone snapshots sin secretos. El hueco crítico aparece cuando el servicio GPS de larga duración necesite publicar: hoy RiderApplication construye un DeliveryServiceCoordinator con contexto/store, pero no le inyecta SessionManager ni un cliente autenticado. Task06/07 deben cerrar esa frontera sin mover tokens a Flutter.

## Clasificación de datos

| Datos | Ejemplos | Tratamiento |
|---|---|---|
| Secreto crítico | access token, refresh token, claves privadas, keystore material | Solo NativeRequestContext/EncryptedSessionStore/Keystore; nunca Dart, logs, crash reports ni queue. |
| Sensible operacional | order_id, dirección, teléfono, coordenadas, captured_at exacto, public code | Solo memoria nativa, payload cifrado o backend autorizado; evitar logs y almacenamiento claro. |
| Estado limitado | estado de servicio, permiso, freshness bucket, queue size, error kind | Bridge/EventChannel sanitizado; sin identidad ni coordenadas. |
| Público/cliente | Supabase URL, publishable key, app version | Puede estar en BuildConfig; no es autorización. Production debe fallar cerrado si falta configuración. |

## Flujo de sesión requerido

### Inicio

1. MainActivity valida campos y solicita la operación a SessionManager.
2. SupabaseAuthClient obtiene access/refresh token y expiry.
3. SessionManager valida membership activa del business configurado.
4. EncryptedSessionStore persiste el estado cifrado en noBackupFilesDir.
5. Dart recibe solo SessionSnapshot: signedIn, user id sanitizado si el contrato lo permite, role y expiry bucket.

No confiar en un business_id enviado por Flutter ni en un rider id local. La identidad de autorización es auth.uid() y la membership que consulta el backend.

### Uso por servicio

El servicio y el uploader reciben interfaces nativas:

- SessionProvider: snapshot/valid token, refresh single-flight, signed-out event.
- AuthenticatedRpcClient: request con apikey y Bearer, errores sanitizados.
- ActiveDeliveryRepository: order/revision scope y estado.
- QueueRepository: payload cifrado y lease.

El servicio no debe leer el archivo de sesión directamente ni crear refresh calls paralelas. Si el token expira, solo SessionManager puede rotarlo. La respuesta de refresh debe volver a validar membership; si falla, detener captura/upload y publicar session_required.

### 401 y refresh

Para cada request:

1. Usar el token actual y conservar una referencia de token observado, no el valor en logs.
2. Ante 401, pedir refresh single-flight.
3. Repetir una sola vez si el registro todavía es vigente.
4. Si hubo sign-out, rider switch o refresh inválido durante la espera, no repetir.
5. No guardar una respuesta HTTP cruda; exponer únicamente AuthError/DeliveryServiceError estable.

### Sign-out

La secuencia segura es:

1. Marcar sesión como signing_out para impedir nuevas publicaciones.
2. Detener FusedLocationProviderClient y uploader.
3. Detener ForegroundService y cancelar callbacks/leases.
4. Borrar o invalidar la cola vinculada al rider scope.
5. Limpiar ActiveDeliveryStore cifrado.
6. Revocar/limpiar sesión local según la capacidad real de Supabase.
7. Emitir signedOut.

Si hay una entrega backend on_the_way, sign-out no debe presentarse como “completó” ni como “canceló”. La UX debe advertir que el seguimiento local se detendrá y la orden puede requerir recuperación al volver a iniciar sesión. Si producto necesita prohibir sign-out durante una entrega activa, debe ser una decisión explícita; no implementarla silenciosamente.

## Estado actual correcto y pendiente

Correcto:

- SessionManager hace refresh con mutex/single-flight y refreshAfterUnauthorized no pisa un token más nuevo.
- EncryptedSessionStore usa AES-GCM 256 y Android Keystore.
- Configuración production está vacía/fail-closed.
- BridgeCodec/BridgeErrorMapper sanitizan Throwable, HTTP status y SQLSTATE permitido sin body.
- RLS/RPC es la autoridad; no hay service_role en el rider.

Pendiente:

- ActiveDeliveryStore no está cifrado.
- El servicio no está ligado a SessionManager.
- EncryptedLocationQueueStore es placeholder.
- No hay key rotation/invalidation policy documentada para cambio de rider, lock-screen, restore o Keystore invalidado.
- En MainActivity.onDestroy no queda resuelto qué pasa con un pending permission/method result.
- No hay auditoría de logs para comprobar que un interceptor HTTP futuro no imprima Authorization.
- No hay política de revocación remota/compromiso de dispositivo fuera del sign-out local.

## Endurecimiento del almacenamiento

- Mantener tokens en noBackupFilesDir y no usar SharedPreferences/FlutterSecureStorage para duplicarlos.
- Cifrar ActiveDeliveryStore con una clave Keystore separada de la sesión o un envelope key versionado.
- Encolar solo payload AES-GCM; AAD debe vincular rider scope, order scope, revision y version.
- Borrar material de cola al sign-out/cambio de identidad.
- Tratar KeyPermanentlyInvalidatedException, JSON corrupto y migration failure como estados de recuperación, no como datos parcialmente confiables.
- No usar el nombre público de la orden como ruta/filename si se puede evitar.
- Aplicar FLAG_SECURE únicamente a pantallas con datos críticos si UX/operación lo aprueba; no ocultar la notificación necesaria del FGS.

## Backend y mínimo privilegio

El cliente solo necesita publicar con la sesión del rider. El SQL Gate2 debe conservar:

- SECURITY DEFINER con search_path fijo para publish_rider_location;
- auth.uid y membership activa;
- rider asignado y estado permitido;
- revisión CAS;
- grants de ejecución exactos;
- RLS que impida insert/update directo sobre rider_locations;
- tracking público limitado a latest/rounded/stale window.

Debe validarse en la instancia staging que los grants efectivos coincidan con el archivo local. El hecho de que un test regex lea una migración no sustituye esa validación.

## Logging y soporte

Permitido:

- app version, API level, device model bucket;
- service state, permission state, network state;
- queue depth/oldest-age bucket;
- upload success/failure reason code;
- duración de la entrega y batería bucket;
- sequence/recorded_at solo como contador/edad, no como ubicación;
- un hash no reversible de order scope si soporte lo necesita.

Prohibido:

- Authorization, refresh token, publishable key si el logger es remoto;
- lat/lng, dirección, teléfono, nombre de cliente;
- order_id/public code crudos;
- SQLSTATE/body/stack trace completo;
- dumps de request/response.

Los errores para rider deben decir qué acción tomar: volver a habilitar precisión, abrir la app, recuperar sesión, comprobar red o contactar soporte. Los detalles internos quedan en reason codes con allowlist.

## Checklist de seguridad de salida

- Static grep/log audit no encuentra tokens, coordenadas ni bodies en logs.
- Un test de bridge demuestra que snapshots/eventos no contienen campos secretos.
- SessionManager y uploader pasan 401 concurrente sin refresh duplicado.
- Cambio de rider no consume cola anterior.
- Sign-out detiene captura y no genera requests posteriores.
- Keystore corrupto/inválido produce fail-closed y recuperación documentada.
- Active metadata y queue payload no son legibles mediante extracción ordinaria del APK/data dir.
- RLS/grants/revocation se validan contra staging real.
- La retención/purga de rider_locations tiene owner, duración y prueba. El Gate2 observado limita la exposición pública a latest, pero no prueba por sí solo la retención interna.

Referencias:

- https://developer.android.com/privacy-and-security/cryptography
- https://developer.android.com/develop/background-work/services/fgs/launch
- C:\1212\la-taba-rider-android\android\app\src\main\java\com\lataba\rider\auth\SessionManager.kt
- C:\1212\la-taba-rider-android\android\app\src\main\java\com\lataba\rider\auth\EncryptedSessionStore.kt
- C:\1212\la-taba-real-orders-staging\supabase\migrations\20260801040000_rider_gps_tracking_gate2.sql
