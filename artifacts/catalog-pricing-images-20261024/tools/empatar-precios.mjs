// Empata el catálogo TABA (gondola-neuquen.mjs, 52 SKU) contra La Anónima (Neuquén, relevado hoy)
// y DIA Online (relevado hoy). Reglas explícitas por SKU; nada se deduce por nombre suelto.
// Salidas: coincidencias.csv + propuesta-precios.csv + propuesta-precios.json
// Regla de oro: la propuesta NUNCA reemplaza el precio vigente en el catálogo
// (cargar precio = confirmar, CONTRATO-PRECIO-STOCK.md); queda a la espera de aprobación comercial.
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { parseCsv } from './parse-csv.mjs';
import { GONDOLA, precioDeVenta } from '../../../catalog/gondola-neuquen.mjs';

const FECHA = new Date().toISOString().slice(0, 10);
const URL_ANCA = 'https://www.laanonima.com.ar (sucursal por defecto del sitio: Neuquén)';
const URL_DIA = 'https://diaonline.supermercadosdia.com.ar';

function readdirSafe(d) {
  try { return readdirSync(d); } catch { return []; }
}

// ── Cargar relevamientos ─────────────────────────────────────────────────────
const anca = [];   // {store,cat,codigo,marca,nombre,precioComparador,precioPromo,url}
{
  const dir = 'artifacts/catalog-pricing-images-20261024/fuentes/laanonima';
  for (const f of readdirSafe(dir).filter((x) => x.endsWith('.csv') && x !== 'resultados.csv')) {
    const rows = parseCsv(readFileSync(`${dir}/${f}`, 'utf8'));
    const hdr = rows[0];
    const iN = hdr.indexOf('nombre'), iM = hdr.indexOf('marca'), iC = hdr.indexOf('codigo'), iR = hdr.indexOf('precioRegular'), iP = hdr.indexOf('precioPromo');
    const cat = f.replace('.csv', '');
    for (const r of rows.slice(1)) {
      if (!r[iN] || !r[iR] || Number(r[iR]) <= 0) continue;
      anca.push({ store: 'La Anónima', cat, codigo: r[iC], marca: r[iM], nombre: r[iN], precioComparador: Number(r[iR]), promoo: r[iP] ? Number(r[iP]) : '', url: URL_ANCA });
    }
  }
  // dedupe por codigo+nombre (la misma ficha se repite por cada URL de paginación)
  const seen = new Set();
  for (let i = anca.length - 1; i >= 0; i--) {
    const k = `${anca[i].codigo}|${anca[i].nombre}`;
    if (seen.has(k)) anca.splice(i, 1); else seen.add(k);
  }
}
const dia = [];   // {store,skuBuscado,nombre,precioComparador,lista,url}
{
  const rows = parseCsv(readFileSync('artifacts/catalog-pricing-images-20261024/fuentes/dia/resultados.csv', 'utf8'));
  const hdr = rows[0];
  const iS = hdr.indexOf('skuBuscado'), iP = hdr.indexOf('producto'), iPr = hdr.indexOf('precio'), iL = hdr.indexOf('precioLista'), iU = hdr.indexOf('url');
  for (const r of rows.slice(1)) {
    if (!r[iP] || !r[iPr] || Number(r[iPr]) <= 0) continue;
    dia.push({ store: 'DIA Online', skuBuscado: r[iS], nombre: r[iP], precioComparador: Number(r[iPr]), lista: r[iL] ? Number(r[iL]) : '', url: r[iU] });
  }
}

