// Verifica que la ubicación del comercio diga lo MISMO en los cuatro lugares
// donde tiene que existir, y que ninguno de los puntos descartados haya vuelto.
//
// POR QUÉ EXISTE
// --------------
// La coordenada estuvo duplicada a mano en cuatro archivos y las cuatro copias
// apuntaban al mismo punto equivocado, a 793 m de la puerta. Nadie lo notó
// porque nada obligaba a que coincidieran con algo. Ahora hay un contrato
// (`data/business-location.json`) y esto falla si alguna superficie se desvía.
//
// Cubre cuatro lenguajes distintos, así que compara por extracción de texto:
//   1. data/business-location.json ........ el contrato
//   2. js/core/business-location.js ....... el espejo que consume el navegador
//   3. app del Rider (Dart) ............... kTabaBusinessIdentity
//   4. supabase/staging-rider-map-pickup-point.sql ... el sembrado de staging
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');

// El repositorio del Rider es otro repo. Se busca en los worktrees hermanos y,
// si no está, se avisa sin romper: no todo el mundo lo tiene clonado al lado.
const RIDER_CANDIDATOS = [
  process.env.TABA_RIDER_REPO,
  resolve(RAIZ, '..', 'taba2-location-truth-rider'),
  resolve(RAIZ, '..', 'taba2-rider-pilot-rc2'),
].filter(Boolean);

const problemas = [];
const notas = [];
const fallar = (m) => problemas.push(m);

// ── 1. el contrato ───────────────────────────────────────────────────────────
const contratoRuta = join(RAIZ, 'data', 'business-location.json');
const contrato = JSON.parse(readFileSync(contratoRuta, 'utf8'));
const { latitude: LAT, longitude: LNG } = contrato;

for (const campo of [
  'business_id', 'name', 'address', 'latitude', 'longitude',
  'source', 'confidence', 'verified_at', 'human_verified', 'accuracy_meters',
]) {
  if (contrato[campo] === undefined) fallar(`el contrato no declara «${campo}»`);
}
if (!Number.isFinite(LAT) || !Number.isFinite(LNG)) fallar('el contrato no tiene una coordenada numérica');
if (!['low', 'medium', 'high'].includes(contrato.confidence)) {
  fallar(`confidence «${contrato.confidence}» no es low|medium|high`);
}
if (!['business_verified', 'public_directory_cross_checked', 'qa_fixture'].includes(contrato.source)) {
  fallar(`source «${contrato.source}» no es uno de los tres que acepta la base`);
}
// El mismo CHECK que impone la base: human_verified sólo con business_verified.
if (contrato.human_verified === true && contrato.source !== 'business_verified') {
  fallar('human_verified=true exige source=business_verified (lo impone un CHECK en la base)');
}
// La guarda que habría frenado el punto de Zapala.
const LIMITES = { latMin: -38.982, latMax: -38.904, lngMin: -68.105, lngMax: -67.955 };
if (LAT < LIMITES.latMin || LAT > LIMITES.latMax || LNG < LIMITES.lngMin || LNG > LIMITES.lngMax) {
  fallar(`${LAT}, ${LNG} cae fuera de Neuquén Capital`);
}

// ── 2. el espejo que consume el navegador ────────────────────────────────────
const mod = await import(new URL('../js/core/business-location.js', import.meta.url));
for (const campo of ['business_id', 'name', 'address', 'latitude', 'longitude',
  'source', 'confidence', 'verified_at', 'human_verified', 'accuracy_meters']) {
  if (mod.BUSINESS_LOCATION[campo] !== contrato[campo]) {
    fallar(`js/core/business-location.js: «${campo}» dice ${JSON.stringify(mod.BUSINESS_LOCATION[campo])} `
      + `y el contrato ${JSON.stringify(contrato[campo])}`);
  }
}
if (mod.DEMO_CUSTOMER_DESTINATION.lat !== contrato.demo.destination_latitude
  || mod.DEMO_CUSTOMER_DESTINATION.lng !== contrato.demo.destination_longitude) {
  fallar('el destino demo del módulo JS no coincide con el del contrato');
}

