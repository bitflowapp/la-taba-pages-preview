/*
 * Todo lo que se puede comprobar ANTES de que alguien escriba su contraseña.
 *
 * POR QUÉ EXISTE
 * --------------
 * La RPC `register_catalog_assets` no confía en los hashes que le mandan: los
 * vuelve a calcular del lado del servidor con `catalog_image_identity_sha256`,
 * `catalog_asset_path` y `catalog_asset_binding_sha256`, y aborta el lote entero
 * si alguno no coincide. Eso está bien, pero significa que un error de un byte en
 * nuestra implementación se descubre recién con una sesión de owner abierta y a
 * mitad de una escritura.
 *
 * Este guion cierra esa brecha: las tres funciones son puras y están expuestas,
 * así que se las puede llamar con la clave PUBLICABLE, sin autenticar y sin
 * escribir nada. Si el binding no cierra, se sabe acá.
 *
 * SÓLO LEE. No autentica, no pide contraseña, no escribe.
 *
 *   node scripts/catalog-images/preflight-association.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  catalogAssetBindingSha256,
  catalogAssetPath,
  catalogImageIdentitySha256,
  DB_PRODUCT_ASSET_PATTERN,
} from './lib.mjs';
import { OBJETIVOS, SKUS_OBJETIVO } from './lote-objetivo.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFIESTO = path.join(ROOT, 'docs/catalog/image-manifest.json');
const ALLOWLIST = path.join(ROOT, 'catalog/image-source-allowlist.json');
const AUTORIZACIONES = path.join(ROOT, 'catalog/autorizaciones-comerciales.json');

const REF = 'wwcpogltfgzgkrlilbcd';
const BASE = `https://${REF}.supabase.co`;
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const AUTORIDAD = 'TABA-AUT-2026-08-001';
const ORIGEN_PUBLICO = process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev';

const fallos = [];
const avisos = [];
const ok = (mensaje) => console.log(`  OK    ${mensaje}`);
const mal = (mensaje) => { fallos.push(mensaje); console.error(`  FALLA ${mensaje}`); };
const ojo = (mensaje) => { avisos.push(mensaje); console.log(`  OJO   ${mensaje}`); };

/** La clave publicable sale del sitio publicado. Es pública por diseño. */
async function clavePublicable() {
  const respuesta = await fetch(`${ORIGEN_PUBLICO}/runtime-config.js`, { signal: AbortSignal.timeout(30_000) });
  if (!respuesta.ok) throw new Error(`runtime-config.js respondió ${respuesta.status}.`);
  const texto = await respuesta.text();
  const url = texto.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
  const key = texto.match(/publishableKey:\s*'([^']+)'/)?.[1];
  if (!url?.includes(REF)) throw new Error(`El sitio publicado no apunta a ${REF}: ${url}`);
  return key;
}

const key = await clavePublicable();
const cabeceras = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };

async function rpc(nombre, cuerpo) {
  const respuesta = await fetch(`${BASE}/rest/v1/rpc/${nombre}`, {
    body: JSON.stringify(cuerpo),
    headers: cabeceras,
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
  });
  if (!respuesta.ok) throw new Error(`rpc ${nombre}: HTTP ${respuesta.status} ${await respuesta.text()}`);
  return respuesta.json();
}

async function leer(consulta) {
  const respuesta = await fetch(`${BASE}/rest/v1/${consulta}`, {
    headers: cabeceras,
    signal: AbortSignal.timeout(30_000),
  });
  if (!respuesta.ok) throw new Error(`lectura ${consulta}: HTTP ${respuesta.status}`);
  return respuesta.json();
}

const manifiesto = JSON.parse(await fs.readFile(MANIFIESTO, 'utf8'));
const allowlist = JSON.parse(await fs.readFile(ALLOWLIST, 'utf8'));
const autorizaciones = JSON.parse(await fs.readFile(AUTORIZACIONES, 'utf8'));
const autoridad = autorizaciones.autorizaciones.find((a) => a.id === AUTORIDAD);
const cdnPermitidos = new Set(allowlist.groups.flatMap((g) => g.cdnHosts));
const hostsRechazados = new Set(allowlist.rejectedHosts.hosts.map((h) => h.toLowerCase()));

console.log('DESTINO');
ok(`${BASE} · ref ${REF}`);
ok(`negocio ${BUSINESS_ID}`);

console.log('');
console.log(`LOTE · ${manifiesto.sources.length} assets`);
if (manifiesto.sources.length !== SKUS_OBJETIVO.length) {
  mal(`se esperaban ${SKUS_OBJETIVO.length} assets en el manifiesto y hay ${manifiesto.sources.length}.`);
}

