/*
 * CAMPAÑAS ANIMADAS DE LA VIDRIERA — configuración.
 *
 * Una campaña es una pieza EDITORIAL con una escena animada: muestra un
 * producto que el local vende y lleva a su ficha. No es una promoción: no
 * declara precio, porcentaje ni oferta. El dinero tiene su propio contrato
 * validado (`core/promotions.js`) y su propio camino a pantalla.
 *
 * TODAS NACEN APAGADAS. Las de abajo son CANDIDATAS: están escritas para que el
 * motor y las cuatro escenas se puedan probar en QA, y esperan la aprobación
 * comercial del local. Para que una se vea hacen falta LAS DOS cosas:
 *
 *     enabled: true
 *     approval: { status: 'APROBADA', reference: '<quién y cuándo>' }
 *
 * y aun así el motor (`campaign-engine.js`) la descarta si el producto no está
 * en el catálogo, no se puede comprar ahora, está fuera de vigencia o su texto
 * afirma un precio. Encender una sola de las dos banderas no muestra nada.
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
  enabled: false,
  approval: Object.freeze({ status: 'PENDIENTE', reference: '' }),
  validFrom: '',
  validUntil: '',
  ...campaign,
  placements: Object.freeze([...campaign.placements]),
  contexts: Object.freeze([...campaign.contexts]),
  target: Object.freeze({ ...campaign.target, type: 'product', skus: Object.freeze([...campaign.target.skus]), identity: Object.freeze({ ...campaign.target.identity }) }),
  creative: Object.freeze({ ...campaign.creative }),
  copy: Object.freeze({ ...campaign.copy }),
});

export const CAMPAIGNS = Object.freeze([
  candidate({
    id: 'heineken-beer-pour',
    priority: 40,
    placements: ['home-hero', 'catalog-inline'],
    contexts: ['cervezas'],
    target: { skus: ['heineken-710ml'], identity: {"brand":"Heineken","variant":"Lager","volumeMl":710,"container":"can"} },
    creative: { preset: 'beer_pour', vessel: 'can', tint: '#0c7a35', accent: '#e2231a' },
    copy: { eyebrow: 'Heineken', headline: 'Bien fría, recién servida', cta: 'Ver Heineken' },
  }),
  candidate({
    id: 'red-bull-cold-can',
    priority: 30,
    placements: ['home-inline', 'catalog-inline'],
    contexts: ['energizantes'],
    target: { skus: ['red-bull-energy-drink-355ml'], identity: {"brand":"Red Bull","variant":"Original","volumeMl":355,"container":"can"} },
    creative: { preset: 'cold_can', vessel: 'can', tint: '#1d3f97', accent: '#c8ccd4' },
    copy: { eyebrow: 'Red Bull', headline: 'Fría y lista para llevar', cta: 'Ver Red Bull' },
  }),
  candidate({
    id: 'coca-cola-product-drop',
    priority: 20,
    placements: ['home-inline', 'catalog-inline'],
    contexts: ['gaseosas'],
    target: { skus: ['coca-cola-original-2250ml-local'], identity: {"brand":"Coca-Cola","variant":"Original","volumeMl":2250,"container":"bottle"} },
    creative: { preset: 'product_drop', vessel: 'bottle', tint: '#3a140c', accent: '#e30613' },
    copy: { eyebrow: 'Coca-Cola', headline: 'La de siempre, para la mesa', cta: 'Ver Coca-Cola' },
  }),
  candidate({
    id: 'aperol-ice-reveal',
    priority: 10,
    placements: ['home-hero', 'catalog-inline'],
    contexts: ['aperitivos'],
    target: { skus: ['aperol-750ml'], identity: {"brand":"Aperol","variant":"Original","volumeMl":750,"container":"bottle"} },
    creative: { preset: 'ice_reveal', vessel: 'bottle', tint: '#f0641e', accent: '#1f5fbf' },
    copy: { eyebrow: 'Aperol', headline: 'Con mucho hielo', cta: 'Ver Aperol' },
  }),
]);
