# Mercado Pago real en CONTROLLED_PRODUCTION

Runbook para activar Mercado Pago real en CONTROLLED_PRODUCTION
(`tkanbadcglszlcyfjvpv`, `https://la-taba-commercial-pilot.pages.dev`).
Cubre qué ya está listo, qué falta y quién lo hace, en orden.
El reporte técnico de Staging está en `docs/MERCADOPAGO_FINALIZATION_2026-09-25.md`.

## 0. Veredicto (2026-09-25)

| | |
|---|---|
| `ONLINE_PAYMENTS_PRODUCTION_READY` | **Configurado (2026-09-26, §8)**. H1, H2 y H2b hechos. Falta el alta de Walter como dueño de `la-taba-cp` y su consentimiento (H3), un catálogo real y las autorizaciones de H4–H6 |
| `REAL_PAYMENT_E2E` | **NO EJECUTADO**: requiere H1–H5 y el negocio real no tiene productos |
| Código y pruebas sin dinero | listos (§6) |
| Arquitectura | marketplace: cada negocio conecta **su** cuenta por OAuth y la preferencia la firma el token de **ese** vendedor |
| Access token global | prohibido en producción: con `MERCADOPAGO_ACCESS_TOKEN` cargado, la herramienta del worker falla |

## 1. La aplicación productiva

**La Taba Delivery**, application/client id `7677852968049976`. Es la aplicación
de la plataforma. Walter no crea ninguna aplicación: conecta su cuenta.

Desde esta PC no se pudo auditar. No hay sesión de Mercado Pago Developers:
«marco», «Default» y Edge redirigen al login (2026-09-25).

Lo que la aplicación tiene que tener (valores exactos):

| En Developers → La Taba Delivery | Valor |
|---|---|
| URL de redirección OAuth | `https://tkanbadcglszlcyfjvpv.supabase.co/functions/v1/mercadopago-oauth-callback` (agregarla sin borrar la de `wwcpogltfgzgkrlilbcd` hasta retirar esa producción) |
| Flujo OAuth | Authorization Code con **PKCE S256**; permisos `read`, `write`, `offline_access` |
| Webhooks, modo productivo | URL `https://tkanbadcglszlcyfjvpv.supabase.co/functions/v1/mercadopago-webhook`, evento **Pagos**. La *clave secreta* de esa pantalla es `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` de CP |
| Credenciales de producción | el *Client Secret* es `MERCADOPAGO_CLIENT_SECRET` de CP |

Cada preferencia manda también su propia `notification_url`: la del webhook de
CP, firmada con la clave de la aplicación.

Las URLs de retorno no se cargan en la aplicación: las arma el código
(`auto_return=approved`). Las tres responden 200 en CP:

- `https://la-taba-commercial-pilot.pages.dev/pago/resultado`
- `https://la-taba-commercial-pilot.pages.dev/pago/pendiente`
- `https://la-taba-commercial-pilot.pages.dev/pago/error`

## 2. Configuración de CP (sólo nombres)

| Secreto de Edge Functions | Quién lo pone | Cómo |
|---|---|---|
| `MERCADOPAGO_CLIENT_ID` = `7677852968049976`, `MERCADOPAGO_CREDENTIAL_MODE` = `oauth`, `MERCADOPAGO_ENVIRONMENT` = `MERCADOPAGO_OAUTH_ENVIRONMENT` = `TABA_DEPLOYMENT_ENV` = `production`, `MERCADOPAGO_OAUTH_PROJECT_REF`, `MERCADOPAGO_OAUTH_PANEL_URL`, `TABA_CHECKOUT_BASE_URL`, `TABA_ALLOWED_ORIGINS` | H2 | `configurar-oauth-produccion.ps1 -Target controlled-production` |
| `MERCADOPAGO_CLIENT_SECRET`, `MERCADOPAGO_OAUTH_WEBHOOK_SECRET` | H2 (persona con la aplicación) | la misma herramienta, entrada oculta |
| `MERCADOPAGO_TOKEN_ENCRYPTION_KEY`, `PAYMENT_LOG_HASH_SALT` | la misma herramienta | se generan una sola vez y nunca se rotan desde ahí |
| `PAYMENT_WORKER_SECRET` + Vault `taba_payment_worker_hmac_secret` / `taba_payment_worker_url` | después de H2 | `sincronizar-worker-hmac.mjs --target=controlled-production --apply` (hace la sonda firmada) |
| `MERCADOPAGO_REAL_MONEY_ENABLED` = `enabled` | quien opera la plataforma, con la decisión escrita del dueño | §2.1. Es lo último que se pone, y se saca en un paso |

