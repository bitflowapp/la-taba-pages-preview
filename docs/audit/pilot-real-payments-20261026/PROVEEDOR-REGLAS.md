# Reglas de Mercado Pago Argentina que condicionan el piloto (consultadas el 26/10/2026)

Fuentes: documentación oficial de Mercado Pago Developers. Cada afirmación lleva su enlace; lo que **no** se pudo confirmar en una página oficial figura como **sin confirmar** y se resuelve con una prueba real o con Mercado Pago (§8). Las páginas se leyeron con una herramienta que resume el contenido: antes de citar una frase textual en un documento legal, releerla en la página.

## 1. Salida a producción de Checkout Pro

- Las credenciales productivas se activan en *Tus integraciones* → la aplicación → *Credenciales* → *Productivas* → «Activar credenciales». El formulario pide el rubro y el **sitio web (obligatorio)**, y se aceptan la Declaración de Privacidad y los Términos. SSL es obligatorio. [go-to-production](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/go-to-production)
- La página no describe una aprobación ni una demora. Si Mercado Pago revisa la cuenta por detrás: **sin confirmar**.
- Calidad de integración: opcional en esa página; mínimo 73 (100 recomendado), medición automática mensual o manual con el `payment ID` de un pago **de producción**. Las «acciones obligatorias» (por ejemplo webhooks activos y `external_reference`) sólo se ven en el resultado de la medición. [integration-quality](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/how-tos/integration-quality)
  → Por eso el primer pago real también es la primera medición de calidad posible.

## 2. Marketplace y OAuth

