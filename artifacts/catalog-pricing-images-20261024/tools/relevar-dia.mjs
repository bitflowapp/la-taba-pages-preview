// Relevador de precios DIA Online (API VTEX), por consulta SKU a SKU.
// Guarda JSON crudo por consulta + CSV consolidado (precio efectivo y precio de lista).
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', 'Accept': 'application/json' };
const HOST = 'https://diaonline.supermercadosdia.com.ar/api/catalog_system/pub/products/search';

// Una consulta por SKU publicable de La Taba. Tokens precisos para limitar variantes.
export const CONSULTAS = [
  { sku: 'coca-cola-original-2250ml', ft: 'coca cola 2.25' },
  { sku: 'coca-cola-zero-2250ml', ft: 'coca cola zero 2.25' },
  { sku: 'coca-cola-original-lata-354ml', ft: 'coca cola 354' },
  { sku: 'coca-cola-zero-lata-354ml', ft: 'coca cola zero 354' },
  { sku: 'sprite-original-2250ml', ft: 'sprite 2.25' },
  { sku: 'sprite-zero-2250ml', ft: 'sprite zero 2.25' },
  { sku: 'sprite-original-lata-354ml', ft: 'sprite 354' },
  { sku: 'fanta-naranja-2250ml', ft: 'fanta naranja 2.25' },
  { sku: 'pepsi-original-2000ml', ft: 'pepsi 2 l' },
  { sku: 'pepsi-black-1500ml', ft: 'pepsi black 1.5' },
  { sku: 'seven-up-original-2000ml', ft: 'seven up 2 l' },
  { sku: 'paso-de-los-toros-tonica-1500ml', ft: 'paso de los toros tonica 1.5' },
  { sku: 'paso-de-los-toros-pomelo-1500ml', ft: 'paso de los toros pomelo 1.5' },
  { sku: 'soda-manaos-sifon-2000ml', ft: 'soda manaos' },
  { sku: 'villa-del-sur-sin-gas-600ml', ft: 'villa del sur 600' },
  { sku: 'villavicencio-sin-gas-1500ml', ft: 'villavicencio 1.5' },
  { sku: 'villavicencio-con-gas-500ml', ft: 'villavicencio 500' },
  { sku: 'benedictino-sin-gas-2250ml', ft: 'benedictino 2.25' },
  { sku: 'aquarius-pera-1500ml', ft: 'aquarius pera' },
  { sku: 'aquarius-manzana-1500ml', ft: 'aquarius manzana' },
  { sku: 'aquarius-pomelo-2250ml', ft: 'aquarius pomelo 2.25' },
  { sku: 'red-bull-original-250ml', ft: 'red bull 250' },
  { sku: 'red-bull-sin-azucar-250ml', ft: 'red bull sugarfree 250' },
  { sku: 'monster-green-zero-473ml', ft: 'monster zero 473' },
  { sku: 'speed-original-473ml', ft: 'speed 473' },
  { sku: 'speed-zero-473ml', ft: 'speed zero 473' },
  { sku: 'gatorade-cool-blue-500ml', ft: 'gatorade cool blue 500' },
  { sku: 'gatorade-manzana-1250ml', ft: 'gatorade manzana 1.25' },
  { sku: 'powerade-mountain-blast-500ml', ft: 'powerade 500' },
  { sku: 'quilmes-clasica-lata-473ml', ft: 'quilmes 473' },
  { sku: 'quilmes-clasica-botella-710ml', ft: 'quilmes 710' },
  { sku: 'brahma-chopp-lata-710ml', ft: 'brahma 710' },
  { sku: 'budweiser-lata-473ml', ft: 'budweiser 473' },
  { sku: 'stella-artois-lata-473ml', ft: 'stella artois 473' },
  { sku: 'corona-extra-botella-330ml', ft: 'corona 330' },
  { sku: 'andes-origen-rubia-lata-473ml', ft: 'andes origen rubia' },
  { sku: 'patagonia-amber-lager-botella-730ml', ft: 'patagonia amber' },
  { sku: 'fernet-branca-1000ml', ft: 'fernet branca 1 l' },
  { sku: 'fernet-1882-750ml', ft: 'fernet 1882 750' },
  { sku: 'gancia-americano-450ml', ft: 'gancia 450' },
  { sku: 'dr-lemon-vodka-pomelo-lata-473ml', ft: 'dr lemon 473' },
  { sku: 'trapiche-origen-malbec-750ml', ft: 'trapiche malbec 750' },
  { sku: 'dada-caramel-750ml', ft: 'dada caramel' },
  { sku: 'cafayate-torrontes-750ml', ft: 'cafayate torrontes' },
  { sku: 'toro-viejo-clasico-tinto-750ml', ft: 'toro viejo 750' },
  { sku: 'toro-tinto-1000ml', ft: 'toro 1 l' },
  { sku: 'gin-gordons-700ml', ft: 'gordons gin 700' },
  { sku: 'vodka-skyy-700ml', ft: 'skyy vodka 700' },
  { sku: 'coca-cola-original-botella-pet-500-ml-pack-x12', ft: 'coca cola 500' },
  { sku: 'sprite-botella-pet-500-ml-pack-x12', ft: 'sprite 500' },
  { sku: 'coca-cola-zero-botella-pet-500-ml-pack-x12', ft: 'coca cola zero 500' },
  { sku: 'fanta-naranja-pet-1500ml-pack-6', ft: 'fanta 1.5' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.argv[1].replace(/\\/g, '/').endsWith('relevar-dia.mjs')) {
  const dir = process.argv[2] ?? 'artifacts/catalog-pricing-images-20261024/fuentes/dia';
  mkdirSync(dir, { recursive: true });
  const fecha = new Date().toISOString().slice(0, 10);
  const all = [];
  for (const c of CONSULTAS) {
    try {
      const url = `${HOST}?ft=${encodeURIComponent(c.ft)}&_from=0&_to=15`;
      const r = await fetch(url, { headers: UA });
      const j = await r.json();
      writeFileSync(`${dir}/${c.sku}.json`, JSON.stringify(j));
      console.log(`${c.sku}: ${j.length} resultados`);
    } catch (e) {
      console.log(`${c.sku}: ERROR ${e.message}`);
    }
    await sleep(350);
  }
  // Consolidar
  const { readdirSync, readFileSync } = await import('node:fs');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const sku = f.replace('.json', '');
    const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
    for (const p of j) {
      const it = (p.items || [])[0];
      const seller = it && (it.sellers || []).find((s) => s.commertialOffer?.Price > 0);
      if (!seller) continue;
      all.push({
        skuBuscado: sku,
        producto: p.productName,
        precio: seller.commertialOffer.Price,
        precioLista: seller.commertialOffer.ListPrice ?? '',
        disponibilidad: seller.commertialOffer.Availability ?? '',
        referencias: (it.references || []).map((x) => `${x.Key}=${x.Value}`).join('; '),
        url: `https://diaonline.supermercadosdia.com.ar/${p.linkText || p.link}/p`,
        fecha,
      });
    }
  }
  const cols = ['skuBuscado', 'producto', 'precio', 'precioLista', 'disponibilidad', 'referencias', 'url', 'fecha'];
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.join(',')].concat(all.map((r) => cols.map((c) => q(r[c])).join(','))).join('\n');
  writeFileSync(`${dir}/resultados.csv`, csv + '\n');
  console.log(`TOTAL filas: ${all.length}`);
}
