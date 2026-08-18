import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { productThumb, productImageRightsCleared } from '../js/ui.js';
import { auditProductImageRights, unpublishableProductImages } from '../scripts/lib/publishable-image-rights.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/*
 * Un producto sin foto tiene que poder venderse, y verse bien mientras lo hace.
 *
 * La decisión de producto es que no vamos a fotografiar SKU por SKU: un comercio
 * con miles de artículos no puede quedar cerrado esperando fotos. La base ya deja
 * de exigir imagen para publicar (migración 108). Lo que se prueba acá es la otra
 * mitad: que la vitrina no se rompa ni se afee cuando la foto no está, y que una
 * imagen que no tenemos derecho a publicar no llegue al público por ningún
 * camino.
 */

const SIN_FOTO = {
  id: 'coca-cola-original-pet-500ml-pack-12',
  name: 'Coca-Cola Original',
  categoryId: 'gaseosas',
  price: 17100,
  alcoholic: false,
};

test('caso 9 · un producto sin imagen se dibuja completo y digno', () => {
  for (const variante of ['grid', 'list', 'modal']) {
    const html = productThumb(SIN_FOTO, variante);

    // Muestra el recurso propio de TABA, no un hueco ni un ícono roto.
    assert.match(html, /assets\/products\/beverage-placeholder\.svg/, variante);
    assert.match(html, /class="thumb uses-placeholder/, variante);
    assert.match(html, /is-placeholder/, variante);

    // Ocupa exactamente el mismo lugar que una foto: sin salto de maquetación.
    assert.match(html, /width="400"/, variante);
    assert.match(html, /height="400"/, variante);

    // Se anuncia con palabras, no con un alt vacío que el lector de pantalla
    // saltee: la persona ciega tiene que enterarse de que no hay foto.
    assert.match(html, /role="img"/, variante);
    assert.match(
      html,
      /aria-label="Producto sin imagen oficial: Coca-Cola Original"/,
      variante,
    );

    // Y no pide una imagen que no existe: sin srcset no hay 404 ni parpadeo.
    assert.doesNotMatch(html, /srcset=/, variante);
  }
});

test('caso 9 · el placeholder existe, es de TABA y pesa poco', () => {
  const archivo = path.join(root, 'assets/products/beverage-placeholder.svg');
  assert.ok(fs.existsSync(archivo), 'sin el archivo, la card muestra un ícono roto');
  assert.ok(fs.statSync(archivo).size < 20 * 1024);
});

test('una foto sin derechos no se muestra, por completa que venga su metadata', () => {
  // Este producto trae los tres hashes y su miniatura: por el criterio viejo
  // pasaba como oficial. Lo único que le falta es el permiso para publicarla.
  const deTercero = {
    name: 'Sprite sin azúcar',
    categoryId: 'gaseosas',
    image: 'assets/catalog/products/gaseosas/sprite-sin-azucar-600ml-master.webp',
    imageThumbnail: 'assets/catalog/products/gaseosas/sprite-sin-azucar-600ml-thumb.webp',
    imageSha256: 'a'.repeat(64),
    imageThumbnailSha256: 'b'.repeat(64),
    sourceImageSha256: 'c'.repeat(64),
    rightsStatus: 'pending_review',
  };

  assert.equal(productImageRightsCleared(deTercero), false);
  const html = productThumb(deTercero);
  assert.match(html, /beverage-placeholder\.svg/);
  assert.doesNotMatch(html, /sprite-sin-azucar/);
});

test('una foto propia y con derechos sí se muestra', () => {
  const propia = {
    name: 'Coca-Cola Original',
    categoryId: 'gaseosas',
    image: 'assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/product.webp',
    imageThumbnail: 'assets/catalog/beverages/coca-cola-original-pet-500ml-pack-12/thumbnail.webp',
    imageSha256: 'a'.repeat(64),
    imageThumbnailSha256: 'b'.repeat(64),
    sourceImageSha256: 'c'.repeat(64),
    rightsStatus: 'PROPIO',
  };

  assert.equal(productImageRightsCleared(propia), true);
  const html = productThumb(propia);
  assert.match(html, /has-photo/);
  assert.match(html, / srcset="/);
  assert.match(html, /Imagen oficial de Coca-Cola Original/);
});

test('los tres estados que habilitan son los mismos que exige la base', () => {
  for (const estado of ['PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO']) {
    assert.equal(productImageRightsCleared({ rightsStatus: estado }), true, estado);
  }
  for (const estado of ['pending_review', 'UNAPPROVED_QA', 'RETAILER_SOLO_REFERENCIA', '', undefined]) {
    assert.equal(productImageRightsCleared({ rightsStatus: estado }), false, String(estado));
  }
});

test('caso 10 · ninguna foto sin derechos viaja en el paquete productivo', () => {
  const paquete = path.join(root, 'dist_release');
  if (!fs.existsSync(paquete)) {
    // El paquete se arma en el momento de publicar; si no está, no hay nada que
    // revisar todavía y la prueba de la fuente (abajo) sigue valiendo.
    return;
  }

  const prohibidas = unpublishableProductImages(root);
  const coladas = prohibidas.filter((relativa) => fs.existsSync(path.join(paquete, relativa)));

  assert.deepEqual(
    coladas.slice(0, 10),
    [],
    `${coladas.length} fotos sin derechos están dentro de dist_release. `
    + 'Un archivo subido queda servido con URL propia aunque ningún producto lo enlace: '
    + 'volvé a armar el paquete con scripts/create-release-folder.mjs.',
  );
});

test('caso 10 · la única foto de producto publicable es la propia de TABA', () => {
  const publicables = auditProductImageRights(root).filter((imagen) => imagen.publishable);

  assert.deepEqual(
    publicables.map((imagen) => imagen.path),
    ['assets/products/beverage-placeholder.svg'],
    'si esta lista crece, alguien consiguió derechos: que quede declarado en el manifiesto, '
    + 'no en el código.',
  );
});

test('el criterio de derechos falla cerrado: lo no declarado no se publica', () => {
  const auditoria = auditProductImageRights(root);
  const sinDeclarar = auditoria.filter((imagen) => imagen.rights === 'sin declarar');

  assert.ok(sinDeclarar.length > 0, 'el repositorio tiene fotos sin declarar; si no, revisá el barrido');
  assert.ok(
    sinDeclarar.every((imagen) => !imagen.publishable),
    'una foto que nadie declaró no puede considerarse publicable',
  );
});

test('el cliente ya no descarta un producto por no tener foto', async () => {
  // El espejo exacto del defecto que la migración 108 corrigió en la base: el
  // mapeador del repositorio tenía su propio `!image || !imageThumbnail` y
  // borraba de la tienda a cualquier producto sin fotografía. La tienda se veía
  // vacía con cuatro productos cargados y verificados.
  // Se miran las sentencias, no los comentarios: el comentario que explica el
  // defecto lo nombra, y nombrarlo no es cometerlo.
  const fuente = fs.readFileSync(
    path.join(root, 'js/repositories/supabase_order_repository.js'),
    'utf8',
  ).split('\n').filter((linea) => !linea.trim().startsWith('//')).join('\n');

  assert.doesNotMatch(
    fuente,
    /\|\|\s*!image\s*\|\|\s*!imageThumbnail/,
    'volvió el descarte por falta de imagen en rowToCatalogProduct',
  );
  assert.match(
    fuente,
    /imagenCompleta/,
    'la imagen tiene que evaluarse como todo-o-nada, igual que en la base',
  );
});