// El enlace de Maps tiene que abrir por coordenadas. Buscar «Mendoza 827» como
// texto resuelve en Zapala, a 175 km: medido, y por eso esto se verifica.
const urlNegocio = mod.businessMapsSearchUrl();
if (!urlNegocio.includes(encodeURIComponent(`${LAT.toFixed(7)},${LNG.toFixed(7)}`))) {
  fallar(`el enlace de Maps no lleva la coordenada: ${urlNegocio}`);
}
if (/Mendoza|827/.test(urlNegocio)) fallar('el enlace de Maps abre por texto de dirección');

// ── 3. la configuración del storefront deriva del contrato ───────────────────
const config = await import(new URL('../js/config.js', import.meta.url));
const bl = config.BUSINESS_CONFIG.businessLocation;
if (bl.lat !== LAT || bl.lng !== LNG) {
  fallar(`js/config.js businessLocation ${bl.lat}, ${bl.lng} no es el del contrato`);
}
if (config.BUSINESS_CONFIG.address !== contrato.address) {
  fallar(`js/config.js address «${config.BUSINESS_CONFIG.address}» no es la del contrato`);
}
const sandbox = await import(new URL('../js/sandbox/sandbox_map_scenario.js', import.meta.url));
const tienda = sandbox.SANDBOX_MAP_SCENARIO.store;
if (tienda.lat !== LAT || tienda.lng !== LNG) {
  fallar(`el escenario sandbox del mapa ubica el local en ${tienda.lat}, ${tienda.lng}`);
}
const ruta = sandbox.SANDBOX_MAP_SCENARIO.route;
if (ruta[0].lat !== LAT || ruta[0].lng !== LNG) fallar('la ruta demo no arranca en el local');
const fin = ruta[ruta.length - 1];
if (fin.lat !== contrato.demo.destination_latitude || fin.lng !== contrato.demo.destination_longitude) {
  fallar('la ruta demo no termina en el destino declarado por el contrato');
}

// ── 4. el Rider ──────────────────────────────────────────────────────────────
const riderRepo = RIDER_CANDIDATOS.find((p) => existsSync(join(p, 'lib', 'core', 'config', 'business_config.dart')));
if (!riderRepo) {
  notas.push('no se encontró el repositorio del Rider al lado; su coordenada no se verificó. '
    + 'Indicar la ruta con TABA_RIDER_REPO=... para incluirlo.');
} else {
  const dart = readFileSync(join(riderRepo, 'lib', 'core', 'config', 'business_config.dart'), 'utf8');
  const lat = dart.match(/latitude:\s*(-?\d+\.\d+)/);
  const lng = dart.match(/longitude:\s*(-?\d+\.\d+)/);
  if (!lat || !lng) {
    fallar('el Rider no declara latitude/longitude en business_config.dart');
  } else {
    if (Number(lat[1]) !== LAT) fallar(`el Rider dice latitude ${lat[1]} y el contrato ${LAT}`);
    if (Number(lng[1]) !== LNG) fallar(`el Rider dice longitude ${lng[1]} y el contrato ${LNG}`);
  }
  if (!/verifiedConfiguration/.test(dart)) {
    fallar('el Rider trae coordenada pero no la declara verifiedConfiguration');
  }
  if (!new RegExp(`name:\\s*'${contrato.name}'`).test(dart)) {
    fallar(`el Rider no nombra al comercio «${contrato.name}»`);
  }
}

