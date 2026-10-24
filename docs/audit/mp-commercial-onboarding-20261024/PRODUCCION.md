# Mercado Pago comercial en producción: diferencias, secuencia y autorizaciones

24/10/2026. Se apoya en el procedimiento de #150 ([`ENTORNOS.md`](../commercial-readiness-20261023/ENTORNOS.md),
[`LANZAMIENTO.md`](../commercial-readiness-20261023/LANZAMIENTO.md)); acá sólo lo que toca la vinculación de un
comercio. **Nada de esto se ejecutó en producción: el proyecto no existe.**

## 1. QA y producción: qué cambia

| | QA (verificado hoy) | Producción (preparado) |
|---|---|---|
| Proyecto Supabase | `ixewllzzuzpqrkxzmfzx` (Free) | **no existe** (`environments.production.status = not_provisioned`) |
| Aplicación integradora | TestApp-ae01fd1d `4861627125869370` | La Taba Delivery `7677852968049976` |
| Dueño de la integradora | el vendedor de prueba `3594962708` (usuario de prueba) | una cuenta **real** de La Taba (la que creó la app) |
| Vendedor | el mismo dueño: preferencias `marketplace: NONE` | Walter, cuenta real **distinta** del dueño: preferencias `MP-MKT-7677852968049976` |
| Cuenta de La Taba como vendedor | permitida (es la configuración de QA) | **rechazada** en el callback (`integrator_account`), en la verificación (`seller_is_integrator`) y al cobrar (`PAYMENTS_NOT_ENABLED`) |
| Etiqueta del vendedor | `test_user` obligatoria | `test_user` prohibida; `live_mode: true` obligatorio en el token |
| Callback / webhook | `https://ixewllzzuzpqrkxzmfzx.supabase.co/functions/v1/mercadopago-oauth-callback` · `…/mercadopago-webhook` | `https://<ref>.supabase.co/functions/v1/mercadopago-oauth-callback` · `…/mercadopago-webhook`, registrados en La Taba Delivery |
| Panel / origen | `https://recovery-20261020.taba2-staging.pages.dev` | `https://la-taba.pages.dev` (D2) |
| Para **vincular** | entorno `test` | `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved` **cargado**; la llave final **ausente** |
| Para **cobrar** | `enabled` + ventana QA | además: `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` (llave final) y habilitación por la RPC de operador con revisión aprobada |
| Reembolso por API | 401 code 7 (límite de la TestApp) | sin probar: primer reembolso real controlado (`LANZAMIENTO.md` §6) |

**Hallazgo medido hoy**: `providerEnvironment()` se niega a cargar la configuración de producción sin
`MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved`, así que **sin ese secreto Walter no puede ni vincular**. Cargarlo no
habilita cobros: siguen faltando la llave final, `business_payment_settings.enabled` (vincular en producción lo deja
en `false`) y `production_review_status = approved` en la fila del comercio. Lo fija la prueba
`production-onboarding-rehearsal.deno.ts`.

## 2. Secuencia hasta poder vincular a Walter

