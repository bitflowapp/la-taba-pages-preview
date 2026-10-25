// Mediana por perfil de las corridas en frío guardadas por moto-perf.mjs (base contra actual).
import fs from 'node:fs';
const dir = 'artifacts/catalog-transformation-20261024/rendimiento';
const cargar = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, 'utf8')).resultados.filter((r) => r.fria);
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const base = cargar('antes/moto-rendimiento-final-base.json');
const actual = cargar('despues/moto-rendimiento-final-actual.json');
const filas = [];
for (const perfil of ['fast-4g', 'slow-4g']) {
  const b = base.filter((r) => r.perfil === perfil); const a = actual.filter((r) => r.perfil === perfil);
  const campo = (rs, f) => mediana(rs.map(f));
  const m = (nombre, f, unidad = 'ms') => filas.push({ perfil, metrica: nombre, base: campo(b, f), actual: campo(a, f), cambio: `${Math.round(((campo(a, f) - campo(b, f)) / campo(b, f)) * 100)}%`, unidad });
  m('FCP', (r) => r.perf.fcp); m('LCP', (r) => r.perf.lcp.t); m('evento load', (r) => r.loadMs);
  m('peticiones', (r) => r.requests, 'n'); m('KB transferidos', (r) => r.totalKB, 'KB'); m('KB de imagen', (r) => r.porTipo.img?.transferKB ?? 0, 'KB');
  filas.push({ perfil, metrica: 'elemento LCP', base: b[0].perf.lcp.el, actual: a[0].perf.lcp.el, cambio: '', unidad: '' });
}
console.table(filas);
fs.writeFileSync(`${dir}/resumen-frio-base-vs-actual.json`, JSON.stringify(filas, null, 2));
