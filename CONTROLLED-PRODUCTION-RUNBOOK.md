# La Taba · Producción controlada (CONTROLLED_PRODUCTION)

Operación de La Taba con **1 comercio, hasta 3 riders y ~30 clientes conocidos**,
cobro **manual** (efectivo o transferencia al entregar/retirar). Este documento
permite operar sin tocar código: todo lo que no se hace desde el Panel o la app
Rider es un comando de esta página, ejecutado por el operador técnico en su PC.

> Nombres técnicos: el entorno se llama `pilot` en el código, el proyecto web
> `la-taba-commercial-pilot` y el paquete Android `com.lataba.rider.pilot`.
> Son el mismo entorno que acá se llama CONTROLLED_PRODUCTION.

## 0. Ficha de lanzamiento

| Dato | Valor |
|---|---|
| Estado | Ver §12 (compuertas). **No invitar clientes** mientras diga `COMMERCIAL_OPEN_READY: NO` |
| CUSTOMER_URL | `https://la-taba-commercial-pilot.pages.dev/` (se habilita al primer deploy) |
| BUSINESS_PANEL_URL | `https://la-taba-commercial-pilot.pages.dev/#business` |
| Backend Supabase | proyecto nuevo en `sa-east-1`, ref en `deploy/controlled-production.json` |
| Nunca | Staging `ucbtjcurawxjwjdvvcvj`, Producción vieja `wwcpogltfgzgkrlilbcd`, DEMO `yakhtrkukqlgzvxuvhzs` (los gates los rechazan) |
| Rider APK | `com.lataba.rider.pilot` `0.1.3-canonical-pilot` (versionCode 4); SHA-256 y certificado en el receipt de `deploy/` |
| Certificado de firma Rider | SHA-256 `2dcc9b0a0cf022ebf59c500331103ee31cec9e9142d5431553131877948ec1aa` |
| APK anterior (rollback) | v3 `0.1.2-canonical-pilot` conservada fuera del repo |
| Web | versión en `https://la-taba-commercial-pilot.pages.dev/version.json` (commit, runtime) |
| Service worker | `CACHE_NAME` en `sw.js` (hoy `la-taba-runtime-v117-controlled-production`) |
| Cobro | Manual: `cash` (efectivo al retirar o recibir) o `coordinate` (a coordinar). Mercado Pago **no** habilitado (WCS-51579) |

## 1. Roles

| Rol | Qué hace | Cómo se da |
|---|---|---|
| Operador técnico | Crea el backend, cuentas, despliega, rollback | Acceso a GitHub `bitflowapp`, Supabase y esta PC |
| Dueño (owner) | Aprueba equipo y riders, abre/cierra, catálogo, devoluciones | §2.1 (única alta por clave de servicio) |
| Encargado (admin) / Personal (staff) | Operan pedidos y registran cobros | Solicitud en el Panel + aprobación del dueño |
| Rider | Acepta ofertas, retira, entrega con código | Solicitud desde la app + aprobación del dueño |
| Cliente | Compra en la web | No necesita alta: la sesión se crea al guardar sus datos |

Nadie recibe una contraseña del operador. Cada persona define la suya con un
enlace individual de un solo uso. No hay autorregistro de comercios ni roles
por registrarse: el primer usuario **no** se vuelve dueño.

## 2. Altas, bajas y recuperación

Todos los comandos: `node scripts/controlled-production/accounts.mjs <comando> --target controlled-production ...`.
Leen las claves del Credential Manager (`CONTROLLED PROD SUPABASE ...`) y
verifican que pertenezcan al proyecto antes de actuar. El enlace de acceso se
copia al portapapeles; **no se imprime**. Pegalo en un mensaje privado a esa
persona y a nadie más. Vence en 1 hora.

### 2.1 CREATE_OWNER (una sola vez)
1. `create-account --email <correo> --name "<Nombre>"`
2. `bootstrap-owner --business-id <negocio> --email <correo> --name "<Nombre>"`
3. `access-link --email <correo> --origin https://la-taba-commercial-pilot.pages.dev/`
4. La persona abre el enlace, elige contraseña y entra al Panel.

### 2.2 CREATE_STAFF (encargado o personal)
1. `create-account --email <correo> --name "<Nombre>"` y `access-link ...` como arriba.
2. La persona abre `BUSINESS_PANEL_URL`, ingresa y en **Pedir acceso** elige
   *Atender el local (Panel)*.
3. El dueño: Panel → **Solicitudes** → elige **Personal** o **Encargado** → **Aprobar**.

### 2.3 CREATE_RIDER (máximo 3)
1. `create-account` + `access-link` como arriba.
2. El rider abre `BUSINESS_PANEL_URL` en su teléfono, ingresa y en **Pedir
   acceso** elige *Repartir pedidos (app Rider)* con su teléfono (obligatorio).
