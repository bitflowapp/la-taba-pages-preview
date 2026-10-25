/*
 * PREPARACIÓN COMERCIAL DE LA VITRINA — qué está completo, qué está en demostración
 * y qué espera una decisión del dueño. No inventa datos y no modifica ninguno.
 *
 * Por qué existe
 * --------------
 * La vitrina de Neuquén (52 SKU, 42 con foto) es un catálogo DEMOSTRATIVO: que
 * un producto se vea completo en pantalla no dice que su precio, su stock o su
 * foto estén aprobados para vender. Hasta hoy esa diferencia vivía repartida en
 * seis archivos (góndola, vitrina generada, propuesta de precios, manifiesto de
 * imágenes, registro de autorizaciones y registro de fotos editoriales) y nadie
 * los cruzaba.
 *
 * Qué mide, por SKU
 * -----------------
 *  · identidad y venta: nombre, marca, rubro, variante, presentación, contenido
 *    neto con su unidad, envase, unidad de venta (suelto / pack) y que el pack
 *    cierre con sus unidades; alcohol ⇒ mayores de 18 y confirmación de edad;
 *  · precio: el de la vitrina, el de la góndola y el de la propuesta coinciden;
 *    cae en múltiplo de $50 y no baja del piso de margen; de dónde sale el costo
 *    (medido o DERIVADO) y cuánto hace que se midió. Los 14 conflictos de margen
 *    y los 6 pendientes de comparación se REPORTAN: nunca se convierten en rebaja;
 *  · foto: archivo, formato, dimensiones, hash contra el manifiesto, relación de
 *    aspecto (sin estirar), mínimo de resolución, que el archivo pertenezca al
 *    SKU (el nombre lo lleva) y que su derecho esté declarado: estado, referencia
 *    y tipo de fuente dentro del alcance de la autorización vigente;
 *  · stock: confirmado por el comercio o no.
 *
 * Qué NO hace: aprobar. No existe en ningún archivo una aprobación por SKU del
 * dueño, así que ningún producto sale «listo para vender»: sale
 * «completo, pendiente de aprobación», con la lista de lo que falta. `--strict`
 * (para un release real) falla mientras quede algo pendiente.
 *
 * Uso:
 *   node scripts/catalog-commercial-readiness.mjs            informe en consola, sale 1 sólo con defectos técnicos
 *   node scripts/catalog-commercial-readiness.mjs --json     JSON a stdout
 *   node scripts/catalog-commercial-readiness.mjs --write    escribe docs/catalog/readiness-vitrina-neuquen.{json,md}
 *   node scripts/catalog-commercial-readiness.mjs --strict   además falla si hay aprobaciones pendientes
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIN_MASTER_PX = 600;
const UNIDADES_VALIDAS = new Set(['ml', 'l', 'cc', 'g', 'kg']);
const DIA_MS = 86_400_000;

export const ESTADO_CATALOGO = Object.freeze({
  COMPLETO_CON_FOTO: 'COMPLETO_CON_FOTO',
  COMPLETO_SIN_FOTO: 'COMPLETO_SIN_FOTO',
  INCOMPLETO: 'INCOMPLETO',
  DEFECTUOSO: 'DEFECTUOSO',
});

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

function alcanceVigente(autorizaciones, referencia) {
  const autorizacion = (autorizaciones?.autorizaciones || []).find((item) => item.id === referencia);
  if (!autorizacion) return null;
  const tipos = new Set(autorizacion.habilita_source_types || []);
  for (const ampliacion of autorizacion.ampliaciones || []) {
    for (const tipo of ampliacion.habilita_source_types || []) tipos.add(tipo);
  }
  return {
    id: autorizacion.id,
    estado: autorizacion.estado,
    tipos,
    habilitaDerechos: autorizacion.habilita_rights_status,
    evidenciaDocumentalPendiente: autorizacion.evidencia_documental?.pendiente === true,
  };
}

function revisarIdentidad(gondola, vitrina) {
  const problemas = [];
  const faltan = (campo, valor) => { if (valor === undefined || valor === null || String(valor).trim() === '') problemas.push(`falta ${campo}`); };
  faltan('marca', gondola.brand);
  faltan('nombre', gondola.name);
  faltan('rubro', gondola.category);
  faltan('variante', gondola.variant);
  faltan('envase', gondola.packagingType);
  if (!(Number(gondola.capacityValue) > 0)) problemas.push('contenido neto inválido');
  if (!UNIDADES_VALIDAS.has(String(gondola.capacityUnit || ''))) problemas.push(`unidad de contenido inválida (${gondola.capacityUnit})`);
  const esperado = `${gondola.capacityValue} ${gondola.capacityUnit}`;
  if (vitrina && vitrina.capacity !== esperado) problemas.push(`capacidad de la vitrina «${vitrina.capacity}» ≠ «${esperado}»`);

  const unidades = Number(gondola.unitsPerPack || 1);
  const pack = gondola.soldAsPack === true;
  if (pack && !(unidades > 1)) problemas.push('se vende como pack pero sin unidades por pack');
  if (!pack && unidades !== 1) problemas.push('se vende suelto pero declara varias unidades');
  if (vitrina) {
    if ((vitrina.unit === 'pack') !== pack) problemas.push(`unidad de venta de la vitrina («${vitrina.unit}») no coincide con la góndola`);
    if (Number(vitrina.unitsPerPack || 1) !== unidades) problemas.push('unidades por pack de la vitrina no coinciden con la góndola');
  }
  const skuDicePack = /-pack-\d+/.test(gondola.sku);
  if (skuDicePack !== pack) problemas.push('el SKU y la unidad de venta no coinciden (pack/suelto)');

  if (gondola.alcoholic) {
    if (!(Number(gondola.minimumAge) >= 18)) problemas.push('alcohol sin edad mínima de 18');
    if (vitrina && vitrina.requiresAgeConfirmation !== true) problemas.push('alcohol sin confirmación de edad en la vitrina');
  } else if (gondola.minimumAge && Number(gondola.minimumAge) >= 18) {
    problemas.push('edad mínima declarada en un producto sin alcohol');
  }
  return problemas;
}

function revisarPrecio({ gondola, vitrina, propuesta, precioDeVenta }) {
  const problemas = [];
  const avisos = [];
  const vigente = Number(gondola.price);
  if (!(vigente > 0)) problemas.push('precio vigente inválido');
  if (vitrina && Number(vitrina.price) !== vigente) problemas.push(`precio de la vitrina ${vitrina.price} ≠ góndola ${vigente}`);
  if (propuesta && Number(propuesta.precioVigenteTABA) !== vigente) problemas.push(`precio vigente de la propuesta ${propuesta.precioVigenteTABA} ≠ góndola ${vigente}`);
  if (!propuesta) problemas.push('el SKU no figura en la propuesta de precios');
  if (vigente % 50 !== 0) problemas.push('el precio no cae en múltiplo de $50');
  const piso = precioDeVenta({ costoMayorista: gondola.costoMayorista, unitsPerPack: gondola.unitsPerPack, soldAsPack: gondola.soldAsPack });
  if (vigente < piso) problemas.push(`precio ${vigente} por debajo del piso de margen ${piso}`);
  if (vigente !== piso) avisos.push(`precio ${vigente} distinto del que da el criterio (${piso}): ajuste manual`);

  if (gondola.derivado) avisos.push('costo DERIVADO (no medido el día del relevamiento)');
  return {
    vigente,
    pisoMargen: piso,
    propuestaEstado: propuesta?.estado || null,
    propuestaPrecio: propuesta?.precioPropuesto ?? null,
    comparador: propuesta ? { tienda: propuesta.tiendaMasBarata, precio: propuesta.comparadorMasBarato, coincidencia: propuesta.tipoCoincidencia } : null,
    costoDerivado: Boolean(gondola.derivado),
    antiguedadCostoDias: null,
    problemas,
    avisos,
  };
}

async function revisarFoto({ vitrina, fuenteManifiesto, alcance, hostsRechazados, inspeccionar, leer }) {
  const problemas = [];
  const avisos = [];
  if (!vitrina.image) {
    return {
      estado: 'SIN_FOTO',
      problemas,
      avisos: [vitrina.imagePendiente ? 'sin foto autorizada: la tarjeta muestra el placeholder propio' : 'sin foto y sin marca de «imagen pendiente»'],
      derechos: null,
    };
  }
  if (vitrina.imagePendiente) problemas.push('declara foto y también «imagen pendiente»');

  const archivos = [['master', vitrina.image, vitrina.imageSha256], ['thumbnail', vitrina.imageThumbnail, vitrina.imageThumbnailSha256]];
  for (const [rol, ruta, hashDeclarado] of archivos) {
    if (!ruta) { problemas.push(`falta ${rol}`); continue; }
    let buffer;
    try { buffer = await leer(ruta); } catch { problemas.push(`${rol}: el archivo no existe (${ruta})`); continue; }
    if (!/\.webp$/i.test(ruta)) problemas.push(`${rol}: no es webp`);
    if (sha256(buffer) !== hashDeclarado) problemas.push(`${rol}: el hash del archivo no coincide con el declarado`);
    const asset = fuenteManifiesto?.assets?.[rol];
    if (!asset) problemas.push(`${rol}: no figura en el manifiesto de imágenes`);
    else if (asset.sha256 !== hashDeclarado) problemas.push(`${rol}: el hash difiere del manifiesto`);
    const meta = await inspeccionar(buffer);
    if (rol === 'master') {
      if (meta.width < MIN_MASTER_PX || meta.height < MIN_MASTER_PX) problemas.push(`master de ${meta.width}×${meta.height}: por debajo de ${MIN_MASTER_PX}px (se vería pixelada)`);
      if (Math.abs(meta.width - meta.height) > 2) problemas.push(`master ${meta.width}×${meta.height}: no es cuadrado, se estiraría en la tarjeta`);
      if (vitrina.imageWidth && (vitrina.imageWidth !== meta.width || vitrina.imageHeight !== meta.height)) problemas.push('dimensiones declaradas ≠ reales');
    } else if (meta.width !== meta.height) problemas.push(`miniatura ${meta.width}×${meta.height}: no es cuadrada`);
    if (ruta && !path.basename(ruta).startsWith(vitrina.sku)) problemas.push(`${rol}: el nombre del archivo no pertenece al SKU`);
  }

  // Derechos: estado + referencia + tipo de fuente dentro del alcance vigente.
  const derechos = { estado: vitrina.rightsStatus, referencia: vitrina.imageRightsReference, tipoFuente: vitrina.imageSourceType, fuente: vitrina.imageSourceUrl || null };
  if (vitrina.rightsStatus !== 'LICENCIA_COMERCIAL') problemas.push(`derechos «${vitrina.rightsStatus}»: no habilitan publicar`);
  if (!alcance) problemas.push(`la referencia «${vitrina.imageRightsReference}» no existe en el registro de autorizaciones`);
  else {
    if (!alcance.tipos.has(vitrina.imageSourceType)) problemas.push(`tipo de fuente «${vitrina.imageSourceType}» fuera del alcance de ${alcance.id}`);
    if (alcance.habilitaDerechos !== vitrina.rightsStatus) problemas.push('el estado de derechos no es el que habilita la autorización');
    if (alcance.evidenciaDocumentalPendiente) avisos.push(`autorización ${alcance.id} «${alcance.estado}»: falta el documento del acuerdo`);
  }
  if (fuenteManifiesto?.sourceUrl) {
    try {
      const host = new URL(fuenteManifiesto.sourceUrl).hostname;
      if (hostsRechazados.some((rechazado) => host === rechazado || host.endsWith(`.${rechazado}`))) problemas.push(`la fuente (${host}) está entre los hosts rechazados`);
      if (!/^https:/.test(fuenteManifiesto.sourceUrl)) problemas.push('la fuente no es https');
    } catch { problemas.push('la URL de la fuente no es válida'); }
  } else problemas.push('el manifiesto no declara la fuente de la imagen');
  if (fuenteManifiesto && fuenteManifiesto.rightsReference !== vitrina.imageRightsReference) problemas.push('la referencia de derechos de la vitrina difiere del manifiesto');
  if (vitrina.vitrinaCobertura === 'MANIFIESTO_PREPARADO') avisos.push('la foto no está contrastada con el mapa auditado de producción');

  return { estado: problemas.length ? 'DEFECTUOSA' : 'AUTORIZADA_DECLARADA', problemas, avisos, derechos, clasificacion: vitrina.imageClasificacion || null };
}

export async function evaluarCatalogo({
  gondola, vitrina, propuesta, manifiesto, autorizaciones, hostsRechazados = [], precioDeVenta,
  inspeccionar, leer, hoy = new Date(), costoMedidoEl = null,
}) {
  const propuestaPorSku = new Map((propuesta?.filas || []).map((fila) => [fila.sku, fila]));
  const vitrinaPorSku = new Map(vitrina.map((p) => [p.sku, p]));
  const fuentePorSku = new Map((manifiesto?.sources || []).map((s) => [s.externalId || s.sku, s]));
  const antiguedad = costoMedidoEl ? Math.floor((hoy.getTime() - new Date(costoMedidoEl).getTime()) / DIA_MS) : null;

  const filas = [];
  for (const g of gondola) {
    const v = vitrinaPorSku.get(g.sku) || null;
    const identidad = revisarIdentidad(g, v);
    if (!v) identidad.push('el SKU no está en la vitrina');
    const precio = revisarPrecio({ gondola: g, vitrina: v, propuesta: propuestaPorSku.get(g.sku), precioDeVenta });
    precio.antiguedadCostoDias = antiguedad;
    const alcance = v?.imageRightsReference ? alcanceVigente(autorizaciones, v.imageRightsReference) : null;
    const foto = v ? await revisarFoto({ vitrina: v, fuenteManifiesto: fuentePorSku.get(g.sku), alcance, hostsRechazados, inspeccionar, leer }) : { estado: 'SIN_FOTO', problemas: [], avisos: [], derechos: null };

    const defectos = [...identidad, ...precio.problemas, ...foto.problemas];
    let estado;
    if (defectos.length) estado = identidad.length && !precio.problemas.length && !foto.problemas.length ? ESTADO_CATALOGO.INCOMPLETO : ESTADO_CATALOGO.DEFECTUOSO;
    else estado = foto.estado === 'SIN_FOTO' ? ESTADO_CATALOGO.COMPLETO_SIN_FOTO : ESTADO_CATALOGO.COMPLETO_CON_FOTO;

    // Lo que impide vender hoy, SKU por SKU. Nada de esto lo decide el código.
    const pendientes = [];
    pendientes.push('precio sin aprobación explícita del dueño (la propuesta está «pendiente_aprobacion_comercial»)');
    if (v?.stockStatus === 'BUSINESS_CONFIRMATION_REQUIRED' || v?.requiresBusinessConfirmation) pendientes.push('stock sin confirmar por el comercio');
    if (foto.estado === 'SIN_FOTO') pendientes.push('sin foto autorizada (placeholder propio)');
    if (foto.estado === 'AUTORIZADA_DECLARADA' && foto.avisos.some((a) => /falta el documento/.test(a))) pendientes.push('foto con autorización declarada pero sin el documento del acuerdo');
    if (precio.propuestaEstado === 'conflicto_margen') pendientes.push('conflicto de margen en la propuesta de precios: decisión del dueño (no se rebaja)');
    if (String(precio.propuestaEstado || '').startsWith('pendiente')) pendientes.push('precio pendiente de comparación con el mercado');
    if (precio.costoDerivado) pendientes.push('el costo detrás del precio es derivado, no medido');

    filas.push({
      sku: g.sku,
      nombre: g.name.toLowerCase().startsWith(String(g.brand).toLowerCase()) ? g.name : `${g.brand} ${g.name}`,
      rubro: g.category,
      presentacion: `${g.capacity} · ${g.packagingType}${g.soldAsPack ? ` · pack x${g.unitsPerPack}` : ''}`,
      alcohol: Boolean(g.alcoholic),
      estadoCatalogo: estado,
      defectos,
      identidad,
      precio,
      foto,
      aprobacionComercial: 'PENDIENTE',
      listoParaVender: false,
      pendientes,
    });
  }

  const contar = (fn) => filas.filter(fn).length;
  return {
    totalSku: filas.length,
    resumen: {
      porEstado: Object.fromEntries(Object.values(ESTADO_CATALOGO).map((e) => [e, contar((f) => f.estadoCatalogo === e)])),
      fotos: { autorizadaDeclarada: contar((f) => f.foto.estado === 'AUTORIZADA_DECLARADA'), sinFoto: contar((f) => f.foto.estado === 'SIN_FOTO'), defectuosa: contar((f) => f.foto.estado === 'DEFECTUOSA') },
      precios: {
        mantieneVigente: contar((f) => f.precio.propuestaEstado === 'mantiene_vigente'),
        conflictoMargen: contar((f) => f.precio.propuestaEstado === 'conflicto_margen'),
        pendienteComparacion: contar((f) => String(f.precio.propuestaEstado || '').startsWith('pendiente')),
        costoDerivado: contar((f) => f.precio.costoDerivado),
        antiguedadCostoDias: antiguedad,
      },
      alcohol: contar((f) => f.alcohol),
      listosParaVender: contar((f) => f.listoParaVender),
      aprobacionComercialPendiente: contar((f) => f.aprobacionComercial === 'PENDIENTE'),
      defectosTecnicos: contar((f) => f.defectos.length > 0),
    },
    filas,
  };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */

