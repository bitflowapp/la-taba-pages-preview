# Imágenes repetidas entre SKU

Comparación por firma de color 8x8 RGB sobre el master de cada SKU con fotografía.
Idéntica = mismo SHA-256 del master. Parecida = diferencia media de color ≤ 6 sobre 255.

SKU con fotografía comparados: 46 de 72.

- `coca-cola-original-botella-pet-500-ml-pack-x12` y `coca-cola-zero-botella-pet-500-ml-pack-x12` — casi idéntica, diferencia media de color 0.6/255
- `coca-cola-original-2250ml` y `coca-cola-zero-2250ml` — casi idéntica, diferencia media de color 1.1/255
- `sprite-original-2250ml` y `sprite-zero-2250ml` — casi idéntica, diferencia media de color 1.5/255
- `aquarius-pera-1500ml` y `aquarius-pomelo-2250ml` — casi idéntica, diferencia media de color 2.4/255
- `coca-cola-original-2250ml` y `coca-cola-original-pet-1500ml` — casi idéntica, diferencia media de color 3.1/255
- `coca-cola-original-pet-1500ml` y `coca-cola-zero-2250ml` — casi idéntica, diferencia media de color 3.5/255
- `benedictino-sin-gas-2250ml` y `villa-del-sur-sin-gas-600ml` — casi idéntica, diferencia media de color 3.6/255
- `pepsi-black-1500ml` y `pepsi-original-2000ml` — casi idéntica, diferencia media de color 3.6/255
- `sprite-botella-pet-500-ml-pack-x12` y `villa-del-sur-sin-gas-600ml` — casi idéntica, diferencia media de color 4.1/255
- `benedictino-sin-gas-2250ml` y `sprite-botella-pet-500-ml-pack-x12` — casi idéntica, diferencia media de color 4.7/255
- `benedictino-sin-gas-2250ml` y `sprite-original-2250ml` — casi idéntica, diferencia media de color 4.9/255
- `sprite-original-2250ml` y `villa-del-sur-sin-gas-600ml` — casi idéntica, diferencia media de color 5/255
- `seven-up-original-2000ml` y `villa-del-sur-sin-gas-600ml` — casi idéntica, diferencia media de color 5.6/255
- `seven-up-original-2000ml` y `sprite-botella-pet-500-ml-pack-x12` — casi idéntica, diferencia media de color 5.7/255
- `villa-del-sur-sin-gas-600ml` y `villavicencio-con-gas-500ml` — casi idéntica, diferencia media de color 5.7/255
- `sprite-zero-2250ml` y `villa-del-sur-sin-gas-600ml` — casi idéntica, diferencia media de color 5.9/255
- `villavicencio-con-gas-500ml` y `villavicencio-sin-gas-1500ml` — casi idéntica, diferencia media de color 6/255

## Por qué se mira esto

Dos SKU con la misma imagen no siempre es un error —dos presentaciones pueden
compartir packaging—, pero nunca es una casualidad que se pueda dejar sin
explicar: es también la forma exacta que toma un binding mal hecho, donde una
foto se asocia al producto equivocado y nadie lo nota porque la foto, en sí,
está bien.
