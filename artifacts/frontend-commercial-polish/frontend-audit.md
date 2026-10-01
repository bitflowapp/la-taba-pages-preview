# Auditoría del frontend — La Taba

Rama `feat/taba-frontend-commercial-polish`, sobre `bae464f` (PR #129).

Cómo se hizo: la tienda real en modo producción, con las 46 fichas reales
servidas por un backend en memoria y las 42 fotos aprobadas (verificadas por
SHA-256). Chromium y WebKit, a 360 × 800, 390 × 844, 430 × 932, 1366 × 768 y
1920 × 1080. Nada se dio por bueno leyendo el código: cada hallazgo se vio en
pantalla o se midió, y cada corrección tiene su prueba.

Producción no se tocó. No se cambió precio, stock, disponibilidad, publicación,
nombre, marca ni imagen de ningún producto. Los precios que se ven en las
capturas son valores de QA que existen sólo en la memoria del navegador de
prueba: sirven para ver la maqueta con productos comprables y no son precios
comerciales.

## Punto de partida: qué traía el PR #129

| | |
|---|---|
| Contenido | 7 commits sobre `release/taba-controlled-production` (`4e215da`), 20 archivos |
| Qué resuelve | El fallback y el Realtime repintaban la grilla entera y reemplazaban tarjetas e imágenes. Ahora el DOM se parchea por identidad (`js/core/stable-catalog-dom.js`) |
| Ya en la base | Nada: el PR está en borrador y sin fusionar |
| Demostrado | CI verde en `bae464f`; 0 reemplazos de tarjetas e imágenes con datos idénticos; sesión de 2 minutos |
| No demostrado | Costo de cuadros del scroll, comportamiento con campañas, sesión de 5 minutos, WebKit con interacción prolongada |

Esta rama parte de ese commit y no repite nada de lo que resuelve. Usa su
fixture de 46 productos y su sonda de estabilidad.

## Defectos encontrados

Prioridad: P0 rompe la compra · P1 daña la compra o engaña · P2 se nota y
molesta · P3 detalle.

| # | Prioridad | Dónde | Qué pasaba | Estado |
|---|---|---|---|---|
| F-01 | P1 | Catálogo, scroll | El brillo de la góndola recalculaba el estilo de las 46 tarjetas en cada paso de scroll | Corregido |
| F-02 | P2 | Catálogo, tarjeta | El corazón de favoritos era invisible (1,02:1), guardado o sin guardar | Corregido |
| F-03 | P2 | Catálogo y home, fotos | Un teléfono de densidad 3 bajaba el master de 1000 px de cada tarjeta: 1,86 MB en vez de 0,47 MB | Corregido |
| F-04 | P2 | Buscador | «cocacola», «redbull», «lays», «1 litro», «710 cc», «2.25», «vino tinto» y 17 errores de tipeo devolvían cero | Corregido |
| F-05 | P2 | Home, carruseles | Una de cada cuatro tarjetas cortaba el nombre a una línea: «Coca-Cola Sin…» al lado de «Coca-Cola» | Corregido, con un límite declarado (ver abajo) |
| F-06 | P2 | Catálogo, «Todas» | Orden alfabético: un vino, un aperitivo, un agua, una cerveza | Corregido |
| F-07 | P2 | Buscador | Cada tecla costaba ~100 ms en escritorio y ~380 ms en un teléfono medio | Mejorado (ver abajo) |
| F-08 | P3 | Catálogo, tarjeta | «Schweppes Pomelo Sin…» a 390 px; cinco nombres cortados a 360 px | Corregido |
| F-09 | P3 | Catálogo, tarjeta | Renglón de marca repetido («BRANCA / Fernet Branca»), y esas dos tarjetas 22 px más altas | Corregido |
| F-10 | P3 | Catálogo, tarjeta | El envase retornable no se decía | Corregido |
| F-11 | P3 | Catálogo, cambio en vivo | Un cambio de precio en un producto reescribía atributos en cinco tarjetas | Corregido |
| F-12 | P3 | Catálogo, título del rubro | «Jugos», «Energizantes»: el título perdía el pie de la g y la j en Chromium | Corregido |

### F-01 · El brillo de la góndola costaba cuadros

`js/motion.js` escribía `--card-glow` en el estante hasta 25 veces mientras se
scrolleaba. La propiedad se hereda, así que cada escritura recalculaba el estilo
de las 46 tarjetas (unos 1.400 elementos) y les repintaba la sombra.

Mismo recorrido de 120 pasos sobre el catálogo, base (`bae464f`) y esta rama
medidas una detrás de la otra, dos rondas, sin limitar la CPU:

| | Base | Esta rama |
|---|---:|---:|
| Recálculo de estilo en el recorrido (teléfono) | 556 – 598 ms | 3 – 5 ms |
| Recálculo de estilo en el recorrido (escritorio) | 1.141 – 1.149 ms | 2 ms |
| Trabajo del hilo principal (teléfono) | 1.442 – 1.777 ms | 124 – 241 ms |
| Trabajo del hilo principal (escritorio) | 5.413 – 7.303 ms | 72 – 906 ms |
| Cuadro promedio (teléfono) | 25,1 – 27,2 ms | 16,7 – 17,4 ms |
| Cuadro promedio (escritorio) | 56,8 – 76,1 ms | 16,7 – 30,1 ms |

El número que no depende de qué más esté haciendo la máquina es el recálculo de
estilo: desaparece. Los cuadros y el tiempo de hilo sí dependen (la segunda
ronda de escritorio de esta rama tuvo un tropiezo ajeno al estilo: 1,9 ms de
recálculo y 906 ms de hilo), y por eso se informan los dos extremos y no un
promedio.

La prueba que aisló la causa: con el valor fijado por CSS, el mismo recorrido
daba 16,7 ms por cuadro. El brillo ahora tiene dos niveles con histéresis y se
aplica cuando el scroll se asentó, con una transición. El CSS del efecto no
cambió.

### F-02 · El corazón de favoritos no se veía

El ícono pedía `--taba-ink`, que en el alcance del cliente está reasignado a la
tinta clara de la góndola, sobre un disco marfil: marfil sobre marfil. En las 46
tarjetas el control era un círculo vacío, y un favorito guardado tampoco se
distinguía. axe-core no lo detecta: no mide contraste de íconos.

| | Antes | Después |
|---|---:|---:|
| Sin guardar | 1,02:1 | 17,2:1 |
| Guardado | 1,02:1 | 5,4:1 |

Capturas: `before/defects/` y `after/defects/`.

### F-03 · El teléfono bajaba la foto grande

Con `sizes="45vw"` y densidad 3, el navegador calcula 526 px, descarta la
miniatura de 400 y baja el master de 1000. Con 130 px gana la miniatura.

| Catálogo, 390 × 844 @3x | Antes | Después |
|---|---:|---:|
| Masters pedidos | 42 | 0 |
| Miniaturas pedidas | 0 | 42 |
| Bytes de fotos | 1.856.079 | 471.164 |

La ficha del producto sigue pidiendo el master. En escritorio (densidad 1) no
cambia nada: ya bajaba la miniatura.

### F-04 · La búsqueda no perdonaba nada

Ver `catalog-audit.md` y `tests/catalog-search-tolerance.test.mjs`. La búsqueda
exacta sigue mandando; sólo si no trae nada se muestra lo más parecido, y la
pantalla lo dice («No encontramos «heiniken». Esto es lo más parecido.»). Lo que
el local no vende —vodka, whisky, leche— sigue devolviendo cero.

### F-05 · Nombres largos en la vidriera

La tarjeta de la home tiene dos renglones de texto: nombre y presentación. No se
le puede dar un tercero: a 360 × 800 el primer «Agregar» está a 3 px del pliegue
útil, y ese es un contrato con prueba propia (`taba2-brand-home.spec.mjs`).

Ahora, cuando el nombre no entra en un renglón, la presentación queda fija al
final del segundo y el nombre usa el primero entero y lo que sobra del segundo.
La tarjeta mide lo mismo.

Sobre las 43 tarjetas de la home, con la tipografía de Windows:

| Tarjetas con el nombre cortado | Base | Esta rama |
|---|---:|---:|
| A 360 px | 13 (8 productos) | 2 (1 producto: Brahma, que está en dos carruseles) |
| A 390 px | 11 (7 productos) | 0 |
| A 430 px | 4 (3 productos) | 0 |
| Tarjetas sin la presentación a la vista, en cualquiera de los tres | 0 | 0 |

**El límite.** Cuánto entra depende del ancho de la tipografía del sistema, y la
tienda usa la del teléfono. Lo que está garantizado con cualquier fuente es el
orden de prioridad: primer renglón del nombre, presentación, resto del nombre.
Si algo no entra, queda afuera el final del nombre, sin puntos suspensivos
(«Brahma Chopp / 1 L · Retornable» pierde «Rubia» a 360 px). El nombre completo
sigue en la ficha y en la etiqueta accesible de la foto.

Medido forzando otras tipografías sobre las 43 tarjetas de la home, en los dos
motores, a 360, 390 y 430 px:

| Tipografía | Presentaciones perdidas | Nombres largos con el final afuera (360 / 390 / 430) |
|---|---:|---|
| Windows (Segoe UI) | 0 | 1 / 0 / 0 |
| Roboto (Android), en negrita | 0 | 1 / 1 / 0 |
| Verdana (más ancha que cualquier fuente de teléfono) | 0 | todos los largos / varios / varios |

No se probó en un teléfono físico.

### F-06 · «Todas» en orden alfabético

El catálogo real llega ordenado por `sort_order` y nombre; con todos los
`sort_order` en 0, eso es el alfabeto. Ahora, lo que empata en `sort_order` se
agrupa por rubro, en el orden de los chips. En cuanto el comercio numere sus
productos, manda su número. «Menor precio» sigue ordenando por precio.

### F-07 · Cada tecla del buscador

Cada tecla vuelve a renderizar la tienda entera. El perfil mostró tres costos
evitables: se construía un `Intl.NumberFormat` por precio y se volvía a validar
la configuración de despliegue por cada imagen.

| Tecla promedio | Base | Esta rama |
|---|---:|---:|
| Escritorio | 103 ms | 68 ms |
| Teléfono (CPU 4x), mediana de 9 corridas intercaladas | 378 ms | 236 ms |

Sigue sin ser instantáneo en un teléfono lento. Lo que queda es el render
completo por tecla; cambiarlo es rediseñar cómo se suscribe la interfaz al
estado, y no entró en esta rama. Queda como P2 abierto.

### F-11 · Un cambio en vivo tocaba cinco tarjetas

Cada render volvía a escribir los mismos atributos de movimiento (`data-motion-reveal`,
`--motion-index`, la clase de entrada) en todas las tarjetas. No reemplazaba
nodos, pero un cambio de precio en un producto dejaba mutaciones en cinco.
Ahora cada escritura mira antes si el valor ya está.

| Cambio de precio y stock en un producto | Antes | Después |
|---|---:|---:|
| Tarjetas con alguna mutación | 5 | 1 |
| Mutaciones, todas en la tarjeta del producto | — | 4 |
| Nodos reemplazados | 0 | 0 |

Las cuatro son las esperables: el precio, la etiqueta «Últimas 3», la etiqueta
accesible de la foto y la clase de la tarjeta. Igual en Chromium y en WebKit.

## Tres errores propios, encontrados y corregidos antes de entregar

Los tres salieron de mirar más: una corrida completa de CI, un sondeo con otra
tipografía y una prueba de cambio en vivo. Se dejan escritos porque muestran qué
no se había probado.

| # | Qué hice mal | Cómo apareció | Corrección |
|---|---|---|---|
| R-01 | El agrupado por rubro (F-06) estaba en el orden de la grilla y reordenaba también un catálogo que ya viene curado. La vidriera demo abre con energizantes; le subí siete cervezas al principio | CI `36817855269`: 38 pruebas rojas. Los recorridos de compra agregan «el primer producto», se llevaron una cerveza y el pedido pidió mayoría de edad | El agrupado se mudó a la lectura del catálogo real (`sortByShelfOrder`), que es donde nace el orden alfabético. La grilla volvió a respetar el orden recibido. La demo quedó idéntica a la base, verificado producto por producto |
| R-02 | La primera versión de F-05 dejaba fluir nombre y presentación como texto corrido: lo que no entraba era lo último, la presentación | A 360 px «Brahma Chopp Rubia» perdía «Retornable». En el Chromium de Linux del CI, «Glaciar Con Gas Baja en Sodio» perdía «1,5 L». Mi prueba sólo miraba el nombre | La presentación tiene su lugar reservado; la prueba ahora mira las presentaciones de todas las tarjetas |
| R-03 | F-11, arriba: mis propias piezas de campaña agregaban renders y dejaron a la vista las escrituras repetidas | Prueba de cambio en vivo | Escrituras idempotentes |

R-01 además ampliaba la exposición de alcohol, que es una regla que esta tienda
no negocia. La prueba de regresión afirma que lo primero que se puede agregar en
la vidriera demo no es una bebida alcohólica.

## Lo que se revisó y estaba bien

| Área | Resultado |
|---|---|
| Estabilidad del DOM (PR #129) | Confirmada: 0 reemplazos de tarjetas e imágenes en 5 minutos de uso, en los dos motores |
| Imágenes | Reservan su lugar antes de cargar (`width`/`height` y caja con proporción): CLS 0 en la carga |
| Carga inicial | Hay estado de carga con esqueletos livianos; no hay spinners |
| Estados vacíos | Nombran la causa y ofrecen deshacerla («Limpiar búsqueda», «Buscar en todo», «Ver todo el catálogo») |
| Ficha de producto | Abre y cierra sin mover el scroll; el foco vuelve a la tarjeta |
| Carrito | Agregar y quitar actualiza la tarjeta en el lugar, sin reemplazar nodos |
| Recarga | La vista se conserva por el hash; el carrito persiste |
| Desborde horizontal | Ninguno en los cinco tamaños |
| axe-core, WCAG 2.2 AA | 0 violaciones en home, catálogo, ficha y carrito |

## Observaciones que NO se cambiaron

| # | Prioridad | Observación | Por qué no se tocó |
|---|---|---|---|
| O-01 | P2 | Cada tecla del buscador renderiza la tienda entera | Requiere rediseñar la suscripción al estado |
| O-02 | P3 | «Volver» desde el carrito deja el catálogo arriba, no donde estaba | Es una decisión con prueba propia (`la-taba.spec.mjs`, «cambia pantallas sin navegar por scroll»): restaurar la posición es cambiar ese contrato |
| O-03 | P3 | En escritorio, «Filtros» y «Ordenar» ocupan una fila entera cada uno | Los filtros se despliegan en el lugar y necesitan el ancho; es una decisión documentada en la hoja |
| O-04 | P3 | En el carrusel de energizantes de la home, «473 ml · Lata · Sin azúcar» parte en dos renglones y ese carrusel queda 15 px más alto | No se corta ningún dato; achicarlo sería cortar «Sin azúcar» |
| O-05 | P3 | axe marca 1 nodo «aria-prohibited-attr» como incompleto en home y carrito | Ya estaba; no es una violación confirmada |
| O-06 | P3 | Con una campaña en la banda de apertura, la precarga de la foto editorial queda sin usar y el navegador lo avisa | Sólo aplica con una campaña encendida; está en el instructivo de activación |
| O-07 | P3 | En una tarjeta de nombre largo de la home, el lector de pantalla lee la presentación antes que el nombre | Es el costo de reservarle el lugar con un flotante; el significado no cambia y los botones de la tarjeta dicen el nombre completo |
| O-08 | P3 | Buscar cambia el contador y el título del rubro, y eso mueve 1–2 px el filete de al lado (0,0015 por búsqueda) | Es respuesta a una acción de la persona; el navegador no lo cuenta como salto cuando la tecla es real |
