import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

let sharp;
try { ({ default: sharp } = await import('sharp')); } catch { throw new Error('sharp es obligatorio; ejecute npm ci antes de este pipeline.'); }

const ROOT = path.resolve(import.meta.dirname, '..');
const CATALOG = path.join(ROOT, 'catalog');
const NOW = new Date().toISOString();
const OUT = path.join(ROOT, 'assets/catalog/products');

// The source inventory stays outside runtime and is supplied explicitly when
// this one-off authority pipeline is rerun. Never commit a machine-local path.
const L = path.resolve(process.env.TABA2_LOCAL_SOURCE_ROOT || path.join(ROOT, 'artifacts/source-bebidas'));
const A = path.join(ROOT, 'artifacts/alt-candidates');
const secondary = (sourceUrl, imageUrl, sourceFile, sourceDomain = new URL(sourceUrl).hostname) => ({ sourceUrl, imageUrl, sourceFile, sourceDomain, sourceType: 'cadena_comercial_secundaria' });

const CANDIDATES = [
  { sku:'coca-cola-original-2250ml-local', brand:'Coca-Cola', name:'Coca-Cola Sabor Original', variant:'Original', category:'gaseosas', ml:2250, packageType:'botella-pet', priority:'P0', source:secondary('https://www.jumbo.com.ar/gaseosa-coca-cola-sabor-original-2-25-l/p','https://jumboargentina.vtexassets.com/arquivos/ids/782825/Gaseosa-Coca-cola-Sabor-Original-2-25-L-2-247191.jpg?v=638206689776800000',path.join(A,'coca-original-3.jpg')) },
  { sku:'coca-cola-sin-azucar-2250ml-local', brand:'Coca-Cola', name:'Coca-Cola Sin Azúcar', variant:'Sin azúcar', category:'gaseosas', ml:2250, packageType:'botella-pet', priority:'P0', source:secondary('https://www.jumbo.com.ar/coca-cola-zero-2-25-lt/p','https://jumboargentina.vtexassets.com/arquivos/ids/799869/Gaseosa-Coca-Cola-Sin-Azucar-2-25lt-2-19721.jpg?v=638349573657430000',path.join(A,'coca-zero-3.jpg')) },
  { sku:'sprite-sin-azucar-2250ml-local', brand:'Sprite', name:'Sprite', variant:'Sin azúcar', category:'gaseosas', ml:2250, packageType:'botella-pet', priority:'P0', source:secondary('https://www.vea.com.ar/gaseosa-sprite-lima-limon-zero-2-25lt-2/p','https://jumboargentina.vteximg.com.br/arquivos/ids/562193/Gaseosa-Sprite-225-Lts-Sin-Azucar-1-838913.jpg?v=637117604012800000',path.join(L,'gaseosas/Sprite Zero 2.25 L/imagen-principal.jpg')) },
  { sku:'7up-original-2000ml-local', brand:'7UP', name:'7UP', variant:'Original', category:'gaseosas', ml:2000, packageType:'botella-pet', priority:'P0', source:secondary('https://www.vea.com.ar/gaseosa-lima-limon-x-2-lts-7-up/p','https://jumboargentina.vteximg.com.br/arquivos/ids/904889/Gaseosa-Lima-Lim-n-X-2-Lts-7-Up-1-1057020.jpg?v=639118749814970000',path.join(L,'gaseosas/7Up 1.5 L/imagen-principal.jpg')) },
  { sku:'bonaqua-sin-gas-2250ml-local', brand:'Bonaqua', name:'Bonaqua', variant:'Sin gas', category:'aguas', ml:2250, packageType:'botella-pet', priority:'P0', source:secondary('https://www.vea.com.ar/agua-mineral-bonaqua-sin-gas-2-25-lt/p','https://jumboargentina.vteximg.com.br/arquivos/ids/580641/Bonaqua-Agua-Sin-Gas-225-L-1-244936.jpg?v=637219994244430000',path.join(L,'aguas/Bonaqua 2.25 L/packshot.jpg')) },
  { sku:'manaos-lima-limon-2250ml-local', brand:'Manaos', name:'Manaos', variant:'Lima limón', category:'gaseosas', ml:2250, packageType:'botella-pet', priority:'P1', source:secondary('https://www.vea.com.ar/manaos-lima-limon/p','https://jumboargentina.vteximg.com.br/arquivos/ids/209840/Manaos-Lima-Limon-Manaos-Lima-LimOn-225-L-1-46242.jpg?v=636383733104870000',path.join(L,'gaseosas/Manaos Lima-Lim-n 2.25 L/imagen-principal.jpg')) },
  { sku:'manaos-naranja-2250ml-local', brand:'Manaos', name:'Manaos', variant:'Naranja', category:'gaseosas', ml:2250, packageType:'botella-pet', priority:'P1', source:secondary('https://www.vea.com.ar/manaos-naranja/p','https://jumboargentina.vteximg.com.br/arquivos/ids/209654/Manaos-Naranja-Manaos-Naranja-225-L-1-46056.jpg?v=636383729320530000',path.join(L,'gaseosas/Manaos Naranja 2.25 L/imagen-principal.jpg')) },
  { sku:'pepsi-black-2250ml-local', brand:'Pepsi', name:'Pepsi Black', variant:'Sin azúcar', category:'gaseosas', ml:2250, packageType:'botella-pet', priority:'P0', source:secondary('https://www.vea.com.ar/pepsi-sin-azucar-2-25-l/p','https://jumboargentina.vteximg.com.br/arquivos/ids/411939/Pepsi-Sin-Azucar-225-L-1-237878.jpg?v=636442054847200000',path.join(L,'gaseosas/Pepsi 2.25 L/imagen-principal.jpg')) },
  { sku:'schweppes-tonica-354ml-local', brand:'Schweppes', name:'Schweppes Tónica', variant:'Tónica', category:'mixers', ml:354, packageType:'lata', priority:'P0', source:secondary('https://www.jumbo.com.ar/gaseosa-schweppes-tonica-354-ml/p','https://jumboargentina.vtexassets.com/arquivos/ids/782871/Gaseosa-Schweppes-T-nica-354-Ml-2-6811.jpg?v=638206689960470000',path.join(A,'schweppes-tonica-3.jpg')) },
  { sku:'levite-manzana-2250ml-local', brand:'Levité', name:'Levité', variant:'Manzana', category:'aguas-saborizadas', ml:2250, packageType:'botella-pet', priority:'P0', source:secondary('https://www.jumbo.com.ar/saborizada-levite-manzana-2-25lt/p','https://jumboargentina.vtexassets.com/arquivos/ids/620139/Agua-Saborizada-Villa-Del-Sur-Levite-Manzana-Sin-Gas-2-25-L-2-838138.jpg?v=637466226136070000',path.join(A,'levite-manzana-3.jpg')) },
  { sku:'gancia-americano-950ml-local', brand:'Gancia', name:'Gancia', variant:'Americano', category:'aperitivos', ml:950, packageType:'botella', priority:'P0', alcoholic:true, source:secondary('https://www.jumbo.com.ar/aperitivo-gancia-950-ml/p','https://jumboargentina.vtexassets.com/arquivos/ids/418477/Aperitivo-Gancia-950-Ml-2-237510.jpg?v=636442174678630000',path.join(A,'gancia-2.jpg')) },
  { sku:'martini-bianco-1000ml-local', brand:'Martini', name:'Martini Bianco', variant:'Bianco', category:'aperitivos', ml:1000, packageType:'botella', priority:'P0', alcoholic:true, source:secondary('https://www.jumbo.com.ar/aperitivo-martini-bianco-1-l/p','https://jumboargentina.vtexassets.com/arquivos/ids/431608/Aperitivo-Martini-Bianco-1-L-2-243250.jpg?v=636513303942100000',path.join(A,'martini-2.jpg')) },
  { sku:'monster-ultra-473ml-local', brand:'Monster', name:'Monster Ultra', variant:'Sin azúcar', category:'energizantes', ml:473, packageType:'lata', priority:'P0', source:secondary('https://www.jumbo.com.ar/bebida-energizante-energy-ultra-473-ml-monster/p','https://jumboargentina.vtexassets.com/arquivos/ids/881647/Bebida-Energizante-Energy-Ultra-473-Ml-Monster-2-597947.jpg?v=638919057731470000',path.join(A,'monster-ultra-2.jpg')) },
  { sku:'fernet-branca-edicion-mundial-750ml', brand:'Fernet Branca', name:'Fernet Branca Edición Mundial', variant:'Edición Mundial', category:'fernet', ml:750, packageType:'botella', priority:'P0', alcoholic:true, source:secondary('https://www.vea.com.ar/fernet-branca-edicion-mundial-750/p','https://jumboargentina.vteximg.com.br/arquivos/ids/753736/Fernet-Branca-Edicion-Mundial-750-1-939535.jpg?v=638016393828030000',path.join(L,'fernet/Fernet Branca 750 ml/imagen-principal.jpg')) },
  { sku:'fernet-vittone-1000ml', brand:'Vittone', name:'Fernet Vittone', variant:'Original', category:'fernet', ml:1000, packageType:'botella', priority:'P1', alcoholic:true, source:secondary('https://www.vea.com.ar/fernet-vittone-x-100-cl/p','https://jumboargentina.vteximg.com.br/arquivos/ids/204176/Fernet-Vittone-X-100-Cl-Fernet-Vittone-1-L-1-40569.jpg?v=636383662637700000',path.join(L,'fernet/Vittone 1 L/imagen-principal.jpg')) },
  { sku:'budweiser-lata-473ml-pack-6-local', brand:'Budweiser', name:'Budweiser', variant:'Lager', category:'cervezas', ml:473, packageType:'lata', packCount:6, priority:'P0', alcoholic:true, source:secondary('https://www.vea.com.ar/cerveza-budweiser-473-ml-x-6-un-2/p','https://jumboargentina.vtexassets.com/arquivos/ids/217369/Cerveza-Budweiser-Cerveza-Budweiser-473-Ml---Pack-6-2-44476.jpg?v=639140701148230000',path.join(A,'budweiser-pack-2.jpg')) },
  { sku:'quilmes-ipa-473ml-local', brand:'Quilmes', name:'Quilmes IPA', variant:'IPA', category:'cervezas', ml:473, packageType:'lata', priority:'P0', alcoholic:true, source:secondary('https://www.vea.com.ar/cerveza-ipa-473ml-quilmes/p','https://jumboargentina.vteximg.com.br/arquivos/ids/890548/Cerveza-Ipa-473ml-Quilmes-1-958241.jpg?v=638987206236930000',path.join(L,'cervezas/Quilmes 473 ml/imagen-principal.jpg')) },
  { sku:'alamos-malbec-750ml-local', brand:'Alamos', name:'Alamos Malbec', variant:'Malbec', category:'vinos', ml:750, packageType:'botella', priority:'P1', alcoholic:true, source:secondary('https://www.jumbo.com.ar/vino-alamos-malbec-x-750cc/p','https://jumboargentina.vteximg.com.br/arquivos/ids/709749/Vino-Alamos-Malbec-X-750cc-1-159111.jpg?v=637927402400100000',path.join(L,'vinos/Alamos 750 ml/imagen-principal.jpg')) },
  { sku:'norton-malbec-750ml-local', brand:'Norton', name:'Norton Malbec', variant:'Malbec', category:'vinos', ml:750, packageType:'botella', priority:'P1', alcoholic:true, source:secondary('https://www.vea.com.ar/vino-norton-malbec-750-ml-select/p','https://jumboargentina.vteximg.com.br/arquivos/ids/878665/Vino-Norton-Malbec-750-Ml-Select-1-987113.jpg?v=638894217756570000',path.join(L,'vinos/Norton 750 ml/imagen-principal.jpg')) },
  { sku:'rutini-cabernet-malbec-750ml-local', brand:'Rutini', name:'Rutini', variant:'Cabernet y Malbec', category:'vinos', ml:750, packageType:'botella', priority:'P1', alcoholic:true, source:secondary('https://www.disco.com.ar/vino-tinto-rutini-cabernet-malbec-750-cc/p','https://jumboargentina.vteximg.com.br/arquivos/ids/188714/Vino-Rutini-Cabernet-Malbec-Vino-Tinto-Rutini-Cabernet---Malbec-750-Cc-1-25059.jpg?v=636383496995730000',path.join(L,'vinos/Rutini 750 ml/imagen-principal.jpg')) },
  { sku:'trumpeter-malbec-750ml-local', brand:'Trumpeter', name:'Trumpeter Malbec', variant:'Malbec', category:'vinos', ml:750, packageType:'botella', priority:'P1', alcoholic:true, source:secondary('https://www.vea.com.ar/vino-tinto-trumpeter-malbec-750-cc/p','https://jumboargentina.vteximg.com.br/arquivos/ids/180222/Vino-Trumpeter-Malbec-Vino-Trumpeter-Malbec-Botella-750-Cc-1-11394.jpg?v=636383392055830000',path.join(L,'vinos/Trumpeter 750 ml/imagen-principal.jpg')) },
];

