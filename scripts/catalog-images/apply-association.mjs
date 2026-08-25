/*
 * Asocia las fotografías aprobadas del lote a sus productos, en producción.
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
import { unlinkSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { stableJson } from './lib.mjs';
import { autorizaCatalogo, ROLES_CATALOGO } from './owner-authority.mjs';
import {
  disponibilidadTrasPublicar, fueraDelLote, OBJETIVOS, SKUS_OBJETIVO, validarLoteObjetivo,
} from './lote-objetivo.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFIESTO = path.join(ROOT, 'docs/catalog/image-manifest.json');
const INFORME = path.join(ROOT, 'artifacts/taba2-catalog-images/ASSOCIATION-READBACK.json');

const REF = 'wwcpogltfgzgkrlilbcd';
const BASE = `https://${REF}.supabase.co`;
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
// Confirmación opcional de que se está operando con la cuenta prevista. NO es la
// autorización —esa la da el rol que devuelve la base— y por eso no vive escrita
// en el repositorio: es un dato personal y ataría el guion a una persona.
const EMAIL_ESPERADO = String(process.env.TABA_EXPECTED_OWNER_EMAIL || '').trim().toLowerCase();
const AUTORIDAD = 'TABA-AUT-2026-08-001';
const ORIGEN_PUBLICO = process.env.TABA_PUBLIC_ORIGIN || 'https://la-taba.pages.dev';

const etiqueta = (sku) => OBJETIVOS.get(sku)?.nombre || sku;

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

// ── 1b. Concurrencia ─────────────────────────────────────────────────────────
/*
 * Dos guardas distintas, contra dos problemas distintos.
 *
 * La primera es contra NOSOTROS MISMOS: dos copias de este guion corriendo a la
 * vez podrían intercalar el import de una con el republicado de la otra y dejar
 * productos fuera de venta sin que ninguna de las dos se entere. Un archivo
 * creado con `wx` es un candado barato y suficiente.
 *
 * La segunda es contra OTRA sesión de trabajo. El proyecto coordina con archivos
 * de candado compartidos, y la regla es releerlos JUSTO ANTES de mutar, no al
 * arrancar: entre que un proceso empieza y llega a escribir puede pasar media
 * hora. Si otra misión declara estar mutando producción, esto se para.
 */
const CANDADO = path.join(os.tmpdir(), 'taba-apply-association.lock');
if (!seco) {
  try {
    await fs.writeFile(CANDADO, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const quien = await fs.readFile(CANDADO, 'utf8').catch(() => '(ilegible)');
      abortar(`ya hay otra corrida de este guion: ${quien.trim()}. Si sobró de una corrida muerta, borrar ${CANDADO}.`);
    }
    throw error;
  }
  process.on('exit', () => {
    try { unlinkSync(CANDADO); } catch { /* ya no está */ }
  });
  ok('candado propio tomado');
}

// La carpeta de candados compartidos vive fuera del repositorio y depende de la
// máquina, así que se pasa por entorno. Escribirla acá adentro sería atar el
// repositorio a un disco de alguien —y el guard de higiene lo rechaza, con razón.
const LOCKS_COMPARTIDOS = process.env.TABA_LOCKS_DIR || '';
const MIO = 'taba2-catalog-image-pipeline.txt';
const archivosLock = LOCKS_COMPARTIDOS
  ? await fs.readdir(LOCKS_COMPARTIDOS).catch(() => null)
  : null;
if (archivosLock === null) {
  info(LOCKS_COMPARTIDOS
    ? `no pude leer ${LOCKS_COMPARTIDOS}: la concurrencia entre sesiones NO se comprobó`
    : 'TABA_LOCKS_DIR sin definir: la concurrencia entre sesiones NO se comprobó');
} else {
  const enConflicto = [];
  for (const archivo of archivosLock) {
    if (archivo === MIO || !/\.(txt|lock)$/.test(archivo)) continue;
    const texto = await fs.readFile(path.join(LOCKS_COMPARTIDOS, archivo), 'utf8').catch(() => '');
    const activo = /STATUS=ACTIVO/i.test(texto);
    const tocaProduccion = /mutaci[oó]n(es)? de (datos de )?produc|aplicando a produc|APLICANDO EN wwcpogltfgzgkrlilbcd/i.test(texto);
    if (activo && tocaProduccion) enConflicto.push(archivo);
  }
  if (enConflicto.length) {
    abortar(`otra sesión declara estar mutando producción: ${enConflicto.join(', ')}. Coordinar antes de escribir.`);
  }
  ok(`${archivosLock.length} candados compartidos leídos, ninguno mutando producción`);
}

