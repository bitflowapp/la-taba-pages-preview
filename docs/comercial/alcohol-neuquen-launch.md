# Catálogo de alcohol para Neuquén — investigación, selección y qué falta

Fecha de la investigación: **2026-08-26**.
Alcance: Neuquén Capital, Cipolletti y Alto Valle, con Argentina como señal
secundaria donde no hay dato local suficiente.

---

## 0. Lo primero, porque cambia todo lo demás: el catálogo de alcohol YA EXISTE

Antes de proponer un solo producto nuevo hay que decir esto, porque es lo que
más condiciona la misión y no estaba enunciado en el pedido:

**La Taba ya tiene 27 productos alcohólicos cargados en producción.** No son
borradores ni una lista de deseos. Leídos de la base el 2026-08-26:

| | |
|---|---|
| SKU alcohólicos | **27** |
| con `price_status = 'confirmed'` | **27 / 27** |
| con precio real cargado | **27 / 27** ($2.050 a $29.490) |
| con `is_verified = true` | **27 / 27** |
| con `is_active = true` | **27 / 27** |
| `available` | **false en los 27** |
| **con fotografía** | **0 / 27** |

O sea: el catálogo de alcohol no hay que construirlo desde cero. Está
construido, tiene precios confirmados, y está apagado a propósito. Lo que le
falta —y es lo único que le falta para estar presentable— **son las
fotografías**.

Esto reordena las prioridades respecto del pedido original. La pregunta útil ya
no es «qué 30 productos cargamos», sino dos preguntas distintas:

1. **¿Qué le falta al surtido que ya existe?** (hueco de assortment)
2. **¿Qué se puede hacer hoy sin inventar datos comerciales?** (fotografías de
   los 27, que no requieren nada de Walter)

### Los 27, por categoría

| Categoría | N | Productos |
|---|---|---|
| Cervezas | 15 | Quilmes Clásica (lata 473, botella 710, pack x6), Quilmes Stout 473, Andes Origen Rubia (473, pack x6), Andes Origen Roja 473, Brahma Chopp (710, pack x6), Budweiser (473, pack x6), Stella Artois (473, pack x6), Corona Extra 330, Patagonia Amber Lager 730 |
| Vinos | 5 | Trapiche Origen Malbec 750, Cafayate Torrontés 750, Dada Caramel 750, Toro Viejo Clásico Tinto 750, Toro Tinto 1000 |
| Aperitivos | 3 | Gancia Americano 450, Gancia Lima-Limón lata 473, Dr. Lemon Vodka Pomelo lata 473 |
| Fernet | 2 | Fernet Branca **1000 ml**, Fernet 1882 750 |
| Destilados | 2 | Gin Gordon's 700, Vodka Skyy 700 |

### Lo que salta a la vista de esa tabla

- **Cerveza: portafolio 100 % AB InBev (Quilmes).** No hay una sola marca de
  CCU —Schneider, Heineken, Imperial, Amstel, Isenbeck—, que en el Alto Valle
  tienen distribuidor propio.
- **Fernet Branca sólo en 1 litro.** Es el formato equivocado (ver §2).
- **Cero whisky. Cero ron. Cero tequila. Cero espumante.**
- **Vodka sólo importado** (Skyy), sin la marca de volumen del mercado.
- Vinos: cinco etiquetas, sin la marca argentina de mayor volumen.

---

## 1. Cómo se investigó, y qué vale cada fuente

No se usó una sola lista nacional. Se cruzaron señales de tres tipos:

**Locales / regionales (las que más pesan)**

- **La Anónima** — la cadena dominante de la Patagonia, con sucursal en Neuquén
  Capital (068, Hiper Shopping). Su surtido de cerveza incluye Patagonia, Andes,
  Quilmes y **Schneider**; su categoría «Fernet y aperitivos» lista Fernet
  Branca en 750 y 450 ml.
- **La Barra CCU (Cipolletti)** — el distribuidor de CCU en el Alto Valle. Su
  catálogo es el portafolio CCU completo: Heineken, Amstel, Miller, Schneider,
  Imperial, Isenbeck, Santa Fe, Bieckert, Salta, Norte, Sol, Warsteiner,
  Grolsch, Blue Moon, Kunstmann; más Havana Club, Chivas Regal y Fernet Buhero.
