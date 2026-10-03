# Góndola comercial · tanda 1 — TABA2

Base `1c74550` · 2026-08-05 · worktree `D:\1212\la-taba2-commercial-shelf-stage1`.

---

## Resumen en una línea

**La estructura de venta quedó lista y probada; los 25–30 productos no se pudieron publicar porque el catálogo no tiene ni un precio para cargarles.** Se publicaron los 11 que ya tenían precio real, se armaron las filas de Home y las recomendaciones pedidas —fail-closed, se encienden solas—, y queda una planilla de 31 filas para que el local complete precio y stock.

---

## 1. Por qué no se publicaron 25–30 productos

La instrucción tiene dos partes que hoy no pueden cumplirse juntas: *"cargar primero 25–30 productos fuertes"* y *"si un producto no tiene precio real, no inventarlo"*. Verificado antes de tocar código:

| Fuente | Resultado |
|---|---|
| `catalog/pending-prices.csv` | 71 filas, **columna `price` vacía en todas** |
| `catalog/products.json` / `.csv` | sin campo de costo, precio mayorista ni proveedor |
| `docs/**` | ninguna lista de precios del local |
| Catálogo de la app | 71 de 82 productos con `pricePending: true` |

No hay ningún precio que cargar. Publicar 25 productos exigía inventar 25 precios, que es exactamente lo que la tanda prohíbe cinco veces. Se hizo todo lo demás.

---

## 2. Productos publicados en esta tanda (11)

Son los que **ya tenían precio real**; ninguno se agregó ni se modificó en esta tanda. Todos son unidad minorista, con stock y foto verificada.

| Rubro | Producto | Presentación | Precio |
|---|---|---|---:|
| Cervezas | Heineken | Lata 473 ml | $ 3.900 |
| Cervezas | Corona Extra | Botella 330 ml | $ 3.600 |
| Cervezas | Schneider Rubia | Lata 710 ml | $ 3.500 |
| Cervezas | Imperial Golden | Lata 473 ml | $ 3.000 |
| Cervezas | Imperial Extra Lager | Lata 473 ml | $ 3.000 |
| Cervezas | Imperial APA | Lata 473 ml | $ 3.000 |
| Cervezas | Imperial Cream Stout | Lata 473 ml | $ 3.000 |
| Energizantes | Red Bull Energy Drink | Lata 250 ml | $ 3.576 |
| Energizantes | Monster Mango Loco | Lata 473 ml | $ 3.390 |
| Energizantes | Speed Unlimited Original | Lata 473 ml | $ 2.925 |
| Energizantes | Speed Unlimited Zero Sugar | Lata 473 ml | $ 2.925 |

De la lista prioritaria pedida, **5 ya estaban publicados**: Heineken 473, Corona, Red Bull 250, Speed Original y Speed Zero.

## 3. Pendientes por precio (20 de los prioritarios)

Todos existen en el catálogo, visibles y con "Precio próximamente". Detalle fila por fila en `shelf-stage1-price-loading.csv`.

Cervezas: Budweiser 473 (además con empaque ambiguo), Stella Artois 330 sin alcohol, Quilmes Clásica 710, Corona Extra 330 (fila duplicada) · Gaseosas: Coca-Cola Original 500 y 1,5 L, Coca-Cola Zero 500 y 1,5 L, Sprite 500 y 1,5 L, Fanta Naranja 1,5 L · Fernet y mixers: Fernet Branca 750, Fernet Vittone 1 L, Schweppes Tónica 1,5 L y 354 ml, Schweppes Citrus 1,5 L · Agua e hielo: Villavicencio 500, Glaciar sin gas 1,5 L, Glaciar con gas 1,5 L, Eco de los Andes 2 L, Hielo Cristal 4 kg.

## 4. Pendientes por imagen (9)

Las nueve unidades publicadas en la tanda anterior a partir de un pack: la foto del pack muestra seis o doce botellas y no puede hacer de unidad. Usan el marcador neutro y quedan marcadas `imagePending`.

Coca-Cola Original 500 ml y 1,5 L · Coca-Cola Zero 500 ml y 1,5 L · Sprite Original 500 ml y 1,5 L · Fanta Naranja 1,5 L · Schweppes Tónica 1,5 L · Schweppes Citrus 1,5 L.

## 5. Pendientes por stock (20)

