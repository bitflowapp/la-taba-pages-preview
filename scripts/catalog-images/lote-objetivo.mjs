/*
 * Qué productos puede tocar este lote, y ninguno más.
 *
 * POR QUÉ EXISTE, Y QUÉ ERROR REPARA
 * ----------------------------------
 * La comprobación anterior seleccionaba los productos con
 * `sold_as_pack=eq.true` y exigía que fueran exactamente 4. Eso era cierto
 * mirando el catálogo con la clave publicable —que no ve los alcohólicos, porque
 * están cerrados por la compuerta de licencia— y dejó de serlo con una sesión de
 * owner, que ve los 56. El quinto pack es legítimo: `quilmes-clasica-lata-473ml-pack-6`,
 * un pack de seis latas cargado con la góndola de Neuquén.
 *
 * El error de fondo no fue contar mal: fue elegir el conjunto por una PROPIEDAD
 * («los que son pack») en vez de por una LISTA («estos cuatro»). Con una
 * propiedad, cualquier producto que mañana cumpla esa propiedad entra al lote sin
 * que nadie lo haya decidido. Un catálogo puede tener 5, 20 o 200 packs
 * legítimos, y ninguno de ellos tiene nada que ver con estas cuatro fotografías.
 *
 * Acá el conjunto es una lista escrita, y todo lo que no está en ella es
 * invisible para este lote.
 */

/**
 * Los únicos SKU que este lote puede tocar, con la presentación que se espera de
 * cada uno. `unitsPerPack` no es decorativo: es la cantidad que el packshot
 * anuncia con su sello, y si el producto dejara de traer esa cantidad la foto
 * pasaría a mentir.
 *
 * LA PRESENTACIÓN VIVE ACÁ, Y NO SÓLO EN LA FOTOGRAFÍA DE PRODUCCIÓN
 * ------------------------------------------------------------------
 * Estos cuatro son los únicos SKU del catálogo que no los declara ningún
 * archivo de góndola: nacieron con el lote de packshots y, hasta ahora, la
 * reconciliación los reconocía por descarte —«los visibles que la góndola no
 * nombra»—. Eso los ataba a `available`: el día que un pack se quedó sin stock,
 * RLS dejó de devolverlo, el descarte dio tres en vez de cuatro y el pipeline de
 * imágenes entero se plantó por un movimiento de inventario que no tiene nada
 * que ver con las fotos. Un SKU no deja de existir porque hoy no haya stock.
 *
 * NO hay precio acá, a propósito. Esto describe QUÉ es cada producto, no cuánto
 * sale: el precio es de producción y de nadie más.
 */