// ── 2. Identidad ─────────────────────────────────────────────────────────────
let sesionId = null;
if (!seco) {
  paso('SESIÓN');
  const usuario = await pedir('/auth/v1/user');
  ok(`${usuario.email} · uid ${usuario.id}`);
  if (EMAIL_ESPERADO && String(usuario?.email || '').toLowerCase() !== EMAIL_ESPERADO) {
    abortar(`la sesión es de ${usuario?.email} y se esperaba ${EMAIL_ESPERADO}.`);
  }

  /*
   * REGISTRAR LA SESIÓN. No es un trámite: es la condición de autorización.
   *
   * `identity_member_role` —de la que cuelga `has_business_role`, y de la que
   * cuelgan las cinco RPC de catálogo— exige desde la migración
   * `20260814030000_identity_requires_registered_session` que el `session_id`
   * del token exista como fila en `identity_sessions` para ESE usuario y ESE
   * negocio. Su propio comentario lo dice: «Missing, foreign, unregistered and
   * revoked sessions all have the same authorization result: no role.»
   *
   * Un login por `grant_type=password` contra la API crea la sesión en GoTrue
   * pero NO la registra. El Panel la registra: `supabase-auth.js` llama a
   * `identity_register_session` inmediatamente después de entrar. Una
   * herramienta que no lo hace nunca va a estar autorizada, por más owner que
   * sea la cuenta.
   *
   * Se usa la misma RPC que usa el Panel, con el mismo contrato. La sesión queda
   * auditada (`session_opened`) y revocable, y se revoca al terminar.
   */
  const registro = await rpc('identity_register_session', {
    p_app_version: 'catalog-image-pipeline',
    p_business_id: BUSINESS_ID,
    // El vocabulario admitido es rider_android | panel_web | unknown. Esto no es
    // el Panel: decir que lo es sería mentirle al registro de auditoría.
    p_client: 'unknown',
    p_device_key_hash: null,
    p_device_label: 'apply-association (herramienta de catálogo)',
  });
  if (registro?.ok !== true || !registro?.session_id) {
    abortar(
      `no se pudo registrar la sesión (${registro?.code || 'sin código'}). `
      + 'Sin sesión registrada la base no reconoce ningún rol, y ninguna RPC de catálogo va a autorizar.',
    );
  }
  sesionId = registro.session_id;
  ok(`sesión registrada · ${registro.new_session ? 'nueva' : 'ya existía'} · ${sesionId}`);

  /*
   * El rol, preguntado a la autoridad. Dos veces y por dos caminos: el que
   * devolvió el registro y el que devuelve `identity_member_role` ahora. Si no
   * coinciden, algo cambió entre una llamada y la otra y no es momento de
   * escribir.
   */
  const rolAhora = await rpc('identity_member_role', { target_business_id: BUSINESS_ID });
  if (String(rolAhora || '') !== String(registro.role || '')) {
    abortar(`el rol cambió entre el registro (${registro.role}) y la comprobación (${rolAhora}).`);
  }
  const veredicto = autorizaCatalogo(rolAhora);
  if (!veredicto.autorizado) abortar(veredicto.motivo);
  ok(`autorizado: ${veredicto.motivo}`);

  // Y la comprobación que hace la base misma, con la pareja exacta de roles que
  // exigen las RPC. Si esto diera false con un rol autorizado, el desacuerdo
  // sería entre nuestra lectura del contrato y el contrato.
  const segunLaBase = await rpc('has_business_role', {
    roles: [...ROLES_CATALOGO],
    target_business_id: BUSINESS_ID,
  });
  if (segunLaBase !== true) {
    abortar(`has_business_role(${ROLES_CATALOGO.join(',')}) dio ${segunLaBase} con rol ${veredicto.rol}. Contradicción: no se escribe.`);
  }
  ok(`has_business_role(${ROLES_CATALOGO.join(', ')}) confirma`);
}

