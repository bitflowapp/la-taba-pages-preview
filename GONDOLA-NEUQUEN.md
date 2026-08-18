# Góndola comercial de TABA · Neuquén Capital

**Rama** `feature/taba2-gondola-comercial-neuquen`, desde `34c6ee3`.
**Worktree** `D:\1212\la-taba2-gondola-neuquen`.
**Estado: LISTO PARA REVISIÓN — la carga a producción no está aplicada.**

Producción no se tocó: `wwcpogltfgzgkrlilbcd` sigue con sus 4 packs de gaseosa,
ledger 109 y 0 pedidos. Lo que hay acá es el surtido armado, medido y verificado
con navegador, más el lote SQL que lo aplica en una sola transacción.

---

## 1. Lo que se cargó

**52 SKU nuevos** — 29 sin alcohol y 23 con alcohol. Con los 4 packs que ya
estaban publicados, la góndola queda en **56 productos**, 33 sin alcohol y 23
con alcohol: dentro del rango pedido en las dos mitades.

| categoría | SKU | rango de precio |
|---|---:|---|
| Gaseosas | 11 | $1.800 – $5.900 |
| Cervezas | 11 | $2.050 – $11.400 |
| Energizantes | 5 | $2.800 – $3.250 |
| Vinos | 5 | $2.300 – $6.150 |
| Aguas | 4 | $1.700 – $2.400 |
| Mixers | 3 | $1.750 – $3.250 |
| Aguas saborizadas | 3 | $1.800 – $2.650 |
| Isotónicas | 3 | $1.450 – $2.650 |
| Aperitivos | 3 | $2.200 – $4.350 |
| Fernet y amargos | 2 | $8.950 – $26.250 |
| Destilados | 2 | $9.500 – $16.800 |

El detalle fila por fila, con el costo de reposición de cada uno, está en
`catalog/gondola-neuquen.mjs`. Ese archivo es la autoridad: el precio no está
escrito, se **deriva** del costo, así que el criterio es ejecutable y no una
afirmación de este informe.

### Marcas

Coca-Cola (Original, Zero), Sprite (Original, Zero), Fanta, Pepsi (Original,
Black), 7UP, Paso de los Toros, Manaos, Villa del Sur, Villavicencio,
Benedictino, Aquarius, Red Bull, Monster, Speed, Gatorade, Powerade · Quilmes
(Clásica, Stout), Brahma, Budweiser, Stella Artois, Corona, Andes Origen (Rubia,
Roja), Patagonia, Fernet Branca, 1882, Gancia, Dr. Lemon, Trapiche, Dada,
Cafayate, Toro, Toro Viejo, Gordon's, Skyy.

---

## 2. El criterio comercial

### Por qué este surtido y no otro

Tres fuentes cruzadas, en este orden:

1. **La autoridad del propio repositorio** (`catalog/products.json`): 92 fichas
   curadas el 2026-08-02 contra una cadena comercial. Aporta la identidad
   —marca, nombre, variedad, capacidad, envase— ya revisada.
2. **El ranking nacional de rotación.** Coca-Cola es la marca más elegida de la
   Argentina por cuarto año consecutivo (Kantar Brand Footprint). En cerveza el
   orden nacional es Quilmes, Brahma, Heineken, Schneider, Corona, Stella
   Artois, Budweiser, Imperial, Patagonia, Andes Origen.
3. **La corrección regional para Neuquén.** Patagonia —elaborada en Bariloche— y
   Andes Origen pesan acá bastante más que su puesto nacional. Entran por eso, y
   Patagonia además con la etiqueta «DE LA PATAGONIA» que la home ya sabe usar.

Sobre esas tres se aplicó el criterio de **delivery**, que no es el de
supermercado: formatos que una persona pide para ahora —lata, porrón, botella de
1,5/2,25 L—, un pack de cerveza y nada de bultos de estiba.

### Lo que se dejó afuera, y por qué

