# Conexión productiva de TABA2 — inventario, medida y lo que queda afuera

Los tres clientes —Customer, Panel del negocio y Rider— quedan configurados
contra el proyecto productivo `wwcpogltfgzgkrlilbcd` y el negocio canónico
`00000000-0000-4000-8000-000000000001`, y esa configuración se **deriva y se
verifica** en vez de escribirse a mano. La certificación se corrió contra la
base viva, con `auth.users` en cero antes y después.

Los pedidos siguen cerrados. Eso es lo que se quería.

## Lo que se midió, y con qué

| pregunta | herramienta | resultado |
|---|---|---|
| ¿la base está viva y es la que creemos? | `production:health` | ledger 103 · `20260816122000` · PostgreSQL 17.6 |
| ¿el scheduler late? | `production:health` | sí, 4 cron activos, ninguno fallando |
| ¿hay datos humanos? | `production:health` | ninguno: 14 tablas en cero |
| ¿la persiana está cerrada? | `production:health` | `ordering_enabled=false` · `ordering_verified=false` |
| ¿qué tiene configurado Auth? | `production:auth` | ver abajo |
| ¿qué **hace** Auth? | `production:auth` (GoTrue público) | ver abajo |
| ¿una identidad sin membresía ve algo? | `production:smoke` | 16 tablas cerradas, 0 filas |
| ¿el Panel y el Rider pueden entrar? | `production:smoke:identity` | sí, y no obtienen ningún rol |
| ¿el paquete web apunta a producción y sólo a producción? | `production:artifacts` | 710 archivos, 1 host, 1 negocio |

Todos los reportes en crudo están en este directorio.

## Auth hosted: lo cerrado, lo medido y lo que falta

`production-auth-posture.mjs` pregunta por **dos caminos a la vez**: la
Management API dice qué tiene *configurado* el proyecto, y GoTrue público dice
qué *hace*. Si discreparan, sería un hallazgo.

La allow-list se prueba por el camino real —`/auth/v1/verify` con un token que no
existe—, así que el `Location` de la respuesta dice cuál es la allow-list
efectiva sin tener que creerle a la configuración. La verificación falla, que es
lo que se busca: no consume ni crea nada, pero la resolución del `redirect_to` ya
ocurrió.

### El manifiesto decía algo que no era exacto

`RELEASE.json` afirmaba: «con la allow-list vacía GoTrue rechaza cualquier
`redirect_to` que no sea el `site_url`». Medido:

```
http://localhost:3000                 PERMITE   (es el site_url)
http://localhost:9999/robado          PERMITE   <- no lo declara nadie
http://127.0.0.1:9999/                PERMITE
http://[::1]:9999/                    PERMITE
https://localhost:9999/               rechaza
http://sub.localhost:9999/            rechaza
http://localhost.evil.example/        rechaza
https://taba2-staging.pages.dev/      rechaza
https://redirect-que-nadie-autorizo/  rechaza
```

GoTrue **exime siempre el loopback**: http, host de loopback exacto, cualquier
puerto, cualquier ruta. No se apaga desde la allow-list. La allow-list sí falla
cerrada para todo lo remoto, que es lo que el manifiesto quería decir, pero no es
lo que decía.

Riesgo real: para aprovecharlo hace falta una cuenta del Panel o del Rider, que
esa persona abra un enlace preparado, y un proceso escuchando en su propia
máquina que además sirva HTML —el token viaja en el fragmento, así que un
listener a secas no lo ve—. Es **P2**, no P0. Pero vale hoy con `localhost` y va
a seguir valiendo con dominio propio, así que entra en el modelo de amenaza y no
en el gate.

### Postura medida

| | |
|---|---|
| `site_url` | `http://localhost:3000` — gate de dominio |
| allow-list | vacía: mínimo privilegio posible sin host |
| signup | **ABIERTO**, y tiene que estarlo |
| confirmación de correo | exigida (`mailer_autoconfirm=false`) |
| captcha | no — gate externo |
| anónimos | 30/hora/IP |
| ingreso + alta | 30/5min/IP |
| verificaciones OTP | 30/5min/IP |
| refresh | 150/5min/IP |
| correos | 2/hora (SMTP integrado) |
| contraseña | mínimo 12 · reautenticación exigida · **acepta contraseñas filtradas** |
| sesiones | rotación de refresh sí · sin caducidad por tiempo ni por inactividad |

