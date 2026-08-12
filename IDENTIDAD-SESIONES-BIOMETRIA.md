# TABA2 · Identidad de staff y riders, sesiones persistentes y biometría

Estado: **TABA2_IDENTITY_BIOMETRIC_SESSION_LAYER_READY_FOR_STAGING.**
Listo para aplicar a staging. No aplicado, no desplegado, no pusheado — porque
el encargo lo prohíbe, no porque falte algo.

Lo que sigue describe lo construido, lo medido y lo que falta. Está escrito para
que quien lo lea pueda desconfiar de cada afirmación y verificarla.

---

## 1. Qué había antes (auditado, no supuesto)

**Repos y puntas canónicas verificadas el 2026-08-12:**

| | repo | punta canónica | base de este trabajo |
|---|---|---|---|
| Web/Panel | `bitflowapp/la-taba-pages-preview` | `feature/taba2-commercial-production-hardening` · `5a7d4e5` | rama `feature/taba2-identity-session-biometrics` |
| Rider | repositorio propio del Rider, sin remoto | `feature/taba2-rider-shifts-dispatch` · `ae90ab6` | rama `feature/taba2-rider-identity-biometrics` |

Worktrees aislados, uno por rama, bajo el directorio de worktrees del proyecto.
Ningún otro frente fue tocado.

**HEADs al cerrar:**

* web · `feature/taba2-identity-session-biometrics` = `0be5b23`, tres commits
  sobre `5a7d4e5`;
* Rider · `feature/taba2-rider-identity-biometrics` = `4796a7c`, un commit sobre
  `ae90ab6`.

Mientras esto se escribía, otra sesión avanzó la punta web de `5a7d4e5` a
`0a5f6d0` con el retorno desde Mercado Pago. **No hay un solo archivo en común
entre los dos trabajos**, verificado por intersección de los dos diffs, así que
la integración es un merge limpio. Ninguna de las dos ramas fue empujada.

**El modelo de identidad completo era una tabla:**
`business_members(business_id, user_id, role, is_active)`, con el rol restringido
por CHECK a `('owner','staff','rider')`.

Cuatro cosas que la auditoría encontró y que importan:

