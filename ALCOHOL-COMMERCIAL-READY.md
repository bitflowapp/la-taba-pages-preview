# TABA — frente alcohólico, estado al 2026-08-26

Rama `feature/taba2-alcohol-commercial-ready`, desde main `9d14844`.

**La venta de alcohol sigue cerrada y esta rama no la abre.** `alcohol_sales_enabled`
está en `false` y los 27 productos con alcohol siguen con `available = false`.
Todo lo de abajo es trabajo que se puede hacer *sin* esa decisión, más el mapa
exacto de lo que falta para tomarla.

---

## Los números

| | |
|---|---|
| SKU alcohólicos | **27** |
| con packshot real | **17** (eran 12) |
| bloqueados por identidad de la foto | **10** |
| altas nuevas creadas | **0** — no hay precio real (§3) |
| promociones preparadas | **6**, todas INACTIVAS |
| promociones activas | **0** |
| `alcohol_sales_enabled` | **false** |
| compuertas de la política | **1** abierta de 5 (eran 5 de 5) |

---

## 1. Fotografías · 12 → 17

Las cinco nuevas y por qué aparecieron ahora:

| SKU | Fuente | Cómo se resolvió |
|---|---|---|
| `trapiche-origen-malbec-750ml` | distribuidor oficial (Peñaflor vía Coca-Cola Andina) | El packshot estaba descargado desde el **2026-08-18** y sin publicar. No faltaba la foto: faltaba el permiso, y el permiso ya existía (§5). |
| `gin-gordons-700ml` | distribuidor oficial | La etiqueta dice «LONDON DRY GIN» y el sello inferior «37,5 % vol · 70 cl». El descubrimiento la había dejado en MEDIA porque el título del distribuidor no nombra la línea. |
| `brahma-chopp-lata-710ml` | retail autorizado (Disco/Vea) | Existe fuera de Jumbo, que fue la única cadena del barrido anterior. |
| `dr-lemon-vodka-pomelo-lata-473ml` | retail autorizado (Disco) | Ídem. El informe anterior la daba por inexistente. |
| `dada-caramel-750ml` | retail autorizado (Disco) | La etiqueta dice «DADÁ · CARAMEL · FINCA LAS MORAS · #9». El descubrimiento sólo había visto otras variantes de Dadá. |

**Rechazos sostenidos, con causa medida.** No son pendientes: son decisiones.

- `quilmes-clasica-botella-710ml` — lo que ofrece el retailer es una **lata**, no
  una botella, y encima la edición limitada del Mundial.
- `cafayate-torrontes-750ml`, `gancia-americano-450ml`, `vodka-skyy-700ml` — son
  close-ups con el envase **cortado fuera del cuadro**: el producto toca el borde
  superior y el inferior. Media botella no es un packshot. (La etiqueta de las
  tres es correcta y legible; el problema es el encuadre.)
- `quilmes-clasica-lata-473ml`, `quilmes-clasica-lata-473ml-pack-6`,
  `andes-origen-roja-lata-473ml`, `fernet-1882-750ml`, `toro-tinto-1000ml`,
  `toro-viejo-clasico-tinto-750ml` — sin candidata exacta en ninguna de las
  cadenas consultadas. Los formatos de Andes Roja 473 y del pack x6 de Quilmes
  podrían estar discontinuados: **conviene confirmarlo con el comercio antes de
  exhibirlos**, porque un SKU discontinuado con foto es peor que uno sin foto.

Fuentes de fabricante probadas y descartadas en esta vuelta, para que nadie
repita el barrido: Porta Hnos publica la ficha de Fernet 1882 sólo con fotos de
receta; los sitios de marca de Gancia y Dr. Lemon son campañas sin packshot; los
dominios de tienda de AB InBev (`tienda.quilmes.com.ar`, `tada.com.ar`,
`craftsociety.com.ar`) no resuelven.

---

## 2. Un defecto que se llevaba trabajo firmado por delante

Correr `catalog:images:stage` **desaprobaba** cualquier SKU que el
descubrimiento volviera a proponer: escribía la fila de nuevo con
`REVISAR_IMAGEN`, con los mismos bytes y la misma fuente. El pie del propio
guion afirmaba lo contrario.