function tablaMarkdown(resultado, { registroEditorial, generadoEl }) {
  const r = resultado.resumen;
  const l = [];
  l.push('# Preparación comercial de la vitrina Neuquén', '');
  l.push(`Generado por \`scripts/catalog-commercial-readiness.mjs\` el ${generadoEl}. No modifica ningún dato comercial.`, '');
  l.push('> **Ningún producto está «listo para vender».** La vitrina es demostrativa: el dueño todavía no aprobó los precios por SKU, el stock está sin confirmar y falta el documento del acuerdo que respalda las fotos. Este informe separa lo técnicamente completo de lo que espera una decisión.', '');
  l.push('## Resumen', '');
  l.push(`| | |`, `|---|---|`);
  l.push(`| SKU evaluados | ${resultado.totalSku} |`);
  l.push(`| Completos con foto autorizada (declarada) | ${r.porEstado.COMPLETO_CON_FOTO} |`);
  l.push(`| Completos sin foto (placeholder propio) | ${r.porEstado.COMPLETO_SIN_FOTO} |`);
  l.push(`| Incompletos / defectuosos | ${r.porEstado.INCOMPLETO + r.porEstado.DEFECTUOSO} |`);
  l.push(`| Precio: mantiene vigente / conflicto de margen / pendiente de comparación | ${r.precios.mantieneVigente} / ${r.precios.conflictoMargen} / ${r.precios.pendienteComparacion} |`);
  l.push(`| Costo derivado (no medido) | ${r.precios.costoDerivado} |`);
  l.push(`| Antigüedad del costo mayorista | ${r.precios.antiguedadCostoDias ?? 's/d'} días |`);
  l.push(`| Productos con alcohol (+18) | ${r.alcohol} |`);
  l.push(`| Aprobación comercial pendiente | ${r.aprobacionComercialPendiente} de ${resultado.totalSku} |`, '');
  l.push('## Qué tiene que decidir o aportar el responsable del negocio', '');
  l.push('1. **Aprobar precios por SKU.** Los 14 «conflicto de margen» y los 6 «pendiente de comparación» **no se tocaron**: los precios vigentes se conservan tal cual.');
  l.push('2. **Confirmar stock** de los 52 (hoy `BUSINESS_CONFIRMATION_REQUIRED`).');
  l.push('3. **Documentar el acuerdo de fotos** (`TABA-AUT-2026-08-001` y sus ampliaciones están «declaradas»; falta el documento o el paquete de packshots de cada marca).');
  l.push('4. **Aportar o aprobar fotos** de los SKU sin foto, o aceptar el placeholder propio.');
  if (registroEditorial) {
    const sin = registroEditorial.piezas.filter((p) => p.estado === 'NO_DOCUMENTADOS').length;
    l.push(`5. **Fotografía editorial** (banners, hero, historias): ${sin} piezas de terceros sin autorización comercial documentada. En producción no se publican hasta que se completen en \`docs/catalog/promo-rights.json\` y \`js/core/promo-rights.js\`.`);
  }
  l.push('', '## Detalle por SKU', '');
  l.push('| SKU | Presentación | Estado | Foto | Precio vigente | Propuesta | Pendientes |', '|---|---|---|---|---:|---|---|');
  for (const f of resultado.filas) {
    l.push(`| \`${f.sku}\` | ${f.presentacion} | ${f.estadoCatalogo} | ${f.foto.estado} | $ ${f.precio.vigente.toLocaleString('es-AR')} | ${f.precio.propuestaEstado || '—'} | ${f.pendientes.length} |`);
  }
  const defectuosos = resultado.filas.filter((f) => f.defectos.length);
  if (defectuosos.length) {
    l.push('', '## Defectos técnicos', '');
    for (const f of defectuosos) l.push(`- \`${f.sku}\`: ${f.defectos.join('; ')}`);
  }
  l.push('');
  return l.join('\n');
}

