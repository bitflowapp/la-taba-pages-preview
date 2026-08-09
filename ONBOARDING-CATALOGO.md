# Onboarding comercial del catálogo

Cómo pasar de «91 registros y once cosas que se pueden comprar» a una góndola
vendible, cuando el negocio entregue los datos. Sin inventar ni un precio.

---

## El camino, en cuatro comandos

```bash
node scripts/catalog-readiness.mjs          # 1. qué falta, SKU por SKU
node scripts/catalog-commercial-sheet.mjs   # 2. la planilla que se manda
# … el negocio completa precio, stock y publicar …
node scripts/import-commercial-catalog.mjs catalog/planilla-negocio.csv   # 3. dry-run
node scripts/import-commercial-catalog.mjs catalog/planilla-negocio.csv \
     --apply --target supabase                                            # 4. aplicar
```

El paso 3 no escribe nada y es obligatorio: imprime el reporte de cambios
—qué precio pasa de cuánto a cuánto, qué se publica, qué queda igual— para que
alguien lo lea antes de que exista.

---

## 1. Qué se puede resolver por SKU hoy

Auditoría de las planillas del repositorio, medida y no estimada:

| Dato | ¿Resoluble por SKU? | Dónde vive |
|---|---|---|
| categoría | **sí**, los 92 | `catalog/products.csv` · `category_id` |
| alcohol sí/no | **sí**, los 92 | `age_restricted`, respaldado por `alcohol_percentage` |
| foto | **sí** — 82 con archivo en disco, 10 sin ruta | `image_master` / `image_thumbnail` |
| precio | **parcial** — 20 confirmados, 71 pendientes, 1 rechazado | `price` + `price_status` |
| combo / promoción | **sí** — 8 SKU en 7 combos aprobados | `data/combos.csv` |
| publicar sí/no | **parcial** — 71 `blocked`, 21 en blanco | `publication_status` |
| **stock** | **NO** | **no existe la columna** |

Y un tercero que no está en las planillas sino en la base: **`products.price` es
`not null check (price >= 0)`**. La base **no puede** representar «todavía no
tiene precio»: lo termina guardando como **0**. O sea que el peligro de «precio
NULL convertido a cero» no es hipotético, está horneado en el esquema. La única
defensa posible es que nada publique ni venda con precio 0, y eso es lo que
imponen el importador y el RPC, y lo que verifica el simulacro contra una base
real.

Dos huecos en las planillas, y sólo dos:

1. **El stock no tiene dónde vivir en la planilla técnica.** `products.csv`
   guarda `stock_status` (`confirmation_required` en 90 de 92), que es una
   categoría, no un número. Sin unidades no se puede publicar nada: el
   storefront exige `stock > 0` para que un producto sea comprable.
2. **Ninguna foto tiene derechos comerciales acreditados.** Las 92 filas están
   en `pending_review` o en blanco, y las 60 candidatas del manifiesto de
   investigación vienen de cadenas comerciales secundarias. No bloquea la venta
   —el sistema las publica igual— pero es una decisión del negocio, no un
   defecto del software.

Además hay **dos taxonomías de categoría** que no se hablan: la del importador
técnico (`Gaseosas`, `Energéticas`, `Gins y vodkas`, `Picadas y deli`…) y la del
storefront (`gaseosas`, `energizantes`, `destilados`, `hielo`…). El importador
comercial no las toca —no cambia categoría— así que el hueco no lo bloquea,
pero cualquier alta nueva va a tropezar con él.

---

## 2. La planilla del negocio

`catalog/planilla-negocio.csv`. Ocho columnas: cuatro se leen, cuatro se
completan. **Ningún campo técnico.**

| Columna | Quién la usa |
|---|---|
| `sku` | se lee — la llave, no se toca |
| `producto` | se lee — «Glaciar Sin gas, baja en sodio · Botella PET · 1,5 L» |
| `categoria` | se lee |
| `alcohol` | se lee — `si` / `no` |
| **`precio`** | **se completa** — pesos, sin puntos de mil, sin coma, sin `$` |
| **`stock`** | **se completa** — unidades enteras; `0` vale y significa agotado |
| **`publicar`** | **se completa** — `si` / `no`; vacío es «todavía no decidí» |
| **`notas`** | **se completa** — opcional, interna |

Se **genera**, no se escribe a mano: `--check` falla si la committeada envejeció
respecto del catálogo. Una planilla escrita a mano sigue pidiendo un precio el
día que ese precio ya se cargó.

Lo que ya está cargado viaja como valor inicial. Lo que falta va **vacío a
propósito**: un cero ahí sería un precio inventado.

---

## 3. Qué bloquea el importador

Falla **cerrado**: un solo problema aborta la importación entera. Cargar sesenta
precios y que tres queden mal es peor que no cargar ninguno, porque esos tres se
descubren vendiendo.

| Bloqueo | Por qué |
|---|---|
| SKU desconocido | por acá no se dan de alta productos |
| SKU duplicado | dos filas para el mismo producto no tienen un ganador obvio |
| precio con `$`, punto de mil o coma | es lo que produce un Excel en español sin avisar |
| precio `0`, negativo o con más de dos decimales | un producto a `$0` se vende gratis |
| notación científica | `1e3` en una celda de precio no es un precio |
| stock negativo, decimal o no numérico | el stock son unidades enteras |
| pack de abastecimiento (`…-pack-N`) | el local se surte con él; el cliente no lo compra |
| SKU con pinta de fixture de QA | el 8 de agosto una persona real compró «QA TEST iPhone» |
| `publicar=si` sin precio, sin stock o sin foto | sería una tarjeta que nadie puede comprar |
| `publicar=si` con `stock=0` | ídem: visible y sin poder agregarse |

