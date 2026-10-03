# Revisión de precios unitarios · TABA2

Base `b66add0` · 2026-08-05.

## Resultado de la revisión: cero precios unitarios calculables

**El catálogo no contiene ningún dato de costo.** Verificado sobre las 82 filas del runtime y las 92 del catálogo de release: no existe ningún campo de costo, precio mayorista, proveedor, bonificación ni margen. La búsqueda de claves que contengan `cost`, `wholesale`, `supplier` o `proveedor` devuelve vacío.

Consecuencia directa: **no se propuso ni un solo precio de venta**, ni siquiera como cálculo interno de auditoría. Sin costo real no hay fórmula que aplicar, y dividir un precio de venta de pack para publicar un precio unitario está expresamente prohibido — y sería una invención comercial, no un cálculo.

---

## Productos que necesitan precio de venta unitario

### 62 productos con `pricePending: true`

Sin precio publicado, no comprables, con su estado honesto a la vista ("Precio próximamente"). Se mantienen exactamente así. Diez rubros no tienen **ni un** producto comprable: vinos (7), aguas (5), aperitivos (5), fernet (3), gin (3), aguas saborizadas (2), isotónicas (2), complementos (1), espumantes (1), whisky (1).

### 9 unidades sueltas que hoy no existen y el cliente necesita

Son las unidades de los packs que sostienen la vidriera. Hoy sólo se pueden comprar de a seis o de a doce.

| Unidad que falta publicar | Existe hoy sólo como | Precio del pack |
|---|---|---:|
| Coca-Cola Original 500 ml | Pack x12 | $ 17.100 |
| Coca-Cola Zero 500 ml | Pack x12 | $ 17.100 |
| Sprite Original 500 ml | Pack x12 | $ 17.100 |
| Coca-Cola Original 1,5 L | Pack x6 | $ 19.999 |
| Coca-Cola Zero 1,5 L | Pack x6 | $ 19.999 |
| Sprite Original 1,5 L | Pack x6 | $ 19.999 |
| Fanta Naranja 1,5 L | Pack x6 | $ 19.999 |
| Schweppes Tónica 1,5 L | Pack x6 | $ 19.999 |
| Schweppes Citrus 1,5 L | Pack x6 | $ 19.999 |

**Los importes de la derecha son precios de venta del pack, no costos.** No se dividieron ni se usaron como referencia: aparecen sólo para que quien fije el precio unitario sepa de qué producto se habla.

---

## Fórmula a aplicar cuando exista el costo

Ningún término está resuelto hoy. Se deja escrita para que la decisión humana sea explícita y auditable:

```
costo unitario   = (costo del pack − bonificaciones) / unidades reales del pack
costo con cargas = costo unitario + impuestos + envase retornable + comisión de pago
precio sugerido  = costo con cargas × (1 + margen)
precio publicado = redondeo comercial del precio sugerido
```

Datos faltantes para poder aplicarla, todos externos:

| Término | Estado |
|---|---|
| costo del pack | **no existe en el catálogo** |
| bonificaciones del proveedor | no declaradas |
| unidades reales del pack | disponibles y verificadas para 11 packs; contradictorias para 1 (Budweiser) |
| impuestos aplicables | no definidos |
| envase retornable | sólo un producto lo declara (Brahma Chopp 1 L, botella retornable); el resto sin dato |
| comisión de medio de pago | no definida (el checkout coordina el pago con el local) |
| costo operativo | no definido |
| margen | **fuera del alcance de esta tarea por instrucción** |
| redondeo comercial | no definido |

---

## Regla que quedó implementada

Mientras falte el precio, el producto:

- conserva `pricePending: true` y **no es comprable** (`isPurchasableBeverageProduct`, sin segunda definición);
- muestra "Precio próximamente" y "Este producto todavía no está disponible para compra";
- **nunca muestra `$ 0`** — verificado por invariante sobre el catálogo real;
- no aparece en sugerencias de compra ni activa banners de compra (cierre P1 previo);
- queda listado por `retailPublicationReadiness` con el detalle exacto de lo que le falta.

El día que llegue un precio aprobado, el producto se enciende solo: entra a la góndola, a su categoría y a la vidriera, sin tocar código.
