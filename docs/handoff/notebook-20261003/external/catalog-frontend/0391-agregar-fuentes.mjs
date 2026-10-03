import fs from 'node:fs';

const rev = 'revisada visualmente el 2026-08-25 por TABA_PREMIUM_CATALOG_LAUNCH (Opus 5): descargada, abierta y contrastada contra la fila del SKU';
const filas = [
  ['aquarius-manzana-1500ml', 'https://coca-colaentucasa.com/media/catalog/product/a/q/aqu-manz-nor-pet-1.5l-6pz_1.jpg', 'fabricante', 'a6c6973835d3839a71e8cc2a23b50164b76629aa77cf24a4df7d1e0e428da958',
    'Aquarius Manzana 1,5 L · packshot 1000x1000 del embotellador FEMSA · etiqueta argentina con octogonos EXCESO EN AZUCARES y EXCESO EN CALORIAS, «CONT. NETO 1,5 L» legible, tapa roja · RECORTE DECLARADO: el archivo trae una banda de marketing lateral desde la columna 754 y el envase ocupa las columnas 244-510, asi que se recorta a 700 px de ancho sin tocar un pixel del producto'],
  ['aquarius-pera-1500ml', 'https://coca-colaentucasa.com/media/catalog/product/a/q/aqu-pera-nor-pet-1.5l-6pz_1.jpg', 'fabricante', 'f69932a6d2998fa8a0fc73428c899c16df07332b55e90fd72b2eb03de8420314',
    'Aquarius Pera 1,5 L · packshot 1000x1000 FEMSA · etiqueta argentina, «1,5 L» legible · RECORTE DECLARADO: envase en las columnas 243-510, banda desde la 754'],
  ['aquarius-pomelo-2250ml', 'https://coca-colaentucasa.com/media/catalog/product/a/q/aqu-pome-nor-pet-2.25l-6pz_1.jpg', 'fabricante', '6782d2c1124329b6b8e62b33c5dd544901b75c183cc39c4e690c3334e6bb2691',
    'Aquarius Pomelo 2,25 L · packshot 1000x1000 FEMSA · etiqueta argentina, «2,25 L» legible, tapa amarilla · RECORTE DECLARADO: envase en las columnas 235-528, banda desde la 755'],
  ['gatorade-manzana-1250ml', 'https://boulevard-sa.com.ar/Site/img/products/gatorade/Gatorade-manzana-1250-L.jpg', 'distribuidor_oficial', '2987ba48b015c06fb382efc34c24e7d8dcdd324246c6fd9eca82437231b05a53',
    'Gatorade Manzana 1,25 L · distribuidor oficial CMQ · fondo blanco, sin sello ni texto promocional, tapa naranja y liquido amarillo · la capacidad NO es legible en la etiqueta, y se verifico por otra via: el mismo distribuidor publica las tres capacidades del mismo sabor y las tres fotos son distintas y escalan con el tamano (500 -> 140x392 px de producto, 750 -> 171x458, 1250 -> 175x509), o sea que fotografio cada botella real'],
  ['gatorade-cool-blue-500ml', 'https://boulevard-sa.com.ar/Site/img/products/gatorade/Gatorade-cool-blue-500-L.jpg', 'distribuidor_oficial', '3931efb4cc0861ba7890beb24e42dde77a126a18bf6aea84aefe6744a939a2a8',
    'Gatorade Cool Blue 500 ml · distribuidor oficial CMQ · fondo blanco, sin sello, tapa naranja y liquido celeste · capacidad verificada por la misma via que Manzana · RESOLUCION BAJA: el producto mide 111x311 px en el original, la mas baja del lote'],
];

const nuevas = filas.map(([sku, url, tipo, sha, nota]) => [
  sku, sku, url, tipo, 'LICENCIA_COMERCIAL', 'TABA-AUT-2026-08-001', sha,
  'true', 'true', 'true', 'true', 'APROBADA', '2026-08-25',
  `"${(`${nota} · ${rev}`).replace(/"/g, '""')}"`,
].join(','));

const archivo = 'docs/catalog/image-source-audit.csv';
const texto = fs.readFileSync(archivo, 'utf8').replace(/\n+$/, '');
fs.writeFileSync(archivo, `${texto}\n${nuevas.join('\n')}\n`, 'utf8');
console.log(`filas ahora: ${fs.readFileSync(archivo, 'utf8').trim().split('\n').length}`);