Nunca en CP: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION`.
Las herramientas fallan si aparecen. La segunda es la variable vieja de la
prueba de humo: ya no abre nada (el cobro real lo abre el interruptor de §2.1)
y su presencia es un error de configuración que `verificar-configuracion.mjs`
informa y por el que `sincronizar-worker-hmac.mjs` no corre.

### 2.1 El interruptor de dinero real (EDGE-03)

**Qué es.** Un secreto de las Edge Functions de CP, permanente:
`MERCADOPAGO_REAL_MONEY_ENABLED`. Lo abre **sólo** el valor exacto `enabled`.
Sin el secreto, vacío, `true`, `ENABLED`, con espacios o con cualquier otra
cosa, está cerrado. No vive en la web ni en la base: sólo en el backend.

En producción se crea un cobro únicamente si se cumplen las tres llaves a la vez:

1. la revisión del proyecto aprobada (`MERCADOPAGO_PRODUCTION_REVIEW_STATUS` = `approved`, como hasta ahora);
2. el comercio con Mercado Pago encendido y su vendedor productivo conectado (H3 y H4, como hasta ahora);
3. el interruptor `MERCADOPAGO_REAL_MONEY_ENABLED` = `enabled`.

Si falta cualquiera: la sesión de checkout responde `409 PAYMENTS_NOT_ENABLED`
antes de reservar stock, no se crea ninguna preferencia y no sale ningún
pedido a Mercado Pago. La compuerta de release lo informa como
`MONEY_MOVEMENT_POSSIBLE: NO`.

**Estado de CP hoy.** `MERCADOPAGO_PRODUCTION_REVIEW_STATUS` está y
`MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` no está (nombres leídos el
2026-10-03). El interruptor no está: con las funciones de este cambio
desplegadas, CP sigue cerrada al dinero real hasta que alguien lo ponga a
propósito.

**Quién y cuándo.** Quien opera la plataforma con acceso de gestión al
proyecto, y sólo con la decisión escrita del dueño. Para el pago real de
control (H5) se abre para esa ventana; para vender, cuando
`docs/ecommerce-hardening/payment-certification.json` registra Mercado Pago
certificado en producción y la decisión de apertura lo incluye (la compuerta
`REAL_MONEY_GATE` no da verde de otro modo). Primero tienen que estar
desplegadas las funciones con este cambio: las anteriores leían la variable
vieja, que por eso tiene que seguir ausente.

**Cómo se abre.** En el Dashboard (Edge Functions → Secrets) o por consola; el
valor es público, no es un secreto:

```powershell
supabase secrets set MERCADOPAGO_REAL_MONEY_ENABLED=enabled --project-ref tkanbadcglszlcyfjvpv
npm run mp:config -- --ref=produccion-controlada   # interruptor ABIERTO, dinero real POSIBLE
```

**Cómo se apaga, en un paso.** Borrar el secreto `MERCADOPAGO_REAL_MONEY_ENABLED`
(o ponerle cualquier otro valor):

```powershell
supabase secrets unset MERCADOPAGO_REAL_MONEY_ENABLED --project-ref tkanbadcglszlcyfjvpv
npm run mp:config -- --ref=produccion-controlada   # interruptor CERRADO, dinero real CERRADO
```

Desde ahí ningún comercio crea un cobro real. **La plata que vuelve sigue
funcionando:** los reembolsos, las cancelaciones de cobros que ya existen, el
webhook, el worker, la conciliación y la pantalla de estado no consultan el
interruptor. Un pago aprobado después del corte igual termina en su pedido, y
un cliente puede recibir su devolución. Lo que el corte no retira: una
preferencia que ya se le entregó a un comprador sigue pagable en Mercado Pago
hasta que vence la sesión de checkout que la originó; ese pago, si ocurre, se
asienta y se puede devolver como cualquier otro. Para cortar el cobro **no** se borra
`MERCADOPAGO_PRODUCTION_REVIEW_STATUS`: eso apaga todo el runtime productivo,
reembolsos y webhook incluidos.

El binding de CP está fijado en el código (`_shared/seller-oauth.ts`). Rechaza
otro proyecto, otro entorno, otra aplicación, otro host de panel o de checkout,
y otros orígenes. Cualquier secreto que falte deja las funciones cerradas.

## 3. Acciones humanas, en orden

Cada paso es una sola acción. Ninguno se hace por chat: ningún secreto se pega
en una conversación, un archivo del repositorio, un log o una captura.

**H1. Sesión de Developers.** Iniciar sesión en Mercado Pago Developers con la
cuenta dueña de *La Taba Delivery*, en un perfil de Chrome de esta PC.
Con eso se audita la aplicación y se registran las URLs de §1. También se
publica la actualización de WCS-51579
(`docs/MERCADOPAGO_FINALIZATION_2026-09-25.md` §11).

**H2. Credenciales de la aplicación en CP.** Quien tiene la aplicación corre, en
una consola de esta PC:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/mercadopago/configurar-oauth-produccion.ps1 -Target controlled-production
```

