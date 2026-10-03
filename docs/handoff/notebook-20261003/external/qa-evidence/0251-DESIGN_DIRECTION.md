# TABA — Dirección visual

## Decisión

**“Mostrador Patagónico”.** Superficies claras de papel cálido, tipografía de tinta, rojo TABA reservado exclusivamente a la acción y a la marca, neutros grises fríos como único guiño patagónico, y el producto como protagonista sobre blanco.

---

## Las dos direcciones evaluadas

### A · “Kiosco Nocturno” — descartada

Fondo grafito, rojo neón, packshots recortados con halo, alto contraste.

Argumentos a favor: coherente con bebidas alcohólicas y consumo nocturno; se diferencia de la mayoría del delivery argentino.

**Por qué se descarta — un motivo decisivo y tres de peso:**

1. **Los assets lo impiden.** Los 22 packshots de TABA son WebP con **fondo blanco horneado**, no transparente. Sobre superficie oscura, cada producto aparece dentro de un rectángulo blanco. Adoptar la dirección oscura obliga a **reproducir los 22 assets con canal alfa** antes de poder ver la primera pantalla real. Es un costo de producción de imágenes, no de CSS, y bloquea todo el resto del trabajo.
2. **Legibilidad exterior.** El rider trabaja al sol en Neuquén y el encargado mira el panel de reojo bajo tubo fluorescente. El oscuro pierde en ambos.
3. **El problema actual es el exceso de negro.** Hoy conviven header negro, píldora de nav negra y barras rojas. Profundizar el oscuro agrava el síntoma en vez de corregirlo.
4. **Riesgo de contraste.** Rojo saturado sobre negro no llega a AA para texto; obligaría a introducir un rojo secundario y a duplicar la paleta.

### B · “Mostrador Patagónico” — **elegida**

Fondo `#FBFCFD`, superficies `#FFFDFB` y `#FFFFFF`, tinta `#14161A`, neutros grises **fríos** (azulados) y rojo TABA `#D0000D` como único acento saturado.

**Por qué gana:**

1. **Coste de assets: cero.** El media de la tarjeta es blanco, igual que el fondo del packshot: el producto “flota” sin recorte, sin halo y sin retoque. Se puede implementar mañana.
2. **Resuelve el diagnóstico.** Los hallazgos son de jerarquía y densidad, no de temperatura. Bajar el negro de tres superficies grandes a un wordmark y una barra superior de rider libera el producto y el precio.
3. **El rojo recupera significado.** Hoy el rojo está en el chip de categoría activa, la regla de la marca, el icono de búsqueda, la barra de carrito y el rótulo de orden. Reservado a **acción primaria + marca + indicador de navegación activa**, “Agregar” deja de competir contra cinco rojos.
4. **Sirve a las tres superficies.** La misma paleta funciona para vender (cliente), para operar bajo presión (negocio) y para leer al sol (rider). Una dirección oscura habría exigido tres temas.

---

## Qué debe transmitir y cómo se consigue

| Atributo | Mecanismo concreto |
|---|---|
| Comercio profesional | Bordes de 1px en lugar de sombras difusas; radios de 14px en vez de 22; alineación de números tabulares en precios, totales y métricas |
| Rapidez | Una sola acción primaria por pantalla; el estado se lee en una banda de 52px; sin animaciones de entrada |
| Confianza | Precio siempre visible junto al producto; “Precio a confirmar” explícito y **no comprable**; estado de sincronización honesto y persistente |
| Operación real | Densidad alta en el negocio, generosa en el catálogo; el pedido antes que la métrica |
| Identidad de bebidas | El packshot ocupa una caja cuadrada completa; nada compite con la botella |
| Calidad | Un único juego de radios, sombras y espaciados; cero número mágico en el layout |
| Simplicidad | 4 destinos de navegación por producto; nunca dos filas de tabs |
| Patagonia sutil | Neutros grises **fríos** (basalto) en vez de grises cálidos; regla “horizonte” de 1px con degradado como único gesto gráfico. Sin montañas, sin lengas, sin azul turístico |
| Que no parezca plantilla | Nada de gradientes decorativos, tarjetas sin función ni iconografía genérica de stock |
| Que no parezca demo | Ninguna etiqueta técnica en la superficie del cliente |
| Que no copie a PedidosYa ni Rappi | Sin naranja/violeta de marca, sin carrusel de banners promocionales, sin urgencia inventada, sin gamificación |

---

## Identidad: qué se conserva y qué se reduce

**Se conserva**
- La marca TABA y su wordmark itálico con la regla roja debajo.
- El rojo TABA exacto: `#D0000D`.
- El negro/grafito, ahora concentrado en el wordmark, la barra superior del rider y la barra sticky de resumen.
- El blanco cálido `#FFFDFB` como superficie elevada.
- Los bordes suaves y las imágenes de producto limpias.

**Se reduce**
| Antes | Ahora |
|---|---|
| Header negro de 71px + píldora de nav negra + barra roja | App bar de papel de 56px + barra de nav a sangre + una sola barra sticky oscura, sólo si hay carrito |
| Rojo en chips, iconos, rótulos, barras | Rojo en: acción primaria, marca, indicador de nav activa, pill de estado “Nuevo” |
| `0 18px 48px` de sombra | `0 1px 2px` / `0 4px 12px`; `0 12px 32px` sólo en modales |
| H1 de ~48px en móvil | 22px |
| Radios de 22–24px | 14px (píldora sólo en chips y badges) |
| 5 tarjetas de producto distintas | 1 componente con 2 densidades |

---

## Reglas no negociables de la dirección

1. **El rojo nunca ocupa una superficie mayor que un botón o una barra de acción.** Si tres acciones repetidas de una lista fueran rojas, dejan de ser rojas: la lista usa acción en tinta y el rojo queda para la decisión única del detalle.
2. **El producto manda.** En la tarjeta, la caja del packshot es cuadrada y no comparte espacio con controles superpuestos.
3. **El precio nunca queda tapado ni fuera del primer viewport.**
4. **Ninguna medida de chrome se escribe dos veces.** Una declaración, todo lo demás derivado (ver `TOKENS.md`).
5. **Ningún estado se comunica sólo con color.** Siempre punto + texto.
6. **Ninguna etiqueta técnica en la superficie del cliente.**
7. **No se inventa información comercial**: ni descuentos, ni popularidad, ni stock, ni urgencia, ni reseñas. Lo que no está en el catálogo, no se muestra.

## Cómo se ve

| Prototipo | Pantalla clave |
|---|---|
| Catálogo móvil | `screenshots/catalog-mobile-390x844.png`, `catalog-mobile-cart-390x844.png` |
| Empty state resuelto | `screenshots/catalog-mobile-empty-390x844.png` |
| Catálogo desktop | `screenshots/catalog-desktop-1440x1000.png` |
| Negocio móvil | `screenshots/business-mobile-home-390x844.png` |
| Negocio desktop | `screenshots/business-desktop-1440x1000.png` |
| Rider Android | `screenshots/rider-on-the-way-390x844.png`, `rider-delivery-code-390x844.png` |
| Comparación | `screenshots/BEFORE_AFTER_BOARD.png` |
