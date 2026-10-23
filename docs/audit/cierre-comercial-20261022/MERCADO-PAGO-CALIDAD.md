# Revisión del checklist oficial de Mercado Pago

Continuación del cierre sobre `36f24cab`, 22/10/2026 (Argentina).
Se consultaron `quality_checklist` y `notifications_history` del MCP oficial indicando expresamente la aplicación
de QA `2691240967769590`. No se usó una aplicación por defecto, no se pidieron credenciales y no se crearon
usuarios, webhooks, OAuth, pagos ni devoluciones. Supabase volvió a denegar `get_project` del QA exacto.

El checklist devolvió 14 requisitos y 22 recomendaciones. Se revisan **todos**, sin convertir recomendaciones
de conversión o marketing en obligaciones de reconstruir la aplicación. Los estados describen código;
ninguno constituye evaluación oficial de un pago ni homologación. `Missing` indica ausencia de implementación
en la integración inspeccionada, no necesariamente un requisito obligatorio para aceptar pagos.

Abreviaturas de evidencia, con líneas verificadas sobre `36f24cab`:

- **P:** `supabase/functions/_shared/mercadopago.ts`, constructor de preferencia, líneas 69–130.
- **W:** `supabase/functions/mercadopago-webhook/index.ts`, validación y persistencia de receipts.
- **L:** `supabase/functions/mercadopago-payment-worker/index.ts`, worker y ledger independiente.
- **R:** `js/payments/payment-recovery.js`, estados y acciones del comprador.
- **SQL:** `supabase/migrations/20260908190758_a1_attempt_authority_expand_v2.sql`, líneas 184–211:
  combos al precio promocional y unidades ajenas a combos. No se cobran de nuevo sus componentes.

## Los 14 requisitos devueltos

| API name | Estado | Evidencia / alcance |
|---|---|---|
| `item_quantity` | Implemented | P:87, cantidades del snapshot SQL |
| `item_unit_price` | Implemented | P:89, importe del servidor; combos desde SQL |
| `statement_descriptor_/_soft_descriptor` | Missing | P no incluye descriptor; definirlo con el titular antes de enviarlo, sin inventar identidad de vendedor |
| `back_urls` | Implemented | P:113, URLs por resultado construidas en servidor |
| `webhooks_ipn` | Partial | P:112 envía notification_url; W valida firma. Recepción auténtica actual sin certificar |
| `external_reference` | Implemented | P:111, referencia de checkout persistida y conciliable |
| `email` | Missing | P no envía payer.email; no inventar correo de compradores anónimos |
| `payer_first_name` | Missing | P no envía payer.name; no separar arbitrariamente nombres de contacto |
| `payer_last_name` | Missing | P no envía payer.surname; mismo límite de identidad |
| `item_category_id` | Missing | P:83–90 no mapea taxonomía de proveedor; no adivinar IDs de categoría |
| `item_description` | Partial | P:86 conserva descripción si existe; la línea de envío no la tiene |
| `item_id` | Implemented | P:84 y SQL, identidad de producto/combo del snapshot |
| `item_title` | Implemented | P:85, título del producto o combo |
| `back_end_sdk` | Partial | SDK oficial en `_shared/mercadopago-webhook-signature.ts:1`; solicitudes financieras REST propias con timeout e idempotencia en P:133–170 |

## Las 22 recomendaciones devueltas

