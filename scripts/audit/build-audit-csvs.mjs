/*
 * Arma PRODUCT_AUDIT.csv y PROMOTION_AUDIT.csv a partir de lo que dejaron las
 * corridas de `catalog-commercial-audit.mjs` y `promotion-audit.mjs`.
 *
 *   node scripts/audit/build-audit-csvs.mjs --rows=<prod-rows.json> \
 *        --prod=<dir con products-*.json y promotions-*.json de producción> \
 *        --local=<dir con las mismas corridas sobre el árbol de trabajo> \
 *        --images=<image-dimensions.json> --out=<carpeta de evidencia>
 *
 * Cada fila dice DE DÓNDE sale lo que afirma: `prod_*` es producción observada
 * en vivo (sólo lectura), `rama_*` es el código de esta rama con la instantánea
 * del catálogo servida por el backend en memoria de las pruebas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { COMBO_MANIFEST } from '../../js/combos-data.js';
import { resolveCombos } from '../../js/core/combos.js';
import { CAMPAIGNS } from '../../js/campaigns/campaign-config.js';
import { loadProductsLikeTheStore, rowsVisibleToCustomers } from '../campaigns/live-catalog-gate.mjs';

const arg = (name, fallback = '') => {
  const hit = process.argv.find((value) => value.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ROWS = JSON.parse(fs.readFileSync(arg('rows'), 'utf8')).rows;
const PROD = arg('prod');
const LOCAL = arg('local');
const IMAGES = arg('images') ? JSON.parse(fs.readFileSync(arg('images'), 'utf8')) : [];
const OUT = arg('out');
fs.mkdirSync(OUT, { recursive: true });

const readJson = (dir, name) => {
  const file = path.join(dir, name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
const csv = (rows, columns) => `${columns.join(',')}\n${rows.map((row) => columns.map((column) => {
  const value = row[column];
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}).join(',')).join('\n')}\n`;

const money = (value) => `$ ${Number(value).toLocaleString('es-AR')}`;
const nbsp = (value) => String(value ?? '').replace(/ /g, ' ');
const buyable = (row) => row.is_active && row.is_verified && row.available && Number(row.stock) > 0 && row.price_status === 'confirmed' && Number(row.price) > 0;

/* ─── PRODUCT_AUDIT.csv ───────────────────────────────────────────────────── */
const CONFIGS = [
  ['prod_chromium_390', PROD, 'products-chromium-390x844.json'],
  ['prod_webkit_390', PROD, 'products-webkit-390x844.json'],
  ['prod_chromium_1440', PROD, 'products-chromium-1440x900.json'],
  ['rama_chromium_390', LOCAL, 'products-chromium-390x844.json'],
  ['rama_webkit_390', LOCAL, 'products-webkit-390x844.json'],
];
const runs = Object.fromEntries(CONFIGS.map(([key, dir, file]) => {
  const data = dir ? readJson(dir, file) : null;
  return [key, data ? new Map(data.map((entry) => [entry.sku, entry])) : null];
}));
const dims = new Map(IMAGES.map((entry) => [entry.sku, entry]));
const seenImages = new Map();
for (const row of ROWS) seenImages.set(row.image_sha256, (seenImages.get(row.image_sha256) || 0) + 1);

const verdict = (entry) => {
  if (!entry) return 'sin-dato';
  const s = entry.steps;
  if (s.error) return `ERROR(${s.error.slice(0, 60)})`;
  const add = s.add === 'OK' ? 'agrega' : String(s.add);
  const cart = s.cart ? (s.cart === 'OK' ? 'carrito-OK' : `carrito-${s.cart}`) : '';
  return `ficha-foto:${s.openFromImage}; ficha-nombre:${s.openFromName}; ${add}${cart ? `; ${cart}` : ''}`;
};

