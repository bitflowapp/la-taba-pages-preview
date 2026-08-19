/*
 * Descubrimiento, procedencia y derechos de las fotos del catálogo.
 *
 * Casi todo acá abajo es un CONTROL NEGATIVO. Es a propósito: aceptar de más es
 * el único error que este pipeline no puede permitirse, porque termina en una
 * ficha que le promete al cliente algo distinto de lo que le va a llegar. Que
 * una foto correcta se asocie sola importa; que una incorrecta no pueda, importa
 * más.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  distinctiveTokens,
  normalizeText,
  parseSourceTitle,
  scoreCandidate,
  skuPresentation,
} from '../scripts/catalog-images/presentation.mjs';
import {
  IMAGE_AUDIT_COLUMNS,
  hostOf,
  recordsFromCsvRows,
  validateImageSourceAudit,
} from '../scripts/catalog-images/lib.mjs';
import { auditProductImageRights } from '../scripts/lib/publishable-image-rights.mjs';
import { loadCatalogSkus } from '../scripts/catalog-images/catalog-skus.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PET = { packagingConvention: { default: 'botella-pet' } };
const BOTELLA = { packagingConvention: { default: 'botella' } };

const PACK_X12 = skuPresentation({
  brand: 'Coca-Cola',
  capacityUnit: 'ml',
  capacityValue: 500,
  name: 'Coca-Cola Original',
  packagingType: 'Botella PET',
  sku: 'coca-cola-original-botella-pet-500-ml-pack-x12',
  unitsPerPack: 12,
  variant: 'Botella PET · 500 ml · Pack x12',
});
const UNIDAD_2250 = skuPresentation({
  brand: 'Coca-Cola',
  capacityUnit: 'ml',
  capacityValue: 2250,
  name: 'Coca-Cola',
  packagingType: 'botella-pet',
  sku: 'coca-cola-original-2250ml',
  unitsPerPack: 1,
  variant: 'Original',
});

function auditoriaCon(campos) {
  const fila = {
    capacity_verified: 'true',
    checked_at: '2026-08-18',
    expected_sha256: 'a'.repeat(64),
    external_id: 'x',
    notes: '',
    pack_verified: 'true',
    package_verified: 'true',
    rights_reference: 'TABA-AUT-2026-08-001',
    rights_status: 'LICENCIA_COMERCIAL',
    sku: 'x',
    source_type: 'fabricante',
    source_url: 'https://andinacocacolaar.vtexassets.com/arquivos/ids/1/foto.jpg',
    status: 'APROBADA',
    variant_verified: 'true',
    ...campos,
  };
  return recordsFromCsvRows([
    IMAGE_AUDIT_COLUMNS,
    IMAGE_AUDIT_COLUMNS.map((columna) => fila[columna]),
  ]);
}

test('el packshot oficial del pack se asocia solo al SKU de ese pack', () => {
  const parsed = parseSourceTitle('Coca–Cola Original 500ml x12', PET);
  assert.equal(scoreCandidate(PACK_X12, parsed, { brandDeclared: 'Coca Cola Andina' }).confidence, 'HIGH');
});

test('CONTROL NEGATIVO: una foto de pack no puede ilustrar la unidad suelta', () => {
  const parsed = parseSourceTitle('Coca–Cola Original 2,25L x6', PET);
  const { confidence, reasons } = scoreCandidate(UNIDAD_2250, parsed, { brandDeclared: 'Coca Cola Andina' });
  assert.equal(confidence, 'REJECT');
  assert.match(reasons.join(' '), /cantidad distinta/);
});

test('CONTROL NEGATIVO: otra capacidad rechaza aunque el resto cierre', () => {
  const parsed = parseSourceTitle('Coca–Cola Original 1,5L x12', PET);
  const { confidence, reasons } = scoreCandidate(PACK_X12, parsed, { brandDeclared: 'Coca Cola' });
  assert.equal(confidence, 'REJECT');
  assert.match(reasons.join(' '), /capacidad distinta/);
});

test('CONTROL NEGATIVO: zero contra original es otro producto', () => {
  const parsed = parseSourceTitle('Coca–Cola Zero 500ml x12', PET);
  assert.equal(scoreCandidate(PACK_X12, parsed, { brandDeclared: 'Coca Cola' }).confidence, 'REJECT');
});

test('CONTROL NEGATIVO: la lata no ilustra la botella', () => {
  const parsed = parseSourceTitle('Coca–Cola Original Lata 500ml x12', PET);
  const { confidence, reasons } = scoreCandidate(PACK_X12, parsed, { brandDeclared: 'Coca Cola' });
  assert.equal(confidence, 'REJECT');
  assert.match(reasons.join(' '), /envase distinto/);
});

test('CONTROL NEGATIVO: un combo de dos productos nunca es candidato', () => {
  const parsed = parseSourceTitle('Coca–Cola Original 500ml x12 + Fanta 500ml x12', PET);
  assert.equal(scoreCandidate(PACK_X12, parsed, { brandDeclared: 'Coca Cola' }).confidence, 'REJECT');
});

test('CONTROL NEGATIVO: la línea del producto tiene que coincidir, no sólo la cepa', () => {
  const trapiche = skuPresentation({
    brand: 'Trapiche',
    capacityUnit: 'ml',
    capacityValue: 750,
    name: 'Trapiche Origen Malbec',
    packagingType: 'botella',
    sku: 'trapiche-origen-malbec-750ml',
    unitsPerPack: 1,
    variant: 'Malbec',
  });
  assert.equal(
    scoreCandidate(trapiche, parseSourceTitle('ORIGEN BY TRAPICHE MALBEC 1X750ml', BOTELLA), { brandDeclared: 'Trapiche' }).confidence,
    'HIGH',
  );
  const otra = scoreCandidate(
    trapiche,
    parseSourceTitle('TRAPICHE RESERVA MALBEC 1X750ml', BOTELLA),
    { brandDeclared: 'Trapiche Reserva' },
  );
  assert.equal(otra.confidence, 'MEDIUM', 'otra línea no se asocia sola');
  assert.match(otra.reasons.join(' '), /la línea no es idéntica/);
});

test('CONTROL NEGATIVO: un sabor que nadie enumeró igual se detecta', () => {
  const powerade = skuPresentation({
    brand: 'Powerade',
    capacityUnit: 'ml',
    capacityValue: 500,
    name: 'Powerade Mountain Blast',
    packagingType: 'botella-pet',
    sku: 'powerade-mountain-blast-500ml',
    unitsPerPack: 1,
    variant: 'Mountain Blast',
  });
  const { confidence } = scoreCandidate(
    powerade,
    parseSourceTitle('Powerade Cool Citrus 500ml x1', PET),
    { brandDeclared: 'Powerade' },
  );
  assert.notEqual(confidence, 'HIGH', 'Cool Citrus no es Mountain Blast');
});

test('el acento agudo de la tienda no parte la marca en dos', () => {
  assert.equal(normalizeText('GORDON´S GIN'), "gordon's gin");
});

test('«chocolate» no cuenta como «cola»', () => {
  const dada = skuPresentation({
    brand: 'Dada',
    capacityUnit: 'ml',
    capacityValue: 750,
    name: 'Dada Caramel',
    packagingType: 'botella',
    sku: 'dada-caramel-750ml',
    unitsPerPack: 1,
    variant: 'Caramel',
  });
  const { reasons } = scoreCandidate(
    dada,
    parseSourceTitle('DADA N8 CHOCOLATE 1X750ml', BOTELLA),
    { brandDeclared: 'Dada' },
  );
  assert.doesNotMatch(reasons.join(' '), /la variante no coincide/);
});

test('las medidas no cuentan como palabras que identifican al producto', () => {
  assert.deepEqual(
    [...distinctiveTokens('ORIGEN BY TRAPICHE MALBEC 1X750ml', { brand: 'Trapiche' })].sort(),
    ['malbec', 'origen'],
  );
});

test('CONTROL NEGATIVO: un CDN de retailer no pasa la allowlist', () => {
  const { header, records } = auditoriaCon({
    source_url: 'https://jumboargentina.vtexassets.com/arquivos/ids/1/foto.jpg',
  });
  const { errors } = validateImageSourceAudit(header, records, {
    allowedHosts: new Set(['andinacocacolaar.vtexassets.com']),
  });
  assert.match(errors.join(' '), /jumboargentina\.vtexassets\.com no está en la allowlist/);
});

test('la misma fila pasa cuando su host SÍ está permitido', () => {
  const { header, records } = auditoriaCon({});
  const { errors } = validateImageSourceAudit(header, records, {
    allowedHosts: new Set(['andinacocacolaar.vtexassets.com']),
  });
  assert.deepEqual(errors, []);
});

test('CONTROL NEGATIVO: una fila aprobada no puede declarar que no tiene derechos', () => {
  const { header, records } = auditoriaCon({ rights_status: 'PENDIENTE_DERECHOS' });
  const { errors } = validateImageSourceAudit(header, records);
  assert.match(errors.join(' '), /rights_status no acredita uso comercial/);
});

test('hostOf no deja pasar lo que no es una URL', () => {
  assert.equal(hostOf('no soy una url'), null);
  assert.equal(hostOf('https://andinacocacolaar.vtexassets.com/x.jpg'), 'andinacocacolaar.vtexassets.com');
});

test('el guard de derechos entiende el manifiesto que produce el pipeline', () => {
  const nuestras = auditProductImageRights(ROOT)
    .filter((imagen) => /pack-x12|pack-x6/.test(imagen.path));
  assert.ok(nuestras.length >= 8, 'tienen que estar los master y los thumbnail');
  for (const imagen of nuestras) {
    assert.equal(imagen.rights, 'LICENCIA_COMERCIAL', `${imagen.path} tiene que declarar sus derechos`);
    assert.equal(imagen.publishable, true);
  }
});

test('CONTROL NEGATIVO: los activos históricos de retailer siguen bloqueados', () => {
  const historicos = auditProductImageRights(ROOT).filter((imagen) => imagen.rights === 'pending_review');
  assert.ok(historicos.length >= 120, 'los 60 activos históricos son master y thumbnail');
  assert.equal(historicos.every((imagen) => !imagen.publishable), true);
});

test('el manifiesto público no lista nada que la auditoría bloquee', () => {
  const manifiesto = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog/PUBLIC-PRODUCT-ASSETS.json'), 'utf8'));
  const publicables = new Set(auditProductImageRights(ROOT).filter((i) => i.publishable).map((i) => i.path));
  assert.ok(manifiesto.publicables.length > 0);
  for (const entrada of manifiesto.publicables) {
    assert.equal(publicables.has(entrada.ruta), true, `${entrada.ruta} no debería estar en el manifiesto público`);
    assert.equal(fs.existsSync(path.join(ROOT, entrada.ruta)), true, `${entrada.ruta} no existe en el repositorio`);
  }
});

test('el catálogo reconcilia en 56 SKU y la cuenta se comprueba', async () => {
  const { skus, reconciliacion } = await loadCatalogSkus(ROOT);
  assert.equal(skus.length, 56);
  assert.equal(reconciliacion.visibles, 33);
  assert.equal(reconciliacion.ocultosAgregados, 23);
  assert.equal(skus.filter((sku) => sku.alcoholic).length, 23);
});

test('la compuerta del alcohol no se movió: ningún alcohólico quedó disponible', async () => {
  const { skus } = await loadCatalogSkus(ROOT);
  assert.deepEqual(skus.filter((sku) => sku.alcoholic && sku.available), [], 'esta misión no habilita alcohol');
});

test('cada parecido entre imágenes está explicado por escrito', () => {
  const explicados = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog/duplicados-explicados.json'), 'utf8'));
  for (const par of explicados.pares) {
    assert.ok(par.explicacion?.length > 40, `${par.skuA}/${par.skuB} necesita una explicación real`);
    assert.ok(par.verificadoPor, 'una explicación sin responsable no explica nada');
  }
});

test('la allowlist no contradice su propia lista de rechazados', () => {
  const allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog/image-source-allowlist.json'), 'utf8'));
  const permitidos = new Set(allowlist.groups.flatMap((grupo) => grupo.cdnHosts));
  for (const host of allowlist.rejectedHosts.hosts) {
    assert.equal(permitidos.has(host), false, `${host} está permitido y rechazado a la vez`);
  }
});
