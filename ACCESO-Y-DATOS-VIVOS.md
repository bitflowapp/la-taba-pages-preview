# Acceso recuperado y qué mostró la base viva

2026-08-12. Todo read-only salvo lo que se declara. Ningún valor de secreto fue
leído, impreso ni copiado a un repositorio.

---

## 1 · El acceso se recuperó sin crear ningún PAT

El token del CLI de Supabase **ya estaba** en el Windows Credential Manager, bajo
`LegacyGeneric:target=Supabase CLI:supabase`. Lo que faltaba era el binario: se
había usado antes (queda `~/.supabase/telemetry.json`) pero no estaba instalado.

Se instaló el CLI oficial **v2.113.0** en `<CLI_BIN>/supabase.exe`
y tomó la sesión guardada sin pedir nada:

```
la-taba-staging  ukxqbgswjlibmnjemrzd  ACTIVE_HEALTHY  us-east-1  Postgres 17.6.1.147
la-taba-demo     yakhtrkukqlgzvxuvhzs  INACTIVE
```

`TABA_SECRETS` quedó en `<TABA_SECRETS>` (User + sesión) y el `bin`
en el PATH de usuario.

**No se creó, rotó ni renovó ninguna credencial.**

---

## 2 · Preflight con datos vivos: 14 OK, 2 fallas

| Chequeo | Resultado |
|---|---|
| storefront vivo · gestos desplegados | OK |
| catálogo comprable | **6 sin alcohol**; el más barato $2.925, stock 69 |
| negocio abierto | envío **$150**, mínimo **$350** |
| Mercado Pago | `checkout_pro`, **environment=test** |
| cuenta del Rider QA | OK, user `aab5bc54` |
| **rider libre** | **FALLA — ocupado con `LT-0142:assigned`** |
| **rider sin entrega activa** | **FALLA — la app ve `LT-0142` asignado** |
| Moto conectado · app instalada 1.0.0 · permiso fino · GPS alta precisión · red | OK |
| LT-0030 intacto | OK (`arrived`, rev 11, $550, `origin=qa`) |
| ARCA en cero | OK |
| barrido al día | OK — corrió hace 7 s |

Las dos fallas son **la misma cosa**: hay un pedido tomando la cuenta del Rider.

---

## 3 · `LT-0142` — qué es y qué NO se hizo

Creado **2026-08-11T23:17:27Z**, `origin='production'`, $3.726, pago `cash`.
Recorrió `received → 3 cambios de estado → rider_assigned` en **72 segundos** y
quedó en `assigned` sobre el Rider QA. Tiene 6 eventos.

**No lo creé yo.** En toda la auditoría no hice una sola llamada de escritura: mis
POST fueron `scheduler_heartbeat`, `get_public_order_tracking` y dos logins de
validación. El certificador que corrí (`certify-staging-always-map.mjs`) **no
crea pedidos**: su función `sembrar()` sólo cambia el estado del navegador vía
`js/state.js`, nunca la base.

**No lo toqué y no lo voy a tocar**: no puedo distinguir con certeza un pedido
humano de un ensayo ajeno, y la instrucción es no tocar pedidos humanos.

### El problema de fondo, que es peor que el pedido

En staging hay **42 pedidos con `origin='production'`** (25 cancelados, 16
entregados, 1 asignado) que **no son de clientes reales**: repiten los mismos
totales sintéticos ($3.726 / $3.075) y se recorren en segundos. Hoy se crearon 9.

**El campo `origin` ya no distingue un pedido real de un ensayo en staging.** Es
la razón más fuerte para que producción arranque con la tabla de pedidos vacía.

Lo mismo con las cuentas: de **600 usuarios**, sólo **2** tienen email real; el
resto son 500 anónimos del storefront y ~98 sintéticos `@…local`.

---

## 4 · Alertas abiertas

| Alerta | Sujeto | Desde | Veces |
|---|---|---|---|
| `RIDER_SIGNAL_STALE` | `733290a7` | 2026-08-07T03:20Z | **786** |
| `RIDER_SIGNAL_STALE` | `ae213326` | 2026-08-11T23:23Z | 8 |

La primera lleva **5 días abierta** acumulando ocurrencias. La segunda es
`LT-0142`. El motor de alertas funciona; lo que falta es que alguien las cierre.

---

## 5 · Staff del Panel — `STAFF_LOGIN_HUMAN_ACTION_REQUIRED`

Lo que se averiguó sin tocar nada:

- El Panel tiene **un solo owner**: user `542f6931`, dominio **`@local.taba`** —
  es una **cuenta técnica, no la identidad de una persona**. Activa.
- El archivo `la-taba-staging-business-login.txt` apunta **exactamente a ese
  usuario** (verificado por búsqueda, sin imprimir el email).
