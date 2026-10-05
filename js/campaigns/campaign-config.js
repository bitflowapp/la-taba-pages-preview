/*
 * CAMPAÑAS ANIMADAS DE LA VIDRIERA — configuración.
 *
 * Una campaña es una pieza EDITORIAL con una escena animada: muestra un
 * producto que el local vende y lleva a su ficha. No es una promoción: no
 * declara precio, porcentaje ni oferta. El dinero tiene su propio contrato
 * validado (`core/promotions.js`) y su propio camino a pantalla.
 *
 * Las campañas ENCENDIDAS de abajo están APROBADAS para producción por Marco
 * (2026-10-05) y cada una apunta a un producto que EXISTE en el catálogo vivo,
 * con su marca, variante, capacidad y envase exactos (`tests/campaign-live-
 * catalog.test.mjs` lo exige contra una instantánea del catálogo de producción y
 * `npm run campaigns:verify-live` contra el catálogo en línea). Siguen siendo
 * editoriales: la configuración no escribe dinero y marca/precio/foto se
 * resuelven desde el producto vivo. El motor (`campaign-engine.js`) la descarta
 * si el producto no está en el catálogo, no se puede comprar ahora, está fuera de
 * vigencia o su texto afirma un precio. Encender una sola de las dos banderas no
 * muestra nada.
 *
 * Una campaña SIN producto real queda APAGADA y PENDIENTE hasta que el comercio
 * lo cargue de verdad: no se inventan productos, stock ni precios, y no se le
 * pone la foto de otra presentación. Hoy son las de Heineken y Aperol: no están
 * en el catálogo y el alcohol sigue cerrado (todos los productos con alcohol
 * están sin disponibilidad), así que ninguna cerveza ni aperitivo podría
 * «comprarse ahora».
 *
 * El esquema —id, vigencia, placements, destino, prioridad, contextos,
 * creatividad— es el contrato que va a escribir el panel del comercio.
 *
 *   placements   dónde puede aparecer:
 *                  home-hero       la banda de apertura de la home (reemplaza a
 *                                  la puerta editorial; misma caja, mismo alto)
 *                  home-inline     entre el primer carrusel y el resto
 *                  catalog-inline  una pieza en la grilla, tras la 4ª tarjeta
 *   contexts     rubros del catálogo donde la pieza de grilla tiene sentido
 *   target.skus  el producto; el primero que exista en el catálogo vivo gana
 *   creative     preset de escena, forma del envase y colores (hex de 6 dígitos)
 *   copy         rótulo, título y acción. El subtítulo NO se escribe: sale del
 *                nombre y la presentación reales del producto. El rótulo es la
 *                marca: en pantalla manda la del producto, y éste queda de
 *                respaldo. El PRECIO tampoco se escribe: la pieza muestra el
 *                precio vivo del producto, el mismo de la tarjeta.
 *
 * El envase usa la misma fotografía aprobada del catálogo. Sin foto oficial,
 * muestra el placeholder propio. La identidad declara marca, variante y envase.
 */
const candidate = (campaign) => Object.freeze({
  type: 'editorial',
  enabled: true,
  approval: Object.freeze({ status: 'APROBADA', reference: 'Marco · producción · 2026-10-05' }),
  validFrom: '',
  validUntil: '',
  ...campaign,
  placements: Object.freeze([...campaign.placements]),
  contexts: Object.freeze([...campaign.contexts]),
  target: Object.freeze({ ...campaign.target, type: 'product', skus: Object.freeze([...campaign.target.skus]), identity: Object.freeze({ ...campaign.target.identity }) }),
  creative: Object.freeze({ ...campaign.creative }),
  copy: Object.freeze({ ...campaign.copy }),
});

/** Una campaña a la que todavía le falta su producto real: apagada, sin aprobar. */
const pendiente = (campaign, motivo) => candidate({
  ...campaign,
  enabled: false,
  approval: Object.freeze({ status: 'PENDIENTE', reference: motivo }),
});

