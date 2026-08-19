/*
 * Asocia las 4 fotografías aprobadas a sus productos, en producción.
 *
 * CÓMO RECIBE LA CREDENCIAL
 * -------------------------
 * Por STDIN, una línea, y es un JWT de sesión — nunca una contraseña. La
 * contraseña la pide el envoltorio de PowerShell, la usa una vez contra el
 * endpoint público de Auth y la borra de memoria; acá no llega y no puede
 * llegar. Por stdin y no por argumento ni por variable de entorno porque los
 * dos últimos quedan a la vista de cualquier proceso de la máquina.
 *
 * POR QUÉ import_catalog_batch Y NO UN UPDATE DE 6 COLUMNAS
 * ---------------------------------------------------------
 * Porque el UPDATE está revocado. La migración de autoridad de catálogo dice,
 * textual:
 *
 *     revoke insert, update on table public.products from authenticated;
 *     grant update (stock, available, is_active, sort_order) ... to authenticated;
 *
 * Un usuario autenticado NO puede escribir `image_url` ni `catalog_asset_id`
 * directamente, por más owner que sea. `register_catalog_assets` y
 * `stage_catalog_products` también están revocadas. La ÚNICA puerta con
 * `grant execute` es `import_catalog_batch`, y por dentro llama a las dos en una
 * sola transacción. Ese es el modelo de autorización, y se respeta.
 *
 * EL PRECIO DE ESA PUERTA, DICHO CLARO
 * ------------------------------------
 * `stage_catalog_products` reescribe la fila entera del producto con lo que se
 * le manda. Por eso este guion NO inventa ningún valor: lee el producto de
 * producción y lo devuelve idéntico, campo por campo, y sólo cambian las
 * columnas de imagen. Antes de escribir compara el eco contra lo leído y aborta
 * si algo no coincide. Un campo mal copiado acá es un precio cambiado en la
 * góndola.
 *
 * Y desverifica: el disparador `products_fail_close_master_change` saca de venta
 * cualquier producto verificado al que se le toque la imagen. Es el diseño.
 * `publish_catalog_product` lo vuelve a poner, y este guion lo intenta SIEMPRE,
 * incluso si algo falló antes, porque dejar los packs fuera de venta es peor que
 * cualquier error que estemos manejando.
 *
 *   node scripts/catalog-images/apply-association.mjs --dry-run
 *   <token> | node scripts/catalog-images/apply-association.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { stableJson } from './lib.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFIESTO = path.join(ROOT, 'docs/catalog/image-manifest.json');
const INFORME = path.join(ROOT, 'artifacts/taba2-catalog-images/ASSOCIATION-READBACK.json');

const REF = 'wwcpogltfgzgkrlilbcd';
const BASE = `https://${REF}.supabase.co`;
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
const EMAIL_ESPERADO = 'jariel1970@gmail.com';
const AUTORIDAD = 'TABA-AUT-2026-08-001';
const ORIGEN_PUBLICO = process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev';

const ESPERADOS = new Map([
  ['coca-cola-original-botella-pet-500-ml-pack-x12', 'Coca-Cola Original Pack x12'],
  ['coca-cola-zero-botella-pet-500-ml-pack-x12', 'Coca-Cola Zero Pack x12'],
  ['fanta-naranja-botella-pet-1500-ml-pack-x6', 'Fanta Naranja Pack x6'],
  ['sprite-botella-pet-500-ml-pack-x12', 'Sprite Pack x12'],
]);

/** Los campos que `stage_catalog_products` lee del payload y vuelve a escribir. */
const CAMPOS_ECO = [
  'external_id', 'sku', 'brand', 'name', 'description', 'category', 'subcategory',
  'variant', 'capacity_value', 'capacity_unit', 'packaging_type', 'units_per_pack',
  'price', 'stock', 'chilled', 'is_alcoholic', 'minimum_age', 'sort_order',
  'tags', 'is_active',
];

const seco = process.argv.includes('--dry-run');
const paso = (t) => console.log(`\n── ${t}`);
const ok = (t) => console.log(`  OK    ${t}`);
const info = (t) => console.log(`        ${t}`);