/*
 * La lista de objetivos es la de `lote-objetivo.mjs` y no una copia. Estaba
 * escrita dos veces, y cuando el lote creció la copia de acá se quedó en los
 * cuatro packs de agosto: el preflight habría rechazado las quince
 * fotografías nuevas que el aplicador sí acepta. Una regla duplicada en dos
 * archivos es una regla que se desincroniza.
 */
for (const sku of manifiesto.sources.map((f) => f.sku)) {
  if (!OBJETIVOS.has(sku)) mal(`el manifiesto trae un SKU inesperado: ${sku}`);
}
for (const sku of SKUS_OBJETIVO) {
  if (!manifiesto.sources.some((f) => f.sku === sku)) mal(`falta en el manifiesto: ${sku}`);
}

console.log('');
console.log('BINDING · recalculado por PRODUCCIÓN, no por nosotros');
for (const fuente of manifiesto.sources) {
  const master = fuente.assets.master;
  const thumbnail = fuente.assets.thumbnail;

  const identidadRemota = await rpc('catalog_image_identity_sha256', {
    p_external_id: fuente.externalId,
    p_sku: fuente.sku,
    p_source_sha256: fuente.sourceSha256,
  });
  const identidadLocal = catalogImageIdentitySha256(fuente);
  if (identidadRemota !== identidadLocal || identidadRemota !== fuente.identitySha256) {
    mal(`${fuente.sku}: identity_sha256 no coincide (base ${identidadRemota}, nuestro ${identidadLocal}).`);
    continue;
  }

  let cierra = true;
  for (const [kind, asset, size] of [['master', master, 1000], ['thumbnail', thumbnail, 400]]) {
    const rutaRemota = await rpc('catalog_asset_path', {
      p_asset_sha256: asset.sha256,
      p_identity_sha256: identidadRemota,
      p_kind: kind,
      p_safe_sku: fuente.safeSku,
    });
    if (rutaRemota !== asset.path || rutaRemota !== catalogAssetPath(fuente, kind, asset.sha256)) {
      mal(`${fuente.sku}: ruta ${kind} no coincide (base ${rutaRemota}, nuestra ${asset.path}).`);
      cierra = false;
      continue;
    }
    if (!DB_PRODUCT_ASSET_PATTERN.test(rutaRemota)) {
      mal(`${fuente.sku}: la ruta ${kind} no entra en el patrón que exige la base.`);
      cierra = false;
      continue;
    }
    const bindingRemoto = await rpc('catalog_asset_binding_sha256', {
      p_asset_sha256: asset.sha256,
      p_height: size,
      p_identity_sha256: identidadRemota,
      p_kind: kind,
      p_path: rutaRemota,
      p_source_sha256: fuente.sourceSha256,
      p_width: size,
    });
    const bindingLocal = catalogAssetBindingSha256(fuente, kind, asset);
    if (bindingRemoto !== asset.bindingSha256 || bindingRemoto !== bindingLocal) {
      mal(`${fuente.sku}: binding ${kind} no coincide (base ${bindingRemoto}, nuestro ${asset.bindingSha256}).`);
      cierra = false;
    }
  }
  if (cierra) ok(`${fuente.sku}: identidad, rutas y binding coinciden con lo que va a recalcular la base.`);
}

console.log('');
console.log('DERECHOS Y PROCEDENCIA');
for (const fuente of manifiesto.sources) {
  const host = new URL(fuente.sourceUrl).hostname.toLowerCase();
  if (hostsRechazados.has(host)) mal(`${fuente.sku}: la fuente es un host rechazado (${host}).`);
  else if (!cdnPermitidos.has(host)) mal(`${fuente.sku}: ${host} no está en la allowlist.`);
  if (fuente.rightsStatus !== autoridad.habilita_rights_status) {
    mal(`${fuente.sku}: rights_status ${fuente.rightsStatus} no es el que habilita ${AUTORIDAD}.`);
  }
  if (fuente.rightsReference !== AUTORIDAD) mal(`${fuente.sku}: no cita ${AUTORIDAD}.`);
  if (!['fabricante', 'marca', 'propio', 'distribuidor_oficial'].includes(fuente.sourceType)) {
    mal(`${fuente.sku}: sourceType ${fuente.sourceType} está fuera del alcance de la autorización.`);
  }
}
if (!fallos.length) {
  ok(`las ${manifiesto.sources.length} fuentes están en la allowlist y citan ${AUTORIDAD}.`);
}
if (autoridad.evidencia_documental.pendiente) {
  ojo(`${AUTORIDAD} sigue con la evidencia documental PENDIENTE. Se publica bajo una autorización declarada, no documentada.`);
}

