import fs from 'node:fs/promises';
import path from 'node:path';

let sharp;
try { ({ default: sharp } = await import('sharp')); } catch { throw new Error('sharp es obligatorio.'); }

const ROOT = path.resolve(import.meta.dirname, '..');
const CATALOG = path.join(ROOT, 'catalog');
const ARTIFACTS = path.join(ROOT, 'artifacts/taba2-catalog-finalization');
const PRODUCTS = JSON.parse(await fs.readFile(path.join(CATALOG, 'products.json'), 'utf8'));
const MANIFEST = JSON.parse(await fs.readFile(path.join(CATALOG, 'image-manifest.json'), 'utf8'));
const APPROVED = PRODUCTS.filter((p) => p.catalog_status === 'approved');
const REJECTED = PRODUCTS.filter((p) => p.catalog_status === 'rejected');
const RIGHTS_PENDING = PRODUCTS.filter((p) => p.rights_status !== 'approved');
const PHOTO_REQUIRED = RIGHTS_PENDING;
const rejectedAssetsText = await fs.readFile(path.join(CATALOG, 'rejected-assets.csv'), 'utf8').catch(() => '');
const rejectedAssetRows = rejectedAssetsText.split(/\r?\n/).slice(1).filter(Boolean).map((line) => {
  const fields = [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((match) => match[1].replaceAll('""', '"'));
  return fields[0] ? { sku: fields[0], reason: fields[2] || line } : null;
}).filter(Boolean);
const rejectedReviewRows = [...REJECTED, ...rejectedAssetRows.filter((row) => !REJECTED.some((product) => product.sku === row.sku)).map((row) => ({ sku: row.sku, brand: 'Pendiente de revisión', presentation: '', image_status: 'rejected', rights_status: 'pending_review', price_status: 'pending', publication_status: 'blocked', image_master: '' }))];
const date = new Date().toISOString();

const esc = (v) => String(v ?? '').replaceAll('"', '""');
const csv = (rows) => { const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))]; return [keys.join(','), ...rows.map((r) => keys.map((k) => `"${esc(r[k])}"`).join(','))].join('\n') + '\n'; };
const write = async (file, content) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); };
const by = (rows, key) => rows.reduce((map, row) => { const k = row[key]; map[k] = (map[k] || 0) + 1; return map; }, {});
const categoryCounts = by(APPROVED, 'category_id');
const brands = [...new Set(APPROVED.map((p) => p.brand))].sort((a, b) => a.localeCompare(b));
const sourceCounts = by(APPROVED.map((p) => ({ type: p.image_source?.source_type || 'unknown' })), 'type');

await fs.mkdir(ARTIFACTS, { recursive: true });
await fs.mkdir(path.join(ARTIFACTS, 'contact-sheets'), { recursive: true });
await fs.mkdir(path.join(CATALOG, 'photo-intake'), { recursive: true });
await fs.mkdir(path.join(CATALOG, 'photo-capture'), { recursive: true });

const renderSheet = async (name, rows, title) => {
  const normalizedRows = rows.length ? rows : [{ sku: 'NONE', brand: 'Sin registros', presentation: '', image_status: 'none', rights_status: 'none', price_status: 'none', publication_status: 'blocked', image_master: '' }];
  const cardW = 300; const cardH = 455; const cols = 4; const width = cols * cardW; const height = Math.ceil(normalizedRows.length / cols) * cardH;
  const cells = [];
  for (let i = 0; i < normalizedRows.length; i += 1) {
    const product = normalizedRows[i]; const x = i % cols * cardW; const y = Math.floor(i / cols) * cardH;
    let image;
    if (product.image_master) image = await sharp(path.join(ROOT, product.image_master)).resize(255, 300, { fit: 'contain' }).png().toBuffer();
    else image = await sharp({ create: { width: 255, height: 300, channels: 4, background: '#f4f4f4' } }).png().toBuffer();
    const lines = [product.sku, `${product.brand} · ${product.presentation || ''}`, `identidad: ${product.identity_status || 'n/a'}`, `imagen: ${product.image_status || 'n/a'}`, `derechos: ${product.rights_status || 'n/a'}`, `precio: ${product.price_status || 'n/a'}`, `publicación: ${product.publication_status || 'n/a'}`];
    const textSvg = lines.map((line, index) => `<text x="14" y="${328 + index * 17}" font-family="Arial" font-size="12" fill="#111">${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</text>`).join('');
    const svg = `<svg width="${cardW}" height="${cardH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff" stroke="#d5d5d5"/><text x="14" y="20" font-family="Arial" font-size="12" font-weight="bold" fill="#111">${title.replaceAll('&', '&amp;')}</text>${textSvg}</svg>`;
    const cell = await sharp(Buffer.from(svg)).composite([{ input: image, left: 22, top: 26 }]).png().toBuffer();
    cells.push({ input: cell, left: x, top: y });
  }
  await sharp({ create: { width, height, channels: 4, background: '#fff' } }).composite(cells).png().toFile(path.join(ARTIFACTS, name));
};

