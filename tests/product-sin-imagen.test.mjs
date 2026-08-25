import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  productThumb,
  productImageRightsCleared,
  comboMedia,
  productPhotoIsOfficial,
  customerCombos,
  setComboCheckoutAvailability,
} from '../js/ui.js';
import {
  buildBeverageHomeSections,
  isPurchasableBeverageProduct,
  isVisibleBeverageProduct,
} from '../js/core/beverage-home-sections.js';
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

    // Muestra el recurso propio de TABA, no un hueco ni un ícono roto. Es
    // NEUTRO a propósito: no imita al producto, porque una aproximación
    // dibujada de una Coca-Cola no es una Coca-Cola.
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

test('caso 10 · toda foto publicable está declarada en el manifiesto, no en el código', () => {
  // Esto pedía que la lista tuviera exactamente un elemento, el recurso propio
  // de TABA, y avisaba en su propio mensaje qué hacer cuando creciera: «que
  // quede declarado en el manifiesto, no en el código». Creció el 2026-08-18 con
  // los cuatro packs del embotellador, y quedó declarado. Lo que se comprueba
  // ahora es la regla, no el número: nada es publicable por estar escrito en un
  // archivo .mjs.
  const publicables = auditProductImageRights(root).filter((imagen) => imagen.publishable);
  const manifiesto = JSON.parse(fs.readFileSync(path.join(root, 'docs/catalog/image-manifest.json'), 'utf8'));
  const declarados = new Map();
  for (const fuente of manifiesto.sources || []) {
    for (const asset of [fuente.assets?.master, fuente.assets?.thumbnail]) {
      if (asset?.path) declarados.set(asset.path, fuente);
    }
  }

  assert.ok(publicables.length > 0);
  for (const imagen of publicables) {
    if (imagen.path === 'assets/products/beverage-placeholder.svg') continue;
    const fuente = declarados.get(imagen.path);
    assert.ok(fuente, `${imagen.path} se considera publicable y no está en el manifiesto`);
    assert.ok(String(fuente.rightsReference || '').trim(), `${imagen.path} no cita ninguna autoridad de derechos`);
    assert.match(fuente.sourceUrl, /^https:\/\//);
  }
});

test('caso 10 bis · ninguna foto de un CDN de retailer se volvió publicable', () => {
  const historico = JSON.parse(fs.readFileSync(path.join(root, 'catalog/image-manifest.json'), 'utf8'));
  const deRetailer = new Set();
  for (const fuente of historico.sources || []) {
    for (const asset of [fuente.master, fuente.thumbnail]) {
      if (asset?.path) deRetailer.add(asset.path);
    }
  }
  assert.ok(deRetailer.size >= 120, 'los 60 activos históricos son master y thumbnail');
  for (const imagen of auditProductImageRights(root)) {
    if (!deRetailer.has(imagen.path)) continue;
    assert.equal(imagen.publishable, false, `${imagen.path} viene de un retailer y no puede publicarse`);
  }
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

test('la vidriera tampoco descarta un producto por no tener foto', () => {
  // El MISMO acople, un piso más arriba y sobreviviendo a la 108:
  // `isVisibleBeverageProduct` exigía `image || imageThumbnail`, y de esa
  // función parten las once secciones de la home —carruseles, «lo más pedido»,
  // banners y destinos editoriales—. Medido el 2026-08-18 con un catálogo real
  // sin fotografías: 52 productos cargados, la vista de catálogo dibujándolos
  // con su precio, y la home ENTERA vacía.
  const sinFoto = {
    id: 'quilmes-clasica-lata-473ml',
    sku: 'quilmes-clasica-lata-473ml',
    name: 'Quilmes Clásica',
    categoryId: 'cervezas',
    price: 2050,
    stock: 24,
    available: true,
    pricePending: false,
    alcoholic: true,
  };

  assert.equal(isVisibleBeverageProduct(sinFoto), true, 'sin foto no puede significar sin producto');
  assert.equal(isPurchasableBeverageProduct(sinFoto), true);

  // Lo que sí sigue afuera de la góndola: el bulto de abastecimiento.
  assert.equal(isVisibleBeverageProduct({ ...sinFoto, procurementOnly: true }), false);
  assert.equal(isVisibleBeverageProduct({ ...sinFoto, archived: true }), false);
  // Y lo que no se puede comprar sigue sin poder comprarse.
  assert.equal(isPurchasableBeverageProduct({ ...sinFoto, stock: 0 }), false);
  assert.equal(isPurchasableBeverageProduct({ ...sinFoto, pricePending: true }), false);
});

test('las once secciones de la home siguen en pie con un catálogo sin fotos', () => {
  const catalogo = [
    { id: 'a', sku: 'a', name: 'Quilmes Clásica', categoryId: 'cervezas', price: 2050, stock: 24, available: true, pricePending: false },
    { id: 'b', sku: 'b', name: 'Coca-Cola', categoryId: 'gaseosas', price: 5900, stock: 24, available: true, pricePending: false },
    { id: 'c', sku: 'c', name: 'Fernet Branca', categoryId: 'fernet', price: 26250, stock: 6, available: true, pricePending: false },
  ];
  const secciones = buildBeverageHomeSections(catalogo, [], { limit: 10 })
    .filter((seccion) => seccion.kind === 'category' && seccion.products.length > 0);

  assert.deepEqual(
    secciones.map((seccion) => seccion.id).sort(),
    ['cervezas', 'fernet-y-aperitivos', 'gaseosas'],
    'una home vacía con productos cargados es una tienda que se lee como cerrada',
  );
});

test('un combo con un componente sin foto no dibuja una imagen rota', () => {
  // `src=""` no significa «sin imagen»: es una petición a la URL de la propia
  // página, que el servidor contesta con el HTML del sitio. El navegador la
  // resuelve con naturalWidth 0 y dibuja el ícono de imagen rota.
  const html = comboMedia({
    id: 'combo-previa',
    name: 'Previa',
    components: [
      { quantity: 6, product: { id: 'a', name: 'Quilmes Clásica', image: '', imageThumbnail: '' } },
    ],
  });

  assert.doesNotMatch(html, /<img[^>]*src=""/, 'volvió el src vacío');
  assert.match(html, /assets\/products\/beverage-placeholder\.svg/);
  assert.match(html, /combo-media-item uses-placeholder/);
});

test('un combo que nadie puede cobrar no se ofrece', () => {
  // El manifiesto de combos se resuelve contra el catálogo vivo, así que un
  // comercio que carga los componentes enciende el combo sin pedirlo. En
  // producción, sin Mercado Pago, ese combo llega al checkout y lo rechazan.
  // `app.js` es quien sabe si se puede cobrar; acá se prueba que la góndola
  // obedezca esa declaración en las dos direcciones.
  setComboCheckoutAvailability({ available: false });
  assert.deepEqual(customerCombos(), [], 'se ofrece un combo que el checkout va a rechazar');

  setComboCheckoutAvailability({ available: true });
  assert.ok(Array.isArray(customerCombos()), 'apagar y encender tiene que ser reversible');
});

test('la vidriera publica una foto sólo si el catálogo también la publicaría', () => {
  // El modelo de derechos vale si TODAS las superficies preguntan lo mismo. La
  // home tenía su propia regla —`imageThumbnail || image`, sin derechos y sin
  // hashes— y publicaba fotos que la ficha, dos toques después, reemplazaba por
  // el placeholder. Medido en el catálogo de demostración: las 82 llegan con
  // RETAILER_SOLO_REFERENCIA.
  const hash = 'a'.repeat(64);
  const conDerechos = {
    id: 'x', name: 'Quilmes Clásica', categoryId: 'cervezas', price: 2050,
    image: 'assets/products/x.webp', imageThumbnail: 'assets/products/x-thumb.webp',
    imageSha256: hash, imageThumbnailSha256: hash, sourceImageSha256: hash,
    rightsStatus: 'LICENCIA_COMERCIAL',
  };
  const sinDerechos = { ...conDerechos, rightsStatus: 'RETAILER_SOLO_REFERENCIA' };

  assert.equal(productPhotoIsOfficial(conDerechos), true);
  assert.equal(productPhotoIsOfficial(sinDerechos), false, 'una foto de retailer no se publica');
  assert.equal(productPhotoIsOfficial({ ...conDerechos, imageSha256: '' }), false, 'sin la cadena de hashes no es oficial');
  assert.equal(productPhotoIsOfficial({ ...conDerechos, imageShowsMultipack: true }), false, 'un pack no ilustra una unidad');

  // Y la tarjeta obedece la misma respuesta.
  assert.match(productThumb(conDerechos), /assets\/products\/x-thumb\.webp/);
  assert.match(productThumb(sinDerechos), /beverage-placeholder\.svg/);
});