const unitLabel = (ml) => ml >= 1000 ? `${String(ml / 1000).replace('.', ',')} L` : `${ml} ml`;
const slug = (value) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const csvEscape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const writeCsv = async (file, rows) => { const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]; const text = [keys.join(','), ...rows.map((row) => keys.map((key) => csvEscape(row[key])).join(','))].join('\n') + '\n'; await fs.writeFile(file, text); };

const sourceImage = async (candidate) => {
  const absolute = path.resolve(candidate.source.sourceFile);
  const stat = await fs.stat(absolute);
  if (!stat.isFile()) throw new Error(`Activo local inválido: ${absolute}`);
  const bytes = await fs.readFile(absolute);
  const meta = await sharp(bytes).metadata();
  if (!meta.width || !meta.height || meta.width < 600 || meta.height < 600) throw new Error(`Resolución insuficiente: ${meta.width}x${meta.height}`);
  const { data, info } = await sharp(bytes).resize(100, 100, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let border = 0; let nonWhite = 0;
  for (let y = 0; y < 100; y += 1) for (let x = 0; x < 100; x += 1) if (x < 5 || x >= 95 || y < 5 || y >= 95) { border += 1; const i = (y * 100 + x) * info.channels; if (Math.min(data[i], data[i + 1], data[i + 2]) < 245) nonWhite += 1; }
  if ((nonWhite / border) > 0.15) throw new Error(`Fondo complejo o pieza gráfica en borde (${Math.round(nonWhite / border * 100)}%)`);
  return { bytes, meta, borderNonWhite: Math.round(nonWhite / border * 100) };
};

const normalize = async (bytes, candidate, size) => {
  const max = candidate.packCount > 1 ? 0.80 : candidate.packageType === 'lata' ? 0.74 : 0.86;
  const trimmed = await sharp(bytes).rotate().flatten({ background: '#ffffff' }).trim({ background: '#ffffff', threshold: 10 }).resize(Math.round(size * max), Math.round(size * max), { fit: 'inside', withoutEnlargement: false }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 3, background: '#ffffff' } }).composite([{ input: trimmed, gravity: 'centre' }]).webp({ quality: 92 }).toBuffer();
};