### Por qué el signup queda abierto (A8)

El Customer entra con `signInAnonymously`, y en GoTrue el ingreso anónimo pasa
por el **mismo** `/signup`. Cerrarlo apaga el cliente. No es una postura floja:
es la única compatible con el producto.

Lo que la hace inerte es que **crear una identidad no reparte ningún rol**, y eso
está medido, no supuesto:

- una identidad anónima recién creada lee 0 filas en las 16 tablas cerradas
- `identity_current_context` le devuelve rol vacío
- intentar insertarse en `business_members` da **HTTP 403**
- insertar en `orders` da **HTTP 400**
- el catálogo público devuelve 0 productos

RLS sigue siendo la autoridad. La clave publicable no autoriza nada.

### Captcha (A9)

`security_captcha_enabled=false` y `security_captcha_secret=null`. Encenderlo
exige una cuenta de hCaptcha o Turnstile que no existe. **No se inventa.**

¿Alcanza sin captcha con la postura de hoy? Sí, mientras la persiana esté
cerrada: los límites de tasa están todos por encima de cero, la confirmación de
correo es obligatoria, el envío está capado en 2/hora, y ninguna identidad nueva
obtiene alcance. Cuando se abran los pedidos, el captcha pasa a **P1**: ahí un
alta masiva deja de ser ruido y pasa a ser costo.

### Lo único que se puede cerrar sin dominio ni proveedor

`password_hibp_enabled` está en `false`: producción **acepta contraseñas que
aparecen en brechas públicas conocidas**, para las cuentas del Panel y del Rider,
que son las únicas que usan contraseña. Es un toggle nativo de Supabase, no
necesita proveedor, y con `auth.users` en cero no puede dejar afuera a nadie.

`scripts/harden-production-auth.mjs` lo aplica. **No se aplicó en esta corrida**:
escribe sobre producción y pide autorización explícita.

```powershell
$env:SUPABASE_ACCESS_TOKEN = <token del CLI>
$env:TABA2_PRODUCTION_AUTH_HARDENING = "I_AUTHORIZE_TABA2_PRODUCTION_AUTH_HARDENING"
node scripts/harden-production-auth.mjs --ref wwcpogltfgzgkrlilbcd --apply
```

Sin `--apply` sólo imprime lo que cambiaría. Compara los veinte campos que
vigila antes y después, y reporta cualquier deriva que no se haya pedido.

## La URL canónica: gate externo (A6/A7)

Medido con `wrangler pages project list`:

```
Project Name    Project Domains            Git Provider
taba2-staging   taba2-staging.pages.dev    No
```

**Un solo proyecto de Cloudflare Pages, y es el de staging.** No hay dominio
propio, no hay proyecto de producción, y el GitHub Pages del repositorio sirve un
artefacto de previsualización que no es producción.

O sea que no existe ninguna `*.pages.dev` estable que pueda funcionar como
canonical de producción. Crear una sería **elegir el dominio productivo**, que es
exactamente lo que no se inventa.

→ **CANONICAL URL EXTERNAL GATE.** Con eso cerrado, `site_url` y la allow-list se
resuelven en una sola pasada de dos minutos.

## El config productivo se deriva

El repositorio versiona una plantilla vacía que falla cerrada, y eso no se toca:
si el config productivo viviera versionado, cualquier artefacto de
previsualización hablaría con la base real sin que nadie lo decidiera.

Lo que faltaba era el otro lado. `STAGING-V61-CERTIFICACION.md` deja anotado cómo
se cobra ese hueco: `create-release-folder.mjs` copió la plantilla sobre el
paquete y el preflight tuvo que frenar la publicación.

`scripts/build-production-runtime-config.mjs` lo emite derivándolo: la URL se
calcula del ref —no se pide, así que no existe el estado «ref productivo con URL
de otra cosa»—, el ref tiene que ser el de producción, el negocio el canónico, y
la clave de la clase publicable. Lo generado se relee con el mismo resolutor que
corre el navegador y con los centinelas del gate; si no resuelve como
`production` contra el host productivo, no se escribe nada.

15 pruebas, una por cada rechazo. Las clases prohibidas se construyen con la
**forma** de cada clase y sin valor real, porque lo que se prueba es que las
distingue por clase, no que reconozca una credencial concreta.

