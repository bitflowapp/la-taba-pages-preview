# TABA — Revisión comercial de los 33 vendibles · 2026-08-22

Medido contra producción viva (`wwcpogltfgzgkrlilbcd`) y el sitio publicado
(`https://la-taba.pages.dev`), **sólo lectura**: 0 escrituras de base, 0 deploy,
0 cambios de publicación, precio, stock, orden ni imágenes.

Fuentes: consulta directa a `products` (33 filas con contrato
`is_active AND available AND is_verified`), sonda Playwright anónima del orden
real de la góndola y de la home (`sonda-gondola-lanzamiento.json`,
`sonda-home-secciones.json`) y verificación visual de los 4 packshots.

## Estado verificado

| dato | valor |
|---|---|
| SKU totales | 72 |
| vendibles hoy | 33 |
| alcohólicos vendibles | **0** (LICENSE GATE aguanta) |
| stock en los 33 | 547 unidades |
| imágenes oficiales | 4 · fallback TABA 29 · incorrectas **0** |
| ocultos con stock 0 | 16 (12 góndola final + 4 unidades minoristas) |

## Los 33, en el orden REAL en que los ve el cliente

El orden no es el `sort_order`: los 6 marcados «más vendido» se adelantan a
todo. Por eso la numeración de abajo es la posición real en la grilla.

| # | Producto | Presentación | Precio | Stock | Imagen | Clase | Veredicto |
|---|---|---|---|---|---|---|---|
| 1 | Coca-Cola | 2,25 L | $5.900 | 24 | fallback | A | ancla, dejar primera |
| 2 | Coca-Cola Zero | 2,25 L | $5.900 | 24 | fallback | A | dejar |
| 3 | Paso de los Toros Tónica | 1,5 L | $3.250 | 24 | fallback | A | dejar en vidriera |
| 4 | Villa del Sur | 600 ml | $1.700 | 24 | fallback | B | **sacar de la vidriera** |
| 5 | Speed | 473 ml | $2.850 | 24 | fallback | A | dejar |
| 6 | Red Bull | 250 ml | $2.800 | 24 | fallback | A | dejar |
| 7 | Fanta Naranja | 2,25 L | $5.900 | 24 | fallback | A | **subir a vidriera** |
| 8 | Sprite | 2,25 L | $5.900 | 24 | fallback | A | **subir a vidriera** |
| 9 | Sprite Zero | 2,25 L | $5.900 | 12 | fallback | A | reponer |
| 10 | 7UP | 2 L | $3.800 | 12 | fallback | A | reponer |
| 11 | Pepsi | 2 L | $3.800 | 24 | fallback | A | **subir** (ancla de precio) |
| 12 | Pepsi Black | 1,5 L | $2.650 | 12 | fallback | A | reponer |
| 13 | Fanta Naranja | Pack x6 · 1,5 L | $19.999 | 8 | OFICIAL | **C** | **ocultar** |
| 14 | Coca-Cola Original | Pack x12 · 500 ml | $17.100 | 7 | OFICIAL | A | **subir** + reponer |
| 15 | Coca-Cola Zero | Pack x12 · 500 ml | $17.100 | 8 | OFICIAL | B | dejar |
| 16 | Sprite | Pack x12 · 500 ml | $17.100 | 8 | OFICIAL | B | dejar |
| 17 | Coca-Cola | 354 ml lata | $1.800 | 24 | fallback | B | dejar |
| 18 | Coca-Cola Zero | 354 ml lata | $1.800 | 24 | fallback | B | dejar |
| 19 | Sprite | 354 ml lata | $1.800 | 24 | fallback | B | dejar |
| 20 | Soda Manaos | 2 L sifón | $1.750 | 24 | fallback | A | dejar |
| 21 | Paso de los Toros Pomelo | 1,5 L | $3.250 | 12 | fallback | B | dejar |
| 22 | Benedictino | 2,25 L | $2.250 | 12 | fallback | A | **subir** + reponer |
| 23 | Villavicencio | 1,5 L | $2.400 | 24 | fallback | A | **subir** + revisar precio |
| 24 | Villavicencio con gas | 500 ml | $1.900 | 12 | fallback | B | dejar |
| 25 | Aquarius Pomelo | 2,25 L | $2.650 | 12 | fallback | A | **subir** |
| 26 | Aquarius Manzana | 1,5 L | $1.800 | 12 | fallback | A | dejar |
| 27 | Aquarius Pera | 1,5 L | $1.800 | 12 | fallback | A | dejar |
| 28 | Monster Green Zero | 473 ml | $3.250 | 12 | fallback | A | reponer |
| 29 | Speed Zero | 473 ml | $2.850 | 12 | fallback | B | dejar |
| 30 | Red Bull Sugarfree | 250 ml | $2.800 | 12 | fallback | B | dejar |
| 31 | Gatorade Manzana | 1,25 L | $2.650 | 12 | fallback | B | dejar |
| 32 | Gatorade Cool Blue | 500 ml | $2.000 | 12 | fallback | B | dejar |
| 33 | Powerade Mountain Blast | 500 ml | $1.450 | 12 | fallback | B | revisar precio |

