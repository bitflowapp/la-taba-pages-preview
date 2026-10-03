# Origen de los assets

Todos los archivos de `assets/products/` son **copias** de imágenes existentes en el repositorio.
Los originales **no fueron modificados**.

**Ruta de origen:** `C:Q2la-taba-catalog-checkout-premiumassetscatalogeverages<id>	humbnail.webp`
**Ruta de destino:** `assets/products/<id>.webp`
**Copiados el:** 2026-07-31
**Cantidad:** 22 archivos

| Archivo en artefactos | Origen en el repositorio | Tamaño |
|---|---|---:|
| `assets/products/coca-cola-original-pet-1500ml-pack-6.webp` | `assets/catalog/beverages/coca-cola-original-pet-1500ml-pack-6/thumbnail.webp` | 4.8 KB |
| `assets/products/coca-cola-original-pet-500ml-pack-12.webp` | `assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/thumbnail.webp` | 5.5 KB |
| `assets/products/coca-cola-zero-pet-1500ml-pack-6.webp` | `assets/catalog/beverages/coca-cola-zero-pet-1500ml-pack-6/thumbnail.webp` | 4.4 KB |
| `assets/products/coca-cola-zero-pet-500ml-pack-12.webp` | `assets/catalog/beverages/coca-cola-zero-pet-500ml-pack-12/thumbnail.webp` | 5.1 KB |
| `assets/products/corona-extra-botella-330ml.webp` | `assets/catalog/beverages/corona-extra-botella-330ml/thumbnail.webp` | 8.7 KB |
| `assets/products/fanta-naranja-pet-1500ml-pack-6.webp` | `assets/catalog/beverages/fanta-naranja-pet-1500ml-pack-6/thumbnail.webp` | 5.0 KB |
| `assets/products/heineken-original-lata-473ml-pack-6.webp` | `assets/catalog/beverages/heineken-original-lata-473ml-pack-6/thumbnail.webp` | 10.8 KB |
| `assets/products/heineken-original-lata-473ml.webp` | `assets/catalog/beverages/heineken-original-lata-473ml/thumbnail.webp` | 10.8 KB |
| `assets/products/imperial-apa-lata-473ml.webp` | `assets/catalog/beverages/imperial-apa-lata-473ml/thumbnail.webp` | 8.6 KB |
| `assets/products/imperial-cream-stout-lata-473ml.webp` | `assets/catalog/beverages/imperial-cream-stout-lata-473ml/thumbnail.webp` | 3.9 KB |
| `assets/products/imperial-extra-lager-lata-473ml.webp` | `assets/catalog/beverages/imperial-extra-lager-lata-473ml/thumbnail.webp` | 7.0 KB |
| `assets/products/imperial-golden-lata-473ml.webp` | `assets/catalog/beverages/imperial-golden-lata-473ml/thumbnail.webp` | 9.1 KB |
| `assets/products/monster-mango-loco-lata-473ml.webp` | `assets/catalog/beverages/monster-mango-loco-lata-473ml/thumbnail.webp` | 28.5 KB |
| `assets/products/red-bull-original-lata-250ml-pack-4.webp` | `assets/catalog/beverages/red-bull-original-lata-250ml-pack-4/thumbnail.webp` | 17.1 KB |
| `assets/products/red-bull-original-lata-250ml.webp` | `assets/catalog/beverages/red-bull-original-lata-250ml/thumbnail.webp` | 7.6 KB |
| `assets/products/schneider-rubia-lata-710ml.webp` | `assets/catalog/beverages/schneider-rubia-lata-710ml/thumbnail.webp` | 9.3 KB |
| `assets/products/schweppes-citrus-pet-1500ml-pack-6.webp` | `assets/catalog/beverages/schweppes-citrus-pet-1500ml-pack-6/thumbnail.webp` | 3.9 KB |
| `assets/products/schweppes-tonica-pet-1500ml-pack-6.webp` | `assets/catalog/beverages/schweppes-tonica-pet-1500ml-pack-6/thumbnail.webp` | 3.2 KB |
| `assets/products/speed-original-lata-473ml.webp` | `assets/catalog/beverages/speed-original-lata-473ml/thumbnail.webp` | 8.7 KB |
| `assets/products/speed-zero-lata-473ml.webp` | `assets/catalog/beverages/speed-zero-lata-473ml/thumbnail.webp` | 8.7 KB |
| `assets/products/sprite-original-pet-1500ml-pack-6.webp` | `assets/catalog/beverages/sprite-original-pet-1500ml-pack-6/thumbnail.webp` | 3.4 KB |
| `assets/products/sprite-original-pet-500ml-pack-12.webp` | `assets/catalog/beverages/sprite-original-pet-500ml-pack-12/thumbnail.webp` | 3.6 KB |

**Total:** 178 KB

## Nota técnica relevante para el diseño

Estos WebP tienen **fondo blanco horneado**, no transparencia. Es un dato con consecuencia directa sobre la dirección visual:

- Cualquier superficie tintada, degradado o "estante" detrás del producto queda **tapada por el propio bitmap**.
- Por eso la caja del packshot en la tarjeta propuesta es **blanca**, y el encuadre lo da el borde inferior, no un fondo de color.
- Una dirección visual oscura exigiría **reproducir los 22 assets con canal alfa** antes de poder ver la primera pantalla real. Es trabajo de producción de imágenes, no de CSS, y fue uno de los motivos para descartar la dirección "Kiosco Nocturno".
- La clase `p-media--shelf` queda preparada por si en el futuro se producen assets con transparencia.

## Qué NO se copió

- No se copió ni se modificó ningún archivo de código del repositorio.
- No se copiaron `product.webp` (versiones grandes): los prototipos sólo necesitan la miniatura.
- No se usó ninguna imagen de terceros ni de stock.
- No se generó ni se retocó ninguna imagen.
