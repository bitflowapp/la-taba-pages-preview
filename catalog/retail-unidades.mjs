/*
 * LAS 4 UNIDADES MINORISTAS QUE FALTABAN · Coca-Cola-system · 2026-08-19
 * =======================================================================
 *
 * `feature/taba2-retail-catalog-normalization` auditó los 56 SKU de producción
 * y encontró exactamente 4 no alcohólicos que existían SOLO como pack
 * mayorista (`sold_as_pack = true`), sin ninguna unidad hermana comprable:
 * los 4 Coca-Cola-system que trajo `feature/taba2-catalog-image-pipeline`.
 * Ver artifacts/taba2-retail-normalization/CATALOG-RETAIL-AUDIT.md.
 *
 * Quedó bloqueado ahí porque no había, en ningún archivo del repositorio, un
 * costo mayorista ni precio minorista REAL para estas 4 presentaciones (500 ml
 * / 1,5 L) — el único costo medido en `gondola-neuquen.mjs` es a 2,25 L, otra
 * capacidad, y dividir el precio del pack fue explícitamente descartado antes
 * (`catalog/pending-unit-prices.reference.csv`, columna
 * `division_del_pack_NO_USAR`). Ver artifacts/taba2-retail-normalization/
 * RETAIL-DATA-REQUIRED.md.
 *
 * Los 4 precios de este archivo son PRECIOS FINALES AUTORIZADOS por el dueño
 * del comercio, dados explícitamente para esta presentación exacta — no una
 * derivación, no un margen recalculado, no el pack dividido. No se recalculan.
 *
 * QUÉ ES CADA FILA
 * -----------------
 * Cada unidad es hermana de un pack que YA existe en producción y que esta
 * misión NO TOCA: `siblingPackExternalId` es sólo documentación (de dónde sale
 * `brand`/`subcategory`/`packagingType`, copiados del pack real leído en vivo
 * el 2026-08-19), no algo que el lote lea en tiempo de aplicar.
 *
 * `gtin`/`gtinType` son de referencia del fabricante (dados por el dueño,
 * verificados acá contra `gtin_check_digit_valid` antes de aplicar — ver
 * `scripts/retail-unidades-plan.mjs`). Van a `product_barcodes`, NUNCA a
 * `products`: esa tabla no tiene columna de código de barras.
 *
 * `stock: 0` es a propósito, no un olvido. La unidad nunca fue una línea de
 * inventario separada del pack: no hay stock unitario real y demostrable, y
 * prorratear "1 pack = 12 unidades" fue explícitamente prohibido. `stock = 0`
 * es el único estado que dice la verdad Y permite `is_verified = true`
 * (`products_verified_master_data` exige `stock is not null` para verificar).
 * `available` sale solo: con stock 0 el CHECK `products_available_requires_
 * verification` lo fuerza a `false`. Cuando llegue stock real, es un
 * `update products set stock = N` — el grant público ya lo permite y no hace
 * falta re-verificar nada (ver CONTRATO-PRECIO-STOCK.md).
 */

export const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

export const RETAIL_UNIDADES = Object.freeze([
  {
    externalId: 'coca-cola-original-pet-500ml',
    sku: 'coca-cola-original-pet-500ml',
    siblingPackExternalId: 'coca-cola-original-botella-pet-500-ml-pack-x12',
    brand: 'Coca-Cola',
    name: 'Coca-Cola Original',
    category: 'Gaseosas',
    subcategory: 'Cola',
    variant: '500 ml',
    capacityValue: 500,
    packagingType: 'Botella PET',
    price: 2290,
    gtin: '7790895000782',
    gtinType: 'EAN-13',
  },
  {
    externalId: 'coca-cola-zero-pet-500ml',
    sku: 'coca-cola-zero-pet-500ml',
    siblingPackExternalId: 'coca-cola-zero-botella-pet-500-ml-pack-x12',
    brand: 'Coca-Cola',
    name: 'Coca-Cola Zero',
    category: 'Gaseosas',
    subcategory: 'Cola sin azúcar',
    variant: '500 ml',
    capacityValue: 500,
    packagingType: 'Botella PET',
    price: 2290,
    gtin: '7790895067532',
    gtinType: 'EAN-13',
  },
  {
    externalId: 'sprite-pet-500ml',
    sku: 'sprite-pet-500ml',
    siblingPackExternalId: 'sprite-botella-pet-500-ml-pack-x12',
    brand: 'Sprite',
    name: 'Sprite',
    category: 'Gaseosas',
    subcategory: 'Lima limón',
    variant: '500 ml',
    capacityValue: 500,
    packagingType: 'Botella PET',
    price: 2290,
    gtin: '7790895000829',
    gtinType: 'EAN-13',
  },
  {
    externalId: 'fanta-naranja-pet-1500ml',
    sku: 'fanta-naranja-pet-1500ml',
    siblingPackExternalId: 'fanta-naranja-botella-pet-1500-ml-pack-x6',
    brand: 'Fanta',
    name: 'Fanta Naranja',
    category: 'Gaseosas',
    subcategory: 'Naranja',
    variant: '1,5 L',
    capacityValue: 1500,
    packagingType: 'Botella PET',
    price: 4990,
    gtin: '7790895000454',
    gtinType: 'EAN-13',
  },
]);
