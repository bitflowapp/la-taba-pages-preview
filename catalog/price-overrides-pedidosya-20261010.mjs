/*
 * OVERRIDE COMERCIAL POR SKU · PedidosYa Market Neuquén capital · 2026-10-10
 * =========================================================================
 *
 * La góndola deriva cada precio de `costoMayorista × 1,45` (o × 1,35 en pack).
 * Para los SKU de esta lista, el titular fijó el PRECIO ORIGINAL que exhibe
 * PedidosYa Market Neuquén (sin oferta, sin 2×1 ni 4×3) como precio de venta
 * objetivo. No se le suma margen encima.
 *
 * ESTADO
 * ------
 * `ESTADO` arranca en PENDIENTE_APROBACION_COMERCIAL: con ese valor el override
 * NO se aplica y la góndola se comporta exactamente igual que antes. Pasar a
 * APROBADO_COMERCIAL lo activa; eso lo decide el comercio, no el código.
 *
 * Alcance: sólo los 7 SKU con equivalencia exacta verificada. El Corona Extra
 * 330 ml (ambiguo con «Corona Rubia 330 ml») NO está acá a propósito.
 */

export const ESTADO = 'PENDIENTE_APROBACION_COMERCIAL';

/**
 * Decisión del titular sobre los 7 precios: aprobados como PRECIOS OBJETIVO para
 * preparar la actualización. La aplicación productiva queda BLOQUEADA hasta
 * verificar costos reales, checkout y procedimiento de publicación. Mientras
 * `aplicacion_productiva` sea BLOQUEADA, `ESTADO` no pasa a APROBADO_COMERCIAL.
 */
export const DECISION_COMERCIAL = Object.freeze({
  precios_objetivo: 'APROBADOS',
  registrado: '2026-10-10',
  fuente: 'instrucción escrita del titular en la sesión de trabajo del 2026-10-10',
  aplicacion_productiva: 'BLOQUEADA',
  condiciones_para_desbloquear: Object.freeze([
    'costo real verificado por SKU (hoy sólo costo medido en repo)',
    'checkout verificado contra la autoridad del servidor',
    'procedimiento de publicación y reversión aprobado',
  ]),
});

export const FUENTE = Object.freeze({
  origen: 'PedidosYa Market Neuquén capital',
  tipoPrecio: 'ORIGINAL, sin oferta ni promoción',
  relevado: '2026-10-10',
});

/** Precio comercial propuesto por SKU. Sin margen adicional. */
export const OVERRIDES = Object.freeze([
  Object.freeze({ sku: 'andes-origen-rubia-lata-473ml', referencia: 'Andes Origen Rubia 473 ml', precio: 3840 }),
  Object.freeze({ sku: 'budweiser-lata-473ml', referencia: 'Budweiser Lata 473 ml', precio: 3345 }),
  Object.freeze({ sku: 'quilmes-stout-lata-473ml', referencia: 'Quilmes Stout 473 ml', precio: 2999 }),
  Object.freeze({ sku: 'stella-artois-lata-473ml', referencia: 'Stella Artois 473 ml', precio: 4635 }),
  Object.freeze({ sku: 'gancia-lima-limon-lata-473ml', referencia: 'Gancia Lima Limón 473 ml', precio: 3239 }),
  Object.freeze({ sku: 'fernet-branca-1000ml', referencia: 'Fernet Branca 1 L', precio: 27585 }),
  Object.freeze({ sku: 'fernet-1882-750ml', referencia: 'Fernet 1882 750 ml', precio: 11880 }),
]);

const POR_SKU = new Map(OVERRIDES.map((o) => [o.sku, o]));

/**
 * Precio de override para un SKU, o null si no corresponde.
 * Sólo devuelve precio cuando el estado es APROBADO_COMERCIAL.
 */
export function precioOverride(sku, estado = ESTADO) {
  if (estado !== 'APROBADO_COMERCIAL') return null;
  return POR_SKU.get(sku)?.precio ?? null;
}

/** Override declarado, aunque todavía no esté aplicado (para auditoría y tests). */
export function overrideDeclarado(sku) {
  return POR_SKU.get(sku) ?? null;
}