- Su contraseña en disco **ya no sirve**: HTTP 400 `invalid_credentials`.
- **Pero la cuenta está viva y alguien entró hoy a las 20:55Z.**

**Conclusión: no hay que resetear nada.** Lo que está desactualizado es el archivo
local, no la cuenta. Quien haya iniciado sesión a las 20:55 tiene la contraseña
vigente; con ella se reescribe el archivo y el Panel vuelve a operarse desde los
scripts.

Deliberadamente **no** reseteé esa contraseña: es la cuenta `owner`, con permisos
máximos, y hacerlo invalidaría la sesión de quien la esté usando. Eso es una
decisión de identidad y permisos, no un paso técnico.

---

## 6 · Infraestructura, medida

### Edge Functions

6 desplegadas y **2 del repo que no lo están**: `mercadopago-cancel-payment` y
`fiscal-artifact-access`. `mercadopago-refund` es la única con `verify_jwt=true`.

### Secretos (sólo nombres)

14 cargados. **Falta a propósito `MERCADOPAGO_PRODUCTION_REVIEW_STATUS`**, que es
justo lo que mantiene el cobro real fallando cerrado.

### Backups

**WAL-G activo, PITR DESACTIVADO, 0 backups físicos listados.** Para producción
hay que encender PITR antes del primer pedido.

### Esquema

`pg_cron`, `pg_net`, `pgcrypto`, `supabase_vault` · 255 `SECURITY DEFINER` con
289 `set search_path` · 87 RLS · 93 policies · 256 `revoke`.

### Auto-dispatch: confirmado que NO está en la base

`rider_shifts` y `rider_dispatch_offers` **no existen** en staging (404). La
decisión de no llevarlo al go-live queda respaldada por la base, no sólo por git.

---

## 7 · Una llamada que conviene declarar

Al sondear qué RPCs existen invoqué `check_scheduler_watchdog()`, que **puede
escribir** una alerta si el barrido está atrasado. No lo estaba (7–36 s), así que
fue no-op. Verificado después: siguen exactamente **las 2 alertas previas**,
ninguna creada en los últimos 15 minutos, y el barrido sano.

También conviene corregir una lectura propia: la sonda de RPCs marcó como «no
existe» a funciones que sí existen y sólo requerían parámetros
(`get_public_order_tracking` entre ellas, confirmada aparte con HTTP 200).

---

## 8 · Configuración comercial VIVA — qué está y qué falta

Leída de la base, no supuesta.

| Dato | Valor vivo | Estado |
|---|---|---|
| Dirección | `Mendoza 827` | configurado |
| Pedidos online | `ordering_enabled=true`, `ordering_verified=true` (30-jul, por el owner) | configurado |
| Delivery | habilitado · **envío $150** · **mínimo $350** | configurado, **falta que Walter lo confirme** |
| Retiro en local | habilitado | configurado |
| Moneda | `ARS` | configurado |
| Alcohol | habilitado, 18+, **20:00–06:00**, `America/Argentina/Buenos_Aires` | configurado |
| **Teléfono** | **NULL** | **FALTA** |
| **WhatsApp** | **NULL**, `whatsapp_verified=false` | **FALTA** |
| **Horarios de atención** | **no existe columna alguna** | **NO MODELADO** |
| **Zona / radio de entrega** | **no existe columna alguna** | **NO MODELADO** |

Los dos últimos son más serios que un dato faltante: **el esquema no tiene dónde
guardarlos.** No es que Walter no los cargó; es que hoy el sistema no los
representa. Si el piloto necesita horarios y zona, eso es trabajo de producto,
no de configuración.

### Catálogo vivo vs catálogo del repositorio

| | |
|---|---|
| productos en la base | **10** (8 activos, 2 con alcohol) |
| precio confirmado | 10 · precio pendiente **0** · sin stock **0** |
| **comprables hoy** | **8** |
| filas en el catálogo comercial del repo | **92** |

O sea: **está vivo menos del 11 % del catálogo.** Las «9 unidades bloqueadas por
precio unitario» que reporta `catalog:prices:check` son de la planilla, no de la
base: en la base no hay ni un precio pendiente porque esos productos **todavía no
se importaron**.

Para abrir de verdad hay que decidir qué se vende e importarlo con precios
confirmados. Eso es una **decisión de Walter**, no algo que se pueda inferir.

### Pago

`mercadopago` · `enabled=true` · **`environment=test`** · `checkout_pro` · `ARS`.

---

## 9 · Lo que no se tocó

Producción. Backend mutable. Migraciones. ARCA. Dinero. `LT-0030`. `LT-0142` ni
ningún otro pedido. Contraseñas. Cuentas. El `runtime-config` LIVE. Sin push.
