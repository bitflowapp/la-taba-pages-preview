/*
 * UNA PUBLICACIÓN, UNA IDENTIDAD.
 *
 * El worker sirve network-first y reescribe la caché, así que un cliente en
 * línea que recarga recibe lo nuevo sin ningún bump. Ése no es el problema. El
 * problema son las tres cosas que dependen de que la identidad del artefacto sea
 * única:
 *
 *  1. El atajo del cortocircuitos. `sw.js` justifica servir la copia guardada
 *     sin esperar a la red con este argumento textual: «el precache está
 *     versionado, así que una copia guardada es el MISMO contenido que iba a
 *     traer la red». Con contenido nuevo bajo la misma identidad deja de ser
 *     cierto, y en red degradada el cliente recibe una mezcla de dos
 *     publicaciones.
 *  2. El rollback. Volver al despliegue anterior sólo sirve si los dos
 *     artefactos se distinguen. Con la misma identidad, «volví» y «me quedé» se
 *     ven igual.
 *  3. La certificación. `preflight-staging-package` y
 *     `certify-staging-always-map` identifican lo publicado por estos tokens.
 *
 * QUÉ MIDE ESTE GATE, y por qué así.
 *
 * De los archivos del precache sólo cuatro llevan `?v=`: el CSS, `app.js`,
 * `pwa-update.js` y `startup-recovery.js`. TODOS LOS DEMÁS —hoy más de cien
 * módulos— están protegidos únicamente por `CACHE_NAME`. Por eso la pregunta
 * correcta no es «¿alguien se acordó de subir el número?» sino:
 *
 *     ¿cambió el contenido de algo que se precachea sin que cambiara CACHE_NAME?
 *
 * La identidad se DERIVA del contenido y se compara contra la que quedó firmada
 * en `release-identity.json`. Un módulo tocado sin bump rompe el gate aunque ese
 * módulo no lleve `?v=` y nadie lo hubiera mirado.
 *
 * Uso:
 *   node scripts/check-release-identity.mjs           verifica
 *   node scripts/check-release-identity.mjs --write   firma la identidad actual
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST_NAME = 'release-identity.json';

/**
 * Los cuatro tokens `?v=` tienen que coincidir entre `index.html` y `sw.js`.
 * Uno distinto en cada lado publica dos URLs para el mismo byte y parte el
 * precache: el worker guarda una y el navegador pide la otra.
 */
export function verificarTokens({ indexHtml, worker }) {
  const fallas = [];
  const esperados = [
    ['styles.css', /href="(styles\.css\?v=\d+)"/],
    ['js/app.js', /src="(js\/app\.js\?v=\d+)"/],
    ['js/pwa-update.js', /src="(js\/pwa-update\.js\?v=\d+)"/],
    ['js/startup-recovery.js', /src="(js\/startup-recovery\.js\?v=\d+)"/],
  ];
  for (const [etiqueta, patron] of esperados) {
    const enHtml = indexHtml.match(patron)?.[1];
    if (!enHtml) {
      fallas.push(`index.html no carga ${etiqueta} con un token ?v=.`);
      continue;
    }
    if (!worker.includes(`'./${enHtml}'`)) {
      fallas.push(`sw.js no precachea './${enHtml}', que es lo que index.html pide.`);
    }
  }
  return fallas;
}

/**
 * Las cuatro combinaciones posibles entre lo firmado y lo que hay en el árbol.
 * Separada del sistema de archivos a propósito: es la regla, y la regla se
 * prueba sola.
 */
