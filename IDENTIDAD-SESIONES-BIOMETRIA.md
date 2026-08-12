# TABA2 · Identidad de staff y riders, sesiones persistentes y biometría

Estado: **listo para aplicar a staging. No aplicado, no desplegado, no pusheado.**

Lo que sigue describe lo construido, lo medido y lo que falta. Está escrito para
que quien lo lea pueda desconfiar de cada afirmación y verificarla.

---

## 1. Qué había antes (auditado, no supuesto)

**Repos y puntas canónicas verificadas el 2026-08-12:**

| | repo | punta canónica | base de este trabajo |
|---|---|---|---|
| Web/Panel | `bitflowapp/la-taba-pages-preview` | `feature/taba2-commercial-production-hardening` · `5a7d4e5` | rama `feature/taba2-identity-session-biometrics` |
| Rider | `D:\1212\la-taba-rider-android\.git` (sin remoto) | `feature/taba2-rider-shifts-dispatch` · `ae90ab6` | rama `feature/taba2-rider-identity-biometrics` |

Worktrees aislados en `D:\1212\worktrees\taba2-identity-session-biometrics` y
`D:\1212\worktrees\taba2-rider-identity-biometrics`. Ningún otro frente fue
tocado.

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

---

## 10. Deuda, dicha para que nadie la descubra tarde

* **Nada de esto está aplicado a staging ni desplegado.** El cliente web y las
  migraciones van juntos: el Panel ahora exige `identity_current_context`, así que
  desplegar el cliente sin aplicar las migraciones lo deja sin acceso. Es un
  despliegue acoplado, en ese orden: migraciones primero.
* **El gate humano sobre el Moto G15 no se corrió.** La biometría está probada en
  JVM y en widget tests, con toda la lógica de estado cubierta, pero **nadie apoyó
  un dedo en un teléfono**. Eso hay que hacerlo antes de declarar el piloto.
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
8. Correr el gate humano de biometría sobre un teléfono real.

**Ninguna cuenta de staging se migra. Ninguna se rota como parte de esto.**

---

## 12. Declaración

No se declara `TABA2_IDENTITY_BIOMETRIC_SESSION_LAYER_READY_FOR_STAGING`.

Lo construido cumple las cuatro condiciones de fondo —staff y Rider separados por
permisos, sesión que sobrevive al cierre y al reinicio, revocación que corta de
verdad, y biometría que desbloquea localmente sin almacenar ni transmitir nada
biométrico— y está medido con 1853 tests entre las cuatro suites. Pero
**«ready for staging» dice que está listo para staging, y a staging no se aplicó
nada**: ni una migración, ni un despliegue. Además, la biometría no la tocó
todavía ningún dedo humano.

Firmar eso ahora sería firmar una intención. Las dos cosas que faltan están
listadas arriba y son cortas.
