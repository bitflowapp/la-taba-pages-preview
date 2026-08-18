/*
 * El contrato de la PWA que no se puede probar con objetos falsos: el manifest,
 * los iconos que se publican de verdad y el texto que el shell sirve.
 *
 * Esto no duplica `pwa-install.test.mjs` —ahí está la decisión— sino que cubre
 * lo que sólo se rompe en el archivo: un icono regenerado y no commiteado, un
 * `apple-touch-icon` que vuelve a apuntar a un SVG, una copia que deja de decir
 * "La Taba", o un módulo nuevo que se olvida del precache.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { renderAppIcon } from '../scripts/build-brand-app-icons.mjs';
import {
  APP_ICON_FILES,
  MARK_RATIO,
  MARK_SCALE,
  TABA_RED,
  tabaMarkPath,
} from '../scripts/lib/taba-app-icon.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const indexHtml = read('index.html');
const worker = read('sw.js');

/* ── Manifest ───────────────────────────────────────────────────────────── */

test('manifest: la identidad de instalación es "La Taba" en los dos nombres', () => {
  assert.equal(manifest.name, 'La Taba');
  assert.equal(manifest.short_name, 'La Taba');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.orientation, 'portrait');
  assert.equal(manifest.lang, 'es-AR');
  assert.ok(manifest.description);
});

test('manifest: alcance y arranque son RELATIVOS', () => {
  // El sitio se publica en la raíz de Cloudflare Pages y bajo un subdirectorio
  // en GitHub Pages. Una ruta absoluta funciona en uno y rompe el alcance en el
  // otro: la app instalada se saldría de su propio scope en la primera
  // navegación. `check-static-assets.mjs` cubre lo mismo para los iconos.
  assert.equal(manifest.scope, './');
  assert.equal(manifest.start_url, './index.html');
  assert.equal(manifest.id, undefined, 'sin `id`: el implícito es start_url y así no se pierde la identidad de quien ya la instaló');
});

test('manifest: fondo rojo TABA y tema igual al del documento', () => {
  assert.equal(manifest.background_color, TABA_RED);
  const metaTheme = indexHtml.match(/<meta name="theme-color" content="([^"]+)"/)?.[1];
  assert.equal(
    manifest.theme_color,
    metaTheme,
    'el tema del manifest y el del documento pintan la misma barra: divergir deja dos colores según si está instalada o no',
  );
});

test('manifest: 192 y 512, con maskable propio y todo en PNG', () => {
  const porProposito = (purpose) => manifest.icons.filter((icon) => icon.purpose === purpose);
  for (const purpose of ['any', 'maskable']) {
    const tamaños = porProposito(purpose).map((icon) => icon.sizes).sort();
    assert.deepEqual(tamaños, ['192x192', '512x512'], `faltan tamaños para purpose=${purpose}`);
  }
  for (const icon of manifest.icons) {
    assert.equal(icon.type, 'image/png');
    assert.ok(!icon.src.startsWith('/'), `${icon.src} tiene que ser relativo`);
    assert.ok(fs.existsSync(path.join(ROOT, icon.src)), `falta ${icon.src}`);
  }
  // Un maskable y un `any` no pueden ser el mismo archivo: el `any` lleva
  // esquinas redondeadas y la máscara de Android las recortaría dos veces.
  const any = new Set(porProposito('any').map((icon) => icon.src));
  for (const icon of porProposito('maskable')) assert.ok(!any.has(icon.src));
});

test('manifest: cada icono declara el tamaño que realmente tiene el archivo', async () => {
  for (const icon of manifest.icons) {
    const [ancho, alto] = icon.sizes.split('x').map(Number);
    const meta = await sharp(path.join(ROOT, icon.src)).metadata();
    assert.equal(meta.width, ancho, `${icon.src} mide ${meta.width} y declara ${ancho}`);
    assert.equal(meta.height, alto, `${icon.src} mide ${meta.height} y declara ${alto}`);
    assert.equal(meta.format, 'png');
  }
});

/* ── Iconos ─────────────────────────────────────────────────────────────── */