1. **El rol `admin` era un fantasma.** La migración `20260725030000` creó tres
   políticas RLS que le dan poderes a `admin` ("production admins add/update/remove
   staff and riders") y el cliente web declara `TEAM_ROLES` con `admin` adentro.
   Pero el CHECK de la columna nunca lo permitió: esas tres políticas jamás
   pudieron evaluarse a verdadero. Autoridad declarada que no existía.

2. **`authenticated` tenía `insert/update/delete` sobre `business_members`.** Lo
   único que contenía una escalada de privilegios eran las políticas RLS. Una
   política mal escrita en el futuro alcanzaba para que alguien se subiera el rol.

3. **No había forma de revocar nada.** No existía registro de sesiones ni de
   dispositivos. Dar de baja a una persona significaba poner `is_active=false`, y
   su token seguía sirviendo hasta vencer. El `signOut` del Panel y el del Rider
   eran **puramente locales**: vaciaban el almacenamiento del cliente y dejaban
   vivo el refresh token del lado del servidor.

4. **No había auditoría de identidad ni perfiles.** Ni `staff_profiles`, ni
   `rider_profiles`, ni registro de quién dio de alta o de baja a quién.

Del lado del Rider, en cambio, la base era sólida: `SessionManager` en Kotlin,
tokens cifrados con AES-256-GCM bajo una clave del Android Keystore en
`noBackupFilesDir`, escritura atómica, mutex de renovación y ningún token
cruzando el puente a Flutter. Lo que faltaba era biometría y que la revocación se
sintiera.

---

## 2. Arquitectura

### El hecho medido sobre el que se apoya todo

Antes de escribir una línea se midió el emisor de tokens (GoTrue v2.193, sonda
contra el stack local, usuario de prueba creado y borrado):

* el access token lleva un claim **`session_id`**, y ese identificador **NO cambia
  al renovar con el refresh token** — lo que rota es el refresh token, no la
  sesión;
* lleva **`is_anonymous`**, que distingue al cliente que compra del equipo;
* borrar la fila de `auth.sessions` hace que el refresh siguiente devuelva
  `refresh_token_not_found`, verificado en el mismo experimento;
* el rol `postgres` tiene privilegio de `delete` sobre `auth.sessions` y
  `auth.refresh_tokens`.

De ahí sale que **marcar una sesión alcanza para que ningún token derivado de ella
siga sirviendo**, sin esperar a que expire nada.

### La compuerta

`public.identity_member_role(business_id)` es la única función que decide. Devuelve
el rol vigente o `null`, aplicando cinco reglas, todas fail-closed:

1. una sesión anónima nunca es equipo, aunque tenga membresía;
2. la membresía tiene que existir y estar activa;
3. la persona no puede estar deshabilitada;
4. la sesión no puede estar marcada como revocada;
5. el token tiene que ser posterior a `sessions_valid_from`; si no se puede fechar
   y hay un corte vigente, tampoco pasa.

**La compuerta vive DENTRO de `is_business_member` y `has_business_role`**, que ya
estaban cableadas en decenas de políticas RLS y de RPC. Por eso una baja o una
revocación se hacen valer en todo lo ya escrito sin tocar una sola política. Es la
decisión de diseño que hace que esto sea aplicable a un sistema de 79 migraciones
sin reescribirlo.

### Revocación en dos capas

| capa | qué hace | cuánto tarda |
|---|---|---|
| `identity_sessions.revoked_at` + compuerta | rechaza el access token ya emitido | inmediato |
| `delete from auth.sessions` | corta la cadena de renovación en el emisor | inmediato para el refresh |

Las dos hacen falta. La segunda sola dejaría al access token vivo hasta una hora;
la primera sola dejaría al refresh token renovando para siempre.

---

## 3. Migraciones

Seis migraciones nuevas, `20260812010000` a `20260812060000`. El total pasa de 73
a 79.

| archivo | qué agrega |
|---|---|
| `..._identity_core_model.sql` | `admin` como rol real; `staff_profiles`; `rider_profiles`; `identity_user_security`; catálogo de 20 permisos y su asignación por rol |
| `..._identity_sessions_and_audit.sql` | `identity_sessions` (PK = `session_id` de GoTrue); `identity_audit_events` append-only por trigger |
| `..._identity_authorization_gate.sql` | lectores de claims; `identity_member_role`; redefinición de `is_business_member`, `has_business_role` e `is_assigned_rider`; permisos explícitos |
| `..._identity_session_lifecycle.sql` | alta, latido y cierre de la propia sesión; borrado de la sesión en el emisor; **cierre de la escritura directa de membresías** |
| `..._identity_invitations.sql` | alta en dos actos: autorizar y tomar posesión |
| `..._identity_admin_surface.sql` | equipo, sesiones, cambio de rol, baja/alta, revocación puntual y total, lectura de auditoría |

Todas las funciones `SECURITY DEFINER` fijan `search_path = pg_catalog, public,
pg_temp` (más `extensions` donde hace falta `digest`/`gen_random_bytes`). El
ensayo lo verifica recorriendo `pg_proc`, no leyendo el código.

### Permisos por rol

| permiso | owner | admin | staff | rider |
|---|:-:|:-:|:-:|:-:|
| `orders.read` / `orders.operate` / `orders.dispatch` | ✓ | ✓ | ✓ | |
| `orders.cancel` | ✓ | ✓ | | |
| `delivery.operate` | ✓ | | | **✓** |
| `catalog.read` / `catalog.write` | ✓ | ✓ | ✓ | |
| `catalog.publish` / `business.settings` | ✓ | ✓ | | |
| `payments.read` | ✓ | ✓ | ✓ | |
| `payments.reconcile` / `fiscal.read` | ✓ | ✓ | | |
| `fiscal.authorize` | ✓ | | | |
| `identity.members.read/write` · `identity.invite` · `identity.sessions.read/revoke` · `audit.read` | ✓ | ✓ | | |
| `identity.roles.write` | **✓** | | | |

El Rider tiene **exactamente un permiso**. Está medido, no declarado.

---

## 4. Alta de personas

**El primer owner** de un entorno nuevo se crea con
`scripts/identity-bootstrap-owner.mjs`, con clave de servicio. Se niega a correr
si el comercio ya tiene algún integrante: un bootstrap repetible es una puerta
trasera. **No recibe la contraseña por variable de entorno** —quedaría en el
historial de la consola— sino que genera un enlace para que la persona elija la
suya.

**Todos los demás** entran por invitación, en dos actos separados y auditados:

1. `identity_create_invitation(business, email, rol, nombre)` — un owner (o un
   admin, sólo para staff y rider) autoriza el alta. **No crea todavía ninguna
   membresía**, así que una invitación olvidada no deja permisos vivos.
2. `identity_accept_invitation(token)` — la persona, ya autenticada con su
   cuenta, canjea. Recién ahí nacen la membresía y el perfil.

El token vuelve **una sola vez**, en la llamada que lo crea; en la base queda
únicamente su sha256. El canje exige que el correo del token de sesión coincida
con el invitado: **una invitación filtrada no sirve en manos de otro.**

### Sobre el alta pública

`enable_signup` sigue en `true` y esto es deliberado, no un olvido. Bajarlo tiene
un costo que hay que verificar antes: en GoTrue el interruptor global de altas
**también cubre el endpoint anónimo**, del que dependen todos los clientes que
compran; y apagar el proveedor de correo rompería el ingreso con contraseña del
equipo. **Queda como pendiente verificable contra una instancia, no aplicado a
ciegas.**

Lo que sí está resuelto es lo que importa: **registrarse públicamente no otorga
nada.** Sin membresía no hay rol, sin rol no hay permisos, y las membresías ya no
se pueden escribir desde el cliente. Está medido en dos ensayos hostiles: un
ajeno no puede inscribirse solo ni emitir invitaciones.

---

## 5. Sesión persistente del Rider

El contrato pedido:

> login → cerrar la app → muerte del proceso → reiniciar el teléfono → abrir →
> sesión restaurada

está cubierto por `RiderSessionLifecycleTest`, donde cada instancia nueva de
`SessionManager` es un proceso nuevo y lo único que sobrevive es el archivo
cifrado. Se mide además que **no se vuelve a pedir la contraseña ni una sola vez**
y que un access token vencido se renueva solo.

* Los secretos viven en `noBackupFilesDir`, cifrados con AES-256-GCM. **No hay
  SharedPreferences ni texto plano.**
* El rastro de diagnóstico publica vocabulario cerrado —tipo de evento, estado,
  rol, clase de error— y **ningún token, ningún correo, ninguna excepción cruda**.
* Se vuelve a pedir credenciales sólo por: logout explícito, refresh inválido o
  revocado, cuenta deshabilitada, o cambio de la biometría registrada.

**Lo que cambió:** la app leía `business_members` por REST para decidir si podía
entrar. Esa lectura no sabía nada de sesiones. Ahora el alta y **cada renovación**
pasan por las RPC de identidad, así que una baja o una revocación hechas desde el
Panel cierran la sesión en el ciclo de refresh siguiente. Y el logout cierra
primero en el servidor, mientras el token local todavía existe, porque después ya
no hay con qué hacerlo.

---

## 6. Biometría del Rider

**No se almacena, no se transmite y no se procesa ningún dato biométrico.** La
huella y el rostro los tiene el sistema operativo; la app recibe únicamente un
`Cipher` que el sistema autorizó, para una sola operación. En el backend no
existe ningún campo de biometría y ninguna llamada la menciona.

### Cifrado en sobre, no un booleano

El archivo de sesión se cifra con una clave de sobre aleatoria de 256 bits. Esa
clave se guarda **envuelta** por una clave del Android Keystore creada con:

* `setUserAuthenticationRequired(true)`
* `setUserAuthenticationParameters(0, AUTH_BIOMETRIC_STRONG)` — cero segundos de
  validez: la autorización vale para esa única operación criptográfica, y sólo
  biometría fuerte; **el PIN del teléfono no abre la sesión del Rider**
* `setInvalidatedByBiometricEnrollment(true)`

Sin biometría no hay clave de sobre, y sin clave de sobre el archivo no se abre.

**Por qué el sobre y no cifrar directamente con la clave del Keystore:** con la
clave auth-bound cifrando el archivo, *cada renovación de token en segundo plano*
pediría el dedo. Eso es inusable repartiendo. Con el sobre se pide una vez al
abrir, la clave queda en memoria del proceso, y el servicio en primer plano sigue
publicando GPS y drenando la cola sin interrumpir a nadie.

### Sin dependencias nuevas

Se usa `android.hardware.biometrics.BiometricPrompt` directo, no
`androidx.biometric`. El módulo del Rider declara `okhttp` y
`play-services-location` y nada más; sumar una dependencia para esto no se
justifica. Por debajo de Android 9 la protección no se ofrece y el arranque pide
credenciales.

### El nivel viaja en la cabecera

El archivo lleva una cabecera que dice con qué clave está cifrado. Eso permite
saber si hace falta el dedo **antes** de intentar descifrar. Sin eso, una sesión
protegida se veía como almacenamiento corrupto y mandaba al formulario de ingreso
a alguien cuya sesión estaba perfectamente viva —que es exactamente el defecto que
hace que la gente desactive la protección.

El formato anterior (`iv||ciphertext`, sin cabecera) **se sigue leyendo**: un
teléfono que ya venía trabajando no queda afuera por una actualización.

### Fallback seguro

| qué pasa | qué hace la app |
|---|---|
| cancela el diálogo | vuelve a la pantalla de desbloqueo, sesión intacta, puede reintentar |
| lectura rechazada | ídem, con el motivo dicho |
| sensor ocupado | ofrece el desbloqueo igual |
| sin huellas registradas / sin sensor / Android viejo | credenciales |
| **cambian las huellas del teléfono** | la clave del Keystore se invalida sola, se limpia el material y se piden credenciales |
| material perdido | credenciales, con motivo `biometric_material_missing` |

La salida —«Entrar con contraseña»— está **siempre** a la vista. Nadie queda
atrapado.

### Medido en el Moto G15, no deducido

Se creó en el teléfono una clave con **exactamente** la especificación que usa la
app y se intentó operarla sin pasar por el diálogo del sistema. El Keystore la
rechazó desde el hardware seguro:

```
disponibilidad = available
clave auth-bound creada = true
KeyStoreException: Key user not authenticated
  (internal Keystore code: -26 · Error::Km(r#KEY_USER_NOT_AUTHENTICATED))
```

Eso es lo que sostiene toda la protección: **la clave no opera mientras el
sistema no haya autenticado a alguien.** Si esa negativa no ocurriera, la
biometría sería decorativa y la sesión se abriría igual. Está medido, no
supuesto.

También se verificó en el aparato que el nivel del dispositivo sigue funcionando
con el Keystore real, que el formato anterior se sigue abriendo, y que en el
archivo no hay ni el token en claro ni una sola cadena biométrica.

**Lo que la firma NO cubre, dicho para que nadie lo suponga:** nadie apoyó un
dedo. Que `BiometricPrompt` devuelva un `Cipher` autorizado tras una lectura
real es contrato del sistema operativo y es el único paso que necesita una
persona. Todo lo que rodea a ese paso —creación de la clave, negativa sin
autenticación, envoltura, desenvoltura, restauración, y los caminos de
cancelación, rechazo, sensor caído, huellas cambiadas y material perdido— está
probado.

---

## 7. Revocación, dispositivos y auditoría

El owner (y el admin, con menos alcance) puede:

* ver el equipo con su estado y cuántas sesiones tiene abierta cada persona;
* ver sesiones y dispositivos, con etiqueta legible («Moto G15 · Android 15»);
* **cerrar una sesión puntual** sin tocar las demás;
* **cerrar todas** las de una persona, incluidas las que nunca se registraron —
  para eso está la línea de corte por fecha;
* **dar de baja** a alguien, lo que cierra sus sesiones, mueve la línea de corte y
  suspende su perfil **sin borrar su historial de pedidos**;
* leer la auditoría.

Un admin **no puede** tocar a un owner ni a otro admin, ni otorgar esos roles. El
**último owner activo no se puede degradar ni dar de baja**: el comercio no puede
quedarse sin conducción.

La auditoría registra alta, aceptación, revocación de invitación, activación,
baja, cambio de rol, apertura, cierre y revocación de sesiones. Es **append-only
por trigger**, no sólo por grants —un grant se puede volver a otorgar por
descuido, un trigger se nota— y no guarda tokens ni correos completos: de un
correo queda sólo el dominio. Está medido.

---

## 8. Panel: sesiones y la auditoría de WebAuthn

Lo hecho, siguiendo la prioridad del encargo (RBAC + sesión segura + revocación):

* el Panel resuelve su rol con `identity_current_context`, no leyendo
  `business_members`. Leer la tabla decía si la fila existía y estaba activa, y
  nada más: una sesión revocada seguía pasando esa comprobación hasta que el token
  venciera;
* registra su sesión al entrar, para que aparezca en la lista del dueño;
* al cerrar sesión llama primero al cierre remoto y después vacía el navegador; si
  el remoto falla, se vacía igual;
* `js/services/identity-admin.js` expone equipo, sesiones, revocación,
  invitaciones y auditoría. **Ninguna decisión de autorización vive en ese
  archivo**: el backend dice que no y el archivo lo traduce a un mensaje.

### WebAuthn / passkeys: auditado, no implementado

**Es viable.** El `config.toml` del CLI ya trae los bloques `[auth.passkey]` y
`[auth.webauthn]` comentados: la plataforma lo soporta y está detrás de
configuración. El modelo encaja con el contrato pedido: la biometría la maneja el
navegador y el sistema, y el servidor guarda **sólo material criptográfico
público** —id de credencial, clave pública, contador de firmas—. Nunca se captura
huella ni cámara desde la web.

**Lo que lo bloquea hoy no es el código: es el dominio.** Una passkey se registra
contra un `rp_id`, que es un dominio, y sólo sirve en ese origen. TABA2 **no tiene
entorno de producción** ni dominio propio decidido; registrar passkeys ahora las
ataría a un origen temporal y habría que volver a registrarlas a mano, una por
persona, el día que se mude. Por eso se deja documentado y priorizado detrás de
RBAC, sesiones y revocación, tal como preveía el encargo.

Cuando exista el dominio, el trabajo es: habilitar `[auth.passkey]`, fijar
`rp_id` y `rp_origins`, agregar registro y desafío en el Panel, y **conservar la
contraseña como fallback** —una passkey perdida no puede dejar al dueño afuera de
su propio comercio.

---

## 9. Tests

| suite | qué corre | resultado |
|---|---|---|
| **DB / RLS** | `TABA_LOCAL_IDENTITY_DB=1 node scripts/run-identity-rbac-drills.mjs` | **64 ensayos hostiles, 0 escaladas** |
| **Kotlin** | `./gradlew :app:testStagingDebugUnitTest` | **124 tests, 0 fallos** (2 omitidos: exigen credenciales de staging) |
| **Flutter** | `flutter test` | **314 tests, 0 fallos** |
| **Web** | `npm test` | **1351 tests, 0 fallos** |
| **Instrumentados (Moto G15 real)** | `./gradlew :app:connectedStagingDebugAndroidTest` | **71 tests, 66 en verde** |

Los 5 restantes del teléfono, con nombre y motivo: cuatro son del arnés de humo
de QA, que exige `qaRunId` y una sesión ya persistida en el aparato —no corren
sin esos argumentos, por diseño—; y `FusedLocationSourceInstrumentedTest`
**falla igual en la base `ae90ab6`**, sin una sola línea de este trabajo.
Verificado corriendo esa clase sobre el commit base.

Lo que sí pasó en el teléfono y hacía falta que pasara: los cinco tests nuevos
de biometría, los dos del almacén cifrado que reescribí, los cuatro de
aislamiento de almacenamiento, y los de recuperación tras reinicio, cola
offline, servicio en primer plano, coordinador de reparto, notificaciones y
puente de la Activity. **GPS, cola offline, reparto y recuperación siguen
funcionando en hardware.**

El arnés de base de datos levanta un contenedor propio, crea una base **vacía**,
le aplica las **79 migraciones** y ataca con los mismos claims que pone PostgREST.
Aplicar la cadena desde cero es, además, la prueba de que PROD puede arrancar sin
copiar nada de staging.

Una segunda fase abre una conexión con un rol de login que no es privilegiado,
para reproducir la semántica real de PostgREST: con `set role` desde `postgres`
el `session_user` sigue siendo `postgres` y el ensayo se vería verde por el motivo
equivocado.

### Cobertura del encargo

login · restore · muerte del proceso · reinicio · refresh · token vencido · token
revocado · logout · logout sin señal · cuenta deshabilitada · escalada de rol ·
acceso entre usuarios · biometría éxito / fallo / cancelación / no disponible ·
clave equivocada · huellas cambiadas · material perdido · corrupción del
almacenamiento · offline→online.

### Cuatro defectos que los ensayos encontraron en este mismo trabajo

1. **`has_business_role` devolvía `NULL`** para quien no es del equipo. Todo el
   backend pregunta en la forma `if not has_business_role(...) then raise`, y con
   `NULL` esa condición no es verdadera: la excepción no se levanta y la llamada
   sigue de largo. Un staff cerraba el comercio de al lado. **Una función de
   autorización que puede devolver NULL falla ABIERTA.** Hay un ensayo dedicado a
   que no vuelva.
2. Los campos de un `record` anónimo no se llaman `f1`/`f2`: revocar y dar de baja
   fallaban en silencio.
3. `row_to_json` sobre un `jsonb` no existe: la auditoría no se podía leer.
4. PostgreSQL otorga `EXECUTE` a `PUBLIC` al crear una función; seis quedaban
   alcanzables por `anon`.

Y un quinto que **sólo podía aparecer contra un teléfono**: faltaba
`android.permission.USE_BIOMETRIC` en el manifiesto. Sin él,
`BiometricManager.canAuthenticate()` lanza `SecurityException` y el sondeo de
disponibilidad revienta en el arranque. No lo ve la JVM, no lo ve el compilador,
no lo ve el análisis estático. Lo vio el aparato.

---

## 10. Deuda, dicha para que nadie la descubra tarde

* **Nada de esto está aplicado a staging ni desplegado.** El cliente web y las
  migraciones van juntos: el Panel ahora exige `identity_current_context`, así que
  desplegar el cliente sin aplicar las migraciones lo deja sin acceso. Es un
  despliegue acoplado, en ese orden: migraciones primero.
* **Falta que una persona apoye el dedo.** Se corrió la suite instrumentada en el
  Moto G15 y el Keystore rechazó la clave sin autenticación, que es lo que
  sostiene la protección. Lo que no se puede automatizar es la lectura real: una
  persona tiene que abrir la app con la sesión protegida y desbloquearla. Es
  media hora de alguien con el teléfono en la mano.
* **La revocación depende de que `postgres` pueda borrar `auth.sessions`.** Está
  medido y funciona en la imagen de Supabase local. En el proyecto alojado se
  espera lo mismo, pero **no está verificado ahí**. Si fallara, la revocación no se
  vuelve permisiva: siguen valiendo la marca y la línea de corte; sólo se pierde
  el cierre inmediato del refresh.
* **`enable_signup`** queda como decisión pendiente de verificación (sección 4).
* **Una sesión revocada sigue viva hasta la llamada siguiente del cliente.** El
  Rider revalida en cada renovación —hasta una hora— y el Panel en cada carga. No
  hay notificación al dispositivo. Para el piloto alcanza; para una emergencia
  real, la baja de la cuenta es lo que corta de inmediato el siguiente acto.
* **Un logout sin señal no cierra la sesión en el servidor.** El secreto local se
  borra igual —nunca se deja a alguien adentro porque falló una llamada— pero el
  refresh token queda vivo hasta que alguien lo revoque desde el Panel.
* **`identity_touch_session` no se llama periódicamente todavía.** El `last_seen_at`
  de la lista de dispositivos se mueve al entrar y al renovar, no cada pocos
  minutos.
* **Defecto preexistente encontrado de paso, fuera de este alcance:**
  `set_business_open_state(negocio, 'paused')` viola la restricción
  `businesses_ordering_enabled_requires_verification`, que exige `status='open'`
  cuando `ordering_enabled` está en verdadero. Pausar un comercio verificado y con
  pedidos habilitados falla con `23514`. No se tocó porque no es identidad, pero
  conviene mirarlo.

---

## 11. Pasos para llevarlo a PROD limpio

PROD **todavía no existe**. Cuando exista:

1. Crear el proyecto Supabase vacío. **No restaurar ningún volcado de staging**:
   ni usuarios de Auth, ni riders de QA, ni staff técnico, ni sesiones, ni tokens,
   ni datos de prueba.
2. Aplicar las **79 migraciones** en orden. El arnés de ensayos prueba
   exactamente eso, contra una base vacía, cada vez que corre.
3. Crear el comercio real.
4. Dar de alta al dueño real con `scripts/identity-bootstrap-owner.mjs --confirm`.
   La persona elige su contraseña desde el enlace; nadie más la conoce.
5. Desde el Panel, invitar al resto del equipo y a los riders. Cada alta queda
   auditada y cada persona toma posesión de su cuenta.
6. Verificar en el entorno nuevo, antes de abrir: que `identity_kill_auth_session`
   devuelve verdadero (borrado real de `auth.sessions`) y que revocar una sesión
   corta el refresh.
7. Decidir el dominio. Recién ahí tiene sentido habilitar passkeys en el Panel.
8. Que una persona active la protección y desbloquee la app con su huella. Es lo
   único que no se puede automatizar.

**Ninguna cuenta de staging se migra. Ninguna se rota como parte de esto.**

---

## 12. Declaración

**TABA2_IDENTITY_BIOMETRIC_SESSION_LAYER_READY_FOR_STAGING**

Las cuatro condiciones del encargo, cada una con dónde está medida:

| condición | evidencia |
|---|---|
| staff y Rider separados por permisos | 64 ensayos hostiles contra el motor; el Rider tiene exactamente un permiso y ningún intento de escalada pasó |
| la sesión sobrevive al cierre y al reinicio | `RiderSessionLifecycleTest`: muerte del proceso, reinicio y renovación, sin volver a pedir la contraseña ni una vez |
| se puede revocar | revocación de dos capas, con el comportamiento del emisor de tokens medido contra GoTrue: el `session_id` sobrevive al refresh y borrar la sesión mata la cadena |
| la biometría desbloquea localmente sin almacenar datos biométricos | el Keystore del Moto G15 rechaza la clave con `KEY_USER_NOT_AUTHENTICATED`; en disco no hay token en claro ni una sola cadena biométrica; el servidor no tiene ningún campo de biometría |

1.924 tests: 64 ensayos hostiles de base de datos desde vacío, 124 Kotlin, 314
Flutter, 1.351 web y 71 instrumentados sobre el teléfono real.

### Lo que la firma NO cubre

Se dice para que nadie lo suponga:

* **Nadie apoyó un dedo.** Que `BiometricPrompt` devuelva un `Cipher` autorizado
  tras una lectura real es contrato del sistema operativo, y es el único paso que
  necesita una persona. Todo lo que lo rodea está probado en el aparato, incluida
  la negativa del Keystore sin autenticación, que es lo que hace que la
  protección no sea decorativa.
* **A staging no se aplicó nada**, porque el encargo prohíbe push y despliegue.
  «Ready for staging» dice que está listo para ir, no que ya fue. Cuando vaya,
  van juntos: migraciones primero, cliente después.
* **La revocación en el proyecto alojado no está verificada ahí.** Está medida en
  la imagen de Supabase local. Si el borrado de `auth.sessions` fallara en el
  proyecto real, la revocación no se vuelve permisiva —siguen valiendo la marca y
  la línea de corte— pero se pierde el cierre inmediato del refresh. Es una
  comprobación de un minuto, listada en el paso 6 de la sección 11.
* **`FusedLocationSourceInstrumentedTest` falla en el teléfono**, y falla igual
  en la base `ae90ab6`. No es de este trabajo; queda dicho porque quien corra la
  suite lo va a ver.

---

# ANEXO · Integración y certificación en STAGING (2026-08-12)

## Lo aplicado

**Base de datos** — proyecto alojado `ukxqbgswjlibmnjemrzd`. Ledger **73 → 81**.
Las seis migraciones de identidad más dos correcciones que aparecieron
aplicando, cada una registrada en `supabase_migrations.schema_migrations` para
que un `db push` futuro no las arrastre:

| versión | qué |
|---|---|
| `20260812010000` … `20260812060000` | la capa de identidad |
| `20260812070000` | la auditoría sobrevive al borrado de lo que audita |
| `20260812080000` | el guard de membresías ve al que llama de verdad |

Antes de tocar: ledger remoto verificado como **prefijo exacto** del árbol, sin
deriva ajena; snapshot de las tres funciones que se redefinen; y la comprobación
que decidía si era seguro aplicar — **0 miembros activos anónimos**, así que la
regla nueva «un anónimo nunca es equipo» no dejaba a nadie afuera. Después:
los 6 miembros activos resolvieron su rol real por la compuerta.

**Frontend** — Cloudflare Pages `taba2-staging`, deployment
**`9ce3f6f8-195d-4f03-bad8-361af566a6e4`** (Production / rama staging, source
`2646b53`). **2 archivos subidos, 348 ya conocidos por hash**: el radio exacto
esperado (`supabase-auth.js` y `identity-admin.js`). `runtime-config.js`
**preservado byte a byte** — 684 B, sha256 `57d8a007…`, idéntico antes y
después. Rollback: `6873fa07-79ae-4b83-8d4c-85aa69aba63c` (`693af40`).

## Lo medido contra el alojado

* **66/66 ataques hostiles**, con los mismos claims que pone PostgREST.
* **26/26 matriz de roles** con cuatro cuentas reales y tokens reales: owner 20
  permisos, admin 17, staff 6, rider 1. Ningún rol escribió membresías por
  PostgREST; ningún rol fabricó un owner salvo el owner.
* **19/19 identidad y revocación** por HTTP real contra GoTrue y PostgREST.
* **MP-back P1 recertificado**: 4 anchos, service worker vivo, sin fallas.
* **118/118 entradas del precache** servidas byte a byte contra el paquete.

## El gate físico en el Moto G15

APK `app-staging-debug` de `acc253a`, instalado en el aparato real.

| paso | resultado |
|---|---|
| 1 · login | **OK** — por el formulario real, contra staging alojado |
| 2 · activar biometría | **OK con huella humana real** |
| 3-4 · cerrar y matar el proceso | **OK** — 0 procesos vivos |
| 5 · abrir → biometría → sesión | **OK** — muestra el bloqueo, no el formulario; huella real; sesión restaurada |
| 6-7 · reiniciar el teléfono | **OK** — archivos intactos; tras reiniciar, huella real y sesión restaurada |
| 8 · refresh sin contraseña | **OK** — nunca se volvió a pedir contraseña en todo el gate |
| 9 · offline → online | **parcial** — la app conservó su sesión y el último estado del servidor sin red; el corte se hizo por wifi, no por avión |
| 10 · revocar sesión | **PARCIAL — ver el hallazgo** |
| 11 · deshabilitar cuenta | **OK** — fail-closed inmediato en todo |
| 12 · logout / descartar | **OK** — desaparecen `rider_session.enc` y `rider_session_key.enc`; sin material, la huella ya no abre nada |

**La prueba de que la biometría es real y no decorativa**, medida en el aparato:
el byte de nivel del envoltorio pasó de `0` (DEVICE) a `1` (BIOMETRIC) y
apareció `rider_session_key.enc`, la clave de sobre envuelta. Esa escritura
exige un `Cipher` autorizado por el sistema. Y en el mismo teléfono se midió que
la clave **se niega a operar sin autenticación**:

```
KeyStoreException: Key user not authenticated
  (internal Keystore code: -26 · Error::Km(r#KEY_USER_NOT_AUTHENTICATED))
```

No hay otro camino para descifrar esa sesión. Cuando la app volvió a mostrar el
rol `rider` con el archivo en nivel BIOMETRIC, la única explicación posible es
que hubo autenticación biométrica real.

## El hallazgo que bloquea la certificación

**Revocar una sesión NO detiene al Rider de inmediato en todas sus RPC.**

Medido con un token revocado todavía vigente:

```
get_rider_queue ................. 200  SIGUE ABIERTO   ← el hueco
identity_touch_session .......... not_authorized
identity_current_context ........ rol null
refresh del token ............... 400  RECHAZADO
```

La causa: **diez llamadas de las RPC del Rider consultan `business_members` en
línea** —`bm.user_id = auth.uid() and bm.role = 'rider'`— en vez de pasar por
`has_business_role`, que es donde vive la compuerta. Esas consultas leen
`is_active`, pero no saben nada de sesiones revocadas.

Radio exacto: **la cadena de renovación muere al instante** (el refresh es
rechazado, la fila de `auth.sessions` se borra) y toda la superficie de
identidad cierra al instante. Lo que sobrevive es el access token ya emitido,
sobre esas RPC concretas, **hasta que vence: como máximo una hora**
(`jwt_expiry = 3600`).

**La alternativa fail-closed inmediata existe y está medida: deshabilitar la
cuenta.** Con la cuenta dada de baja, la misma llamada devuelve `403 42501` al
instante, porque el predicado en línea sí lee `is_active`.

El arreglo correcto es que esas diez llamadas consulten la compuerta. Son 18
RPC de Rider en total; no se tocaron en esta corrida porque hacerlo a las
apuradas sobre funciones `SECURITY DEFINER` que mueven entregas es peor que
dejar el hueco documentado y acotado.

## Limpieza

Staging quedó como estaba: 1 comercio, 107 pedidos, 90 miembros (6 activos),
0 cuentas de ensayo, 0 membresías huérfanas, 0 sesiones de identidad de prueba.
Los 4 usuarios anónimos nuevos los creó el propio certificador de MP-back al
abrir la tienda. El perfil `com.lataba.rider.review`, que se deshabilitó para
que no robara el foco durante el gate, quedó **reactivado**.

## Declaración

**NO se declara `TABA2_IDENTITY_BIOMETRIC_SESSION_CERTIFIED_ON_STAGING`.**

RBAC, persistencia y biometría física pasaron contra staging alojado y contra el
Moto G15 real. La revocación pasa su requisito literal —el refresh queda
rechazado— pero no el operativo: el Rider sigue leyendo su cola hasta una hora
con un token revocado. Mientras eso siga así, la palanca inmediata es
deshabilitar la cuenta, no revocar la sesión, y eso hay que decirlo antes de
firmar, no después.
