# Requisitos operativos para alcohol

Estado: base técnica preparada; reglas legales y comerciales pendientes de
validación local antes de staging habilitado y producción.

## Controles técnicos

- `is_alcoholic` y `minimum_age` por producto.
- Política por comercio: habilitación, edad mínima, inicio/fin y zona horaria.
- Si falta cualquier valor, la venta de alcohol debe fallar cerrada.
- El checkout debe exigir confirmación explícita cuando el carrito contiene
  alcohol y guardar sólo timestamp + versión/edad de política.
- La entrega debe mostrar “verificar edad” al rider.
- No se almacena número, foto ni escaneo de DNI.

## Requiere decisión humana

Un asesor/legal y el dueño deben confirmar jurisdicción, edad mínima, días y
horarios, modalidades permitidas, texto del aviso, procedimiento de rechazo,
devolución/cancelación y quién asume el costo. También deben decidir si el rider
puede entregar a una persona distinta de quien compró.

Hasta completar esa aprobación: `alcohol_sales_enabled=false` y productos
alcohólicos `available=false`.

## Antiabuso y reservas

Los límites por usuario/sesión/IP, máximo pendiente, reserva y abandono son
configurables. No hay defaults arbitrarios. La limpieza de reservas se ejecuta
mediante `release_expired_stock_reservations` desde un scheduler confiable; la
función no está concedida a roles del navegador. Los eventos guardan hashes, no
IP, teléfono, email ni dirección. CAPTCHA queda como integración externa y debe
marcarse obligatorio si el análisis de staging detecta abuso.