## El paquete, mirado por dentro (A12)

```
artifact-scan: dist_release dist-desktop
  archivos     : 710
  bytes        : 18.204.581
  hosts        : wwcpogltfgzgkrlilbcd.supabase.co
  business ids : 00000000-0000-4000-8000-000000000001
  artifact-scan OK
```

Un solo host. Un solo negocio. Cero hallazgos.

Las seis entradas `info` son literales **inertes**: el uuid de plantilla dentro
de un comentario de `runtime-config.js`, y el endpoint de ejemplo del SDK de
Supabase, cuyo valor por omisión reemplaza el cliente.

Que esa distinción es real y no una excusa se comprobó con un **control
negativo**: el mismo paquete con el `runtime-config` de staging encima.

```
  P1 staging-backend-reference: 1 coincidencia(s) en runtime-config.js
  P1 endpoint-identity: falta el host esperado wwcpogltfgzgkrlilbcd.supabase.co
  P1 endpoint-identity: host inesperado ukxqbgswjlibmnjemrzd.supabase.co
  artifact-scan FALLA
```

Los mismos seis `info` siguen siendo `info`. Lo que cambió de color es la
configuración alcanzable.

## Certificación de sesión contra producción (A10)

`production-auth-identity-smoke.mjs` mide el camino que el Panel y el Rider usan
de verdad —correo y contraseña— y que hasta ahora no tenía una sola medida contra
el proyecto productivo:

```
  auth.users antes  : 0
  panel login       : HTTP 200 · role=authenticated · anonimo=false
  rider login       : HTTP 200 · role=authenticated · anonimo=false
  panel aislada     : 16 tablas cerradas · rol=ninguno · auto-membresia HTTP 403
  rider aislada     : 16 tablas cerradas · rol=ninguno · auto-membresia HTTP 403
  aislamiento       : 2 identidades vivas a la vez y ninguna ve a la otra
  restaurar sesion  : HTTP 200 · refresh ROTADO · sesion nueva usable
  logout            : HTTP 204 · refresh posterior HTTP 400 · la otra sesion sigue
  insert en orders  : HTTP 400
  limpieza          : auth.users = 0
```

Las dos identidades existen **al mismo tiempo** a propósito: con una sola, «no ve
nada» y «no hay nada» son indistinguibles.

Se crean por SQL y no por `/signup` porque con `mailer_autoconfirm=false` un alta
por `/signup` dispara un correo, y el presupuesto es de 2 por hora: una sonda que
lo quema contra un dominio inventado deja al proyecto sin poder mandar el que sí
importa. El dominio de las direcciones es `.invalid`, reservado por RFC 6761 para
que no resuelva nunca.

## Lo que sigue cerrado, a propósito

| | |
|---|---|
| `ordering_enabled` | **false** |
| `ordering_verified` | **false** |
| pedidos reales | **0** |
| transacciones de Mercado Pago en producción | **0** |
| filas humanas en producción | **0** |
| `service_role` en algún cliente | **0** |
| merge a `main` | **0** |
| subida a Play Store | **0** |

## Gates que no dependen de código

1. **URL canónica** — no existe host productivo. Bloquea `site_url` y la
   allow-list.
2. **Captcha** — necesita cuenta de hCaptcha o Turnstile. P2 hoy, P1 al abrir
   pedidos.
3. **SMTP propio** — recuperar la contraseña de una cuenta del Panel depende del
   servicio integrado, limitado a 2 correos por hora y sin garantía de entrega.
4. **Firma de Android** — no hay keystore productivo; el gate del Rider rechaza
   la firma de depuración, que es el comportamiento correcto.
5. **Credenciales productivas de Mercado Pago** — 0 funciones desplegadas, 0
   secretos cargados.
6. **PITR** — apagado. Addon `pitr_7` = USD 100/mes. Decisión de gasto antes del
   primer pedido real.

## Una decisión de producto que nadie tomó todavía

Las sesiones no caducan **ni por tiempo ni por inactividad**
(`sessions_timebox=0`, `sessions_inactivity_timeout=0`). Para el Panel en un
aparato compartido del mostrador eso es una decisión, no un default que convenga
heredar: quien deja el turno deja la sesión abierta.

No se cambió porque el mismo ajuste le pega al Customer anónimo —que vuelve horas
después a mirar su pedido— y nadie decidió cuánto dura un turno en el local.