// ── Reglas por SKU: {store, in, out} ─────────────────────────────────────────
// `parcial: true` o `familial: 'texto'` marcan coincidencia de familia (sin equivalencia
// exacta acreditada) — no alimenta el comparador más barato, la fila queda pendiente.
// Todas las reglas están contrastadas contra los listados reales relevados hoy
// (fuentes/laanonima/*.csv y fuentes/dia/resultados.csv, fecha 2026-10-24).
const R = {
  'coca-cola-original-2250ml': [
    // DIA SÍ lista la Original 2,25 hoy; La Anónima NO (sólo 2,5 y las sin azúcar).
    { store: 'DIA', in: /coca.*sabor original.*2[.,]25/i, out: /zero|light|liviano|combo|dia|cunnington|manaos/i },
    { store: 'La Anónima', in: /coca.*(zero|light|diet.*coca).*2[,.\s]*25/i, out: /500|1,5/i, parcial: true, nota: 'familia 2,25 cola: Zero y Light 2,25 a $6.150; la Original 2,25 no está listada hoy en La Anónima' },
    { store: 'La Anónima', in: /coca.*2[,.] ?5.*pet|coca.*pet.*2[,.] ?5/i, out: /zero|light|diet/i, parcial: true, nota: 'familia de marca: la Original 2,5 L a $7.000; la 2,25 regular no está listada hoy' },
  ],
  'coca-cola-zero-2250ml': [
    { store: 'La Anónima', in: /coca.*(zero|sin az.*car).*2[,.\s]*25/i, out: /light|500|1,5|lata|vidrio|237/i },
    { store: 'DIA', in: /coca.*zero.*2[.,]25/i, out: /combo|500|1,25|600|1,5|2,5|schweppes|dia |ligh/i },
  ],
  'coca-cola-original-lata-354ml': [
    { store: 'DIA', in: /coca.*sabor original.*354/i, out: /zero|light|220|combo/i, nota: 'envase lata no escrito en el nombre (354 = lata)' },
    { store: 'La Anónima', in: /coca.*354.*multipack/i, parcial: true, nota: 'La Anónima lo lista como «Multipack x6» a $1.850: posible precio por unidad o por pack, interpretación ambigua; no se usa como comparador' },
  ],
  'coca-cola-zero-lata-354ml': [
    { store: 'La Anónima', in: /(coca|cola)[^.]*s[./]?az[úu]?.*354|s[./]?az[úu]?.*(coca|cola).*354/i, out: /light/i, nota: 'ANCA escribe «s/Azúcar» antes de la marca en esta línea' },
  ],
  'sprite-original-2250ml': [
    { store: 'La Anónima', in: /sprite.*2[,.\s]*25/i, out: /zero/i },
    { store: 'DIA', in: /sprite.*2[.,]25|sprite.*lima.*2[.,]25/i, out: /zero|500|1,25|1,75|3 lt|combo/i },
  ],
  'sprite-zero-2250ml': [
    { store: 'La Anónima', in: /sprite.*(zero|lima.*light).*2[,.\s]*25/i, out: /1,5/i },
    { store: 'DIA', in: /sprite.*zero.*2[.,]25/i, out: /500|1,5|600|1,25|1,75|3 lt|combo|schweppes|aquarius/i },
  ],
  'sprite-original-lata-354ml': [
    { store: 'La Anónima', in: /(sprite).*(lata).*354|lata.*sprite.*354/i, out: /zero|s[./]az/i, nota: 'ANCA pone «Lata Sprite x 354 cc.» — marca después del sabor' },
    { store: 'DIA', in: /sprite.*354/i, out: /zero|combo/i },
  ],
  'fanta-naranja-2250ml': [
    { store: 'La Anónima', in: /fanta.*(naranja).*2[,.\s]*25/i, out: /zero|500|354/i },
    { store: 'DIA', in: /fanta.*naranja.*2[.,]25/i, out: /zero|500|600|1,5|1,75|473|473|dia |manaos|crush|cunnington|aquarius|levite/i },
  ],
  'pepsi-original-2000ml': [
    // En La Anónima hoy sólo hay Pepsi 3 L, 500 y lata 354 (y Black); la 2 L regular sale en DIA.
    { store: 'DIA', in: /pepsi.*2 lt/i, out: /black|500|354|3 lt|mini/i },
  ],
  'pepsi-black-1500ml': [
    { store: 'La Anónima', in: /pepsi.*black.*1[,.\s]*5/i, out: /354|2 lt|vintage/i },
    { store: 'DIA', in: /pepsi.*black.*1[,.\s]*5/i, out: /500|354|2 lt|mini/i },
  ],
  'seven-up-original-2000ml': [
    { store: 'La Anónima', in: /seven.?up.*2000/i, out: /sin az[úu]?car|s[./]az|\bsa\b|2250|1[,.]25/i },
  ],
  'paso-de-los-toros-tonica-1500ml': [
    { store: 'La Anónima', in: /paso.*toros.*t.*nica.*1,5|t.*nica.*paso.*toros.*1,5/i, out: /lata|269/i },
  ],
  'paso-de-los-toros-pomelo-1500ml': [
    { store: 'La Anónima', in: /paso.*toros.*pomelo.*1,5|pomelo.*paso.*toros.*1,5/i, out: /lata|269|light|sin az/i },
    { store: 'DIA', in: /paso.*toros.*pomelo.*1[,.\s]*5|pomelo.*paso.*los toros.*1[,.\s]*5/i, out: /light|269|500|2 lt|t.*nica/i },
  ],
  'villa-del-sur-sin-gas-600ml': [
    { store: 'La Anónima', in: /villa del sur.*600/i, out: /saborizada|levite|con gas|bid/i },
    { store: 'DIA', in: /villa del sur.*600/i, out: /saborizada|levite|bid/i },
  ],
  'villavicencio-sin-gas-1500ml': [
    { store: 'La Anónima', in: /villavicencio.*1[,.\s]*5|villavicencio.*1500/i, out: /sport|con gas/i },
    { store: 'DIA', in: /villavicencio.*(sin gas|pet).*1[,.\s]*5/i, out: /con gas|sport/i },
  ],
  'villavicencio-con-gas-500ml': [
    { store: 'DIA', in: /villavicencio.*(con gas).*500|(con gas).*villavicencio.*500/i, out: /sin gas/i },
    { store: 'La Anónima', in: /villavicencio.*(con gas)|(con gas).*villavicencio/i },
  ],
  'benedictino-sin-gas-2250ml': [
    { store: 'La Anónima', in: /benedictino.*sin gas.*2[,.\s]*25/i, out: /pack|x ?4/i },
    { store: 'DIA', in: /benedictino.*sin gas.*2[,.\s]*25/i, out: /pack|x ?4/i },
  ],
  'aquarius-pera-1500ml': [
    { store: 'La Anónima', in: /aquarius.*pera.*1,5/i, out: /2,25|500/i },
    { store: 'DIA', in: /aquarius.*pera.*1[.,]5/i, out: /2[.,]25|600/i },
  ],
  'aquarius-manzana-1500ml': [
    { store: 'La Anónima', in: /aquarius.*manzana.*1,5/i, out: /2,25|500/i },
    { store: 'DIA', in: /aquarius.*manzana.*1[.,]5/i, out: /2[.,]25|600|levite|naranja|pomelo/i },
  ],
  'aquarius-pomelo-2250ml': [
    { store: 'La Anónima', in: /aquarius.*pomelo.*2[,.\s]*25/i, out: /1,5|500|rosado/i },
    { store: 'DIA', in: /aquarius.*pomelo.*2[.,]25/i, out: /1[.]5|600|rosado|levite|pera|manzana|naranja/i },
  ],
  'red-bull-original-250ml': [
    { store: 'La Anónima', in: /red bull.*250/i, out: /zero|sin az|summer|355/i },
    { store: 'DIA', in: /red bull.*250/i, out: /sin az|zero|summer|355/i },
  ],
  'red-bull-sin-azucar-250ml': [
    { store: 'La Anónima', in: /red bull.*(zero|sin az).*(250)|(zero|sin az).*red bull.*250/i, out: /summer|355/i },
    { store: 'DIA', in: /(sin az|zero).*red bull.*250|red bull.*(sin az|zero).*250/i, out: /summer|355/i },
  ],
  'speed-original-473ml': [
    { store: 'La Anónima', in: /speed.*473/i, out: /zero/i },
    { store: 'DIA', in: /speed.*473/i, out: /zero|250|light/i },
  ],
  'speed-zero-473ml': [
    { store: 'La Anónima', in: /(zero|sin az).*speed.*473|speed.*(zero|sin az).*473|energizante.*zero.*speed.*473/i },
    { store: 'DIA', in: /(zero|sin az)...*speed.*473|energizante.*zero.*speed.*473/i, out: /250/i },
  ],
  'gatorade-cool-blue-500ml': [
    { store: 'La Anónima', in: /gatorade.*cool blue.*500/i },
    { store: 'DIA', in: /gatorade.*cool blue.*500/i, out: /750|1,25/i },
  ],
  'gatorade-manzana-1250ml': [
    { store: 'La Anónima', in: /gatorade.*manzana.*1[,.\s]*25/i },
    { store: 'DIA', in: /gatorade.*manzana.*1[,.\s]*25/i, out: /500|750|naranja|cool|tropicales/i },
  ],
  'powerade-mountain-blast-500ml': [
    { store: 'La Anónima', in: /powerade.*mountain blast.*500/i, out: /995|zero/i },
    { store: 'DIA', in: /powerade.*mountain blast.*500/i, out: /995|1,5|zero/i },
  ],
  'monster-green-zero-473ml': [
    { store: 'DIA', in: /green.*zero.*monster|monster.*green.*zero/i, nota: 'DIA lo lista «437 Ml.»; el formato comercial de la línea es 473' },
    { store: 'La Anónima', in: /monster.*473/i, parcial: true, nota: 'La Anónima lista sólo otros sabores de la línea Monster 473; el Green Zero no está listado hoy' },
  ],
  'quilmes-clasica-lata-473ml': [
    { store: 'DIA', out: /bajo cero|0[.,]0|cristal|1890|hinchada|stout|710|ipa|pack/i, parcial: true, nota: 'la variedad Clásica 473 no está listada ni en DIA ni en La Anónima hoy (sólo IPA, Bajo Cero, 0.0 y packs de otras variedades)' },
    { store: 'La Anónima', in: /quilmes.*473/i, out: /bajo cero|0[.,]0|ipa|stout|hinchada|pack|x ?6/i, parcial: true },
  ],
  'quilmes-clasica-lata-473ml-pack-6': [],
  'quilmes-clasica-botella-710ml': [
    { store: 'DIA', in: /quilmes.*710/i, out: /lata|pack/i, nota: 'DIA «Cerveza Quilmes 710 Ml.» sin envase escrito (porrón 710)' },
  ],
  'quilmes-stout-lata-473ml': [
    { store: 'La Anónima', in: /quilmes.*stout.*473/i, out: /pack|x ?6/i },
  ],
  'brahma-chopp-lata-710ml': [
    { store: 'La Anónima', in: /brahma.*710/i, out: /pack|x ?4/i, nota: 'ANCA escribe «Cerveza Lata Brahma x 710 cc.»' },
    { store: 'DIA', in: /brahma.*710/i, out: /473|pack/i, parcial: true, nota: 'DIA «Cerveza Brahma 710 Ml.» sin envase escrito; la lata es probable pero sin acreditar — comparador exacto: La Anónima' },
  ],
  'budweiser-lata-473ml': [
    { store: 'La Anónima', in: /budweiser.*473/i, out: /710|pack|x ?6/i },
    { store: 'DIA', in: /budweiser.*473/i, out: /710|x ?6|pack/i, parcial: true, nota: 'DIA lista la edición promocional «Música» (mismo líquido, packaging distinto); por cautela no alimenta el comparador' },
  ],
  'stella-artois-lata-473ml': [
    { store: 'La Anónima', in: /stella.*473/i, out: /x ?6|noire|710|0[.,]0|long neck|pure gold|pack/i },
    { store: 'DIA', in: /stella.*473/i, out: /x ?6|vintage|710|330|pure gold|pack/i },
  ],
  'corona-extra-botella-330ml': [
    { store: 'La Anónima', in: /corona.*330/i, out: /pack|x ?6|sin alcohol|710|long neck/i },
    { store: 'DIA', in: /corona.*330/i, out: /0[.,]0|pack/i },
  ],
  'andes-origen-rubia-lata-473ml': [
    { store: 'La Anónima', in: /andes origen.*rubia.*473/i, out: /roja|negra|oro|ipa|pack|x ?6/i },
    { store: 'DIA', in: /andes.*rubia.*473/i, out: /oro|roja|ipa|pack/i, parcial: true, nota: 'DIA la lista como «Andes Rubia» sin «Origen»; probablemente la misma, pero no está acreditado — comparador exacto: La Anónima' },
  ],
  'andes-origen-roja-lata-473ml': [
    { store: 'La Anónima', in: /andes origen.*roja.*473|andes.*roja.*x ?1/i, out: /pack|x ?6/i },
    { store: 'DIA', in: /andes.*(roja).*(473)/i, out: /pack/i },
  ],
  'patagonia-amber-lager-botella-730ml': [
    { store: 'La Anónima', in: /patagonia.*amber.*(730|750)/i, out: /lata|24 ?7|pack/i },
    { store: 'DIA', in: /patagonia.*amber.*(730|750)/i, out: /lata|pack/i },
  ],
  'fernet-branca-1000ml': [],
  'fernet-1882-750ml': [
    { store: 'La Anónima', in: /1882.*750/i, out: /cola|pomelo/i },
    { store: 'DIA', in: /fernet 1882.*750/i, out: /cola|pomelo|branca|vittone/i },
  ],
  'gancia-americano-450ml': [
    { store: 'La Anónima', in: /gancia.*americano.*450|americano.*gancia.*450/i, out: /950|lata|hibiscus|ima/i },
    { store: 'DIA', in: /gancia.*450/i, out: /950/i },
  ],
  'gancia-lima-limon-lata-473ml': [
    { store: 'La Anónima', in: /(gancia).*(lima|lim.*?n).*473|lima.*lim.*?n.*gancia.*473/i, out: /pack/i },
  ],
  'dr-lemon-vodka-pomelo-lata-473ml': [
    { store: 'La Anónima', in: /dr[.]? lemon.*pomelo.*473|dr[.]? lemon.*vodka.*pomelo/i, out: /1 lt|pack/i },
    { store: 'DIA', in: /(vodka|pomelo).*dr.? lemon.*473|dr.? lemon.*vodka.*473/i, out: /1 lt|stone|remix|mojito|gin|berries|apple|pack/i },
  ],
  'trapiche-origen-malbec-750ml': [
    { store: 'DIA', in: /(malbec).*(origen).*trapiche|trapiche.*(malbec).*origen/i, out: /reserva|viognier|hermanos|phebu/i },
    { store: 'La Anónima', in: /(trapiche).*(malbec).*750|malbec.*trapiche.*750/i, out: /alaris|reserva|impuro/i, parcial: true, nota: 'familia Trapiche Malbec: el genérico 750 a $7.800; «Origen» no está listado hoy en La Anónima' },
  ],
  'dada-caramel-750ml': [
    { store: 'La Anónima', in: /(dada).*(caramel).*750|caramel.*dada.*750/i, out: /pack/i },
    { store: 'DIA', in: /dada.*caramel/i, out: /pack/i },
  ],
  'cafayate-torrontes-750ml': [
    { store: 'DIA', in: /cafayate.*torront/i, out: /reserve/i },
    { store: 'La Anónima', in: /(cafayate).*(torr).*750|torr.*cafayate.*750/i, parcial: true, nota: 'La Anónima lista sólo «Reserve» ($11.850); el Reserve es un rango distinto del Torrontés regular' },
  ],
  'toro-viejo-clasico-tinto-750ml': [
    { store: 'La Anónima', in: /toro.*cl.*sico.*750/i, out: /sele|blanco/i, parcial: true, nota: 'ANCA lista «Vino Tinto Toro Clásico 750» — la equivalencia con «Toro Viejo Clásico» no está acreditada' },
    { store: 'DIA', in: /toro.*cl.*sico.*750|toro.*viejo.*750/i, out: /sele|blanco|vasco/i, parcial: true, nota: 'sólo «Toro Clásico» en DIA; equivalencia con «Toro Viejo» no acreditada' },
  ],
  'toro-tinto-1000ml': [
    { store: 'La Anónima', in: /vino tinto toro.*(1000|1 lt)/i, out: /dulce|tetra|brick|sele/i },
    { store: 'DIA', in: /vino tinto toro.*(1 lt|1000)/i, out: /tetra|brick|blanco|rosado/i },
  ],
  'gin-gordons-700ml': [
    { store: 'La Anónima', in: /gordon.*700/i, out: /pink|tonic|tropical/i },
    { store: 'DIA', in: /(gin )?gordon.*700/i, out: /pink|tonic|tropic|brighton|tanqueray|spirito|vim/i },
  ],
  'vodka-skyy-700ml': [
    { store: 'La Anónima', in: /skyy.*700/i, out: /jungle|pineapple|raspberry|apricot|cosmic|infusion/i },
    { store: 'DIA', in: /skyy.*700/i, out: /jungle|pineapple|raspberry|apricot|cosmic|infusion/i },
  ],
  // Packs heredados: sin equivalencia exacta en competidores hoy.
};

