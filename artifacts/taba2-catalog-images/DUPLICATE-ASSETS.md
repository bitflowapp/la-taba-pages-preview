# Imágenes repetidas entre SKU

Comparación por firma de color 8x8 RGB sobre el master de cada SKU con fotografía.
Idéntica = mismo SHA-256 del master. Parecida = diferencia media de color ≤ 6 sobre 255.

SKU con fotografía comparados: 14 de 72.

- `coca-cola-original-botella-pet-500-ml-pack-x12` y `coca-cola-zero-botella-pet-500-ml-pack-x12` — casi idéntica, diferencia media de color 0.6/255
- `coca-cola-original-2250ml` y `coca-cola-zero-2250ml` — casi idéntica, diferencia media de color 1.1/255
- `sprite-original-2250ml` y `sprite-zero-2250ml` — casi idéntica, diferencia media de color 1.5/255
- `benedictino-sin-gas-2250ml` y `sprite-botella-pet-500-ml-pack-x12` — casi idéntica, diferencia media de color 4.7/255
- `benedictino-sin-gas-2250ml` y `sprite-original-2250ml` — casi idéntica, diferencia media de color 4.9/255

## Por qué se mira esto

Dos SKU con la misma imagen no siempre es un error —dos presentaciones pueden
compartir packaging—, pero nunca es una casualidad que se pueda dejar sin
explicar: es también la forma exacta que toma un binding mal hecho, donde una
foto se asocia al producto equivocado y nadie lo nota porque la foto, en sí,
está bien.
