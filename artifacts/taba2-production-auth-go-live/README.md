# TABA2 · Auth productivo operable

Evidencia de la misión del **2026-08-17** sobre `wwcpogltfgzgkrlilbcd`
(`la-taba-production`).

**Veredicto: `PRODUCTION AUTH TECHNICALLY READY — SMTP/EXTERNAL GATE REQUIRED`.**

Los pedidos siguen **cerrados**, antes y después.

---

## Lo que cambió en producción

| | antes | ahora |
|---|---|---|
| host canónico | no existía | **`https://la-taba.pages.dev`** (Cloudflare Pages, proyecto `la-taba`) |
| `site_url` | `http://localhost:3000` | `https://la-taba.pages.dev` |
| correos de Auth | 6 plantillas por defecto, en inglés | 6 plantillas propias, en castellano, apuntando a `/cuenta/` |
| contraseñas filtradas | se aceptaban | **se rechazan** (HIBP) |
| «Olvidé mi contraseña» | **no existía** | existe, en el Panel y en `/cuenta/` |
| identidad anónima | se creaba **en cada visita** | se crea cuando la persona guarda algo |
| allow-list de redirects | vacía | vacía, y ahora se sabe por qué puede seguir así |

## Los archivos

| archivo | qué contesta |
|---|---|
| `AUTH-PRODUCTION-BEFORE.json` | la postura de Auth antes de tocar nada |
| `AUTH-PRODUCTION-AFTER.json` | la postura al cerrar, medida por dos caminos |
| `SMTP-PRODUCTION-STATUS.md` | **la compuerta**: qué falta, qué opciones hay, y el comando exacto para cerrarla |
| `AUTH-SMOKE-REPORT.md` / `.json` | alta → pendiente → aprobación → rol, contra la base viva. 34/34 |
| `CUSTOMER-MEMORY-SMOKE.md` / `.json` | perfil, direcciones, aislamiento del Cliente. 25/25 |
| `SECURITY-RECHECK.md` | RLS, definers, redirects, enumeración, escalada, y los P2 con su condición exacta |
| `PACKAGE-SCAN.md` / `.json` | qué hay adentro del paquete publicado |
| `SECRET-SCAN.md` | dónde vivió cada credencial durante la misión |
| `PRODUCTION-AUTH-RUNBOOK.md` | cómo se cambia, se rota, se publica y se contiene |
| `REGISTRATION-OPERATIONS.md` | cómo se da de alta a la gente, en castellano de comercio |
| `DAY1-AUTH-HEALTH.md` / `.json` | el comando de todos los días, y qué vigila |
| `FIRST-OWNER-BOOTSTRAP-STATUS.md` | el owner real, las dos vueltas, y los dos defectos que aparecieron al crearlo de verdad |
| `RIDER-RECOVERY-CONTRACT.md` | el Rider ya puede recuperar su contraseña; falta el cartel que lo diga, con el contrato exacto |

## La compuerta que queda: una

**SMTP.** Proveedor + credencial + dirección remitente. Sin eso, el alta pública
no puede completarse: GoTrue genera el token, falla el envío y la transacción se
revierte. Todo lo demás está hecho; aplicar es un comando.

**El comercio ya tiene dueño, y la cuenta la creó él.** `jariel1970@gmail.com`
(«Marco Luna»), `owner` activo, con una contraseña que eligió en su terminal y
que nadie más conoce. Se llegó ahí en dos vueltas: la primera fabricó la
identidad —y se revirtió—, la segunda la creó la persona. La herramienta ahora
**promueve** una identidad existente; crear quedó detrás de `--create-identity`.
Ver `FIRST-OWNER-BOOTSTRAP-STATUS.md`.

## Lo que se encontró midiendo, y no estaba en ningún informe

* El formulario de alta pedía **8 caracteres** y el servidor exige **12**. Toda
  cuenta creada con 8 fallaba con un mensaje genérico.
* Publicar el sitio hacía que **cada visita creara una identidad permanente**.
  Se vio en producción a los minutos: dos filas anónimas sin datos.
* La exención de loopback de GoTrue es **más chica** de lo documentado: sólo IP
  literales. `localhost` entraba por parecerse al `site_url` viejo.
* `security_update_password_require_reauthentication=true` **no pide la
  contraseña anterior**: exime a toda sesión de menos de 24 h.
* El bootstrap del primer owner emitía un enlace que **esta app no puede usar**,
  y no dejaba evento de auditoría. Las dos cosas, arregladas.
* Y al ejecutarlo de verdad se vio lo que ninguna prueba dice: **fabricar la
  identidad del dueño es la decisión equivocada** aunque funcione. Ahora la
  herramienta promueve, no crea.
* Las claves `sb_secret_*` **rechazan lo que parece un navegador**, y PowerShell
  se presenta como MSIE 9. Mismo endpoint y misma credencial: sin User-Agent
  propio **401**, con `taba2-production-owner-bootstrap/1.0` **200**.
* **La política de contraseñas no vive en el camino administrativo**: `POST
  /admin/users` acepta una contraseña filtrada y una de 8 caracteres que el
  camino público rechaza con `422`. Quien cree cuentas por ahí tiene que validar
  él mismo.
* Turnstile **no es una compuerta externa**: la cuenta de Cloudflare ya tiene el
  permiso para crear el widget. Lo que falta es integrarlo en los tres clientes.