Los mismos 20 del punto 3: `stock: 0`. Ninguno se tocó — no hay inventario real que cargar.

## 6. Productos pedidos que **no existen** en el catálogo

Hay que darlos de alta con datos reales; no se crearon inventados.

- **Papas y snacks**: el rubro no existe. Cero productos, cero categoría. La fila "Algo para picar" y las reglas de recomendación ya lo esperan.
- **Fanta 500 ml**: no existe (sí la de 1,5 L).
- **Stella Artois 473 ml**: sólo existe "sin alcohol 330 ml".
- **Quilmes 473 ml**: sólo existe "Clásica 710 ml".
- **Budweiser 473 ml**: existe con empaque contradictorio; hay que confirmar si es lata suelta o pack de 6 antes de publicarlo.

---

## 7. Cambios en Home

Orden nuevo de la góndola, en `js/core/beverage-home-sections.js`:

| # | Fila | Rubros | Estado hoy |
|---|---|---|---|
| 1 | **Lo más pedido** | métrica de pedidos | se titula **"Destacados"**: sin pedidos agregados que respalden un ranking, no se afirma. Muestra los 11 comprables |
| 2 | **Para esta noche** | cervezas, fernet, energizantes, mixers | **viva** (cervezas + energizantes) |
| 3 | **Cervezas** | cervezas | **viva** (7) |
| 4 | **Gaseosas** | gaseosas | espera precios |
| 5 | **Fernet y combos** | fernet, aperitivos, mixers | espera precios |
| 6 | **Energizantes** | energizantes | **viva** (4) |
| 7 | **Agua e hielo** | aguas, saborizadas, isotónicas, complementos | espera precios |
| 8 | **Algo para picar** | snacks | espera que exista el rubro |

Todas fail-closed: sin producto comprable no se pintan. La home mide **2.782 px** (contrato: < 3.700) y no muestra ni un producto sin precio.

**Nota de tope:** `ui.js` corta en `HOME_MAX_SECTIONS = 6` para no inflar la home. Con las 7 filas de rubro definidas, cuando todas tengan mercadería la última ("Algo para picar") va a esperar lugar. Subir ese tope es una decisión visual que exige volver a medir el contrato de altura; no se tocó.

## 8. Cambios en recomendaciones

En `js/core/cart-recommendations.js`. **Se corrigió un defecto de fondo**: las reglas apuntaban a rubros del catálogo heredado que no existen acá (`hielo-y-extras`, `picadas-y-deli`, `energeticas`, `vinos-y-espumantes`, `gins-y-vodkas`, `whisky-y-destilados`). Por eso la regla de "no sumar más alcohol" no reconocía un fernet, un gin ni un whisky, y los destinos no existían.

| Disparador | Sugiere | Estado hoy |
|---|---|---|
| **Fernet** (regla nueva, máxima prioridad) | Coca-Cola, hielo, mixers | dormida: fernet aún no comprable |
| Cerveza y cualquier alcohol | picada, hielo, gaseosas, mixers | dormida: ningún acompañamiento comprable |
| Gaseosa | hielo, picada | dormida |
| Energizante | picada, agua | dormida |

Las cuatro se encienden solas cuando el rubro destino tenga precio. Hoy el carrito con una cerveza no muestra el rail — correcto: no hay nada que ofrecer, y ofrecer algo sin precio estaba prohibido.

---

## 9. Verificación

`npm run check` PASS · unitarias **873/873** (12 nuevas de góndola) · Chromium **196/196** en 4 shards con `workers=1` · `secrets:scan` PASS · `git diff --check` limpio.

Vivo a 320 / 390 / 432 / 1280: 4 filas comerciales, 19 tarjetas en home, **0 productos sin precio en home**, 0 `$0`, 0 overflow, 0 errores de consola, 0 requests fallidos.

## 10. Qué destraba la góndola

Completar `shelf-stage1-price-loading.csv` (31 filas) con **precio y stock**. Con eso:

- Gaseosas, Fernet y combos, y Agua e hielo se encienden en Home;
- las cuatro reglas de recomendación empiezan a empujar;
- la fila de categorías de la home pasa de 2 rubros a 5-6;
- las 9 unidades siguen necesitando **foto propia** para verse bien, aunque ya se puedan vender.

Aparte: dar de alta el rubro **snacks** con productos reales, y confirmar el empaque de Budweiser.
