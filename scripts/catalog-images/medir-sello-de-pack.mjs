/*
 * ¿El packshot de la fuente oficial trae un sello de cantidad quemado encima, y
 * pisa el envase?
 *
 * POR QUÉ HAY QUE MEDIR ESTO
 * --------------------------
 * La tienda del embotellador publica packs, no unidades, y su packshot es la
 * foto de UNA botella con un sello «x6» o «x12» estampado al lado. Para un SKU
 * que se vende de a seis, ese sello es verdad y la foto sirve —los cuatro packs
 * publicados salen justamente de ahí—. Para una unidad suelta, el mismo archivo
 * le promete al cliente seis botellas por el precio de una.
 *
 * La pregunta que decide si esas fotos se pueden reutilizar para unidades es
 * geométrica, no de criterio: si el sello estuviera apoyado sobre fondo blanco
 * limpio, borrarlo devolvería el packshot del fabricante intacto. Si pisa el
 * envase, borrarlo obliga a inventar los píxeles que tapa, y eso ya no es el
 * packshot de nadie: es un render sintético que se puede confundir con el
 * envase real.
 *
 * CÓMO LO MIDE
 * ------------
 * 1. Máscara de tinta: todo lo que no es fondo blanco.
 * 2. El sello es un disco de rojo PLANO —sin degradé, porque es vectorial— y
 *    eso lo separa del rojo fotografiado de una etiqueta Coca-Cola, que tiene
 *    sombra. Se prueban los rojos saturados más repetidos, uno por uno con
 *    tolerancia estrecha, hasta que alguno dé un disco.
 * 3. Circularidad: área sobre el área del círculo que encierra su bbox. Un
 *    disco da ~0,79 antes de descontar las letras caladas.
 * 4. Solapamiento: se borra el disco de la máscara de tinta y se mira si el
 *    envase queda partido en dos o pierde píxeles adentro del disco. Si el
 *    sello sólo tocara fondo blanco, sacarlo dejaría el envase entero.
 *
 * No decide nada por su cuenta y no escribe en catálogo: emite la medición para
 * que quede versionada como evidencia.
 *
 *   node scripts/catalog-images/medir-sello-de-pack.mjs <archivo...>
 *   node scripts/catalog-images/medir-sello-de-pack.mjs --json <archivo...>
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import process from 'node:process';
import sharp from 'sharp';

const BLANCO = 244;
/** Cuán lejos puede estar un píxel del tono probado para seguir siendo el sello. */
const TOLERANCIA_PLANA = 10;
/** Un disco perfecto da 0,785; las letras caladas y el borde bajan un poco. */
const CIRCULARIDAD_MINIMA = 0.58;

export function mascaraDeTinta(data, ancho, alto, canales, umbral = BLANCO) {
  const mascara = new Uint8Array(ancho * alto);
  for (let i = 0; i < ancho * alto; i += 1) {
    const r = data[i * canales];
    const g = data[i * canales + 1];
    const b = data[i * canales + 2];
    const a = canales === 4 ? data[i * canales + 3] : 255;
    if (a < 16) continue;
    if (r >= umbral && g >= umbral && b >= umbral) continue;
    mascara[i] = 1;
  }
  return mascara;
}

/** Componentes conexos de 8 vecinos. Devuelve etiquetas y sus cajas. */
export function componentes(mascara, ancho, alto) {
  const etiqueta = new Int32Array(ancho * alto).fill(-1);
  const cajas = [];
  const pila = [];
  for (let inicio = 0; inicio < ancho * alto; inicio += 1) {
    if (!mascara[inicio] || etiqueta[inicio] !== -1) continue;
    const id = cajas.length;
    const caja = { id, px: 0, x0: ancho, y0: alto, x1: -1, y1: -1 };
    etiqueta[inicio] = id;
    pila.push(inicio);
    while (pila.length) {
      const p = pila.pop();
      const x = p % ancho;
      const y = (p / ancho) | 0;
      caja.px += 1;
      if (x < caja.x0) caja.x0 = x;
      if (x > caja.x1) caja.x1 = x;
      if (y < caja.y0) caja.y0 = y;
      if (y > caja.y1) caja.y1 = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= ancho || ny >= alto) continue;
          const np = ny * ancho + nx;
          if (mascara[np] && etiqueta[np] === -1) {
            etiqueta[np] = id;
            pila.push(np);
          }
        }
      }
    }
    cajas.push(caja);
  }
  return { etiqueta, cajas };
}