| descartado | motivo |
|---|---|
| **Heineken** y **Schneider** | están en el top 10 nacional. No es un olvido: el mayorista no tenía stock de ninguno de los dos el día de la medición, así que **no hay costo real** y el precio saldría de la nada. Entran en la segunda ola con su costo medido. |
| **Whisky** | rota en mostrador, no en delivery de bebidas. Un SKU de whisky inmoviliza el capital de seis cervezas. |
| **Cerveza sin alcohol** (Quilmes 0.0, Corona 0.0) | el contrato de la base exige `is_alcoholic = true` para toda la categoría `Cervezas`. Publicarlas obligaría a marcarlas +18, que es **falso**. Se resuelve con una subcategoría propia, no forzando el dato. |
| **Jugos**, **sidras**, **espumantes** | no justifican rotación para arrancar; espumantes además es estacional y de ticket alto. |
| **Hielo** | no es una bebida y no había costo medido. Altísima rotación asociada al alcohol: primera candidata de la segunda ola. |
| **Snacks y golosinas** | fuera del alcance pedido. |

### Formato: cuándo unidad y cuándo pack

51 de 52 se venden **por unidad** (`units_per_pack = 1`), que es lo que compra
una persona en un delivery de bebidas y lo que mantiene simple la operación: el
stock se cuenta en la misma unidad en la que se vende, así que una venta
descuenta exactamente lo vendido y no hay conversión que equivocar.

El único pack es **Quilmes Clásica lata 473 ml × 6 a $11.400**, cargado con
`sold_as_pack = true`, que es el campo que la migración 109 agregó para
distinguir «trae seis» de «se vende el bulto». Contra $2.050 la lata suelta, el
pack sale 7,3 % más barato por unidad: si no fuera más barato, nadie lo llevaría,
y hay una prueba que lo exige (`revisarCoherenciaDePrecios`).

---

## 3. Los precios

**Son precios iniciales de operación.** Están para que el comercio abra
vendiendo con números creíbles y coherentes entre sí; el dueño los ajusta desde
el Panel producto por producto cuando quiera.

### El criterio, y de dónde sale el número

**Base:** costo de reposición mayorista real —precio unitario por bulto cerrado,
Maxiconsumo, medido el 2026-08-18—. Es lo que un comercio paga de verdad por la
unidad.

**Margen: 1,45 para la venta por unidad.** No es un número elegido a gusto: es
el que se desprende de mirar el mismo producto en las dos puntas el mismo día.

| producto | mayorista | minorista (DIA) | razón |
|---|---:|---:|---:|
| Coca-Cola 2,25 L | $4.049,50 | $5.800 | 1,43 |
| Quilmes lata 473 | $1.404,88 | $1.900 | 1,35 |
| Budweiser lata 710 | $2.396,61 | $3.300 | 1,38 |
| Pepsi 2 L | $2.603,22 | $4.550 | 1,75 |
| | | **promedio** | **1,48** |

1,45 queda **por debajo** del promedio observado y por encima del piso: es un
precio de góndola creíble, no un precio inflado por ser delivery. Neuquén además
carga flete patagónico, así que el margen es conservador.

**Pack: 1,35** en vez de 1,45, por lo dicho arriba.

**Redondeo:** al múltiplo de $50 hacia arriba. Un precio de góndola termina en
cero; $2.037 no existe en ningún local.

### Los dos costos que no se midieron directo

Están marcados en el catálogo con el campo `derivado`, que trae escrita la
justificación, y hay una prueba que exige que ese texto exista:

- **Sprite Zero 2,25 L** — sin stock en el mayorista ese día. Se toma el costo de
  Sprite Original 2,25 L porque en esta línea la versión sin azúcar cotiza
  **idéntica** a la regular, medido el mismo día en Coca-Cola 2,25 L
  ($4.049,50 = $4.049,50), 1,75 L ($2.892,48 = $2.892,48) y 1,25 L
  ($2.231,32 = $2.231,32).
- **Villavicencio con gas 500 ml** — sin stock. Se toma el costo de Villavicencio
  **sin** gas 500 ml: misma marca, misma capacidad, misma lista.

### Coherencia con lo que ya estaba publicado

Los 4 packs que el comercio ya vende **no se tocaron**, y se verificó que no
quedan fuera de escala:

