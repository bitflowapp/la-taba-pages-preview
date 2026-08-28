/*
 * LA GÓNDOLA GRANDE, MEDIDA Y SOSTENIDA.
 *
 * TABA se construyó con treinta y tres productos, y el armado del catálogo
 * tenía un algoritmo que crecía con el cuadrado del tamaño: `linkProcurementPacks`
 * barría el catálogo ENTERO por cada pack para encontrar su unidad. Con decenas
 * de SKU era gratis; con la tienda 24/7 multi-rubro, no:
 *
 *     vincular pack↔unidad    500 → 3,2 ms   1000 → 9,0 ms   2000 → 28,3 ms
 *     con el índice           500 → 1,4 ms   1000 → 2,6 ms   2000 →  4,8 ms
 *
 * Se reescribió para indexar las unidades una vez y consultar por pack. Lo que
 * este archivo protege son las DOS cosas que la reescritura podía romper:
 *
 *   1. QUE SIGA DANDO LO MISMO. La versión rápida se compara contra una
 *      implementación de referencia escrita como dice la regla en palabras —la
 *      lenta, la obvia— sobre un catálogo con la forma que hace trabajar al
 *      algoritmo. Es la única forma de saber que «más rápido» no fue «distinto».
 *   2. QUE NO VUELVA A SER CUADRÁTICO. Un solo techo, holgado, sobre un catálogo
 *      cuatro veces más grande que el objetivo. No mide velocidad —eso depende de
 *      la máquina— sino que el trabajo no volvió a explotar.
 *
 * La desambiguación de nombres TAMBIÉN se reescribió y se revirtió: con un
 * catálogo de la forma que tiene una góndola real la versión «rápida» resultó
 * tres veces más lenta. Queda su prueba de equivalencia, que sigue valiendo para
 * la versión simple.
 *
 * La medición de pantalla NO está acá: no hay DOM en Node. Vive en
 * `scripts/benchmark-catalog-browser.mjs`, que abre Chromium de verdad. Lo que
 * sí se fija acá es el CONTRATO de la grilla paginada, leyendo el código.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { buildSyntheticCatalog, measureCatalogScale } from '../scripts/benchmark-catalog-scale.mjs';
import { normalizeCatalogProduct, mergeCatalogProducts } from '../js/core/catalog-store.js';
import {
  applyRetailNaming,
  detectPurchasePackaging,
  linkProcurementPacks,
} from '../js/core/retail-packaging.js';

const ui = fs.readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');

const normalizar = (lista) => lista.map((product) => normalizeCatalogProduct(product)).filter(Boolean);
const texto = (value) => String(value ?? '').trim().toLowerCase();

/** La regla del vínculo pack↔unidad, escrita como dice en palabras. */
function linkProcurementPacksReferencia(list) {
  const packaging = new Map(list.map((product) => [product.id, detectPurchasePackaging(product)]));
  const links = new Map();
  for (const pack of list) {
    if (packaging.get(pack.id)?.isPack !== true) continue;
    const candidatas = list.filter((candidate) => (
      candidate.id !== pack.id
      && texto(candidate.brand) === texto(pack.brand)
      && texto(candidate.categoryId) === texto(pack.categoryId)
      && Number(candidate.capacityValue) === Number(pack.capacityValue)
      && texto(candidate.capacityUnit) === texto(pack.capacityUnit)
      && packaging.get(candidate.id)?.isPack === false
    ));
    if (candidatas.length === 1) links.set(pack.id, candidatas[0].id);
  }
  return links;
}

/** La regla de la desambiguación de nombres, escrita como dice en palabras. */
function ambiguosReferencia(list) {
  const grupos = new Map();
  for (const product of list) {
    const clave = `${texto(product.brand)}|${texto(product.categoryId)}|${texto(product.name)}`;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(product);
  }
  const ambiguos = new Set();
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    for (const product of grupo) {
      const hayOtroDistinto = grupo.some((other) => (
        other !== product
        && texto(other.variant) !== texto(product.variant)
        && texto(other.subcategory) !== texto(product.subcategory)
      ));
      if (hayOtroDistinto) ambiguos.add(product.id);
    }
  }
  return ambiguos;
}

test('el vínculo pack↔unidad rápido da exactamente lo mismo que la regla en palabras', () => {
  const catalogo = normalizar(buildSyntheticCatalog(400));
  const rapido = linkProcurementPacks(catalogo);
  const referencia = linkProcurementPacksReferencia(catalogo);

  // Lo que el vínculo escribe en cada fila: el pack gana su dato de compra y la
  // unidad la referencia inversa. Se compara producto por producto.
  const vinculados = new Map(rapido
    .filter((product) => product?.procurement?.retailUnitId)
    .map((product) => [product.id, product.procurement.retailUnitId]));
  assert.deepEqual([...vinculados].sort(), [...referencia].sort());
  assert.ok(referencia.size > 0, 'el catálogo sintético tiene que producir vínculos, si no la prueba no prueba nada');
});