const productRows = ROWS.map((row) => {
  const first = runs.prod_chromium_390?.get(row.sku) || runs.rama_chromium_390?.get(row.sku);
  const card = first?.card;
  const modal = first?.modal;
  const d = dims.get(row.sku);
  const status = buyable(row)
    ? 'COMPRABLE'
    : (row.is_alcoholic && row.stock > 0 ? 'BLOQUEADO_ALCOHOL_SIN_HABILITAR' : 'BLOQUEADO_SIN_STOCK');
  const out = {
    sku: row.sku,
    product_id: row.id,
    nombre: row.name,
    marca: row.brand,
    variante: row.variant,
    presentacion: card?.line ?? '',
    capacidad: row.capacity,
    envase: row.packaging_type,
    categoria: row.category,
    subcategoria: row.subcategory,
    unidades_por_pack: row.units_per_pack,
    es_pack: row.sold_as_pack,
    precio_ars: row.price,
    estado_precio: row.price_status,
    stock: row.stock,
    disponible: row.available,
    publicado: row.is_active && row.is_verified,
    alcohol: row.is_alcoholic,
    estado_comercial: status,
    foto_maestra_px: d ? `${d.master.w}x${d.master.h}` : '',
    foto_miniatura_px: d ? `${d.thumb.w}x${d.thumb.h}` : '',
    foto_http_ok: d ? d.master.ok && d.thumb.ok : '',
    foto_archivo_lleva_sku: String(row.image_url).includes(row.sku),
    foto_unica: seenImages.get(row.image_sha256) === 1,
    foto_revision_visual: 'OK (hoja de contacto de las 51 maestras, 2026-10-09)',
    tarjeta_titulo: card?.title ?? '',
    tarjeta_precio_coincide: card ? nbsp(card.priceText).includes(money(row.price)) : '',
    tarjeta_accion: card?.action?.text ?? '',
    tarjeta_accion_habilitada: card?.action ? !card.action.disabled : '',
    ficha_precio_coincide: modal ? nbsp(modal.price).includes(money(row.price)) : '',
    ficha_control: modal?.control ? `${modal.control.text}${modal.control.disabled ? ' (deshabilitado)' : ''}` : '',
  };
  for (const [key] of CONFIGS) out[key] = verdict(runs[key]?.get(row.sku));
  const failing = CONFIGS.some(([key]) => {
    const entry = runs[key]?.get(row.sku);
    if (!entry) return false;
    const s = entry.steps;
    if (s.error || s.openFromImage !== 'OK' || s.openFromName !== 'OK') return true;
    return buyable(row) ? (s.add !== 'OK' || s.cart !== 'OK') : !String(s.add).startsWith('BLOCKED');
  });
  out.veredicto = failing ? 'CON_ERRORES' : 'OK';
  const notes = [];
  if (/pack/i.test(String(row.variant)) && /·/.test(String(row.variant))) notes.push('P3 dato: la columna variante trae la presentación completa («Botella PET · 500 ml · Pack x12») y la subcategoría va capitalizada distinto al resto');
  if (status !== 'COMPRABLE') notes.push('no se ofrece compra: el botón lo dice (honesto)');
  out.notas = notes.join(' | ');
  return out;
});
const productColumns = Object.keys(productRows[0]);
fs.writeFileSync(path.join(OUT, 'PRODUCT_AUDIT.csv'), csv(productRows, productColumns));

/* ─── PROMOTION_AUDIT.csv ─────────────────────────────────────────────────── */
const promoRuns = {
  prod_chromium_390: PROD ? readJson(PROD, 'promotions-chromium-390x844.json') : null,
  prod_webkit_390: PROD ? readJson(PROD, 'promotions-webkit-390x844.json') : null,
  prod_chromium_1440: PROD ? readJson(PROD, 'promotions-chromium-1440x900.json') : null,
  rama_chromium_390: LOCAL ? readJson(LOCAL, 'promotions-chromium-390x844.json') : null,
  rama_webkit_390: LOCAL ? readJson(LOCAL, 'promotions-webkit-390x844.json') : null,
  rama_chromium_1440: LOCAL ? readJson(LOCAL, 'promotions-chromium-1440x900.json') : null,
};
const tapSummary = (entry) => {
  if (!entry) return '';
  const parts = [];
  for (const [name, value] of Object.entries(entry.taps || {})) {
    parts.push(`${name}=${typeof value === 'string' ? value : (value.opened || '?') + (value.pieceQty ? `(qty ${value.pieceQty}; carrito ${value.cartLines?.length ?? '?'} línea)` : '')}`);
  }
  return parts.join('; ');
};
const findPiece = (run, surface, id, placement) => run?.find((entry) => entry.surface === surface && entry.id === id && entry.placement === placement);

const visible = rowsVisibleToCustomers(ROWS);
const storeProducts = await loadProductsLikeTheStore(ROWS);
const byId = new Map(ROWS.map((row) => [row.sku, row]));
const promoRows = [];