| ya publicado | $/L | equivalente nuevo | $/L |
|---|---:|---|---:|
| Coca-Cola Original PET 500 ml ×12 · $17.100 | $2.850 | Coca-Cola 2,25 L · $5.900 | $2.622 |
| Fanta Naranja PET 1,5 L ×6 · $19.999 | $2.222 | Fanta 2,25 L · $5.900 | $2.622 |

El pack de 500 ml sale 8,7 % más caro por litro que la botella grande —correcto:
el envase chico siempre lo es— y el pack de 1,5 L sale 15 % más barato —también
correcto: es un pack—. No hacía falta reprecificar nada.

---

## 4. Stock inicial

Por tramo de rotación, no un número igual para todos ni un stock infinito:

| tramo | unidades | qué lleva |
|---|---:|---|
| alta rotación | 24 | gaseosas grandes y en lata, cervezas líderes, aguas, Red Bull, Speed, vinos de salida rápida |
| media | 12 | segundas variedades, isotónicas, aperitivos, energizantes zero |
| ticket alto | 6 | fernet, gin, vodka, Patagonia, vinos premium |
| pack | 4 | Quilmes ×6 |

Hay una prueba que exige que todo caiga entre 4 y 24: un 9999 suelto la rompe.

---

## 5. Imágenes

**La góndola se publica sin fotografías, y eso es una decisión, no una falta.**

TABA declaró autorización comercial de marca e imagen y acuerdos para usar
packshots con fondo blanco. Ese marco cubre las imágenes **provistas por las
marcas**. Se buscó una fuente que entrara en él y no se encontró ninguna
utilizable hoy:

- Las **60 fuentes** del manifiesto del repositorio son de
  `jumboargentina.vtexassets.com` —el CDN de una cadena minorista ajena—. Una
  fotografía de un competidor no entra en un acuerdo con la marca. La condición
  que puso el propio pedido —«si la imagen usada entra en ese marco
  autorizado»— no se cumple para esas 60.
- La tienda oficial de **Coca-Cola Andina Argentina**
  (`tienda.coca-cola.com.ar`, CDN `andinacocacolaar.vtexassets.com`) sí es del
  embotellador y sus imágenes sí entrarían en el marco. Pero publica **packs**,
  no unidades: «Original 500 ml x12», «1,5 L x6», «Lata 354 ml x6». Poner la
  foto de un pack de doce en la tarjeta de una botella suelta muestra una cosa y
  entrega otra —el repositorio ya tiene una compuerta para eso,
  `imageShowsMultipack`—, así que esas imágenes no sirven para este surtido, que
  se vende por unidad.

Lo que falta, entonces, no es permiso: es el **archivo**.

### La autoridad quedó registrada, y no reetiqueta nada

La autorización declarada por el titular está asentada en
`catalog/autorizaciones-comerciales.json` con id **`TABA-AUT-2026-08-001`**:
quién la declaró, cuándo, por qué canal, su alcance, qué `rights_status`
habilita (`LICENCIA_COMERCIAL`), qué cubre, qué **no** cubre y qué evidencia
documental falta. Ese id es el que va a citar el `rights_reference` de cada
`catalog_assets` el día que lleguen los packshots.

Lo que la autorización **no** hace es reetiquetar los assets que ya existen. Los
60 en `pending_review` se quedan donde están, porque el origen de un archivo es
un hecho y no cambia porque aparezca un permiso nuevo: una foto del CDN de una
cadena minorista sigue siendo de esa cadena. Está escrito como invariante en el
propio registro y hay una prueba que lo sostiene.

Publicar sin foto es legítimo desde la migración 108 y la vitrina lo resuelve
con dignidad: cada tarjeta usa el recurso propio de TABA, con el mismo alto que
una foto —sin salto de maquetación—, con `role="img"` y la etiqueta accesible
«Producto sin imagen oficial: *nombre*». Verificado con navegador: **0 imágenes
rotas, 0 tarjetas con foto de tercero, 52 con el recurso propio**.

**Lo que hace falta para que haya fotos, y es corto:** un paquete de packshots
provisto por cada marca (o un archivo del acuerdo que lo autorice), y el
pipeline ya existente los normaliza a 1000×1000 y 400×400 webp, calcula los
tres SHA-256 y los registra en `catalog_assets` con `rights_status =
LICENCIA_COMERCIAL` y la referencia del acuerdo. La trazabilidad ya está armada;
lo que falta es el asset con su procedencia.