Pasó en esta sesión: una corrida rutinaria bajó los **cuatro packs oficiales
aprobados el 2026-08-18**, y el síntoma apareció dos pasos después —`verify`
encontró ocho WebP publicados sin entrada en el manifiesto—, no donde estaba la
causa. Corregido: si el SHA-256 no se movió, la aprobación se conserva entera,
sin reescribir el `checked_at` ni la nota. Si se movió, cae.

---

## 3. Precio y stock · por qué no se creó ninguna alta

Las 11 altas que la investigación recomendó (Fernet Branca 750 y 450, Chandon
Extra Brut, Smirnoff, Schneider, Johnnie Walker Red, Aperol, Campari, Beefeater,
Heineken, Trivento) **no se pueden crear**: `products.price` es NOT NULL y
`stage_catalog_products` rechaza `price <= 0`. No hay ruta de borrador sin precio.

Se buscó el precio por los dos caminos legítimos que tiene el proyecto y ninguno
lo da:

1. **La planilla del comercio** (`catalog/planilla-negocio.csv`): 81 filas, 11
   con precio, y esos 11 son SKU de la demo (Heineken, Imperial, Schneider Rubia
   710) — no los de producción. No hay lista firmada por el comercio.
2. **El costo mayorista medido**, que es de donde salen los 72 precios actuales
   (`catalog/gondola-neuquen.mjs`: costo real × 1,45, pack × 1,35, redondeo a
   $50). La fuente —Maxiconsumo— hoy renderiza su catálogo por JavaScript y
   redirige de sucursal, así que no se puede medir un costo confiable, y un
   costo dudoso produciría un precio inventado.

**Ocho assets de esas altas están listos, con fuente y SHA-256**, en
`docs/catalog/alcohol-altas-assets-listos.csv`. Con un precio real, las altas se
crean en una corrida.

---

## 4. Promociones · seis preparadas, cero publicadas

`catalog/promos-alcohol.mjs` + `npm run alcohol:promos`.

| Combo | Ocasión | Lista | Promo | Ahorro | Margen |
|---|---|---|---|---|---|
| Fernet y Coca | previa | $32.150 | $30.200 | **$1.950 · 6,1 %** | ×1,364 |
| Gin Tonic en casa | juntada | $20.050 | $18.800 | **$1.250 · 6,2 %** | ×1,362 |
| Vodka y energía | previa | $15.200 | $14.100 | **$1.100 · 7,2 %** | ×1,354 |
| Previa surtida x6 | previa | $14.100 | $13.100 | **$1.000 · 7,1 %** | ×1,355 |
| Asado con tinto | asado | $6.850 | $6.400 | **$450 · 6,6 %** | ×1,371 |
| Tinto y blanco | juntada | $11.550 | $10.800 | **$750 · 6,5 %** | ×1,361 |

**El descuento no lo eligió nadie.** Un combo es un pack armado con productos
distintos, así que se le exige el mismo piso que la góndola le exige a un pack
—×1,35 sobre el costo mayorista medido— y el descuento de cada uno es el entero
más alto que lo deja ahí.

**Lo incómodo, dicho de frente: con margen base 1,45 el techo real de estos
combos está entre 6 % y 7 %.** Un «30 % OFF» en esta góndola sería vender por
debajo del piso de pack o mentir sobre el precio de lista. Si el comercio quiere
descuentos más grandes, la palanca es el costo, no el cartel.

Sólo entran componentes con **costo medido**: los cuatro packs de cerveza
derivan su precio de una referencia minorista y su margen no se puede probar.
La «Previa surtida x6» mezcla tres cervecerías justamente para no duplicar
ningún SKU de pack.

Quedan en `PENDIENTE_APROBACION_COMERCIAL` y **no se cablearon a
`COMBO_MANIFEST`**: hoy sus componentes están fuera de venta, así que publicarlas
agregaría seis tarjetas permanentemente bloqueadas a la góndola.
`tests/promos-alcohol.test.mjs` prueba que enchufarlas va a funcionar —misma
aritmética y mismo redondeo que `js/core/combos.js`— y que ninguna se puede
cobrar sin aprobación.

