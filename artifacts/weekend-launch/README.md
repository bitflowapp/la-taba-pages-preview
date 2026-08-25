# Evidencia de la auditoría de lanzamiento — 2026-08-25

Nueve capturas, todas tomadas con un navegador real. Las de producción son de
`la-taba.pages.dev` con el runtime **v86**, o sea el estado ANTES de esta rama;
las locales muestran los arreglos de esta rama contra los datos reales de
producción.

| archivo | qué muestra | dónde se tomó |
|---|---|---|
| `home-android-390x664.png` | la primera pantalla: marca, delivery, buscador, categorías y **Recomendados del local** con foto, precio y «Agregar» a y=470 px | producción · Chromium · 390×664 |
| `home-iphone-390x664.png` | la misma pantalla en WebKit, píxel por píxel equivalente | producción · WebKit · 390×664 |
| `carrito-completo-chromium.png` | el carrito entero. Se ve la píldora **«Delivery» a media caja** (D2) y el resumen con **«Envío a domicilio $ 0»** (§1.1) | producción · 390 px |
| `stress-A-sin-perfil.png` | **el defecto más caro (D1)**: tocar «Confirmar pedido» sin perfil contesta «Ingresá un nombre de al menos 2 caracteres» en una pantalla que no tiene campo de nombre | producción · 390 px |
| `checkout-listo-chromium.png` | el checkout con perfil y dirección confirmada: 0 errores de consola, 0 respuestas ≥ 400 | producción · 390 px |
| `local-ficha-pack.png` | **D3 arreglado**: la ficha del pack x12 dice «$ 17.100» y debajo «**$ 1.425 por botella**» | local · datos reales de producción |
| `local-carrito-una-opcion.png` | **D2 arreglado**: con una sola opción de entrega, la píldora ocupa el renglón (322 px de 332) | local |
| `panel-negocio.png` | el Panel del negocio como lo abre el comercio, con el tablero y las alertas | producción · 1280 px |
| `panel-horarios-cobertura.png` | *Horarios y cobertura*, con el renglón de auditoría **«El servidor editó envío y mínimo … envío — → 0 · mínimo — → 0»** | producción · 1280 px |

Las mediciones numéricas —tiempos, desbordes, objetivos táctiles, precios por
litro— están en `LANZAMIENTO-COMERCIAL-FIN-DE-SEMANA.md`, que es el informe.