La herramienta pide el Client Secret y la clave de webhooks con entrada oculta.
Después, el worker:

```powershell
node scripts/mercadopago/sincronizar-worker-hmac.mjs --target=controlled-production --apply
```

**H2b. Cobros online en la web de CP.** La web de CP se construye sólo con
cobro manual (`deploy/controlled-production.json`: `"manualPaymentOnly": true`).
En ese modo el Panel no ofrece conectar Mercado Pago. Para habilitarlo, en ese
mismo archivo:

```json
"manualPaymentOnly": false,
"onlinePayments": { "provider": "mercadopago-oauth", "runbook": "docs/MERCADOPAGO_PRODUCCION_CP.md",
  "approvedBy": "<quién decide>", "approvedAt": "AAAA-MM-DD" }
```

Después va por el camino de siempre: PR a `release/taba-controlled-production`,
`CP_DEPLOY_SHA` y deploy.

El empaquetado sondea el backend sin credenciales. Se niega
(`PILOT_ONLINE_PAYMENTS_BACKEND_NOT_CONFIGURED`) mientras el webhook no rechace
lo que no está firmado (401) o el checkout no acepte el origen de CP (204). Así,
la web nunca ofrece conectar contra funciones cerradas. Medido el 2026-09-25:
CP respondía 503/403 (no listo) y Staging 401/204 (listo).

**H3. Walter conecta su cuenta.** Desde el Panel de CP: Mercado Pago →
Conectar. El consentimiento, la 2FA o la biometría ocurren en Mercado Pago; no
hay forma ni intención de saltearlos. Queda exactamente una conexión
`connected`, con la credencial sellada.

**H4. Encender Mercado Pago sólo para el negocio real.** Es una decisión:
negocio abierto, catálogo real aprobado y revisión productiva confirmada.

