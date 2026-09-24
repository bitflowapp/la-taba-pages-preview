# La Taba Rider — nueva base Android canónica

**No es fuente recuperada de la APK histórica.** Implementación nueva en Kotlin,
Compose/Material 3, ViewModel, Flow, Coroutines y Navigation Compose. Ningún código
fue descompilado ni copiado desde la APK. Ver `SOURCE-PROVENANCE.md`.

Resultado ejecutado: [verificación del 22/09/2026](VERIFICATION-2026-09-22.md).
Estado del piloto: [verificación del 23/09/2026](VERIFICATION-2026-09-23.md).
Reproducción segura: [QA runbook](QA-RUNBOOK.md).

## Alcance seguro

- La build QA usa sólo Supabase Staging `ucbtjcurawxjwjdvvcvj`; ID QA
  `com.lataba.rider.qa`. La v3 firmada de `com.lataba.rider.pilot` sigue siendo
  una build de ensayo Staging, no la APK comercial del futuro entorno PILOTO.
  Una build PILOTO exige ref nuevo, publishable key del mismo proyecto y
  versionCode ≥ 4; Staging, DEMO y Producción se rechazan.
- La APK estable `com.lataba.rider` no se reemplaza.
- Sólo publishable key, aportada al build por entorno. No keys administrativas.
- Tokens cifrados con Android Keystore; sin backup, sin logs HTTP ni passwords persistidas.
- Sin pantalla Rider de producción web, sin Flutter, sin WebView.
- La release del piloto usa una clave nueva fuera del repo con copia cifrada en
  Credential Manager. No se inventó firma histórica ni se reemplazó v146.

## Compilar / probar

Requiere JDK 17, Android SDK 35, build-tools y licencias Android ya aceptadas.
AGP 8.7.3, Kotlin 2.0.21, Gradle 8.11.1 y dependencias versionadas.
El wrapper verifica SHA-256 de la distribución oficial. Los locks y metadatos
de verificación registran las dependencias resueltas; no son una auditoría de terceros.

Desde el repo web en esta PC (public key en Credential Manager):

```powershell
node scripts/e2e-staging/build-rider-android.mjs
node scripts/e2e-staging/create-rider-pilot-signing-key.mjs
node scripts/e2e-staging/build-rider-pilot.mjs --target staging --version-code 3 --version-name 0.1.2-canonical
```

En otra máquina, definir `ANDROID_HOME` y `RIDER_STAGING_PUBLIC_KEY` (pública), luego:

```powershell
.\gradlew.bat :app:testDebugUnitTest :app:assembleDebug
```

No instalar un build sin configuración pública. Los tests instrumentados de QA
requieren input explícito en almacenamiento privado del paquete y no llevan
credenciales compiladas. Los inputs se eliminan al leerlos y al finalizar.

Cuando exista el proyecto aislado, el operador técnico guarda su clave
**publicable** en Credential Manager bajo `PILOT SUPABASE PUBLISHABLE KEY`, con
el ref del proyecto como usuario; no guarda `service_role` en la APK. Luego
compila con `--target pilot --project-ref <ref-aprobado> --version-code 4
--version-name 0.1.3-canonical`. El build se niega si el ref es Staging, DEMO
o Producción. No ejecutar ni distribuir esa variante antes de aprobar catálogo
y restaurar el backup externo de la firma.

## Contrato, sin backend paralelo

Login Auth por password y refresh rotativo → `identity_register_session` con
`rider_android` → `get_rider_delivery_board`.

El board gobierna `max_active_orders` (actualmente 3). No existe otro límite de
capacidad hardcodeado en la lógica de producto. La cola son ofertas minimizadas
creadas administrativamente por el negocio; no hay despacho automático.

Aceptar/rechazar: `accept_rider_order_offer` / `reject_rider_order_offer`, versión
esperada y llave idempotente estable. Entrega: `mark_delivery_picked_up` →
`start_rider_delivery` → `mark_rider_arrived` → `confirm_delivery_code`.
El código del backend tiene **4 dígitos**, no confundir con OTP de autenticación.
GPS real: `publish_rider_location_fanout`; no replay de muestras viejas ni mocks.

El servidor sigue siendo autoridad de autorización, capacidad, CAS y transiciones.
La app nunca se adjudica una entrega si no recibió confirmación. Tras un error de
red conserva sólo la vista en memoria, deshabilita comandos y vuelve a consultar.
No crea pedidos, no cambia precios y no cancela administrativamente.

Polling cada 5 segundos, con exclusión de lecturas superpuestas y comandos en vuelo.
Foreground location service con notificación y acción Detener; requiere permiso
preciso y entrega en reparto. Sin servicio de arranque automático al iniciar el SO.
Después de force-stop el usuario debe reabrir y activar GPS: no se finge tracking.

La disponibilidad viene del board del servidor. El cambio pasa por
`set_rider_availability` con versión esperada y la presencia se renueva con
`heartbeat_rider_availability`. El panel consulta el mismo estado; se marca
no disponible tras 90 segundos sin renovación. Un comercio debe activar
explícitamente la política; los que aún usan la APK histórica mantienen el
contrato anterior hasta su migración.
Una futura presencia server-side necesita una decisión de producto separada.

## Referencias primarias

- https://developer.android.com/training/permissions/requesting
- https://developer.android.com/develop/ui/compose/bom
- https://supabase.com/docs/guides/auth/sessions
- https://github.com/supabase/auth/blob/master/openapi.yaml

Los resultados efectivos del build y prueba física se registran por separado;
tener esta base no certifica por sí solo producción ni recuperación de v146.
