# Pedido sintético

- No se creó un pedido nuevo `PEDIDO QA GPS`: el precheck posterior no permite aislarlo.
- `LT-0007` fue investigado y clasificado como `CONFIRMED_SYNTHETIC_STALE_ORDER`.
- Se cerró exclusivamente mediante RPC canónica `change_order_status`, de `on_the_way` revisión `9` a `cancelled` revisión `10`.
- La cancelación preservó auditoría, no usó UPDATE directo ni código de entrega, purgó las ubicaciones GPS y dejó stock/reservas sin cambio.
- No se usaron Mercado Pago ni ARCA.