export function compararIdentidad(firmada, actual) {
  const mismoContenido = firmada.assetsDigest === actual.assetsDigest;
  const mismaIdentidad = firmada.cacheName === actual.cacheName;

  // El caso que este gate existe para atrapar.
  if (!mismoContenido && mismaIdentidad) {
    return [
      'El contenido del precache CAMBIÓ y CACHE_NAME no.\n'
      + `    firmado:  ${firmada.cacheName}  (${firmada.assetCount} archivos, digest ${String(firmada.assetsDigest).slice(0, 16)}…)\n`
      + `    actual:   ${actual.cacheName}  (${actual.assetCount} archivos, digest ${String(actual.assetsDigest).slice(0, 16)}…)\n`
      + '    Dos artefactos distintos bajo la misma identidad dejan el rollback sin ancla.\n'
      + '    Subí CACHE_NAME (y el ?v= de los archivos que lo llevan, si cambiaron)\n'
      + '    y volvé a firmar con: node scripts/check-release-identity.mjs --write',
    ];
  }

  // Invalidar la caché de todos los clientes sin haber cambiado un byte.
  if (mismoContenido && !mismaIdentidad) {
    return [
      `CACHE_NAME subió a "${actual.cacheName}" sin que cambiara un solo byte del precache.\n`
      + '    No es grave, pero tira la caché de todos los clientes sin motivo.\n'
      + '    Si es a propósito, volvé a firmar: node scripts/check-release-identity.mjs --write',
    ];
  }

  // Publicación nueva y bien formada; sólo falta refrescar la firma.
  if (!mismoContenido && !mismaIdentidad) {
    return [
      `La identidad firmada quedó atrás: firmada "${firmada.cacheName}", actual "${actual.cacheName}".\n`
      + '    Volvé a firmar con: node scripts/check-release-identity.mjs --write',
    ];
  }

  return [];
}

/** Lee el árbol y devuelve la identidad derivada del contenido. */
export function calcularIdentidad(root = ROOT) {
  const worker = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const cacheName = worker.match(/const CACHE_NAME = '([^']+)'/)?.[1] || '';

  const fallas = cacheName ? [] : ['sw.js no declara CACHE_NAME.'];
  fallas.push(...verificarTokens({ indexHtml, worker }));

  const listados = [...worker.matchAll(/'\.\/([^']*)'/g)]
    .map((match) => match[1])
    .filter(Boolean);

  const porArchivo = {};
  const ausentes = [];
  for (const entrada of listados) {
    const relativo = entrada.split('?')[0];
    if (!relativo) continue;
    const absoluto = path.join(root, relativo);
    if (!fs.existsSync(absoluto) || !fs.statSync(absoluto).isFile()) {
      ausentes.push(relativo);
      continue;
    }
    porArchivo[relativo] = createHash('sha256').update(fs.readFileSync(absoluto)).digest('hex');
  }

  // Un archivo del precache que no existe es problema de `check-static-assets`;
  // acá sólo se denuncia para que el digest no mienta por omisión.
  if (ausentes.length) {
    fallas.push(`el precache lista ${ausentes.length} archivo(s) inexistente(s): ${ausentes.slice(0, 5).join(', ')}`);
  }

  const assetsDigest = createHash('sha256')
    .update(Object.keys(porArchivo).sort().map((k) => `${k}:${porArchivo[k]}`).join('\n'))
    .digest('hex');

  return { identidad: { cacheName, assetCount: Object.keys(porArchivo).length, assetsDigest }, fallas };
}

function main() {
  const escribir = process.argv.includes('--write');
  const manifest = path.join(ROOT, MANIFEST_NAME);
  const { identidad, fallas } = calcularIdentidad(ROOT);

  if (escribir) {
    fs.writeFileSync(manifest, `${JSON.stringify(identidad, null, 2)}\n`, 'utf8');
    console.log('Identidad de release firmada:');
    console.log(`  CACHE_NAME    ${identidad.cacheName}`);
    console.log(`  archivos      ${identidad.assetCount}`);
    console.log(`  digest        ${identidad.assetsDigest.slice(0, 16)}…`);
    return 0;
  }

  if (!fs.existsSync(manifest)) {
    console.error(`Falta ${MANIFEST_NAME}. Firmalo con: node scripts/check-release-identity.mjs --write`);
    return 1;
  }

  fallas.push(...compararIdentidad(JSON.parse(fs.readFileSync(manifest, 'utf8')), identidad));

  if (fallas.length) {
    console.error('Identidad de release INCOHERENTE:');
    for (const falla of fallas) console.error(`  · ${falla}`);
    return 1;
  }

  console.log(`Identidad de release coherente: ${identidad.cacheName} · ${identidad.assetCount} archivos precacheados.`);
  return 0;
}

// Sólo corre como comando; importarlo para probar la regla no ejecuta nada.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
