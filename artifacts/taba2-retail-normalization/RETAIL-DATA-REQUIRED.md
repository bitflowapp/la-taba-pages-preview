> **RESUELTO el 2026-08-19.** Marco dio los 4 precios finales autorizados
> (no un costo mayorista para derivar: el precio de venta directo) y los 4
> GTIN de referencia del fabricante. El payload vive en
> `catalog/retail-unidades.mjs`, validado contra los CHECK reales de
> producción en `scripts/retail-unidades-plan.mjs`, y el canal de aplicación
> en `scripts/aplicar-retail-unidades.mjs`. Sigue en `TABA RETAIL CATALOG —
> HUMAN APPLY REQUIRED`: la decisión de canal que este documento dejaba
> anotada abajo se resolvió por un INSERT liso y scopeado (nunca el upsert de
> 52 filas de `aplicar-gondola-neuquen.mjs`), pero la escritura en sí sigue
> exigiendo `--confirmado-por-humano` — ver el mensaje de la misión para el
> comando exacto. El texto original de este documento queda abajo, sin editar,
> como registro de qué faltaba y por qué.
>
> ---

# TABA — datos que faltan para publicar las 4 unidades

4 SKU, los cuatro no alcohólicos, los cuatro bloqueados por lo mismo: no
hay en el repositorio ningún costo mayorista ni precio minorista real
para ESTA presentación (500 ml / 1,5 L). El costo mayorista que sí existe
en `catalog/gondola-neuquen.mjs` es para la presentación de 2,25 L de las
mismas marcas — una capacidad distinta, así que usarlo sería estimar, no
medir. Y el precio del pack ($17.100 / $19.999) está explícitamente
marcado en el repo como "no usar dividido" por una sesión anterior.

| SKU a crear | Dato faltante | Por qué no se puede inferir | Qué necesito de vos |
|---|---|---|---|
| `coca-cola-original-pet-500ml` (unidad, hermana de `coca-cola-original-botella-pet-500-ml-pack-x12`) | costo mayorista **de la botella de 500 ml**, o precio minorista de góndola ya contrastado | El único costo medido de Coca-Cola Original en el repo es a 2,25 L ($4.049,50); una botella de 500 ml no cotiza al prorrateo lineal de una de 2,25 L en la lista real del mayorista, y dividir el pack de 12 ($17.100 ÷ 12 = $1.425) fue explícitamente descartado por la sesión anterior: el precio de pack ya lleva un margen distinto al de unidad | Costo mayorista real de la botella PET de 500 ml (Maxiconsumo u otra fuente que uses vos), o directamente el precio de góndola que le pondrías |
| `coca-cola-zero-pet-500ml` (unidad, hermana de `coca-cola-zero-botella-pet-500-ml-pack-x12`) | ídem | ídem | ídem, para Coca-Cola Zero 500 ml |
| `sprite-pet-500ml` (unidad, hermana de `sprite-botella-pet-500-ml-pack-x12`) | ídem | ídem | ídem, para Sprite 500 ml |
| `fanta-naranja-pet-1500ml` (unidad, hermana de `fanta-naranja-botella-pet-1500-ml-pack-x6`) | costo mayorista **de la botella de 1,5 L**, o precio minorista ya contrastado | El costo medido de Fanta Naranja en el repo es a 2,25 L ($4.049,50); 1,5 L no es el mismo envase y dividir el pack de 6 ($19.999 ÷ 6 = $3.333) también fue descartado por la misma razón | Costo mayorista real de la botella de 1,5 L, o el precio de góndola que le pondrías |

## Además, una decisión de canal (no urge hasta tener los 4 precios)

Con los precios en mano falta un segundo dato, que no es de negocio sino
técnico: **estas 4 unidades no pueden crearse con foto oficial** (el
marco de derechos `TABA-AUT-2026-08-001` cubre explícitamente sólo los 4
packs, no la unidad suelta) — usarían el recurso propio de TABA, como ya
usan 52 de los 56 productos actuales. Pero la única vía que puede crear
un producto sin foto (`scripts/aplicar-gondola-neuquen.mjs`, la misma que
cargó esos 52) usa un canal más privilegiado que bypassea RLS, cerrado
detrás de `TABA2_GONDOLA_APPLY=1` y `--confirmado-por-humano` — es decir,
necesita que vos lo corras o autorices explícitamente vos, no algo que
convenga automatizar sin que estés al tanto. Se documenta acá para que no
sea una sorpresa cuando llegue el momento de publicar.

## Todo lo demás del catálogo (52 de 56 SKU) no necesita ningún dato tuyo

Ya está correctamente modelado como venta minorista. Ver
`CATALOG-RETAIL-AUDIT.md` para el detalle completo.
