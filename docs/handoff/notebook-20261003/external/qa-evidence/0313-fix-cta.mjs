// Sólo la primera tarjeta de pedido conserva la acción primaria llena.
import { readFileSync, writeFileSync } from 'node:fs';

const f = 'C:/1212/artifacts/taba-opus-design-review/prototype-business-mobile.html';
let s = readFileSync(f, 'utf8');
let n = 0;
s = s.replace(/<button class="btn btn-primary" type="button">Aceptar<\/button>/g, (m) => {
  n += 1;
  return n === 1 ? m : '<button class="btn btn-secondary" type="button">Aceptar</button>';
});
writeFileSync(f, s, 'utf8');
console.log(`botones Aceptar: ${n} -> 1 primaria + ${n - 1} secundarias`);