// ── Empatar ──────────────────────────────────────────────────────────────────
// Observaciones documentadas para los SKU que hoy no tienen equivalente en ninguna
// de las dos tiendas relevadas (revisado a mano sobre fuentes/laanonima/*.csv y
// fuentes/dia/resultados.csv con fecha 2026-10-24).
const OBS_PENDIENTES = {
  'quilmes-clasica-lata-473ml': 'La Clásica 473 no está listada: La Anónima sólo trae variantes 473 x1 (IPA $2.850, Bajo Cero $2.050) y x6 de otras líneas; DIA sólo Bajo Cero, 0.0, Cristal y 1890.',
  'quilmes-clasica-lata-473ml-pack-6': 'Ninguna de las dos tiendas lista el pack x6 de la Clásica (La Anónima trae packs x6 de otras variedades a $17.000; x4 de Quilmes 710 a $15.900).',
  'quilmes-stout-lata-473ml': 'La Anónima lista la Stout 473 sólo en pack x6 ($17.000, ≈$2.833/un); no hay unidad suelta ni en DIA.',
  'fernet-branca-1000ml': 'Ninguna de las dos tiendas lista el Branca 1 L (750 en DIA $12.000 lista / ANCA $19.700; 450 y Menta también).',
  'soda-manaos-sifon-2000ml': 'Sin listados de soda Manaos en la categoría de aguas/gaseosas de ninguna de las dos tiendas hoy.',
};