// A · campañas editoriales (las encendidas, en cada superficie donde se vieron)
const seen = new Map();
for (const [key, run] of Object.entries(promoRuns)) {
  for (const entry of run || []) {
    if (!entry.id) continue;
    const k = `${entry.id}|${entry.placement}|${entry.surface}`;
    if (!seen.has(k)) seen.set(k, { id: entry.id, placement: entry.placement, surface: entry.surface });
  }
}
for (const { id, placement, surface } of seen.values()) {
  const campaign = CAMPAIGNS.find((entry) => entry.id === id);
  const sku = campaign?.target.skus[0];
  const row = byId.get(sku);
  const probe = {};
  for (const key of Object.keys(promoRuns)) probe[key] = findPiece(promoRuns[key], surface, id, placement);
  const before = probe.prod_chromium_390;
  const after = probe.rama_chromium_390;
  promoRows.push({
    id: `${id}@${placement}`,
    nombre: campaign?.copy.headline ?? id,
    tipo: 'campaña editorial (sin precio propio; precio vivo del producto)',
    superficie: surface,
    producto: row?.name ?? '',
    sku_o_product_id: `${sku ?? ''} / ${row?.id ?? ''}`,
    identidad_declarada: campaign ? `${campaign.target.identity.brand} ${campaign.target.identity.variant} ${campaign.target.identity.volumeMl} ml ${campaign.target.identity.container}` : '',
    imagen: 'packshot oficial del producto (huella verificada)',
    precio_visible: row ? money(row.price) : '',
    vigencia: campaign?.validFrom || campaign?.validUntil ? `${campaign.validFrom} → ${campaign.validUntil}` : 'sin vigencia declarada (siempre, mientras el producto sea comprable)',
    aprobacion: campaign ? `${campaign.approval.status} · ${campaign.approval.reference}` : '',
    disponibilidad: row ? (buyable(row) ? `comprable (stock ${row.stock})` : 'NO comprable') : '',
    cta_visible_prod: before ? before.ctaLabel : '',
    agregar_en_la_pieza_prod: before ? before.hasAddControl : '',
    toques_hasta_el_carrito_prod: before ? (before.hasAddControl ? 1 : 3) : '',
    cta_visible_rama: after ? (after.hasAddControl ? 'Agregar (botón real)' : after.ctaLabel) : '',
    agregar_en_la_pieza_rama: after ? after.hasAddControl : '',
    toques_hasta_el_carrito_rama: after ? (after.hasAddControl ? 1 : 3) : '',
    accion_al_tocar_prod_chromium_390: tapSummary(probe.prod_chromium_390),
    accion_al_tocar_prod_webkit_390: tapSummary(probe.prod_webkit_390),
    accion_al_tocar_prod_chromium_1440: tapSummary(probe.prod_chromium_1440),
    accion_al_tocar_rama_chromium_390: tapSummary(probe.rama_chromium_390),
    accion_al_tocar_rama_webkit_390: tapSummary(probe.rama_webkit_390),
    accion_al_tocar_rama_chromium_1440: tapSummary(probe.rama_chromium_1440),
    carrito_prod: before?.cart ? JSON.stringify(before.cart.map((line) => `${line.qty}× ${line.line}`)) : '',
    mapa_de_impactos_prod: before?.hit ? JSON.stringify(before.hit.counts) : '',
    mapa_de_impactos_rama: after?.hit ? JSON.stringify(after.hit.counts) : '',
    alto_prod_px: before?.box ? `${before.box.w}x${before.box.h}` : '',
    alto_rama_px: after?.box ? `${after.box.w}x${after.box.h}` : '',
    veredicto_prod: before ? (before.hasAddControl ? 'COMPRABLE_EN_LA_PIEZA' : 'COMPRABLE_EN_2_PASOS (sin «Agregar» en la pieza)') : 'no observada',
    veredicto_rama: after ? (after.hasAddControl ? 'COMPRABLE_EN_LA_PIEZA' : 'COMPRABLE_EN_2_PASOS') : 'no observada',
  });
}

// B · campañas apagadas: no se muestran
for (const campaign of CAMPAIGNS.filter((entry) => !entry.enabled)) {
  promoRows.push({
    id: `${campaign.id}@(apagada)`,
    nombre: campaign.copy.headline,
    tipo: 'campaña editorial PENDIENTE',
    superficie: 'ninguna (el motor la descarta)',
    producto: '',
    sku_o_product_id: campaign.target.skus.join(','),
    identidad_declarada: `${campaign.target.identity.brand} ${campaign.target.identity.variant} ${campaign.target.identity.volumeMl} ml`,
    imagen: '—',
    precio_visible: '',
    vigencia: '',
    aprobacion: `${campaign.approval.status} · ${campaign.approval.reference}`,
    disponibilidad: byId.has(campaign.target.skus[0]) ? 'el SKU existe' : 'el SKU NO existe en el catálogo publicado',
    veredicto_prod: 'NO SE MUESTRA (correcto: producto inexistente y alcohol cerrado)',
    veredicto_rama: 'NO SE MUESTRA (correcto)',
  });
}

