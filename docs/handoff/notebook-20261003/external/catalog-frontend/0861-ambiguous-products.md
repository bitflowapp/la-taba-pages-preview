# Productos ambiguos y conflictos de identidad · TABA2

Base `b66add0` · 2026-08-05. **Ninguno de estos productos fue convertido, renombrado ni borrado.** Cada uno necesita una respuesta humana antes de que el código pueda tocarlo.

---

## 1. AMBIGUO por multiplicador contradictorio (1 producto)

### `budweiser-lata-473ml-pack-6-local` — Budweiser Lager, lata 473 ml

Tres fuentes del mismo dato se contradicen:

| Fuente | Dice |
|---|---|
| Presentación pública | `Lata · 473 ml · Pack x6` |
| Descripción | "Cerveza en lata de 473 ml, **pack de 6**." |
| `catalog/products.json` (release) | `pack_count: 6` |
| Dato estructurado del runtime | `unitsPerPack: 1`, `unitLabel: "Unidad"`, `unit: "unidad"` |
| Id | `budweiser-lata-473ml-pack-6-local` |

**Por qué no se convierte:** si el multiplicador real fuera 6, tratarlo como unidad haría que una recepción de mercadería contara 1 donde entraron 6; si fuera 1, tratarlo como pack contaría 6 donde entró 1. Las dos equivocaciones destruyen el inventario, y no hay evidencia que decida.

**Estado hoy:** sin precio, sin stock, no comprable. El modelo lo marca `packaging.ambiguous = true` y no lo vincula con ninguna unidad.

**Qué hace falta decidir:**
1. ¿La Taba 2 vende la lata suelta de Budweiser 473 ml, el pack de 6, o los dos?
2. Si son los dos, son **dos productos** con precios y stocks distintos, no uno.
3. Confirmado eso, corregir el origen (`scripts/taba2-p0-local-assets.mjs` genera esta fila) y regenerar, en vez de parchear el archivo generado.

---

## 2. CONFLICTO DE IDENTIDAD · el mismo producto en dos filas (4 pares)

Vienen de los dos orígenes del catálogo: el aprobado heredado (con precio de demo) y el de autoridad (verificado, bloqueado, sin precio). Hoy conviven porque uno está pendiente; **el día que el local cargue precios, los dos quedan comprables y el cliente ve dos tarjetas iguales**.

| Producto | Fila con precio | Fila pendiente | Diferencia observable |
|---|---|---|---|
| Monster Mango Loco 473 ml | `monster-mango-loco-lata-473ml` · $ 3.390 | `monster-mango-loco-473ml` | subcategoría (`juice-monster` vs `mango-loco`) e imagen distinta |
| Imperial Golden 473 ml | `imperial-golden-lata-473ml` · $ 3.000 | `imperial-golden-473ml` | subcategoría (`lager` vs `golden`) |
| Corona Extra 330 ml | `corona-extra-botella-330ml` · $ 3.600 | `corona-extra-330ml` | variedad declarada (`Extra` vs `Lager`) |
| Speed Zero 473 ml | `speed-zero-lata-473ml` · $ 2.925 | `speed-zero-473ml` | nombre ("Speed Unlimited" vs "Speed Zero") |

**Por qué no se renombraron:** completar el nombre con la variedad los volvería "Corona Extra" y "Corona Extra Lager" — dos productos distintos a los ojos del cliente, cuando son el mismo. Inventar una distinción es peor que dejar el duplicado a la vista.

**Qué hace falta decidir:** para cada par, cuál fila sobrevive (recomendación: la que tiene precio e historial), qué datos se le trasladan de la otra (imagen verificada, sha256, subcategoría) y confirmar el archivado de la redundante conservando su id. Procedimiento completo en `catalog-audit.md`, sección 5.

---

## 3. AMBIGÜEDAD COMERCIAL · nueve packs sin unidad suelta (9 productos)

No son ambiguos en sus datos —el multiplicador es consistente en las tres fuentes—, pero **sí en su intención comercial**: no hay forma de saber, desde el catálogo, si el local quiere vender el pack o si el pack es sólo cómo se lo compra al proveedor.

| Producto | Presentación | Precio | Unidad suelta en catálogo |
|---|---|---:|---|
| Coca-Cola Original 500 ml | Pack x12 | $ 17.100 | no existe |
| Coca-Cola Zero 500 ml | Pack x12 | $ 17.100 | no existe |
| Sprite Original 500 ml | Pack x12 | $ 17.100 | no existe |
| Coca-Cola Original 1500 ml | Pack x6 | $ 19.999 | no existe |
| Coca-Cola Zero 1500 ml | Pack x6 | $ 19.999 | no existe |
| Sprite Original 1500 ml | Pack x6 | $ 19.999 | no existe |
| Fanta Naranja 1500 ml | Pack x6 | $ 19.999 | no existe |
| Schweppes Tónica 1500 ml | Pack x6 | $ 19.999 | no existe |
| Schweppes Citrus 1500 ml | Pack x6 | $ 19.999 | no existe |

Los cuatro criterios del contrato ("el negocio quiere venderlo, tiene precio propio confirmado, tiene stock propio, se presenta claramente como pack") se cumplen en tres de cuatro. El que falta es el primero, y sólo lo puede responder el local.

**Estado hoy:** siguen publicados como packs, claramente rotulados. No se despublicaron: hacerlo dejaría a gaseosas y mixers sin ningún producto comprable y vaciaría la vidriera por una decisión que no me corresponde.

**Qué hace falta decidir:** para cada uno, si se vende como pack (y a qué precio confirmado), si se publica además la unidad suelta (con su precio, su stock y su foto), o las dos cosas. Detalle en `commercial-data-needed.md`.

---

## Resumen

| Situación | Productos | Bloquea |
|---|---:|---|
| Multiplicador contradictorio | 1 | conversión y recepción de mercadería |
| Mismo producto duplicado | 8 (4 pares) | publicación de precios sin duplicar la góndola |
| Pack sin intención comercial confirmada | 9 | que el vecino pueda comprar una sola botella |
| **Total pendiente de decisión humana** | **18** | |
