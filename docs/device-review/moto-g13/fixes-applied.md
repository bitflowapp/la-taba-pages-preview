# Correcciones aplicadas

| Área | Corrección |
| --- | --- |
| Estado local | Se elevó la versión de datos, se migra catálogo base sin borrar carrito/pedidos compatibles y se sanea la simulación heredada. |
| Service worker | Caché versionada, entrada JavaScript revisada, bypass del caché HTTP al revisar el worker, detección de worker pendiente, actualización explícita y estrategia de red primero para assets publicados. |
| Cliente | Recompra sandbox no repuebla datos personales si el cliente no eligió recordarlos. |
| Tracking | Sin ruta no hay avance ni ETA ficticios; GPS fresco y GPS vencido tienen presentaciones distintas; recorrido de muestra usa copy honesto. |
| Mapa | La moto SVG conserva contraste y se separa del destino al llegar en ruta de muestra. |
| Rider | Estados de GPS y CTA de entrega son mutuamente coherentes. |
| Sincronización | BroadcastChannel y `storage` continúan como vías primarias; foco/visibilidad rehidratan el snapshot persistido cuando Android reanuda una pestaña. |
| Arranque | La superficie de compra se renderiza antes de esperar IndexedDB; una base bloqueada conserva una sesión sandbox explícita en memoria en vez de dejar una pantalla vacía. |
| Mobile | Se ocultó scrollbar de categorías sin quitar navegación táctil y se mantuvieron CTA por encima de la navegación del sistema. |

Las modificaciones permanecen aisladas del modo sandbox. El modo sin `?demo=1` continúa fail-closed y no usa datos ni ruta local como fallback.