test('iconos: los archivos publicados son los que produce la geometría declarada', async () => {
  // Equivale a `node scripts/build-brand-app-icons.mjs --check`, pero adentro
  // del gate: los PNG son binarios versionados y un retoque de la geometría sin
  // regenerar deja el repositorio publicando un icono que ya no existe en el código.
  for (const file of APP_ICON_FILES) {
    const destino = path.join(ROOT, file.path);
    assert.ok(fs.existsSync(destino), `falta ${file.path}`);
    const esperado = await renderAppIcon(file);
    assert.ok(fs.readFileSync(destino).equals(esperado), `${file.path} no coincide con la geometría declarada`);
  }
});

test('iconos: la T del maskable entra entera en la zona segura de Android', () => {
  // Android sólo garantiza el círculo centrado de diámetro 80 % del lienzo.
  // Todo lo de afuera lo puede recortar cualquier máscara del fabricante.
  const lado = 512;
  const ancho = lado * MARK_SCALE.maskable;
  const alto = ancho * MARK_RATIO.aspect;
  const mediaDiagonal = Math.hypot(ancho / 2, alto / 2);
  const radioSeguro = lado * 0.4;
  assert.ok(
    mediaDiagonal < radioSeguro,
    `la T sobresale de la zona segura: ${mediaDiagonal.toFixed(1)} >= ${radioSeguro}`,
  );
});

test('iconos: el maskable va a sangre y el de Apple no lleva alfa', async () => {
  const maskable = await sharp(path.join(ROOT, 'assets/brand/taba-app-icon-maskable-512.png'))
    .raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => {
    const i = (y * maskable.info.width + x) * maskable.info.channels;
    return [...maskable.data.slice(i, i + 3)];
  };
  const rojo = [208, 0, 13];
  for (const [x, y] of [[1, 1], [510, 1], [1, 510], [510, 510]]) {
    assert.deepEqual(pixel(x, y), rojo, `la esquina (${x},${y}) del maskable no es rojo pleno`);
  }
  // La T sigue estando: el centro es blanco.
  assert.deepEqual(pixel(256, 256), [255, 255, 255]);

  // iOS pinta NEGRO detrás de un `apple-touch-icon` con canal alfa.
  const apple = await sharp(path.join(ROOT, 'assets/brand/taba-app-icon-apple-180.png')).metadata();
  assert.equal(apple.hasAlpha, false);
  assert.equal(apple.width, 180);
});

test('iconos: la T es la MISMA que ya estaba aprobada en assets/icon.svg', () => {
  // El trazo original vive en `assets/icon.svg` y de ahí salieron las tres
  // proporciones. Reproducirlo con la función demuestra que no se dibujó otra T.
  const original = 'M216 266h80v22h-28v44h-24v-44h-28v-22Z';
  assert.ok(read('assets/icon.svg').includes(original), 'cambió la T de referencia');
  const reproducida = tabaMarkPath({ cx: 256, cy: 299, width: 80 });
  assert.equal(reproducida, 'M216 266h80v22h-28v44h-24v-44h-28Z');
});

/* ── Documento ──────────────────────────────────────────────────────────── */

test('index.html: el apple-touch-icon es un PNG de 180, no un SVG', () => {
  const link = indexHtml.match(/<link rel="apple-touch-icon"[^>]*>/)?.[0] || '';
  assert.ok(link.includes('sizes="180x180"'), 'falta el tamaño declarado');
  assert.ok(/href="[^"]+\.png"/.test(link), `iOS ignora un apple-touch-icon en SVG: ${link}`);
  const href = link.match(/href="([^"]+)"/)?.[1];
  assert.ok(fs.existsSync(path.join(ROOT, href)));
});

test('index.html: la etiqueta de iOS dice lo mismo que short_name', () => {
  const title = indexHtml.match(/<meta name="apple-mobile-web-app-title" content="([^"]+)"/)?.[1];
  assert.equal(title, manifest.short_name);
  assert.ok(indexHtml.includes('<link rel="manifest" href="manifest.webmanifest" />'));
  assert.ok(indexHtml.includes('name="apple-mobile-web-app-capable" content="yes"'));
  assert.ok(indexHtml.includes('name="mobile-web-app-capable" content="yes"'));
});