function abortar(mensaje) {
  console.error(`\nABORTA: ${mensaje}`);
  process.exit(1);
}

async function leerToken() {
  const trozos = [];
  for await (const trozo of process.stdin) trozos.push(trozo);
  const token = Buffer.concat(trozos).toString('utf8').trim();
  if (!/^ey[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) {
    abortar('lo que llegó por stdin no tiene forma de JWT. No se intenta nada.');
  }
  return token;
}

async function clavePublicable() {
  const r = await fetch(`${ORIGEN_PUBLICO}/runtime-config.js`, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) abortar(`runtime-config.js respondió ${r.status}.`);
  const t = await r.text();
  const url = t.match(/supabaseUrl:\s*'([^']+)'/)?.[1];
  const key = t.match(/publishableKey:\s*'([^']+)'/)?.[1];
  if (!url?.includes(REF)) abortar(`el sitio publicado no apunta a ${REF}.`);
  if (/^(eyJ|sb_secret_|service_role)/.test(key || '')) abortar('la clave publicada parece privilegiada.');
  return key;
}

const apikey = await clavePublicable();
const token = seco ? null : await leerToken();
const auth = token || apikey;
const cabeceras = {
  apikey,
  authorization: `Bearer ${auth}`,
  'content-type': 'application/json',
};