// ── 3. Estado previo ─────────────────────────────────────────────────────────
paso('ESTADO PREVIO');
const manifiesto = JSON.parse(await fs.readFile(MANIFIESTO, 'utf8'));
const allowlist = JSON.parse(await fs.readFile(path.join(ROOT, 'catalog/image-source-allowlist.json'), 'utf8'));
const HOSTS_PERMITIDOS = new Set(allowlist.groups.flatMap((grupo) => grupo.cdnHosts.map((h) => h.toLowerCase())));
if (manifiesto.sources.length !== SKUS_OBJETIVO.length) abortar(`el manifiesto tiene ${manifiesto.sources.length} assets y se esperaban ${SKUS_OBJETIVO.length}.`);
for (const f of manifiesto.sources) {
  if (!OBJETIVOS.has(f.sku)) abortar(`el manifiesto trae un SKU inesperado: ${f.sku}`);
  if (f.rightsReference !== AUTORIDAD) abortar(`${f.sku} no cita ${AUTORIDAD}.`);
  /*
   * `distribuidor_oficial` entra desde la ampliación del alcance del
   * 2026-08-25, que el titular fijó al ordenar las fuentes de lanzamiento
   * (1 fabricante · 2 distribuidor oficial). Está escrita en
   * catalog/autorizaciones-comerciales.json → ampliaciones. La segunda
   * ampliación del 2026-08-25 habilita `proveedor_aprobado` sólo para assets
   * exactos, revisados y hashados; marketplaces siguen excluidos.
   */
  if (!['fabricante', 'marca', 'propio', 'distribuidor_oficial', 'proveedor_aprobado'].includes(f.sourceType)) {
    abortar(`${f.sku} viene de ${f.sourceType}, fuera del alcance de ${AUTORIDAD}.`);
  }
  /*
   * El host se contrasta contra la ALLOWLIST, que es donde la decisión ya está
   * escrita, y no contra dos sufijos de VTEX. Esos dos sufijos eran ciertos
   * cuando la única fuente conocida era la tienda de Andina; el día que entró
   * el packshot de otro embotellador —que no usa VTEX— este guion rechazó una
   * fuente que la allowlist sí permitía. Una regla duplicada en dos archivos es
   * una regla que se desincroniza.
   */
  const host = new URL(f.sourceUrl).hostname.toLowerCase();
  if (!HOSTS_PERMITIDOS.has(host)) {
    abortar(`${f.sku}: host de fuente inesperado (${host}). No está en catalog/image-source-allowlist.json.`);
  }
}
ok(`${manifiesto.sources.length} assets, de fuente permitida y citando la autoridad`);

/*
 * Assets ya registrados. Importa la diferencia entre «no existe» y «existe
 * igual»: `register_catalog_assets` sólo DESACTIVA los productos de un asset
 * cuando el asset existe y CAMBIÓ. Uno idéntico se reescribe sin consecuencias.
 * Distinguirlo es lo que permite volver a correr esto sin miedo.
 *
 * POR QUÉ NO SE COMPARAN LOS CONTEOS
 * ----------------------------------
 * La versión anterior exigía `previos.length === manifiesto.sources.length` y
 * llamaba «estado a medias» a cualquier otra cosa. Eso era cierto mientras el
 * lote no creciera nunca: con los cuatro packs de agosto ya registrados y el
 * manifiesto en diecinueve, el guion abortaba justamente en el caso para el que
 * más abajo existe el modo ALTA_PARCIAL. Los dos criterios vivían en el mismo
 * archivo y decían cosas distintas.
 *
 * Lo que de verdad hay que comprobar no es cuántos hay: es que ninguno de los
 * que YA ESTÁN vaya a cambiar. Un asset que falta es un alta —el caso normal
 * cuando el lote crece— y no tiene efecto sobre ningún producto existente. Un
 * asset que está y difiere sí lo tiene, y ése es el que aborta.
 */