- **Vinoteca El Lagar (Neuquén Capital, Edelman 35)** — Fernet Branca 750 cc a
  $21.800 **con stock**. Surtido de gin, vodka, ron, tequila, whisky, vinos,
  espumantes y aperitivos.
- **Cervecería y Maltería Quilmes** opera un centro de distribución en el
  Mercado Concentrador de Neuquén Capital y **distribuye directo** en Neuquén,
  Cipolletti, Plottier, Senillosa, Cinco Saltos, Centenario y Añelo.

**Ecommerce argentino con orden por ventas reales (señal de rotación)**

- **espaciovino** — permite ordenar por «más vendidos», lo que da un ranking de
  rotación observado y no una opinión. Ya está en la allowlist de imágenes de
  este repositorio.

**Estudios y prensa nacional (señal de contexto)**

- Ranking de bebidas alcohólicas más vendidas del país: **cerveza 1.º, vino
  2.º, fernet 3.º**; Argentina concentra más del 80 % del consumo mundial de
  fernet y Branca es la marca líder por lejos.
- Whisky: ranking IWSR de marcas importadas.
- Espumantes: participación de mercado por marca.
- Aperitivos: Argentina pasó del puesto 16.º al 9.º del mundo.

### Escala de confianza usada

- **HIGH** — aparece en fuente local/regional **y** tiene respaldo de rotación
  nacional o de ranking por ventas.
- **MEDIUM** — respaldo de rotación nacional sólido, presencia regional
  probable pero no verificada comercio por comercio.
- **WEAK** — una sola señal, o señal de nicho. **No entra al lote inicial.**

---

## 2. Los patrones que encontró la investigación

### 2.1 El formato de Fernet Branca que tiene La Taba es el que menos rota

Es el hallazgo más accionable de toda la investigación. Ordenando el catálogo
de fernet de espaciovino **por ventas**:

| Puesto | Producto | Precio de referencia |
|---|---|---|
| **1** | **Fernet Branca 750 ml** | $19.228 |
| 2 | Fernet Branca 450 ml | $13.364 |
| 3–6 | Fernet Nero 53 (750, y sus tres saborizados) | $12.733 |
| 7–8 | Fernet Buhero Negro 700 | $10.071 |
| 9 | Fernet 1882 750 | $10.709 |
| 10 | Fernet Branca Menta 450 | $6.973 |
| 11 | Fernet Branca miniatura 50 | $4.091 |
| **12** | **Fernet Branca 1 litro** | $22.159 |

La Taba tiene cargado **el puesto 12** y no tiene el puesto 1. El 750 ml es
además el que El Lagar de Neuquén Capital tiene en stock y el que La Anónima
lista para la sucursal de Neuquén. Para un pedido de fernet + coca de último
momento, el 750 es *el* formato.

### 2.2 El surtido de cerveza está armado sobre una sola cervecería

Los 15 SKU de cerveza son todos del portafolio Quilmes/AB InBev. Eso no está
mal —Quilmes distribuye directo en Neuquén y es el líder— pero deja afuera a
CCU, que en el Alto Valle no es un actor marginal: tiene **distribuidor propio
en Cipolletti** y su marca de volumen, **Schneider**, está en la góndola de La
Anónima Neuquén junto a Quilmes, Andes y Patagonia.

### 2.3 En vodka, lo importado está fuera del price point

El vodka más vendido es **Smirnoff 700 ml a $9.751**. Los importados premium
—Absolut, Ketel One— son «un segmento pequeño en ventas porque están fuera del
price point». La Taba tiene Skyy, que en el ranking de rotación aparece 8.º.
Falta el 1.º, que además es el más barato de la lista.

### 2.4 El espumante no es opcional para «juntada» y no existe en el catálogo

Chandon concentra el **58 %** del mercado argentino de espumantes, Mumm el 17 %
y Navarro Correas el 12 %. En el ranking por ventas de espaciovino, Chandon
aparece 1.º (Apéritif 750) y 9.º (Extra Brut 750). La Taba no tiene ni una
etiqueta de espumante.

### 2.5 El whisky tiene un líder indiscutido

Ranking IWSR de importados en Argentina, en cajas de 9 litros: **Johnnie Walker
156**, White Horse 117, Vat 69 36, Ballantine's 27, J&B 26. El primero saca 33 %
al segundo. Si entra un solo whisky, es ése.

### 2.6 Los aperitivos crecen y Aperol es el motor