Una celda **vacía nunca es un cero**. Es «no lo decidí»: no cambia el valor
guardado. Esa distinción es la razón de ser de `parseSheetPrice`, y está cubierta
por tests que fallan si alguien la rompe.

---

## 4. Por qué hizo falta un RPC nuevo

Antes de esta rama **no había forma segura de ponerle precio a un producto que
ya existe**. Las dos puertas del backend no servían:

- `grant update (stock, available, is_active, sort_order) on public.products`
  deja mover stock y visibilidad, pero **no precio**. A propósito.
- `import_catalog_batch` sí escribe precio, pero es la puerta de **alta**: exige
  la fila técnica completa más un asset aprobado, y su `on conflict do update`
  termina en `available = false, is_verified = false`. Es decir: **cargar un
  precio por ahí despublica el producto**. Cargar los 70 que faltan bajaría la
  góndola entera y obligaría a republicar de a uno.

`20260809050000_commercial_catalog_price_and_stock_batch.sql` agrega
`apply_commercial_catalog_batch(business_id, rows)`: toma productos que **ya
existen** y cambia lo único que el negocio decide. No da de alta, no toca
identidad, no toca imagen, no toca categoría.

Una llamada es una transacción: cualquier `raise` deshace el lote completo.

### La republicación, y por qué no se tocó el disparador

Hay además un disparador de tabla, `products_fail_close_master_change`, que
cuenta el **precio** como dato maestro: cambiárselo a un producto verificado lo
despublica. Para una tienda eso es inviable —los precios se mueven todas las
semanas y bajaría la góndola entera cada vez— pero el disparador **está bien**:
nada verificado puede cambiar en silencio.

Así que no se lo tocó. Se lo deja actuar y, sólo si el producto **ya estaba
publicado** y sigue cumpliendo **todas** las compuertas —precio > 0, stock > 0,
activo e imagen que coincide con el registro aprobado—, el RPC lo vuelve a
publicar explícitamente en la misma transacción, y lo informa en
`applied_republished`.

No es un salvoconducto: verificado en el simulacro, si al mismo lote se le baja
el stock a 0, el producto se queda abajo aunque estuviera publicado.

El servidor impone los mismos invariantes que el importador, no porque
desconfíe de él sino porque es lo que queda en pie si mañana llama otra cosa.

---

## 5. Simulacro

```bash
node scripts/run-commercial-import-drill.mjs
```

Levanta un contenedor **propio**, aplica la cadena de migraciones sobre una base
efímera, siembra la identidad de seis productos reales y ejercita el importador
de punta a punta: carga inicial, rollback del lote entero ante una fila mala,
precio cero rechazado, negativos rechazados, duplicados rechazados, SKU de QA
rechazado, publicación sin precio/stock/imagen rechazada, y que cambiar un
precio conserva la publicación.

**No escribe un solo valor sintético sobre el catálogo comercial real.** Los
precios del simulacro viven exclusivamente en la base efímera, que se borra al
terminar. El contenedor es propio porque la migración de `pg_cron` exige tocar
un GUC del clúster y reiniciar, y hacer eso sobre el stack de otra sesión le
voltea la base a medio trabajo.

---

## 6. Cuánto del catálogo queda vendible

Con la planilla completa —los 81 productos de góndola con precio y stock—:

- **81 productos vendibles**, contra 11 hoy. Siete veces la góndola actual.
- **71 quedarían publicables de inmediato**: tienen identidad, categoría,
  alcohol declarado y archivo de foto en disco.
- **10 necesitan una foto antes de publicarse.** No tienen ninguna ruta
  cargada, así que entrarían al catálogo pero se verían sin imagen:

  | SKU | Categoría |
  |---|---|
  | `coca-cola-original-2250ml` | Gaseosas |
  | `coca-cola-sin-azucar-2250ml` | Gaseosas |
  | `schweppes-tonica-354ml` | Mixers |
  | `levite-manzana-2250ml` | Aguas saborizadas |
  | `aquarius-pera-2200ml` | Aguas saborizadas |
  | `monster-ultra-473ml` | Energizantes |
  | `brancamenta-450ml` | Fernet y amargos |
  | `gancia-americano-950ml` | Aperitivos |
  | `martini-bianco-1000ml` | Aperitivos |
  | `smirnoff-700ml` | Destilados |

  Son diez fotos, y tres de ellas —tónica, Gancia y Smirnoff— son componentes
  de los combos que el encargo pide (Gin+tónica, Gancia+gaseosa,
  Vodka+energizante).
- Los **7 combos** aprobados se vuelven cobrables en cuanto sus componentes
  tengan precio. Hoy resuelven sobre cerveza y energizante; con gaseosas, fernet
  y hielo cargados se pueden armar los que pidió el encargo.
- Las **2 promociones candidatas** siguen sin mostrarse hasta que alguien
  declare precio regular, precio promocional y vigencia. El sistema no las
  infiltra como oferta y no hay que hacer nada para que eso siga así.