/** Carga los archivos reales del repo (sin red ni base de datos). */
export async function cargarDatosReales() {
  const leerJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  const { GONDOLA, precioDeVenta, CRITERIO_PRECIO } = await import(pathToFileURL(path.join(ROOT, 'catalog/gondola-neuquen.mjs')).href);
  const { products } = await import(pathToFileURL(path.join(ROOT, 'js/vitrina-neuquen-20261024.js')).href);
  const sharp = (await import('sharp')).default;
  const allowlist = leerJson('catalog/image-source-allowlist.json');
  const hostsRechazados = Array.isArray(allowlist.rejectedHosts) ? allowlist.rejectedHosts.map((h) => (typeof h === 'string' ? h : h.host || h.domain)).filter(Boolean) : Object.keys(allowlist.rejectedHosts || {});
  return {
    gondola: GONDOLA,
    vitrina: products,
    propuesta: leerJson('artifacts/catalog-pricing-images-20261024/propuesta-precios.json'),
    manifiesto: leerJson('docs/catalog/image-manifest.json'),
    autorizaciones: leerJson('catalog/autorizaciones-comerciales.json'),
    registroEditorial: leerJson('docs/catalog/promo-rights.json'),
    hostsRechazados,
    precioDeVenta,
    costoMedidoEl: CRITERIO_PRECIO.medidoEl,
    leer: async (rel) => fs.readFileSync(path.join(ROOT, rel)),
    inspeccionar: async (buffer) => { const m = await sharp(buffer).metadata(); return { width: m.width, height: m.height, format: m.format }; },
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const datos = await cargarDatosReales();
  const resultado = await evaluarCatalogo(datos);
  const generadoEl = new Date().toISOString().slice(0, 10);
  const args = new Set(process.argv.slice(2));
  if (args.has('--json')) {
    console.log(JSON.stringify({ generadoEl, ...resultado }, null, 2));
  } else if (args.has('--write')) {
    const dir = path.join(ROOT, 'docs/catalog');
    fs.writeFileSync(path.join(dir, 'readiness-vitrina-neuquen.json'), `${JSON.stringify({ generadoEl, ...resultado }, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'readiness-vitrina-neuquen.md'), tablaMarkdown(resultado, { registroEditorial: datos.registroEditorial, generadoEl }));
    console.log('escrito docs/catalog/readiness-vitrina-neuquen.{json,md}');
  }
  const r = resultado.resumen;
  console.log(`SKU ${resultado.totalSku} · completos con foto ${r.porEstado.COMPLETO_CON_FOTO} · sin foto ${r.porEstado.COMPLETO_SIN_FOTO} · incompletos ${r.porEstado.INCOMPLETO} · defectuosos ${r.porEstado.DEFECTUOSO}`);
  console.log(`precios: mantiene ${r.precios.mantieneVigente} · conflicto de margen ${r.precios.conflictoMargen} · pendiente de comparación ${r.precios.pendienteComparacion} · costo derivado ${r.precios.costoDerivado} · costo medido hace ${r.precios.antiguedadCostoDias} días`);
  console.log(`listos para vender: ${r.listosParaVender} de ${resultado.totalSku} (aprobación comercial pendiente: ${r.aprobacionComercialPendiente})`);
  for (const f of resultado.filas.filter((fila) => fila.defectos.length)) console.error(`  ✖ ${f.sku}: ${f.defectos.join('; ')}`);
  if (r.defectosTecnicos > 0) process.exit(1);
  if (args.has('--strict') && r.aprobacionComercialPendiente > 0) {
    console.error('--strict: hay aprobaciones comerciales pendientes; la vitrina no está lista para vender.');
    process.exit(2);
  }
}
