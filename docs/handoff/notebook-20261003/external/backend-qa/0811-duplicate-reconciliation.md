# Reconciliación de duplicados · TABA2

Base `b8ac9a3` · 2026-08-05. Este documento cierra la inconsistencia del informe anterior, que citaba **12 productos / 6 pares** en la clasificación y **8 productos / 4 pares** como pendientes, además de "4 filas duplicadas" en otra sección.

---

## 1. Por qué los números no cerraban

Los tres números eran correctos y contaban cosas distintas:

| Cifra del informe | Qué contaba en realidad |
|---|---|
| **12 productos / 6 pares** | Colisiones de **nombre público** detectadas automáticamente: dos productos de la misma marca, categoría y capacidad mostrando el mismo nombre. |
| **8 productos / 4 pares** | Duplicados de **identidad de producto** pendientes de consolidar: la misma bebida cargada dos veces desde dos orígenes del catálogo. |
| **"4 filas duplicadas"** | Las **4 filas redundantes** de esos 4 pares (una por par), que son las que habría que archivar. |

Los conjuntos se **superponen pero no coinciden**, y ahí estaba la confusión:

- 3 de los 6 pares de nombre eran **variedades genuinamente distintas** mal nombradas → se resolvieron completando el nombre.
- 3 de los 6 pares de nombre eran **el mismo producto duplicado** → siguen pendientes.
- 1 par de identidad **no colisionaba por nombre** (`speed-zero-lata-473ml` "Speed Unlimited" vs `speed-zero-473ml` "Speed Zero") y por eso no estaba entre los 12: se detectó al revisar producto por producto.

**Totales que cierran:**

| | |
|---|---:|
| Productos con colisión de nombre (clasificación E) | **12** |
| Producto extra con duplicado de identidad sin colisión de nombre | **+1** (`speed-zero-473ml`) |
| **Productos únicos involucrados** | **13** |
| Relaciones detectadas | **7** (6 de nombre + 1 de identidad) |
| Pares resueltos por nombre | **3** (6 productos) |
| Pares pendientes de consolidar | **4** (8 productos) |
| Filas redundantes a archivar | **4** |
| Superposición: `speed-zero-lata-473ml` participa de un par resuelto **y** de uno pendiente | **1 producto** |

13 = 6 (resueltos) + 8 (pendientes) − 1 (el que está en ambos). ✔

---

## 2. Detalle por producto

### Resueltos — colisión de nombre entre variedades distintas

La variedad ya estaba en el registro y no llegaba al nombre público. Completarla no inventa nada y separa dos productos que sí son distintos.

| ID | Nombre anterior | Nombre normalizado | Relacionado con | Conflicto original | ¿Resuelto? | Cómo |
|---|---|---|---|---|---|---|
| `speed-original-lata-473ml` | Speed Unlimited | **Speed Unlimited Original** | `speed-zero-lata-473ml` | dos tarjetas comprables idénticas a $ 2.925 | Sí | variedad al nombre público |
| `speed-zero-lata-473ml` | Speed Unlimited | **Speed Unlimited Zero Sugar** | `speed-original-lata-473ml` | ídem | Sí | variedad al nombre público |
| `glaciar-sin-gas-1500ml` | Glaciar | **Glaciar Sin gas, baja en sodio** | `glaciar-con-gas-1500ml` | con gas / sin gas indistinguibles | Sí | variedad al nombre público |
| `glaciar-con-gas-1500ml` | Glaciar | **Glaciar Con gas, baja en sodio** | `glaciar-sin-gas-1500ml` | ídem | Sí | variedad al nombre público |
| `manaos-lima-limon-2250ml-local` | Manaos | **Manaos Lima limón** | `manaos-naranja-2250ml-local` | dos sabores con el mismo nombre | Sí | variedad al nombre público |
| `manaos-naranja-2250ml-local` | Manaos | **Manaos Naranja** | `manaos-lima-limon-2250ml-local` | ídem | Sí | variedad al nombre público |

Además, la misma regla completó cuatro Sprite que colisionaban entre sí (`Sprite Original` / `Sprite Sin azúcar`). No formaban un par de duplicados: eran productos distintos con nombre incompleto.

### Pendientes — la misma bebida cargada dos veces

Vienen de los dos orígenes del catálogo: el aprobado heredado (con precio de demo) y el de autoridad (verificado, bloqueado, sin precio). **No se renombraron y no se borraron**: darles nombres distintos los disfrazaría de productos diferentes, y elegir cuál sobrevive es una decisión del negocio.

| ID | Nombre | Relacionado con | Conflicto | ¿Resuelto? | Motivo de la espera |
|---|---|---|---|---|---|
| `monster-mango-loco-lata-473ml` | Monster Mango Loco · $ 3.390 | `monster-mango-loco-473ml` | misma bebida, dos filas | **No** | falta confirmar cuál sobrevive |
| `monster-mango-loco-473ml` | Monster Mango Loco · pendiente | `monster-mango-loco-lata-473ml` | ídem | **No** | ídem |
| `imperial-golden-lata-473ml` | Imperial Golden · $ 3.000 | `imperial-golden-473ml` | ídem | **No** | ídem |
| `imperial-golden-473ml` | Imperial Golden · pendiente | `imperial-golden-lata-473ml` | ídem | **No** | ídem |
| `corona-extra-botella-330ml` | Corona Extra · $ 3.600 | `corona-extra-330ml` | ídem, con variedades sinónimas ("Extra" / "Lager") | **No** | ídem |
| `corona-extra-330ml` | Corona Extra · pendiente | `corona-extra-botella-330ml` | ídem | **No** | ídem |
| `speed-zero-lata-473ml` | Speed Unlimited Zero Sugar · $ 2.925 | `speed-zero-473ml` | misma bebida con nombres distintos | **No** (su colisión de nombre sí se resolvió) | ídem |
| `speed-zero-473ml` | Speed Zero · pendiente | `speed-zero-lata-473ml` | ídem | **No** | ídem |

**Filas redundantes a archivar (4):** `monster-mango-loco-473ml`, `imperial-golden-473ml`, `corona-extra-330ml`, `speed-zero-473ml`.

---

## 3. Estado actual y riesgo

Hoy los cuatro pares **no se notan en la góndola**: en cada uno, una fila tiene precio y la otra dice "Precio próximamente". El riesgo aparece cuando el local cargue precios: quedarían **las dos comprables**, y el cliente vería dos tarjetas iguales con precios distintos.

Por eso la consolidación es previa a la carga de precios, no posterior.

## 4. Procedimiento propuesto (no ejecutado)

Para cada par:

1. Confirmar con el local que son la misma bebida (marca, capacidad y envase).
2. Elegir la fila superviviente — recomendación: la que **tiene precio**, porque ya tiene historial de pedidos.
3. Trasladarle de la otra fila lo que aporte: imagen verificada, `image_sha256`, subcategoría de autoridad y el código de barras cuando llegue.
4. Archivar la redundante (`archived: true`), **nunca borrarla**: conserva su id para pedidos históricos y enlaces viejos.
5. Regenerar el catálogo de autoridad con `scripts/taba2-catalog-authority.mjs` para que el duplicado no vuelva a nacer en la próxima importación.

Ningún id cambia en ningún paso.