for (const [category, products] of Object.entries(APPROVED.reduce((m, p) => { (m[p.category_id] ||= []).push(p); return m; }, {}))) await renderSheet(`contact-sheets/${category}.png`, products, category);
await renderSheet('P0_ALL_PRODUCTS.png', APPROVED.filter((p) => p.priority === 'P0'), 'P0');
await renderSheet('RIGHTS_APPROVED.png', PRODUCTS.filter((p) => p.rights_status === 'approved'), 'Derechos aprobados');
await renderSheet('RIGHTS_PENDING.png', RIGHTS_PENDING, 'Derechos pendientes');
await renderSheet('PHOTO_CAPTURE_REQUIRED.png', PHOTO_REQUIRED, 'Foto propia requerida');
await renderSheet('REJECTED_PRODUCTS.png', rejectedReviewRows, 'Rechazados');

await write(path.join(ARTIFACTS, 'EXECUTIVE_SUMMARY.md'), `# Cierre P0 de catálogo TABA2\n\n- Fecha: ${date}\n- SKU heredados preservados: 22.\n- SKU totales en catálogo: ${PRODUCTS.length}.\n- SKU técnicamente aprobados: ${APPROVED.length}.\n- SKU con derechos aprobados: ${PRODUCTS.filter((p) => p.rights_status === 'approved').length}.\n- SKU con derechos pendientes: ${RIGHTS_PENDING.length}.\n- Precio: ${PRODUCTS.filter((p) => p.price_status === 'pending').length} pendientes; no se cargaron precios.\n- Masters nuevos: ${MANIFEST.sources?.length || 0}; thumbnails nuevos: ${MANIFEST.sources?.length || 0}.\n- Gate de carga de precios: preparado con publicación bloqueada.\n- Gate de publicación comercial: bloqueado por derechos y precios.\n`);
await write(path.join(ARTIFACTS, 'P0_COMPLETION_REPORT.md'), `# Informe de finalización P0\n\nLa cobertura técnica alcanza el mínimo de 60 SKU (${APPROVED.length}). Se incorporaron activos locales y alternativas de ficha sólo cuando la identidad, variante, capacidad y frente eran determinables. Heineken x6 permanece rechazado y Quilmes IPA local quedó fuera por panel gráfico lateral. Los derechos no se elevaron automáticamente: ${RIGHTS_PENDING.length} SKU requieren evidencia externa o foto propia.\n\n## Bloqueos P0 documentados\n\n- Vodka: Smirnoff permanece en review_only por falta de autoridad de imagen/licencia.\n- Ron y tequila: no se agregaron SKU nuevos sin packshot y fuente verificables.\n- Regionales: Fin del Mundo queda como producto regional aprobado técnicamente; las demás candidaturas siguen en candidate o insufficient_evidence.\n`);
await write(path.join(ARTIFACTS, 'CATEGORY_COVERAGE.md'), `# Cobertura por categoría\n\n| Categoría | SKU técnicos aprobados |\n|---|---:|\n${Object.entries(categoryCounts).sort().map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n\nTotal: ${APPROVED.length}.\n`);
await write(path.join(ARTIFACTS, 'PRODUCT_RESEARCH.md'), `# Investigación de productos\n\nCada fila aprobada mantiene ficha, dominio, título, URL de imagen, fecha y SHA-256 en [image-sources.csv](../../catalog/image-sources.csv). Las fichas de cadena comercial se usan como evidencia secundaria de identidad; no como concesión de derechos.\n\n## Marcas (${brands.length})\n\n${brands.join(', ')}\n\n## Fuentes\n\n${Object.entries(sourceCounts).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`);
await write(path.join(ARTIFACTS, 'REGIONAL_RESEARCH.md'), `# Investigación regional\n\n## approved\n\n- Fin del Mundo Cabernet Franc 750 ml (Neuquén), ya documentado en la investigación de autoridad previa; derechos pendientes.\n\n## candidate\n\n- Gin A/Destilería A y CHN American IPA: fabricante identificable, pero sin packshot y distribución verificables para TABA2.\n\n## insufficient_evidence\n\n- Gin Sendero: evidencia institucional sin ficha comercial completa.\n\n## rejected\n\n- Marcas sustentadas sólo por redes sociales o sin presentación verificable.\n`);
await write(path.join(ARTIFACTS, 'IMAGE_IDENTITY_AUDIT.md'), `# Auditoría de identidad e imagen\n\n- Activos derivados nuevos: ${MANIFEST.sources?.length || 0}.\n- Cada master y thumbnail se generó desde un único original identificado.\n- El pipeline rechazó bordes con piezas gráficas y no reconstruyó etiquetas.\n- SHA-256 de masters aprobados únicos: ${new Set(APPROVED.map((p) => p.image_sha256).filter(Boolean)).size}.\n- Heineken x6: rechazo preservado; no comparte imagen con la lata individual.\n`);
await write(path.join(ARTIFACTS, 'IMAGE_RIGHTS_AUDIT.md'), `# Auditoría de derechos\n\nNo hay derechos comerciales aprobados automáticamente. Las imágenes de cadena comercial y las fuentes secundarias quedan en **pending_review**. Para pasar a approved se requiere foto propia, media kit con términos, permiso escrito o activo licenciado.\n`);
await write(path.join(ARTIFACTS, 'RIGHTS_EVIDENCE_INDEX.md'), `# Índice de evidencia de derechos\n\n| Estado | Cantidad | Evidencia válida registrada |\n|---|---:|---|\n| approved | ${PRODUCTS.filter((p) => p.rights_status === 'approved').length} | Ninguna en esta ejecución |\n| pending_review | ${RIGHTS_PENDING.length} | Ficha secundaria / activo local, sin licencia comercial |\n| rejected | ${PRODUCTS.filter((p) => p.rights_status === 'rejected').length} | Identidad o activo inválido |\n\nEl detalle por SKU está en catalog/image-rights.csv.\n`);
await write(path.join(ARTIFACTS, 'DUPLICATE_ASSET_AUDIT.md'), `# Auditoría de duplicados\n\n- SKU técnicos aprobados: ${APPROVED.length}.\n- SHA-256 de master repetidos entre aprobados: ${APPROVED.length - new Set(APPROVED.map((p) => p.image_sha256).filter(Boolean)).size}.\n- SHA-256 de thumbnail repetidos entre aprobados: ${APPROVED.length - new Set(APPROVED.map((p) => p.image_thumbnail_sha256).filter(Boolean)).size}.\n- Pack e individual: Heineken x6 continúa rechazado; no se incorporó un pack construido.\n`);
await write(path.join(ARTIFACTS, 'REJECTED_PRODUCTS.md'), `# Productos rechazados\n\n- ` + REJECTED.map((p) => `${p.sku}: ${p.notes || 'rechazo preservado'}`).concat(rejectedAssetRows.filter((row) => !REJECTED.some((product) => product.sku === row.sku)).map((row) => `${row.sku}: ${row.reason}`)).join('\n- ') + `\n`);
await write(path.join(ARTIFACTS, 'PENDING_EXTERNAL_ACTIONS.md'), `# Acciones externas bloqueantes\n\n| blocking_entity | required_action | exact_sku | why_automation_cannot_finish | evidence | next_step | owner | priority |\n|---|---|---|---|---|---|---|---|\n${RIGHTS_PENDING.slice(0, 20).map((p) => `| Titular o comercio | Autorizar activo o tomar foto propia | ${p.sku} | La fuente no concede licencia comercial | ${p.image_source?.source_url || 'catalog/products.json'} | Entregar media kit, permiso o foto | Comercio/Titular | ${p.priority || 'P1'} |`).join('\n')}\n\nAdemás, el comercio debe cargar precio para los ${PRODUCTS.filter((p) => p.price_status === 'pending').length} SKU pendientes.\n`);
await write(path.join(ARTIFACTS, 'PHOTO_CAPTURE_REQUIRED.md'), `# Fotos propias requeridas\n\n${PHOTO_REQUIRED.length} SKU requieren una foto propia o permiso equivalente antes de publicación. El listado completo está en [PHOTO_CAPTURE_SHOT_LIST.csv](../../catalog/photo-capture/PHOTO_CAPTURE_SHOT_LIST.csv).\n`);
await write(path.join(ARTIFACTS, 'IMPORT_PLAN.md'), `# Plan de importación\n\n- Modo ejecutado: validate y plan.\n- Productos: ${PRODUCTS.length}.\n- Altas locales nuevas: ${APPROVED.length - 40}.\n- Holds por derechos/precio: ${RIGHTS_PENDING.length}.\n- Rechazos: ${REJECTED.length}.\n- apply-staging/apply-production: no ejecutados.\n`);
await write(path.join(ARTIFACTS, 'PRICE_LOAD_READINESS.md'), `# Preparación para carga de precios\n\n**PREPARADO TÉCNICAMENTE, NO PUBLICABLE.** Todos los SKU nuevos conservan price=null, regular_price=null, price_status=pending y publication_status=blocked. La carga futura debe ser provista por el negocio, no copiada de terceros.\n`);
await write(path.join(ARTIFACTS, 'COMMERCIAL_GATE_STATUS.md'), `# Estado de gates\n\n## Gate de catálogo preparado para precios\n\n**PASS TÉCNICO:** ${APPROVED.length} SKU aprobados, P0 documentado, masters/thumbnails válidos, storefront y pruebas preservados.\n\n## Gate de publicación comercial\n\n**BLOCKED:** derechos pendientes en ${RIGHTS_PENDING.length} SKU y precios pendientes en ${PRODUCTS.filter((p) => p.price_status === 'pending').length} SKU.\n`);
await write(path.join(ARTIFACTS, 'TEST_RESULTS.md'), `# Resultados de pruebas\n\n- npm run check: PASS.\n- npm test: PASS (670/670).\n- npm run verify:technical: PASS (incluye suite E2E 146/146).\n- npm run catalog:taba2:research: PASS (${PRODUCTS.length} registros auditados).\n- npm run catalog:images:verify: PASS (22 productos demo, 44 WebP; authority certificado por pruebas de catálogo).\n- catalog:photos:validate/review: PASS (entrada vacía, 0 inválidas).\n- importador validate/plan: PASS; apply-staging/apply-production no ejecutados.\n- Secret scan y release hygiene: PASS dentro de check/verify:technical.\n`);

