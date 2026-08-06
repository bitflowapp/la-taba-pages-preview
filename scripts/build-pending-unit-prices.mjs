/*
 * Entrada administrativa para los nueve precios unitarios pendientes.
 *
 * Nueve unidades de venta de gaseosa y mixer entran a la góndola bloqueadas
 * porque el único precio confirmado es el del PACK. Dividir el pack por seis
 * sería inventar el precio de venta: el unitario incluye el margen minorista
 * que fija el local, y no es una división.
 *
 * Este script genera la planilla que el local completa, en el MISMO formato que
 * `npm run catalog:import` ya sabe importar, para que completar los nueve
 * valores no requiera tocar código. Todo lo que el catálogo ya verificó
 * —identidad, marca, capacidad, envase, rubro— viene lleno; `price`, `stock` e
 * `image_path` quedan vacíos porque son lo único que sólo el local puede
 * aportar.
 *
 * La foto va en la lista por una razón medida: el importador la exige, y la del
 * pack muestra seis botellas, así que no puede hacer de unidad. Sin decirlo
 * acá, el operador completa los nueve precios y descubre el bloqueo recién al
 * importar.
 *
 * Se genera y no se escribe a mano por la misma razón que `catalog-pending.csv`:
 * una planilla escrita a mano envejece, y el día que un precio se confirma la
 * fila sigue pidiendo un dato que ya existe. Un test falla si el archivo
 * committeado se desvía del generador.
 *
 *   node scripts/build-pending-unit-prices.mjs            # genera
 *   node scripts/build-pending-unit-prices.mjs --check    # verifica que no envejeció
 *   node scripts/build-pending-unit-prices.mjs --verify <archivo>   # valida lo cargado
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { products as runtimeCatalog } from '../js/approved-beverage-demo-data.js';
import { applyRetailCatalogModel } from '../js/core/catalog-store.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHEET = path.join(ROOT, 'catalog/pending-unit-prices.csv');
const REFERENCE = path.join(ROOT, 'catalog/pending-unit-prices.reference.csv');

// Columnas exactas de `data/catalog-template.csv`: la planilla ES un import
// válido en cuanto el local completa precio y stock.
const SHEET_COLUMNS = [
  'external_id', 'sku', 'brand', 'name', 'variant', 'category', 'subcategory',
  'capacity_value', 'capacity_unit', 'package_type', 'units_per_pack', 'price',
  'stock', 'available', 'alcoholic', 'minimum_age', 'chilled', 'featured',
  'sort_order', 'image_path', 'tags',
];

const REFERENCE_COLUMNS = [
  'sku', 'name', 'presentation', 'pack_sku', 'pack_price', 'units_per_pack',
  'division_del_pack_NO_USAR', 'motivo',
];

/*
 * La taxonomía de VISUALIZACIÓN y la de IMPORTACIÓN no coinciden: la góndola
 * publica `mixers`, y el vocabulario del importador —que es el contrato con el
 * catálogo productivo— no tiene esa categoría. Traducir acá, explícito y a la
 * vista, es preferible a emitir una planilla que el importador va a rechazar
 * con "categoría inexistente" sin decir por qué.
 *
 * Schweppes Tónica y Citrus son gaseosas en el vocabulario de importación; la
 * distinción de mixer se conserva en la subcategoría de cada SKU.
 */
const IMPORT_CATEGORY = Object.freeze({
  gaseosas: 'Gaseosas',
  mixers: 'Gaseosas',
  aguas: 'Aguas',
  'aguas-saborizadas': 'Aguas',
  jugos: 'Jugos',
  energizantes: 'Energéticas',
  isotonicas: 'Isotónicas',
  cervezas: 'Cervezas',
  vinos: 'Vinos y espumantes',
  'espumantes-y-sidras': 'Vinos y espumantes',
  destilados: 'Whisky y destilados',
  aperitivos: 'Whisky y destilados',
  'fernet-y-amargos': 'Whisky y destilados',
  hielo: 'Hielo y extras',
});

