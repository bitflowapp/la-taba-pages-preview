import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  isPurchasableBeverageProduct,
  isVisibleBeverageProduct,
  featuredBeverageProducts,
  visibleBeverageHomeSections,
} from '../js/core/beverage-home-sections.js';
import { availabilityLabel, stockPill } from '../js/ui.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/*
 * MIRAR NO ES COMPRAR.
 *
 * El comercio tiene veintisiete bebidas alcohólicas cargadas con precio
 * confirmado y `available = false`, esperando la habilitación de expendio. Las
 * que ya tienen packshot real entran a la góndola para poder verlas; ninguna
 * puede terminar en un carrito.
 *
 * Esta prueba fija esa frase en los cuatro lugares donde se puede romper sin
 * que nadie se entere: la consulta que trae el catálogo, el permiso de lectura
 * de la base, la clasificación visible/comprable, y el texto que ve la persona.
 */

/** Una bebida alcohólica en vidriera: con foto, con precio, y no a la venta. */
const enVidriera = Object.freeze({
  id: 'quilmes-stout-lata-473ml',
  sku: 'quilmes-stout-lata-473ml',
  name: 'Quilmes Stout',
  categoryId: 'cervezas',
  alcoholic: true,
  minimumAge: 18,
  available: false,
  archived: false,
  stock: 12,
  price: 2050,
  pricePending: false,
  image: 'assets/products/quilmes-stout-lata-473ml-aaa.webp',
});

test('una bebida alcohólica sin habilitar se ve pero no se puede comprar', () => {
  assert.equal(isVisibleBeverageProduct(enVidriera), true, 'tiene que entrar a la góndola');
  assert.equal(isPurchasableBeverageProduct(enVidriera), false, 'no puede entrar a la compra');
});

test('la vidriera de compra no la levanta: «Destacados» es superficie de venta', () => {
  const destacados = featuredBeverageProducts([enVidriera], { limit: 8 });
  assert.deepEqual(destacados.map((p) => p.id), [], 'lo no comprable no va a la vidriera de compra');
});

test('sí aparece en la sección de su categoría, que es lo que se quiere', () => {
  const secciones = visibleBeverageHomeSections([enVidriera], []);
  const cervezas = secciones.find((s) => s.id === 'cervezas');
  assert.ok(cervezas, 'la sección Cervezas tiene que dejar de estar oculta');
  assert.deepEqual(cervezas.products.map((p) => p.id), [enVidriera.id]);
});

test('no dice «agotado» ni «no disponible»: dice lo que realmente pasa', () => {
  /*
   * La distinción no es cosmética. «Agotado» y «No disponible» le dicen a la
   * persona que el comercio se quedó sin el producto, y es falso: lo tiene, con
   * stock contado. Lo que falta es la habilitación para venderlo.
   */
  assert.match(stockPill(enVidriera), /Próximamente/);
  assert.doesNotMatch(stockPill(enVidriera), /Agotado|No disponible/);
  assert.equal(availabilityLabel(enVidriera), 'Todavía no está a la venta');

  // Y un producto normal agotado sigue diciendo lo suyo.
  const agotado = { ...enVidriera, alcoholic: false, available: true, stock: 0 };
  assert.match(stockPill(agotado), /Agotado/);
});

test('el texto largo NO promete una fecha que el comercio no decide', () => {
  /*
   * La habilitación de expendio la otorga el municipio, no La Taba. Prometer
   * «pronto» o una fecha sería una promesa no verificable, que es exactamente
   * lo que la compuerta comercial rechaza.
   */
  const texto = availabilityLabel(enVidriera).toLowerCase();
  for (const promesa of ['pronto', 'mañana', 'esta semana', 'en breve', 'ya mismo']) {
    assert.equal(texto.includes(promesa), false, `el detalle no puede prometer «${promesa}»`);
  }
});

test('la consulta del catálogo trae el alcohol en vidriera y sólo el que tiene foto', () => {
  const repo = fs.readFileSync(path.join(root, 'js/repositories/supabase_order_repository.js'), 'utf8');
  assert.match(
    repo,
    /\.or\('available\.eq\.true,and\(is_alcoholic\.is\.true,available\.is\.false,image_url\.not\.is\.null\)'\)/,
    'la consulta tiene que pedir explícitamente los dos caminos',
  );
  /*
   * La condición se escribe en la CONSULTA y no se delega en RLS porque una
   * sesión de owner/admin/staff entra además por «production team reads
   * products», que devuelve el negocio entero: sin esto, el dueño mirando su
   * propia tienda vería los alcohólicos sin foto y los productos guardados.
   */
  assert.equal(
    repo.includes(".eq('available', true)"),
    false,
    'el filtro viejo tiene que haber salido, o el alcohol nunca llega',
  );
});

test('el permiso de lectura no puede exponer nada que se pueda comprar', () => {
  const sql = fs.readFileSync(
    path.join(root, 'supabase/migrations/20260826140000_alcohol_con_foto_visible_sin_venta.sql'),
    'utf8',
  );
  // `available is false` es lo que hace imposible que esta política exponga un
  // producto a la venta: en cuanto se habilite, la fila deja de entrar por acá.
  assert.match(sql, /available is false/);
  assert.match(sql, /is_alcoholic is true/);
  assert.match(sql, /image_url is not null/);
  assert.match(sql, /catalog_asset_id is not null/);
  assert.match(sql, /for select/);
  // No escribe nada, ni toca la compuerta del comercio.
  for (const prohibido of ['update public.products', 'insert into public.products', 'alcohol_sales_enabled =']) {
    assert.equal(sql.includes(prohibido), false, `la migración no puede contener «${prohibido}»`);
  }
});