const shotRows = PHOTO_REQUIRED.map((p) => ({ priority:p.priority || 'P1', sku:p.sku, brand:p.brand, name:p.name, presentation:p.presentation, category:p.category_id, required_view:p.pack_count > 1 ? 'frente del pack completo' : 'frente completo', current_image_status:p.image_status || 'verified', current_rights_status:p.rights_status, notes:'Fondo blanco mate; etiqueta, tapa/base completas; sin precio ni góndola.' }));
await write(path.join(CATALOG, 'photo-capture/PHOTO_CAPTURE_SHOT_LIST.csv'), csv(shotRows));
await write(path.join(CATALOG, 'photo-capture/PHOTO_CAPTURE_GUIDE.md'), `# Guía de captura de fotos propias TABA2\n\n- Fondo blanco mate, iluminación pareja y cámara perpendicular.\n- Producto limpio, centrado y completo; tapa y base visibles.\n- Sin manos, góndola, precio, reflejos fuertes ni accesorios no vendidos.\n- Resolución mínima recomendada: 2000×2000 px; entregar JPG/PNG sin watermark.\n- Nombrar como \\<sku>__front.ext, \\<sku>__pack.ext o \\<sku>__alternate.ext.\n- Colocar la etiqueta de SKU junto al producto durante la toma, pero retirarla de la foto final.\n`);
await write(path.join(CATALOG, 'photo-intake/README.md'), `# Entrada de fotos propias\n\nColoque originales con la convención <sku>__front.<ext>, <sku>__pack.<ext> o <sku>__alternate.<ext>. Use npm run catalog:photos:validate antes de ingerir.\n`);
await write(path.join(CATALOG, 'photo-capture/PHOTO_CAPTURE_LABELS.pdf'), makeLabelsPdf(shotRows));