/*
 * Los rojos saturados más repetidos, cuantizados de a 8 y de mayor a menor.
 *
 * Se devuelven VARIOS y no sólo el modal porque la etiqueta de una Coca-Cola es
 * roja y grande: en la botella de 1,5 L el rojo más repetido de toda la imagen
 * es el de la etiqueta, no el del sello, y quedarse con el primero daba «no hay
 * sello» en la única imagen que el cliente había señalado con nombre y apellido.
 */
function rojosCandidatos(data, ancho, alto, canales, cuantos = 8) {
  const cuenta = new Map();
  for (let i = 0; i < ancho * alto; i += 1) {
    const r = data[i * canales];
    const g = data[i * canales + 1];
    const b = data[i * canales + 2];
    if (r < 170 || g > 110 || b > 110) continue;
    const clave = `${r >> 3}|${g >> 3}|${b >> 3}`;
    cuenta.set(clave, (cuenta.get(clave) || 0) + 1);
  }
  return [...cuenta.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cuantos)
    .map(([clave, px]) => {
      const [r, g, b] = clave.split('|').map((valor) => (Number(valor) << 3) + 4);
      return { b, g, px, r };
    });
}

/** Rellena los agujeros de un componente dentro de su caja (las letras caladas). */
function discoLleno(caja) {
  const ancho = caja.x1 - caja.x0 + 1;
  const alto = caja.y1 - caja.y0 + 1;
  const cx = (caja.x0 + caja.x1) / 2;
  const cy = (caja.y0 + caja.y1) / 2;
  const radio = Math.min(ancho, alto) / 2;
  return { alto, ancho, cx, cy, radio };
}