Argentina pasó del 16.º al 9.º mercado del mundo en aperitivos. **Aperol** es la
marca de mayor crecimiento del grupo y el Spritz es elegido por el 67 % de los
consumidores en bares. **Cynar** crece por encima del promedio y capta
consumidores que venían del fernet. La Taba tiene Gancia (dos SKU) y nada más.

### 2.7 En gin, Gordon's es el ancla correcta de precio

Ranking por ventas: Bombay Sapphire 750 ($32.196), Tanqueray 700 ($31.921),
Hendrick's 700 ($71.134), Beefeater 700 ($24.040), **Gordon's 700 ($14.770)**.
La Taba ya tiene Gordon's, que es el mainstream accesible. Para gin-tonic de
juntada está bien elegido; el complemento natural es Beefeater.

---

## 3. La selección

**Criterio:** no llenar espacio. Entra lo que sería raro no encontrar, o lo que
cierra un hueco medido. El catálogo de alcohol de La Taba queda en **27
existentes + 11 altas = 38 SKU**, dentro del rango pedido, pero por evidencia y
no por cuota.

### MUST HAVE — cinco altas

Lo que hoy es directamente un hueco.

| Producto | Presentación | Categoría | Evidencia | Confianza | Por qué entra | Estado en TABA |
|---|---|---|---|---|---|---|
| **Fernet Branca** | 750 ml · botella · unidad | Fernet | #1 en ventas (espaciovino); stock en El Lagar Neuquén $21.800; La Anónima Neuquén lista 750/450 | **HIGH** | Es el formato que rota. TABA tiene el 1 L, que sale 12.º | **FALTA** |
| **Chandon Extra Brut** | 750 ml · botella · unidad | Espumantes | 58 % del mercado de espumantes; top-10 por ventas | **HIGH** | No hay un solo espumante en el catálogo | **FALTA** |
| **Smirnoff Vodka** | 700 ml · botella · unidad | Destilados | #1 vodka por ventas, $9.751 | **HIGH** | El vodka de volumen; el único que hay es importado y sale 8.º | **FALTA** |
| **Cerveza Schneider** | 473 ml · lata · unidad | Cervezas | La Anónima Neuquén; distribuidor CCU propio en Cipolletti | **HIGH** (regional) | Rompe la dependencia de un solo portafolio | **FALTA** |
| **Johnnie Walker Red Label** | 750 ml · botella · unidad | Destilados | #1 whisky importado en Argentina (156 vs 117 del 2.º) | **HIGH** | No hay whisky en el catálogo | **FALTA** |

### RECOMMENDED — seis altas

Evidencia sólida; entran si el negocio quiere profundidad en la categoría.

| Producto | Presentación | Categoría | Evidencia | Confianza | Por qué entra | Estado en TABA |
|---|---|---|---|---|---|---|
| **Aperol** | 750 ml · botella · unidad | Aperitivos | Marca de mayor crecimiento; Spritz 67 % de elección en bares | MEDIUM-HIGH | El aperitivo del momento | FALTA |
| **Campari** | 750 ml · botella · unidad | Aperitivos | 3,7 M de litros; ancla de la categoría | MEDIUM-HIGH | Clásico de previa | FALTA |
| **Fernet Branca** | 450 ml · botella · unidad | Fernet | #2 en ventas | MEDIUM-HIGH | El formato de una noche, sin comprar 750 | FALTA |
| **Beefeater Gin** | 700 ml · botella · unidad | Destilados | #4 gin por ventas | MEDIUM | Complementa a Gordon's para gin-tonic | FALTA |
| **Cerveza Heineken** | 473 ml · lata · unidad | Cervezas | Portafolio CCU en La Barra Cipolletti | MEDIUM | Lager importada de alta recordación | FALTA |
| **Trivento Reserve Malbec** | 750 ml · botella · unidad | Vinos | Marca argentina de vino n.º 1 del mundo | MEDIUM | El Malbec de volumen que falta | FALTA |

### OPTIONAL — no entran ahora

