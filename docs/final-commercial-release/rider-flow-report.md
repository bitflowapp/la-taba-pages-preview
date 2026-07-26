# Flujo del rider

## Revelado progresivo

Antes de aceptar se muestran únicamente:

- sucursal de retiro;
- zona general;
- forma de cobro;
- unidades;
- importe a cobrar;
- CTA `Aceptar entrega`.

No se muestra nombre, teléfono, calle, referencia ni detalle del pedido. En
producción, la aceptación ejecuta `claim_available_rider_order` con sesión y
membresía rider, estado esperado y rider esperado nulo. Una carrera concurrente
tiene un solo ganador.

Después de aceptar se habilitan retiro, datos autorizados del cliente, dirección,
navegación externa, contacto, cobro y la siguiente acción. La vista no presenta
todas las etapas al mismo tiempo.

## Entrega comprobada

1. El rider acepta el pedido listo.
2. Confirma que sale del local.
3. El GPS sólo puede iniciarse con el pedido asignado y en estado operativo.
4. El cliente recibe únicamente una ubicación fresca y minimizada.
5. El rider confirma llegada.
6. El cliente ve el código de cuatro dígitos sólo durante la entrega.
7. El rider valida el código con bloqueo progresivo ante intentos fallidos.
8. Confirma la entrega.
9. Se detiene GPS, se purgan puntos exactos y desaparece el acceso sensible.

La foto de entrega es opcional, se comprime localmente, no debe incluir personas,
documentos ni datos privados y no sustituye al código.

## Honestidad de geolocalización

- Sin un fix GPS real y fresco no se monta el mapa.
- No existe ruta dibujada sin puntos reales o proveedor configurado.
- No se calcula distancia ni ETA local.
- El marcador es un SVG local de moto, neutro y accesible.
- Cambiar de rider o finalizar el pedido revoca el acceso a la ubicación.

## Evidencia

- `*-09-rider-before-accept.png`.
- `*-12-rider-delivering.png`.
- `videos/tracking-flow.webm`.
- `videos/business-rider-delivery.webm`.
- Pruebas de claim CAS, roles, GPS fresco/vencido, handoff y revocación.