test('la desambiguación de nombres coincide con la regla en palabras', () => {
  const catalogo = normalizar(buildSyntheticCatalog(400));
  const referencia = ambiguosReferencia(catalogo);
  const antes = new Map(catalogo.map((product) => [product.id, product.name]));
  const despues = applyRetailNaming(catalogo);

  // Un producto ambiguo recibe el nombre compuesto; el resto conserva el suyo
  // limpio de logística. Lo que se compara es QUIÉN cambió, que es la decisión.
  for (const product of despues) {
    const eraAmbiguo = referencia.has(product.id);
    const cambio = product.name !== antes.get(product.id);
    if (eraAmbiguo) {
      assert.ok(
        product.name.length >= antes.get(product.id).length,
        `${product.id} era ambiguo y su nombre no se compuso`,
      );
    } else if (cambio) {
      // Un no-ambiguo sólo puede haber perdido texto de logística, nunca ganado.
      assert.ok(
        product.name.length <= antes.get(product.id).length,
        `${product.id} no era ambiguo y ganó texto`,
      );
    }
  }
  assert.ok(referencia.size > 0, 'el catálogo sintético tiene que producir ambigüedades');
});

test('armar el catálogo no volvió a ser cuadrático', () => {
  /*
   * Cuatro mil SKU, cuatro veces el objetivo del encargo. Con el barrido
   * anterior esto tardaba segundos —el vínculo solo tardaba 273 ms con 2000 y
   * crece con el cuadrado—; con el índice tarda alrededor de 60 ms.
   *
   * El techo está en 1.500 ms a propósito: veinticinco veces lo medido. No mide
   * la velocidad de la máquina, que en un runner compartido varía; mide que el
   * trabajo siga creciendo con el tamaño y no con su cuadrado. Una vuelta al
   * barrido lo cruza sin margen para discutir.
   */
  const crudos = buildSyntheticCatalog(4000);
  const desde = performance.now();
  const catalogo = mergeCatalogProducts(crudos, []);
  const tardo = performance.now() - desde;
  assert.equal(catalogo.length >= 4000, true);
  assert.ok(tardo < 1500, `armar 4000 SKU tardó ${Math.round(tardo)} ms; el techo es 1500 ms`);
});

test('el banco de pruebas mide y devuelve números coherentes', () => {
  const medida = measureCatalogScale(200, { runs: 1 });
  assert.equal(medida.size, 200);
  assert.equal(medida.productos >= 200, true);
  assert.ok(medida.comprables > 0 && medida.comprables < medida.productos);
  assert.ok(medida.seccionesVisibles > 0);
  for (const clave of ['catalogo', 'home', 'busqueda', 'categoria']) {
    assert.equal(typeof medida.ms[clave], 'number', `falta la medida de ${clave}`);
  }
});

test('la grilla del catálogo se dibuja de a tramos y el filtro no se pagina', () => {
  /*
   * MEDIDO EN CHROMIUM, viewport 390×844, con `benchmark-catalog-browser.mjs`:
   *
   *              abrir catálogo        nodos del documento
   *              antes    después      antes     después
   *      100 SKU   216 ms   168 ms      4.056      3.902
   *      500 SKU   684 ms   299 ms     13.232      4.963
   *     1000 SKU 1.640 ms   437 ms     22.519      5.035
   *
   * El tramo es de 120 y el catálogo que TABA publica hoy tiene 80 productos
   * visibles: para la tienda de hoy esto es inerte, y empieza a trabajar recién
   * cuando el catálogo crece. Con 60 cortaba el catálogo actual por la mitad.
   *
   * El documento dejó de crecer con el catálogo. Lo que se fija acá es que la
   * grilla siga cortando y que el FILTRO no: la búsqueda y la categoría corren
   * sobre el catálogo entero, y el contador dice el total.
   */
  assert.match(ui, /const CATALOG_PAGE_SIZE = \d+;/);
  assert.match(ui, /const enPantalla = filteredProducts\.slice\(0, visibles\);/);
  assert.match(ui, /data-catalog-show-more/);
  // El contador de arriba sigue contando TODO lo filtrado, no lo dibujado.
  assert.match(ui, /const products = getFilteredProducts\(state\);\s*\n\s*const count = products\.length;/);
  // Y el aviso de «nada comprable» también mira la lista entera.
  assert.match(ui, /const nadaComprable = filteredProducts\.every\(/);
  // Cambiar de categoría, de búsqueda, de orden o de filtro vuelve al primer
  // tramo: seguir en la página cuatro de una lista que ya no existe no es
  // conservar el lugar.
  assert.match(ui, /function catalogPageKey\(state\)[\s\S]{0,400}state\.activeCategory[\s\S]{0,200}state\.sortBy/);
  assert.match(ui, /catalogVisibleCount = CATALOG_PAGE_SIZE;/);
});
