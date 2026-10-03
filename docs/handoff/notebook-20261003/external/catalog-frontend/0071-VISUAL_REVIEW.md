# Revisión visual — rediseño rojo

Fecha: 2026-08-02. Navegador: Chromium local controlado por Playwright; Edge no estaba instalado en las rutas estándar del equipo.

## Capturas finales

Las capturas fueron producidas con el servidor oficial y Chromium real:

- `home-320x568.png`
- `home-390x844.png`
- `home-430x932.png`
- `home-768x1024.png`
- `home-1280x900.png`
- `checkout-390x844.png`
- `perfil-390x844.png`
- `seguimiento-390x844.png`
- `negocio-390x844.png`
- `rider-390x844.png`

Todas están en [capturas-finales](capturas-finales).

## Resultado de la revisión

- La marca “La Taba” mantiene una sola línea a 320 px; el acceso de dirección se compacta allí para evitar competir con el carrito.
- El hero rojo conserva legibilidad, CTA y jerarquía. Las categorías muestran texto contrastado además de iconos.
- Header, catálogo, tarjetas, navegación inferior y carrito sticky mantienen el lenguaje rojo sin cubrir el contenido.
- Checkout, Perfil, seguimiento, negocio y rider permanecen operativos y legibles en la captura de 390×844.
- Los precios mostrados conservan el formato ARS.

## Accesibilidad y comportamiento

La suite E2E final cubrió y aprobó: overflow horizontal en los viewports requeridos, reserva dinámica bajo la CTA, safe-area, scroll fantasma, controles táctiles, foco/acciones de UI, navegación por teclado de los formularios, y controles editables a 16 px para iOS. Las reglas visuales finales preservan foco visible y contraste: texto oscuro sobre superficies claras, rojo de marca sobre blanco y texto claro sobre el tramo oscuro del hero.

No se detectó overflow horizontal, autozoom iOS, scroll fantasma ni superposición del carrito sobre el último contenido durante la revisión y los tests finales.
