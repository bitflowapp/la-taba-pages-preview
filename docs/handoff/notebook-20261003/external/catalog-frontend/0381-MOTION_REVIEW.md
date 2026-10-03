# Motion review TABA2

Evidencia generada en modo demo local, sin datos sensibles ni mutaciones de producción. La capa usa CSS y un controlador JS progresivo: revela sólo jerarquía y los primeros productos, mantiene el contenido visible cuando no hay IntersectionObserver y desactiva desplazamientos/escala con reduced motion.

## Capturas

- mobile-home-static.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- mobile-home-motion-end.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- mobile-product-pressed.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- mobile-cart-feedback.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- mobile-detail.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- mobile-checkout-loading.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- mobile-checkout-success.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=21; longtasks=0
- desktop-home.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- desktop-card-hover.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- desktop-search-open.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- desktop-filters-open.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- desktop-detail.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0
- desktop-cart.png: overflow 0px; motion-ready=true; reduced-motion=false; reveal-targets=20; longtasks=0

## Interacciones revisadas

- Hover/press de cards y botones: transformaciones de 1–2 px o escala 0,97, sin cambio de layout.
- Agregado al carrito: toast accesible, contador y feedback visual basado en el estado real.
- Detalle: entrada corta de dialog y restauración de foco.
- Checkout: data-motion-busy sólo durante la solicitud real; la captura de loading usa un fixture visual local y no confirma pedidos.

## Resultado

- Overflows detectados: 0.
- Tareas largas observadas durante capturas: 0.
- Promociones/precios/catálogo: sin cambios.
