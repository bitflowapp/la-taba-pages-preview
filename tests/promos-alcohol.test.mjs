import assert from 'node:assert/strict';
import test from 'node:test';

import { GONDOLA } from '../catalog/gondola-neuquen.mjs';
import { PRODUCTOS_PROPUESTOS } from '../catalog/gondola-retail-final-proposal.mjs';
import { DESCUENTOS_DECLARADOS, PISO_MARGEN_COMBO, PROMOS_ALCOHOL } from '../catalog/promos-alcohol.mjs';
import { COMBO_MANIFEST } from '../js/combos-data.js';
import { resolveCombo, roundPromotionalPrice } from '../js/core/combos.js';

/*
 * Las promociones de alcohol no viven todavía en `COMBO_MANIFEST`, y eso es
 * deliberado: hoy los 27 alcohólicos están con `available = false` detrás de la
 * compuerta de licencia, así que publicarlas agregaría seis tarjetas
 * permanentemente bloqueadas a la góndola. Lo que estas pruebas garantizan es
 * que el día que el alcohol se abra, ENCHUFARLAS FUNCIONE: misma forma, misma
 * aritmética y mismo redondeo que usa la app, verificados contra el catálogo
 * real y no contra una fixture.
 */
const porSku = new Map();
for (const p of GONDOLA) porSku.set(p.sku, { ...p, costoMedido: true });
for (const p of PRODUCTOS_PROPUESTOS) {
  if (!porSku.has(p.sku)) porSku.set(p.sku, { ...p, costoMayorista: null, costoMedido: false });
}

/**
 * El catálogo como se vería con el alcohol ABIERTO: los mismos productos, los
 * mismos precios, publicados. No inventa un precio ni un producto; sólo levanta
 * la bandera que hoy tiene bajada la compuerta de licencia.
 */
const catalogoConAlcoholAbierto = [...porSku.values()].map((p) => ({
  id: p.sku,
  sku: p.sku,
  name: p.name,
  price: Number(p.price),
  pricePending: false,
  stock: Math.max(1, Number(p.stock) || 1),
  available: true,
  alcoholic: Boolean(p.alcoholic),
  unitLabel: p.capacity,
}));

test('cada componente existe en el catálogo real y tiene costo mayorista medido', () => {
  for (const promo of PROMOS_ALCOHOL) {
    for (const componente of promo.components) {
      const producto = porSku.get(componente.sku);
      assert.ok(producto, `${promo.comboId}: ${componente.sku} no existe en ninguna autoridad`);
      assert.equal(
        producto.costoMedido,
        true,
        `${promo.comboId}: ${componente.sku} deriva su precio de una referencia minorista, `
        + 'así que su margen no se puede probar y no puede sostener un descuento',
      );
      assert.ok(Number(producto.costoMayorista) > 0, `${promo.comboId}: ${componente.sku} sin costo`);
      assert.notEqual(
        producto.soldAsPack,
        true,
        `${promo.comboId}: ${componente.sku} ya es un pack; un combo de packs duplica la decisión de compra`,
      );
    }
  }
});

test('toda sustitución vale exactamente lo mismo que el componente que reemplaza', () => {
  // `resolveCombo` descarta en silencio una sustitución con otro precio. Que la
  // app la descarte está bien; ofrecerla en el manifiesto es prometer un cambio
  // que después no aparece.
  for (const promo of PROMOS_ALCOHOL) {
    for (const componente of promo.components) {
      const base = porSku.get(componente.sku);
      for (const sku of componente.substitutions) {
        const sustituto = porSku.get(sku);
        assert.ok(sustituto, `${promo.comboId}: la sustitución ${sku} no existe`);
        assert.equal(
          Number(sustituto.price),
          Number(base.price),
          `${promo.comboId}: ${sku} no vale lo mismo que ${componente.sku}`,
        );
      }
    }
  }
});

