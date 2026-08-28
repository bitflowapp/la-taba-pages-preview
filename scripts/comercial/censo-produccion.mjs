/*
 * ¿QUÉ LE FALTA A CADA PRODUCTO, EXACTAMENTE, PARA PODER VENDERSE?
 *
 * Lee PRODUCCIÓN y contesta esa pregunta SKU por SKU. No escribe nada: la
 * puerta que usa —`db-solo-lectura`— rechaza toda sentencia que no sea un
 * SELECT, así que no puede tocar un dato aunque quien la use se equivoque.
 *
 * POR QUÉ NO ALCANZABA LO QUE YA HABÍA
 * ------------------------------------
 * `catalog:readiness` contesta esta misma pregunta, pero sobre
 * `catalog/products.csv` —el catálogo del REPOSITORIO—. Sirve para preparar el
 * pedido de datos al negocio; no sirve para saber qué está pasando en la tienda
 * que está publicada. Cuando los dos no coinciden, el que manda es éste.
 *
 * LA REGLA DE COMPRABILIDAD NO SE INVENTA ACÁ
 * -------------------------------------------
 * Se copia de donde ya vive, y por eso cada condición lleva su origen:
 *
 *   supabase_order_repository.loadCatalog()      qué entra a la góndola
 *   supabase_order_repository (mapeo de fila)    qué fila se descarta entera
 *   core/beverage-home-sections.isPurchasable…   qué se puede comprar
 *
 * Si alguna de las tres cambia, este censo miente. Los tests de
 * `tests/comercial/censo-produccion.test.mjs` fijan las tres.
 *
 *   node scripts/comercial/censo-produccion.mjs
 *   node scripts/comercial/censo-produccion.mjs --json
 *   node scripts/comercial/censo-produccion.mjs --csv censo.csv
 */
import fs from 'node:fs';
import process from 'node:process';
import { consultar, lit } from '../e2e-production-sale/db-solo-lectura.mjs';

const NEGOCIO = '00000000-0000-4000-8000-000000000001';

/**
 * Los motivos por los que un producto NO se puede vender, en el orden en que
 * los aplica el sistema real. El orden importa: se informa el PRIMERO que lo
 * frena, que es el que hay que resolver primero.
 */
export const MOTIVOS = Object.freeze({
  INACTIVO: 'is_active = false: no entra a la góndola',
  SIN_VERIFICAR: 'is_verified = false: no entra a la góndola',
  SIN_NOMBRE: 'sin nombre: el mapeo del cliente descarta la fila entera',
  SIN_SKU: 'sin sku: el mapeo del cliente descarta la fila entera',
  SIN_EXTERNAL_ID: 'sin external_id: el mapeo del cliente descarta la fila entera',
  PRECIO_PENDIENTE: 'price_status = pending: falta que el comercio confirme el precio',
  SIN_PRECIO: 'price <= 0: falta el precio',
  ALCOHOL_SIN_HABILITAR: 'alcohol con la venta cerrada: available = false por la compuerta comercial',
  NO_DISPONIBLE: 'available = false: el comercio no lo publicó',
  SIN_STOCK: 'stock <= 0: no hay unidades',
  SIN_IMAGEN: 'sin image_url: se puede vender, pero llega sin foto',
});

/**
 * Clasifica UNA fila de producción. Devuelve el bucket, si es comprable y la
 * lista de motivos; el primero es el bloqueante.
 */
export function clasificar(fila, { alcoholHabilitado = false } = {}) {
  const motivos = [];
  const precio = Number(fila.price);
  const stock = fila.stock === null || fila.stock === undefined ? null : Number(fila.stock);
  const precioPendiente = fila.price_status === 'pending';

  if (fila.is_active !== true) motivos.push(MOTIVOS.INACTIVO);
  if (fila.is_verified !== true) motivos.push(MOTIVOS.SIN_VERIFICAR);
  if (!String(fila.name || '').trim()) motivos.push(MOTIVOS.SIN_NOMBRE);
  if (!String(fila.sku || '').trim()) motivos.push(MOTIVOS.SIN_SKU);
  if (!String(fila.external_id || '').trim()) motivos.push(MOTIVOS.SIN_EXTERNAL_ID);
  if (precioPendiente) motivos.push(MOTIVOS.PRECIO_PENDIENTE);
  else if (!(precio > 0)) motivos.push(MOTIVOS.SIN_PRECIO);

  if (fila.available !== true) {
    /*
     * Un alcohólico con `available = false` no está incompleto: está esperando
     * una habilitación que NO es un dato de catálogo. Decir «el comercio no lo
     * publicó» mandaría a alguien a publicarlo, que es justo lo que no se puede
     * hacer sin la habilitación de expendio.
     */
    motivos.push(fila.is_alcoholic === true && !alcoholHabilitado
      ? MOTIVOS.ALCOHOL_SIN_HABILITAR
      : MOTIVOS.NO_DISPONIBLE);
  }
  if (!(stock > 0)) motivos.push(MOTIVOS.SIN_STOCK);

  const comprable = motivos.length === 0;
  // La foto no impide vender, así que se anota aparte y DESPUÉS de decidir.
  const conImagen = Boolean(String(fila.image_url || '').trim());
  if (!conImagen) motivos.push(MOTIVOS.SIN_IMAGEN);

  return { comprable, conImagen, motivos, bucket: bucketDe(fila, comprable) };
}