- Redirect URL registrada en la aplicación, idéntica al `redirect_uri` (sin parámetros extra: lo adicional va en `state`). PKCE es opcional; La Taba lo usa (S256). El código de autorización dura 10 minutos y es de un solo uso. [OAuth](https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation)
- El `access_token` dura 180 días. Renovar exige `offline_access`, y cada renovación devuelve **otro** `refresh_token` que hay que guardar. La página de introducción dice «6 meses y se puede reutilizar»: contradice la de renovación; La Taba trata el refresh como rotativo (guarda el par nuevo en cada renovación). [renovación](https://www.mercadopago.com.ar/developers/es/docs/security/oauth/renewal)
- No se menciona un nivel de verificación (KYC) del vendedor ni una aprobación especial: **sin confirmar** que no exista. La Taba no cobra `marketplace_fee`, que es donde el material de Mercado Pago pide coordinar con un ejecutivo comercial. [marketplace](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace)
- Qué campo del pago o de la preferencia identifica al vendedor frente a la integradora: **sin confirmar** en la documentación leída. En la práctica de La Taba (medida en QA): `collector_id` de la preferencia = vendedor; `marketplace: MP-MKT-<client_id>` = integradora; el aviso trae `user_id` = «identificador del vendedor» según [notificaciones](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/payment-notifications.md).

## 3. Combinaciones de cuentas

- Mezclar un usuario de **prueba** con uno **real** en el mismo pago falla («Invalid users involved», 2034): hay que usar todos de prueba o todos reales. [errores](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-payments/error-messages/card-token-creation-errors). Medido en QA el 23/10: la integradora de una cuenta real con vendedor y comprador de prueba falla con 2034.
- Pagarse a uno mismo: la documentación de VTEX (integración oficial) rechaza el pago con el mismo usuario («invalid_users»). Para Checkout Pro directo: **sin confirmar**. Por eso el documento de autorización exige una cuenta compradora **distinta** de la vendedora y la base lo hace cumplir (`payment_live_pilot_buyer_not_seller_check`).
- Comprador = dueño de la aplicación integradora: **sin confirmar**. La documentación de cuentas de prueba sólo dice que un test de marketplace puede usar «una cuenta que represente al integrador». **No asumir que Marco (si es el dueño de La Taba Delivery) puede ser el comprador:** usar una tercera cuenta compradora real si el preflight o Mercado Pago lo rechaza. [cuentas de prueba](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/test/accounts)

## 4. Devoluciones

- `POST /v1/payments/{id}/refunds`, con `Authorization` y `X-Idempotency-Key` obligatorios; cuerpo vacío = total, `amount` = parcial. Dentro de los 180 días de la aprobación y con «saldo suficiente». [referencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/create-refund/post), [reembolsos y cancelaciones](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/additional-settings/refunds-and-cancellations.md)
- En un pago 1:1 de marketplace el reembolso se descuenta «de forma proporcional» del vendedor y del marketplace, y el marketplace no puede hacer un reembolso total si el vendedor no tiene fondos. [marketplace](https://www.mercadopago.com.ar/developers/es/docs/split-payments/split-1-1/integration-configuration/integrate-marketplace)
- **Sin confirmar:** qué token debe usar la llamada (vendedor o integradora), qué permiso necesita, cómo se devuelven las comisiones, si el dinero «a liberar» de una cuenta nueva cuenta como «saldo suficiente», y qué significa exactamente el `401 … live credentials` (código 7) de los reembolsos. La única mención oficial de ese error está en la tabla de VTEX («las credenciales de la cuenta no están activadas»). Es lo que el primer reembolso real va a resolver; la alternativa desde la cuenta del vendedor está probada. Ver [`PROCEDIMIENTO-DEVOLUCION.md`](PROCEDIMIENTO-DEVOLUCION.md).
- Si el vendedor devuelve desde su panel y la API lo refleja como `refunded` más la lista de devoluciones: probado en QA el 23/10 (`184722117633`), no documentado.

## 5. Webhooks en producción

- La URL se configura en *Webhooks* → *Configurar notificaciones* → «URL modo producción». Eventos: **Pagos** (`payment`) y **Vinculación de aplicaciones** (`mp-connect`). [webhooks](https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks)
- Firma: manifiesto `id:[data.id_url];request-id:[x-request-id];ts:[ts];` con el `data.id` alfanumérico en minúsculas y omitiendo los campos ausentes (La Taba lo implementa y lo prueba, incluidos 6 casos de firma falsa).
- Hay que responder 200 o 201 en menos de 22 s; los reintentos son cada 15 minutos y después se espacian (la página de pagos muestra 0, 15, 30 min, 6 h, 48 h y 96 h).
- La URL de la preferencia (`notification_url`) tiene prioridad sobre la del panel; debe ser HTTPS. La Taba pasa la suya por preferencia y además configura la de producción.

## 6. Dinero, comisiones y liberación

- Comisión por venta aprobada, más IVA, según el plazo de liberación: 35 días 1,49 %; 18 días 3,39 %; 10 días 4,39 %; al instante 6,29 %. La página no muestra fecha de vigencia y aclara que varía con impuestos provinciales. Las cuotas suman (por ejemplo 2 cuotas +7,79 %). [tarifas](https://www.mercadopago.com.ar/herramientas-para-vender/check-out), [link de pago](https://www.mercadopago.com.ar/herramientas-para-vender/link-de-pago)
- Liberación: las cuentas nuevas empiezan con un plazo de 10, 18 o 35 días; el cobro al instante se habilita tras revisar el historial de ventas. La fecha de cada venta está en *Tu dinero* → Calendario. (Resumen de una búsqueda: las páginas de ayuda no se pudieron abrir.) [ayuda](https://www.mercadopago.com.ar/ayuda/cuando-podre-usar-dinero_275)
- Reclamos y contracargos pueden afectar la liberación. [ayuda](https://www.mercadopago.com.ar/ayuda/18724)
- **Sin confirmar:** importe mínimo en ARS para Checkout Pro; retenciones por antifraude en los primeros pagos de una cuenta nueva.
  → El importe del piloto lo elige el titular (no ingeniería); si Mercado Pago lo rechazara por mínimo, el rechazo es un resultado válido y se informa.

## 7. Lo que La Taba supone hoy y la documentación no contradice

| Supuesto | Estado |
|---|---|
| `external_reference = taba2:checkout:<uuid>` (lleva `:`) | sin regla de formato publicada; Mercado Pago lo aceptó en QA (preferencias, búsqueda y pago aprobado). Si el proveedor lo exigiera, la preferencia falla con 400 y no se cobra |
| `init_point` (nunca `sandbox_init_point`) en producción | consistente con la documentación; sin cita explícita |
| Sin `marketplace_fee` | no contradicho; es opcional |
| `notification_url` por preferencia | soportado; prioridad sobre el panel |

## 8. Lo que sólo Mercado Pago o una prueba real puede responder

1. Si la activación de credenciales productivas tiene una revisión o demora ocultas.
2. Si el vendedor necesita un nivel de verificación para recibir pagos de marketplace.
3. Qué token y permiso exige el reembolso, y qué significa el 401 código 7 en una cuenta real.
4. Cómo se devuelven las comisiones al reembolsar.
5. Si el dinero «a liberar» alcanza para una devolución, y la visibilidad por API de una devolución hecha desde el panel (ésta ya probada en QA).
6. Si el comprador puede ser el dueño de la aplicación integradora o el propio vendedor.
7. El importe mínimo y el plazo de liberación inicial de la cuenta de Walter.
8. Límites de `external_reference` y los scopes OAuth fuera de `read`, `write` y `offline_access`.

Ninguna bloquea el piloto: cada una se resuelve **con el primer pago y la primera devolución reales** (que están hechos para eso) o con una consulta al soporte de Mercado Pago.
