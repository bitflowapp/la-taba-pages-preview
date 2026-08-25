# Ofertas de lanzamiento — qué se puede ofrecer, y qué no

Este documento tiene dos partes. La primera es **el mecanismo**: cómo se destaca
un producto en la tienda sin tocarle el precio, qué escribe eso en la base y cuál
es la trampa que hay que conocer antes de escribir la primera etiqueta. La
segunda es **qué se puede ofrecer de verdad** con los precios y las compuertas
reales de producción, para que el titular decida.

Nada está aplicado y nada toca un precio. Activar una promoción es una decisión
del comercio.

> **Revisión del 2026-08-25.** La sección 2 se reescribió entera. La versión
> anterior recomendaba destacar el pack x12 como «el mejor precio por litro del
> catálogo» —**es 8,7 % más caro por litro que la familiar de 2,25 L**— y
> proponía dos combos que en producción no se pueden cobrar. Las tres
> correcciones, con su aritmética, abren la sección 2.

---

## 1 · El mecanismo

### Por qué las etiquetas y no el motor de promociones

La Taba tiene un motor de promociones completo —descuento, vigencia, condición,
badge, precio tachado— y **en producción no llega al cliente**. `js/state.js`
lo alimenta así:

```js
promotions: isDemoMode() ? normalizePromotionCollection(PREVIEW_PROMOTION_SEED) : [],
```

En la tienda real la lista está vacía y no hay ninguna fuente que la llene.
Darle una exige tabla, RLS, RPC y migración: trabajo de backend que no se empieza
la semana que el comercio abre.

Las **etiquetas** sí llegan vivas. `products.tags` es una columna que el comercio
escribe, `supabase_order_repository` la lee y la tarjeta la dibuja. Y no toca el
precio, así que destacar deja de ser una operación de riesgo comercial.

### El vocabulario, que es cerrado

Vive en `js/core/merchandising-tags.js` con sus tests. Una etiqueta que no esté
en esta lista **no dibuja nada**:

| etiqueta | pastilla en la tarjeta |
|---|---|
| `lanzamiento` | **Lanzamiento** |
| `oferta-finde` | **Oferta del finde** |
| `promo` · `promoción` | **Promo** |
| `combo` | **Combo** |
| `destacado` | **Destacado** |
| `popular` · `más vendido` | **Recomendado** |

Es cerrado a propósito. Evita que el día que alguien escriba `2x1` o `50% off`
la góndola prometa un descuento que el checkout no va a cobrar: acá sólo se
puede DESTACAR. Un descuento real sigue exigiendo un precio real.

`popular` dice **Recomendado** y no «Más pedido»: el comercio no tiene ninguna
métrica de ventas que respalde un ranking. Es la misma regla que hace que el rail
de la home se llame «Recomendados del local».

### Dónde se ve

Desde esta versión, en las tres superficies: la grilla del catálogo (abajo a la
derecha del plato), los carruseles de la home y la ficha del producto. Antes la
pastilla existía sólo en la home y en la ficha, así que una oferta etiquetada no
se veía justamente donde el cliente compara y compra.

### LA TRAMPA CARA

El disparador `products_fail_close_master_change` cuenta **`tags` como dato
maestro**. Escribir una etiqueta de merchandising baja `available=false` e
`is_verified=false` igual que si cambiaras un precio: el producto queda **fuera
de venta** hasta que se lo vuelve a publicar. Es `BEFORE UPDATE` y pisa lo que
escribas en la misma sentencia.

**La operación es de DOS pasos, nunca de uno:**

```sql
-- 1) etiquetar
update public.products
   set tags = array(select distinct unnest(tags || array['lanzamiento']))
 where business_id = '00000000-0000-4000-8000-000000000001'
   and sku in ('coca-cola-original-2250ml', 'sprite-original-2250ml');
```

```
-- 2) volver a publicar, SIEMPRE, y en la misma sesión
node scripts/reparar-verificacion-tras-curacion.mjs
```

El 2026-08-22 esto costó ~8 minutos de tienda con 19 productos comprables en vez
de 32, por hacerlo en un paso. No se repite.

### Para quitar una oferta

```sql
update public.products
   set tags = array_remove(tags, 'oferta-finde')
 where business_id = '00000000-0000-4000-8000-000000000001';
```

Y el paso 2 otra vez.

---

## 2 · Qué se puede ofrecer este fin de semana, y qué no

Revisado contra producción el **2026-08-25**. Esta sección **reemplaza** a la
anterior, que proponía cinco ofertas: **dos eran combos que en producción no se
pueden cobrar**, **una afirmaba un ahorro que no existe** y **una dependía de una
configuración que nadie había hecho**. Las tres correcciones abren la sección,
con su aritmética, porque el error importa más que las propuestas.

### CORRECCIÓN 1 · el pack x12 NO es el mejor precio por litro

La propuesta 3 anterior decía, textual, que «el pack YA es el mejor precio por
litro del catálogo» y era la recomendación número uno del documento. La cuenta
dice lo contrario:

| producto | precio | litros | **$/L** |
|---|---:|---:|---:|
| Coca-Cola Original 2,25 L | $ 5.900 | 2,25 | **$ 2.622** |
| Coca-Cola Original pack x12 · 500 ml | $ 17.100 | 6,00 | **$ 2.850** |
| Coca-Cola Original PET 1,5 L | $ 4.990 | 1,50 | **$ 3.327** |
| Coca-Cola Original lata 354 ml | $ 1.800 | 0,354 | **$ 5.085** |

El pack es **8,7 % más caro por litro** que la botella familiar. Publicar aquella
frase en la vidriera habría sido una **falsedad comercial en el fin de semana de
apertura**: el cliente que compara paga más creyendo que ahorra.

