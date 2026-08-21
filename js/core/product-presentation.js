/*
 * La línea de presentación de una tarjeta de góndola, dicha como la lee una
 * persona: capacidad primero, variante sólo si agrega información.
 *
 * POR QUÉ EXISTE (auditoría de UX del 2026-08-21, hallazgo A2): 29 de las 33
 * tarjetas visibles no decían el litraje. La base exige `presentation =
 * variant`, así que la tarjeta imprimía «Original» o «Sin azúcar» —la
 * variedad— y la Coca-Cola de 2,25 L y la lata de 354 ml quedaban idénticas
 * salvo el precio. Con la góndola final el problema se multiplica: dos
 * «Coca-Cola Original» (2,25 L y 1,5 L) conviven a propósito.
 *
 * También es el lugar donde el slug de envase deja de filtrarse a la pantalla:
 * «botella-pet» es vocabulario de base de datos; la góndola dice «Botella PET».
 *
 * Este módulo es puro: recibe datos, devuelve texto. Sin DOM, sin estado.
 */

const PACKAGING_LABELS = Object.freeze({
  'botella-pet': 'Botella PET',
  'botella-vidrio': 'Botella de vidrio',
  botella: 'Botella',
  lata: 'Lata',
  sifon: 'Sifón',
  'sifon-pet': 'Sifón',
  tetra: 'Tetra',
  'tetra-pak': 'Tetra',
  pouch: 'Pouch',
});

/**
 * «1500 ml» → «1,5 L» · «473 ml» → «473 ml» · «2250 ml» → «2,25 L» ·
 * «2000 ml» → «2 L». Los litros usan coma decimal (es-AR) y sin ceros colgando.
 */
export function formatCapacity(value, unit = 'ml') {
  const cantidad = Number(value);
  if (!Number.isFinite(cantidad) || cantidad <= 0) return '';
  const unidad = String(unit || 'ml').trim().toLowerCase();
  if (unidad === 'l') return `${formatLiters(cantidad)} L`;
  if (unidad !== 'ml') return `${trimNumber(cantidad)} ${unidad}`;
  if (cantidad >= 1000) return `${formatLiters(cantidad / 1000)} L`;
  return `${trimNumber(cantidad)} ml`;
}

function formatLiters(litros) {
  const texto = litros.toFixed(2).replace(/\.?0+$/, '');
  return texto.replace('.', ',');
}

function trimNumber(valor) {
  return String(Number(valor.toFixed(2)));
}

/** «botella-pet» → «Botella PET»; un slug desconocido se capitaliza sin guiones. */
export function packagingLabel(slug) {
  const clave = String(slug || '').trim().toLowerCase();
  if (!clave) return '';
  if (PACKAGING_LABELS[clave]) return PACKAGING_LABELS[clave];
  const palabras = clave.split('-').filter(Boolean).join(' ');
  return palabras ? palabras.charAt(0).toUpperCase() + palabras.slice(1) : '';
}

function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La línea de la tarjeta.
 *
 *   unidad:  «1,5 L» · «2,25 L · Sin azúcar» (la variante entra sólo si el
 *            nombre no la dice ya)
 *   pack:    «Pack x6 · 473 ml» (la capacidad es LA DE CADA ENVASE, que es la
 *            convención vigente del catálogo)
 *
 * Sin capacidad conocida cae a la variante sola, que era el comportamiento
 * anterior: nunca peor que antes.
 */
export function cardPresentationLine(product = {}) {
  const capacidad = formatCapacity(
    product.capacityValue ?? product.capacity_value,
    product.capacityUnit ?? product.capacity_unit ?? 'ml',
  );
  const porPack = Number(product.unitsPerPack ?? product.units_per_pack);
  const esPack = Number.isFinite(porPack) && porPack > 1;

  const variante = String(product.presentation || product.variant || '').trim();
  const nombre = normalizar(product.name);
  const varianteAporta = variante
    && !nombre.includes(normalizar(variante))
    && normalizar(variante) !== 'unidad';

  const partes = [];
  if (esPack) partes.push(`Pack x${porPack}`);
  if (capacidad) partes.push(capacidad);
  if (varianteAporta && !esPack) partes.push(variante);
  if (partes.length) return partes.join(' · ');
  if (varianteAporta) return variante;
  // Último recurso, para catálogos sin campos estructurados (la demo): la
  // etiqueta de unidad que la tarjeta mostraba antes de este helper. «Unidad»
  // sola no informa nada y se calla, igual que siempre.
  const etiqueta = String(product.unitLabel || '').trim();
  if (etiqueta && normalizar(etiqueta) !== 'unidad') return etiqueta;
  return '';
}
