/*
 * Genera catalog/catalog-pending.csv: todo lo que la góndola comercial de TABA2
 * NO puede publicar hoy, con el motivo exacto y el campo que lo bloquea.
 *
 * Se genera y no se escribe a mano porque un pendiente escrito a mano envejece:
 * el día que el negocio confirma un precio, la fila queda afirmando un bloqueo
 * que ya no existe. Acá el motivo sale del mismo registro que lo bloquea, así
 * que el archivo no puede desviarse del catálogo.
 *
 * Uso: node scripts/build-catalog-pending.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { COMBO_MANIFEST } from '../js/combos-data.js';
import { products as runtimeCatalog } from '../js/approved-beverage-demo-data.js';
import { applyRetailCatalogModel, getCustomerCatalogProducts } from '../js/core/catalog-store.js';
import { resolveCombos } from '../js/core/combos.js';
// La normalización minorista es la que decide qué llega a la góndola: marca
// como `procurementOnly` el pack con el que el local se surte y publica en su
// lugar la unidad de venta. Sin aplicarla, este reporte vería packs comprables
// que el cliente nunca ve, y declararía publicable lo que no lo es.

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'catalog/catalog-pending.csv');

const COLUMNS = [
  'sku',
  'gondola',
  'brand',
  'name',
  'presentation',
  'blocked_field',
  'blocking_reason',
  'evidence',
  'next_action',
];

// Góndola comercial pedida. `sku_relevados` es cuántos SKU tiene hoy el rubro
// en catalog/products.json, publicables o no.
const SHELF_PLAN = [
  ['gaseosas', 'Gaseosas'],
  ['aguas', 'Aguas'],
  ['aguas-saborizadas', 'Aguas saborizadas'],
  ['isotonicas', 'Isotónicas'],
  ['energizantes', 'Energizantes'],
  ['mixers', 'Mixers'],
  ['cervezas', 'Cervezas'],
  ['fernet', 'Fernet y amargos'],
  ['aperitivos', 'Aperitivos'],
  ['vinos', 'Vinos'],
  ['espumantes', 'Espumantes y sidras'],
  ['destilados', 'Destilados'],
  ['hielo', 'Hielo'],
  ['snacks', 'Snacks'],
  ['golosinas', 'Golosinas'],
];

const catalog = JSON.parse(await fs.readFile(path.join(ROOT, 'catalog/products.json'), 'utf8'));
const customerCatalog = getCustomerCatalogProducts(applyRetailCatalogModel(runtimeCatalog));
const purchasable = new Set(
  customerCatalog
    .filter((product) => product.available && !product.pricePending && Number(product.price) > 0 && Number(product.stock) > 0)
    .map((product) => product.id),
);
const inCustomerCatalog = new Set(customerCatalog.map((product) => product.id));
const shelfName = new Map(SHELF_PLAN);
const rows = [];

// ── 1. SKU relevados que no se pueden publicar ───────────────────────────────
for (const product of catalog) {
  if (purchasable.has(product.sku)) continue;

  const blocked = [];
  if (product.catalog_status === 'rejected') blocked.push('catalog_status');
  if (product.price_status !== 'confirmed') blocked.push('price');
  if (product.image_rights_status && product.image_rights_status !== 'approved') blocked.push('image_rights_status');
  if (!inCustomerCatalog.has(product.sku)) blocked.push('publication_status');

  // El motivo se evalúa del bloqueo más DURO al más blando, y cada rama dice
  // por qué queda afuera ese SKU en particular. La ausencia del catálogo del
  // cliente sola no alcanza para llamarlo "pack de abastecimiento": un SKU
  // rechazado en la revisión visual también está ausente, y etiquetarlo como
  // pack mandaría a Operaciones a resolver un problema que no tiene.
  const esPack = Number(product.pack_count) > 1;
  const [reason, next] = product.catalog_status === 'rejected'
    ? [
      product.notes || 'Rechazado en la revisión de catálogo.',
      'Conseguir un packshot frontal verificable o dar de baja el SKU.',
    ]
    : /No aprobado|revisión visual/i.test(product.notes || '')
      ? [
        product.notes,
        'Conseguir un packshot frontal verificable de la presentación declarada.',
      ]
      : esPack && !inCustomerCatalog.has(product.sku)
        ? [
          'Pack de abastecimiento: la góndola publica unidades de venta minorista, así que este registro no llega al cliente ni se puede pedir. Existe para el abastecimiento del local.',
          'Publicar la unidad minorista equivalente, o dejarlo sólo como registro de compra.',
        ]
        : product.price_status !== 'confirmed'
          ? [
            'Precio no confirmado por el negocio. Identidad e imagen verificadas; el registro entra a la góndola como "Precio próximamente" y no es comprable.',
            'El negocio confirma precio y stock; recién ahí publicable=true.',
          ]
          : [
            'Derechos de uso comercial de la imagen pendientes de revisión: la fuente es un retailer y no concede licencia de publicación.',
            'Obtener licencia de uso comercial de la imagen o reemplazar el packshot.',
          ];

  rows.push({
    sku: product.sku,
    gondola: shelfName.get(product.category_id) || product.category_id,
    brand: product.brand,
    name: product.name,
    presentation: product.presentation,
    blocked_field: blocked.join('+') || 'publication_status',
    blocking_reason: reason,
    evidence: product.image_source?.source_url || product.notes || '',
    next_action: next,
  });
}

// ── 1b. Unidades minoristas derivadas de un pack, sin precio unitario ────────
// Estas NO están en catalog/products.json: las publica la normalización
// minorista a partir del pack de abastecimiento. Se listan aparte porque su
// bloqueo es distinto del resto y es hoy el más caro del negocio: el precio
// del pack SÍ está confirmado, pero dividirlo por la cantidad sería inventar
// el precio de venta unitario, que incluye el margen que fija el local.
const normalizedCatalog = applyRetailCatalogModel(runtimeCatalog);
const packById = new Map(runtimeCatalog.map((product) => [product.id, product]));
for (const product of customerCatalog) {
  if (packById.has(product.id)) continue;
  if (purchasable.has(product.id)) continue;
  // El vínculo pack → unidad lo escribe la normalización, así que se busca en
  // el catálogo NORMALIZADO: el crudo todavía no tiene `retailUnitId`.
  const pack = normalizedCatalog.find((candidate) => candidate.retailUnitId === product.id);
  rows.push({
    sku: product.id,
    gondola: shelfName.get(product.categoryId) || product.categoryId,
    brand: product.brand,
    name: product.name,
    presentation: product.presentation,
    blocked_field: 'price+stock',
    blocking_reason: pack
      ? `Unidad de venta derivada del pack de abastecimiento ${pack.id} (${pack.unitLabel}, precio de pack confirmado). El precio UNITARIO no se puede derivar dividiendo el pack: incluye el margen minorista que fija el local, así que queda pendiente en vez de inventarse.`
      : 'Unidad de venta derivada de un pack de abastecimiento. El precio unitario lo tiene que confirmar el negocio.',
    evidence: 'js/core/retail-packaging.js — publishRetailUnits',
    next_action: 'El negocio confirma precio unitario y stock en unidades; recién ahí publicable=true.',
  });
}

// ── 2. Rubros de la góndola sin ningún SKU relevado ──────────────────────────
for (const [id, name] of SHELF_PLAN) {
  if (catalog.some((product) => product.category_id === id)) continue;
  rows.push({
    sku: `(rubro) ${id}`,
    gondola: name,
    brand: '',
    name: `Rubro ${name} sin relevar`,
    presentation: '',
    blocked_field: 'identity+price+image',
    blocking_reason: `El rubro ${name} está declarado en la taxonomía comercial y no tiene ningún producto relevado: no hay identidad, precio, imagen ni código de barras confirmados para ningún SKU. No se inventó ninguno.`,
    evidence: 'scripts/taba2-catalog-authority.mjs — el rubro no tiene semillas.',
    next_action: 'Relevar SKU con ficha de cadena comercial verificable y confirmar precio con el negocio.',
  });
}

// ── 3. Combos que no se pueden armar ─────────────────────────────────────────
for (const combo of resolveCombos(COMBO_MANIFEST, customerCatalog)) {
  if (combo.available) continue;
  rows.push({
    sku: combo.comboId,
    gondola: shelfName.get(combo.categoryId) || combo.categoryId,
    brand: '',
    name: combo.name,
    presentation: 'Combo',
    blocked_field: 'components',
    blocking_reason: combo.blockers.join(' '),
    evidence: 'data/combos.csv',
    next_action: 'Publicar los componentes faltantes como unidad de venta o rediseñar el combo.',
  });
}

// ── 4. Combos diseñados que quedaron fuera del manifiesto ────────────────────
// Se registran acá y no en el manifiesto porque el manifiesto sólo contiene
// combos que se pueden armar enteros: un combo bloqueado adentro sería una
// promesa que la góndola nunca podría cumplir.
for (const descartado of [
  {
    sku: 'combo-mesa-familiar',
    gondola: 'Gaseosas',
    name: 'Mesa familiar (Coca 1,5 L x6 + Sprite 1,5 L x6)',
    reason: 'Los packs de gaseosa de 1,5 L existen en el catálogo como pack de abastecimiento y no están publicados como unidad de venta minorista, así que el combo no tiene componentes comprables en la góndola.',
  },
  {
    sku: 'combo-kit-de-tragos',
    gondola: 'Mixers',
    name: 'Kit de tragos (Schweppes Tónica x6 + Citrus x6)',
    reason: 'Mismo bloqueo que Mesa familiar: los packs de mixer de 1,5 L no están publicados como unidad de venta minorista.',
  },
  {
    sku: 'combo-fernet-y-coca',
    gondola: 'Fernet y amargos',
    name: 'Fernet y Coca',
    reason: 'Ningún fernet tiene precio confirmado: Fernet Branca, Brancamenta y Buhero Negro están en la góndola como "Precio próximamente". Sin precio de componente no hay precio individual que tachar ni ahorro que anunciar.',
  },
  {
    sku: 'combo-gin-tonic',
    gondola: 'Destilados',
    name: 'Gin tonic para dos',
    reason: 'Ningún gin tiene precio confirmado y el mixer de tónica no está publicado como unidad minorista: faltan los dos lados del combo.',
  },
]) {
  rows.push({
    sku: descartado.sku,
    gondola: descartado.gondola,
    brand: '',
    name: descartado.name,
    presentation: 'Combo diseñado, no publicado',
    blocked_field: 'components',
    blocking_reason: descartado.reason,
    evidence: 'Diseño comercial de esta entrega.',
    next_action: 'Confirmar precio de los componentes o publicarlos como unidad de venta; después re-evaluar el combo.',
  });
}

const escape = (value) => `"${String(value ?? '').replace(/"/g, '""').replace(/\s+/g, ' ').trim()}"`;
const csv = [COLUMNS.join(','), ...rows.map((row) => COLUMNS.map((column) => escape(row[column])).join(','))].join('\n');
await fs.writeFile(OUT, `${csv}\n`);

console.log(`catalog/catalog-pending.csv: ${rows.length} pendientes.`);
console.log(`Publicables hoy: ${purchasable.size} SKU con precio y stock confirmados.`);