// ── 5. el sembrado de staging ────────────────────────────────────────────────
const sqlRuta = join(RAIZ, 'supabase', 'staging-rider-map-pickup-point.sql');
const sql = readFileSync(sqlRuta, 'utf8');
const sqlLat = sql.match(/v_lat\s+constant[^:]*:=\s*(-?\d+\.\d+)/);
const sqlLng = sql.match(/v_lng\s+constant[^:]*:=\s*(-?\d+\.\d+)/);
if (!sqlLat || !sqlLng) {
  fallar('no se pudo leer v_lat/v_lng del SQL de staging');
} else {
  // El SQL guarda numeric(9,6): se compara con la misma precisión.
  if (Number(sqlLat[1]) !== Number(LAT.toFixed(6))) fallar(`el SQL de staging dice lat ${sqlLat[1]} y el contrato ${LAT.toFixed(6)}`);
  if (Number(sqlLng[1]) !== Number(LNG.toFixed(6))) fallar(`el SQL de staging dice lng ${sqlLng[1]} y el contrato ${LNG.toFixed(6)}`);
}
if (/'qa_fixture'/.test(sql)) {
  fallar('el SQL de staging sigue sembrando el punto como qa_fixture');
}

// ── 6. ningún punto descartado sigue vivo en código ──────────────────────────
// Sólo se mira lo que se EJECUTA. Los puntos descartados están escritos, a
// propósito, en los comentarios de esos mismos archivos: explicar de qué se
// corrigió el punto es documentación, no una regresión. Por eso se quitan los
// comentarios antes de buscar, y no al revés.
function soloCodigo(texto, ext) {
  if (ext === 'sql') {
    // En SQL se quitan además los literales de texto: `source_note` guarda la
    // procedencia en prosa, y ahí nombrar el punto que se reemplazó es
    // exactamente lo que queremos que quede escrito en la base. Los valores que
    // sí se usan (v_lat/v_lng) ya se comparan uno a uno más arriba.
    return texto.replace(/--[^\n]*/g, '').replace(/'(?:[^']|'')*'/g, "''");
  }
  return texto
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const VIGILADOS = [
  'js/config.js',
  'js/core/business-location.js',
  'js/sandbox/sandbox_map_scenario.js',
  'js/map/route_geometry.js',
  'supabase/staging-rider-map-pickup-point.sql',
];
const PROHIBIDOS = [
  { patron: /-38\.9516\b/, que: 'el punto viejo de Parque Central (lat -38.9516)' },
  { patron: /-68\.0591\b/, que: 'el punto viejo de Parque Central (lng -68.0591)' },
  { patron: /-38\.95172\b/, que: 'el punto viejo del sandbox (lat -38.95172)' },
  { patron: /-68\.05942\b/, que: 'el punto viejo del sandbox (lng -68.05942)' },
  { patron: /-70\.075\d*/, que: 'la longitud de Zapala' },
];
for (const rel of VIGILADOS) {
  const ruta = join(RAIZ, rel);
  // Un vigilado que no existe se salteaba en silencio, y un archivo renombrado
  // dejaba de mirarse sin que nada avisara: el chequeo seguía en verde mirando
  // menos. Si desaparece, se dice y se falla; sacar uno de la lista es una
  // decisión que se toma acá, a mano.
  if (!existsSync(ruta)) {
    fallar(`el archivo vigilado «${rel}» no existe: o se renombró, o hay que sacarlo de VIGILADOS`);
    continue;
  }
  const texto = soloCodigo(readFileSync(ruta, 'utf8'), rel.split('.').pop());
  for (const { patron, que } of PROHIBIDOS) {
    if (patron.test(texto)) fallar(`${rel} volvió a nombrar ${que} en código ejecutable`);
  }
}

// ── informe ──────────────────────────────────────────────────────────────────
console.log(`contrato de ubicación: ${contrato.name} — ${contrato.address}`);
console.log(`  ${LAT}, ${LNG}  source=${contrato.source} confidence=${contrato.confidence} `
  + `human_verified=${contrato.human_verified} precisión=${contrato.accuracy_meters} m`);
console.log(`  destino demo: ${contrato.demo.destination_label} `
  + `(${contrato.demo.destination_latitude}, ${contrato.demo.destination_longitude})`);
if (riderRepo) console.log(`  Rider verificado en ${riderRepo}`);
for (const n of notas) console.log(`  aviso: ${n}`);

if (problemas.length) {
  console.error(`\n${problemas.length} problema(s):`);
  for (const p of problemas) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\nlas superficies coinciden con el contrato.');
