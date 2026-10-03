# Modelo de seguridad — La Taba Rider Android

## Objetivos

- Un rider sólo opera el negocio y los pedidos que el servidor le autoriza.
- Un APK modificado no puede saltarse claim, revisión, asignación, estado ni límites GPS.
- Un service persistente no expone credenciales ni convierte el cliente en autoridad.
- El GPS exacto no se publica a clientes ni se conserva como historial innecesario.

## Secretos y almacenamiento

### Sesión Supabase

- Access token: cifrado en almacenamiento nativo y sólo accesible por `SessionManager`/service.
- Refresh token: cifrado con una clave AES-GCM derivada/protegida por Android Keystore; nunca entra al árbol Flutter, logs, crash reports ni notificación.
- User id, business id, expiración y versión de sesión: también se validan y se almacenan en el mismo registro cifrado.
- Escrituras de rotación son atómicas. Una pareja access/refresh inconsistente invalida la sesión y detiene publicación.
- No usar SharedPreferences plano, archivos JSON legibles, clipboard, deep links ni variables de entorno empaquetadas para tokens.
- El store cifrado se borra al logout, al cambio de usuario, al error irrecuperable de refresh y al uninstall según Android.

### Entrega activa

`ActiveDeliveryStore` guarda sólo order UUID, public code, rider UUID, business UUID, `revision`, estado operativo, timestamps mínimos y versión de esquema. No guarda el código de entrega del cliente ni la dirección completa salvo que producto lo apruebe.

### Cola GPS

- Base durable cifrada, clave protegida por Keystore.
- Límite por entrega y límite global; TTL duro de 3 minutos.
- Cada registro contiene muestra mínima, `captured_at`, revision, intento y motivo de descarte.
- No se guardan screenshots, ruta reconstruida, historial ilimitado ni coordenadas después de terminal.

## Supabase y claves

La publishable/anon key puede viajar dentro del APK porque no es un secreto. Sus límites son Auth, RLS, permisos de RPC y validaciones de PostgreSQL. No autoriza a confiar en el cliente.

Prohibido:

- `service_role`, JWT privilegiado, password de Postgres o claves de Vault en la app.
- Endpoint paralelo que acepte un JWT propio sin validar Supabase.
- Insertar `rider_locations` directamente.
- Escribir `orders.status`, `assigned_rider_user_id`, `revision`, `sequence`, `recorded_at` o timestamps de servidor desde el dispositivo.
- Desactivar TLS o aceptar certificados arbitrarios.

## Autorización server-side

Cada acción sensible vuelve a comprobar en PostgreSQL:

- `auth.uid()` presente.
- Membresía activa del business y rol rider.
- Pedido delivery.
- Asignación exacta al rider para iniciar/publicar/confirmar.
- Estado permitido.
- Revisión esperada.
- Calidad y antigüedad de la muestra.

La app puede ocultar botones, pero eso sólo es UX. El rechazo real debe venir de la RPC/RLS.

## Protección contra otro rider

- La cola sólo expone código público, zona general, sucursal, paquetes aproximados, cobro y ETA confiable.
- Claim usa `FOR UPDATE`, `p_expected_revision`, estado esperado, assignee esperado y `auth.uid()`.
- El primer claim gana; el segundo recibe conflicto `40001`.
- El no-op sólo existe para el mismo rider ya asignado.
- Start y publish vuelven a comparar el rider asignado; conocer un UUID o public code no alcanza.
- No almacenar el UUID de otro rider ni mostrarlo en UI.

## Protección de muestras viejas/falsas

### Cliente

- Rechazar coordenadas no finitas, precisión > 250 m, heading fuera de rango y speed fuera de rango.
- Rechazar saltos físicamente imposibles según timestamp y precisión, como filtro de UX; nunca sustituye al servidor.
- No aceptar fix con `captured_at` futuro o con más de 3 minutos de antigüedad para publicación.
- No publicar más de una vez cada 5 s; usar 7,5 s como objetivo normal.

### Servidor

- `recorded_at` lo fija PostgreSQL.
- `sequence` es global y único.
- `order_revision` se toma de la fila bloqueada.
- `captured_at` sólo sirve para rechazar futuro/atraso y retroceso temporal.
- El último fix público se selecciona por `sequence`, por rider asignado, con accuracy y ventana temporal.

Un atacante puede falsear GPS desde un APK modificado; Gate 2 reduce el daño y asegura autorización, pero no prueba que la coordenada sea físicamente verdadera. La detección antifraude adicional requiere una decisión de backend/producto.

## No exposición de GPS histórico

- Flutter recibe último estado, no un historial.
- El servicio no conserva muestras después de publicarlas salvo que estén pendientes de retry.
- El DTO público redondea lat/lng a tres decimales, eleva accuracy mínima a 100 y devuelve sólo una ubicación.
- `rider_locations` no es legible para `anon` y Gate 2 revoca privilegios de tabla para clientes; las surfaces públicas usan RPC tokenizada.
- No se muestran coordenadas en logs, notificaciones, analytics, crash reports, screenshots ni fixtures.
- Al terminalizar, el trigger de privacidad purga las ubicaciones exactas del pedido y el token público se revoca/limita según el contrato observado.

## Logs y observabilidad

Permitido:

- códigos de evento (`GPS_QUEUED`, `GPS_PUBLISHED`, `AUTH_REFRESH_FAILED`), estado técnico, cantidad de intentos, latencia redondeada, edad de muestra y SQLSTATE.
- identificadores hash truncados sólo si el sistema de observabilidad los necesita.

Prohibido:

- access/refresh tokens, `apikey` completa, email/password, coordenadas, dirección, teléfono, código de entrega, payload completo, JWT o headers.

El logger debe sanitizar excepciones de HTTP antes de emitirlas. Las pruebas deben afirmar que cadenas secretas no llegan a logs.

## Permisos Android

- Pedir ubicación sólo tras una acción explícita de inicio de entrega.
- Explicar por qué una entrega activa requiere ubicación en segundo plano.
- Tratar permiso aproximado, permiso revocado, “only this time”, GPS apagado y notificación denegada como estados visibles.
- No usar AccessibilityService ni técnicas para eludir el sistema.
- La notificación persistente no incluye PII innecesaria.

## Logout y terminal

El logout no debe borrar tokens antes de detener el service. Secuencia: marcar `STOPPING`, cancelar updates, detener cola, cancelar notification, borrar active delivery, borrar sesión y emitir estado signed out. Si la entrega está activa, el flujo normal debe bloquear logout porque no existe una RPC observada para pausar/cancelar.

Al confirmar entrega, el stop es inmediato y además se reconcilia con el backend. Si la app se cae después de la confirmación, la recuperación ve estado terminal y vuelve a detener/purgar sin publicar.

## Riesgos residuales

- Un usuario con control físico total puede descompilar el APK y falsificar coordenadas.
- OEMs pueden detener servicios pese a foreground.
- Una cuenta rider comprometida puede operar mientras el backend la considere activa.
- La exposición de dirección/teléfono en `rider_order_rpc_payload` es una decisión de privacidad de producto que no debe resolverse sólo en UI.
- Las versiones local y remota de configuración Auth pueden diferir; deben verificarse antes del release.