async function pedir(ruta, opciones = {}) {
  const r = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: { ...cabeceras, ...(opciones.headers || {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${opciones.method || 'GET'} ${ruta} -> ${r.status} ${texto.slice(0, 400)}`);
  return texto ? JSON.parse(texto) : null;
}

const rpc = (nombre, cuerpo) => pedir(`/rest/v1/rpc/${nombre}`, {
  body: JSON.stringify(cuerpo),
  method: 'POST',
});

// ── 1. Destino ───────────────────────────────────────────────────────────────
paso('DESTINO');
ok(`${BASE} · ref ${REF}`);
ok(`negocio ${BUSINESS_ID}`);
if (seco) info('MODO SECO: no se autentica ni se escribe nada.');

// ── 2. Identidad ─────────────────────────────────────────────────────────────
if (!seco) {
  paso('SESIÓN');
  const usuario = await pedir('/auth/v1/user');
  if (String(usuario?.email || '').toLowerCase() !== EMAIL_ESPERADO) {
    abortar(`la sesión es de otra cuenta (${usuario?.email}). Se esperaba ${EMAIL_ESPERADO}.`);
  }
  ok(`${usuario.email} · uid ${usuario.id}`);
  // Los nombres de los parámetros son los de la función, no los del resto del
  // esquema: PostgREST resuelve por nombre y devuelve 404 si no coinciden.
  const esOwner = await rpc('has_business_role', { roles: ['owner'], target_business_id: BUSINESS_ID });
  if (esOwner !== true) abortar('la cuenta no tiene rol owner ACTIVO en este negocio.');
  ok('rol owner activo, confirmado por la base');
  // Segunda lectura, por otra vía: la fila de membresía. Si las dos no dicen lo
  // mismo, algo raro pasa y no es momento de escribir.
  const membresias = await pedir(
    `/rest/v1/business_members?select=role,is_active&business_id=eq.${BUSINESS_ID}&user_id=eq.${usuario.id}`,
  );
  const owner = membresias.find((m) => m.role === 'owner');
  if (!owner) abortar('no hay fila de membresía owner para esta cuenta en este negocio.');
  if (owner.is_active === false) abortar('la membresía owner existe pero está inactiva.');
  ok(`membresía owner ${owner.is_active === false ? 'INACTIVA' : 'activa'} en business_members`);
}

// ── 3. Estado previo ─────────────────────────────────────────────────────────
paso('ESTADO PREVIO');
const manifiesto = JSON.parse(await fs.readFile(MANIFIESTO, 'utf8'));
if (manifiesto.sources.length !== 4) abortar(`el manifiesto tiene ${manifiesto.sources.length} assets y se esperaban 4.`);
for (const f of manifiesto.sources) {
  if (!ESPERADOS.has(f.sku)) abortar(`el manifiesto trae un SKU inesperado: ${f.sku}`);
  if (f.rightsReference !== AUTORIDAD) abortar(`${f.sku} no cita ${AUTORIDAD}.`);
  if (!['fabricante', 'marca', 'propio'].includes(f.sourceType)) {
    abortar(`${f.sku} viene de ${f.sourceType}, fuera del alcance de ${AUTORIDAD}.`);
  }
  const host = new URL(f.sourceUrl).hostname.toLowerCase();
  if (!host.endsWith('vtexassets.com') && !host.endsWith('vteximg.com.br')) {
    abortar(`${f.sku}: host de fuente inesperado (${host}).`);
  }
  if (host.includes('jumbo')) abortar(`${f.sku}: fuente de retailer. No se publica.`);
}
ok('4 assets, del embotellador, citando la autoridad');

if (!seco) {
  const previos = await pedir(
    `/rest/v1/catalog_assets?select=id,sku&business_id=eq.${BUSINESS_ID}`,
  );
  if (previos.length) {
    // Registrar un asset que ya existe y cambió DESACTIVA los productos que lo
    // usan. Si aparece uno, se para: esto dejó de ser una primera carga.
    abortar(`ya hay ${previos.length} catalog_assets en este negocio. Este guion es sólo para la primera carga.`);
  }
  ok('catalog_assets vacío: es una primera carga, sin efectos sobre productos existentes');
}

const columnas = CAMPOS_ECO.concat([
  'presentation', 'capacity', 'available', 'is_verified', 'catalog_asset_id',
  'image_url', 'sold_as_pack', 'catalog_origin',
]).join(',');
const productos = await pedir(
  `/rest/v1/products?select=${columnas}&business_id=eq.${BUSINESS_ID}&sold_as_pack=eq.true&order=sku.asc`,
);
if (productos.length !== 4) abortar(`se esperaban 4 productos con sold_as_pack y hay ${productos.length}.`);
for (const p of productos) {
  if (!ESPERADOS.has(p.sku)) abortar(`producto inesperado: ${p.sku}`);
  if (p.catalog_asset_id !== null || p.image_url !== null) abortar(`${p.sku} ya tiene imagen asociada.`);
  if (p.catalog_origin !== 'commercial') abortar(`${p.sku} no es comercial (${p.catalog_origin}).`);
  if (!p.is_active) abortar(`${p.sku} no está activo.`);
  if (!(p.stock > 0)) abortar(`${p.sku} tiene stock 0: al republicar quedaría NO disponible.`);
  if (!p.available || !p.is_verified) abortar(`${p.sku} no está hoy disponible y verificado.`);
  ok(`${ESPERADOS.get(p.sku)} · stock ${p.stock} · $${p.price} · disponible`);
}
const estadoPrevio = Object.fromEntries(productos.map((p) => [p.sku, { ...p }]));

// ── 4. Payloads ──────────────────────────────────────────────────────────────
paso('LOTE A APLICAR');
const porSku = new Map(productos.map((p) => [p.sku, p]));
const assets = manifiesto.sources.map((f) => ({
  external_id: f.externalId,
  identity_sha256: f.identitySha256,
  master_binding_sha256: f.assets.master.bindingSha256,
  master_path: f.assets.master.path,
  master_sha256: f.assets.master.sha256,
  rights_reference: f.rightsReference,
  rights_status: f.rightsStatus,
  safe_sku: f.safeSku,
  sku: f.sku,
  source_sha256: f.sourceSha256,
  source_url: f.sourceUrl,
  thumbnail_binding_sha256: f.assets.thumbnail.bindingSha256,
  thumbnail_path: f.assets.thumbnail.path,
  thumbnail_sha256: f.assets.thumbnail.sha256,
}));

const productosPayload = assets.map(({ sku }) => {
  const actual = porSku.get(sku);
  if (!actual) abortar(`no hay producto en producción para ${sku}.`);
  const fila = {};
  for (const campo of CAMPOS_ECO) fila[campo] = actual[campo];
  return fila;
});

// El eco se compara contra lo leído ANTES de mandarlo. Es barato y es la única
// defensa contra escribir un precio o un stock distinto por un error de copia.
for (const fila of productosPayload) {
  const actual = porSku.get(fila.sku);
  for (const campo of CAMPOS_ECO) {
    if (JSON.stringify(fila[campo]) !== JSON.stringify(actual[campo])) {
      abortar(`el eco de ${fila.sku} difiere en ${campo}: se escribiría ${JSON.stringify(fila[campo])} sobre ${JSON.stringify(actual[campo])}.`);
    }
  }
  // Lo que la base recalcula sola tiene que dar lo mismo que ya está guardado.
  if (actual.presentation !== fila.variant) abortar(`${fila.sku}: presentation cambiaría.`);
  if (actual.capacity !== `${fila.capacity_value} ${fila.capacity_unit}`) {
    abortar(`${fila.sku}: capacity cambiaría de "${actual.capacity}" a "${fila.capacity_value} ${fila.capacity_unit}".`);
  }
}
ok(`${assets.length} assets y ${productosPayload.length} productos, con el eco verificado campo por campo`);
info('cambian sólo: image_url, image_sha256, image_thumbnail_url, image_thumbnail_sha256,');
info('              source_image_sha256, catalog_asset_id');
info('NO viajan en el payload y quedan intactos: sold_as_pack, catalog_origin,');
info('              price_status, unit_cost, gtin, verified_by');

if (seco) {
  paso('MODO SECO · payload validado, nada escrito');
  console.log(stableJson({ assets: assets.length, productos: productosPayload }).slice(0, 1800));
  ok('el payload cumple todo lo que stage_catalog_products valida');
  process.exit(0);
}

// ── 5. Escritura ─────────────────────────────────────────────────────────────
paso('APLICANDO');
let importado = false;
const republicados = [];
const fallos = [];
try {
  await rpc('import_catalog_batch', {
    p_assets: assets,
    p_business_id: BUSINESS_ID,
    p_products: productosPayload,
  });
  importado = true;
  ok('import_catalog_batch: 4 assets registrados y 4 productos con su imagen');
  info('los 4 quedaron desverificados y fuera de venta, como manda el disparador');
} catch (error) {
  fallos.push(`import_catalog_batch: ${error.message}`);
  console.error(`  FALLA ${error.message}`);
}

// Republicar SIEMPRE que el import haya entrado. Si esto no corre, los packs
// quedan fuera de venta, y eso es peor que el error que lo trajo hasta acá.
if (importado) {
  for (const { sku } of assets) {
    try {
      const [publicado] = await rpc('publish_catalog_product', {
        p_available: true,
        p_business_id: BUSINESS_ID,
        p_external_id: sku,
      });
      republicados.push(publicado);
      ok(`${ESPERADOS.get(sku)}: verificado y ${publicado.published_available ? 'DISPONIBLE' : 'NO disponible'}`);
    } catch (error) {
      fallos.push(`publish ${sku}: ${error.message}`);
      console.error(`  FALLA republicando ${sku}: ${error.message}`);
    }
  }
}

// ── 6. Lectura de vuelta ─────────────────────────────────────────────────────
paso('LECTURA DE VUELTA');
const despues = await pedir(
  `/rest/v1/products?select=sku,image_url,image_sha256,image_thumbnail_url,image_thumbnail_sha256,source_image_sha256,catalog_asset_id,available,is_verified,price,stock,sold_as_pack,is_active`
  + `&business_id=eq.${BUSINESS_ID}&order=sku.asc`,
);
const conImagen = despues.filter((p) => p.image_url);
const comprobaciones = [];
const exigir = (condicion, mensaje) => {
  comprobaciones.push({ ok: Boolean(condicion), mensaje });
  console.log(`  ${condicion ? 'OK   ' : 'FALLA'} ${mensaje}`);
};

exigir(despues.length === 56, `56 productos en el negocio (hay ${despues.length})`);
exigir(conImagen.length === 4, `4 con imagen productiva (hay ${conImagen.length})`);
exigir(despues.length - conImagen.length === 52, `${despues.length - conImagen.length} con fallback propio de TABA`);

const porSkuManifiesto = new Map(manifiesto.sources.map((f) => [f.sku, f]));
for (const p of conImagen) {
  const f = porSkuManifiesto.get(p.sku);
  exigir(Boolean(f), `${p.sku}: la imagen corresponde a un asset del manifiesto`);
  if (!f) continue;
  exigir(p.image_url === f.assets.master.path, `${p.sku}: master ligado al SKU exacto`);
  exigir(p.image_thumbnail_url === f.assets.thumbnail.path, `${p.sku}: thumbnail ligado al SKU exacto`);
  exigir(p.image_sha256 === f.assets.master.sha256, `${p.sku}: SHA-256 del master`);
  exigir(p.image_thumbnail_sha256 === f.assets.thumbnail.sha256, `${p.sku}: SHA-256 del thumbnail`);
  exigir(p.source_image_sha256 === f.sourceSha256, `${p.sku}: SHA-256 de la fuente`);
  exigir(Boolean(p.catalog_asset_id), `${p.sku}: ligado a su catalog_asset`);
  exigir(p.is_verified === true && p.available === true, `${p.sku}: verificado y de vuelta en venta`);
  exigir(!/jumbo|carrefour|disco|vea|coto|mercadolibre/i.test(p.image_url), `${p.sku}: no es una imagen de retailer`);
}

// Metadata a medias es el estado que la vitrina no sabe dibujar: o los seis
// campos, o ninguno.
const aMedias = despues.filter((p) => {
  const campos = [p.image_url, p.image_sha256, p.image_thumbnail_url, p.image_thumbnail_sha256, p.source_image_sha256, p.catalog_asset_id];
  const llenos = campos.filter(Boolean).length;
  return llenos !== 0 && llenos !== 6;
});
exigir(aMedias.length === 0, `0 productos con metadata a medias (hay ${aMedias.length})`);

for (const p of despues) {
  const previo = estadoPrevio[p.sku];
  if (!previo) continue;
  exigir(Number(p.price) === Number(previo.price), `${p.sku}: el precio no cambió ($${p.price})`);
  exigir(p.stock === previo.stock, `${p.sku}: el stock no cambió (${p.stock})`);
  exigir(p.sold_as_pack === previo.sold_as_pack, `${p.sku}: sold_as_pack intacto`);
  exigir(p.available === previo.available, `${p.sku}: disponibilidad igual que antes`);
}

const assetsRegistrados = await pedir(`/rest/v1/catalog_assets?select=sku,rights_status,rights_reference,source_url&business_id=eq.${BUSINESS_ID}&order=sku.asc`);
exigir(assetsRegistrados.length === 4, `4 catalog_assets registrados (hay ${assetsRegistrados.length})`);
for (const a of assetsRegistrados) {
  exigir(a.rights_status === 'LICENCIA_COMERCIAL', `${a.sku}: rights_status LICENCIA_COMERCIAL`);
  exigir(a.rights_reference === AUTORIDAD, `${a.sku}: cita ${AUTORIDAD}`);
}

const rotas = comprobaciones.filter((c) => !c.ok);
await fs.mkdir(path.dirname(INFORME), { recursive: true });
await fs.writeFile(INFORME, stableJson({
  assetsRegistrados,
  comprobaciones,
  conImagen: conImagen.length,
  fallos,
  productos: despues.map((p) => ({
    available: p.available,
    catalogAssetId: p.catalog_asset_id ? 'presente' : null,
    imageUrl: p.image_url,
    isVerified: p.is_verified,
    sku: p.sku,
  })),
  republicados,
  schemaVersion: 1,
  totalProductos: despues.length,
  veredicto: rotas.length === 0 && fallos.length === 0 ? 'ASOCIACION APLICADA Y VERIFICADA' : 'REVISAR',
}), 'utf8');

paso('RESULTADO');
console.log(`  informe: ${path.relative(ROOT, INFORME).replaceAll('\\', '/')}`);
if (fallos.length || rotas.length) {
  console.error(`  ${fallos.length} error(es) de escritura · ${rotas.length} comprobación(es) rota(s)`);
  process.exit(1);
}
console.log('  ASOCIACION APLICADA Y VERIFICADA');