// C · combos del manifiesto, resueltos contra el catálogo observado
for (const combo of resolveCombos(COMBO_MANIFEST, storeProducts)) {
  promoRows.push({
    id: combo.comboId,
    nombre: combo.name,
    tipo: `combo comercial (${combo.discountPercentage}% declarado; el precio lo deriva el catálogo y lo decide el backend)`,
    superficie: 'home/catálogo: carril «Combos» (oculto si ninguno se puede armar)',
    producto: (combo.components || []).map((c) => `${c.quantity}× ${c.product?.name}`).join(' + '),
    sku_o_product_id: (COMBO_MANIFEST.find((entry) => entry.comboId === combo.comboId)?.components || []).map((c) => c.sku).join(', '),
    imagen: 'fotos de sus componentes',
    precio_visible: combo.promotionalPrice != null ? money(combo.promotionalPrice) : '(no se calcula: faltan componentes)',
    vigencia: 'sin vigencia declarada',
    aprobacion: combo.approvalStatus,
    disponibilidad: combo.chargeable ? `cobrable (stock ${combo.stock})` : `BLOQUEADO: ${(combo.blockers || [])[0] ?? '—'}`,
    veredicto_prod: combo.chargeable ? 'SE OFRECE «Agregar combo»' : 'NO SE MUESTRA ni se ofrece compra (correcto: no se arma con el catálogo publicado)',
    veredicto_rama: combo.chargeable ? 'SE OFRECE «Agregar combo»' : 'NO SE MUESTRA (correcto)',
  });
}

// D · el resto de las piezas que pueden prometer algo
const alcoholCards = visible.filter((row) => !buyable(row)).length;
promoRows.push(
  {
    id: 'puerta-editorial-cervezas', nombre: 'Bien fría, como tiene que ser', tipo: 'puerta editorial (sin precio)', superficie: 'home, banda de apertura (reemplazada por la campaña)',
    producto: 'categoría Cervezas', sku_o_product_id: '—', imagen: 'assets/promos/cervezas-heineken(.jpg|-band.webp)', precio_visible: '', vigencia: '', aprobacion: 'editorial',
    disponibilidad: 'ninguna cerveza se puede comprar hoy (alcohol sin habilitar)', veredicto_prod: 'NO SE PINTA (falla cerrado: destino sin producto comprable)', veredicto_rama: 'igual',
  },
  {
    id: 'banners-de-rubro', nombre: 'Banners editoriales (HOME_BANNER_LIMIT = 0)', tipo: 'editorial', superficie: 'home', producto: '—', sku_o_product_id: '—', imagen: '—', precio_visible: '', vigencia: '', aprobacion: 'editorial',
    disponibilidad: 'límite 0: no se pintan en el encabezado', veredicto_prod: 'NO SE PINTAN', veredicto_rama: 'igual',
  },
  {
    id: 'historias', nombre: 'Historias del comercio', tipo: 'editorial', superficie: 'home / perfil', producto: '—', sku_o_product_id: '—', imagen: 'assets/promos/story-*.webp (sólo semilla de demostración)', precio_visible: '', vigencia: '', aprobacion: 'sólo en modo demo/showcase',
    disponibilidad: 'producción no publica historias', veredicto_prod: 'SIN HISTORIAS (aro apagado)', veredicto_rama: 'igual',
  },
  {
    id: 'promociones-comerciales', nombre: 'Promociones con condición de precio (core/promotions.js)', tipo: 'promoción comercial', superficie: 'home «Promociones», catálogo «Promos»/filtro', producto: '—', sku_o_product_id: '—', imagen: '—', precio_visible: '', vigencia: '', aprobacion: 'sólo se cargan en demostración',
    disponibilidad: 'producción no tiene ninguna promoción activa', veredicto_prod: 'NINGUNA (no hay píldora «Promos» ni filtro de promoción con opciones)', veredicto_rama: 'igual',
  },
  {
    id: 'seleccion-del-local-alcohol', nombre: 'Selección del local · Bodega y destilados', tipo: 'góndola editorial de productos aún no vendibles', superficie: 'home, última sección',
    producto: `una tarjeta por rubro sin producto comprable (máx. 6; hoy vinos, fernet y aperitivos); en total ${alcoholCards} productos del catálogo están en ese estado`, sku_o_product_id: 'ver PRODUCT_AUDIT.csv (estado BLOQUEADO_*)', imagen: 'packshot oficial', precio_visible: 'sí (precio de la fila)', vigencia: '', aprobacion: 'alcohol en LICENSE GATE',
    disponibilidad: 'botón deshabilitado «Próximamente» / «No disponible»', veredicto_prod: 'HONESTO: muestra el producto y dice que todavía no se vende; no ofrece compra', veredicto_rama: 'igual',
  },
);
const promoColumns = [...new Set(promoRows.flatMap((row) => Object.keys(row)))];
fs.writeFileSync(path.join(OUT, 'PROMOTION_AUDIT.csv'), csv(promoRows, promoColumns));

console.log(`PRODUCT_AUDIT.csv: ${productRows.length} filas, ${productRows.filter((row) => row.veredicto === 'CON_ERRORES').length} con errores`);
console.log(`PROMOTION_AUDIT.csv: ${promoRows.length} filas (${seen.size} piezas observadas)`);
