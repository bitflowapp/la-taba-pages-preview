# Firefox motion review

Firefox 150.0.2 / Playwright 1.60.0.

- Suite motion: 3/3.
- Home ? b?squeda ? producto ? carrito ? checkout: aprobado.
- Dialog por teclado Enter/Escape y cierre por bot?n: foco restaurado.
- Sticky header, filtros, contador, toast aria-live: aprobados.
- IntersectionObserver: 1; MutationObserver: 1.
- Responsive mobile 390?844 y desktop 1440?900: sin overflow ni reveals activos invisibles tras scroll.
- Reduced motion: sin transformaciones, animaciones ni contenido activo invisible.
- Loops permanentes: ninguno fuera de skeletons.

## M?tricas

- desktop-home: overflow=0; invisible=0; infinite=0
- desktop-flow: overflow=0; invisible=0; infinite=0
- mobile-home: overflow=0; invisible=0; infinite=0
- mobile-reduced-motion: overflow=0; invisible=0; infinite=0
