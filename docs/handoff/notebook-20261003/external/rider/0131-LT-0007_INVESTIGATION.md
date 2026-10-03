# Investigación read-only de LT-0007

Fecha de investigación: 2026-08-03. La consulta inicial fue read-only; la única acción posterior fue la RPC administrativa canónica indicada abajo, porque la procedencia sintética quedó confirmada.

## Clasificación

`CONFIRMED_SYNTHETIC_STALE_ORDER`

La clasificación no depende de que el cliente tenga campos con apariencia humana. La evidencia conjunta —lote QA histórico de siete pedidos, secuencia pública, productos `catalog_origin=demo_fixture`, auditoría de certificación anterior y ausencia de actividad operacional reciente— hace inequívoca la procedencia sintética.

## Identidad y creación

- `order_id`: `f852c551-d98e-4258-a4bf-40a6d8de111e`
- `business_id`: `00000000-0000-4000-8000-000000000001`
- Código público: `LT-0007`
- Creado: `2026-08-01T16:35:39.467856+00:00`
- Creado por: sujeto autenticado con rol `customer` (`b400f2fb-8583-4f90-98c0-323832319afc`), usado como identidad del fixture.
- Contrato: flujo canónico `create_order_with_items(jsonb)`, registrado por el evento inicial con `source=production_checkout`; no hubo INSERT directo.
- `client_request_id`: prefijo `web_`, consistente con checkout sintético del lote, no con el smoke GPS.

## Datos QA y datos del cliente

- El registro contiene nombre, teléfono, calle y barrio con forma humana, además de `customer_reference=Negocio`; no se copian esos valores en este informe.
- No hay nota `PEDIDO QA GPS`, tag QA ni nota de preparación/entrega en el pedido.
- La señal QA inequívoca está en el origen de los productos (`catalog_origin=demo_fixture`), en la secuencia LT-0001…LT-0007 auditada en la certificación Task 03 y en la cronología del lote.
- Items: dos unidades de Red Bull Energy Drink y una de Coca-Cola Original; stock observado antes/después: `96` y `97`.

## Rider y estado

- Rider asignado: Rider QA, `d1c72b84-1ab5-4a0a-989f-80f6843b609f`, membresía activa `rider`.
- Estado investigado: `on_the_way`, revisión `9`.
- Transiciones observadas: `accepted` → `preparing` → `ready` → `assigned` → `on_the_way`; hubo retiro/despacho, sin `arrived` ni `delivered`.
- Último evento antes del cierre: inicio hacia entrega (`order.status_changed` a `on_the_way`) el `2026-08-01T16:36:50.4383+00:00`, actor Rider.
- Última ubicación recibida antes del cierre: `2026-08-01T16:41:27.840468+00:00`, fuente `gps`; 19 muestras totales. La precisión registrada fue nula. No se incluyen coordenadas.
- No hubo operaciones de entrega ni outbox pendientes legibles para este pedido; el estado se mantuvo sin evento terminal.

## Payment y motivo de stale

- `payment_method=coordinate`.
- No existe una tabla pública de pagos/intent/transacción en el esquema autorizado y no hay payment asociado separado.
- No se usaron Mercado Pago ni ARCA.
- Continúa `on_the_way` porque el lote histórico quedó después de pickup/dispatch sin `arrived`, sin código de entrega y sin confirmación de entrega. El contrato no aplica una expiración automática que lo lleve a terminal; el `updated_at` histórico posterior corresponde a mantenimiento del lote, no a una entrega real.

## Certificación anterior y actividad

Sí. LT-0007 coincide inequívocamente con el lote de siete pedidos auditado en la certificación Android/Rider Task 03: misma ventana temporal, secuencia pública, productos demo fixture y estado activo persistente. La certificación registró tres pedidos activos asignados al Rider auditado; LT-0007 era uno de ellos. No hubo actividad reciente de GPS después del `2026-08-01T16:41:27.840468+00:00`.

## Acción canónica y verificación

Se ejecutó únicamente:

`change_order_status(p_order_id, 'on_the_way', 'cancelled')`

Resultado: estado `cancelled`, revisión `10`, evento `order.status_changed` de negocio en `2026-08-03T20:39:22.845884+00:00`, con metadata `previous_status=on_the_way`, `next_status=cancelled`, `inventory_released=false`.

Verificación posterior read-only:

- ubicaciones GPS del pedido: `0`;
- operaciones de entrega del pedido: `0`;
- outbox del pedido: `0`;
- locks tuple/relation sobre tablas operativas: `0`; advisory locks: `0`;
- stock: sin cambio (`96` y `97`); no hay tabla pública de reservas;
- `inventory_released_at`: `null`, correcto para una cancelación posterior al retiro: la RPC no inventa devolución física de mercadería;
- `get_active_rider_delivery()` del Rider QA ya no devuelve LT-0007.

La columna histórica `assigned_rider_user_id` permanece con el Rider QA para preservar auditoría; no existe entrega activa para ese pedido.

## Precheck posterior y continuidad

El precheck repetido volvió a encontrar interferencia operacional:

- Rider QA: `LT-0005` en `arrived`.
- Rider QA alternativo: `LT-0010` en `assigned`.
- Además, el negocio conserva `LT-0002`, `LT-0003`, `LT-0005`, `LT-0009` y `LT-0010` en estados activos.

Por lo tanto, no se creó un nuevo pedido QA, no se instaló el APK, no se inició GPS y el smoke físico no puede continuar de forma aislada con las credenciales QA autorizadas disponibles. Se requiere que el responsable operativo cierre/libere las operaciones restantes o proporcione un Rider QA limpio.
