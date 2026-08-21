# Auditoría de seguridad READ-ONLY — go-live comercial TABA2

- **Fecha**: 2026-08-21
- **Worktree**: `D:\1212\la-taba2-gondola-retail-final` @ `95ac129f12fb85d0ede7f0c40757df4d2406a8a9`
- **Producción**: https://la-taba.pages.dev (SW `la-taba-runtime-v80-panel-publication`) · Supabase `wwcpogltfgzgkrlilbcd`
- **Mandato**: cero mutaciones. Toda consulta a la DB fue por `scripts/consulta-solo-lectura.mjs` (guarda: una sola sentencia SELECT/WITH) o por los SELECTs de `audit-production-security.mjs` (leído línea por línea antes de correr). Ningún secreto se imprime en esta evidencia; la clave publicable aparece porque es pública por diseño y está enmascarada igual.

## Veredicto global

**Sin P0. La postura de seguridad de la base y del cliente servido sostiene el go-live.** Hallazgos: 1×P1 (CSP ausente, decisión documentada pero pendiente), 4×P2. Detalle al final.

---

## 1 · Cliente servido en producción

Método: se bajaron los **130** activos del precache del service worker vivo (`raw/cliente/precache-list.txt`, descargas completas en `raw/cliente/descargas/`) y se escanearon con las mismas familias de `scripts/scan-secrets.mjs` (incluye decodificación de payload de todo JWT) más patrones extra: `sb_secret_`, ref de staging, cadena `service_role`. Salida: `raw/cliente/escaneo-bundle.txt`.

| Chequeo | Resultado |
| --- | --- |
| JWT con `role=service_role` | **0** (de hecho, 0 JWTs embebidos en todo el bundle) |
| `sb_secret_` | **0** |
| Ref de staging `ukxqbgswjlibmnjemrzd` | **0** |
| Tokens (MP `APP_USR-/TEST-`, `sbp_`, GitHub, Cloudflare, claves privadas, client/webhook secrets) | **0** |
| `runtime-config.js` vivo | expone SÓLO: `mode`, `supabaseUrl` (producción), `publishableKey` (`sb_publishable_…`, esperable y pública por diseño), `businessId` canónico, `pollMs`. Copia en `raw/cliente/descargas/runtime-config.js`. |

Extras del cliente:
- MapLibre 5.24.0 desde unpkg **con SRI** (`integrity` sha384 + `crossorigin=anonymous`) — cadena de suministro pineada (index.html:1179-1182 servido).
- Cabeceras reales (`raw/cliente/headers-produccion.txt`): `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy` restrictiva, `COOP: same-origin`, `Referrer-Policy`. **Sin `Content-Security-Policy`** (ausencia deliberada y documentada en `_headers`) y sin HSTS explícito (`pages.dev` está en la lista de precarga HSTS de Chromium, mitiga).
- Rutas sensibles del repo NO servidas: `.env`, `.env.production`, `runtime-config.example.js`, `supabase/config.toml`, `scripts/*`, `package.json` devuelven el **fallback del index** (md5 idéntico al index), no contenido propio. Verificado por comparación de hash porque Pages responde 200 con el index para lo inexistente.

## 2 · `npm run secrets:scan` (repo local)

Script leído antes de correr: camina el árbol local, sólo lectura. **PASS**: «Secret scan passed: no assigned payment credentials or private keys found.» (`raw/secrets-scan.txt`).

## 3 · Scripts de producción

