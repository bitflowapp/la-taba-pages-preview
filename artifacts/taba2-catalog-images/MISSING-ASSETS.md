# Lo que falta, y qué haría falta para conseguirlo

52 de 56 SKU siguen sin fotografía y usan el recurso propio de TABA. Eso no
bloquea vender: la migración 108 desacopló vendibilidad de imagen, y la vitrina
dibuja el placeholder sin romperse.

Esto es la lista de trabajo del próximo round, ordenada por lo que realmente
haría falta hacer.

## Por qué faltan, en dos grupos distintos

**`SIN_FUENTE` (31)** — no se encontró una fuente oficial que publique catálogo
de forma programática. Lo medido el 2026-08-18:

| dominio probado | resultado |
|---|---|
| `tiendaquilmes.com.ar`, `tienda.quilmes.com.ar`, `tiendaabinbev.com.ar` | no resuelven |
| `www.pepsi.com.ar`, `tienda.pepsico.com.ar` | no resuelven |
| `www.villadelsur.com.ar`, `www.villavicencio.com.ar` | sitio de marca; responden 200 a cualquier ruta y no exponen catálogo |
| `www.redbull.com`, `www.monsterenergy.com` | 403 al agente automático |
| `www.speed.com.ar`, `www.trapiche.com.ar` | 404 en la API de catálogo |

Cubrir este grupo NO es un problema de código: hace falta que cada marca provea
su paquete de packshots, o que aparezca una tienda oficial con catálogo abierto.
Agregar un grupo nuevo a `catalog/image-source-allowlist.json` y, si no es VTEX,
un adaptador nuevo en `scripts/catalog-images/sources/` es media hora de trabajo.
Conseguir el permiso y el material es lo que lleva tiempo.

**`SIN_CANDIDATO` (17)** — la marca SÍ tiene fuente oficial permitida, y esa
fuente no publica este producto. Casi todos son el mismo caso: **la tienda de
Coca-Cola Andina vende packs y nuestro SKU es la unidad suelta**. El packshot
existe y es correcto, pero lleva el sello «x6» o «x12» encima y usarlo para una
unidad sería exactamente lo que la autorización comercial prohíbe.

Para estos 17 la salida no es buscar mejor: es conseguir el packshot de la unidad
—que el embotellador tiene, simplemente no lo publica en su tienda— o fotografiar
el producto. Una foto propia entra como `PROPIO` y no depende de ningún permiso
de terceros.


### SIN_FUENTE — 31 SKU

- **1882** (1): `fernet-1882-750ml`
- **7UP** (1): `seven-up-original-2000ml`
- **Andes Origen** (2): `andes-origen-roja-lata-473ml`, `andes-origen-rubia-lata-473ml`
- **Brahma** (1): `brahma-chopp-lata-710ml`
- **Budweiser** (1): `budweiser-lata-473ml`
- **Corona** (1): `corona-extra-botella-330ml`
- **Dr. Lemon** (1): `dr-lemon-vodka-pomelo-lata-473ml`
- **Fernet Branca** (1): `fernet-branca-1000ml`
- **Gancia** (2): `gancia-americano-450ml`, `gancia-lima-limon-lata-473ml`
- **Gatorade** (2): `gatorade-cool-blue-500ml`, `gatorade-manzana-1250ml`
- **Manaos** (1): `soda-manaos-sifon-2000ml`
- **Paso de los Toros** (2): `paso-de-los-toros-pomelo-1500ml`, `paso-de-los-toros-tonica-1500ml`
- **Patagonia** (1): `patagonia-amber-lager-botella-730ml`
- **Pepsi** (2): `pepsi-black-1500ml`, `pepsi-original-2000ml`
- **Quilmes** (4): `quilmes-clasica-botella-710ml`, `quilmes-clasica-lata-473ml`, `quilmes-clasica-lata-473ml-pack-6`, `quilmes-stout-lata-473ml`
- **Red Bull** (2): `red-bull-original-250ml`, `red-bull-sin-azucar-250ml`
- **Speed** (2): `speed-original-473ml`, `speed-zero-473ml`
- **Stella Artois** (1): `stella-artois-lata-473ml`
- **Villa del Sur** (1): `villa-del-sur-sin-gas-600ml`
- **Villavicencio** (2): `villavicencio-con-gas-500ml`, `villavicencio-sin-gas-1500ml`

### SIN_CANDIDATO — 17 SKU

- **Aquarius** (3): `aquarius-manzana-1500ml`, `aquarius-pera-1500ml`, `aquarius-pomelo-2250ml`
- **Benedictino** (1): `benedictino-sin-gas-2250ml`
- **Cafayate** (1): `cafayate-torrontes-750ml`
- **Coca-Cola** (4): `coca-cola-original-2250ml`, `coca-cola-original-lata-354ml`, `coca-cola-zero-2250ml`, `coca-cola-zero-lata-354ml`
- **Fanta** (1): `fanta-naranja-2250ml`
- **Monster** (1): `monster-green-zero-473ml`
- **Skyy** (1): `vodka-skyy-700ml`
- **Sprite** (3): `sprite-original-2250ml`, `sprite-original-lata-354ml`, `sprite-zero-2250ml`
- **Toro Viejo** (1): `toro-viejo-clasico-tinto-750ml`
- **Toro** (1): `toro-tinto-1000ml`

## Lo que ya está resuelto y no hay que rehacer

El pipeline entero: allowlist por marca, adaptador VTEX, matcher de cinco ejes,
descarga verificada por SHA-256, normalización a 1000/400 WebP, binding
criptográfico, guard de derechos, manifiesto público, escaneo del paquete, hoja
de contactos y detección de repetidas. Sumar una marca es agregarla a la
allowlist y correr `npm run catalog:images:discover`.
