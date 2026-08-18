# Postura de pago · el piloto no cobra nada

## Lo que hay en producción

| | |
|---|---|
| `business_payment_settings` | **0 filas** — no hay Mercado Pago, ni PROD ni TEST |
| `payment_intents` · `checkout_sessions` | **0** · **0** |
| MP PROD | **no configurado, y no se configura acá** |

## Los métodos que el contrato acepta

`orders_payment_method_valid`: `mercadopago`, `cash`, `coordinate`, `qa_no_charge`.

| método | estado para este piloto |
|---|---|
| **`coordinate`** | **el que se usa.** «A coordinar con el local». Es la opción **por defecto** del checkout publicado, es un método real del producto y **no cobra nada automáticamente** |
| `mercadopago` | la opción **ni siquiera aparece** en el selector si el backend no reporta MP disponible (`setMercadoPagoCheckoutAvailability`), y el contrato exige un `payment_intent` verificado contra el proveedor para poder declararlo |
| `cash` | existe como segunda opción en el checkout **ya publicado**. No se promueve, no se toca y no es la principal |
| `qa_no_charge` | **imposible en un pedido real**: el CHECK `orders_qa_payment_method_requires_qa_origin` exige `origin='qa'`. No se expone |

## Conclusión

**No hace falta habilitar nada ni inventar ninguna integración.** El primer
pedido productivo se puede completar con `coordinate`, que es lo que el producto
ya ofrece primero.

**Nota honesta:** `cash` sigue apareciendo como segunda opción del selector
porque así está publicado desde antes de esta misión. Si la política es evitar
efectivo, sacarlo del `<select>` es un cambio de producto de una línea más su
prueba (`payment-methods-contract`), y no se hizo acá porque nadie lo pidió.