test('el shell sirve la invitación con el texto acordado, en sus tres caras', () => {
  for (const vista of ['android', 'ios', 'ios-steps']) {
    assert.ok(indexHtml.includes(`data-install-view="${vista}"`), `falta la cara ${vista}`);
  }
  for (const copia of [
    'Llevá La Taba con vos',
    'Agregá La Taba a tu celular para entrar más rápido a tus pedidos.',
    'Instalar La Taba',
    'Ahora no',
    'Agregá La Taba a tu inicio',
    'Tené La Taba como una app en tu iPhone.',
    'Ver cómo',
    'Agregar a pantalla de inicio',
  ]) {
    assert.ok(indexHtml.includes(copia), `falta la copia: ${copia}`);
  }
  // Los tres pasos, en orden y numerados por CSS.
  assert.match(indexHtml, /Tocá el botón <strong>Compartir<\/strong>/);
  assert.match(indexHtml, /Confirmá <strong>Agregar<\/strong>/);
  assert.ok(read('styles/common.css').includes('counter-increment: install-step'));
});

test('la entrada permanente vive en el Perfil y nace oculta', () => {
  const perfil = indexHtml.slice(indexHtml.indexOf('data-view="profile"'));
  const tarjeta = perfil.slice(0, perfil.indexOf('</section>'));
  assert.ok(tarjeta.includes('data-install-entry'), 'la tarjeta no está en la vista Perfil');
  assert.match(tarjeta, /data-install-entry hidden/, 'tiene que nacer oculta: la muestra la detección');
  assert.ok(tarjeta.includes('data-install-entry-action'));
});

test('no quedan los dos avisos finos que reemplazó la hoja', () => {
  for (const muerto of ['data-pwa-install-banner', 'data-pwa-ios-banner', 'pwa-ios-steps']) {
    assert.ok(!indexHtml.includes(muerto), `${muerto} sigue en el shell`);
  }
  const common = read('styles/common.css');
  for (const muerto of ['.pwa-banner-install', '.pwa-banner-ios', '.pwa-banner-icon', '.pwa-ios-steps']) {
    assert.ok(!common.includes(muerto), `${muerto} quedó como CSS muerto`);
  }
});

/* ── Worker y disciplina del módulo ─────────────────────────────────────── */

test('el precache incluye el módulo de la invitación y el icono que la hoja pinta', () => {
  assert.ok(worker.includes("'./js/pwa-install-ui.js'"));
  assert.ok(worker.includes("'./js/core/pwa-install.js'"));
  assert.ok(worker.includes("'./assets/brand/taba-app-icon-192.png'"));
  assert.ok(worker.includes("'./manifest.webmanifest'"));
});

test('el worker no guarda ni pedidos ni sesiones: sólo el mismo origen y sólo GET', () => {
  // La instalación no puede convertirse en una caché de datos vivos. El worker
  // se sale de cualquier petición que no sea GET del propio origen, y Supabase
  // —pedidos, identidad, seguimiento— vive en OTRO origen.
  assert.ok(worker.includes("if (request.method !== 'GET') return;"));
  assert.ok(worker.includes("if (url.origin !== self.location.origin) return;"));
  // Y las dos rutas que sí son del origen pero llevan datos en la query se
  // excluyen explícitamente de la escritura.
  assert.ok(worker.includes('if (paymentReturnState(request)) return;'));
  assert.ok(worker.includes('if (esAccionDeCuenta(request)) return;'));
});

test('el olfateo de user agent vive en un solo archivo', () => {
  const propios = [];
  const recorrer = (dir) => {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const absoluto = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        // El bundle de Supabase es de terceros y no es código nuestro.
        if (entrada.name !== 'vendor') recorrer(absoluto);
        continue;
      }
      if (!entrada.name.endsWith('.js')) continue;
      if (fs.readFileSync(absoluto, 'utf8').includes('userAgent')) {
        propios.push(path.relative(ROOT, absoluto).replaceAll('\\', '/'));
      }
    }
  };
  recorrer(path.join(ROOT, 'js'));
  assert.deepEqual(propios, ['js/core/pwa-install.js']);
});

test('la interfaz de instalación no usa diálogos del navegador', () => {
  const ui = read('js/pwa-install-ui.js');
  for (const prohibido of ['alert(', 'confirm(', 'window.prompt(']) {
    assert.ok(!ui.includes(prohibido), `${prohibido} no puede aparecer en la invitación`);
  }
  // El único `prompt()` admitido es el nativo de instalación, sobre el evento.
  assert.ok(ui.includes('await prompt.prompt()'));
});
