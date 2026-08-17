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
| `FIRST-OWNER-BOOTSTRAP-STATUS.md` | **la otra compuerta**: la herramienta está lista, falta decir quién es el dueño |
| `AUTH-SMOKE-REPORT.md` / `.json` | alta → pendiente → aprobación → rol, contra la base viva. 34/34 |
| `CUSTOMER-MEMORY-SMOKE.md` / `.json` | perfil, direcciones, aislamiento del Cliente. 25/25 |
| `SECURITY-RECHECK.md` | RLS, definers, redirects, enumeración, escalada, y los P2 con su condición exacta |
| `PACKAGE-SCAN.md` / `.json` | qué hay adentro del paquete publicado |
| `SECRET-SCAN.md` | dónde vivió cada credencial durante la misión |
| `PRODUCTION-AUTH-RUNBOOK.md` | cómo se cambia, se rota, se publica y se contiene |
| `REGISTRATION-OPERATIONS.md` | cómo se da de alta a la gente, en castellano de comercio |
| `DAY1-AUTH-HEALTH.md` / `.json` | el comando de todos los días, y qué vigila |

## Las dos compuertas humanas

1. **SMTP.** Proveedor + credencial + dirección remitente. Sin eso, el alta
   pública no puede completarse: GoTrue genera el token, falla el envío y la
   transacción se revierte. Todo lo demás está hecho; aplicar es un comando.
2. **Primer owner.** Nombre y correo de una persona real, explícitamente
   autorizada. No se infiere de ningún lado.

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
* Turnstile **no es una compuerta externa**: la cuenta de Cloudflare ya tiene el
  permiso para crear el widget. Lo que falta es integrarlo en los tres clientes.
