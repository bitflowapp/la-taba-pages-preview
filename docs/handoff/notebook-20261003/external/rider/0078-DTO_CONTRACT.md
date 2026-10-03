# Task 03 - Contrato de DTO y bridge

Fuente de nombres: `BACKEND_CONTRACT.md` y migraciones existentes del backend.
No se modificó el backend.

## Disponible

RPC exacta:

```text
POST /rest/v1/rpc/list_available_rider_orders
{"p_business_id":"<business uuid>"}
```

La respuesta es un array de hasta 50 filas. Kotlin y Dart aceptan `revision`
como número o string porque Supabase/PostgREST puede representar un `bigint`
de ambas maneras.

| Clave | Tipo esperado | Null | Exposición Flutter |
|---|---|---:|---|
| `public_code` | text | no | sí |
| `general_zone` | text | sí | sí |
| `pickup_branch` | text | sí | sí |
| `approximate_packages` | integer positivo | no | sí |
| `payment_method` | text | sí | sí |
| `collection_amount` | numeric decimal | sí | sí como dato monetario del contrato |
| `estimated_minutes` | integer positivo | sí | sí |
| `operational_restrictions` | text | sí | sí |
| `revision` | bigint positivo | no | sí |

El RPC no devuelve `currency_code`. La implementación conserva el valor
decimal sin convertirlo a `double` y lo presenta como ARS según el alcance de
producto. Esto requiere aprobación si el negocio puede operar en monedas
distintas: la opción segura sería agregar moneda al contrato o no renderizar
`collection_amount`.

El estado de una fila disponible no viaja en la respuesta: por contrato el RPC
filtra `delivery_mode=delivery`, `status=ready` y rider asignado nulo. El
modelo lo representa como `OrderStatus.ready`, sin crear un estado nuevo.

## Recuperación asignada

Request PostgREST autorizado:

```text
GET /rest/v1/orders
  ?select=id,public_code,status,revision,delivery_mode,address_label,
    customer_street_address,customer_neighborhood,customer_reference,
    customer_notes,payment_method,subtotal,delivery_fee,total,currency_code,
    order_items(name,quantity,unit,unit_price)
  &business_id=eq.<business uuid>
  &assigned_rider_user_id=eq.<auth uid>
  &status=in.(assigned,picked_up,on_the_way,arrived)
  &order=updated_at.desc
  &limit=1
```

Se espera array vacío o exactamente una fila. Más de una fila es una
respuesta inválida para este shell y se rechaza.

| Clave | Tipo esperado | Null | Exposición Flutter |
|---|---|---:|---|
| `id` | UUID | no | no; sólo validación nativa |
| `public_code` | text | no | sí |
| `status` | `assigned`, `picked_up`, `on_the_way`, `arrived` | no | sí |
| `revision` | bigint positivo | no | sí |
| `delivery_mode` | `delivery` | no | validación |
| `address_label` | text | sí | sí |
| `customer_street_address` | text | sí | sí en detalle asignado |
| `customer_neighborhood` | text | sí | sí |
| `customer_reference` | text | sí | sí |
| `customer_notes` | text | sí | sí |
| `payment_method` | text | sí | sí |
| `subtotal` | numeric decimal | sí | sí como ARS |
| `delivery_fee` | numeric decimal | sí | sí como ARS |
| `total` | numeric decimal | no | sí como ARS |
| `currency_code` | `ARS` | no | validación |
| `order_items` | array | no | sí, sólo nombre/cantidad/unidad/precio |

Los item fields `product_uuid` y `product_id` no se solicitan en la lectura
PostgREST. Si aparecieran en una respuesta futura, el parser los ignora y no
los transporta.

## Estados canónicos

El conjunto del dominio conserva el vocabulario backend existente, pero la
superficie de Task 03 sólo acepta:

```text
ready
assigned
picked_up
on_the_way
arrived
```

`40001` se clasifica como conflicto/revisión vieja y no se transforma en un
estado inventado.

## Errores

El bridge sólo puede devolver keys estables: `network_unavailable`,
`session_expired`, `rate_limited`, `orders_invalid_response`,
`orders_duplicate_response`, `orders_revision_conflict`,
`rider_access_required`, `orders_not_found` y `orders_unsupported_currency`,
entre otras categorías sanitizadas. Nunca atraviesa body, mensaje SQL crudo,
Authorization header, tokens o UUID internos.

## Dato staging observado

El listado real respondió correctamente. El pedido asignado existente en
staging devolvió `currency_code=USD`; el cliente lo rechazó con
`orders_unsupported_currency` para no rotularlo como ARS. No se modificó ese
pedido ni se hizo ningún write.
