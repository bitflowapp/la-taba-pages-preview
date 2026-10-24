// Relevador de precios de La Anónima (Neuquén Capital, sucursal default del sitio).
// Guarda HTML crudo por categoría + CSV de productos con precio regular separado del promocional.
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

export const CATEGORIAS = [
  { slug: 'gaseosas-regulares', url: 'https://www.laanonima.com.ar/regulares/n3_849/' },
  { slug: 'gaseosas-dieteticas', url: 'https://www.laanonima.com.ar/dieteticas/n3_848/' },
  { slug: 'aguas-sin-gas', url: 'https://www.laanonima.com.ar/aguas-sin-gas/n3_854/' },
  { slug: 'aguas-con-gas', url: 'https://www.laanonima.com.ar/aguas-con-gas/n3_855/' },
  { slug: 'aguas-saborizadas-y-jugos', url: 'https://www.laanonima.com.ar/aguas-saborizadas-y-jugos/n3_853/' },
  { slug: 'isotonicas-y-energizantes', url: 'https://www.laanonima.com.ar/isotonicas-y-energizantes/n2_546/' },
  { slug: 'cervezas', url: 'https://www.laanonima.com.ar/cervezas/n2_540/' },
  { slug: 'vinos-tintos', url: 'https://www.laanonima.com.ar/tintos/n3_661/' },
  { slug: 'vinos-blancos', url: 'https://www.laanonima.com.ar/blancos-y-rosados/n3_850/' },
  { slug: 'fernet-y-aperitivos', url: 'https://www.laanonima.com.ar/fernet-y-aperitivos/n2_544/' },
  { slug: 'blancas-y-whiskies', url: 'https://www.laanonima.com.ar/blancas-y-whiskies/n2_545/' },
];

const attr = (html, name, from) => {
  const re = new RegExp(`data-${name}\\s*=\\s*"([^"]*)"`, 'g');
  re.lastIndex = from;
  const m = re.exec(html);
  return m ? m[1] : '';
};

export function parseTarjetas(html) {
  const cards = [];
  const reMar = /data-nombre\s*=\s*"[^"]*"/g;
  let m;
  while ((m = reMar.exec(html)) !== null) {
    const at = m.index;
    const nombre = attr(html, 'nombre', at);
    if (!nombre) continue;
    const fin = html.indexOf('</a>', at) > 0 ? html.indexOf('</a>', at) : at + 20000;
    const bloque = html.slice(at, fin + 4);
    const precio = attr(html, 'precio', at);
    const anterior = attr(html, 'precio_anterior', at);
    const oferta = attr(html, 'precio_oferta', at);
    const marca = attr(html, 'marca', at);
    const ruta = attr(html, 'rutacategorias', at);
    const codigo = attr(html, 'codigo', at);
    const refLIT = /leyenda-precio-referencia">?\s*([^<]+)</.exec(bloque);
    const llevando = /Llevando[^<]{0,40}/.exec(bloque);
    const promoLeyenda = /promo\w*"[^>]*>\s*([^<]{3,80})</i.exec(bloque);
    const urlM = /(https:\/\/www\.laanonima\.com\.ar\/[a-z0-9-]+\/art_\d+\/)/.exec(html.slice(Math.max(0, at - 3000), at + 4000));
    cards.push({
      nombre,
      marca,
      ruta,
      codigo,
      precioRegular: anterior && Number(anterior) !== Number(precio) ? Number(anterior) : Number(precio),
      precioPromo: oferta && Number(oferta) !== (anterior && Number(anterior) !== Number(precio) ? Number(anterior) : Number(precio)) ? Number(oferta) : '',
      promoCondicion: (llevando?.[0] ?? promoLeyenda?.[1] ?? '').trim(),
      precioPorLitro: refLIT ? refLIT[1].trim() : '',
      url: urlM ? urlM[1] : '',
    });
  }
  return cards;
}

const OUT = process.argv[2] ?? 'artifacts/catalog-pricing-images-20261024/fuentes/laanonima';
mkdirSync(OUT, { recursive: true });

// CLI: node relevar-laanonima.mjs [dir-salida]
if (process.argv[1].replace(/\\/g, '/').endsWith('relevar-laanonima.mjs')) {
  const dir = OUT;
  for (const c of CATEGORIAS) {
    try {
      const r = await fetch(c.url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-AR,es;q=0.9' } });
      const html = await r.text();
      writeFileSync(`${dir}/${c.slug}.html`, html);
      const cards = parseTarjetas(html);
      const csv = [
        'categoria,slug_url,nombre,marca,ruta,codigo,precioRegular,precioPromo,condicionPromo,precioPorUnidad,url,fecha',
      ];
      const fecha = new Date().toISOString().slice(0, 10);
      for (const k of cards) {
        const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        csv.push([q(c.slug), q(c.url), q(k.nombre), q(k.marca), q(k.ruta), q(k.codigo), k.precioRegular, k.precioPromo === '' ? '' : k.precioPromo, q(k.promoCondicion), q(k.precioPorLitro), q(k.url), fecha].join(','));
      }
      writeFileSync(`${dir}/${c.slug}.csv`, csv.join('\n') + '\n');
      console.log(`${c.slug}: ${cards.length} productos (HTTP ${r.status})`);
    } catch (e) {
      console.log(`${c.slug}: ERROR ${e.message}`);
    }
  }
}