let assetsIdenticos = false;
if (!seco) {
  const previos = await pedir(
    `/rest/v1/catalog_assets?select=external_id,sku,master_path,master_sha256,thumbnail_path,thumbnail_sha256,source_sha256,rights_status,rights_reference`
    + `&business_id=eq.${BUSINESS_ID}&order=sku.asc`,
  );
  const nuestros = new Set(manifiesto.sources.map((f) => f.externalId));
  const ajenos = previos.filter((a) => !nuestros.has(a.external_id));
  if (ajenos.length) {
    abortar(`hay ${ajenos.length} catalog_assets de otros productos. Este guion no sabe qué hacer con ellos.`);
  }
  const porExternal = new Map(previos.map((a) => [a.external_id, a]));
  const distintos = manifiesto.sources.filter((f) => {
    const a = porExternal.get(f.externalId);
    // Ausente = alta. No se compara con nada porque no hay nada que cambiar.
    if (!a) return false;
    return a.master_path !== f.assets.master.path
      || a.master_sha256 !== f.assets.master.sha256
      || a.thumbnail_path !== f.assets.thumbnail.path
      || a.thumbnail_sha256 !== f.assets.thumbnail.sha256
      || a.source_sha256 !== f.sourceSha256
      || a.rights_status !== f.rightsStatus
      || a.rights_reference !== f.rightsReference;
  });
  if (distintos.length) {
    abortar(
      `los ${distintos.length} asset(s) ya registrados NO coinciden con el manifiesto `
      + `(${distintos.map((f) => f.sku).join(', ')}). Registrarlos de nuevo sacaría de venta esos productos. `
      + 'Revisar a mano antes de seguir.',
    );
  }
  const altas = manifiesto.sources.length - previos.length;
  if (previos.length === 0) {
    ok('catalog_assets vacío: primera carga, sin efectos sobre productos existentes');
  } else if (altas === 0) {
    // Sólo cuando están TODOS registrados el reintento puede saltarse el import:
    // con altas pendientes hay filas que todavía no existen y hay que crearlas.
    assetsIdenticos = true;
    ok(`los ${previos.length} assets ya están registrados y son IDÉNTICOS al manifiesto: reintento seguro`);
  } else {
    ok(`${previos.length} assets ya registrados e idénticos · ${altas} altas nuevas`);
  }
}

const columnas = CAMPOS_ECO.concat([
  'presentation', 'capacity', 'available', 'is_verified', 'catalog_asset_id',
  'image_url', 'sold_as_pack', 'catalog_origin',
]).join(',');
const productos = await pedir(
  `/rest/v1/products?select=${columnas}&business_id=eq.${BUSINESS_ID}`
  + `&sku=in.(${SKUS_OBJETIVO.join(',')})&order=sku.asc`,
);
/*
 * El lote se valida contra la LISTA de objetivos, no contra un conteo.
 *
 * La versión anterior pedía «exactamente 4 productos con sold_as_pack» y se
 * rompió cuando una sesión de owner reveló el quinto pack legítimo del catálogo
 * —`quilmes-clasica-lata-473ml-pack-6`, que la clave publicable no ve porque el
 * alcohol está cerrado—. El catálogo puede tener 5, 20 o 200 packs y ninguno
 * tiene que ver con estas cuatro fotografías.
 */
const lote = validarLoteObjetivo({ assets: manifiesto.sources, productos });
/*
 * En seco se lee con la CLAVE PUBLICABLE, que no devuelve un producto oculto
 * (available = false). Un objetivo que hoy está fuera de venta se ve como
 * «falta el producto», y no falta: no se ve. La sesión de owner sí lo ve, así
 * que en la corrida real esto sigue siendo fatal y acá se dice y se sigue.
 * Cualquier otro error del lote aborta también en seco.
 */
