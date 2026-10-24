/*
 * Comparación antes/después del rediseño UX (2026-10-24).
 *
 * Toma las capturas crudas de capturas/antes y capturas/despues (PNG a
 * densidad 2 o 1,5, decenas de MB) y genera comparacion/ con WebP reducidos y
 * un index.html estático que los pone lado a lado. Sólo lo de comparacion/ se
 * versiona; las PNG crudas quedan fuera del commit.
 */
import sharp from 'sharp';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BASE = path.resolve(AQUI, '..');
const OUT = path.join(BASE, 'comparacion');

const PARES = [
  ['vitrina-m-gondola-top', 'Catálogo · teléfono 390', 'Tarjetas de 384→~300px: precio y botón entran en la primera pantalla; orden al lado del título; pastilla «Recomendado» fuera de la foto.'],
  ['demo-m-historia', 'Historias · teléfono 390', 'Pantalla completa 9:16 con la pieza entera; título, acción y navegación sobre degradado; tocar izquierda/derecha navega.'],
  ['demo-d-historia', 'Historias · escritorio 1280', 'Marco 9:16 centrado en lugar de tarjeta con la imagen recortada a 4:5.'],
  ['vitrina-d-gondola-top', 'Catálogo · escritorio 1280', 'Mismo presupuesto de columnas (tarjeta ≥250px), tarjetas más compactas: foto cuadrada a ras, nombre/presentación juntos, pastilla fuera de la foto; entran más productos por pantalla.'],
  ['vitrina-m-carrito', 'Carrito · teléfono 390', 'Líneas en dos renglones (foto · nombre/cantidad · importe), mínimo alcanzado sin barra llena.'],
  ['vitrina-m-checkout', 'Entrega · teléfono 390', 'Delivery / Retiro como control segmentado: la opción elegida se ve elegida.'],
  ['vitrina-d-checkout', 'Carrito y entrega · escritorio 1280', 'El resumen de productos acompaña el scroll del formulario.'],
  ['vitrina-m-ficha', 'Ficha · teléfono 390', 'Disponibilidad como pastilla alineada al precio; observación en un renglón.'],
  ['vitrina-d-home-full', 'Inicio · escritorio 1280 (página completa)', 'Home a todo el ancho útil, rieles de 5 tarjetas parejas, combo con ancho de tarjeta.'],
  ['vitrina-m-home-full', 'Inicio · teléfono 390 (página completa)', 'Mismo ritmo de tarjetas y chips que el catálogo.'],
];

mkdirSync(path.join(OUT, 'antes'), { recursive: true });
mkdirSync(path.join(OUT, 'despues'), { recursive: true });

const filas = [];
for (const [nombre, titulo, nota] of PARES) {
  const lados = {};
  for (const etapa of ['antes', 'despues']) {
    const origen = path.join(BASE, 'capturas', etapa, `${nombre}.png`);
    if (!existsSync(origen)) throw new Error(`falta ${origen}`);
    const destino = path.join(OUT, etapa, `${nombre}.webp`);
    const full = nombre.endsWith('-full');
    const movil = nombre.includes('-m-');
    // Ancho de lectura: móvil a 390 css, escritorio a 960; las de página
    // completa más chicas porque son muy altas.
    const ancho = movil ? (full ? 360 : 520) : (full ? 900 : 1280);
    const imagen = sharp(origen).resize({ width: ancho, withoutEnlargement: true });
    await imagen.webp({ quality: full ? 62 : 74, effort: 5 }).toFile(destino);
    const meta = await sharp(destino).metadata();
    lados[etapa] = { src: `${etapa}/${nombre}.webp`, w: meta.width, h: meta.height };
  }
  filas.push({ nombre, titulo, nota, ...lados });
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>La Taba · antes y después UX</title>
<style>
  :root { color-scheme: dark; --bg:#0f1216; --card:#181c22; --ink:#f3f3f3; --muted:#a8abb2; --red:#d0000d; --line:rgb(255 255 255 / 10%); }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 system-ui, "Segoe UI", Roboto, sans-serif; }
  header { padding: 28px 16px 8px; max-width: 1400px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 26px; letter-spacing: -.02em; }
  header p { margin: 0; color: var(--muted); }
  main { display: grid; gap: 28px; max-width: 1400px; margin: 0 auto; padding: 16px; }
  section { padding: 16px; border: 1px solid var(--line); border-radius: 18px; background: var(--card); }
  h2 { margin: 0 0 2px; font-size: 18px; }
  .nota { margin: 0 0 14px; color: var(--muted); }
  .par { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
  figure { margin: 0; }
  figcaption { margin-bottom: 6px; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  figure.despues figcaption { color: #ff6b72; }
  img { display: block; width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--line); }
  .movil .par { max-width: 760px; }
  .full img { max-height: 1400px; object-fit: cover; object-position: top; }
  @media (max-width: 640px) { .par { gap: 8px; } }
</style>
</head>
<body>
<header>
  <h1>La Taba · antes y después</h1>
  <p>Rama <code>feature/ux-premium-storefront-20261024</code> sobre <code>ec4962e1</code>. Capturas reales con Playwright, mismo recorrido y mismo catálogo (vitrina Neuquén y demo de historias). Antes = <code>ec4962e1</code>.</p>
</header>
<main>
${filas.map((f) => `  <section class="${f.nombre.includes('-m-') ? 'movil' : 'escritorio'}${f.nombre.endsWith('-full') ? ' full' : ''}">
    <h2>${esc(f.titulo)}</h2>
    <p class="nota">${esc(f.nota)}</p>
    <div class="par">
      <figure class="antes"><figcaption>Antes</figcaption><img src="${f.antes.src}" width="${f.antes.w}" height="${f.antes.h}" alt="Antes: ${esc(f.titulo)}" loading="lazy"></figure>
      <figure class="despues"><figcaption>Después</figcaption><img src="${f.despues.src}" width="${f.despues.w}" height="${f.despues.h}" alt="Después: ${esc(f.titulo)}" loading="lazy"></figure>
    </div>
  </section>`).join('\n')}
</main>
</body>
</html>
`;
writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`comparación: ${filas.length} pares en ${OUT}`);