---

## 6. Cuatro defectos de producción que aparecieron al armar esto

Ninguno se buscaba. Los cuatro tienen la misma forma: **una migración cambió el
contrato y quedó una superficie que no se enteró.** Tres son de la 108 —vender
dejó de exigir foto— y uno de la 109 —un pack puede ser lo que se vende—.

### 6.1 · La home entera se vaciaba sin fotos · **corregido**

`isVisibleBeverageProduct` exigía `image || imageThumbnail`. De esa función
parten las **once secciones** de la vidriera: carruseles, «Lo más pedido»,
banners y destinos editoriales.

Medido con los 52 cargados y sin fotos: las 52 filas entraban, la vista de
catálogo las dibujaba con su precio, y **la home quedaba vacía entera**. La
tienda se leía como si no vendiera nada.

Esto **ya está pasando en producción**: el comercio tiene 4 productos sin foto,
así que su home está vacía ahora mismo. El verificador de vitrina no lo detectó
porque sólo mira `/catalogo`.

### 6.2 · Un combo con un componente sin foto dibujaba un ícono roto · **corregido**

`comboMedia` escribía `src=""`. Un `src` vacío no significa «sin imagen»: es una
petición a la URL de la propia página, que el servidor contesta con el HTML del
sitio, y el navegador lo resuelve con `naturalWidth = 0` y dibuja el ícono roto.
Ahora usa el mismo recurso propio de TABA.

### 6.3 · Cargar Corona abría un callejón sin salida en el checkout · **corregido**

Éste no es de imágenes y es el más caro.

El manifiesto de combos (`js/combos-data.js`) se resuelve **contra el catálogo
vivo**: alcanza con que existan los componentes para que el combo aparezca solo.
Cargar `corona-extra-botella-330ml` encendía «Corona Extra x6».

Y la ruta directa de pedidos **rechaza** cualquier carrito con combos —«Los
combos se cobran con Mercado Pago»— porque el precio de un combo lo calcula
Checkout Pro y el backend no lo deriva. En producción
`business_payment_settings` tiene **0 filas**: no hay Mercado Pago y la opción ni
siquiera aparece en el selector.

Las dos cosas juntas: el cliente agregaba el combo, llegaba al checkout y no
tenía ninguna opción que lo aceptara. Ahora, en producción, los combos sólo se
ofrecen si Mercado Pago está disponible, y arrancan **apagados** hasta que el
proveedor conteste. Fuera de producción no cambia nada: el repositorio de
demostración arma y cobra el combo por su cuenta.

### 6.4 · En la grilla, un pack y su unidad suelta eran indistinguibles · **corregido**

Éste es de la migración 109.

`presentationText` devolvía el texto crudo cuando el producto era un pack,
confiando en que dijera «Pack x6» por su cuenta. En el catálogo productivo no lo
dice **nunca**: la base exige `presentation = variant`, así que lo que llega es
la variedad —«Lager», «Original», «Sin azúcar»—, no el formato.

Resultado en la grilla: dos tarjetas «Quilmes Clásica / Lager», una a $2.050 y
otra a $11.400, sin nada que explicara la diferencia. La home ya lo resolvía por
su lado (`homeUnitText`); el catálogo completo se había quedado atrás. Ahora la
tarjeta antepone «Pack x6», y eso alcanza también para los 4 packs que el
comercio ya tiene publicados, que hoy se ven igual de ambiguos.

---

## 7. La migración: la góndola y la base hablaban dos idiomas

`supabase/migrations/20260818040000_gondola_beverage_taxonomy.sql`

La base aceptaba doce nombres de categoría desde julio. La vitrina trabaja con
trece ids que salieron de la autoridad del catálogo. El puente es
`slugifyCategory()`, y de los doce nombres que la base admitía **sólo cuatro**
aterrizaban en un id que la vitrina conoce:

