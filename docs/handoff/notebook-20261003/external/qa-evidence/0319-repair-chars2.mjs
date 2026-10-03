// Segunda pasada: › (U+203A) se convirtió en ⬺ (U+2B3A) en el round-trip latin1.
// Además audita cualquier símbolo alto inesperado que haya quedado.
import { readFileSync, writeFileSync } from 'node:fs';

const EXPECTED = new Set(['\u00B7', '\u203A', '\u2014', '\u2304', '\u2212', '\u00A0']);

for (const f of [
  'C:/1212/artifacts/taba-opus-design-review/prototype-catalog-mobile.html',
  'C:/1212/artifacts/taba-opus-design-review/prototype-catalog-desktop.html',
  'C:/1212/artifacts/taba-opus-design-review/prototype-business-mobile.html',
  'C:/1212/artifacts/taba-opus-design-review/prototype-business-desktop.html',
]) {
  let s = readFileSync(f, 'utf8');
  s = s.replace(/\u2B3A/g, '\u203A');
  writeFileSync(f, s, 'utf8');

  const stray = new Map();
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c > 0x2000 && !EXPECTED.has(ch)) stray.set(ch, (stray.get(ch) || 0) + 1);
  }
  const name = f.split('/').pop();
  if (!stray.size) {
    console.log(`${name}: OK`);
  } else {
    for (const [ch, n] of stray) {
      console.log(`${name}: inesperado ${JSON.stringify(ch)} U+${ch.codePointAt(0).toString(16).toUpperCase()} x${n}`);
    }
  }
}
