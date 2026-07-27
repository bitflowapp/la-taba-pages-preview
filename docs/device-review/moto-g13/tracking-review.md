# Revisión física de seguimiento

## Ruta de muestra

Se completó el circuito cliente → local → rider → seguimiento → código → entrega en el dispositivo físico.

- El mapa Leaflet cargó calles y atribución de OpenStreetMap/CARTO.
- Comercio, destino y moto se distinguieron por icono, color y posición.
- El icono de moto es SVG local: vehículo lateral, caja de delivery y casco abstracto, sin rostro ni avatar.
- En ruta, el estado mostró `En camino`, avance menor a 100 % y ETA positiva.
- En destino, el estado pasó a `Llegó al domicilio`, avance 100 % y ETA `Llegó`; no se mostró `0 min` ni `En camino` a la vez.
- Tras confirmar el código y entregar, se ocultó ETA y el seguimiento se detuvo. La recarga mantuvo `Entregado`.

## GPS local

En el moto g15 se probaron ambos resultados del permiso de Android:

- Denegado: el rider recibió un estado claro de ubicación no disponible, sin inventar ETA ni recorrido.
- Concedido: `watchPosition` entregó una fijación local con precisión y marca temporal; el mapa de Tracking de otra pestaña de Chrome se actualizó con la última fijación fresca.

La posición exacta se omitió deliberadamente de capturas y reportes. Al desactivar ubicación, entregar el pedido o abandonar la vista rider, el watcher se detuvo. Una fijación vencida se presenta como no disponible, no como ubicación en vivo.

## Sincronización

Los cambios de ruta, pausa, reanudación y entrega se reflejaron entre pestañas del mismo Chrome. Además, al regresar a una pestaña que Android había dejado en segundo plano, esta rehidrata IndexedDB para recuperar el estado más reciente sin recargar manualmente.

No hay sincronización entre dispositivos distintos sin backend.

Capturas seleccionadas: `final/tracking-route-active.png`, `final/tracking-arrived.png`, `final/rider-confirm-code.png` y `final/tracking-delivered.png`.