El más barato por litro del catálogo entero es la **Soda Manaos de 2 L a $ 875/L**,
y entre las colas, la **familiar de 2,25 L**, que ya es `recomendado-01`.

Lo que el pack sí ofrece es **formato**: doce envases individuales, que se enfrían
y se reparten. Se vende por eso, no por precio.

**Aplicado en esta versión, en el código y sin tocar ningún dato:** la tarjeta y
la ficha de todo producto con `units_per_pack > 1` dicen ahora **«$ 1.425 por
botella»** bajo el precio. Es una división, no una promoción: no afirma ahorro,
no compara y no necesita ningún costo. Y deja que el cliente haga la única
cuenta que la góndola no le hacía.

### CORRECCIÓN 2 · un combo no se puede cobrar en producción

Las propuestas 1 y 2 anteriores eran combos. En producción **ningún combo llega
al cliente, y si llegara no se podría cobrar**. Son dos compuertas independientes,
las dos activas hoy:

1. `app.js` arranca los combos APAGADOS en producción y sólo los enciende la
   respuesta del proveedor de pagos (`setComboCheckoutAvailability({ available:
   !production })`). Mercado Pago no está configurado —`business_payment_settings`
   tiene cero filas— así que nunca se encienden.
2. Aunque se encendieran, `validateCartForCheckout` rechaza cualquier carrito con
   combos que no pague con Mercado Pago: «Los combos se cobran con Mercado Pago».
   El precio de un combo lo deriva Checkout Pro; la ruta directa de pedidos sólo
   acepta líneas de producto.

O sea que un combo no está bloqueado por margen: está bloqueado por **cobro**.
Habilitarlo exige contratar y configurar Mercado Pago, que es una decisión
comercial con credenciales, no un ajuste de catálogo.

### CORRECCIÓN 3 · ningún descuento se puede aprobar todavía

`unit_cost` está en **NULL en los 72 productos** de producción. Medido, no
supuesto:

```sql
select count(*) filter (where unit_cost is not null) from public.products;  -- 0
```

Sin costo no hay margen que verificar, así que **este trabajo no baja ni un
precio**. Cada propuesta de abajo dice exactamente qué dato falta para aprobarla.

---

### Lo que SÍ se puede hacer antes del viernes

#### A · FIJAR EL ENVÍO Y EL MÍNIMO — no es una promoción, es configuración

Hoy la tienda le dice a cada cliente **«Envío a domicilio $ 0»** en el resumen
del checkout. Ese cero no lo puso el comercio. La auditoría de la propia base lo
dice, y el Panel lo repite en pantalla:

```
business_config_audit · scope=delivery_pricing · actor_kind=service · actor_id=null
  antes:   delivery_fee=null   minimum_delivery_subtotal=null
  después: delivery_fee=0      minimum_delivery_subtotal=0
  2026-08-18 01:11:26Z
```

> Panel → Horarios y cobertura → Qué se cambió:
> **«El servidor editó envío y mínimo 17/08/2026, 22:11 — envío — → 0 · mínimo — → 0»**

Es el único «descuento» que la tienda está publicando hoy, y nadie lo decidió.
Si el comercio quiere regalar el envío el fin de semana de apertura, que sea una
**decisión escrita**; si no, hay que ponerle precio antes de que entre el primer
pedido.

- **Dónde**: Panel → *Horarios y cobertura* → *Envío y pedido mínimo del comercio*
- **Riesgo de no hacerlo**: cada entrega del fin de semana sale gratis
- **Dato que falta**: cuánto cuesta un reparto, que lo sabe el comercio

#### B · MOSTRAR EL PRECIO POR ENVASE EN LOS PACKS — hecho

Ver la corrección 1. Ya está en el código de esta versión, sin tocar la base.

#### C · UNA ETIQUETA DE LANZAMIENTO — barata, con una trampa conocida

El vocabulario de la sección 1 permite destacar sin tocar precios. Candidatos
naturales, todos con stock alto y foto propia:

| SKU | precio | stock | etiqueta sugerida |
|---|---:|---:|---|
| `coca-cola-original-2250ml` | $ 5.900 | 24 | `lanzamiento` |
| `sprite-original-2250ml` | $ 5.900 | 24 | `lanzamiento` |
| `speed-original-473ml` | $ 2.850 | 24 | `oferta-finde` (previa del viernes) |

**No está aplicado.** La curación de la vidriera la decidió el titular el
2026-08-22 por escrito y no se pisa sin su visto bueno. Además cada escritura de
`tags` dispara `products_fail_close_master_change` y saca el producto de venta
hasta re-publicarlo: es la operación de DOS pasos de la sección 1, y no se hace
sin alguien mirando.

#### D · UN PRECIO DE LANZAMIENTO EN UN SOLO SKU — listo salvo el costo

Si el comercio quiere un gancho real, el candidato más limpio es la familiar de
2,25 L, que ya es la más vista de la góndola:

| | |
|---|---|
| Qué | Coca-Cola Original 2,25 L |
| Precio hoy | $ 5.900 · $ 2.622 por litro |
| Sugerido | **$ 5.400** · $ 2.400 por litro (−8,5 %) |
| Stock | 24 unidades |
| **Dato que falta** | el costo de compra de la botella. Con la factura del proveedor a mano, la cuenta es de un minuto: a $ 5.400 el margen del 30 % exige un costo ≤ $ 3.780 |

Un SKU y no cinco: es el que más se mira, el cambio se revierte con una línea y
no depende de ningún motor de promociones.

---

## 3 · Recomendación, en una línea

**Fijar el envío y el mínimo (A) antes de que entre el primer pedido.** Es lo
único de esta lista que no es opcional, no es una promoción, y hoy está
regalando plata sin que nadie lo haya decidido. Lo demás puede esperar al lunes.
