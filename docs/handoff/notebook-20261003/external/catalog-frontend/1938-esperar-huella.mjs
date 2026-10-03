/*
 * Espera a que una persona apoye el dedo, y no hace nada más.
 *
 * La reinstalación del Rider dejó la sesión protegida detrás de la huella. Eso
 * es la protección funcionando: la única alternativa que ofrece la pantalla es
 * «Entrar con contraseña», que descarta la sesión y pide la contraseña del
 * repartidor —que no es mía—. Así que acá sólo se sostiene el pedido del
 * sistema: si el aviso se vence, se vuelve a levantar; cuando la app queda
 * desbloqueada, esto termina.
 */
import { execFileSync } from 'node:child_process';
import * as rider from '../../scripts/e2e-production-sale/rider.mjs';
import { RIDER } from '../../scripts/e2e-production-sale/contrato.mjs';

const tocarPunto = (x, y) => execFileSync(
  'adb', ['-s', RIDER.serie, 'shell', 'input', 'tap', String(x), String(y)],
  { encoding: 'utf8', timeout: 30_000 },
);

const LIMITE = Date.now() + 15 * 60 * 1000;
const textos = (nodos) => nodos.map((n) => String(n.descripcion || '')).join(' | ');

while (Date.now() < LIMITE) {
  let nodos = [];
  try { nodos = rider.volcarPantalla({ intentos: 2 }); } catch { nodos = []; }
  const pantalla = textos(nodos);
  if (/Tus entregas|Mapa operativo/.test(pantalla)) {
    console.log('DESBLOQUEADA');
    process.exit(0);
  }
  if (/sensor de huellas/.test(pantalla)) {
    process.stdout.write('.');
  } else if (/Tu sesión está protegida/.test(pantalla)) {
    console.log('\nel aviso se venció: se vuelve a pedir la huella');
    const boton = nodos.find((n) => n.descripcion === 'Desbloquear');
    if (boton?.bounds) {
      const [x1, y1, x2, y2] = boton.bounds;
      tocarPunto(Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2));
    }
  }
  await new Promise((r) => { setTimeout(r, 4000); });
}
console.log('\nSE AGOTÓ LA ESPERA');
process.exit(1);
