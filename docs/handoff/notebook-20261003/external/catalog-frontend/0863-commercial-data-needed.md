# Datos comerciales que hace falta conseguir · TABA2

Base `b66add0` · 2026-08-05. Nada de esto se resuelve con código: es información que sólo tiene La Taba 2. Ningún valor fue inventado ni estimado.

---

## 1. Decisiones de venta (9 packs) — lo más urgente

Para cada uno de estos nueve, el local tiene que decir **qué vende**:

| Producto | Hoy se publica como | ¿Se vende el pack? | ¿Se publica la unidad suelta? |
|---|---|---|---|
| Coca-Cola Original 500 ml | Pack x12 · $ 17.100 | ☐ sí ☐ no | ☐ sí — precio: ______ |
| Coca-Cola Zero 500 ml | Pack x12 · $ 17.100 | ☐ sí ☐ no | ☐ sí — precio: ______ |
| Sprite Original 500 ml | Pack x12 · $ 17.100 | ☐ sí ☐ no | ☐ sí — precio: ______ |
| Coca-Cola Original 1,5 L | Pack x6 · $ 19.999 | ☐ sí ☐ no | ☐ sí — precio: ______ |
| Coca-Cola Zero 1,5 L | Pack x6 · $ 19.999 | ☐ sí ☐ no | ☐ sí — precio: ______ |
| Sprite Original 1,5 L | Pack x6 · $ 19.999 | ☐ sí ☐ no | ☐ sí — precio: ______ |
| Fanta Naranja 1,5 L | Pack x6 · $ 19.999 | ☐ sí ☐ no | ☐ sí — precio: ______ |
| Schweppes Tónica 1,5 L | Pack x6 · $ 19.999 | ☐ sí ☐ no | ☐ sí — precio: ______ |
| Schweppes Citrus 1,5 L | Pack x6 · $ 19.999 | ☐ sí ☐ no | ☐ sí — precio: ______ |

**Por qué importa:** mientras la respuesta no llegue, un vecino que quiere una sola botella de Coca 1,5 L no puede comprarla — sólo el pack de seis a $19.999. Nueve de los veinte productos comprables están en esta situación.

Si se publica la unidad suelta, cada una necesita además: **stock inicial en unidades** y **una foto de la botella sola** (la del pack no sirve: muestra seis).

---

## 2. Precios de venta unitarios (62 productos)

Los 62 productos con "Precio próximamente" necesitan precio aprobado. Diez rubros completos no tienen ni un producto comprable: vinos (7), aguas (5), aperitivos (5), fernet (3), gin (3), aguas saborizadas (2), isotónicas (2), complementos (1), espumantes (1), whisky (1).

**No se propuso ningún precio**: el catálogo no tiene ningún dato de costo del que derivarlo (ver `unit-pricing-review.md`).

---

## 3. Multiplicador contradictorio (1 producto)

**Budweiser 473 ml** (`budweiser-lata-473ml-pack-6-local`): la presentación y el catálogo de release dicen pack de 6; el dato estructurado dice 1 unidad.

- ☐ Es una **lata suelta** → corregir presentación y descripción.
- ☐ Es un **pack de 6** → corregir el multiplicador.
- ☐ Son **los dos** → son dos productos, cada uno con su precio y su stock.

Hasta que se responda, no se convierte: un multiplicador equivocado rompe el inventario en la primera recepción de mercadería.

---

## 4. Consolidación de duplicados (4 pares)

El mismo producto aparece dos veces. Hoy no se nota porque una fila está pendiente; **cuando se carguen precios, el cliente verá dos tarjetas iguales con precios distintos**.

| Producto | Conservar (recomendado) | Archivar |
|---|---|---|
| Monster Mango Loco 473 ml | `monster-mango-loco-lata-473ml` ($ 3.390) | `monster-mango-loco-473ml` |
| Imperial Golden 473 ml | `imperial-golden-lata-473ml` ($ 3.000) | `imperial-golden-473ml` |
| Corona Extra 330 ml | `corona-extra-botella-330ml` ($ 3.600) | `corona-extra-330ml` |
| Speed Zero 473 ml | `speed-zero-lata-473ml` ($ 2.925) | `speed-zero-473ml` |

☐ Confirmar que cada par es el mismo producto · ☐ confirmar cuál sobrevive.

---

## 5. Códigos de barras (82 productos)

**El catálogo no tiene ni un código cargado.** Para cada producto que se venda por unidad hace falta el **código de la unidad de consumo** (EAN-13 o UPC-A, leído del envase individual).

Reglas ya implementadas y probadas, para que la carga no genere un problema nuevo:

- el código es **texto**, no número: los ceros a la izquierda son parte del código;
- el **código de la caja (GTIN-14) no puede usarse como código de la unidad** — es lo que hace que el escáner cobre una lata como si fuera un pack;
- un código con dígito verificador inválido se rechaza; no se completa ni se corrige solo.

---

## 6. Escáner del Panel — necesidad documentada, no implementada

Para que el Panel distinga **escaneo de unidad** (venta / control de stock) de **escaneo de pack de compra** (recepción de mercadería, que suma el multiplicador) hacen falta cambios fuera del alcance de esta tarea:

- columna de código de pack en el catálogo del backend, además del código de la unidad;
- RPC de recepción de mercadería que reciba `pack_barcode` + cantidad y sume `unidades = cantidad × multiplicador`;
- pantalla del Panel que muestre qué se escaneó y cuántas unidades entraron, antes de confirmar.

**Esa parte quedó detenida a propósito.** El modelo local ya expone `procurement.unitsPerPurchasePack` y `unitsReceivedFromPurchase()` para cuando se implemente.

---

## 7. Datos del local todavía pendientes (de la auditoría previa, siguen abiertos)

Horarios de atención · zona de cobertura · WhatsApp autorizado · medios de pago definitivos · confirmación de retiro en local · tarifa de envío y pedido mínimo definitivos · imágenes oficiales con derechos.

---

## Resumen de bloqueos

| Bloqueo | Alcance | Impacto |
|---|---:|---|
| Decisión pack vs unidad suelta | 9 productos | el vecino no puede comprar de a uno los productos más vendidos |
| Precios unitarios | 62 productos | 10 rubros enteros sin nada comprable |
| Multiplicador contradictorio | 1 producto | rompe el inventario al recibir mercadería |
| Consolidación de duplicados | 4 pares | góndola duplicada al cargar precios |
| Códigos de barras | 82 productos | sin escaneo de venta ni de recepción |
| Escáner unidad vs pack | Panel + backend | recepción de mercadería manual |