const invisiblesEnSeco = seco ? lote.errores.filter((e) => e.startsWith('falta el producto objetivo')) : [];
const bloqueantes = lote.errores.filter((e) => !invisiblesEnSeco.includes(e));
for (const aviso of invisiblesEnSeco) info(`${aviso} La clave publicable no ve los productos ocultos; la sesión de owner sí.`);
if (bloqueantes.length) {
  for (const error of bloqueantes) console.error(`  FALLA ${error}`);
  abortar('el lote no es el declarado.');
}
ok(`los ${SKUS_OBJETIVO.length} objetivos existen y venden la cantidad que su fotografía anuncia`);

const porSkuManifiestoPrevio = new Map(manifiesto.sources.map((f) => [f.sku, f]));
const sinImagen = productos.filter((p) => p.catalog_asset_id === null && p.image_url === null);
const conImagenCorrecta = productos.filter((p) => {
  const f = porSkuManifiestoPrevio.get(p.sku);
  return Boolean(f) && p.image_url === f.assets.master.path && Boolean(p.catalog_asset_id);
});

for (const p of productos) {
  if (!OBJETIVOS.has(p.sku)) abortar(`producto inesperado: ${p.sku}`);
  if (p.catalog_origin !== 'commercial') abortar(`${p.sku} no es comercial (${p.catalog_origin}).`);
  if (!p.is_active) abortar(`${p.sku} no está activo.`);
  if (!(p.stock > 0)) abortar(`${p.sku} tiene stock 0: al republicar quedaría NO disponible.`);
}

/*
 * Dos estados de partida son legítimos, y ninguno más:
 *
 *   PRIMERA_CARGA  todos sin imagen, disponibles y verificados. El camino normal.
 *   ALTA_PARCIAL   unos ya con SU imagen y el resto sin ninguna. Es el estado
 *                  cuando el lote CRECE: los packs de agosto ya están y entran
 *                  las unidades sueltas nuevas.
 *   REPARACION     todos ya con SU imagen correcta. Pasa si un intento anterior
 *                  importó bien y falló al republicar: los productos quedan con
 *                  la foto puesta y FUERA DE VENTA. Reimportar no haría falta y
 *                  además los volvería a desverificar; lo único que falta es
 *                  republicarlos.
 *
 * Cualquier mezcla se para. Un catálogo a medias no se arregla adivinando.
 */
let modo;
/*
 * ALTA PARCIAL. Es el estado del 2026-08-25: los cuatro packs ya tienen su
 * fotografía aplicada desde agosto y el lote crece con diez unidades sueltas
 * que todavía no tienen ninguna.
 *
 * No es «un catálogo a medias». La condición es exacta y no admite grises: cada
 * producto del lote está en UNO de dos estados —su imagen correcta y su asset
 * registrado, o ninguna imagen— y la suma de los dos grupos es el lote entero.
 * Un producto con OTRA imagen, o con imagen sin asset, no entra en ninguno de
 * los dos y cae al aborto de siempre.
 *
 * Los que ya están se reescriben igual, con los mismos bytes: la operación es
 * idempotente por diseño y separar dos caminos de escritura para ahorrar cuatro
 * filas sería agregar la única parte que no está probada.
 *
 * Se cuenta contra los productos LEÍDOS y no contra el tamaño del lote: en seco
 * la clave publicable no devuelve los ocultos, y exigir el total convertiría
 * cualquier producto fuera de venta en un falso «estado a medias». Que estén
 * todos es una comprobación aparte, la de `validarLoteObjetivo`.
 */
const cubiertos = sinImagen.length + conImagenCorrecta.length;
const altaParcial = cubiertos === productos.length
  && sinImagen.length > 0
  && conImagenCorrecta.length > 0;

