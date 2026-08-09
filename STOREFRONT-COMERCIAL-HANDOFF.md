# Storefront comercial de TABA2 — qué está listo y qué falta de Walter

Rama `feature/taba2-storefront-commercial-pilot`, worktree
`D:\1212\worktrees\taba2-storefront-pilot`, base `66ba221`.

Este documento tiene una sola función: separar lo que el **software** puede
resolver de lo que sólo puede resolver el **negocio**. Todo lo que sigue está
medido contra la góndola real de la app, no estimado.

---

## 1. El número que manda

De los **80 productos** que hoy ve un cliente, **11 se pueden comprar**.

Los otros **69 tienen precio pendiente**: aparecen con la ficha completa, la
foto oficial y el rótulo «Precio próximamente», y su botón dice «Precio
pendiente» en vez de «Agregar».

| Categoría | Productos visibles | Comprables hoy |
|---|---:|---:|
| Cervezas | 16 | **7** |
| Energizantes | 8 | **4** |
| Gaseosas | 17 | 0 |
| Mixers | 9 | 0 |
| Vinos | 7 | 0 |
| Aperitivos | 5 | 0 |
| Aguas | 5 | 0 |
| Destilados | 4 | 0 |
| Fernet y amargos | 3 | 0 |
| Aguas saborizadas | 2 | 0 |
| Isotónicas | 2 | 0 |
| Espumantes y sidras | 1 | 0 |
| Hielo | 1 | 0 |

Los 11 comprables: Heineken, Imperial Golden, Imperial Extra Lager, Imperial
APA, Imperial Cream Stout, Schneider Rubia, Corona Extra, Red Bull, Speed
Unlimited Original, Speed Unlimited Zero Sugar y Monster Mango Loco.

**Esto no es un defecto del storefront.** El sistema está diseñado para no
inventar un precio: un producto sin precio confirmado se muestra, se busca y se
puede leer, pero no se puede comprar y no entra en ninguna superficie de compra
(ni destacados, ni combos, ni ofertas). Es la decisión correcta. Pero significa
que **hoy la tienda vende cerveza y energizantes, y nada más.**

### Qué hace falta

Una sola cosa, repetida 69 veces: **precio de venta y stock por SKU.**

El repositorio ya tiene el camino armado para cargarlos sin tocar código:

```
catalog/pending-unit-prices.csv     ← se completa la columna de precio
npm run catalog:prices:check        ← valida el archivo
npm run catalog:prices:verify       ← contrasta contra el catálogo
```

Prioridad comercial sugerida, por lo que más se vende con cerveza:

1. **Gaseosas** (17 SKU) — habilita Fernet+Coca, Gancia+gaseosa y el mixer de casi todo.
2. **Hielo** (1 SKU) — es el complemento de mayor margen y hoy no se puede vender.
3. **Fernet y aperitivos** (8 SKU) — el combo más pedido de la región.
4. **Mixers** (9 SKU) — tónica, soda, pomelo.
5. **Vinos y espumantes** (8 SKU).
6. **Destilados** (4 SKU) — vodka y gin.
7. **Aguas e isotónicas** (9 SKU).

---

## 2. Las categorías que el encargo pide y el catálogo no tiene

| Pedida | Estado |
|---|---|
| Cervezas | ✅ existe, con producto comprable |
| Fernet y aperitivos | ⚠️ existen como **dos** categorías (`fernet`, `aperitivos`); la home ya las junta en un solo carrusel, el catálogo todavía las lista separadas |
| Vinos y espumantes | ⚠️ igual: `vinos` + `espumantes`, unidas en la home |
| Gaseosas, Energizantes, Aguas, Hielo | ✅ existen |
| **Vodka** | ❌ no existe como categoría: los 4 destilados están todos en `destilados` |
| **Gin** | ❌ ídem |
| **Snacks** | ❌ **no existe ni la categoría ni un solo producto** |
| Combos y promociones | ✅ existe (ver punto 3) |

**Decisión tomada:** no se crearon las categorías Vodka, Gin ni Snacks.

- Vodka y Gin partirían `destilados` (4 productos, los 4 sin precio) en dos
  categorías vacías. Una categoría a la que se entra y no hay nada que comprar
  es peor que no tenerla.
- Snacks no tiene ni un producto que clasificar. Crearla sería prometer un
  rubro que el local no publicó.

**Qué hace falta:** si La Taba vende snacks (papas, maní, picadas), hay que
darlos de alta como productos —nombre, presentación, precio, stock y foto— y la
categoría aparece sola. Para Vodka y Gin alcanza con reclasificar los destilados
que correspondan **y** cargarles precio; mientras no haya precio, seguirían
siendo dos categorías vacías.