- **`production:security` (audit-production-security.mjs) — CORRIDO** (confirmado read-only: todos SELECT vía Management API; token prestado desde Credential Manager sin imprimirse). Resumen en `raw/production-security-portrait-resumen.txt`, retrato completo en `raw/SECURITY-PORTRAIT-production.json`. Números: 86 tablas, 282 funciones, 66 policies, 225 SECURITY DEFINER (todas con `search_path` fijado), 0 escrituras para `anon`, 0 grants a PUBLIC, 0 CREATE en `public`, 1 bucket privado.
- **`production:smoke` (production-security-smoke.mjs) — NO CORRIDO: NO es read-only.** Crea una identidad sintética en `auth.users` de producción vía `/auth/v1/signup`, intenta INSERTs reales en `business_members` y `orders` (esperando rechazo) y limpia con `DELETE from auth.users`. Bajo mandato de cero mutaciones no se ejecuta. Nota adicional: su aserción E-bis (`productos === 0`) quedó vieja — hoy hay catálogo publicado (60 productos), así que fallaría por diseño desactualizado, no por una fuga.
  - **Reemplazo read-only ejecutado**: sonda REST con la clave publishable, **sólo GET** (GET en PostgREST = SELECT; sin signup, sin RPC). Resultado en `raw/sonda-rest-anon-solo-get.txt`: **25/25 tablas cerradas bloqueadas** para anon (401 `permission denied` o 200 con 0 filas vía policy `can_access_order`); vitrina expone sólo `products` filtrado (activo+verificado+disponible+stock>0). Lo que la sonda GET no cubre del smoke original (identidad `authenticated` sin membresía, auto-membresía, insert de pedido) queda cubierto en frío por §5: `identity_member_role` niega rol a identidades anónimas y sin membresía activa, y `anon`/`authenticated` no tienen grant de INSERT en esas tablas (retrato: `anon con escritura: 0`).
- **`production:isolation` (probe-tenant-isolation.mjs) — leído, NO corrible hoy y NO necesario contra producción**: NO toca producción — corre `docker exec` contra el contenedor local `taba2-prod-shadow` como `authenticator`, cada caso en transacción con `rollback`, y escribe sólo un JSON local. No crea filas ni cuentas en producción. Hoy además es inejecutable: el daemon de Docker no corre (C: lleno, ver memoria del proyecto).

## 4 · RLS

Consulta directa (`raw/rls-tablas-sin-rls.json`):

```sql
select ... from pg_class c join pg_namespace n ... where n.nspname='public'
  and c.relkind in ('r','p') and c.relrowsecurity=false
```

**Resultado: `[]` — cero tablas de `public` sin RLS** (86/86 con RLS habilitado). Hay 30 tablas con RLS **sin policy**: eso es default-deny (nadie llega por PostgREST salvo service_role), es decir cerradas, no expuestas — verificado por la sonda REST (todas 401/0 filas). Ninguna tabla expone datos de cliente a anon: las 7 policies que alcanzan a `anon` (`raw/policies-anon.json`) son todas **SELECT** con condición (vitrina `is_active`, catálogo verificado con stock, combos aprobados, y `orders`/`order_items` sólo vía `can_access_order`, que para un anon sin JWT de usuario es siempre falso).

## 5 · SECURITY DEFINER alcanzables por anon

32 funciones con EXECUTE para `anon` (`raw/funciones-anon-tipos.json`), de las cuales **8 SECURITY DEFINER** (definiciones completas en `raw/funciones-definer-anon-definiciones.json`):

| Función | Volatilidad | ¿Muta? |
| --- | --- | --- |
| `can_access_order` | stable | no — chequeo de acceso, usa `has_business_role` |
| `commerce_availability`, `list_business_combos`, `resolve_business_combo`, `get_public_business_contact` | stable | no (stable = Postgres prohíbe escrituras en runtime) |
| `get_public_order_tracking` | stable | no — y el acceso exige token no adivinable (`order_public_tokens` con hash, expiración, revocación, ventana terminal); degrada coordenadas y accuracy |
| `scheduler_heartbeat` | stable | no — sólo metadata del barrido (sin datos de cliente) |
| `check_scheduler_watchdog` | **volatile** | **sí, acotado**: abre/resuelve `operational_alerts` + eventos. El veredicto sale del estado de la DB (no del caller); input del caller = `source` truncado a 40 chars; advisory lock + tope de 1 escritura/min por alerta. Es la sonda externa deliberada del watchdog. |

Las otras 24: 11 son `trigger` functions (PostgREST no puede invocarlas) y 13 helpers immutable/stable puros (sha256, rankings, normalizadores). **Ninguna función anon-alcanzable muta datos de negocio.**

