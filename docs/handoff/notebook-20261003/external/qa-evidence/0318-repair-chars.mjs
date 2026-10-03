// Repara los cinco caracteres no-Latin1 que se perdieron en la conversión previa.
import { readFileSync, writeFileSync } from 'node:fs';

const FIXES = [
  [/TABA \uFFFD\u001D Cat/g, 'TABA \u2014 Cat'],          // em dash
  [/\uFFFDR\u001E/g, '\u2304'],                            // chevron del selector de orden
  [/\uFFFD\uFFFD\u0019/g, '\u2212'],                       // signo menos del stepper
  [/\uFFFDaltimas/g, '\u00DAltimas'],                      // Últimas
];

for (const f of [
  'C:/1212/artifacts/taba-opus-design-review/prototype-catalog-mobile.html',
  'C:/1212/artifacts/taba-opus-design-review/prototype-catalog-desktop.html',
]) {
  let s = readFileSync(f, 'utf8');
  for (const [re, to] of FIXES) s = s.replace(re, to);
  const left = (s.match(/[\uFFFD\u0080-\u009F]/g) || []).length;
  writeFileSync(f, s, 'utf8');
  console.log(`${f.split('/').pop()}: caracteres dañados restantes = ${left}`);
}