export const CAMPAIGNS = Object.freeze([
  // Sin producto real hoy (no está en el catálogo y el alcohol está cerrado): se
  // enciende cuando el comercio cargue Heineken y abra el alcohol, no antes.
  pendiente({
    id: 'heineken-beer-pour',
    priority: 40,
    placements: ['home-hero', 'catalog-inline'],
    contexts: ['cervezas'],
    target: { skus: ['heineken-710ml'], identity: {"brand":"Heineken","variant":"Lager","volumeMl":710,"container":"can"} },
    creative: { preset: 'beer_pour', vessel: 'can', tint: '#0c7a35', accent: '#e2231a' },
    copy: { eyebrow: 'Heineken', headline: 'Bien fría, recién servida', cta: 'Ver Heineken' },
  }, 'Sin producto en el catálogo vivo y alcohol cerrado'),
  // Red Bull Original 250 ml (lata), tal cual está cargado. La campaña se había
  // pensado para 355 ml: la identidad, la foto y el SKU son los del producto vivo.
  candidate({
    id: 'red-bull-cold-can',
    priority: 30,
    // Sólo la banda: la pieza de grilla pide una lista de 8 productos o más y
    // «Energizantes» tiene 5, así que ahí nunca saldría. Y en «Todo» le tocaría a
    // ella por prioridad, tapando a las demás campañas reales.
    placements: ['home-hero'],
    contexts: ['energizantes'],
    target: { skus: ['red-bull-original-250ml'], identity: {"brand":"Red Bull","variant":"Original","volumeMl":250,"container":"can"} },
    creative: { preset: 'cold_can', vessel: 'can', tint: '#1d3f97', accent: '#c8ccd4' },
    copy: { eyebrow: 'Red Bull', headline: 'Fría y lista para llevar', cta: 'Ver Red Bull' },
  }),
  // Coca-Cola Original 2250 ml (botella): la misma presentación que la pieza.
  candidate({
    id: 'coca-cola-product-drop',
    priority: 20,
    placements: ['home-inline', 'catalog-inline'],
    contexts: ['gaseosas'],
    target: { skus: ['coca-cola-original-2250ml'], identity: {"brand":"Coca-Cola","variant":"Original","volumeMl":2250,"container":"bottle"} },
    creative: { preset: 'product_drop', vessel: 'bottle', tint: '#3a140c', accent: '#e30613' },
    copy: { eyebrow: 'Coca-Cola', headline: 'La de siempre, para la mesa', cta: 'Ver Coca-Cola' },
  }),
  // Aquarius Pomelo 2250 ml (botella): una botella real y comprable para la
  // escena del hielo, que se había pensado para un aperitivo que no existe.
  candidate({
    id: 'aquarius-ice-reveal',
    priority: 25,
    // Grilla de «Todo» (51 productos) y, si Red Bull se agota, la banda. En su
    // propio rubro (3 productos) la pieza de grilla no sale: la lista es corta.
    placements: ['home-hero', 'catalog-inline'],
    contexts: ['aguas-saborizadas'],
    target: { skus: ['aquarius-pomelo-2250ml'], identity: {"brand":"Aquarius","variant":"Pomelo","volumeMl":2250,"container":"bottle"} },
    creative: { preset: 'ice_reveal', vessel: 'bottle', tint: '#f0641e', accent: '#1f5fbf' },
    copy: { eyebrow: 'Aquarius', headline: 'Con mucho hielo', cta: 'Ver Aquarius' },
  }),
  // Sin producto real hoy: no está en el catálogo y el alcohol está cerrado.
  pendiente({
    id: 'aperol-ice-reveal',
    priority: 5,
    placements: ['home-hero', 'catalog-inline'],
    contexts: ['aperitivos'],
    target: { skus: ['aperol-750ml'], identity: {"brand":"Aperol","variant":"Original","volumeMl":750,"container":"bottle"} },
    creative: { preset: 'ice_reveal', vessel: 'bottle', tint: '#f0641e', accent: '#1f5fbf' },
    copy: { eyebrow: 'Aperol', headline: 'Con mucho hielo', cta: 'Ver Aperol' },
  }, 'Sin producto en el catálogo vivo y alcohol cerrado'),
]);