| Producto | Confianza | Por qué NO entra todavía |
|---|---|---|
| Cynar 750 | MEDIUM-WEAK | Crece, pero canibaliza fernet, que ya está cubierto |
| Mumm Cuvée 750 | MEDIUM | 17 % del mercado, pero Chandon ya cubre la necesidad de espumante |
| Havana Club 700 (ron) | WEAK-MEDIUM | Presente en el distribuidor CCU, sin señal de rotación local |
| Absolut Blue 700 | WEAK | #2 en ventas pero fuera del price point del canal |
| Tequila (cualquiera) | WEAK | Ninguna señal regional que justifique espacio inicial |
| Fernet Nero 53 / Buhero | WEAK | Rotan, pero son la alternativa barata a Branca, que ya está |

---

## 4. Combos

**No se implementó nada.** El pedido decía: investigar primero cómo modela el
sistema los combos, reutilizar si existe, y **no** construir una arquitectura de
combos en esta misión si no existe.

Lo que hay hoy: `js/combos-data.js` y un importador `scripts/import-combos.mjs`.
Los combos vivos se cobran por backend. **No se tocaron.**

Los combos que la investigación justifica, para una misión aparte:

| Combo | Componentes que YA existen | Falta |
|---|---|---|
| Fernet + Coca | — | Fernet Branca 750 (alta MUST HAVE); la Coca 1,5 L y 2,25 L ya están |
| Gin + tónica | Gin Gordon's 700 | Una tónica en el catálogo no alcohólico |
| Vodka + mixer | Vodka Skyy 700 | Smirnoff 700 (alta MUST HAVE) |
| Cerveza en pack | Quilmes / Andes / Brahma / Budweiser / Stella pack x6 | Nada: los cinco packs ya existen |

Ningún combo debe duplicar inventario: tienen que referenciar los productos
reales o el stock diverge.

---

## 5. Qué se puede hacer hoy y qué está bloqueado

### 5.1 Bloqueo duro: no se puede crear un SKU sin precio

Medido contra el esquema de producción, no supuesto:

- `products.price` es **NOT NULL**.
- `stage_catalog_products` —la única puerta de alta— **rechaza** `price <= 0`:
  «Invalid numeric price for external_id».
- `price_status` admite `'confirmed'` y `'pending'`, pero **`pending` no
  significa «sin precio»**: significa «hay un número y no está confirmado».

Conclusión: **las 11 altas no se pueden crear en producción sin la lista de
Walter.** No hay ruta de borrador sin precio, y el pedido prohíbe inventar uno.
Se preparan SKU, metadata y assets; la escritura comercial queda bloqueada.

### 5.2 La buena noticia: el estado «preparado y no comprable» sí existe, y es sólido

`products_available_requires_verification` obliga:

```
available ⇒ is_verified ∧ is_active ∧ stock > 0 ∧ price_status = 'confirmed' ∧ price > 0
```

Es decir: un producto con `price_status = 'pending'` **no puede volverse
comprable por accidente**. La base lo impide. Cuando lleguen los precios de
Walter, la ruta legítima es cargarlos como `pending` y confirmarlos después de
revisión — sin inventar semántica nueva.

### 5.3 Lo que sí se puede hacer sin pedirle nada a nadie

**Fotografiar los 27 que ya existen.** `products_verified_publication_authority`
permite, para `catalog_origin = 'commercial'`, que un producto verificado tenga
**todos** los campos de imagen en NULL **o** todos completos y bien formados.
Por eso los 27 conviven hoy verificados y sin foto, y por eso se les puede
asociar fotografía sin tocar un solo dato comercial.

---

## 6. La compuerta de activación de alcohol

Hoy la venta de alcohol está cerrada, y **no por una sola razón**. El servidor
exige seis cosas en `create_order`:

```sql
if v_contains_alcohol then
  if not v_business.alcohol_sales_enabled
    or v_business.alcohol_minimum_age is null
    or v_business.alcohol_sales_start is null
    or v_business.alcohol_sales_end is null
    or v_business.alcohol_timezone is null then
    raise exception 'politica de alcohol no configurada';
  if not v_age_confirmed then
    raise exception 'confirmacion de mayoria de edad requerida';
  -- y además la hora tiene que caer dentro de la ventana
```

Estado real del comercio, leído el 2026-08-26:

| Campo | Valor | ¿Bloquea? |
|---|---|---|
| `alcohol_sales_enabled` | `false` | **SÍ** |
| `alcohol_minimum_age` | `null` | **SÍ** |
| `alcohol_sales_start` | `null` | **SÍ** |
| `alcohol_sales_end` | `null` | **SÍ** |
| `alcohol_timezone` | `null` | **SÍ** |