const lineasCoin = [];
const propuesta = [];
const NOMBRES_ESTADO_ES = {
  propuesto: 'propuesto',
  propuesto_en_piso_margen: 'propuesto (clamp al piso de margen)',
  mantiene_vigente: 'mantiene vigente',
  conflicto_margen: 'conflicto margen vs banda 5-10%',
  pendiente_sin_comparador: 'pendiente (sin comparador verificado hoy)',
  pendiente_coincidencia_parcial: 'pendiente (sólo coincidencia parcial de familia)',
};

for (const p of GONDOLA) {
  const reglas = R[p.sku] ?? [];
  const matches = [];
  for (const regla of reglas) {
    const fuente = regla.store === 'DIA' ? dia : anca;
    for (const f of fuente) {
      if (regla.store === 'DIA' && f.skuBuscado !== p.sku) continue;
      if (regla.in && !regla.in.test(f.nombre)) continue;
      if (regla.out && regla.out.test(f.nombre)) continue;
      matches.push({ ...f, parcial: regla.parcial === true || regla.familial != null, nota: regla.familial ?? regla.nota ?? '' });
    }
  }
  // dedupe
  const vistos = new Set();
  const unicos = matches.filter((m) => {
    const k = `${m.store}|${m.nombre}|${m.precioComparador}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  const exactos = unicos.filter((m) => !m.parcial);
  const parciales = unicos.filter((m) => m.parcial);
  const comparable = exactos.length ? exactos : parciales;
  const esExacta = exactos.length > 0;
  const barato = comparable.length ? Math.min(...comparable.map((m) => m.precioComparador)) : null;
  const fuenteBarato = barato != null ? comparable.find((m) => m.precioComparador === barato) : null;

  const piso = precioDeVenta(p);   // criterio publicado: costo × (1,45 unidad | 1,35×unidades pack), ceil $50 = precio vigente de góndola
  const vigente = p.price;
  const descVigente = barato ? +(((1 - vigente / barato) * 100).toFixed(1)) : null;

  let precioPropuesto = null;
  let estado = '';
  let motivo = '';
  let descuentoPropuesto = null;

  if (barato == null) {
    estado = 'pendiente_sin_comparador';
    motivo = 'Sin equivalente regular verificado hoy en La Anónima Neuquén ni DIA Online.' + (OBS_PENDIENTES[p.sku] ? ' ' + OBS_PENDIENTES[p.sku] : '');
  } else if (!esExacta) {
    estado = 'pendiente_coincidencia_parcial';
    motivo = `Sólo coincidencia de familia sin equivalencia acreditada (referencia: $${barato}); se exige comparador exacto para proponer precio.`;
  } else {
    // Banda objetivo: entre 5% y 10% bajo el competidor más barato; objetivo 7%.
    const target7 = barato * 0.93;
    const cota5 = barato * 0.95;   // precio máximo admisible (descuento exactamente 5%)
    const cota10 = barato * 0.90;  // precio mínimo admisible (descuento exactamente 10%)
    const EPS = 1e-6;
    const band = (x) => x >= cota10 - EPS && x <= cota5 + EPS;
    const mult50 = (x) => Math.round(x / 50) * 50;
    const vecinos = [Math.floor(target7 / 50) * 50, Math.ceil(target7 / 50) * 50].filter(band);
    let cand = vecinos.length
      ? vecinos.reduce((a, b) => (Math.abs(b - target7) < Math.abs(a - target7) ? b : a))
      : Math.max(cota10, Math.min(cota5, mult50(target7)));
    let clampPiso = false;
    if (cand < piso) { cand = precioDeVenta(p); clampPiso = true; }
    descuentoPropuesto = +(((1 - cand / barato) * 100).toFixed(1));

    if (cand > cota5 + EPS) {
      // El piso de margen deja el precio por encima de la banda 5-10%: rentabilidad no se negocia.
      estado = 'conflicto_margen';
      precioPropuesto = cand;
      descuentoPropuesto = descVigente;
      motivo = `Piso de margen (costo×${p.soldAsPack ? `1,35×${p.unitsPerPack}` : '1,45'} ceil $50) = $${piso} supera el tope de banda 5% ($${Math.round(cota5)}); competir a banda 5% rompería el margen. Se mantiene el vigente $${vigente} y se exige decisión de negocio.`;
    } else if (vigente <= cand) {
      // El vigente ya cumple la promesa (≥5% bajo el más barato). No se repica al alza:
      // el objetivo 7% se deja como referencia para una eventual normalización por decisión de negocio.
      estado = 'mantiene_vigente';
      precioPropuesto = vigente;
      descuentoPropuesto = descVigente;
      motivo = `El vigente $${vigente} ya está ${Math.abs(descVigente)}% bajo el más barato verificado ($${barato}, ${fuenteBarato.store}); la promesa se cumple. Objetivo 7% de banda: $${Math.round(target7)}${descVigente < 10 ? ` (alcanzarlo implicaría un alza de +${(((cand - vigente) / vigente) * 100).toFixed(0)}%, decisión de negocio)` : ''}.`;
    } else {
      estado = clampPiso ? 'propuesto_en_piso_margen' : 'propuesto';
      precioPropuesto = cand;
      motivo = clampPiso
        ? `El objetivo 7% ($${Math.round(target7)}) cae bajo el piso de margen ($${piso}); se propone el piso: ${descuentoPropuesto}% bajo el más barato ($${barato}).`
        : `Objetivo 7% verificable: ${descuentoPropuesto}% bajo el más barato verificado hoy ($${barato}, ${fuenteBarato.store}).`;
    }
  }

  propuesta.push({
    sku: p.sku,
    nombre: `${p.brand} ${p.name}`,
    presentacionTABA: `${p.packagingType} ${p.capacity}${p.unitsPerPack > 1 ? ` ×${p.unitsPerPack}` : ''}`,
    costoMayorista: p.costoMayorista,
    pisoMargen: piso,
    precioVigenteTABA: vigente,
    estadoPropuesta: NOMBRES_ESTADO_ES[estado] ?? estado,
    comparadorMasBarato: barato ?? '',
    tiendaMasBarata: fuenteBarato ? fuenteBarato.store : '',
    tipoCoincidencia: barato == null ? 'NINGUNA' : (esExacta ? 'EXACTA' : 'PARCIAL'),
    precioPropuesto,
    descuentoVsMasBaratoPct: descuentoPropuesto ?? '',
    descuentoVigenteVsMasBaratoPct: descVigente ?? '',
    estado,
    motivo,
  });

  for (const mv of unicos) {
    lineasCoin.push({
      sku: p.sku, tienda: mv.store, fecha: FECHA, nombreCompetidor: mv.nombre,
      precioRegular: mv.precioComparador, precioPromo: mv.promoo ?? '', precioListaDIA: mv.lista ?? '',
      tipoCoincidencia: mv.parcial ? 'PARCIAL' : 'EXACTA', nota: mv.nota,
      url: mv.url, categoriaANCA: mv.cat ?? '', codigoANCA: mv.codigo ?? '',
    });
  }
}

// ── Escribir ─────────────────────────────────────────────────────────────────
const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const colsC = ['sku', 'tienda', 'fecha', 'nombreCompetidor', 'precioRegular', 'precioPromo', 'precioListaDIA', 'tipoCoincidencia', 'nota', 'url', 'categoriaANCA', 'codigoANCA'];
writeFileSync('artifacts/catalog-pricing-images-20261024/coincidencias.csv', [colsC.join(',')].concat(lineasCoin.map((r) => colsC.map((c) => q(r[c])).join(','))).join('\n') + '\n');

const colsP = ['sku', 'nombre', 'presentacionTABA', 'costoMayorista', 'pisoMargen', 'precioVigenteTABA', 'estadoPropuesta', 'comparadorMasBarato', 'tiendaMasBarata', 'tipoCoincidencia', 'precioPropuesto', 'descuentoVsMasBaratoPct', 'descuentoVigenteVsMasBaratoPct', 'estado', 'motivo'];
writeFileSync('artifacts/catalog-pricing-images-20261024/propuesta-precios.csv', [colsP.join(',')].concat(propuesta.map((r) => colsP.map((c) => q(r[c])).join(','))).join('\n') + '\n');

writeFileSync('artifacts/catalog-pricing-images-20261024/propuesta-precios.json', JSON.stringify({
  schemaVersion: 1,
  generadoEl: FECHA,
  estadoGeneral: 'pendiente_aprobacion_comercial',
  aviso: 'Archivo SEPARADO del catálogo aprobado. Cargar un precio en la góndola = confirmarlo (CONTRATO-PRECIO-STOCK.md). Nada de este archivo entra en producción sin aprobación explícita del comercio.',
  metodo: 'precio propuesto = objetivo 7% (banda 5–10%) bajo el precio regular más barato verificado hoy (La Anónima Neuquén / DIA Online). Piso de margen del criterio publicado: costo × 1,45 por unidad y × 1,35×unidades para pack, redondeo a $50 hacia arriba (precioDeVenta) — el piso nunca se rompe. Promos y precios tachados quedan fuera del comparador. Coincidencias sin equivalencia exacta no proponen precio.',
  fuentes: {
    laAnonima: { fecha: FECHA, url: URL_ANCA, detalle: 'HTML crudo + CSV por categoría en fuentes/laanonima/; precioRegular = data-precio_anterior (tachado) o data-precio si no hay promo.' },
    diaOnline: { fecha: FECHA, url: URL_DIA, detalle: 'API VTEX por consulta (fuentes/dia/*.json); comparador = precio de venta efectivo del día; precioLista registrado aparte.' },
    pedidosYa: { fecha: 'NO VERIFICABLE HOY (403 a agentes automatizados); antecedentes históricos 2026-10-10 etiquetados como históricos, no comparable como vigente.' },
  },
  filas: propuesta,
}, null, 2));

console.log(`coincidencias: ${lineasCoin.length} filas · propuesta: ${propuesta.length} SKU`);
const resumen = {};
for (const pr of propuesta) resumen[pr.estado] = (resumen[pr.estado] ?? 0) + 1;
console.log('estados:', JSON.stringify(resumen, null, 2));
const sinEstrito = propuesta.filter((r) => r.estado === 'propuesto' || r.estado === 'propuesto_en_piso_margen');
console.log(`\nSKU con propuesta concreta: ${sinEstrito.length}`);
for (const pr of sinEstrito) console.log(`  ${pr.sku}: vigente $${pr.precioVigenteTABA} → propuesto $${pr.precioPropuesto} (más barato $${pr.comparadorMasBarato} en ${pr.tiendaMasBarata}, -${pr.descuentoVsMasBaratoPct}%)`);
