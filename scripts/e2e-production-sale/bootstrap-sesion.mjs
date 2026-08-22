/*
 * Bootstrap de una sesión para la prueba de venta real.
 *
 * Abre un navegador VISIBLE contra producción, espera a que la persona inicie
 * sesión con sus propias manos, comprueba que la sesión quedó donde tiene que
 * quedar y guarda el `storageState` en `.local/` —fuera del repositorio—.
 *
 * NO pide contraseñas, NO las lee, NO las guarda y no las escribe en ningún
 * lado. Lo único que persiste es el estado del navegador, igual que si la
 * persona hubiera dejado la pestaña abierta.
 *
 *   node scripts/e2e-production-sale/bootstrap-sesion.mjs --perfil=customer
 *   node scripts/e2e-production-sale/bootstrap-sesion.mjs --perfil=business
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { PRODUCCION, RUTAS } from './contrato.mjs';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1'), '../..');
const PERFILES = {
  customer: {
    destino: RUTAS.sesionCustomer,
    entrada: `${PRODUCCION.host}/#profile`,
    titulo: 'CLIENTE',
    instrucciones: [
      '1. En la ventana que se abrió, entrá al Perfil e iniciá sesión con la cuenta de PRUEBA del cliente.',
      '2. Dejá cargados el nombre, el teléfono y la dirección con su punto confirmado en el mapa.',
      '3. Volvé acá: la sesión se detecta sola.',
    ],
    // La sesión del cliente se reconoce porque Supabase dejó su token y porque
    // el perfil devuelve un nombre: sin perfil completo el checkout no avanza.
    async verificar(page) {
      return page.evaluate(async () => {
        const claves = Object.keys(localStorage).filter((k) => /supabase|sb-/i.test(k));
        const tieneToken = claves.some((k) => (localStorage.getItem(k) || '').includes('access_token'));
        let perfil = null;
        try {
          const { getState } = await import('/js/state.js');
          perfil = getState()?.customerProfile || null;
        } catch { /* la vista todavía no expone el estado */ }
        return {
          tieneToken,
          nombre: perfil?.name || perfil?.fullName || '',
          telefono: Boolean(perfil?.phone),
          direcciones: Array.isArray(perfil?.addresses) ? perfil.addresses.length : 0,
        };
      });
    },
    resumir: (datos) => `token=${datos.tieneToken ? 'sí' : 'no'} · nombre=${datos.nombre ? 'cargado' : 'FALTA'} · teléfono=${datos.telefono ? 'cargado' : 'FALTA'} · direcciones=${datos.direcciones}`,
    aprobada: (datos) => datos.tieneToken && Boolean(datos.nombre) && datos.telefono && datos.direcciones > 0,
  },
  business: {
    destino: RUTAS.sesionBusiness,
    entrada: `${PRODUCCION.host}/#business`,
    titulo: 'PANEL DEL NEGOCIO',
    instrucciones: [
      '1. En la ventana que se abrió, iniciá sesión en el Panel con tu cuenta de dueño.',
      '2. Esperá a ver el Centro de operación.',
      '3. Volvé acá: la sesión se detecta sola.',
    ],
    async verificar(page) {
      return page.evaluate(() => {
        const claves = Object.keys(localStorage).filter((k) => /supabase|sb-/i.test(k));
        const tieneToken = claves.some((k) => (localStorage.getItem(k) || '').includes('access_token'));
        const texto = document.body.innerText || '';
        return {
          tieneToken,
          panelVisible: /Centro de operación|Pedidos|Recepción/i.test(texto),
          pideIngreso: /Ingresar|Iniciar sesión|Contraseña/i.test(texto),
        };
      });
    },
    resumir: (datos) => `token=${datos.tieneToken ? 'sí' : 'no'} · panel=${datos.panelVisible ? 'visible' : 'no'} · pantalla de ingreso=${datos.pideIngreso ? 'sí' : 'no'}`,
    aprobada: (datos) => datos.tieneToken && datos.panelVisible && !datos.pideIngreso,
  },
};

const banderas = new Map();
for (const argumento of process.argv.slice(2)) {
  const i = argumento.indexOf('=');
  if (argumento.startsWith('--') && i !== -1) banderas.set(argumento.slice(2, i), argumento.slice(i + 1));
}
const nombrePerfil = String(banderas.get('perfil') || '');
const perfil = PERFILES[nombrePerfil];
if (!perfil) {
  console.error('ABORTAR: --perfil=customer | --perfil=business');
  process.exit(2);
}
const esperaMaxima = Number(banderas.get('minutos') || 10) * 60_000;

console.log(`\n╔═ SESIÓN DE ${perfil.titulo} ═══════════════════════════════`);
console.log('║ Se abre un navegador. Iniciá sesión VOS: este guion no pide,');
console.log('║ no lee y no guarda ninguna contraseña. Sólo conserva el estado');
console.log('║ del navegador, como una pestaña que quedó abierta.');
console.log('╚══════════════════════════════════════════════════════════');
for (const linea of perfil.instrucciones) console.log(`  ${linea}`);
console.log('');

const navegador = await chromium.launch({ headless: false });
const contexto = await navegador.newContext({ viewport: { width: 430, height: 932 } });
const pagina = await contexto.newPage();
await pagina.goto(perfil.entrada, { waitUntil: 'domcontentloaded', timeout: 90_000 });

const limite = Date.now() + esperaMaxima;
let datos = null;
let aprobada = false;
process.stdout.write('  esperando el inicio de sesión');
while (Date.now() < limite) {
  await pagina.waitForTimeout(3000);
  try {
    datos = await perfil.verificar(pagina);
    if (perfil.aprobada(datos)) { aprobada = true; break; }
  } catch { /* la página está navegando */ }
  process.stdout.write('.');
}
console.log('');

if (!aprobada) {
  console.error(`\nNO SE GUARDÓ NADA: la sesión no quedó completa. Último estado: ${datos ? perfil.resumir(datos) : 'sin lectura'}`);
  await navegador.close();
  process.exit(1);
}

const destino = path.join(RAIZ, perfil.destino);
mkdirSync(path.dirname(destino), { recursive: true });
const estado = await contexto.storageState();
writeFileSync(destino, `${JSON.stringify(estado, null, 2)}\n`);
await navegador.close();

// Nunca se imprime un token: sólo cuántas piezas se guardaron.
const cookies = estado.cookies?.length || 0;
const origenes = estado.origins?.length || 0;
console.log(`\nSESIÓN GUARDADA · ${perfil.resumir(datos)}`);
console.log(`  archivo: ${perfil.destino} (${cookies} cookie(s), ${origenes} origen(es) de almacenamiento)`);
console.log('  está en .gitignore y no viaja al repositorio.');
if (nombrePerfil === 'customer') {
  console.log('\n  Recordá fijar la dirección aprobada para la prueba antes de comprar:');
  console.log('    $env:TABA2_E2E_DIRECCION_TEXTO="<la dirección tal como la muestra el checkout>"');
}
