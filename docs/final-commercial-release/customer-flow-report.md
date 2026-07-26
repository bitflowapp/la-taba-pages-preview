# Flujo cliente

## Alcance verificado

La experiencia pública quedó reducida a una tienda de bebidas mobile-first. El
recorrido visible es marca, disponibilidad del local, contexto de entrega,
búsqueda, promoción, productos destacados, categorías y acceso al pedido. No
expone accesos a negocio/rider, PIN, diagnósticos ni nombres internos del modo de
presentación.

El preview comercial requiere `demo=1`. Es local, explícito y no envía pedidos a
Supabase. Sin esa bandera y sin un runtime productivo completo, la aplicación
falla cerrada y no reutiliza silenciosamente los datos del preview.

## Recorrido comprobado

1. El cliente abre TABA y entiende que compra bebidas con delivery o retiro.
2. Busca o filtra por las doce categorías canónicas.
3. Abre un producto, elige cantidad y puede agregar una observación.
4. Agrega al pedido desde una tarjeta con nombre, presentación, precio y
   disponibilidad breve.
5. En móvil usa una sola CTA persistente: `Ver pedido · $TOTAL`.
6. Completa delivery/retiro, nombre, teléfono, dirección cuando corresponde,
   pago y resumen.
7. Las indicaciones adicionales permanecen plegadas hasta que se solicitan.
8. La validación de mayoría de edad no existe en el DOM visible si el pedido no
   contiene alcohol; con alcohol aparece y es obligatoria.
9. Al confirmar, el pedido pasa a seguimiento sin abrir WhatsApp ni crear un
   pedido duplicado por doble toque.
10. Un cliente recurrente ve `Volver a pedir` antes de la promoción; un cliente
    nuevo no recibe una sección vacía.

## Estados cubiertos

- carga y catálogo bloqueado en producción;
- catálogo vacío y búsqueda sin resultados;
- producto disponible, pausado y agotado;
- carrito vacío;
- checkout inválido con error inline, foco y `aria-invalid`;
- local disponible/cerrado;
- pedido confirmado;
- seguimiento sin GPS, con GPS válido, vencido y entregado;
- token público inválido o vencido;
- error de red sin caída a preview.

## Evidencia

- `visual-review-round-1/`: 84 capturas, primera evaluación completa.
- `visual-review-round-2/`: 84 capturas, segunda evaluación completa posterior
  a las correcciones.
- `videos/customer-flow.webm`: catálogo → producto → pedido → checkout →
  confirmación.
- `videos/tracking-flow.webm`: estados → rider → GPS → código → entrega.

No se usaron precios, stock, GPS, ruta ni ETA como datos productivos. Los valores
del preview quedan aislados y producción continúa bloqueada hasta recibir un
catálogo aprobado.