```powershell
node scripts/mercadopago/cobro-negocio.mjs estado   --target=controlled-production --business=e7850ad2-a447-402c-8375-3fd74e9466ba
node scripts/mercadopago/cobro-negocio.mjs encender --target=controlled-production --business=e7850ad2-a447-402c-8375-3fd74e9466ba --confirmar=la-taba-cp --revision-aprobada
```

Exige vendedor conectado de la aplicación `7677852968049976`. Toca sólo ese
negocio y queda auditado. El cobro manual sigue disponible.

**H5. Un pago real de control.** Un pedido con un producto real aprobado, al
precio real. La autorización nombra el importe exacto y el vendedor. Se hace
una sola vez: si falla antes de crear el pago, se junta evidencia y no se
reintenta. Para esa ventana se abre el interruptor de dinero real (§2.1) y,
si la autorización no dice otra cosa, se vuelve a cerrar al terminar.

Se verifica en este orden:
1. pago aprobado en el proveedor, cuyo collector es el vendedor conectado;
2. recibo del webhook con `signature_valid=true`;
3. el worker lo procesa, con un solo pedido y un solo movimiento de stock;
4. el Panel y el cliente muestran el mismo estado;
5. el vendedor ve el pago en su cuenta.

**H6. Reembolso real de control.** Requiere autorización explícita. Lo hace el
dueño desde el Panel (`mercadopago-refund`), con clave de idempotencia. Se
verifica el reembolso en el proveedor y el estado del pedido y del pago. El
stock no cambia dos veces.

## 4. Rollback

| Qué | Cómo | Probado |
|---|---|---|
| Cobro real de toda la plataforma | borrar el secreto `MERCADOPAGO_REAL_MONEY_ENABLED` (§2.1). Ningún comercio crea cobros; reembolsos, cancelaciones, webhook, worker y conciliación siguen | Deno `real-money-gate.deno.ts` (handlers reales con el interruptor apagado) |
| Mercado Pago de un negocio | `cobro-negocio.mjs apagar ... --confirmar=<slug>`: sólo `enabled=false`. Conexión, credencial, pagos e historia intactos; volver a encender no exige reconectar | Staging 2026-09-25 22:05Z, 6/6 (ver §6) + pgTAP 16 |
| Cuenta del vendedor | Panel → Desconectar: borra la credencial, invalida la generación y apaga Mercado Pago del negocio | Staging 16/16 (reconexión) |
| Funciones | redeploy de la versión anterior; sin secretos, fallan cerradas | — |
| Migraciones | `docs/migrations/rollback/20260925170000_*`, `20260925220000_*`, `20260925223000_*` | pgTAP en CI |

Si aparece un P0 financiero, Mercado Pago del negocio se apaga en el acto
(`apagar`) y el cobro manual sigue; si el problema no es de un solo negocio,
se borra además el interruptor de dinero real (§2.1):
- pago al vendedor equivocado;
- pago sin pedido;
- pedido pagado sin pago;
- pago o reembolso duplicado;
- firma inválida aceptada;
- stock corrupto;
- token expuesto;
- binding incorrecto.

## 4.1 Rollout de cobros online

Mercado Pago se enciende para **un** negocio (`cobro-negocio.mjs encender`) y
el cobro manual sigue disponible. Las etapas se miden en clientes que pagaron
online, no en tiempo. Ningún número vive en el código: el interruptor es por
negocio y el corte lo decide quien opera, con el pulso.

| Etapa | Clientes | Para pasar a la siguiente |
|---|---|---|
| 1 | 5 | ningún P0 ni P1 financiero; el pulso `mercadopago` sin avisos; cada pago con webhook firmado, un pedido y un movimiento de stock |
| 2 | 15 | lo mismo, y los reembolsos que hayan ocurrido conciliados |
| 3 | 30 | lo mismo; la capacidad de 30 ya está certificada para CP (`controlled-capacity.yml`) |

Ante cualquier P0 (§4): `apagar` en el acto, conciliar cada pago afectado con
Mercado Pago y no volver a encender sin la causa corregida.