export const OBJETIVOS = new Map([
  ['coca-cola-original-botella-pet-500-ml-pack-x12', {
    nombre: 'Coca-Cola Original Pack x12',
    soloLoDeclaraEsteLote: true,
    unitsPerPack: 12,
    presentacion: {
      brand: 'Coca-Cola',
      capacityUnit: 'ml',
      capacityValue: 500,
      category: 'Gaseosas',
      name: 'Coca-Cola Original',
      packagingType: 'Botella PET',
      variant: 'Botella PET · 500 ml · Pack x12',
    },
  }],
  ['coca-cola-zero-botella-pet-500-ml-pack-x12', {
    nombre: 'Coca-Cola Zero Pack x12',
    soloLoDeclaraEsteLote: true,
    unitsPerPack: 12,
    presentacion: {
      brand: 'Coca-Cola',
      capacityUnit: 'ml',
      capacityValue: 500,
      category: 'Gaseosas',
      name: 'Coca-Cola Zero',
      packagingType: 'Botella PET',
      variant: 'Botella PET · 500 ml · Pack x12',
    },
  }],
  ['fanta-naranja-botella-pet-1500-ml-pack-x6', {
    nombre: 'Fanta Naranja Pack x6',
    soloLoDeclaraEsteLote: true,
    unitsPerPack: 6,
    presentacion: {
      brand: 'Fanta',
      capacityUnit: 'ml',
      capacityValue: 1500,
      category: 'Gaseosas',
      name: 'Fanta Naranja',
      packagingType: 'Botella PET',
      variant: 'Botella PET · 1500 ml · Pack x6',
    },
  }],
  ['sprite-botella-pet-500-ml-pack-x12', {
    nombre: 'Sprite Pack x12',
    soloLoDeclaraEsteLote: true,
    unitsPerPack: 12,
    presentacion: {
      brand: 'Sprite',
      capacityUnit: 'ml',
      capacityValue: 500,
      category: 'Gaseosas',
      name: 'Sprite',
      packagingType: 'Botella PET',
      variant: 'Botella PET · 500 ml · Pack x12',
    },
  }],

  /*
   * ALTA DEL 2026-08-25 · diez UNIDADES SUELTAS.
   *
   * Hasta acá el lote eran cuatro packs, porque la única fuente conocida era la
   * tienda MAYORISTA del embotellador Andina, que no publica unidades sueltas.
   * La tienda directa al consumidor de Coca-Cola FEMSA sí las publica, y con
   * render limpio; el resto lo aportaron el CDN del fabricante de Monster, el
   * sitio de Refres Now y un distribuidor oficial de Cervecería y Maltería
   * Quilmes.
   *
   * Los diez llevan una unidad por envase, y si alguno pasara a venderse de a
   * varios su fotografía dejaría de decir la verdad y este lote lo rechazaría.
   */
  ['coca-cola-original-2250ml', {
    nombre: 'Coca-Cola · 2,25 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Coca-Cola',
      capacityUnit: 'ml',
      capacityValue: 2250,
      category: 'Gaseosas',
      name: 'Coca-Cola',
      packagingType: 'botella-pet',
      variant: 'Original',
    },
  }],
  ['coca-cola-zero-2250ml', {
    nombre: 'Coca-Cola Zero · 2,25 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Coca-Cola',
      capacityUnit: 'ml',
      capacityValue: 2250,
      category: 'Gaseosas',
      name: 'Coca-Cola Zero',
      packagingType: 'botella-pet',
      variant: 'Sin azúcar',
    },
  }],
  ['sprite-original-2250ml', {
    nombre: 'Sprite · 2,25 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Sprite',
      capacityUnit: 'ml',
      capacityValue: 2250,
      category: 'Gaseosas',
      name: 'Sprite',
      packagingType: 'botella-pet',
      variant: 'Original',
    },
  }],
  ['sprite-zero-2250ml', {
    nombre: 'Sprite Zero · 2,25 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Sprite',
      capacityUnit: 'ml',
      capacityValue: 2250,
      category: 'Gaseosas',
      name: 'Sprite Zero',
      packagingType: 'botella-pet',
      variant: 'Sin azúcar',
    },
  }],
  ['sprite-original-lata-354ml', {
    nombre: 'Sprite · 354 ml',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Sprite',
      capacityUnit: 'ml',
      capacityValue: 354,
      category: 'Gaseosas',
      name: 'Sprite',
      packagingType: 'lata',
      variant: 'Original',
    },
  }],
  ['benedictino-sin-gas-2250ml', {
    nombre: 'Benedictino · 2,25 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Benedictino',
      capacityUnit: 'ml',
      capacityValue: 2250,
      category: 'Aguas',
      name: 'Benedictino',
      packagingType: 'botella-pet',
      variant: 'Sin gas',
    },
  }],
  ['monster-green-zero-473ml', {
    nombre: 'Monster Green Zero · 473 ml',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Monster',
      capacityUnit: 'ml',
      capacityValue: 473,
      category: 'Energizantes',
      name: 'Monster Green Zero',
      packagingType: 'lata',
      variant: 'Sin azúcar',
    },
  }],
  ['soda-manaos-sifon-2000ml', {
    nombre: 'Soda Manaos · 2 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Manaos',
      capacityUnit: 'ml',
      capacityValue: 2000,
      category: 'Mixers',
      name: 'Soda Manaos',
      packagingType: 'sifon',
      variant: 'Soda',
    },
  }],
  ['paso-de-los-toros-tonica-1500ml', {
    nombre: 'Paso de los Toros Tónica · 1,5 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Paso de los Toros',
      capacityUnit: 'ml',
      capacityValue: 1500,
      category: 'Mixers',
      name: 'Paso de los Toros Tónica',
      packagingType: 'botella-pet',
      variant: 'Tónica',
    },
  }],
  ['paso-de-los-toros-pomelo-1500ml', {
    nombre: 'Paso de los Toros Pomelo · 1,5 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Paso de los Toros',
      capacityUnit: 'ml',
      capacityValue: 1500,
      category: 'Mixers',
      name: 'Paso de los Toros Pomelo',
      packagingType: 'botella-pet',
      variant: 'Pomelo',
    },
  }],

  /*
   * ALTA DEL 2026-08-25 (segunda tanda) · cinco más, todas con RECORTE
   * DECLARADO en catalog/recortes-declarados.json.
   *
   * Los tres Aquarius vienen del embotellador FEMSA con una banda de marketing
   * lateral; los dos Gatorade, de un distribuidor oficial que fotografía la
   * botella chica dentro del mismo lienzo que la familiar y la deja diminuta y
   * descentrada. En los cinco el corte pasa por un canal de blanco puro y no
   * toca un píxel del envase: normalize.mjs lo verifica antes de escribir.
   */
  ['aquarius-manzana-1500ml', {
    nombre: 'Aquarius Manzana · 1,5 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Aquarius',
      capacityUnit: 'ml',
      capacityValue: 1500,
      category: 'Aguas saborizadas',
      name: 'Aquarius Manzana',
      packagingType: 'botella-pet',
      variant: 'Manzana',
    },
  }],
  ['aquarius-pera-1500ml', {
    nombre: 'Aquarius Pera · 1,5 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Aquarius',
      capacityUnit: 'ml',
      capacityValue: 1500,
      category: 'Aguas saborizadas',
      name: 'Aquarius Pera',
      packagingType: 'botella-pet',
      variant: 'Pera',
    },
  }],
  ['aquarius-pomelo-2250ml', {
    nombre: 'Aquarius Pomelo · 2,25 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Aquarius',
      capacityUnit: 'ml',
      capacityValue: 2250,
      category: 'Aguas saborizadas',
      name: 'Aquarius Pomelo',
      packagingType: 'botella-pet',
      variant: 'Pomelo',
    },
  }],
  ['gatorade-manzana-1250ml', {
    nombre: 'Gatorade Manzana · 1,25 L',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Gatorade',
      capacityUnit: 'ml',
      capacityValue: 1250,
      category: 'Isotónicas',
      name: 'Gatorade Manzana',
      packagingType: 'botella-pet',
      variant: 'Manzana',
    },
  }],
  ['gatorade-cool-blue-500ml', {
    nombre: 'Gatorade Cool Blue · 500 ml',
    unitsPerPack: 1,
    presentacion: {
      brand: 'Gatorade',
      capacityUnit: 'ml',
      capacityValue: 500,
      category: 'Isotónicas',
      name: 'Gatorade Cool Blue',
      packagingType: 'botella-pet',
      variant: 'Cool Blue',
    },
  }],
]);