function importCategory(categoryId) {
  const name = IMPORT_CATEGORY[String(categoryId || '')];
  if (!name) {
    throw new Error(
      `El rubro "${categoryId}" no tiene equivalente en el vocabulario del importador. `
      + 'Agregalo a IMPORT_CATEGORY antes de generar la planilla: una categoría vacía '
      + 'hace fallar el import con "categoría inexistente" y no dice por qué.',
    );
  }
  return name;
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(columns, rows) {
  return [columns.join(','), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(','))]
    .join('\n')
    .concat('\n');
}

export function collectPendingUnits(catalog = runtimeCatalog) {
  const modelled = applyRetailCatalogModel(catalog);
  const byId = new Map(modelled.map((product) => [product.id, product]));

  return modelled
    .filter((product) => product.retailUnitDerivedFrom && product.pricePending)
    .map((unit) => {
      const pack = byId.get(unit.retailUnitDerivedFrom) || {};
      const unitsPerPack = Number(pack.unitsPerPack || unit.purchasePack?.unitsPerPurchasePack || 0) || 0;
      return { unit, pack, unitsPerPack };
    })
    .sort((a, b) => a.unit.id.localeCompare(b.unit.id));
}

function sheetRow({ unit, pack, unitsPerPack }) {
  return {
    external_id: unit.id,
    sku: unit.sku || unit.id,
    brand: unit.brand || '',
    name: unit.name || '',
    variant: unit.variant || '',
    category: importCategory(unit.categoryId || pack.categoryId),
    subcategory: unit.subcategory || '',
    capacity_value: unit.capacityValue ?? '',
    capacity_unit: unit.capacityUnit || '',
    package_type: unit.packageType || '',
    units_per_pack: 1,
    // Lo único que el local tiene que completar. Vacío a propósito: el
    // importador falla con precio vacío, así que no hay forma de publicar sin
    // el dato.
    price: '',
    stock: '',
    available: 'true',
    alcoholic: unit.alcoholic ? 'true' : 'false',
    minimum_age: unit.minimumAge ?? '',
    chilled: unit.chilled ? 'true' : 'false',
    featured: 'false',
    sort_order: 0,
    image_path: '',
    tags: (Array.isArray(unit.tags) ? unit.tags : []).join('|'),
    // Evidencia para la planilla de referencia.
    _presentation: unit.presentation || '',
    _packSku: pack.sku || pack.id || '',
    _packPrice: pack.price ?? '',
    _unitsPerPack: unitsPerPack,
  };
}

function referenceRow(row) {
  const packPrice = Number(row._packPrice);
  const units = Number(row._unitsPerPack);
  const division = Number.isFinite(packPrice) && units > 0 ? Math.round(packPrice / units) : '';
  return {
    sku: row.sku,
    name: row.name,
    presentation: row._presentation,
    pack_sku: row._packSku,
    pack_price: row._packPrice,
    units_per_pack: units,
    division_del_pack_NO_USAR: division,
    motivo: 'El precio unitario incluye el margen minorista que fija el local; no es el pack dividido.',
  };
}

export function buildSheets(catalog = runtimeCatalog) {
  const rows = collectPendingUnits(catalog).map(sheetRow);
  return {
    sheet: csv(SHEET_COLUMNS, rows),
    reference: csv(REFERENCE_COLUMNS, rows.map(referenceRow)),
    rows,
  };
}

/**
 * Valida una planilla completada.
 *
 * Fail-closed en las dos direcciones que importan: sin precio no se publica, y
 * un precio que es EXACTAMENTE el pack dividido se rechaza salvo que alguien lo
 * confirme explícitamente. La segunda regla no es cosmética: es el único error
 * que se ve razonable y publica un precio que el local nunca fijó.
 */