const portableSource = (file) => {
  const normalized = file.replaceAll('\\', '/');
  const localRoot = L.replaceAll('\\', '/');
  const altRoot = A.replaceAll('\\', '/');
  if (normalized.toLowerCase().startsWith(localRoot.toLowerCase())) return `<LOCAL_SOURCE_ROOT>/bebidas/${path.relative(L, file).replaceAll('\\', '/')}`;
  if (normalized.toLowerCase().startsWith(altRoot.toLowerCase())) return `<WORKTREE_ROOT>/artifacts/alt-candidates/${path.basename(file)}`;
  return '<EXTERNAL_SOURCE_FILE>';
};

const buildProduct = (candidate, masterPath, thumbPath, master, thumb, source, imageMeta) => ({
  id: candidate.sku, external_id: candidate.sku, sku: candidate.sku, slug: candidate.sku, gtin: '',
  brand: candidate.brand, name: candidate.name, variant: candidate.variant,
  presentation: `${candidate.packageType === 'lata' ? 'Lata' : candidate.packageType === 'botella-pet' ? 'Botella PET' : 'Botella'} · ${unitLabel(candidate.ml)} · ${candidate.packCount ? `Pack x${candidate.packCount}` : 'Unidad'}`,
  capacity_value: candidate.ml, capacity_unit: 'ml', pack_count: candidate.packCount || 1,
  category_id: candidate.category, subcategory_id: slug(candidate.variant), package_type: candidate.packageType,
  description: `${candidate.category === 'cervezas' ? 'Cerveza' : candidate.category === 'vinos' ? 'Vino' : candidate.name} en ${candidate.packageType === 'lata' ? 'lata' : 'botella'} de ${unitLabel(candidate.ml)}${candidate.packCount ? `, pack de ${candidate.packCount}` : ''}.`,
  tags: [candidate.category, slug(candidate.brand), slug(candidate.variant)],
  alcohol_percentage: null, alcohol_status: candidate.alcoholic ? 'not_supplied_by_source' : 'not_applicable', age_restricted: Boolean(candidate.alcoholic),
  price: null, regular_price: null, price_status: 'pending', stock_status: 'confirmation_required', is_active: false, is_verified: true,
  catalog_status: 'approved', image_status: 'verified', rights_status: 'pending_review', publication_status: 'blocked', commercial_status: 'identity_verified_price_pending', identity_status: 'verified',
  image_master: masterPath, image_thumbnail: thumbPath, image_sha256: sha(master), image_thumbnail_sha256: sha(thumb),
  image_source: { source_url: source.sourceUrl, image_source_url: source.imageUrl, source_domain: source.sourceDomain, source_title: `${candidate.name} ${unitLabel(candidate.ml)}`, source_type: source.sourceType, retrieved_at: NOW, source_sha256: sha(source.bytes), source_file: portableSource(source.sourceFile), original_width: imageMeta.meta.width, original_height: imageMeta.meta.height, border_nonwhite_percent: imageMeta.borderNonWhite },
  notes: 'Identidad y frente de producto verificados contra ficha comercial y activo local. Derechos pendientes; precio pendiente por diseño; bloqueado para compra y publicación.', priority: candidate.priority,
});

