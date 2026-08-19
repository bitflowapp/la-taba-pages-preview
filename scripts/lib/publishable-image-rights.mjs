// Qué fotos de producto tenemos derecho a publicar.
//
// La respuesta no sale de una lista de rutas escrita a mano —esa se desactualiza
// el día que alguien agrega un archivo— sino de los derechos DECLARADOS, y falla
// cerrada: una foto de producto que nadie declaró no se publica.
//
// Los tres estados que habilitan son los mismos que exige
// `catalog_assets_rights_valid` en la base. Que rija la misma lista de los dos
// lados es el punto entero: si la vitrina publicara con un criterio más laxo que
// la base, el modelo de derechos sería decorativo.
//
// ALCANCE. Esto gobierna las fotos de PRODUCTO, que son las dos carpetas donde
// la base pone sus rutas (`assets/products/*.webp` es el formato que exigen
// `catalog_assets_master_path_safe` y sus hermanas) más el catálogo importado.
// La decoración del sitio —`assets/promos/`, `assets/brand/`— es otra pregunta,
// con otra respuesta, y se reporta aparte en vez de decidirse acá.
import fs from 'node:fs';
import path from 'node:path';

export const PUBLISHABLE_RIGHTS = new Set(['PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO']);

/** Las carpetas donde vive una foto de producto. */
export const PRODUCT_IMAGE_NAMESPACES = ['assets/products/', 'assets/catalog/'];

// El placeholder es de TABA y está auditado como APPROVED_PREVIEW_ONLY: es el
// recurso que existe justamente para cuando no hay foto propia.
export const OWN_ASSETS = new Set(['assets/products/beverage-placeholder.svg']);

const IMAGE = /\.(webp|jpe?g|png|avif|svg)$/i;
const normalize = (value) => String(value || '').replaceAll('\\', '/');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/*
 * Los dos manifiestos hablan idiomas distintos, y hay que entender los dos.
 *
 *   catalog/image-manifest.json        (schema_version 3, el histórico)
 *       source.master.path · source.rights_status
 *   docs/catalog/image-manifest.json   (schemaVersion 1, el del pipeline)
 *       source.assets.master.path · source.rightsStatus
 *
 * Leer sólo la forma vieja no fallaba ruidosamente: dejaba TODO lo que produce
 * el pipeline nuevo como «sin declarar», o sea bloqueado. Falla cerrado, así
 * que nunca publicó de más —pero tampoco publicó nunca nada, y el motivo no
 * aparecía en ningún error. Un guard que ignora al productor de sus datos es un
 * guard que dice que no a todo, y eso se confunde con que no haya material.
 */
function declaredRights(root) {
  const declared = new Map();
  for (const file of ['catalog/image-manifest.json', 'docs/catalog/image-manifest.json']) {
    const manifest = readJson(path.join(root, file));
    for (const source of manifest?.sources || []) {
      const rights = source.rights_status || source.rightsStatus || 'sin declarar';
      const assets = [
        source.master,
        source.thumbnail,
        source.assets?.master,
        source.assets?.thumbnail,
      ];
      for (const asset of assets) {
        if (asset?.path) declared.set(normalize(asset.path), rights);
      }
    }
  }
  return declared;
}

function walk(dir, root, out) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(absolute, root, out); continue; }
    if (IMAGE.test(entry.name)) out.push(normalize(path.relative(root, absolute)));
  }
  return out;
}

const isProductImage = (relative) => PRODUCT_IMAGE_NAMESPACES.some((ns) => relative.startsWith(ns));

/**
 * Cada foto de producto bajo `assets/`, con su estado de derechos y el veredicto.
 * `root` es la raíz del repositorio.
 */
export function auditProductImageRights(root) {
  const declared = declaredRights(root);
  return walk(path.join(root, 'assets'), root, [])
    .filter(isProductImage)
    .map((relative) => {
      const own = OWN_ASSETS.has(relative);
      const rights = own ? 'PROPIO' : (declared.get(relative) || 'sin declarar');
      return {
        path: relative,
        rights,
        publishable: own || PUBLISHABLE_RIGHTS.has(String(rights).toUpperCase()),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Fotos de producto que NO se pueden publicar. Rutas relativas a la raíz. */
export function unpublishableProductImages(root) {
  return auditProductImageRights(root).filter((image) => !image.publishable).map((image) => image.path);
}

/**
 * Imágenes decorativas del sitio. No las bloquea nadie: se listan para que la
 * decisión sobre ellas se tome mirándolas, no por olvido.
 */
export function decorativeImages(root) {
  return walk(path.join(root, 'assets'), root, []).filter((relative) => !isProductImage(relative));
}