---

## 3. Promociones y combos

### Promociones: hoy no hay ninguna vigente

El catálogo trae **2 candidatas**, las dos con `active: false`,
`approvalStatus: PENDIENTE` y **sin precio ni vigencia**:

- «Monster Import DBZ» — evidencia: *«Foto 1: cartel sin vigencia ni presentación confirmada»*.
- «Heineken 6 pack» — evidencia: *«Foto 8: cartel sin vigencia ni condiciones confirmadas»*.

Por eso la sección «Ofertas del día» de la home **no se muestra**: no hay nada
honesto que poner ahí. El storefront nunca infiltra una candidata como oferta.

**Qué hace falta:** por cada promoción real, el negocio tiene que declarar
precio regular, precio promocional, desde cuándo, hasta cuándo y en qué
condiciones. Con eso la sección se enciende sola.

### Combos: hay 7 declarados y funcionan

El manifiesto (`js/combos-data.js`, derivado de `data/combos.csv`) declara 7
combos, todos en `APROBADO_COMERCIAL`. **Ninguno guarda un precio**: declaran
componentes, cantidades y el descuento que decidió el comercio, y el precio de
lista, el promocional, el ahorro y el stock se **derivan del catálogo vivo** en
cada render. Verificado en esta sesión: si a un componente se le acaba el stock,
el combo desaparece del carrusel, deja de ser cobrable, no anuncia precio y
explica el motivo.

Los 7 son todos de cerveza y energizante, porque son los únicos SKU con precio.

Los combos que pide el encargo y **no se pueden armar todavía**:

| Combo pedido | Qué falta |
|---|---|
| Fernet + Coca + hielo | precio de fernet, de Coca y de hielo |
| Vodka + energizante | precio del vodka |
| Gin + tónica + hielo | precio de gin, de tónica y de hielo |
| Six-pack + snack | **no existe ningún snack en el catálogo** |
| Gancia + gaseosa | precio de Gancia y de la gaseosa |
| Vino + snack | precio del vino y **no existe ningún snack** |

**Decisión tomada:** no se agregaron al manifiesto. Un combo con un componente
sin precio queda bloqueado y no se muestra, así que cargarlos ahora no cambiaría
nada en pantalla; y declarar un porcentaje de descuento que nadie aprobó sería
comprometer al negocio a un precio que no eligió. Se cargan el día que los
componentes tengan precio, y con el descuento que decida Walter.

---

## 4. Cobertura de entrega

El sistema **no tiene un polígono de cobertura**. Lo que hay es:

- una lista de zonas (`Neuquén Capital`, `Cipolletti`) que hoy sólo se usa como
  texto, y
- una validación que exige que la localidad tenga al menos 3 caracteres.

O sea: **hoy el storefront no puede decir «tu dirección está fuera de
cobertura»**, porque no sabe dónde termina la cobertura. Acepta cualquier punto
confirmado dentro de lo que el cliente marque.

**Decisión tomada:** no se inventó un radio. Poner «entregamos hasta X km»
sería afirmar una regla comercial que el negocio no declaró, y rechazar pedidos
con ella sería peor que aceptarlos y coordinar.

**Qué hace falta:** que el negocio declare su área de reparto —un radio en
metros desde Mendoza 827, o una lista de barrios—. Con eso se puede avisar antes
de pagar en vez de después.

---

## 5. Ubicación del local

La coordenada de La Taba 2 (`-38.9460616, -68.0533209`) está contrastada contra
la ficha comercial pública, la numeración catastral y el Plus Code, pero está
declarada como `human_verified: false` con precisión de 20 m.

**Qué hace falta:** que una persona del comercio abra el mapa parada en la
puerta y confirme el pin. Es un minuto de trabajo y cierra el último eslabón
geográfico del piloto.

---

## 6. Lo que el software sí resolvió en esta rama

Está detallado en los mensajes de los commits. En una línea cada uno:

- El formulario de entrega dejó de pedir ciudad, provincia y código postal: son
  constantes de la operación y se completan solas. Quedó en calle + número, con
  piso, departamento y referencias opcionales, y el mapa a un scroll.
- El chip «Enviar a» del encabezado dejó de contradecir al checkout. Decía
  «Elegí tu dirección» con una dirección confirmada al lado, y en producción lo
  decía siempre.
- Ordenar por «Precio: menor a mayor» ya no abre con los 69 productos sin
  precio.
- Las categorías del catálogo ya no abren con Gaseosas y Mixers, donde no hay
  nada para comprar.
- Los productos con alcohol se distinguen en la góndola, no recién en la ficha.
- El resumen de pago dejó de mostrar el pedido mínimo como si fuera un cargo.
