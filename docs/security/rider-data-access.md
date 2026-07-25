# Acceso operativo de riders

- Sin asignación: `list_available_rider_orders` expone zona general, sucursal,
  paquetes aproximados, cobro necesario, ETA y restricciones. No expone nombre,
  teléfono, calle, referencia, notas ni GPS.
- Asignado y activo: RLS habilita el pedido sólo durante `assigned`,
  `picked_up`, `on_the_way` o `arrived`.
- Entregado, cancelado o reasignado: `can_access_order` deja de autorizar al
  rider. El equipo owner/admin/staff conserva acceso por su función operativa.
- GPS: sólo el rider asignado puede insertar fixes reales; el servidor estampa
  la hora. El público obtiene a lo sumo el último punto redondeado.

La auditoría autorizada debe realizarse con rol owner/admin y no extendiendo la
política del rider.
