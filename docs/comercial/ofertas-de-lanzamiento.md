# Ofertas de lanzamiento — cómo se activan, y cinco propuestas

Este documento tiene dos partes. La primera es **el mecanismo**: cómo se destaca
un producto en la tienda sin tocarle el precio, qué escribe eso en la base y cuál
es la trampa que hay que conocer antes de escribir la primera etiqueta. La
segunda son **cinco propuestas comerciales** con los precios reales de
producción al 2026-08-25, para que el titular decida.

Ninguna de las cinco está aplicada. Ninguna toca un precio. Este trabajo dejó la
estructura lista; activar una promoción es una decisión del comercio.

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

## 2 · Cinco propuestas para el fin de semana de apertura

Precios **reales de producción al 2026-08-25**. Ninguna está aplicada.

> **Sobre el margen.** El costo de compra de cada SKU no está en el sistema:
> `products` guarda precio de venta y stock, no costo. Por eso cada propuesta
> dice **qué costo unitario máximo la hace viable** al margen que el titular
> quiera sostener, en vez de afirmar un margen que nadie puede calcular desde
> acá. Con la factura del proveedor a mano, la cuenta es de un minuto.

### Propuesta 1 · COMBO JUNTADA — dos familiares de 2,25 L

| | |
|---|---|
| Qué | Dos gaseosas de 2,25 L a elección (Coca-Cola, Coca-Cola Zero, Sprite, Sprite Zero, Fanta) |
| Precio normal | $ 11.800 (2 × $ 5.900) |
| Precio propuesto | **$ 10.900** |
| Descuento | $ 900 · 7,6 % |
| Stock que lo soporta | 24 + 24 + 24 + 12 + 24 = 108 unidades |
| Viable si | el costo unitario de la 2,25 L es ≤ $ 3.815 (margen 30 % sobre el precio promocional) |

Es la promoción más fácil de vender de la lista: cinco SKU la habilitan, todos con
stock alto, y el 2,25 L es el formato de delivery por excelencia.

### Propuesta 2 · COMBO PREVIA — energizante + gaseosa familiar

| | |
|---|---|
| Qué | Una energizante (Speed 473, Red Bull 250, Monster Zero 473) + una gaseosa 2,25 L |
| Precio normal | $ 8.750 a $ 9.150 según la energizante |
| Precio propuesto | **$ 8.200** |
| Descuento | $ 550 a $ 950 · 6 % a 10 % |
| Stock que lo soporta | 24 + 24 + 12 energizantes |
| Viable si | el costo del par es ≤ $ 5.740 (margen 30 %) |

Apunta al ticket de viernes a la noche, que es exactamente el turno del
lanzamiento.

### Propuesta 3 · PACK AHORRO — el pack cerrado x12, ya cargado

| | |
|---|---|
| Qué | Pack x12 de 500 ml (Coca-Cola Original, Coca-Cola Zero o Sprite) |
| Precio normal | $ 17.100 · $ 1.425 por botella |
| Precio propuesto | **sin cambio de precio: sólo etiqueta `destacado`** |
| Por qué | El pack YA es el mejor precio por litro del catálogo, y hoy no se ve: cae al puesto 10 de la góndola |
| Stock | 7 + 8 + 8 = 23 packs |
| Riesgo | ninguno: no toca precio |

Es la propuesta de mayor retorno por menor riesgo de las cinco. El trabajo no es
bajar un precio, es **mostrar el que ya existe**.

### Propuesta 4 · PACK FAMILIAR — tres familiares surtidas

| | |
|---|---|
| Qué | Tres gaseosas de 2,25 L surtidas |
| Precio normal | $ 17.700 |
| Precio propuesto | **$ 15.900** |
| Descuento | $ 1.800 · 10,2 % |
| Comparar con | el pack x12 de 500 ml sale $ 17.100 por 6 L; esto son 6,75 L por $ 15.900 |
| Viable si | el costo unitario es ≤ $ 3.710 (margen 30 %) |

**Atención**: esta propuesta compite con el pack cerrado. Conviene activar la 3
o la 4, no las dos el mismo fin de semana.

### Propuesta 5 · LANZAMIENTO — envío bonificado el viernes y el sábado

| | |
|---|---|
| Qué | Envío sin cargo por compras sobre un mínimo, viernes y sábado |
| Precio de los productos | **sin cambios** |
| Costo para el comercio | el del reparto, que hoy es $ 0 configurado (nadie lo fijó) |
| Requiere antes | que el titular fije el costo de envío y el mínimo en el Panel |
| Riesgo | el fee y el mínimo están en $ 0/$ 0 puestos por un script de plataforma, no por el comercio. Anunciar «envío sin cargo» sobre un valor que nadie fijó no es una promoción: es no haber configurado el envío |

Es la única de las cinco que **no se puede activar hoy**, y por eso está: hay que
fijar fee y mínimo en el Panel antes de que la tienda reciba tráfico, con o sin
promoción.

---

## 3 · Recomendación, en una línea

Para el fin de semana de apertura: **la 3 y la 1**. La 3 no toca ningún precio y
pone a la vista el mejor precio por litro que el catálogo ya tiene; la 1 es la
única que se explica sola en la tarjeta y tiene 108 unidades de stock detrás.
La 5 no es opcional, pero no es una promoción: es configuración pendiente.