const products = JSON.parse(await fs.readFile(path.join(CATALOG, 'products.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(CATALOG, 'image-manifest.json'), 'utf8'));
const existing = new Set(products.map((product) => product.sku));
const existingHashes = new Set(products.filter((product) => product.catalog_status === 'approved').flatMap((product) => [product.image_sha256, product.image_thumbnail_sha256]).filter(Boolean));
const added = []; const rejected = [];
const VISUAL_REJECTED = new Map([
  ['quilmes-ipa-473ml-local', 'Rechazado en auditoría visual: el activo disponible incluye un panel gráfico lateral y no es un packshot limpio de fondo blanco. Requiere fotografía propia o activo oficial alternativo.'],
]);
for (const candidate of CANDIDATES) {
  if (VISUAL_REJECTED.has(candidate.sku)) {
    const existingIndex = products.findIndex((item) => item.sku === candidate.sku);
    if (existingIndex >= 0 && process.argv.includes('--renormalize')) {
      const removed = products[existingIndex];
      for (const relative of [removed.image_master, removed.image_thumbnail]) {
        if (relative?.startsWith('assets/catalog/products/')) await fs.rm(path.join(ROOT, relative), { force: true });
      }
      products.splice(existingIndex, 1);
    }
    rejected.push({ sku: candidate.sku, reason: VISUAL_REJECTED.get(candidate.sku) });
    continue;
  }
  if (existing.has(candidate.sku) && !process.argv.includes('--renormalize')) { rejected.push({ sku: candidate.sku, reason: 'SKU ya existe; no se duplica.' }); continue; }
  try {
    const source = { ...candidate.source, ...(await sourceImage(candidate)) };
    const master = await normalize(source.bytes, candidate, 1000); const thumb = await normalize(source.bytes, candidate, 400);
    const masterSha = sha(master); const thumbSha = sha(thumb);
    const current = products.find((item) => item.sku === candidate.sku);
    const ownHashes = process.argv.includes('--renormalize') && current ? new Set([current.image_sha256, current.image_thumbnail_sha256]) : new Set();
    if ((existingHashes.has(masterSha) && !ownHashes.has(masterSha)) || (existingHashes.has(thumbSha) && !ownHashes.has(thumbSha)) || masterSha === thumbSha) throw new Error('Colisión SHA-256 con un activo aprobado.');
    const dir = path.join(OUT, candidate.category); await fs.mkdir(dir, { recursive: true });
    const masterPath = `assets/catalog/products/${candidate.category}/${candidate.sku}-master.webp`; const thumbPath = `assets/catalog/products/${candidate.category}/${candidate.sku}-thumb.webp`;
    await fs.writeFile(path.join(ROOT, masterPath), master); await fs.writeFile(path.join(ROOT, thumbPath), thumb);
    const product = buildProduct(candidate, masterPath, thumbPath, master, thumb, source, source);
    const existingProduct = current;
    if (existingProduct && process.argv.includes('--renormalize')) Object.assign(existingProduct, product);
    else { added.push(product); products.push(product); existing.add(candidate.sku); }
    existingHashes.add(masterSha); existingHashes.add(thumbSha);
  } catch (error) { rejected.push({ sku: candidate.sku, reason: String(error.message) }); }
}

for (const product of products) {
  if (product.catalog_status === 'approved' && product.identity_status === 'approved') product.identity_status = 'verified';
  if (product.catalog_status === 'rejected') product.publication_status = 'blocked';
}

const approvedSkus = new Set(products.filter((item) => item.catalog_status === 'approved').map((item) => item.sku));
const allSources = (manifest.sources || []).filter((source) => approvedSkus.has(source.sku));
for (const product of products.filter((item) => item.catalog_status === 'approved' && item.image_source?.source_url)) {
  const entry = { sku: product.sku, source_url: product.image_source.source_url, image_source_url: product.image_source.image_source_url, source_title: product.image_source.source_title, source_type: product.image_source.source_type, retrieved_at: product.image_source.retrieved_at, source_sha256: product.image_source.source_sha256, rights_status: 'pending_review', master: { path: product.image_master, sha256: product.image_sha256, width: 1000, height: 1000, format: 'webp', color_space: 'srgb' }, thumbnail: { path: product.image_thumbnail, sha256: product.image_thumbnail_sha256, width: 400, height: 400, format: 'webp', color_space: 'srgb' }, white_background: { border_nonwhite_percent: product.image_source.border_nonwhite_percent } };
  const index = allSources.findIndex((source) => source.sku === product.sku); if (index >= 0) allSources[index] = entry; else allSources.push(entry);
}

await fs.writeFile(path.join(CATALOG, 'products.json'), `${JSON.stringify(products, null, 2)}\n`);
await writeCsv(path.join(CATALOG, 'products.csv'), products);
await fs.writeFile(path.join(CATALOG, 'image-manifest.json'), `${JSON.stringify({ schema_version: 3, generated_at: NOW, publication_status: 'blocked', sources: allSources }, null, 2)}\n`);
await writeCsv(path.join(CATALOG, 'image-sources.csv'), products.filter((p) => p.catalog_status === 'approved').map((p) => ({ product_name:p.name, brand:p.brand, variant:p.variant, presentation:p.presentation, capacity:p.capacity_value, capacity_unit:p.capacity_unit, pack_count:p.pack_count, category:p.category_id, source_url:p.image_source.source_url, image_source_url:p.image_source.image_source_url, source_domain:p.image_source.source_domain, source_title:p.image_source.source_title, source_type:p.image_source.source_type, retrieved_at:p.image_source.retrieved_at, commercial_status:p.commercial_status, identity_status:p.identity_status, rights_status:p.rights_status, notes:p.notes, sha256:p.image_sha256 })));
await writeCsv(path.join(CATALOG, 'image-rights.csv'), products.filter((p) => p.image_status === 'verified').map((p) => ({ sku:p.sku, rights_status:p.rights_status, rights_evidence_type:'', rights_evidence_url:'', rights_evidence_file:'', rights_evidence_date:'', rights_scope:'', rights_notes:'Fuente comercial secundaria; autorización comercial no concedida.', verified_by:'', verified_at:'' })));
await writeCsv(path.join(CATALOG, 'pending-prices.csv'), products.filter((p) => p.price_status === 'pending').map((p) => ({ sku:p.sku, brand:p.brand, name:p.name, price:'', regular_price:'', price_status:'pending', publication_status:p.publication_status, notes:'Precio próximamente. Producto bloqueado para carrito y checkout.' })));
await writeCsv(path.join(CATALOG, 'pending-images.csv'), products.filter((p) => p.image_status !== 'verified').map((p) => ({ sku:p.sku, reason:p.notes || 'Imagen pendiente.' })).concat(rejected));
await writeCsv(path.join(CATALOG, 'rejected-assets.csv'), [{ sku:'heineken-original-lata-473ml-pack-6', asset:'assets/catalog/beverages/heineken-original-lata-473ml-pack-6/product.webp', reason:'Rechazo preservado: colisión con la lata individual; no se reutiliza ni se recompone.' }, ...rejected.map((item) => ({ sku:item.sku, asset:'', reason:item.reason }))]);
await writeCsv(path.join(CATALOG, 'review-queue.csv'), products.filter((p) => p.rights_status === 'pending_review' || p.catalog_status === 'review_only').map((p) => ({ sku:p.sku, catalog_status:p.catalog_status, image_status:p.image_status || 'candidate', rights_status:p.rights_status || 'pending_review', price_status:p.price_status, publication_status:p.publication_status || 'blocked', priority:p.priority || 'legacy' })));
await writeCsv(path.join(CATALOG, 'publication-readiness.csv'), products.map((p) => ({ sku:p.sku, identity_status:p.identity_status, image_status:p.image_status, rights_status:p.rights_status, price_status:p.price_status, catalog_status:p.catalog_status, publication_status:p.publication_status, ready:'false', reason:p.rights_status !== 'approved' ? 'Derechos pendientes' : p.price_status !== 'confirmed' ? 'Precio pendiente' : 'Revisión manual' })));
console.log(JSON.stringify({ added: added.length, rejected, total_products: products.length, approved_for_review: products.filter((p) => p.catalog_status === 'approved').length, price_pending: products.filter((p) => p.price_status === 'pending').length }, null, 2));