console.log('');
console.log('ARCHIVOS EN EL REPOSITORIO');
for (const fuente of manifiesto.sources) {
  for (const asset of [fuente.assets.master, fuente.assets.thumbnail]) {
    const existe = await fs.stat(path.join(ROOT, asset.path)).then(() => true).catch(() => false);
    if (!existe) mal(`falta el archivo ${asset.path}.`);
  }
}
if (!fallos.length) {
  ok(`los ${manifiesto.sources.length * 2} WebP están en el repositorio y van a viajar en el paquete.`);
}

console.log('');
console.log('ESTADO ACTUAL EN PRODUCCIÓN');
const productos = await leer(
  `products?select=sku,external_id,is_active,available,is_verified,stock,catalog_asset_id,image_url,sold_as_pack,units_per_pack`
  + `&business_id=eq.${BUSINESS_ID}&sku=in.(${SKUS_OBJETIVO.join(',')})&order=sku.asc`,
);
const porSkuManifiesto = new Map(manifiesto.sources.map((fuente) => [fuente.sku, fuente]));
/*
 * Un objetivo que no aparece NO es un objetivo que falte: acá se lee con la
 * clave publicable, que no devuelve los productos ocultos (available = false).
 * La sesión de owner sí los ve, y el aplicador lo vuelve a comprobar entonces.
 * Frenar acá por eso dejaría el lote entero parado por un movimiento de
 * inventario que no tiene nada que ver con las fotos.
 */
const vistos = new Set(productos.map((producto) => producto.sku));
for (const sku of SKUS_OBJETIVO) {
  if (!vistos.has(sku)) ojo(`${sku}: la clave publicable no lo ve. Si hoy está fuera de venta, la sesión de owner sí lo verá.`);
}
let altas = 0;
let yaPuestas = 0;
for (const producto of productos) {
  if (!OBJETIVOS.has(producto.sku)) { mal(`producto inesperado en el lote: ${producto.sku}`); continue; }
  const fuente = porSkuManifiesto.get(producto.sku);
  const problemas = [];
  if (!producto.is_active) problemas.push('no está activo');
  if (!(producto.stock > 0)) problemas.push('stock en cero: al republicar quedaría NO disponible');
  /*
   * Dos estados de partida son legítimos por producto, y son los mismos que
   * distingue el aplicador: sin ninguna imagen, o ya con LA SUYA y su asset.
   * Cualquier otra combinación —imagen sin asset, o una imagen que no es la
   * que el manifiesto declara para ese SKU— es lo que hay que ver acá.
   */
  const sinImagen = producto.catalog_asset_id === null && producto.image_url === null;
  const yaLaSuya = Boolean(producto.catalog_asset_id) && producto.image_url === fuente?.assets.master.path;
  if (sinImagen) {
    altas += 1;
    if (!producto.available) problemas.push('hoy NO está disponible: el republicado no lo cambiaría');
    if (!producto.is_verified) problemas.push('no está verificado');
  } else if (yaLaSuya) {
    yaPuestas += 1;
  } else {
    problemas.push(`tiene una imagen que no es la de su asset (${producto.image_url || 'sin ruta'})`);
  }
  if (problemas.length) mal(`${producto.sku}: ${problemas.join(' · ')}`);
  else ok(`${producto.sku}: stock ${producto.stock} · ${sinImagen ? 'sin imagen, listo para el alta' : 'imagen ya puesta'}`);
}

console.log('');
console.log('LO QUE VA A PASAR, DICHO ANTES');
console.log(`  1. register_catalog_assets deja ${manifiesto.sources.length} filas en catalog_assets (${altas} altas, ${yaPuestas} reescritas igual).`);
console.log('  2. Al escribirle la imagen a un producto VERIFICADO, el disparador');
console.log('     products_fail_close_master_change lo desverifica y lo saca de venta.');
console.log('     Es el diseño, no un accidente: cambiar la identidad de un producto');
console.log('     publicado obliga a volver a publicarlo a mano.');
console.log('  3. publish_catalog_product lo vuelve a verificar y a poner disponible,');
console.log('     después de comprobar que los 5 campos de imagen coinciden con el asset.');
console.log('');
console.log(`  Entre el paso 2 y el 3 esos ${altas + yaPuestas} productos NO se venden. Son segundos, pero si`);
console.log('  el proceso se corta en el medio quedan fuera de venta hasta republicarlos.');
console.log('  El guion republica siempre, incluso si algo falla después.');

console.log('');
if (fallos.length) {
  console.error(`PREFLIGHT: ${fallos.length} problema(s). NO abrir sesión de owner.`);
  process.exit(1);
}
console.log(`PREFLIGHT VERDE${avisos.length ? ` · ${avisos.length} aviso(s) para leer` : ''}.`);
console.log('Todo lo comprobable sin credenciales, comprobado. Falta la sesión de owner.');