if (altaParcial) {
  for (const p of productos) {
    const yaTiene = conImagenCorrecta.some((q) => q.sku === p.sku);
    if (!yaTiene && (!p.available || !p.is_verified)) {
      abortar(`${p.sku} no está hoy disponible y verificado; el estado previo no es el esperado.`);
    }
    ok(`${etiqueta(p.sku)} · stock ${p.stock} · $${p.price} · ${yaTiene ? 'imagen ya puesta' : 'sin imagen'}`);
  }
  info(`alta parcial: ${sinImagen.length} altas nuevas sobre ${conImagenCorrecta.length} ya aplicadas`);
  if (seco) info('en seco no se puede confirmar catalog_assets; la sesión de owner sí lo hace');
  modo = 'ALTA_PARCIAL';
} else if (sinImagen.length === SKUS_OBJETIVO.length) {
  for (const p of productos) {
    if (!p.available || !p.is_verified) abortar(`${p.sku} no está hoy disponible y verificado; el estado previo no es el esperado.`);
    ok(`${etiqueta(p.sku)} · stock ${p.stock} · $${p.price} · disponible · sin imagen`);
  }
  modo = 'PRIMERA_CARGA';
} else if (conImagenCorrecta.length === SKUS_OBJETIVO.length && (assetsIdenticos || seco)) {
  // En seco no se puede confirmar el estado de `catalog_assets`: la clave
  // publicable no lo lee, y está bien que no lo lea. Se dice y se sigue, en vez
  // de abortar: si el dry-run se plantara acá, el envoltorio de PowerShell nunca
  // llegaría a pedir la contraseña, y justo la reparación es el momento en que
  // más falta hace poder correrlo.
  for (const p of productos) {
    ok(`${etiqueta(p.sku)} · stock ${p.stock} · $${p.price} · imagen ya puesta · ${p.available ? 'disponible' : 'FUERA DE VENTA'}`);
  }
  if (seco) info('en seco no se puede confirmar catalog_assets; la sesión de owner sí lo hace');
  modo = 'REPARACION';
} else {
  abortar(
    `estado a medias: ${sinImagen.length} sin imagen y ${conImagenCorrecta.length} con la imagen correcta, de ${SKUS_OBJETIVO.length}. `
    + 'Revisar a mano antes de escribir nada.',
  );
}
info(`modo: ${modo}`);
const estadoPrevio = Object.fromEntries(productos.map((p) => [p.sku, { ...p }]));

/*
 * LA DISPONIBILIDAD NO LA DECIDE ESTA OPERACIÓN.
 *
 * `publish_catalog_product` recibe la disponibilidad como parámetro y esto le
 * pasaba `true` sin mirar. Mientras el lote fueron cuatro packs que estaban los
 * cuatro a la venta, forzar `true` y conservar lo que había eran la misma cosa.
 * Dejaron de serlo el 2026-08-22, cuando la curación de lanzamiento sacó de la
 * góndola a `fanta-naranja-botella-pet-1500-ml-pack-x6` por una decisión
 * comercial escrita: precio fuera de escala, primer scroll, nueve litros de un
 * sabor de nicho. Volver a publicarlo con `true` habría revertido esa decisión
 * de costado, mientras se cambiaba una fotografía.
 *
 * Cambiar una imagen no es decidir qué se vende. Así que la disponibilidad que
 * se escribe es LA QUE EL PRODUCTO YA TENÍA.
 *
 * La regla entera —y por qué la reparación es la única excepción— vive en
 * `disponibilidadTrasPublicar`, que es pura y está probada sin red ni base.
 */
const disponibilidadObjetivo = new Map(productos.map((p) => [p.sku, disponibilidadTrasPublicar(p)]));
for (const [sku, disponible] of disponibilidadObjetivo) {
  if (!disponible) info(`${etiqueta(sku)} está fuera de venta por decisión comercial: se lo deja igual.`);
}

/*
 * Censo del catálogo ENTERO antes de escribir. No se usa para decidir nada: se
 * usa para poder demostrar después que lo que está fuera del lote quedó igual.
 * Sin una foto del antes, «no se movió nada» es una afirmación sin respaldo.
 */
const censoPrevio = await pedir(
  `/rest/v1/products?select=sku,price,stock,available,is_verified,is_active,sold_as_pack,units_per_pack,image_url,catalog_asset_id`
  + `&business_id=eq.${BUSINESS_ID}&order=sku.asc`,
);
const packsDelCatalogo = censoPrevio.filter((p) => p.sold_as_pack === true);
info(`catálogo: ${censoPrevio.length} productos · ${packsDelCatalogo.length} se venden como pack`);
for (const p of fueraDelLote(packsDelCatalogo)) {
  info(`  pack legítimo AJENO a este lote, no se toca: ${p.sku} (x${p.units_per_pack})`);
}

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