| API name | Estado | Evidencia / decisión de alcance |
|---|---|---|
| `binary_mode` | Missing | P no lo fuerza; el producto soporta pendientes. No eliminarlos para mejorar un indicador |
| `date_of_expiration` | Missing | Hay vencimiento de preferencia (P:119–121), no fecha separada del pago offline. Verificar comportamiento auténtico si el comercio ofrece tickets |
| `marketing_information` | Missing | P sin píxeles/anuncios; fuera del cierre financiero |
| `expiration` | Implemented | P:119–121, ventana de la preferencia |
| `max_installments` | Implemented | P:80–81, límite configurado por servidor |
| `modal` | Missing | Se usa redirección; modalidad elegida, sin obligación de agregar un modal |
| `logos` | Partial | El checkout identifica Mercado Pago por nombre; no se certificó un recurso de logo oficial en la superficie inspeccionada |
| `response_messages` | Implemented | R:44 y estados de revisión/devolución; resultado derivado del servidor |
| `excluded_payment_methods` | Missing | No hay lista por ID de medio individual en P |
| `excluded_payment_types` | Implemented | P:78, tickets excluidos cuando no se permiten pagos offline |
| `shipment_amount` | Partial | P:93–105 cobra el envío como línea diferenciada; no usa shipments.cost. No duplicar cargos agregando ambos |
| `payment_get_or_search_api` | Implemented | P:219 y P:257/311; W y L releen el proveedor |
| `chargebacks_api` | Partial | P:430–437 lee contracargos/reclamos; sin flujo de carga de documentación de disputa. Gestión manual del titular en MP |
| `cancellation_api` | Implemented | `mercadopago-cancel-payment/index.ts:64–65`, PUT condicionado por estado |
| `refunds_api` | Implemented | `mercadopago-refund/index.ts:81–83`, POST con idempotencia; reconciliación por identidad |
| `settlement` | Missing | El ledger de pagos no es un reporte de saldo disponible o liquidaciones del proveedor |
| `release` | Missing | Sin importación del reporte contable del proveedor; tampoco equivale al ledger por actualización |
| `address` | Missing | P no incluye payer.address, aun cuando el pedido pueda contener dirección de entrega |
| `payer_identification` | Missing | Sin envío de documento; no añadir datos supuestos |
| `payer_phone` | Missing | P no incluye payer.phone |
| `payer_identification_mlm` | Partial | Criterio de México, no aplicable al flujo argentino; no agregar identificación mexicana |
| `front_end_sdk_pro` | Missing | Redirección a init_point sin SDK JS de checkout; no reimplementar por una recomendación aislada |

## Piso de seguridad transversal

| Control | Resultado en código |
|---|---|
| Tokens en servidor | P:143–146; OAuth por negocio. No credenciales en el navegador |
| Entornos ignorados por Git | `.gitignore:3–7`; plantillas example permitidas |
| HMAC webhook | W:42–56, SDK oficial sobre data.id de query; no confiar en el body aislado |
| HTTPS | `request-protocol.ts` y constructores del servidor; sin URLs de retorno del cliente |
| Validación tras retorno | `mercadopago-checkout-status/index.ts`, busca el recurso desde el servidor |
| Idempotencia | P:147; refund/index.ts:83; pruebas SQL y Deno del cierre anterior |
| Referencia externa | P:111 y conciliación por checkout |
| Separación de QA/producción | `recovery-deployment.ts`; proyecto/aplicación fijados; no se modificó producción |
| Host de checkout | `mercadopago-create-preference/index.ts:167` elige init_point. sandbox_init_point sólo permanece por compatibilidad de datos; no se usa como redirect |

## Diagnóstico auténtico de notificaciones, con límites

El MCP informó **1 notificación analizada, 0 exitosas, 1 fallida HTTP 502**, del 21/10/2026 a las 13:25 según
el diagnóstico (sin zona horaria indicada), topic `topic_merchant_order_wh`. No devolvió la URL de destino ni
una firma validada. Por eso no se atribuye el fallo al preview actual y no se lo cuenta como prueba de pago,
de una entrega ni del webhook de QA. Tampoco demuestra el estado actual del secreto del webhook.
El flujo OAuth actual procesa Payments; no cambiar topics ni destinos a ciegas por esta entrada histórica.
El titular deberá comparar destino, topic y logs de esa entrega con la configuración de su app durante la ronda autorizada.

`quality_evaluation` quedó sin ejecutar: no hay un payment_id de prueba reciente autorizado para evaluar.
No se envió un formulario de homologación ni se certificó ningún GO. Los campos de identidad y descriptor
requieren datos reales y decisión del titular; no se inventaron para aparentar cobertura.

Referencias de consulta: [preferencias oficiales](https://www.mercadopago.com/developers/es/docs/checkout-pro-preferences/create-payment-preference),
[vigencia de preferencias](https://www.mercadopago.com/developers/es/docs/checkout-pro-preferences/additional-settings/term-of-preference).