**A = 19 · B = 13 · C = 1**

## Primera pantalla ideal (12)

La home abre con «Lo más pedido» (los 6 con tag `más vendido`) y ese mismo tag
manda las 6 primeras posiciones del catálogo. Es la única palanca de vidriera.

Hoy: Coca 2,25 · Coca Zero 2,25 · Tónica 1,5 · **Villa del Sur 600 ml** ·
Speed · Red Bull. Sin Sprite, sin Fanta, sin Pepsi, sin agua familiar y sin
ninguno de los 4 productos con foto real.

Propuesta (+7 / −1):

1. Coca-Cola 2,25 L — $5.900 *(ya)*
2. Coca-Cola Zero 2,25 L — $5.900 *(ya)*
3. Sprite 2,25 L — $5.900 *(nuevo)*
4. Fanta Naranja 2,25 L — $5.900 *(nuevo)*
5. Pepsi 2 L — $3.800 *(nuevo, ancla de precio)*
6. Benedictino agua 2,25 L — $2.250 *(nuevo, agua familiar más barata)*
7. Villavicencio agua 1,5 L — $2.400 *(nuevo)*
8. Coca-Cola Original Pack x12 — $17.100 *(nuevo: única foto real + ticket alto + es lo que se vendió en LT-0001)*
9. Paso de los Toros Tónica 1,5 L — $3.250 *(ya)*
10. Aquarius Pomelo 2,25 L — $2.650 *(nuevo)*
11. Red Bull 250 ml — $2.800 *(ya)*
12. Speed 473 ml — $2.850 *(ya)*

Sale: Villa del Sur 600 ml (agua chica, $2.833/L, contradice familiar-primero).

Además: el rail se llama **«Lo más pedido»** y hubo **un solo pedido real**. El
título afirma algo que no ocurrió; «Recomendados del local» dice la verdad y no
cuesta nada.

## Mantener visibles · 32 de 33

Los 19 de clase A más los 13 de clase B. Ninguno de los dos grupos se toca.

## Ocultar para el lanzamiento · 1

**Fanta Naranja Pack x6 · 1,5 L — $19.999**, por cuatro razones concretas:

- es el producto más caro de la góndola (+17 % sobre el siguiente, 3,4× la
  botella familiar) y aparece 13º, dentro del primer scroll;
- **$19.999 es la única terminación «999» del catálogo**: los 33 usan 00/50 y
  los 12 nuevos usan 90. Se lee como un precio pegado de otra lista;
- son 9 litros de un solo sabor de nicho: no es el pack que compra alguien que
  abre la app por primera vez;
- para ese cliente ya están las cinco botellas de 2,25 L a $5.900.

*Alternativa si no se quiere perder una de las 4 fotos:* corregir a $19.990 y
mandarlo al final del bloque de packs. Ocultarlo es lo simple; corregirlo es lo
óptimo.

## Stock crítico

Sin historial de ventas (1 pedido real), esto es exposición, no proyección
medida.

- **Coca-Cola Original Pack x12 — 7 unidades**: el más bajo del catálogo y el
  único con venta comprobada (LT-0001 se llevó uno).
- Coca-Cola Zero x12, Sprite x12, Fanta x6 — 8 unidades cada uno.
- **Benedictino 2,25 L — 12 unidades**: es la ÚNICA agua familiar grande y el
  agua es lo que más rota en un delivery de bebidas. El primero a reponer.
- Clase A con sólo 12 unidades: Sprite Zero 2,25 · 7UP 2 L · Pepsi Black 1,5 ·
  Aquarius Pomelo/Manzana/Pera · Monster Green Zero.

## Precios a revisar · 4 de 33 (los otros 29 = OK)

| producto | precio | $/litro | veredicto | por qué |
|---|---|---|---|---|
| Fanta Pack x6 1,5 L | $19.999 | 2.222 | **OUTLIER** | terminación fuera de convención + ticket máximo |
| Powerade Mountain Blast 500 ml | $1.450 | 2.900 | **REVIEW_LOW** | −27,5 % contra Gatorade Cool Blue 500 ml ($2.000), mismo formato y rubro |
| Villavicencio sin gas 1,5 L | $2.400 | 1.600 | **REVIEW_HIGH** | más cara por litro que el agua saborizada Aquarius 1,5 L ($1.200/L) y +60 % sobre Benedictino 2,25 L ($1.000/L). Un agua simple no debería salir más que un saborizado |
| Packs x12 de 500 ml | $17.100 | 2.850 | **REVIEW_HIGH** | el pack sale más caro por litro que la botella de 2,25 L ($2.622/L): no premia el volumen. Matiz: es exactamente el producto que ya se vendió |

Sin acción, dicho para que no sorprenda: Villa del Sur 600 ml ($2.833/L) y
Villavicencio con gas 500 ml ($3.800/L) son caros por litro. Es normal en
formato chico frío — refuerza que no protagonicen.

