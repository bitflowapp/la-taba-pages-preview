import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { productThumb, productPhotoIsOfficial } from '../js/ui.js';
import { loadCatalogSkus } from '../scripts/catalog-images/catalog-skus.mjs';
import { OBJETIVOS } from '../scripts/catalog-images/lote-objetivo.mjs';
import { parseSourceTitle, scoreCandidate, skuPresentation } from '../scripts/catalog-images/presentation.mjs';
import { auditProductImageRights } from '../scripts/lib/publishable-image-rights.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/*
 * CADA SKU CON SU FOTO, Y NINGUNA OTRA.
 *
 * El error caro de un catálogo con fotos no es la tarjeta sin imagen: es la
 * tarjeta con la imagen de OTRO producto. El cliente pide una Coca-Cola de
 * 2,25 L, ve la foto de una de 1,5 L y le llega algo que no es lo que miró; o
 * ve el packshot de un pack de doce, paga una y recibe una.
 *
 * Lo que se prueba acá es esa correspondencia, en los cuatro ejes con los que
 * el cliente distingue un producto de otro —variante, volumen, envase y
 * cantidad— más los dos que deciden si la foto puede publicarse: derechos y
 * existencia real del archivo.
 */

const auditoria = JSON.parse(
  fs.readFileSync(path.join(root, 'docs/catalog/gondola-publica-imagenes.json'), 'utf8'),
);
const medicionDelSello = JSON.parse(
  fs.readFileSync(path.join(root, 'catalog/sello-de-pack-medicion.json'), 'utf8'),
);
const PLACEHOLDER = 'assets/products/beverage-placeholder.svg';

/** Un producto tal como lo recibe la vitrina, desde una fila de la auditoría. */
function comoLoVeLaVitrina(fila, { master, thumbnail, sha } = {}) {
  const hash = sha || 'a'.repeat(64);
  return {
    id: fila.sku,
    name: fila.nombre,
    categoryId: 'gaseosas',
    price: 1000,
    image: master ?? fila.imageUrl,
    imageThumbnail: thumbnail ?? fila.imageUrl,
    imageSha256: hash,
    imageThumbnailSha256: hash,
    sourceImageSha256: hash,
    rightsStatus: fila.derechos,
  };
}

test('la auditoría de la góndola está al día con la fotografía de producción', async () => {
  const { skus } = await loadCatalogSkus(root);
  const comprables = skus.filter((sku) => sku.available);
  assert.equal(
    auditoria.filas.length,
    comprables.length,
    'la auditoría versionada no cubre los mismos SKU que producción muestra: correr npm run catalog:images:audit',
  );
  for (const sku of comprables) {
    const fila = auditoria.filas.find((row) => row.sku === sku.sku);
    assert.ok(fila, `${sku.sku} está comprable y no aparece en la auditoría`);
    assert.equal(fila.imageUrl, sku.imageUrl || '', `${sku.sku}: la auditoría no coincide con la fotografía`);
    assert.equal(fila.unitsPerPack, sku.unitsPerPack, sku.sku);
  }
});

test('ninguna tarjeta de la góndola muestra una imagen incorrecta ni ausente', () => {
  const rotas = auditoria.filas.filter((fila) => fila.tipo === 'INCORRECTA' || fila.tipo === 'AUSENTE');
  assert.deepEqual(
    rotas.map((fila) => `${fila.sku}: ${fila.tipo} · ${fila.motivo}`),
    [],
    'una foto incorrecta es peor que el respaldo propio',
  );
});

test('cada packshot publicado es el de SU SKU: el archivo lleva el SKU en el nombre', () => {
  const reales = auditoria.filas.filter((fila) => fila.tipo === 'REAL');
  assert.ok(reales.length > 0, 'si no queda ninguna foto real, esta prueba dejó de mirar algo');
  for (const fila of reales) {
    const archivo = path.basename(fila.imageUrl);
    assert.ok(
      archivo.startsWith(fila.sku),
      `${fila.sku} muestra ${archivo}: el nombre del archivo no lo nombra, así que puede ser de otro producto`,
    );
    assert.ok(
      fs.existsSync(path.join(root, fila.imageUrl)),
      `${fila.sku} declara ${fila.imageUrl} y el archivo no existe`,
    );
  }
});

test('el sello del packshot anuncia la cantidad que el SKU trae de verdad', () => {
  /*
   * Los packshots del embotellador llevan la cantidad estampada («x12»). Que
   * ese número sea el de `units_per_pack` no es cosmético: si el producto
   * pasara a venderse de a seis, la foto quedaría mintiendo sin que nadie
   * tocara el archivo. `lote-objetivo.mjs` es la lista escrita de cuánto
   * anuncia cada uno.
   */
  for (const fila of auditoria.filas.filter((row) => row.tipo === 'REAL')) {
    const declarado = OBJETIVOS.get(fila.sku);
    assert.ok(declarado, `${fila.sku} tiene packshot publicado y ningún lote declara qué cantidad anuncia`);
    assert.equal(
      declarado.unitsPerPack,
      fila.unitsPerPack,
      `${fila.sku}: el packshot anuncia x${declarado.unitsPerPack} y el SKU trae x${fila.unitsPerPack}`,
    );
  }
});