export const SKUS_OBJETIVO = Object.freeze([...OBJETIVOS.keys()]);

/**
 * Comprueba que el lote sea exactamente el declarado.
 *
 * `productos` puede traer de más —el catálogo entero, si hiciera falta—: lo que
 * sobra se ignora, y ésa es justamente la propiedad que se quiere. Lo que no se
 * tolera es que falte un objetivo, que uno haya dejado de ser pack, que cambie
 * la cantidad, o que el lote de assets nombre un SKU que no está en la lista.
 */
export function validarLoteObjetivo({ productos = [], assets = [] } = {}) {
  const errores = [];
  const porSku = new Map(productos.map((producto) => [producto.sku, producto]));
  const seleccionados = [];

  for (const [sku, esperado] of OBJETIVOS) {
    const producto = porSku.get(sku);
    if (!producto) {
      errores.push(`falta el producto objetivo ${sku}.`);
      continue;
    }
    /*
     * Lo que hay que comprobar no es «que sea pack»: es que la CANTIDAD que el
     * producto vende sea la que la fotografía anuncia. Mientras el lote fueron
     * cuatro packs las dos cosas eran la misma, y esta comprobación se escribió
     * con la que se veía. Con diez unidades sueltas adentro, exigir
     * `sold_as_pack` rechazaba justamente los productos cuya foto es una
     * botella sola.
     */
    const esPack = esperado.unitsPerPack > 1;
    if (Boolean(producto.sold_as_pack) !== esPack) {
      errores.push(
        `${sku} se vende ${producto.sold_as_pack ? 'como pack' : 'por unidad'} y su fotografía es `
        + `${esPack ? `de un pack de ${esperado.unitsPerPack}` : 'de una unidad suelta'}.`,
      );
    }
    if (producto.units_per_pack !== esperado.unitsPerPack) {
      errores.push(
        `${sku} trae ${producto.units_per_pack} unidades y el packshot anuncia `
        + `${esperado.unitsPerPack}: la foto pasaría a mentir.`,
      );
    }
    seleccionados.push(producto);
  }

  // El lote de assets tiene que nombrar la MISMA lista. Un asset de más es un
  // producto de más que se va a escribir sin haberlo decidido.
  const skusDeAssets = assets.map((asset) => asset.sku ?? asset);
  for (const sku of skusDeAssets) {
    if (!OBJETIVOS.has(sku)) errores.push(`el lote incluye un SKU que no es objetivo: ${sku}.`);
  }
  for (const sku of OBJETIVOS.keys()) {
    if (skusDeAssets.length && !skusDeAssets.includes(sku)) {
      errores.push(`el lote no incluye el objetivo ${sku}.`);
    }
  }
  const repetidos = skusDeAssets.filter((sku, indice) => skusDeAssets.indexOf(sku) !== indice);
  for (const sku of new Set(repetidos)) errores.push(`el lote nombra ${sku} más de una vez.`);

  return { errores, ok: errores.length === 0, seleccionados };
}

