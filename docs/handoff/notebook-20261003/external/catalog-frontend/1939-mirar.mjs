import * as rider from '../../scripts/e2e-production-sale/rider.mjs';
const nodos = rider.volcarPantalla();
for (const n of nodos) {
  if (!n.descripcion) continue;
  const b = n.bounds ? `[${n.bounds.join(',')}]` : '';
  console.log(`${n.clickable ? 'CLIC' : '    '} ${b.padEnd(24)} ${String(n.descripcion).replace(/&#10;/g,' | ').slice(0,110)}`);
}
console.log('--- seguimiento:', rider.seguimientoActivoDe(nodos));