## 5. Observabilidad

- `node scripts/controlled-production/ops-pulse.mjs --target controlled-production --business-id <uuid>`: la sección `mercadopago` levanta estas señales:
  - `MP_SELLER_CANNOT_CHARGE`
  - `MP_SELLER_TOKEN_EXPIRING`
  - `MP_OUTBOX_STALLED` y `MP_OUTBOX_DEAD_LETTER`
  - `MP_PAYMENTS_NEED_RECONCILIATION`
  - `MP_PAID_WITHOUT_ORDER`
  - `MP_REFUND_RECONCILIATION`
  - `MP_WEBHOOK_SIGNATURE_REJECTED`

  Nunca lee credenciales, cuentas ni datos de pagadores.
- Centro de operación del Panel: alerta `MERCADOPAGO_SELLER_CANNOT_CHARGE`. Se suma a las que ya existían: `PAYMENT_WORKER_IDLE`, `PAYMENT_OUTBOX_STALLED`, `PAYMENT_RECONCILIATION_REQUIRED`, `PAYMENT_APPROVED_WITHOUT_ORDER` y `CHECKOUT_PROVIDER_UNVERIFIED`.
- Firma del webhook para toda la plataforma: `list_webhook_signature_alerts()`.

## 6. Evidencia técnica sin dinero (2026-09-25)

- **429 del proveedor.** Un 429, 408, 409 o 425 en un reembolso o una cancelación
  ya no se registra como `rejected` (commit `4ab39e5`): va a reconciliación.
  El caso *throttled* falla contra la condición anterior.
  - La creación de preferencias ya lo trataba bien. Marca fallido el intento,
    no el pago, y la sesión y el carrito quedan para reintentar.
  - El límite propio responde 429 `RATE_LIMITED`.
- **Alerta de vendedor que no puede cobrar**: migración `20260925220000` y pgTAP 9.
- **Interruptor de operador por negocio**: migración `20260925223000`, auditado
  en `business_config_audit` (scope `payments`); pgTAP 16 y pruebas de la herramienta.
- **Ensayo en vivo del rollback** (`scripts/mercadopago/ensayo-rollback-staging.mjs --con-pago-manual`):
  - con Mercado Pago apagado, el checkout responde `409 PAYMENTS_NOT_ENABLED`,
    sin sesión y sin stock reservado;
  - el vendedor sigue conectado, con la misma generación;
  - la historia queda intacta;
  - el piloto de cobro manual corre completo;
  - al volver a encender, se ofrece sin reconectar.
- **Worker HMAC**: la herramienta ya puede hacer la primera provisión de CP
  (antes pedía el secreto que tenía que crear) y sigue negándose sin los
  secretos de la aplicación.
- **Seguridad OAuth y reconexión** (Staging): 34/34 y 16/16.
- **Aislamiento cobro manual / Mercado Pago**: pgTAP 5.
- **Stock**: cada sesión de prueba del 2026-09-25 liberó su reserva una sola vez al vencer (la última a las 21:03:00Z) y el producto volvió a 42.

## 7. Desplegado en CP (2026-09-25, release `0bc9318`)

1. **Respaldo previo.** `backup-drill.mjs --target controlled-production`:
   - 92 tablas y 3093 filas, restauradas y comparadas: 92/92 idénticas.
   - Foto de configuración: 0 funciones, 0 secretos, 0 Vault, 136 migraciones.
   - Guardado fuera del repositorio, en `~/.taba-backups/controlled-production/2026-09-25T22-13-41-117Z/`.
2. **Migraciones.** `20260925170000`, `20260925220000` y `20260925223000`, con
   `db push` (139 en total). Verificado:
   - disponibilidad ligada al vendedor;
   - alerta activa;
   - interruptor sólo para `service_role`;
   - alcance `payments` en la auditoría;
   - el barrido de alertas sigue en `succeeded` cada minuto.
