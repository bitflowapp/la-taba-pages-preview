// Lee los resúmenes que deja `flutter drive` y saca las cifras que el encargo
// pide, incluidas las que el sumarizador de Flutter no trae hechas: cuántos
// frames pasaron de 16,7 ms y cuántos de 33 ms.
//
//   node resumir-jank.mjs <carpeta-build> [salida.md]
//
// Un frame se cuenta como perdido si CUALQUIERA de sus dos mitades pasó el
// presupuesto. Separarlas importa para atribuir: si el que se pasa es el de
// construcción, el problema está en Dart; si es el de rasterizado, está en el
// dibujo, y ahí es donde aparecen los picos de compilación de shaders.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const carpeta = process.argv[2] ?? 'build';
const salida = process.argv[3];

const PRESUPUESTO = 16.7;
const GRAVE = 33;

const archivos = readdirSync(carpeta)
  .filter((f) => f.endsWith('.timeline_summary.json'))
  .sort();

if (archivos.length === 0) {
  console.error(`no hay resúmenes en ${carpeta}`);
  process.exit(1);
}

const ms = (micros) => micros / 1000;
const pct = (n, total) => (total === 0 ? 0 : (n * 100) / total);
const f2 = (n) => n.toFixed(2);

const filas = [];
let peorGlobal = { escenario: '-', valor: 0, mitad: '-' };

for (const archivo of archivos) {
  const nombre = archivo.replace('.timeline_summary.json', '');
  const s = JSON.parse(readFileSync(join(carpeta, archivo), 'utf8'));

  const build = (s.frame_build_times ?? []).map(ms);
  const raster = (s.frame_rasterizer_times ?? []).map(ms);
  const total = Math.min(build.length, raster.length);
  if (total === 0) {
    filas.push({ nombre, vacio: true });
    continue;
  }

  let sobrePresupuesto = 0;
  let graves = 0;
  let peorBuild = 0;
  let peorRaster = 0;
  for (let i = 0; i < total; i++) {
    const b = build[i];
    const r = raster[i];
    const peor = Math.max(b, r);
    if (peor > PRESUPUESTO) sobrePresupuesto++;
    if (peor > GRAVE) graves++;
    if (b > peorBuild) peorBuild = b;
    if (r > peorRaster) peorRaster = r;
  }

  // Un pico de rasterizado muy por encima de su propia mediana es la firma de
  // una compilación de shader o de una textura que se sube por primera vez.
  const rasterOrdenado = [...raster].sort((a, b) => a - b);
  const medianaRaster = rasterOrdenado[Math.floor(rasterOrdenado.length / 2)];
  const picos = raster.filter((r) => r > Math.max(medianaRaster * 4, GRAVE)).length;

  const peorDelEscenario = Math.max(peorBuild, peorRaster);
  if (peorDelEscenario > peorGlobal.valor) {
    peorGlobal = {
      escenario: nombre,
      valor: peorDelEscenario,
      mitad: peorBuild >= peorRaster ? 'construcción' : 'rasterizado',
    };
  }

  filas.push({
    nombre,
    total,
    build: s.average_frame_build_time_millis,
    build90: s['90th_percentile_frame_build_time_millis'],
    build99: s['99th_percentile_frame_build_time_millis'],
    peorBuild,
    raster: s.average_frame_rasterizer_time_millis,
    raster90: s['90th_percentile_frame_rasterizer_time_millis'],
    raster99: s['99th_percentile_frame_rasterizer_time_millis'],
    peorRaster,
    sobrePresupuesto,
    graves,
    picos,
    jank: pct(sobrePresupuesto, total),
  });
}

const lineas = [];
lineas.push('| escenario | frames | build medio | build p90 | build p99 | peor build | raster medio | raster p90 | raster p99 | peor raster | >16,7 ms | >33 ms | jank | picos raster |');
lineas.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const r of filas) {
  if (r.vacio) {
    lineas.push(`| ${r.nombre} | 0 | — | — | — | — | — | — | — | — | — | — | — | — |`);
    continue;
  }
  lineas.push(
    `| ${r.nombre} | ${r.total} | ${f2(r.build)} | ${f2(r.build90)} | ${f2(r.build99)} | ${f2(r.peorBuild)} | ` +
      `${f2(r.raster)} | ${f2(r.raster90)} | ${f2(r.raster99)} | ${f2(r.peorRaster)} | ` +
      `${r.sobrePresupuesto} | ${r.graves} | ${f2(r.jank)} % | ${r.picos} |`,
  );
}

const medidos = filas.filter((r) => !r.vacio);
const framesTotales = medidos.reduce((a, r) => a + r.total, 0);
const perdidosTotales = medidos.reduce((a, r) => a + r.sobrePresupuesto, 0);
const gravesTotales = medidos.reduce((a, r) => a + r.graves, 0);

lineas.push('');
lineas.push(
  `**Total: ${framesTotales} frames · ${perdidosTotales} por encima de 16,7 ms ` +
    `(${f2(pct(perdidosTotales, framesTotales))} %) · ${gravesTotales} por encima de 33 ms ` +
    `(${f2(pct(gravesTotales, framesTotales))} %).**`,
);
lineas.push('');
lineas.push(
  `Peor frame de toda la corrida: **${f2(peorGlobal.valor)} ms** en ` +
    `\`${peorGlobal.escenario}\`, del lado de ${peorGlobal.mitad}.`,
);

const texto = lineas.join('\n');
console.log(texto);
if (salida) {
  writeFileSync(salida, texto + '\n', 'utf8');
  console.error(`\nescrito en ${salida}`);
}