## Imágenes

- **4 OFICIALES, las cuatro verificadas mirándolas**: Coca-Cola Original ×12
  (tapa roja), Coca-Cola Zero ×12 (tapa negra), Sprite ×12 (verde),
  Fanta Naranja ×6 (botella de 1,5 L). Cada una con su sello de cantidad
  correcto. Ninguna corresponde a otro producto.
- **29 fallback TABA** — honesto, no bloquea vender.
- **0 incorrectas.** La alerta de «casi idénticas» entre las dos Coca del
  reporte de duplicados es un falso positivo: ambas son botella sobre fondo
  blanco y la firma de color 8×8 la domina el blanco (medias RGB 246,237,235 vs
  245,237,235). Miradas de verdad, son productos distintos.

## Naming técnico que se ve HOY

- **Carrito** (pantalla previa a pagar): «Original · 2250 ml · botella-pet» —
  slug de base de datos y capacidad sin formatear.
- **Ficha de producto**: encabezado «BOTELLA PET · 500 ML · PACK X12 · 500 ML ·
  BOTELLA PET» (se repite dentro de sí mismo) y debajo «Botella PET · 500 ml ·
  Pack x12».
- La grilla del catálogo ya está bien (v81): «Pack x12 · 500 ml», «2,25 L ·
  Original», 0 slugs. El helper que lo resuelve
  (`js/core/product-presentation.js`) existe y está desplegado: falta cablearlo
  en la ficha y en el carrito.
- Inconsistencia de marca: la botella de 2,25 L se llama «Coca-Cola» y el pack
  y la nueva de 1,5 L se llaman «Coca-Cola Original».
- **Latente, importante antes de publicar los 4 minoristas**: `fanta-naranja-pet-1500ml`
  tiene `variant='1,5 L'` y los tres de 500 ml tienen `variant='500 ml'`. Al
  publicarse, la tarjeta dirá «1,5 L · 1,5 L» y «500 ml · 500 ml».

## Orden — propuesta

1. Cambiar quiénes son los 12 recomendados (arriba): arregla la vidriera de la
   home y las 6 primeras posiciones del catálogo de una sola vez.
2. Alinear el catálogo con la home: hoy el catálogo va Gaseosas → **Mixers** →
   Aguas, y la home va Gaseosas → **Aguas** → Energizantes → Mixers. Para un
   delivery de bebidas manda el orden de la home.
3. Si el Fanta ×6 se queda, moverlo al final del bloque de packs.
4. **Isotónicas no tiene sección en la home**: Gatorade ×2 y Powerade sólo se
   alcanzan desde el catálogo.

## Los 12 familiares nuevos — en qué orden recibirlos

Los cuatro packs de cerveza (Brahma, Budweiser, Stella, Andes Origen) **NO se
reciben todavía**: siguen bloqueados por el LICENSE GATE y sería mercadería
inmovilizada. Entran cuando la habilitación esté acreditada.

De los ocho no alcohólicos, por impacto en la góndola:

1. **Coca-Cola Original 1,5 L** — hoy no existe nada entre la lata de 354 ml y
   la botella de 2,25 L. Llena el hueco central de la línea más pedida.
2. **Coca-Cola Zero 1,5 L** — idem.
3. **Villa del Sur 2,25 L** — segunda agua familiar; hoy Benedictino (12 u.) es
   la única y el agua es lo que más se repone.
4. **Cepita Naranja 1,5 L** — abre la categoría **Jugos**, que hoy no existe en
   la tienda: es una sección nueva en la home con un solo SKU recibido.
5. **Cepita Durazno 1,5 L** — un rubro con un solo producto se ve pobre; con
   dos ya es un rubro.
6. **Sprite 1,5 L**
7. **Sprite Zero 1,5 L**
8. **Villavicencio con gas 1,5 L** — revisar el precio antes: $3.490 contra
   $2.400 de la sin gas de la misma marca y tamaño (+45 % sólo por el gas).

**Noveno, no estaba en la lista pero está en la misma situación**:
`fanta-naranja-pet-1500ml` ($4.990, stock 0, cargada el 19/08) completa la línea
de 1,5 L junto con las Coca y las Sprite.

## Cómo se ejecuta cada cambio (y qué falta en el Panel)

- **Ocultar el Fanta ×6**: botón «Ocultar de la tienda» del Panel. Sin consola.
- **Cambiar los recomendados**: **no hay botón**. Ninguna pantalla del Panel
  toca `tags` y las RPC disponibles son de publicar/ocultar e importar lotes.
  Hoy la vidriera sólo se cura con un lote de base gateado. Curar la vidriera es
  operación cotidiana de un comercio: **es un hueco del Panel, P1**.
- **Precios**: idem, requieren lote gateado.
- **Recibir mercadería y publicar**: Panel → Recepción → escanear GTIN →
  cantidad → Guardar → Publicar. Ese camino sí está completo.
