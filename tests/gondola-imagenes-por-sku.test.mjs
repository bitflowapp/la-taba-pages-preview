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
  /*
   * POR QUÉ ESTA PRUEBA YA NO DICE «tiene que ser FALLBACK».
   *
   * Mientras las únicas fotografías reales del catálogo fueron los cuatro
   * packshots del embotellador, «esta unidad no muestra un pack» y «esta unidad
   * no muestra ninguna foto» eran la misma frase, y la prueba se escribió con
   * la segunda. Dejaron de serlo el 2026-08-22, cuando entraron packshots de
   * botella suelta: desde entonces exigir FALLBACK no prohíbe un pack mal
   * puesto, prohíbe que una unidad tenga su propia foto, que es exactamente lo
   * que el catálogo busca. La prueba seguía en verde sólo porque la auditoría
   * versionada estaba atrasada respecto de producción.
   *
   * Lo que se prohíbe es lo que dice el título, y ahora en los dos momentos que
   * importan: en lo que la góndola YA muestra, y en lo que este lote dejaría
   * listo para publicar. Lo segundo es lo que atrapa una unidad emparejada con
   * un packshot ANTES de que llegue a producción, que es cuando todavía sale
   * barato. `lote-objetivo.mjs` es la lista escrita de cuánto anuncia cada
   * fotografía.
   */
  const unidades = auditoria.filas.filter((row) => row.unitsPerPack === 1);
  assert.ok(unidades.length > 0, 'si no queda ninguna unidad suelta, esta prueba dejó de mirar algo');

  const preparados = new Set(
    JSON.parse(fs.readFileSync(path.join(root, 'docs/catalog/image-manifest.json'), 'utf8'))
      .sources.map((fuente) => fuente.sku),
  );

  for (const fila of unidades) {
    const publicada = fila.tipo === 'REAL';
    const preparada = preparados.has(fila.sku);
    if (!publicada && !preparada) continue;
    const declarado = OBJETIVOS.get(fila.sku);
    assert.ok(
      declarado,
      `${fila.sku} tiene fotografía ${publicada ? 'publicada' : 'preparada'} y ningún lote declara qué cantidad anuncia`,
    );
    assert.equal(
      declarado.unitsPerPack,
      1,
      `${fila.sku} es una unidad y su fotografía ${publicada ? `publicada (${fila.imageUrl})` : 'preparada'} `
      + `anuncia x${declarado.unitsPerPack}`,
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

test('cada SKU visible dice POR QUÉ tiene o no tiene foto, con vocabulario cerrado', () => {
  /*
   * «FALLBACK: 30» junta dos situaciones que no se parecen: quince SKU cuya
   * foto exacta existe y está identificada pero no se puede publicar, y quince
   * para los que no hay ninguna fuente alcanzable. La primera se destraba con
   * un correo a la marca; la segunda sólo con fotografía propia. Si esa
   * distinción no está en el dato, el informe comercial la tiene que inventar.
   *
   * El vocabulario es cerrado a propósito, y «SIMILAR» no está en él: una
   * imagen parecida es una imagen incorrecta, no una categoría intermedia.
   */
  const PERMITIDAS = new Set([
    'OFFICIAL_EXACT', 'AUTHORIZED_EXACT', 'FALLBACK',
    'BLOCKED_RIGHTS', 'BLOCKED_IDENTITY', 'INCORRECTA', 'AUSENTE',
  ]);
  for (const fila of auditoria.filas) {
    assert.ok(
      PERMITIDAS.has(fila.clasificacion),
      `${fila.sku}: clasificación «${fila.clasificacion}» fuera del vocabulario`,
    );
    assert.notEqual(fila.clasificacion, 'SIMILAR', `${fila.sku}: «SIMILAR» no es apto para producción`);
  }

  const suma = Object.values(auditoria.porClasificacion).reduce((a, b) => a + b, 0);
  assert.equal(suma, auditoria.filas.length, 'el resumen por clasificación no cuenta todas las filas');
  assert.equal(auditoria.totalVisibles, auditoria.filas.length);

  // Una foto REAL siempre cae de un lado exacto, nunca en un bloqueo.
  for (const fila of auditoria.filas.filter((f) => f.tipo === 'REAL')) {
    assert.ok(
      ['OFFICIAL_EXACT', 'AUTHORIZED_EXACT'].includes(fila.clasificacion),
      `${fila.sku}: tiene foto publicada y quedó clasificado «${fila.clasificacion}»`,
    );
    assert.ok(fila.referenciaDerechos, `${fila.sku}: foto publicada sin referencia de derechos`);
  }

  // Y un bloqueo por identidad tiene que estar respaldado por una medición: no
  // se declara «la fuente la publica pero no sirve» sin haberlo medido.
  const medidos = new Set(medicionDelSello.mediciones.map((m) => m.sku));
  for (const fila of auditoria.filas.filter((f) => f.clasificacion === 'BLOCKED_IDENTITY')) {
    assert.ok(
      medidos.has(fila.sku),
      `${fila.sku}: bloqueado por identidad sin medición que lo respalde`,
    );
    assert.equal(fila.imageUrl, '', `${fila.sku}: está bloqueado y aun así declara una imagen`);
  }
});

test('la medición cubre TODAS las imágenes del candidato, no sólo la portada', () => {
  /*
   * La conclusión del relevamiento es una negación universal —«ningún packshot
   * oficial sirve para una unidad»—, y hasta el 2026-08-24 se apoyaba en una
   * imagen por SKU. La tienda publica productos con varias: la lata 354ml trae
   * seis alternativas de edición mundialista que nadie había medido. Si una
   * sola viniera sin sello, o con el sello apoyado en blanco limpio, la
   * negación sería falsa. Esta prueba obliga a que la evidencia incluya cada
   * archivo que la fuente publica.
   */
  const todas = medicionDelSello.mediciones.flatMap(
    (medicion) => [medicion, ...(medicion.alternativas ?? [])],
  );
  assert.equal(
    medicionDelSello.resumen.imagenesMedidas,
    todas.length,
    'el resumen no cuenta las mismas imágenes que trae el detalle',
  );
  assert.ok(
    todas.length > medicionDelSello.mediciones.length,
    'ningún candidato aporta alternativas: o la fuente cambió, o el relevamiento dejó de leerlas',
  );
  for (const medicion of medicionDelSello.mediciones) {
    assert.equal(
      (medicion.alternativas ?? []).length + 1,
      medicion.imagenesPublicadas,
      `${medicion.sku}: se publicaron ${medicion.imagenesPublicadas} imágenes y se midieron otras tantas menos`,
    );
  }
  for (const imagen of todas) {
    assert.equal(imagen.selloDetectado, true, `${imagen.fuenteUrl}: sin sello detectado, hay que mirarla a mano`);
    assert.equal(
      imagen.pisaElEnvase,
      true,
      `${imagen.fuenteUrl}: el sello NO pisa el envase, así que esta imagen podría limpiarse y hay que decidirla a mano`,
    );
    assert.match(imagen.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(medicionDelSello.resumen.imagenesConSelloQuePisa, todas.length);
});

test('una edición limitada no puede quedar como la foto de un SKU estándar', async () => {
  /*
   * El único candidato oficial que corresponde a `coca-cola-original-lata-354ml`
   * es la lata de la «Edición Países Mundialistas»: mismo GTIN, misma capacidad,
   * mismo envase, y siete diseños de país distintos. Aunque el sello desapareciera
   * mañana, esa foto no puede ir a la ficha de la lata estándar —el cliente vería
   * una lata de Brasil y recibiría cualquier otra—. Lo que la frena es que el
   * scorer no la da por idéntica; esta prueba fija esa conducta, porque el día
   * que la aflojen la edición limitada entra sola.
   */
  const { parseSourceTitle, scoreCandidate, skuPresentation } = await import(
    '../scripts/catalog-images/presentation.mjs'
  );
  const { loadCatalogSkus } = await import('../scripts/catalog-images/catalog-skus.mjs');
  const { skus } = await loadCatalogSkus(root);
  const sku = skus.find((fila) => fila.sku === 'coca-cola-original-lata-354ml');
  assert.ok(sku, 'desapareció el SKU de la lata original');

  const edicion = parseSourceTitle('Coca-Cola Lata 354ml x6 “Edicion Paises Mundialistas”', {
    packagingConvention: { default: 'lata' },
  });
  const veredicto = scoreCandidate(
    { ...skuPresentation(sku), packCount: edicion.packCount },
    edicion,
    { brandDeclared: 'Coca Cola' },
  );
  assert.notEqual(
    veredicto.confidence,
    'HIGH',
    'la edición mundialista quedó idéntica a la lata estándar: entraría sola por el pipeline',
  );
  assert.ok(
    veredicto.reasons.some((razon) => /línea no es idéntica/.test(razon)),
    `se esperaba que la línea delatara la edición limitada, y las razones fueron: ${JSON.stringify(veredicto.reasons)}`,
  );

  // Y el control positivo: la lata estándar del mismo tamaño sí sería idéntica.
  const estandar = parseSourceTitle('Coca-Cola Original Lata 354ml x6', {
    packagingConvention: { default: 'lata' },
  });
  assert.equal(
    scoreCandidate({ ...skuPresentation(sku), packCount: estandar.packCount }, estandar, {
      brandDeclared: 'Coca Cola',
    }).confidence,
    'HIGH',
    'el control positivo dejó de pasar: el scorer ahora rechaza hasta la lata estándar',
  );
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