test('ningún descuento declarado pasa el techo que sostiene el piso de margen de un pack', () => {
  for (const promo of PROMOS_ALCOHOL) {
    const declarado = DESCUENTOS_DECLARADOS[promo.comboId];
    assert.ok(Number.isInteger(declarado) && declarado > 0, `${promo.comboId} no declara descuento`);

    const precioLista = promo.components.reduce(
      (total, c) => total + Number(porSku.get(c.sku).price) * c.quantity,
      0,
    );
    const costo = promo.components.reduce(
      (total, c) => total + Number(porSku.get(c.sku).costoMayorista) * c.quantity,
      0,
    );
    const piso = costo * PISO_MARGEN_COMBO;
    const precioPromo = roundPromotionalPrice(precioLista * (1 - declarado / 100));

    assert.ok(
      precioPromo >= piso,
      `${promo.comboId}: a ${declarado} % se vendería a ${precioPromo} con costo ${costo}, `
      + `por debajo del piso ×${PISO_MARGEN_COMBO} (${Math.ceil(piso)})`,
    );
    assert.ok(precioLista - precioPromo > 0, `${promo.comboId}: el ahorro da 0`);
  }
});

test('el ahorro que anuncia la app es el mismo que verifica el margen', () => {
  // El punto entero: la aritmética del verificador y la de `js/core/combos.js`
  // tienen que ser LA MISMA. Si divergen, una de las dos miente y la que se
  // publica es la de la app.
  for (const promo of PROMOS_ALCOHOL) {
    const declarado = DESCUENTOS_DECLARADOS[promo.comboId];
    const resuelto = resolveCombo(
      { ...promo, discountPercentage: declarado, approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL' },
      catalogoConAlcoholAbierto,
    );
    assert.deepEqual(resuelto.blockers, [], `${promo.comboId} no resuelve con el alcohol abierto`);
    assert.equal(resuelto.available, true, `${promo.comboId} no quedaría disponible`);

    const precioLista = promo.components.reduce(
      (total, c) => total + Number(porSku.get(c.sku).price) * c.quantity,
      0,
    );
    assert.equal(resuelto.individualPrice, precioLista, `${promo.comboId}: precio de lista distinto`);
    assert.equal(
      resuelto.promotionalPrice,
      roundPromotionalPrice(precioLista * (1 - declarado / 100)),
      `${promo.comboId}: precio promocional distinto`,
    );
    assert.equal(resuelto.savings, resuelto.individualPrice - resuelto.promotionalPrice);
    assert.ok(resuelto.hasRealSaving, `${promo.comboId} no tiene ahorro real`);
    assert.equal(resuelto.ageRestricted, true, `${promo.comboId} tiene que exigir +18`);
    assert.equal(resuelto.minimumAge, 18);
  }
});

test('ninguna promoción de alcohol se puede cobrar mientras no esté aprobada', () => {
  for (const promo of PROMOS_ALCOHOL) {
    const resuelto = resolveCombo(
      { ...promo, discountPercentage: DESCUENTOS_DECLARADOS[promo.comboId], approvalStatus: 'PENDIENTE_APROBACION_COMERCIAL' },
      catalogoConAlcoholAbierto,
    );
    assert.equal(
      resuelto.chargeable,
      false,
      `${promo.comboId} se podría cobrar sin aprobación comercial`,
    );
  }
});

test('cada promoción declara al menos un componente alcohólico y su ocasión de consumo', () => {
  const ocasiones = new Set(['previa', 'juntada', 'asado']);
  for (const promo of PROMOS_ALCOHOL) {
    assert.ok(
      promo.components.some((c) => porSku.get(c.sku)?.alcoholic),
      `${promo.comboId} no tiene ningún componente alcohólico`,
    );
    assert.ok(ocasiones.has(promo.ocasion), `${promo.comboId}: ocasión desconocida «${promo.ocasion}»`);
    assert.ok(promo.razonComercial?.length > 40, `${promo.comboId} no explica por qué existe`);
    assert.match(promo.terms, /mayor[ií]a de edad/i, `${promo.comboId} no advierte el +18`);
  }
});

test('las promociones de alcohol no colisionan con los combos que ya existen', () => {
  const yaExisten = new Set(COMBO_MANIFEST.map((c) => c.comboId));
  for (const promo of PROMOS_ALCOHOL) {
    assert.equal(yaExisten.has(promo.comboId), false, `${promo.comboId} ya existe en COMBO_MANIFEST`);
  }
});
