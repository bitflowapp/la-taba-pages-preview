# Mercado Pago real en CONTROLLED_PRODUCTION

Runbook para activar Mercado Pago real en CONTROLLED_PRODUCTION
(`tkanbadcglszlcyfjvpv`, `https://la-taba-commercial-pilot.pages.dev`).
Cubre qué ya está listo, qué falta y quién lo hace, en orden.
El reporte técnico de Staging está en `docs/MERCADOPAGO_FINALIZATION_2026-09-25.md`.

## 0. Veredicto (2026-09-25)

| | |
|---|---|
| `ONLINE_PAYMENTS_PRODUCTION_READY` | **NO**: faltan H1–H3 (§3), que son de personas. El backend de CP ya tiene las migraciones y las nueve funciones desplegadas (release `0bc9318`); cerradas hasta H2 |
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

Nunca en CP: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION`.
Las herramientas fallan si aparecen.

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
reintenta.

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
| Mercado Pago de un negocio | `cobro-negocio.mjs apagar ... --confirmar=<slug>`: sólo `enabled=false`. Conexión, credencial, pagos e historia intactos; volver a encender no exige reconectar | Staging 2026-09-25 22:05Z, 6/6 (ver §6) + pgTAP 16 |
| Cuenta del vendedor | Panel → Desconectar: borra la credencial, invalida la generación y apaga Mercado Pago del negocio | Staging 16/16 (reconexión) |
| Funciones | redeploy de la versión anterior; sin secretos, fallan cerradas | — |
| Migraciones | `docs/migrations/rollback/20260925170000_*`, `20260925220000_*`, `20260925223000_*` | pgTAP en CI |

Si aparece un P0 financiero, Mercado Pago del negocio se apaga en el acto
(`apagar`) y el cobro manual sigue:
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