function bucketDe(fila, comprable) {
  if (fila.is_active !== true) return 'inactivos';
  if (comprable) return 'normales';
  if (fila.is_alcoholic === true) return 'alcohol_visible_no_comprable';
  return 'incompletos';
}

const BUCKETS = Object.freeze([
  ['normales', 'Productos normales, comprables hoy'],
  ['alcohol_visible_no_comprable', 'Alcohol visible pero NO comprable'],
  ['incompletos', 'Productos incompletos (les falta un dato del comercio)'],
  ['inactivos', 'Productos inactivos'],
]);

export async function censar() {
  const [negocio] = await consultar(
    `select alcohol_sales_enabled from public.businesses where id = ${lit(NEGOCIO)}`,
  );
  const alcoholHabilitado = negocio?.alcohol_sales_enabled === true;

  const filas = await consultar(`
    select id, sku, external_id, name, category, subcategory, is_active, available,
           is_verified, price, price_status, stock, is_alcoholic, image_url, catalog_origin
      from public.products
     where business_id = ${lit(NEGOCIO)}
     order by category nulls last, name`);

  const productos = filas.map((fila) => ({ ...fila, ...clasificar(fila, { alcoholHabilitado }) }));

  /*
   * Promociones preparadas: los combos llevan su propio estado de aprobación,
   * separado de `is_active`. Uno cargado y sin aprobar es trabajo hecho que
   * espera una decisión del comercio, no un error.
   */
  const combos = await consultar(`
    select id, combo_id, name, approval_status, is_active, discount_percentage
      from public.product_combos
     where business_id = ${lit(NEGOCIO)}
     order by name`);

  return { alcoholHabilitado, productos, combos };
}

export function csvDe(productos) {
  const cabecera = [
    'id', 'sku', 'nombre', 'categoria', 'is_active', 'available', 'is_verified',
    'price', 'price_status', 'stock', 'imagen_valida', 'comprable', 'bucket',
    'motivo_bloqueante', 'motivos',
  ];
  const celda = (valor) => {
    const texto = valor === null || valor === undefined ? '' : String(valor);
    return /[",\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const lineas = productos.map((p) => [
    p.id, p.sku, p.name, p.category, p.is_active, p.available, p.is_verified,
    p.price, p.price_status, p.stock, p.conImagen, p.comprable, p.bucket,
    p.comprable ? '' : (p.motivos[0] || ''),
    p.motivos.join(' | '),
  ].map(celda).join(','));
  return `${cabecera.join(',')}\n${lineas.join('\n')}\n`;
}

const argumento = (nombre) => {
  const i = process.argv.indexOf(nombre);
  return i === -1 ? null : process.argv[i + 1];
};

if (process.argv[1]?.endsWith('censo-produccion.mjs')) {
  const { alcoholHabilitado, productos, combos } = await censar();

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ alcoholHabilitado, productos, combos }, null, 2));
  } else {
    console.log(`CENSO COMERCIAL DE PRODUCCIÓN · ${productos.length} productos\n`);
    for (const [clave, titulo] of BUCKETS) {
      const del = productos.filter((p) => p.bucket === clave);
      console.log(`── ${titulo}: ${del.length}`);
      const porMotivo = new Map();
      for (const p of del) {
        const motivo = p.comprable ? '(comprable)' : (p.motivos[0] || '(sin motivo)');
        porMotivo.set(motivo, (porMotivo.get(motivo) || 0) + 1);
      }
      for (const [motivo, cuantos] of [...porMotivo].sort((a, b) => b[1] - a[1])) {
        console.log(`     ${String(cuantos).padStart(3)} · ${motivo}`);
      }
      const sinFoto = del.filter((p) => !p.conImagen).length;
      if (sinFoto) console.log(`     ${String(sinFoto).padStart(3)} · de ésos, sin foto`);
      console.log('');
    }
    const preparadas = combos.filter((c) => c.approval_status !== 'approved' || c.is_active !== true);
    console.log(`── Promociones preparadas pero NO vigentes: ${preparadas.length} de ${combos.length}`);
    for (const combo of preparadas) {
      console.log(`     · ${combo.name} · aprobacion=${combo.approval_status} activa=${combo.is_active}`);
    }
    console.log(`\nalcohol_sales_enabled = ${alcoholHabilitado}`);
    console.log(`comprables hoy = ${productos.filter((p) => p.comprable).length}`);
  }

  const csv = argumento('--csv');
  if (csv) {
    fs.writeFileSync(csv, csvDe(productos), 'utf8');
    console.error(`\ncenso escrito en ${csv}`);
  }
}