3. El dueño: Panel → **Solicitudes** → **Aprobar** (el rol queda Repartidor;
   una solicitud de repartidor no puede convertirse en personal ni al revés).
4. Instalar sólo la APK de la ficha (§0) e ingresar con el mismo correo.
   Verificar: título “La Taba · Rider Piloto”, `PILOT · App nativa`,
   “Sincronizado con La Taba”, **Disponible** visible también en el Panel.

### 2.4 CREATE_CUSTOMER
No hace falta alta. Enviar la URL del cliente **en privado** a cada persona
invitada de la ola (§11). Pedirle que confirme dirección en el mapa y guarde
nombre y teléfono antes de su primer pedido. Limitación conocida: quien tenga
la URL puede comprar; si aparece un pedido de alguien no invitado, el negocio
lo rechaza desde el Panel y se evalúa pausar (§8).

### 2.5 RESET_ACCESS / RECOVER_ACCOUNT
`reset-access --email <correo> --origin https://la-taba-commercial-pilot.pages.dev/`
cierra sus sesiones y copia un enlace nuevo. Si la cuenta estaba deshabilitada,
primero `enable` (2.7).

### 2.6 DISABLE_USER / DEACTIVATE_USER
`disable --business-id <negocio> --email <correo> --reviewer-credential "CP OWNER" --reason "<motivo>"`
desactiva la membresía (con auditoría), revoca sesiones y bloquea el login.
No borra nada: sus pedidos y cobros quedan con su historia. El último dueño no
se puede desactivar. Borrado definitivo: no se hace durante el piloto.

### 2.7 Rehabilitar
`enable --business-id <negocio> --email <correo> --reviewer-credential "CP OWNER" --reason "<motivo>"`.

### 2.8 Ver quién tiene acceso
`list --business-id <negocio>` (correos enmascarados).

## 3. Turno del negocio

- **Abrir:** Panel → **Abrir** → **Volver a revisar** → resolver bloqueos
  (cobertura, stock, riders, caja) → **Abrir el negocio**.
- **Pausar pedidos (no cierra caja):** Panel → **Abrir** → **Pausar pedidos**.
- **Cerrar el día:** Panel → **Cerrar el día** (cierre diario, separado de pausar).

## 4. Catálogo y stock

- Sólo se publica lo que el comercio aprobó por escrito (SKU, precio vigente,
  stock inicial, descripción, foto). Import inicial: `docs/PILOT-INFRA-PLAN.md`
  §“Comandos del operador técnico” (dry-run → preflight → apply). El importador
  rechaza precios/stock históricos, SKU fuera de la lista y alcohol.
- Altas posteriores: Panel → **Nuevo producto** (borrador) → dueño revisa y publica.
- Stock: Panel → **Recepción**, **Ajuste** o **Conteo físico**, siempre con motivo.
  Nunca editar stock por SQL.
- Despublicar: desde la ficha del producto en el Panel (quitarlo de la tienda).
  No borrar productos con pedidos.

## 5. Pedido de punta a punta

1. Panel → **Pedidos**: llega en *Recibido* → **Aceptar** → **Preparar** → **Listo**.
2. En la tarjeta: elegir rider **Disponible** → **Ofrecer**. El rider acepta en Android.
3. Rider: **Retiré** → **En camino** (GPS activo) → **Llegué** → pide el código
   de 4 dígitos al cliente → **Confirmar entrega**. Sólo Android confirma la entrega.
4. Cliente: ve estado y mapa en la web; da el código al recibir.

## 6. Cobro manual

- En checkout el cliente elige *Efectivo al retirar o recibir* o *A coordinar*.
  La pantalla dice que no paga ahí.
- Panel → **Pagos**: *Cobro pendiente* **no** es pagado. Recién con el dinero
  en mano: **Registrar efectivo recibido** / **Registrar transferencia recibida**.
  Queda registrado quién, cuándo, pedido y estado anterior/nuevo; repetir el
  botón no duplica el cobro.
- Devolución: sólo dueño/encargado, **Registrar devolución realizada** y sólo
  después de devolver el dinero. Un pedido con cobro registrado no se cancela
  sin registrar antes la devolución.
- No usar Mercado Pago: en este entorno el Panel muestra “Cobros online · No
  habilitados en esta etapa”.

## 7. Incidentes

