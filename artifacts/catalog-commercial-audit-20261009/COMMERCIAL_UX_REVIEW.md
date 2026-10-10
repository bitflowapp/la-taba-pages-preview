# COMMERCIAL_UX_REVIEW — dónde la tienda convierte y dónde pierde una venta

Alcance: lo que un cliente ve y toca en `https://la-taba.pages.dev/` (producción observada el
2026-10-09, service worker `v144`) y en la rama `fix/catalog-promotions-purchase-audit-20261009`
(`main` `0b7f5427` + esta corrección). Todo lo que figura abajo está medido; lo que es opinión
está marcado como **recomendación** y no se implementó.

## Lo que ya funciona (y no se tocó)

- **La góndola vende.** 34 de 34 productos comprables se agregan con un toque, desde la tarjeta o
  desde la ficha, con el precio de la fila y sin líneas fantasma (Chromium 390, WebKit-emulado 390,
  Chromium 1440). Los 17 que no se pueden comprar son alcohol sin habilitar y lo dicen en el botón.
- **Identidad visual.** El rojo ambiental, el tema oscuro y el vidrio líquido se conservaron; la
  corrección usa los mismos tokens (`--taba-red`, `--radius-pill`) y la banda sigue midiendo lo que
  la puerta editorial a la que reemplaza.
- **Honestidad.** Ninguna superficie inventa stock, descuentos ni sustitutos: las dos campañas sin
  producto (Heineken, Aperol) están apagadas y no se ven; los combos no se ofrecen porque ninguno
  se arma con el catálogo publicado.

## Cambios con impacto comercial demostrable (implementados)

| # | Qué cambia | Por qué importa | Medido |
|---|---|---|---|
| 1 | La pieza promocional lleva «**+ Agregar**» y la cantidad. | La pieza ya mostraba foto y precio: prometía una venta y pedía dos toques extra y un cambio de pantalla para cumplirla. | Toques hasta el carrito: **3 → 1** (`VIDEO/`). |
| 2 | En el teléfono el control es un botón (rojo, relieve, 44 px al dedo), no un texto coral de 13 px. | «Ver Red Bull →» sin forma de botón se lee como un anuncio, no como una compra. | Alto visible 26 px, área tocable 44 px (prueba `catalog-commercial-coverage`). |
| 3 | El precio y «Agregar» están a la vista desde el primer cuadro de la animación. | Antes el precio llegaba al 28–44 % de la escena: se podía tocar la pieza antes de ver cuánto salía. | `[data-motion-campaign="on"].cmp--buyable .cmp-price { animation: none }`. |
| 4 | Ocultar ya no pisa la foto. | Un toque torpe en la foto *hacía desaparecer la promoción durante toda la visita*, sin deshacer. | Solape 14×30 px → 0 px a 360/390/430. |
| 5 | Los filtros ofrecen sólo opciones del rubro. | En «Energizantes» (5 productos) el filtro de marca ofrecía 29 marcas: elegir una ajena dejaba una pantalla vacía armada por el propio cliente. | 29 → 3 marcas en Energizantes, 29 → 2 en Mixers, 29 → 5 en Gaseosas. |

## Recomendaciones (no implementadas; requieren decisión del comercio o datos)

1. **Alcohol en la home.** «Selección del local · Bodega y destilados» muestra una tarjeta por
   rubro (hoy 3: vinos, fernet y aperitivos) con foto, precio y un botón «Próximamente»
   deshabilitado, al final de la home. Es honesto, pero es la única sección donde el 100 % de las
   tarjetas no se puede tocar para comprar. Mientras la habilitación de expendio no esté cargada,
   considerar una sola línea de aviso en vez de varias tarjetas deshabilitadas (decisión
   comercial: no se tocó).
2. **Packs de 6 con stock 0** (Andes, Brahma, Budweiser, Stella): aparecen en «Cervezas» con «No
   disponible». Si no hay fecha de reposición, ocultarlos del rubro reduciría ruido. Dato de stock
   del comercio, no frontend.
3. **Foto de tarjeta.** La miniatura es de 400×400 y la tarjeta la pinta a ~154 px: alcanza en
   pantallas 2×; en 3× queda blanda. No hay defecto de carga (102/102 archivos http 200). Mejora
   posible, sin urgencia: `srcset` con la maestra de 1000 px para ≥3×.
4. **Precarga de la banda de cervezas.** `index.html` precarga `assets/promos/cervezas-heineken-band.webp`
   (alta prioridad) en cada visita al teléfono aunque la banda no se pinta mientras las cervezas
   no se puedan comprar: 1 pedido de alta prioridad y una advertencia en consola por visita. Requiere
   tocar el contrato de tres lugares (`tests/home-hero-preload.test.mjs`).
5. **Campañas nuevas.** Las 3 campañas encendidas son editoriales sin precio propio. Si Walter
   quiere promociones con condición de precio, el contrato existe (`core/promotions.js`) pero hoy
   producción no tiene ninguna activa: no hay píldora «Promos» ni filtro con opciones. Es una
   decisión comercial, no un defecto.

## Preguntas del encargo, respondidas

| Pregunta | Respuesta |
|---|---|
| ¿Se entiende qué productos se venden? | Sí en las tarjetas (nombre, presentación, precio, botón). La sección de alcohol vende «Próximamente»: se entiende, no se compra. |
| ¿Es fácil encontrar lo que uno busca? | La búsqueda trae lo esperado en las 15 consultas probadas (ver `FINDINGS.md`). Los filtros ya no ofrecen opciones sin resultado. |
| ¿Se entiende qué es una promoción? | Las piezas son editoriales (sin descuento) y ahora se comportan como lo que parecen: un producto con precio y un botón. |
| ¿La imagen parece clickeable cuando no lo es? | No: toda imagen de producto abre su ficha; las escenas animadas son decorativas y no reciben toques. |
| ¿Hay elementos que parecen funcionales y no hacen nada? | Antes: el rótulo «Ver …» del teléfono (sí hacía algo, pero no parecía un botón). Hoy: los botones «Próximamente» están deshabilitados y con nombre accesible «no disponible». |
| ¿Animaciones que interfieren con taps? | No: la escena es `pointer-events: none`; se verificó con `elementFromPoint` en tres momentos de la animación. |
| ¿Las promociones ayudan a vender? | Ahora sí pueden: antes la acción de la pieza era «mirar». Efecto sobre ventas **no medido** (no hay analítica de conversión por superficie): recomendación de instrumentar toques a «Agregar» por superficie. |