---

## 5. Derechos · el permiso existía desde el 2026-08-25 y el código no se enteró

`stage-candidates.mjs` llevaba el alcance escrito a mano
(`['marca','fabricante','propio']`), correcto el 2026-08-18. El **2026-08-25** el
titular amplió el marco a `distribuidor_oficial` **nombrando el packshot de
Trapiche como el caso que su redacción anterior había dejado afuera**. El guion
siguió estampando FUERA DE ALCANCE sobre esa fuente ocho días.

Ahora el alcance se **deriva** de `catalog/autorizaciones-comerciales.json`: base
más la unión de las ampliaciones, cada una con su `habilita_source_types`.
Ampliar el marco es editar un archivo, no dos.

---

## 6. Política de alcohol · cinco compuertas → una

Estado leído de producción el 2026-08-26, **después** de aplicar:

```
alcohol_sales_enabled = false      ← la única que queda, y es humana
alcohol_minimum_age   = 18
alcohol_sales_start   = 09:00
alcohol_sales_end     = 23:00
alcohol_timezone      = America/Argentina/Buenos_Aires
```

Se pudo cargar la política con la venta apagada porque el CHECK es
`not alcohol_sales_enabled or (...)`. Eso separa la **configuración** —dato que
el titular ya había declarado— de la **habilitación**, que es una decisión con
consecuencias legales. `npm run alcohol:compuerta` audita; **no hay bandera para
encender la venta, y no debe haberla.**

Se escribió con la identidad `admin` de la automatización a propósito, para que
`business_config_audit` registre `actor_kind='user'` con su `actor_id`, y no el
`service` anónimo que dejó el `delivery_fee = 0` sin dueño.

### El hallazgo: la política era escribible y no legible

Las cinco columnas están en el grant de **UPDATE** de `businesses` y **ninguna en
el de SELECT**, y `get_business_operations_config` —lo único que lee el Panel— no
devolvía ninguna. Un comercio podía fijar su edad mínima y su ventana horaria y
no tenía **ninguna superficie donde verlas**; la única forma de descubrir que la
configuración estaba incompleta era que un cliente real no pudiera comprar,
porque `create_order` valida los cinco al momento de la venta.

`supabase/migrations/20260826120000_alcohol_policy_readable.sql` lo cierra sin
tocar ningún grant: la lectura pasa por la función, que ya exige rol. Queda
**PREPARADA, no aplicada** — el DDL productivo de este repositorio pide
autorización humana explícita.

**Lo que esa migración NO cierra:** el cliente anónimo sigue sin poder leer la
ventana horaria, así que la tienda sólo puede explicar el rechazo *después* de
intentar el pedido, y no impedir que se agregue al carrito fuera de horario como
pide la regla declarada. Qué parte de la política de un comercio es pública es
una decisión aparte y no se toma de costado.

---

## 7. Lo que falta, y de quién es

| # | Qué | De quién |
|---|---|---|
| 1 | **Habilitación comercial de expendio de bebidas alcohólicas del local.** No hay ningún registro de habilitación en el esquema ni en el repositorio: no es que falte cargarlo, es que no existe dónde. | Titular |
| 2 | **Confirmar que el horario 09:00–23:00 sigue vigente en Neuquén Capital.** No se pudo verificar contra fuente oficial: el digesto municipal publica PDF escaneados sin capa de texto y `cdnqn.gov.ar` no responde por HTTPS. | Titular / legal |
| 3 | **Precio real de las 11 altas.** Sin él no se pueden crear. | Titular |
| 4 | **Confirmar si Andes Origen Roja 473 y el pack x6 de Quilmes siguen existiendo.** Ninguna cadena los lista. | Titular |
| 5 | Aplicar la migración `20260826120000` a producción. | Humano con autorización de DDL |

Con 1 y 2 acreditados, el encendido es: `alcohol_sales_enabled = true` a mano →
`available = true` en los 27 → aprobar las promociones. **En ese orden**:
publicar los productos antes de habilitar la venta deja al cliente agregar al
carrito algo que `create_order` va a rechazar.