3. **Funciones.** Las nueve de Mercado Pago, v1 `ACTIVE`, con `verify_jwt` según
   `config.toml`. Se descargaron y se compararon con el release: 55 archivos,
   0 diferencias.
4. **Smoke cerrado.** 12 casos sin autenticación ni firma, **0 aceptados**:
   - webhook y worker: 503 `PAYMENT_UNAVAILABLE`;
   - checkout, preferencia, estado y conexión: 403 `ORIGIN_NOT_ALLOWED`;
   - reembolso y cancelación: 401.
5. **Secretos.** Ninguno cargado todavía (H2). **Worker.** Sin provisionar
   (después de H2). **Web.** Sigue en sólo cobro manual (H2b).

## 8. Configurado en CP (2026-09-26, madrugada UTC)

**Mercado Pago Developers.** Sesión de la cuenta dueña de La Taba Delivery, con
tres verificaciones por código al celular. Aplicación `7677852968049976`,
Checkout Pro, PKCE **Sí**, permisos `read`, `write` y `offline access`.

- **URLs de redirección OAuth.** Se agregó
  `https://tkanbadcglszlcyfjvpv.supabase.co/functions/v1/mercadopago-oauth-callback`
  y se conservó la de la producción vieja. Verificado releyendo la página.
- **Webhooks, modo productivo.** La URL quedó en
  `https://tkanbadcglszlcyfjvpv.supabase.co/functions/v1/mercadopago-webhook`
  (antes apuntaba a `wwcpogltfgzgkrlilbcd`). Evento **Pagos (legacy)**, que es
  el `payment` de Checkout Pro.

**Secretos de CP.** El *Client Secret* y la clave de webhooks se leyeron de la
página sólo en memoria y viajaron por la entrada estándar del cargador a la
Management API. Nunca se imprimieron, se guardaron ni pasaron por el
portapapeles. Se cargaron:
- `MERCADOPAGO_CLIENT_ID` y `MERCADOPAGO_CLIENT_SECRET`;
- `MERCADOPAGO_OAUTH_WEBHOOK_SECRET`;
- la identidad de entorno, OAuth, panel, checkout y orígenes;
- `MERCADOPAGO_TOKEN_ENCRYPTION_KEY` y `PAYMENT_LOG_HASH_SALT`, generados;
- `PAYMENT_WORKER_SECRET` y Vault, por la herramienta del worker.

Con Staging no se comparte ningún valor salvo el modo `oauth`, comparado por
huella. No hay token global.

**Revisión de plataforma.** `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`.
Sin él, todo el runtime productivo falla cerrado (503), incluido el
consentimiento del vendedor. No habilita a ningún negocio: eso sigue siendo el
interruptor por negocio (H4). Este registro de 2026-09-26 decía que para
apagar el cobro real alcanzaba con borrar esa variable; desde EDGE-03 el corte
de plataforma es el interruptor de §2.1, porque borrar la revisión también
apaga reembolsos, webhook y worker.

**Worker.** `sincronizar-worker-hmac.mjs --target=controlled-production --apply`
quedó alineado, con sonda firmada sin trabajo. El cron corre cada 30 s y sólo
llama al worker si hay trabajo.

**Smokes.**
- Sonda de preparación: **lista**. El webhook sin firma responde 401 y el
  preflight desde CP responde 204 con ese origen.
- 12 casos sin autenticación ni firma, **0 aceptados**. El callback sin `state`
  redirige al panel.
- Notificación simulada por Mercado Pago (evento Pagos, firmada con la clave
  productiva) a la URL de CP: **503**. La firma es válida (una inválida
  responde 401 antes); el 503 es porque no hay vendedor conectado para rutear.

**Negocios.** `la-taba-cp` sigue cerrado, con 0 dueños, 0 productos y sin
ajustes de Mercado Pago: no se ofrece. El cobro manual no cambió.