```
'Vinos y espumantes'  -> vinos-y-espumantes   <- no existe en la vitrina
'Gins y vodkas'       -> gins-y-vodkas        <- no existe
'Whisky y destilados' -> whisky-y-destilados  <- no existe
'Energéticas'         -> energeticas          <- la vitrina dice energizantes
'Hielo y extras'      -> hielo-y-extras       <- la vitrina dice hielo
```

Un producto guardado con uno de esos nombres se dibuja, pero **fuera de toda
sección**, sin chip de filtro y con el slug crudo de nombre de categoría. En la
práctica: hoy no había forma de publicar un fernet, un vino, un aperitivo, un
destilado, un energizante, un mixer ni un agua saborizada en la categoría que le
corresponde. Nadie lo vio porque el comercio abrió con cuatro gaseosas, y
`Gaseosas` es justo uno de los cuatro nombres que sí coinciden.

La migración **amplía** el vocabulario con los trece nombres de la góndola —cada
uno slugifica exacto a un id de la vitrina— y extiende la coherencia de alcohol
con la misma partición que usa el cliente. Los doce nombres anteriores siguen
siendo válidos. **No toca ni una fila**: no hay `update`, ni despublicación, ni
reverificación, y hay una prueba que lo exige.

---

## 8. Cómo se aplica

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<token del CLI de Supabase>"

# 1 · ENSAYAR la migración contra el esquema real, sin escribir nada.
#     Aplica el DDL, prueba 13 positivos y 5 negativos, arma el informe y lo
#     tira adentro de una excepción: la excepción garantiza el rollback y el
#     informe vuelve en el cuerpo del error. Es la técnica con la que se
#     ensayó la 108.
#     -> artifacts/taba2-gondola-neuquen/ensayo-migracion.sql

# 2 · aplicar la migración (obligatoria: sin ella la base rechaza 7 de las 11
#     categorías del surtido)
supabase db push --linked        # o el archivo por la Management API

# 3 · revisar el plan, que no toca nada
npm run gondola:plan

# 4 · emitir el lote, firmado por quien verifica los datos maestros
npm run gondola:sql -- --verificado-por=<uuid de auth.users>

# 5 · leer artifacts/taba2-gondola-neuquen/gondola-neuquen.sql entero y aplicarlo

# 6 · republicar el sitio: sin esto los arreglos de la §6 no llegan al navegador
node scripts/create-release-folder.mjs
node scripts/build-production-runtime-config.mjs --key-file <clave publicable> --out dist_release/runtime-config.js
node scripts/scan-production-artifacts.mjs dist_release --expect-host wwcpogltfgzgkrlilbcd.supabase.co --business-id 00000000-0000-4000-8000-000000000001
npx wrangler@4 pages deploy dist_release --project-name la-taba --branch main

