# Recorrido de cliente físico

La prueba se realizó en Chrome normal del moto g15, con datos de compra sintéticos y sin usar herramientas sandbox para la primera compra.

## Recorrido aprobado

1. La pantalla inicial explicó qué se puede pedir y mostró búsqueda, categorías y CTA de catálogo.
2. El catálogo mostró los 14 productos; las 12 imágenes comerciales cargaron y los dos casos sin asset aprobado conservaron placeholder neutro.
3. Búsqueda, categorías y apertura de producto respondieron con una mano, sin scroll horizontal involuntario.
4. Se agregaron Coca-Cola Original 1,5 L x6 y Heineken Original 473 ml; el carrito permitió modificar cantidades y volver a comprar.
5. El checkout indicó los campos requeridos, el aviso de mayoría de edad para alcohol y el resumen antes de confirmar.
6. Se creó un pedido sandbox y se abrió Seguimiento sin exponer controles operativos al cliente.
7. Se comprobó volver atrás, recargar, cerrar/reabrir Chrome y recompra. El pedido y carrito compatibles persistieron.

## Observaciones de uso

- Los CTA inferiores quedaron por encima de la navegación Android y no taparon los controles de cantidad ni el checkout.
- El teclado no ocultó el campo en foco ni la acción de continuidad durante la carga manual del formulario.
- Las tarjetas mantienen nombre, formato y precio legibles en el viewport físico.
- La barra de categorías no exhibe scrollbar nativo; sigue siendo desplazable al tocar/arrastrar.

Capturas seleccionadas: `final/home.png`, `final/catalog.png`, `final/product.png`, `final/cart.png` y `final/order-confirmed.png`.
