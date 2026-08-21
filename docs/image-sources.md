# Image Sources

The butcher and hero photos are real photographs downloaded from Pexels and converted locally to optimized WebP files. Pexels allows free commercial use, modification, and use in apps/websites; attribution is not required, but sources are documented for traceability.

License reference: https://www.pexels.com/license/

| Local file | Source | Photographer | Usage |
| --- | --- | --- | --- |
| `assets/hero/parrilla-real.webp` | https://www.pexels.com/photo/grilled-meat-on-charcoal-grill-3997609/ | Gonzalo Guzman | Home promo banner, parrilla/promos/combos |
| `assets/products/cortes-crudos.webp` | https://www.pexels.com/photo/raw-meat-on-brown-wooden-chopping-board-5313867/ | Javon Swaby | Beef cuts |
| `assets/products/pollo-fresco.webp` | https://www.pexels.com/photo/food-wood-dinner-lunch-6107725/ | alleksana | Chicken products |
| `assets/products/chorizos-parrilla.webp` | https://www.pexels.com/photo/a-person-flipping-sausages-on-the-grill-17947491/ | Alina Matveycheva | Sausages/embutidos |
| `assets/products/milanesas.webp` | https://www.pexels.com/photo/breaded-chicken-on-white-plate-4078178/ | Anna Guerrero | Milanesas/breaded products |
| `assets/products/hamburguesa.webp` | https://www.pexels.com/photo/close-up-photo-of-a-burger-19247582/ | Jonathan Borba | Carne picada / burger-oriented product imagery |

## La Taba beverage product images

These are authentic, current Argentine product shots from the corresponding Supermercados DIA product listings. They are stored locally to avoid hotlinking. Copyright and commercial reuse permission for these manufacturer/retailer images are not verified; confirm permission before a production launch.

| Local file | Product listing | Usage |
| --- | --- | --- |
| `assets/products/bebidas/coca-cola-original-1-5l.jpg` | https://diaonline.supermercadosdia.com.ar/gaseosa-coca-cola-sabor-original-15-lt-16861/p | Home promotions, best sellers and catalog preview |
| `assets/products/bebidas/sprite-1-5l.jpg` | https://diaonline.supermercadosdia.com.ar/gaseosa-sprite-lima-limon-15-lt-16859/p | Home promotions, best sellers and catalog preview |
| `assets/products/bebidas/fanta-naranja-1-5l.jpg` | https://diaonline.supermercadosdia.com.ar/gaseosa-fanta-naranja-15-lt-16860/p | Home catalog preview |
| `assets/products/bebidas/pepsi-cola-2l.jpg` | https://diaonline.supermercadosdia.com.ar/gaseosa-cola-regular-pepsi-2-lt-115102/p | Home promotions |
| `assets/products/bebidas/monster-energy-original-473ml.jpg` | https://diaonline.supermercadosdia.com.ar/bebida-energizante-monster-energy-473-ml-260738/p | Home best sellers and catalog preview |
| `assets/products/bebidas/villavicencio-sin-gas-1-5l.jpg` | https://diaonline.supermercadosdia.com.ar/agua-pet-sin-gas-villavicencio-15-lt-298973/p | Water category product |
| `assets/products/bebidas/quilmes-clasica-473ml.jpg` | https://diaonline.supermercadosdia.com.ar/cerveza-quilmes-cristal-en-lata-473-ml-39818/p | Beer category product |
| `assets/products/bebidas/fernet-branca-750ml.jpg` | https://diaonline.supermercadosdia.com.ar/aperitivo-fernet-branca-750-ml-40267/p | Fernet category product |

Notes:

- No generated images were used.
- No external hotlinks are used by the app; all images are stored in the repository.
- The Pexels files were converted with `ffmpeg` to WebP at product/hero display sizes.
- Beverage product images retain their original JPEG encoding and current Argentine package warnings.
- For the red/black redesign the beverage packshots were normalized locally (crop of the retailer's
  side brand banner, product centred on a 900x900 white canvas). The photograph itself is untouched:
  only framing changes, so the same file works on the white product card and, with `mix-blend-mode:
  multiply`, over the red hero and promo cards.

## Fonts

| Local file | Source | License |
| --- | --- | --- |
| `assets/fonts/inter-latin-var.woff2` | Google Fonts (Inter, latin subset) | SIL Open Font License 1.1 |
| `assets/fonts/archivo-italic-latin-var.woff2` | Google Fonts (Archivo, italic latin subset) | SIL Open Font License 1.1 |

Both are self-hosted variable fonts (no external request at runtime, works offline in the PWA).
Archivo italic is used condensed for the display type of the brand (`La Taba` wordmark, hero
headline, promo titles); Inter carries the rest of the interface.
- Photos with visible watermarks or recognizable restaurant branding were not used.