/*
 * QUÉ SE HACE ACÁ CON UN OBJETIVO QUE NO SE VE
 * --------------------------------------------
 * Los SKU que la clave publicable no devuelve ya quedaron identificados más
 * arriba y anunciados en voz alta: son productos fuera de venta, no productos
 * que falten. Este bloque los volvía a tratar como «falta el producto» y
 * abortaba el ensayo por la única razón que su propio mensaje declaraba
 * esperable. Y el ensayo no es decorativo: aplicar-asociacion.ps1 no pide la
 * contraseña si el ensayo no termina en verde, así que con un solo objetivo
 * oculto el lote no se podía aplicar nunca.
 *
 * En seco se saltean y se dicen, uno por uno. En la corrida real, donde la
 * sesión de owner SÍ los ve, que falte un producto sigue siendo fatal y no se
 * saltea nada: el payload de esa corrida lleva los 34.
 */
const invisiblesSku = new Set(
  invisiblesEnSeco
    .map((error) => error.match(/^falta el producto objetivo (.+).$/)?.[1])
    .filter(Boolean),
);
const productosPayload = assets.flatMap(({ sku }) => {
  const actual = porSku.get(sku);
  if (!actual) {
    if (seco && invisiblesSku.has(sku)) {
      info(`${sku}: oculto para la clave publicable, fuera del ensayo. La sesión de owner lo incluye.`);
      return [];
    }
    abortar(seco
      ? `no hay producto en producción para ${sku}, y no es uno de los ocultos que el lote ya `
        + 'identificó. Esto no lo explica la visibilidad: el objetivo no está en el catálogo.'
      : `no hay producto en producción para ${sku}.`);
  }
  const fila = {};
  for (const campo of CAMPOS_ECO) fila[campo] = actual[campo];
  return [fila];
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
info('la disponibilidad se restituye a la que cada producto ya tenía: no se decide acá.');
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
let importado = modo === 'REPARACION';
const republicados = [];
const fallos = [];
if (modo === 'REPARACION') {
  info('modo REPARACIÓN: los assets y las imágenes ya están puestos.');
  info('NO se reimporta —eso los desverificaría de nuevo—; sólo se republica.');
} else {
  try {
    await rpc('import_catalog_batch', {
      p_assets: assets,
      p_business_id: BUSINESS_ID,
      p_products: productosPayload,
    });
    importado = true;
    ok(`import_catalog_batch: ${assets.length} assets registrados y ${productosPayload.length} productos con su imagen`);
    info(`los ${productosPayload.length} quedaron desverificados y fuera de venta, como manda el disparador`);
  } catch (error) {
    fallos.push(`import_catalog_batch: ${error.message}`);
    console.error(`  FALLA ${error.message}`);
  }
}

// Republicar SIEMPRE que el import haya entrado. Si esto no corre, los packs
// quedan fuera de venta, y eso es peor que el error que lo trajo hasta acá.
if (importado) {
  for (const { sku } of assets) {
    try {
      const [publicado] = await rpc('publish_catalog_product', {
        p_available: disponibilidadObjetivo.get(sku) === true,
        p_business_id: BUSINESS_ID,
        p_external_id: sku,
      });
      republicados.push(publicado);
      ok(`${etiqueta(sku)}: verificado y ${publicado.published_available ? 'DISPONIBLE' : 'NO disponible'}`);
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
const objetivosDespues = despues.filter((p) => OBJETIVOS.has(p.sku));
const conImagen = objetivosDespues.filter((p) => p.image_url);
const comprobaciones = [];
const exigir = (condicion, mensaje) => {
  comprobaciones.push({ ok: Boolean(condicion), mensaje });
  console.log(`  ${condicion ? 'OK   ' : 'FALLA'} ${mensaje}`);
};

// El total no se compara contra un número escrito a mano —que envejece con el
// catálogo— sino contra lo que había antes de escribir.
exigir(despues.length === censoPrevio.length, `el catálogo sigue teniendo ${censoPrevio.length} productos (hay ${despues.length})`);
exigir(conImagen.length === SKUS_OBJETIVO.length, `${SKUS_OBJETIVO.length} objetivos con imagen productiva (hay ${conImagen.length})`);
exigir(
  despues.length - conImagen.length === censoPrevio.length - SKUS_OBJETIVO.length,
  `${despues.length - conImagen.length} productos con el recurso propio de TABA`,
);

/*
 * Nada fuera del lote se movió. Es la comprobación que le da sentido a elegir el
 * conjunto por lista: si tocar cuatro productos moviera un quinto, la lista sería
 * decorativa. Incluye al pack de Quilmes, que es un pack legítimo y no es de este
 * lote.
 */
const censoPrevioPorSku = new Map(censoPrevio.map((p) => [p.sku, p]));
const ajenosMovidos = [];
for (const p of fueraDelLote(despues)) {
  const antes = censoPrevioPorSku.get(p.sku);
  if (!antes) { ajenosMovidos.push(`${p.sku}: apareció un producto que antes no estaba`); continue; }
  for (const campo of ['price', 'stock', 'available', 'is_verified', 'is_active', 'sold_as_pack', 'image_url', 'catalog_asset_id']) {
    if (JSON.stringify(p[campo]) !== JSON.stringify(antes[campo])) {
      ajenosMovidos.push(`${p.sku}.${campo}: ${JSON.stringify(antes[campo])} -> ${JSON.stringify(p[campo])}`);
    }
  }
}
exigir(ajenosMovidos.length === 0, `los ${censoPrevio.length - SKUS_OBJETIVO.length} productos fuera del lote quedaron intactos`);
for (const movido of ajenosMovidos) console.error(`        ${movido}`);

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
  // La misma regla que decidió con qué disponibilidad se republicó: un producto
  // que estaba fuera de la góndola tiene que seguir afuera, con su foto puesta.
  const vuelveAVenta = disponibilidadObjetivo.get(p.sku) === true;
  exigir(
    p.is_verified === true && p.available === vuelveAVenta,
    `${p.sku}: verificado y ${vuelveAVenta ? 'de vuelta en venta' : 'fuera de venta, como estaba'}`,
  );
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
  exigir(p.is_active === previo.is_active, `${p.sku}: is_active intacto`);
  // Contra la disponibilidad que esta operación DEBÍA dejar —la que el producto
  // ya tenía, salvo el caso de reparación—, no contra un `true` escrito a mano.
  const esperada = disponibilidadObjetivo.get(p.sku) === true;
  exigir(
    p.available === esperada,
    `${p.sku}: quedó ${esperada ? 'DISPONIBLE' : 'fuera de venta, como estaba'}`,
  );
}

const assetsRegistrados = await pedir(`/rest/v1/catalog_assets?select=sku,rights_status,rights_reference,source_url&business_id=eq.${BUSINESS_ID}&order=sku.asc`);
exigir(assetsRegistrados.length === SKUS_OBJETIVO.length, `${SKUS_OBJETIVO.length} catalog_assets registrados (hay ${assetsRegistrados.length})`);
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

if (sesionId) {
  // La sesión se abrió para esta operación y se cierra con ella. Dejarla viva
  // sería dejar una llave puesta.
  try {
    const cierre = await rpc('identity_revoke_session', { p_session_id: sesionId });
    ok(`sesión revocada (${cierre?.code || 'sin código'})`);
  } catch (error) {
    console.error(`  OJO   no se pudo revocar la sesión: ${error.message}`);
    console.error('        revocarla desde el Panel, o esperar a que caduque.');
  }
}

paso('RESULTADO');
console.log(`  informe: ${path.relative(ROOT, INFORME).replaceAll('\\', '/')}`);
if (fallos.length || rotas.length) {
  console.error(`  ${fallos.length} error(es) de escritura · ${rotas.length} comprobación(es) rota(s)`);
  process.exit(1);
}
console.log('  ASOCIACION APLICADA Y VERIFICADA');
