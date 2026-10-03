import { readFileSync } from 'node:fs';
for (const f of [
  'C:/1212/artifacts/taba-opus-design-review/prototype-catalog-mobile.html',
  'C:/1212/artifacts/taba-opus-design-review/prototype-catalog-desktop.html',
]) {
  const s = readFileSync(f, 'utf8');
  const bad = new Map();
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 0xFFFD || (c >= 0x80 && c <= 0x9F)) {
      bad.set(ch, (bad.get(ch) || 0) + 1);
    }
  }
  console.log(f.split('/').pop());
  for (const [ch, n] of bad) {
    console.log(`  U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} x${n}`);
  }
  // Contexto de cada carácter dañado
  const idx = [...s.matchAll(/[\uFFFD\u0080-\u009F]/g)].slice(0, 8);
  for (const m of idx) {
    console.log(`   ctx: ${JSON.stringify(s.slice(Math.max(0, m.index - 28), m.index + 12))}`);
  }
}