export function verifySheet(text, referenceText) {
  const parse = (raw) => {
    const lines = String(raw).trim().split(/\r?\n/);
    const columns = lines[0].split(',');
    return lines.slice(1).filter(Boolean).map((line) => {
      const cells = splitCsvLine(line);
      return Object.fromEntries(columns.map((column, index) => [column, cells[index] ?? '']));
    });
  };
  const reference = new Map(parse(referenceText).map((row) => [row.sku, row]));
  const problems = [];
  const ready = [];

  for (const row of parse(text)) {
    const sku = row.sku;
    const price = Number(row.price);
    const stock = Number(row.stock);
    const evidence = reference.get(sku);

    if (!evidence) {
      problems.push(`${sku}: no está en la lista de unidades bloqueadas; esta planilla es sólo para esas nueve.`);
      continue;
    }
    if (!row.price.trim()) {
      problems.push(`${sku}: falta el precio unitario confirmado por el local.`);
      continue;
    }
    if (!Number.isInteger(price) || price <= 0) {
      problems.push(`${sku}: el precio tiene que ser un entero de pesos mayor que cero.`);
      continue;
    }
    if (!row.stock.trim() || !Number.isInteger(stock) || stock < 0) {
      problems.push(`${sku}: falta el stock en unidades (entero, puede ser 0).`);
      continue;
    }
    // La foto del pack muestra seis botellas y no puede hacer de unidad: es
    // mostrar una cosa y entregar otra. El importador la exige igual; avisarlo
    // acá evita que el operador descubra el bloqueo recién al importar.
    if (!row.image_path.trim()) {
      problems.push(`${sku}: falta la foto de la UNIDAD; la del pack muestra el pack y no sirve.`);
      continue;
    }
    const division = Number(evidence.division_del_pack_NO_USAR);
    if (Number.isFinite(division) && division > 0 && price === division) {
      problems.push(
        `${sku}: $${price} es exactamente el pack dividido por ${evidence.units_per_pack}. `
        + 'El unitario incluye el margen minorista y no es una división. '
        + 'Si el local confirmó ese número igual, cargalo con --permitir-coincidencia.',
      );
      continue;
    }
    ready.push({ sku, price, stock });
  }

  return { ok: problems.length === 0, problems, ready };
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"' && line[index + 1] === '"') { current += '"'; index += 1; } else if (character === '"') { quoted = false; } else { current += character; }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      cells.push(current); current = '';
    } else {
      current += character;
    }
  }
  cells.push(current);
  return cells;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invokedDirectly) {
  const { sheet, reference, rows } = buildSheets();
  const verifyIndex = process.argv.indexOf('--verify');

  if (verifyIndex >= 0) {
    const target = process.argv[verifyIndex + 1];
    if (!target) {
      console.error('Indicá el archivo a validar: --verify <archivo>');
      process.exit(2);
    }
    const filled = await fs.readFile(path.resolve(target), 'utf8');
    const allowMatch = process.argv.includes('--permitir-coincidencia');
    const result = verifySheet(filled, reference);
    const problems = allowMatch
      ? result.problems.filter((problem) => !problem.includes('exactamente el pack dividido'))
      : result.problems;
    for (const problem of problems) console.error(`ERROR ${problem}`);
    for (const row of result.ready) console.log(`OK    ${row.sku} — $${row.price} · stock ${row.stock}`);
    if (problems.length) {
      console.error(`\n${problems.length} fila(s) sin cargar. Nada se publica hasta que estén las nueve.`);
      process.exit(1);
    }
    console.log(`\n${result.ready.length}/${rows.length} unidades listas para importar con:`);
    console.log(`  npm run catalog:import -- ${target} --business-id <BUSINESS_ID> --apply`);
    process.exit(0);
  }

  if (process.argv.includes('--check')) {
    const [currentSheet, currentReference] = await Promise.all([
      fs.readFile(SHEET, 'utf8').catch(() => ''),
      fs.readFile(REFERENCE, 'utf8').catch(() => ''),
    ]);
    if (currentSheet !== sheet || currentReference !== reference) {
      console.error('La planilla de precios pendientes se desvió del catálogo. Regenerala:');
      console.error('  npm run catalog:prices:pending');
      process.exit(1);
    }
    console.log(`Planilla al día: ${rows.length} unidades bloqueadas por precio unitario.`);
    process.exit(0);
  }

  await fs.writeFile(SHEET, sheet, 'utf8');
  await fs.writeFile(REFERENCE, reference, 'utf8');
  console.log(`${rows.length} unidades bloqueadas escritas en:`);
  console.log(`  ${path.relative(ROOT, SHEET)}       ← la completa el local (precio y stock)`);
  console.log(`  ${path.relative(ROOT, REFERENCE)}  ← evidencia: precio del pack y por qué no se divide`);
}
