// Busca coca 2,25/2,5 en nombres únicos y en el HTML crudo de gaseosas.
import { readFileSync } from 'node:fs';

const t = readFileSync('artifacts/catalog-pricing-images-20261024/fuentes/laanonima/nombres-unicos-utf8.txt', 'utf8');
for (const l of t.split('\n')) {
  if (/coca/i.test(l) && /2[,.\s]*(25|50)/.test(l)) console.log('UNIQUE:', l.trim());
}
const raw = readFileSync('artifacts/catalog-pricing-images-20261024/fuentes/laanonima/gaseosas-regulares.html', 'utf8');
const re = /data-nombre\s*=\s*"([^"]*[Cc]oca[^"]*)"/g;
const seen = new Set();
let m;
while ((m = re.exec(raw))) seen.add(m[1]);
for (const n of seen) if (/2[,.\s]*(25|50)/.test(n) || /2,25|2\.25/.test(n)) console.log('CRUDO:', n);