Regla `has_business_role`: verificada en la muestra completa de riesgo. Las 6 definer volátiles ejecutables por `authenticated` que no nombran la guarda en su propio fuente (`raw/definer-auth-sin-guardas-conocidas.json`, definiciones en `raw/definer-auth-revision-definiciones.json` y `raw/guardas-definiciones.json`) delegan todas en guardas que terminan en `has_business_role`/`identity_member_role`:
`get_rider_queue`→`rider_require_active_membership`; `identity_list_audit_events`→`identity_require_permission('audit.read')`; `identity_touch_session`→`identity_member_role` (y sólo toca su propia sesión); `set_delivery_pricing`/`set_service_enforcement`→`can_manage_commercial_settings` (owner/admin o staff habilitado); `request_credit_note[_unchecked]`→`has_business_role(owner/admin)` dentro del cuerpo («unchecked» refiere a las líneas, no a la autorización; además `_unchecked` no tiene EXECUTE para anon ni authenticated). `identity_member_role` exige: no-anónimo, membresía activa, persona no deshabilitada, sesión registrada y no revocada, token posterior al corte.

## 6 · Audit logs

Existen y registran acciones del Panel (`raw/audit-eventos-agrupados.json`, columnas en la misma captura de sesión):

- `identity_audit_events` (81 filas): `access_requested/approved/rejected`, `session_opened` por rol (owner/staff/rider), `session_revoked`, `member_activated` — con actor, rol, sujeto, sesión y metadata. Escritura centralizada en `identity_record_audit_event` (sin EXECUTE para anon/authenticated: sólo vía definers); lectura sólo con permiso `audit.read`.
- `business_config_audit` (before/after por cambio de configuración: `delivery_pricing`, `enforcement`).
- `business_command_receipts` (comandos del Panel con idempotencia: `transition_order`).
- `order_events` (ciclo de vida del pedido) y `operational_alert_events` (alertas operativas).
- Todas están en el grupo RLS-sin-policy: ilegibles e inescribibles por REST directo.

## 7 · Storage

Un solo bucket: `fiscal-documents`, **public=false**, límite 16 MiB, MIME sólo `application/pdf`, **0 objetos**, y una única policy en `storage.objects`: `fiscal documents service-only` (ALL, rol `service_role`). Nada público, nada sensible expuesto.

---

## Clasificación

**P0 (impide vender hoy): ninguno.**

**P1**
1. **Sin Content-Security-Policy en producción.** Única defensa navegador relevante ausente en una PWA que cobra. La ausencia está razonada en `_headers` («medirla contra el sitio corriendo»), pero sigue pendiente; con SRI ya puesto en el único script externo, una CSP medida es el próximo endurecimiento con mejor relación costo/valor. No bloquea el go-live: no hay vector XSS conocido y el resto de cabeceras está.

**P2**
1. `check_scheduler_watchdog` permite a un anónimo provocar escrituras (acotadas, 1/min, estado-consistentes) en `operational_alerts`, con `source` de 40 chars controlado por el caller que queda en la evidencia de la alerta. Diseño intencional (el reloj externo debe poder sonar sin credenciales); si se quisiera, un token estático de sonda lo cerraría sin perder la función.
2. `production-security-smoke.mjs` se llama «smoke» pero **muta producción** (signup + DELETE en `auth.users`): riesgo de proceso si alguien lo corre bajo un mandato read-only; y su aserción de «catálogo vacío» quedó obsoleta con la góndola publicada (60 productos) — hoy reportaría un falso hallazgo.
3. `Access-Control-Allow-Origin: *` en el host estático de Pages: inocuo para activos públicos, pero conviene saber que está.
4. HSTS no se emite como cabecera propia; mitigado porque `pages.dev` está precargado en Chromium. Si algún día se sirve por dominio propio, hay que emitirla.

## Qué NO se hizo (y por qué)

- No se corrió `production:smoke` (muta `auth.users` de producción) ni `production:isolation` (no toca producción, pero exige el shadow en Docker y el daemon está caído). Sin mutaciones de DB, deploy, git ni npm install en toda la sesión.
- La única escritura de esta auditoría fue de archivos locales de evidencia (este directorio) y el retrato que `audit-production-security.mjs` genera por diseño en `artifacts/production-supabase/`.

## Reproducción

```
node scripts/consulta-solo-lectura.mjs --ref=produccion --sql="select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity=false"
npm run secrets:scan
node <wrapper conToken> scripts/audit-production-security.mjs --target production
# sonda GET-only: ver raw/sonda-rest-anon-solo-get.txt (script en el scratchpad de la sesión; sólo GETs con la clave publishable)
```