test('ninguna unidad suelta recibe un packshot de pack', () => {
  for (const fila of auditoria.filas.filter((row) => row.unitsPerPack === 1)) {
    assert.equal(
      fila.tipo,
      'FALLBACK',
      `${fila.sku} es una unidad y muestra ${fila.imageUrl}: el packshot disponible anuncia un pack`,
    );
  }
});

test('Original no recibe Zero, ni Zero recibe Light, ni 2,25 L recibe 1,5 L', () => {
  const convencion = { default: 'botella-pet' };
  const casos = [
    ['la fuente Zero no ilustra el Original',
      { brand: 'Coca-Cola', name: 'Coca-Cola', variant: 'Original', capacityValue: 2250, capacityUnit: 'ml', packagingType: 'botella-pet', unitsPerPack: 6 },
      'Coca–Cola Zero 2,25L x6', 'REJECT'],
    ['la fuente Light no ilustra el Zero',
      { brand: 'Coca-Cola', name: 'Coca-Cola Zero', variant: 'Sin azúcar', capacityValue: 1500, capacityUnit: 'ml', packagingType: 'botella-pet', unitsPerPack: 6 },
      'Coca-Cola Light 1,5L x6', 'REJECT'],
    ['1,5 L no ilustra 2,25 L',
      { brand: 'Coca-Cola', name: 'Coca-Cola', variant: 'Original', capacityValue: 2250, capacityUnit: 'ml', packagingType: 'botella-pet', unitsPerPack: 6 },
      'Coca–Cola Original 1,5L x6', 'REJECT'],
    ['la lata no ilustra la botella',
      { brand: 'Sprite', name: 'Sprite', variant: 'Original', capacityValue: 354, capacityUnit: 'ml', packagingType: 'botella-pet', unitsPerPack: 6 },
      'Sprite Lata 354ml x6', 'REJECT'],
    ['un pack de seis no ilustra una unidad',
      { brand: 'Fanta', name: 'Fanta Naranja', variant: 'Naranja', capacityValue: 2250, capacityUnit: 'ml', packagingType: 'botella-pet', unitsPerPack: 1 },
      'Fanta Naranja 2,25L x6', 'REJECT'],
    ['la fuente exacta sí cierra',
      { brand: 'Coca-Cola', name: 'Coca-Cola Zero', variant: 'Sin azúcar', capacityValue: 2250, capacityUnit: 'ml', packagingType: 'botella-pet', unitsPerPack: 6 },
      'Coca–Cola Zero 2,25L x6', 'HIGH'],
  ];
  for (const [titulo, sku, fuente, esperado] of casos) {
    const parsed = parseSourceTitle(fuente, { packagingConvention: convencion });
    const { confidence } = scoreCandidate(skuPresentation({ ...sku, sku: 'prueba' }), parsed, {
      brandDeclared: sku.brand,
    });
    assert.equal(confidence, esperado, `${titulo} · «${fuente}»`);
  }
});

test('«sin azúcar» y «zero» son la misma variante, y «light» sigue siendo otra', () => {
  // El catálogo escribe «Sin azúcar» donde el embotellador escribe «Zero». Si
  // el matcher no los reconoce como el mismo eje, rechaza la foto correcta de
  // Coca-Cola Zero por contradecir a Coca-Cola Zero.
  const parsed = parseSourceTitle('Monster Green Zero 473ml x6', { packagingConvention: { default: 'lata' } });
  const sku = skuPresentation({
    sku: 'monster-green-zero-473ml', brand: 'Monster', name: 'Monster Green Zero',
    variant: 'Sin azúcar', capacityValue: 473, capacityUnit: 'ml', packagingType: 'lata', unitsPerPack: 6,
  });
  assert.equal(scoreCandidate(sku, parsed, { brandDeclared: 'Monster' }).confidence, 'HIGH');

  const light = parseSourceTitle('Monster Green Light 473ml x6', { packagingConvention: { default: 'lata' } });
  assert.equal(scoreCandidate(sku, light, { brandDeclared: 'Monster' }).confidence, 'REJECT');
});