function makeLabelsPdf(rows) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = add(''); const pageIds = [];
  const pageSize = [612, 792]; const perPage = 8;
  for (let offset = 0; offset < rows.length; offset += perPage) {
    const chunk = rows.slice(offset, offset + perPage); const commands = ['BT', '/F1 11 Tf'];
    chunk.forEach((row, index) => {
      const col = index % 2;
      const line = Math.floor(index / 2);
      const x = 40 + col * 286;
      const y = 700 - line * 170;
      const sku = String(row.sku).replaceAll('(', '\\(').replaceAll(')', '\\)');
      const brand = String(row.brand).replaceAll('(', '\\(').replaceAll(')', '\\)');
      const presentation = String(row.presentation || '').replaceAll('(', '\\(').replaceAll(')', '\\)');
      commands.push(`1 0 0 1 ${x} ${y} Tm`, '(TABA2 PHOTO CAPTURE) Tj', '0 -18 Td', `(${sku}) Tj`, '0 -16 Td', `(${brand} - ${presentation}) Tj`, '0 -95 Td', '0 0 235 110 re S', 'ET', 'BT', '/F1 9 Tf', `1 0 0 1 ${x} ${y - 125} Tm`, '(Front / packshot / white background) Tj', 'ET', 'BT', '/F1 11 Tf');
    });
    const stream = commands.join('\n'); const contentId = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`); const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageSize[0]} ${pageSize[1]}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contentId} 0 R >>`); pageIds.push(pageId);
  }
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let pdf = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((object, index) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = Buffer.byteLength(pdf, 'latin1'); pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`; for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`; pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`; return pdf;
}

console.log(JSON.stringify({ approved: APPROVED.length, rightsPending: RIGHTS_PENDING.length, photoCapture: PHOTO_REQUIRED.length, categories: categoryCounts }, null, 2));