| # | Paso | Quién | Comando / lugar |
|---|---|---|---|
| P1 | Crear el proyecto `la-taba-production` en plan pago, `sa-east-1` (**D1**) | Marco (organización Luna Systems) | Dashboard de Supabase — **servicio pago** |
| P2 | PR de binding | ingeniería | `node scripts/production/bind-production.mjs --ref <ref> --organization <org> --plan pro --verify-remote --write` → PR → CI verde → merge |
| P3 | Ensayo del alta sobre el binding (opcional, sin red) | ingeniería | `node scripts/production/rehearse-mp-onboarding.mjs --ref <ref>` |
| P4 | Esquema y funciones | ingeniería | `node scripts/production/deploy.mjs bootstrap --apply --confirm <ref>` · `deploy.mjs functions all --apply --confirm <ref>` · `deploy.mjs gates` |
| P5 | **Renovar el Client Secret** de La Taba Delivery conservando el Client ID | **dueño de La Taba Delivery** | Mercado Pago Developers → Tus integraciones → La Taba Delivery → Credenciales de producción |
| P6 | Registrar en La Taba Delivery la Redirect URL `https://<ref>.supabase.co/functions/v1/mercadopago-oauth-callback` y el webhook `https://<ref>.supabase.co/functions/v1/mercadopago-webhook` (evento *Pagos*), y leer la clave secreta del webhook | **dueño de La Taba Delivery** | Developers → La Taba Delivery → Editar datos / Webhooks |
| P7 | Cargar los secretos de Mercado Pago por entrada oculta, **sin** la llave final | Marco | `scripts/mercadopago/configurar-oauth-produccion.ps1` (Client Secret renovado + clave de webhook) · `node scripts/mercadopago/sincronizar-worker-hmac.mjs --target=production --apply` · `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved` desde el Dashboard |
| P8 | Verificar | ingeniería | `node scripts/mercadopago/verificar-configuracion.mjs --ref=produccion` |
| P9 | Publicar el sitio con el panel de esta rama | ingeniería | `LANZAMIENTO.md` §2 |
| P10 | **Walter vincula** | Walter | [`CONECTAR-WALTER.md`](CONECTAR-WALTER.md) |

Después de P10, la habilitación y el primer cobro real siguen `LANZAMIENTO.md` §4–§6 (autorizaciones D5 de Walter).

## 3. Lo que exige iniciar sesión como dueño de La Taba Delivery

Sólo P5 y P6, en Mercado Pago Developers, con la cuenta **real** que creó la aplicación `7677852968049976`:

1. Renovar el **Client Secret** (el del 6/10 se expuso en una salida de diagnóstico, nunca en el repositorio; no
   reutilizarlo). Si Mercado Pago propone cambiar también el Client ID, **detenerse**: el binding y la app del
   repartidor lo tienen fijo.
2. Registrar la Redirect URL y el webhook del proyecto nuevo y revelar la clave del webhook.
3. Confirmar en el panel de la app que «Modelo de integración» es Marketplace / OAuth y que PKCE está activo (el
   enlace de La Taba siempre manda `code_challenge_method=S256`).

Ninguno de estos pasos usa la cuenta de Walter. **La cuenta de Walter sólo se usa en P10, tipeada por él.**

## 4. Llave final (no antes de la prueba de control)

`MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` y la RPC de operador
`operator_set_mercadopago_for_business(…, true, '7677852968049976', true)` habilitan el cobro real. Van **después** de
que Walter vincule y verifique, con su autorización del primer cobro de control (D5). Apagado: `LANZAMIENTO.md` §8.

## 5. Riesgos que siguen abiertos

- **R-MKT-1/2/3 (marketplace real)**: nunca se ejecutó un pago con integrador ≠ vendedor. El ruteo del webhook usa
  `user_id` como pista y confirma con el pago leído con el token del vendedor (`collector_id` + `external_reference`
  del comercio); con el cambio de hoy la cuenta dueña de la app **no puede** ser vendedor en producción, así que un
  aviso con `user_id` = dueño nunca se rutea a un comercio (se rechaza y lo recupera el barrido de verdad del
  proveedor). Verificarlo antes con G1 (segundo vendedor de prueba, `MARKETPLACE-SEGUNDO-VENDEDOR.md`) o, si no se
  autoriza, en el primer cobro real de control.
- **Reembolso por API**: no certificable en QA (401 code 7). El reembolso desde la cuenta del vendedor sí se concilia.
- **Disputas / contracargos**: el código los modela (`payment_disputes`; el worker procesa los avisos `chargeback` y
  `claim` leyendo `/v1/chargebacks/{id}` con el token del vendedor; el pago pasa a `charged_back`). Nunca se ejercitó
  con Mercado Pago real ni en QA; tampoco hay certificación de que el webhook de La Taba Delivery reciba esos temas
  (hay que marcarlos en P6 si se quieren).
