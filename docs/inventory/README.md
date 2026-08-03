# Inventario y preparación

## Modelo autoritativo

`inventory_movements` es un ledger inmutable. Cada fila conserva producto, barcode opcional, tipo, cantidad base, stock anterior/resultante, factor, referencia, operador e idempotencia. Insertar, actualizar o borrar directamente desde el cliente está revocado; `apply_inventory_movement` bloquea el producto, valida el negocio y evita stock negativo.

Los tipos cubiertos son recepción de compra, ajuste manual, conteo físico, venta y reversas autorizadas. Una recepción por pack convierte `package_quantity × unit_factor` a unidades base. Ajustes, mermas y diferencias requieren motivo; un conteo muestra la diferencia antes de confirmarla y no ajusta en silencio.

## Operación

1. Escanear el código y verificar producto, presentación, factor y último stock conocido.
2. En recepción, informar cantidad de unidades/packs y referencia opcional.
3. En ajuste, elegir ingreso/egreso y escribir un motivo verificable.
4. En conteo, introducir el total físico. Si coincide, no se crea movimiento.
5. Confirmar y esperar respuesta del servidor. Offline queda pendiente; no mostrar “stock actualizado”.

POS revalora precio y stock dentro de `checkout_pos_sale`; pago, venta, items, movimiento y descuento de stock son atómicos. Un replay con la misma clave devuelve la misma venta sin descontar otra vez.

## Packing

Cada sesión fija pedido y revisión. Los scans registran producto, GTIN y factor. Se rechazan producto ajeno, exceso y scan duplicado; “deshacer” revierte sólo la última lectura activa. Una preparación incompleta exige owner/admin y motivo de excepción. Confirmar packing no inventa un cambio de estado del pedido fuera de su RPC.

## Recuperación y auditoría

Ante discrepancia, no editar `products.stock`: consultar el ledger por producto y referencia. Si una operación quedó pendiente local, reconciliar su idempotency key. Si el servidor confirmó pero la UI no recibió la respuesta, el reintento debe devolver el receipt previo.

Para rollback funcional se deshabilita la pantalla o el rol, no se borra el historial. Una corrección de stock se representa con otro movimiento autorizado y motivo. Restaurar base o migraciones requiere backup y una migración correctiva probada localmente.