export async function medirSello(archivo) {
  const bytes = await fs.readFile(archivo);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const imagen = sharp(bytes);
  const meta = await imagen.metadata();
  const { data, info } = await imagen.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: ancho, height: alto, channels: canales } = info;

  const tinta = mascaraDeTinta(data, ancho, alto, canales);
  const base = {
    alto,
    ancho,
    archivo,
    formato: meta.format,
    sha256,
  };
  const rojos = rojosCandidatos(data, ancho, alto, canales);
  if (!rojos.length) return { ...base, selloDetectado: false, motivo: 'no hay rojo plano saturado' };

  let sello = null;
  let rojo = null;
  let etiquetaRoja = null;
  for (const tono of rojos) {
    const planos = new Uint8Array(ancho * alto);
    for (let i = 0; i < ancho * alto; i += 1) {
      const dr = Math.abs(data[i * canales] - tono.r);
      const dg = Math.abs(data[i * canales + 1] - tono.g);
      const db = Math.abs(data[i * canales + 2] - tono.b);
      if (dr <= TOLERANCIA_PLANA && dg <= TOLERANCIA_PLANA && db <= TOLERANCIA_PLANA) planos[i] = 1;
    }
    const { etiqueta, cajas } = componentes(planos, ancho, alto);
    const candidatas = cajas
      .map((caja) => {
        const { ancho: cw, alto: ch, cx, cy, radio } = discoLleno(caja);
        const proporcion = Math.min(cw, ch) / Math.max(cw, ch);
        const circularidad = caja.px / (Math.PI * radio * radio);
        return { ...caja, circularidad, cx, cy, proporcion, radio };
      })
      .filter((caja) => caja.px > 400 && caja.proporcion > 0.85 && caja.circularidad >= CIRCULARIDAD_MINIMA)
      .sort((a, b) => b.px - a.px);
    if (!candidatas.length) continue;
    [sello] = candidatas;
    rojo = tono;
    etiquetaRoja = etiqueta;
    break;
  }

  if (!sello) return { ...base, selloDetectado: false, motivo: 'ningún disco de rojo plano' };

  /*
   * El envase con el sello puesto, y el envase con el sello borrado. Si el
   * sello sólo tocara fondo blanco, las dos siluetas tendrían el mismo alto y
   * el mismo ancho: sacarlo no le quitaría nada al producto.
   */
  const conSello = componentes(tinta, ancho, alto).cajas.sort((a, b) => b.px - a.px)[0];
  const sinSello = new Uint8Array(tinta);
  for (let i = 0; i < ancho * alto; i += 1) {
    if (etiquetaRoja[i] === sello.id) sinSello[i] = 0;
  }
  const restos = componentes(sinSello, ancho, alto).cajas.sort((a, b) => b.px - a.px);
  const envase = restos[0];

  /*
   * El hueco: píxeles de producto que el disco del sello tapa. Se mide sobre el
   * disco lleno —centro y radio—, no sobre los píxeles rojos, porque las letras
   * caladas del sello también tapan envase y no son rojas.
   */
  let productoTapado = 0;
  let discoSobreBlanco = 0;
  const r2 = sello.radio * sello.radio;
  for (let y = Math.max(0, Math.floor(sello.cy - sello.radio)); y <= Math.min(alto - 1, Math.ceil(sello.cy + sello.radio)); y += 1) {
    for (let x = Math.max(0, Math.floor(sello.cx - sello.radio)); x <= Math.min(ancho - 1, Math.ceil(sello.cx + sello.radio)); x += 1) {
      const dx = x - sello.cx;
      const dy = y - sello.cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = y * ancho + x;
      if (sinSello[i]) productoTapado += 1;
      else discoSobreBlanco += 1;
    }
  }

  /*
   * Que el disco toque el envase se decide por el contorno, no por el interior:
   * un sello apoyado sobre blanco tiene TODO su borde sobre blanco.
   */
  let bordeSobreEnvase = 0;
  let bordeMedido = 0;
  for (let paso = 0; paso < 720; paso += 1) {
    const angulo = (paso / 720) * Math.PI * 2;
    const x = Math.round(sello.cx + Math.cos(angulo) * (sello.radio + 2));
    const y = Math.round(sello.cy + Math.sin(angulo) * (sello.radio + 2));
    if (x < 0 || y < 0 || x >= ancho || y >= alto) continue;
    bordeMedido += 1;
    if (sinSello[y * ancho + x]) bordeSobreEnvase += 1;
  }

  const pisaElEnvase = productoTapado > 0 || bordeSobreEnvase > 0;
  return {
    ...base,
    selloDetectado: true,
    sello: {
      centro: [Math.round(sello.cx), Math.round(sello.cy)],
      circularidad: Number(sello.circularidad.toFixed(3)),
      color: `#${[rojo.r, rojo.g, rojo.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`,
      diametroPx: Math.round(sello.radio * 2),
      pxRojos: sello.px,
    },
    siluetas: {
      conSello: conSello ? { alto: conSello.y1 - conSello.y0 + 1, ancho: conSello.x1 - conSello.x0 + 1, px: conSello.px } : null,
      partesTrasBorrar: restos.filter((caja) => caja.px > 400).length,
      sinSello: envase ? { alto: envase.y1 - envase.y0 + 1, ancho: envase.x1 - envase.x0 + 1, px: envase.px } : null,
    },
    solapamiento: {
      bordeMedido,
      bordeSobreEnvase,
      discoSobreBlanco,
      productoTapado,
    },
    pisaElEnvase,
    /*
     * El veredicto describe la GEOMETRÍA y nada más. Si esa foto sirve o no
     * para un SKU concreto depende de cuántas unidades trae ese SKU, y eso lo
     * decide quien la asocia —no el que mide.
     */
    veredicto: pisaElEnvase
      ? 'SELLO_SOBRE_EL_ENVASE: borrarlo obliga a repintar envase'
      : 'SELLO_SOBRE_BLANCO: el sello no toca el envase',
  };
}

if (import.meta.filename === process.argv[1]) {
  const json = process.argv.includes('--json');
  const archivos = process.argv.slice(2).filter((argumento) => !argumento.startsWith('--'));
  if (!archivos.length) {
    console.error('Uso: node scripts/catalog-images/medir-sello-de-pack.mjs [--json] <archivo...>');
    process.exit(2);
  }
  const mediciones = [];
  for (const archivo of archivos) mediciones.push(await medirSello(archivo));
  if (json) {
    console.log(JSON.stringify(mediciones, null, 2));
  } else {
    for (const medicion of mediciones) {
      if (!medicion.selloDetectado) {
        console.log(`${medicion.archivo}: sin sello (${medicion.motivo})`);
        continue;
      }
      console.log(
        `${medicion.archivo}: sello ${medicion.sello.diametroPx}px en `
        + `(${medicion.sello.centro.join(',')}) · tapa ${medicion.solapamiento.productoTapado}px de envase · `
        + `${medicion.solapamiento.bordeSobreEnvase}/${medicion.solapamiento.bordeMedido} del borde sobre el envase · `
        + medicion.veredicto,
      );
    }
  }
}