**Son cinco compuertas cerradas, no una.** Poner `alcohol_sales_enabled = true`
sin configurar las otras cuatro no habilita nada: el pedido seguiría fallando
con «politica de alcohol no configurada». Conviene saberlo antes de prometerle
a Walter que «se activa con un flag».

### Qué tiene que estar decidido y validado antes de activar

1. **Decisión del comercio** (no técnica): edad mínima, horario de venta de
   alcohol permitido por la normativa municipal/provincial aplicable, y huso
   horario comercial.
2. **Confirmación de mayoría de edad en el cliente.** El servidor exige
   `v_age_confirmed`; hay que verificar que el checkout la pida y la envíe.
   *No se auditó en esta misión.*
3. **Precio y stock reales** de los 27 existentes, confirmados por Walter: los
   precios cargados son de la góndola de origen, no una lista que él haya
   firmado. Cuatro packs están hoy en **stock 0**.
4. **Fotografías**, para que la góndola de alcohol no salga con 27 respaldos
   dibujados.
5. **Revisión legal** de la normativa de venta y entrega de alcohol a domicilio
   en Neuquén. **Esta misión no la hizo y no la puede suplir.**

---

## 7. Esperando a Walter

**Precio y stock a confirmar — 27 productos.** Ya tienen precio cargado, pero
proviene de la carga de góndola, no de una lista firmada por él.
Cuatro con stock 0: `andes-origen-rubia-lata-473ml-pack-6`,
`brahma-chopp-lata-473ml-pack-6`, `budweiser-lata-473ml-pack-6`,
`stella-artois-lata-473ml-pack-6`.

**Precio requerido para poder existir — 11 altas.** No se pueden crear sin él.

**Decisiones comerciales — 3.** Edad mínima, ventana horaria y huso.

---

## Fuentes

Consultadas el 2026-08-26.

- La Anónima — sucursal 068 Neuquén y catálogo de bebidas:
  <https://www.laanonima.com.ar/empresa/sucursales/068-neuquen> ·
  <https://www.laanonima.com.ar/cervezas/n2_540/> ·
  <https://www.laanonima.com.ar/fernet-y-aperitivos/n2_544>
- La Barra (distribuidor CCU, Cipolletti): <https://labarraccu.com.ar/>
- Vinoteca El Lagar (Neuquén Capital):
  <https://www.ellagarwineshop.com.ar/productos/fernet-branca-750cc/>
- espaciovino, rankings por ventas:
  <https://www.espaciovino.com.ar/destilados?t=fernet&o=vendidos> ·
  <https://www.espaciovino.com.ar/destilados?t=gin&o=vendidos> ·
  <https://www.espaciovino.com.ar/destilados?t=vodka&o=vendidos> ·
  <https://www.espaciovino.com.ar/espumantes?o=vendidos>
- Cervecería y Maltería Quilmes, centro de distribución Neuquén:
  <https://www.argentino.com.ar/cerveceria-y-malteria-quilmes-F120EC20613D544>
- Fernet, tercera bebida más vendida del país (Forbes Argentina):
  <https://www.forbesargentina.com/negocios/un-negocio-nada-amargo-fernet-ocupa-tercer-lugar-bebidas-alcoholicas-mas-vendidas-pais-n45921>
- Ranking de whiskies más vendidos en Argentina (IWSR, vía The Wine Time):
  <https://thewinetime.com.ar/estos-son-los-10-whiskies-mas-vendidos-en-argentina/>
- Espumantes más elegidos y participación por marca (Capri Distribuidora):
  <https://www.capri.com.ar/blog/los-espumantes-mas-elegidos-por-los-argentinos-para-brindar>
- Aperitivos, crecimiento del mercado argentino (La Nación / Cronista / Comercio y Justicia):
  <https://www.lanacion.com.ar/economia/negocios/los-aperitivos-toman-impulso-y-ya-dejaron-de-ser-vistos-como-una-bebida-del-pasado-nid1923112/> ·
  <https://comercioyjusticia.info/negocios/aperol-resulto-la-marca-con-mayor-crecimiento-en-aperitivos-de-argentina/>
- Vodka, récord de ventas y desplazamiento de importados (El Cronista):
  <https://www.cronista.com/apertura/empresas/opciones-saborizadas-y-ventas-record-el-vodka-es-el-nuevo-rey/>

Los precios citados son **señal de mercado**, no precio comercial de La Taba.
