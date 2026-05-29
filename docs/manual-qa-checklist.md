# La Taba - Manual QA Checklist

Usar esta lista cuando no se ejecute un navegador automatizado.

## Base

- Abrir `http://localhost:8080/`
- Confirmar que la home carga sin errores visibles
- Confirmar que el diseño se mantiene en tema oscuro premium
- Confirmar que no haya saltos horizontales al hacer scroll

## Cliente

- Ver catálogo
- Filtrar por categoría
- Abrir detalle de producto
- Agregar al carrito
- Aumentar cantidad
- Reducir cantidad
- Intentar superar el stock
- Quitar producto
- Vaciar carrito
- Ir a finalizar pedido
- Elegir envío a domicilio
- Probar validación sin nombre
- Probar validación sin teléfono
- Probar validación sin dirección
- Probar pedido mínimo
- Completar datos válidos
- Elegir método de pago
- Agregar notas
- Generar pedido
- Revisar que el mensaje de WhatsApp incluya pedido, cliente, teléfono, entrega, dirección, productos, subtotal, envío, total, pago, notas y fecha
- Copiar pedido
- Revisar seguimiento del último pedido

## Retiro en local

- Elegir retiro en local
- Confirmar que no cobre envío
- Confirmar que no exija dirección
- Generar pedido
- Revisar mensaje de WhatsApp de retiro
- Confirmar total correcto

## Modo negocio

- Verificar que el panel no aparezca en la navegación normal
- Ingresar PIN incorrecto
- Ingresar PIN `1234`
- Ver dashboard
- Ver pedidos
- Cambiar estado
- Cancelar pedido
- Subir stock
- Bajar stock
- Activar/desactivar producto
- Revisar productos con bajo stock
- Cerrar modo negocio

## Delivery

- Confirmar que solo tome pedidos con envío a domicilio
- Confirmar que no tome pedidos de retiro
- Marcar salida del local
- Marcar pedido entregado
- Confirmar progreso visual

## Mobile

Probar en anchos aproximados:

- `390px`
- `430px`
- `768px`

Revisar:

- Overflow horizontal
- Botones tocables
- Textos no cortados
- Carrito cómodo
- Finalizar pedido claro
- Modal de producto usable
- Panel negocio usable
- Panel delivery usable

## Accesibilidad básica

- Botones con texto claro
- Inputs con labels visibles
- Foco visible
- Errores visibles
- Modales cerrables
- Navegación por teclado razonable

## Consola

- Sin errores JavaScript
- Sin imports fallidos
- Sin 404 de assets
- Sin errores del service worker