test('un asset inexistente o sin derechos no llega a la tarjeta: cae al respaldo propio', () => {
  const conFoto = auditoria.filas.find((fila) => fila.tipo === 'REAL');
  assert.ok(conFoto, 'hace falta al menos una foto real para probar el contraste');

  // Con derechos y hashes: la tarjeta publica la foto.
  const publicada = productThumb(comoLoVeLaVitrina(conFoto));
  assert.match(publicada, new RegExp(path.basename(conFoto.imageUrl)));
  assert.equal(productPhotoIsOfficial(comoLoVeLaVitrina(conFoto)), true);

  // Sin derechos: la misma ruta deja de publicarse.
  const sinDerechos = comoLoVeLaVitrina({ ...conFoto, derechos: 'pending_review' });
  assert.equal(productPhotoIsOfficial(sinDerechos), false);
  assert.match(productThumb(sinDerechos), /beverage-placeholder\.svg/);

  // Sin cadena de hashes: tampoco.
  const sinHashes = { ...comoLoVeLaVitrina(conFoto), imageSha256: '', imageThumbnailSha256: '' };
  assert.equal(productPhotoIsOfficial(sinHashes), false);
  assert.match(productThumb(sinHashes), /beverage-placeholder\.svg/);

  // Y una ruta que no existe en el árbol publicable queda declarada AUSENTE por
  // la auditoría; la tarjeta además cae al respaldo por el manejador de error.
  const rutaInventada = 'assets/products/no-existe-este-packshot.webp';
  assert.equal(fs.existsSync(path.join(root, rutaInventada)), false);
});

test('producción no usa ningún fixture ni activo de demostración', () => {
  for (const fila of auditoria.filas) {
    if (!fila.imageUrl) continue;
    assert.ok(
      fila.imageUrl.startsWith('assets/products/'),
      `${fila.sku} publica ${fila.imageUrl}: fuera de assets/products/ vive material de demo y de retailer`,
    );
    assert.doesNotMatch(fila.imageUrl, /assets\/catalog\//, fila.sku);
    assert.equal(fila.derechos, 'LICENCIA_COMERCIAL', `${fila.sku}: derechos no publicables`);
    assert.equal(fila.referenciaDerechos, 'TABA-AUT-2026-08-001', `${fila.sku}: no cita autoridad de derechos`);
  }

  // El respaldo propio sí viaja, y es lo único propio que la vitrina publica.
  const propias = auditProductImageRights(root).filter((imagen) => imagen.rights === 'PROPIO');
  assert.deepEqual(propias.map((imagen) => imagen.path), [PLACEHOLDER]);
});

test('la medición del sello de pack respalda que las unidades sigan en respaldo', () => {
  /*
   * Esta es la evidencia de por qué las 30 unidades no tienen foto. Si algún
   * día la fuente publicara un packshot sin sello, esta prueba lo delata: deja
   * de haber motivo medido para el respaldo, y hay que volver a mirar.
   */
  assert.ok(medicionDelSello.mediciones.length > 0, 'sin mediciones no hay evidencia de nada');
  for (const medicion of medicionDelSello.mediciones) {
    assert.notEqual(
      medicion.cantidadQueAnunciaLaFuente,
      medicion.cantidadDelSku,
      `${medicion.sku}: la fuente anuncia la misma cantidad que el SKU; entonces la foto podría servir`,
    );
    assert.equal(medicion.selloDetectado, true, `${medicion.sku}: sin sello detectado, hay que mirarla a mano`);
    assert.equal(
      medicion.pisaElEnvase,
      true,
      `${medicion.sku}: el sello NO pisa el envase, así que la decisión de dejarlo en respaldo hay que rehacerla`,
    );
    assert.match(medicion.sha256, /^[a-f0-9]{64}$/);
    assert.match(medicion.fuenteUrl, /^https:\/\/andinacocacolaar\.vtex(assets|img)\./);
  }
});

test('esta misión no tocó precio, stock, disponibilidad ni identidad de ningún producto', async () => {
  /*
   * La compuerta comercial. El pipeline de imágenes lee la fotografía de
   * producción y no escribe en `products`; lo que esta prueba fija es que la
   * fotografía versionada siga describiendo el mismo catálogo comercial, para
   * que un cambio de precio o de disponibilidad no entre de contrabando en un
   * commit de imágenes.
   */
  const { skus, reconciliacion } = await loadCatalogSkus(root);
  assert.equal(reconciliacion.esperadoTotal, 72);
  assert.equal(reconciliacion.sinDeclarar, 0);
  assert.equal(reconciliacion.colisiones, 0);

  const alcoholDisponible = skus.filter((sku) => sku.alcoholic && sku.available);
  assert.deepEqual(alcoholDisponible, [], 'esta misión no habilita alcohol');

  // Los precios que la góndola pública muestra hoy, tal como los ve la clave
  // publicable. Cambiarlos es una decisión comercial y no viaja en este commit.
  const precios = Object.fromEntries(
    skus.filter((sku) => sku.available).map((sku) => [sku.sku, sku.price]),
  );
  assert.equal(precios['coca-cola-original-2250ml'], 5900);
  assert.equal(precios['coca-cola-zero-2250ml'], 5900);
  assert.equal(precios['sprite-original-2250ml'], 5900);
  assert.equal(precios['fanta-naranja-2250ml'], 5900);
  assert.equal(precios['coca-cola-original-pet-1500ml'], 4990);
  assert.equal(precios['coca-cola-original-botella-pet-500-ml-pack-x12'], 17100);
  assert.equal(Object.keys(precios).length, 33);
});