/**
 * Qué disponibilidad tiene que quedar cuando este lote republica un producto.
 *
 * NO ES UNA DECISIÓN DE ESTE LOTE, Y ESE ES EL PUNTO
 * --------------------------------------------------
 * Asociar una fotografía obliga a republicar —el disparador
 * `products_fail_close_master_change` saca de venta lo que toca— y republicar
 * exige decir con qué disponibilidad. Durante los cuatro packs de agosto la
 * respuesta fue `true` escrita a mano, y era correcta por casualidad: los
 * cuatro estaban a la venta.
 *
 * Dejó de serlo el 2026-08-22, cuando la curación de lanzamiento sacó de la
 * góndola al pack x6 de Fanta por una decisión comercial escrita. Con `true`
 * fijo, cambiarle la foto lo habría devuelto a la venta de costado. Cambiar una
 * imagen no es decidir qué se vende.
 *
 * LA ÚNICA EXCEPCIÓN, Y CÓMO SE RECONOCE SIN ADIVINAR
 * ---------------------------------------------------
 * Una corrida anterior puede haberse cortado entre el import y el republicado,
 * y ahí el producto quedó fuera de venta por accidente: devolverlo es el
 * objetivo. Ese estado se distingue porque el disparador hace las dos cosas
 * JUNTAS —saca de venta Y DESVERIFICA—. Entonces:
 *
 *   fuera de venta y SIN verificar  → lo dejó el disparador     → vuelve
 *   fuera de venta y VERIFICADO     → lo decidió una persona    → se respeta
 */
export function disponibilidadTrasPublicar(producto) {
  return producto?.available === true || producto?.is_verified !== true;
}

/**
 * Los productos que este lote NO va a tocar. Se listan para poder demostrar
 * después que quedaron igual, no para decidir nada con ellos.
 */
export function fueraDelLote(productos = []) {
  return productos.filter((producto) => !OBJETIVOS.has(producto.sku));
}