| Situación | Qué hacer |
|---|---|
| **Pedido trabado** | `node scripts/controlled-production/ops-pulse.mjs --target controlled-production --business-id <negocio>` lista los trabados por estado y minutos. Panel → **Actualizar** antes de repetir una acción. Si sigue en el local: cancelar desde la tarjeta con motivo (el stock vuelve una sola vez). Si ya salió: coordinar con rider y cliente; nunca poner `delivered` por SQL |
| **Cancelación** | Desde la tarjeta, con motivo. Si hay cobro registrado: primero **Registrar devolución realizada** |
| **Rider offline** | Rider sin red no transmite. Que vuelva a abrir la app y marque Disponible. La disponibilidad vence a los 90 s sin señal; reofrecer a otro rider si no vuelve |
| **GPS fallando** | Revisar ubicación precisa, notificación “GPS activo”, batería sin restricción para la app. `ops-pulse` marca `GPS_STALE`. Avisar al cliente que el mapa no está actualizado; el estado del pedido sigue visible |
| **Cliente no ve el estado** | Recargar la web (el service worker trae la versión nueva sola). El seguimiento se consulta cada 5 s |
| **Acceso comprometido** | `disable` (§2.6) y luego `reset-access` |
| **Pedido de alguien no invitado** | Rechazarlo desde el Panel; si se repite, pausar pedidos (§8) |

Severidad y reglas de ola:
- **P0** (pérdida o duplicado de pedido, cobro mal registrado, stock corrupto,
  acceso cruzado, secreto expuesto, rider/entrega incorrecta, pérdida de datos):
  **PAUSAR TODO** (§8) y abrir incidente.
- **P1** (pedido no aparece, Panel no opera, Rider no completa, GPS inutilizable,
  cliente sin estado, auth rota, rollback roto): no avanzar de ola.

## 8. PAUSE ALL SYSTEM

1. Panel → **Abrir** → **Pausar pedidos** (la tienda deja de aceptar pedidos).
2. Riders → **No disponible** en la app.
3. No enviar más invitaciones; avisar a clientes con pedidos activos.
4. Terminar o cancelar (con motivo) los pedidos activos; registrar cobros reales.
5. Si el problema es la web: rollback (§9). Si es la base: §10.
Nunca borrar filas para “vaciar”: pedidos, cobros y eventos son la evidencia.

## 9. Rollback

- **Web + config:** en Cloudflare Pages, proyecto **`la-taba-commercial-pilot`**
  (nunca otro), elegir el deployment anterior exitoso → *Rollback*. Luego
  verificar `version.json`, que el runtime siga apuntando al mismo ref,
  login de Panel y un pedido de control. Ensayado con
  `scripts/deploy/drill-commercial-pilot-rollback.mjs` (preflight → rollback → restore).
- **Base de datos:** un rollback web **no** revierte migraciones. Se corrige
  hacia adelante (migración compensatoria probada), nunca `reset`.
- **Rider:** reinstalar la APK anterior de la ficha. Android puede pedir
  desinstalar sólo `com.lataba.rider.pilot` para bajar de versión: se pierde la
  sesión local, no los pedidos. Nunca desinstalar la histórica `com.lataba.rider`.

## 10. Backups y restauración

- **Base:** backups diarios automáticos de Supabase (plan Pro, retención 7 días,
  PITR apagado; RPO ≤ 24 h). Además, antes de cada cambio de versión:
  `supabase db dump` del esquema y datos al directorio privado de backups
  (fuera del repo). Restauración probada en una base aislada (ver evidencia).
- **Restaurar:** en Supabase → Database → Backups → restaurar el punto elegido
  (reemplaza la base completa: pausar todo antes, §8) o restaurar el dump en un
  proyecto nuevo y cambiar el runtime (deploy con el nuevo ref).
- **Storage:** este entorno no guarda archivos de clientes. Las fotos del
  catálogo viven versionadas en el repositorio y se publican con la web; el
  bucket privado `fiscal-documents` no se usa en el piloto.

## 11. Rollout por olas

| Ola | Clientes | Para avanzar |
|---|---|---|
| 1 | 5 conocidos | 0 P0, 0 P1, todos los pedidos terminales y cobros registrados, `ops-pulse` sano |
| 2 | 15 | ídem durante al menos 3 días de operación de la ola 1 |
| 3 | 30 | ídem durante la ola 2 |

Invitaciones sólo por mensaje privado. No publicar la URL.

## 12. Compuertas antes de invitar

`PRODUCTION_TECH_READY` y `COMMERCIAL_OPEN_READY` se informan por separado.
Sin catálogo aprobado el entorno puede estar desplegado con **0 productos
publicados** (smoke `--catalog-mode none` exige que no se vea ninguno) y no se
invita a nadie. Detalle de evidencias y estado actual: `docs/CONTROLLED-PRODUCTION-STATUS.md`.

## 13. Versiones actuales

`version.json` publicado (commit y runtime web), `CACHE_NAME` en `sw.js`,
APK Rider de la ficha y ledger de migraciones del proyecto
(`supabase migration list --project-ref <ref>`). Registrarlos antes y después
de cada cambio.
