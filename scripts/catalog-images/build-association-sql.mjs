/*
 * Emite el lote SQL que asocia cada fotografía aprobada a su producto.
 *
 * NO TOCA LA BASE. Escribe un archivo de texto que una persona puede leer
 * entero antes de aplicarlo. Es el mismo criterio que usa
 * `gondola-neuquen-plan.mjs`, y por el mismo motivo: asociar una imagen a un
 * producto exige un JWT de owner autenticado —la clave publicable no escribe
 * `products`, y RLS está para eso— y esa contraseña no vive en ninguna
 * herramienta. Aplicarlo es un paso aparte, humano y explícito.
 *
 * QUÉ ESCRIBE, EN ORDEN
 * ---------------------
 * 1. La fila en `catalog_assets`, que es donde vive el modelo de derechos.
 * 2. El `UPDATE` de los seis campos de imagen en `products`.
 *
 * El orden importa: `assert_product_asset_origin` no deja apuntar a un asset
 * que no exista o que no tenga derechos, así que el asset va primero.
 *
 *   node scripts/catalog-images/build-association-sql.mjs
 *   node scripts/catalog-images/build-association-sql.mjs --aprobado-por <uuid>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { DB_PRODUCT_ASSET_PATTERN, isSha256 } from './lib.mjs';
import { loadCatalogSkus } from './catalog-skus.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFIESTO = path.join(ROOT, 'docs/catalog/image-manifest.json');
const AUTORIZACIONES = path.join(ROOT, 'catalog/autorizaciones-comerciales.json');
const SALIDA = path.join(ROOT, 'artifacts/taba2-catalog-images/asociar-imagenes.sql');
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';

function arg(nombre) {
  const indice = process.argv.indexOf(`--${nombre}`);
  return indice === -1 ? undefined : process.argv[indice + 1];
}

const autorizaciones = JSON.parse(await fs.readFile(AUTORIZACIONES, 'utf8'));
const autoridad = autorizaciones.autorizaciones.find((a) => a.id === 'TABA-AUT-2026-08-001');
const aprobadoPor = arg('aprobado-por') || autoridad.owner_user_id;

const manifiesto = JSON.parse(await fs.readFile(MANIFIESTO, 'utf8'));
const { skus } = await loadCatalogSkus(ROOT);
const porSku = new Map(skus.map((sku) => [sku.sku, sku]));

const literal = (valor) => `'${String(valor).replaceAll("'", "''")}'`;
const problemas = [];
const bloques = [];

for (const fuente of manifiesto.sources) {
  const sku = porSku.get(fuente.sku);
  if (!sku) {
    problemas.push(`${fuente.sku}: no está en el catálogo de producción.`);
    continue;
  }
  const master = fuente.assets.master;
  const thumbnail = fuente.assets.thumbnail;

  // Lo que la base va a exigir, comprobado acá para que el lote no se aplique y
  // reviente a mitad de camino.
  for (const [nombre, ruta] of [['master', master.path], ['thumbnail', thumbnail.path]]) {
    if (!DB_PRODUCT_ASSET_PATTERN.test(ruta)) {
      problemas.push(`${fuente.sku}: la ruta ${nombre} (${ruta}) no entra en el patrón que exige la base.`);
    }
  }
  if (master.path === thumbnail.path) problemas.push(`${fuente.sku}: master y thumbnail no pueden ser el mismo archivo.`);
  for (const [nombre, hash] of [['master', master.sha256], ['thumbnail', thumbnail.sha256], ['fuente', fuente.sourceSha256]]) {
    if (!isSha256(hash)) problemas.push(`${fuente.sku}: SHA-256 de ${nombre} inválido.`);
  }

  bloques.push(`
-- ${sku.name} · ${sku.capacityValue} ${sku.capacityUnit} · ${sku.soldAsPack ? `pack x${sku.unitsPerPack}` : 'unidad'}
--   fuente: ${fuente.sourceUrl}
--   derechos: ${fuente.rightsStatus} · ${fuente.rightsReference}
insert into public.catalog_assets (
  business_id, external_id, sku, safe_sku, identity_sha256,
  master_path, master_sha256, master_binding_sha256, master_width, master_height,
  thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
  source_sha256, source_url, rights_status, rights_reference, approved_at, approved_by
) values (
  ${literal(BUSINESS_ID)}, ${literal(fuente.externalId)}, ${literal(fuente.sku)}, ${literal(fuente.safeSku)}, ${literal(fuente.identitySha256)},
  ${literal(master.path)}, ${literal(master.sha256)}, ${literal(master.bindingSha256)}, ${master.width}, ${master.height},
  ${literal(thumbnail.path)}, ${literal(thumbnail.sha256)}, ${literal(thumbnail.bindingSha256)}, ${thumbnail.width}, ${thumbnail.height},
  ${literal(fuente.sourceSha256)}, ${literal(fuente.sourceUrl)}, ${literal(fuente.rightsStatus)}, ${literal(fuente.rightsReference)},
  now(), ${literal(aprobadoPor)}
)
on conflict (business_id, sku) do update set
  master_path = excluded.master_path,
  master_sha256 = excluded.master_sha256,
  master_binding_sha256 = excluded.master_binding_sha256,
  thumbnail_path = excluded.thumbnail_path,
  thumbnail_sha256 = excluded.thumbnail_sha256,
  thumbnail_binding_sha256 = excluded.thumbnail_binding_sha256,
  source_sha256 = excluded.source_sha256,
  source_url = excluded.source_url,
  rights_status = excluded.rights_status,
  rights_reference = excluded.rights_reference,
  updated_at = now();

update public.products set
  catalog_asset_id = (select id from public.catalog_assets
                      where business_id = ${literal(BUSINESS_ID)} and sku = ${literal(fuente.sku)}),
  image_url = ${literal(master.path)},
  image_sha256 = ${literal(master.sha256)},
  image_thumbnail_url = ${literal(thumbnail.path)},
  image_thumbnail_sha256 = ${literal(thumbnail.sha256)},
  source_image_sha256 = ${literal(fuente.sourceSha256)},
  updated_at = now()
where business_id = ${literal(BUSINESS_ID)} and sku = ${literal(fuente.sku)};`);
}

if (problemas.length) {
  for (const problema of problemas) console.error(`ERROR ${problema}`);
  console.error('No se emite un lote que la base va a rechazar.');
  process.exit(1);
}

const sql = `-- TABA2 · asociar las fotografías aprobadas a sus productos
--
-- GENERADO por scripts/catalog-images/build-association-sql.mjs. No editar a mano.
-- Destino: Supabase PRODUCTIVO wwcpogltfgzgkrlilbcd, negocio ${BUSINESS_ID}.
--
-- QUÉ HACE Y QUÉ NO
-- -----------------
-- Toca EXCLUSIVAMENTE los seis campos de imagen de ${manifiesto.sources.length} productos, más su fila
-- en catalog_assets. NO toca precios, stock, disponibilidad, alcohol, ordering,
-- ni ninguna otra columna. No crea ni borra productos.
--
-- ANTES DE APLICAR
-- ----------------
-- 1. Los archivos WebP tienen que estar publicados en el sitio: el lote escribe
--    rutas relativas y la vitrina las va a pedir por HTTP.
-- 2. Se aplica con un usuario owner autenticado. La clave publicable no escribe
--    products, y está bien que no lo haga.
-- 3. Es idempotente: volver a aplicarlo deja el mismo estado.
--
-- Aprobado por: ${aprobadoPor}
-- Autoridad de derechos: ${autoridad.id} (${autoridad.estado}; evidencia documental pendiente: ${autoridad.evidencia_documental.pendiente})

begin;
${bloques.join('\n')}

-- Constancia: cuántos productos quedaron con la cadena de imagen completa.
select count(*) as productos_con_imagen
from public.products
where business_id = ${literal(BUSINESS_ID)}
  and image_url is not null
  and catalog_asset_id is not null;

commit;
`;

await fs.mkdir(path.dirname(SALIDA), { recursive: true });
await fs.writeFile(SALIDA, sql, 'utf8');
console.log(`Lote: ${path.relative(ROOT, SALIDA).replaceAll('\\', '/')}`);
console.log(`Productos que asocia: ${manifiesto.sources.length}`);
console.log('NO se aplicó. Aplicarlo exige un owner autenticado y es una decisión humana.');