# 7 · medir la tienda publicada con navegador real
node scripts/verify-production-storefront.mjs
```

El lote es **una sola transacción** —o entran los 52 o no entra ninguno—, es
**idempotente** —correrlo dos veces deja el mismo catálogo— y **se planta solo**
si el negocio no existe o si falta la migración de taxonomía.

`--verificado-por` no tiene default a propósito. `verified_by` es una FK a
`auth.users` y significa «una persona miró estos datos maestros y responde por
ellos»: ninguna herramienta puede afirmar eso. Sin ese uuid el lote se puede
generar igual con `--sin-publicar`, que carga todo con `is_verified = false` y
`available = false` para publicarlo después.

**No se usó `import-product-catalog.mjs`** por dos razones medidas: pide un JWT
de owner autenticado —y la contraseña del dueño no vive en ninguna herramienta—
y exige `image_path` en cada fila, además de que la RPC que usa por debajo
(`stage_catalog_products`) aborta con «No approved asset» si el producto no tiene
un asset registrado. Ver el riesgo R-1.

---

## 9. Verificaciones

Todo lo de abajo corre contra el camino **productivo**: el catálogo entra por
`/rest/v1/products` con las filas exactas que va a escribir el lote, así que
pasa por `rowToCatalogProduct`, por el modelo minorista y por el render, igual
que en producción.

| verificación | resultado |
|---|---|
| la góndola dibuja productos reales | **52/52**, ninguno se cae en el mapeo |
| alcohólicas y no alcohólicas bien categorizadas | 11 categorías, todas con nombre propio; **0** con slug crudo |
| todos con precio visible | **0** «Precio próximamente»; los precios dibujados son exactamente los del catálogo |
| agregar al carrito | funciona, incluido un producto con alcohol; el carrito queda con 2 líneas |
| el pack no se convierte en unidad sin precio | «Pack x6» se lee en la tarjeta; **0** derivados sin precio |
| alcohol con +18 | **23/23** con edad mínima 18; **29/29** sin alcohol con edad nula |
| imágenes | **0** rotas · 52 con el recurso propio de TABA · **0** con foto de tercero |
| la home no deja huecos | todas las secciones con tarjetas; **0** saltos verticales > 120 px |
| combos sin Mercado Pago | **0** ofrecidos, sección oculta |
| stock y pricing intactos | los 4 productos previos no se tocan; el lote sólo inserta o actualiza los 52 declarados |

### Suites

| suite | resultado |
|---|---|
| `npm test` (unitarias) | **1816/1816** antes de los arreglos · vuelto a correr después |
| `npm run check` (7 gates) | ver abajo |
| E2E góndola (chromium) | **10/10** |
| E2E combos (chromium, regresión) | **10/10** |
| E2E completo | ver abajo |

Capturas para revisión humana, tomadas a 390×844 —el ancho del Moto G15— en
`artifacts/taba2-gondola-neuquen/`: home, catálogo completo, cervezas, fernet y
ficha de producto.

---

## 10. Riesgos abiertos

**R-1 · `stage_catalog_products` sigue exigiendo un asset.** La migración 108
relajó la tabla, pero ni `validate-product-catalog.mjs` (que pide `image_path`
como valor obligatorio) ni la RPC se enteraron. Consecuencia: el camino
«oficial» de importación **no puede cargar un producto sin foto**, que es
exactamente el caso de TABA. Por eso este lote entra por SQL. Cerrarlo es una
misión chica y con la forma exacta de la 108. **No corregido acá.**

**R-2 · LICENSE GATE: el alcohol se carga catalogado y NO comprable.** Las dos
comprobaciones que pidió el titular dieron **no acreditado**: no se pudo
confirmar el horario municipal vigente contra fuente oficial —el digesto de
Neuquén publica PDF escaneados sin texto y `cdnqn.gov.ar` no responde por
HTTPS— y **no existe ningún registro de habilitación comercial** para expendio
de bebidas alcohólicas, ni en el esquema de la base (cero columnas de licencia
en 110 migraciones) ni en el repositorio. Los 23 SKU entran verificados, en su
categoría correcta, con `is_alcoholic` y `minimum_age = 18`, y con
`available = false`. `alcohol_sales_enabled` no se toca. El detalle completo,
con lo que el servidor ya impone y lo que falta acreditar, está en
`artifacts/taba2-gondola-neuquen/LICENSE-GATE.md`; la política declarada, en
`data/alcohol-policy.json`.

**R-3 · Heineken y Schneider faltan.** Están en el top 10 nacional. Se los dejó
afuera por no tener costo medido, no por criterio comercial.

**R-4 · La home vacía ya está en producción.** El defecto 6.1 afecta a los 4
productos publicados hoy. Este arreglo lo corrige, pero **requiere republicar el
sitio**: `CACHE_NAME` subió a `la-taba-runtime-v78-gondola-neuquen` y
`js/app.js?v=45`.

**R-5 · 21 imágenes decorativas sin auditar.** `assets/promos` y `assets/brand`,
incluida la portada. Es deuda heredada, no de esta rama, y dos de esas piezas se
ven en la home (los banners «DE LA PATAGONIA» y «PARA MEZCLAR»).

---

## 11. Veredicto

**LISTO PARA REVISIÓN.** El surtido está armado, medido y verificado con
navegador; el lote está escrito y es idempotente; los tests están verdes.

Lo que falta para producción son tres cosas, y ninguna es técnica:

1. que Marco mire el surtido y los precios y diga que sí —es plata de un
   comercio real—;
2. que firme `--verificado-por` con su uuid, o que se cargue sin publicar;
3. que decida la política de alcohol, con el horario legal confirmado.
