// Verificación por presencia del punto de retiro, en el primer retiro físico.
//
// POR QUÉ EXISTE
// --------------
// El punto de La Taba 2 que hoy tiene la base viene de un directorio público
// contrastado (`public_directory_cross_checked`), no de una medición sobre la
// puerta. La única forma honesta de subir esa confianza es que el Rider esté
// realmente parado en el local y su propio GPS lo diga.
//
//   node verificar-presencia.mjs LT-0107            # ventana de 4 min
//   MINUTOS=8 node verificar-presencia.mjs LT-0107
//
// QUÉ MIDE, Y CON QUÉ REGLA
// -------------------------
// Escucha las ubicaciones que la app del Rider publica para ESE pedido —las
// mismas que ve el cliente en su seguimiento— y se queda con la de mejor
// precisión entre las primeras. Después:
//
//   precisión > 20 m ............. NO concluye. Una medición peor que el propio
//                                  error del punto no puede confirmar nada.
//   distancia <= 30 m ............ presence_status='confirmed' y
//                                  verified_by_rider_presence=true.
//   distancia  > 30 m ............ presence_status='discrepancy' y
//                                  PICKUP_LOCATION_DISCREPANCY. **No** pisa la
//                                  coordenada: que el Rider esté lejos no dice
//                                  cuál es el punto bueno, sólo que hay que
//                                  mirarlo con una persona del comercio.
//
// QUÉ NO HACE, A PROPÓSITO
// ------------------------
// No toca `human_verified` ni `source`. Estar cerca del punto no es lo mismo
// que haber confirmado el pin contra la puerta: eso lo afirma una persona, y
// para eso está `scripts/set-pickup-point.mjs --confirmado-por-humano`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REF, URL_BASE, SUPABASE_CLI, BUSINESS_ID, evidencia } from './entorno.mjs';

const CODE = process.argv[2];
const MINUTOS = Number(process.env.MINUTOS || 4);
const PRECISION_MAXIMA = Number(process.env.PRECISION_MAXIMA || 20);
const DISTANCIA_MAXIMA = Number(process.env.DISTANCIA_MAXIMA || 30);
const CANDIDATOS = Number(process.env.CANDIDATOS || 5);

const EV = evidencia('presencia');

// `process.exit()` mata el proceso mientras todavia se estan cerrando los
// handles de los hijos que se lanzaron con execFileSync, y Node 24 en Windows
// aborta con `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`. Eso
// convierte una salida prevista en algo que parece un cuelgue, con un codigo de
// salida sin sentido (-1073740791). Medido en este mismo equipo. Asi que se
// declara el codigo y se deja que el proceso termine solo.
function salir(codigo) { process.exitCode = codigo; return null; }

// ---------------------------------------------------------------- lectura ---
const keys = JSON.parse(execFileSync(SUPABASE_CLI,
  ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const SERVICE = keys.filter((k) => k.name === 'service_role')[0].api_key;
const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const rest = async (p) => (await fetch(`${URL_BASE}/rest/v1/${p}`, { headers: H })).json();

// El punto vive en el esquema `private`, que PostgREST no expone. Se lee y se
// escribe por la Management API, con el token del CLI de Supabase, igual que
// `scripts/set-pickup-point.mjs`.
//
// Se lee TARDE, a proposito: las guardas de arriba no necesitan token, y no
// tiene sentido abrir el Administrador de credenciales para decir «ese pedido
// no existe».
let tokenCache = null;
const token = () => {
  if (tokenCache) return tokenCache;
  tokenCache = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  'Add-Type -Namespace "" -Name TabaCredP -MemberDefinition \'[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string t, uint y, uint f, out IntPtr c); [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr b); [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }\'; $p=[IntPtr]::Zero; [void][TabaCredP]::CredRead("Supabase CLI:supabase",1,0,[ref]$p); $c=[System.Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][TabaCredP+CREDENTIAL]); $b=New-Object byte[] $c.CredentialBlobSize; [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$c.CredentialBlobSize); [TabaCredP]::CredFree($p); [System.Text.Encoding]::UTF8.GetString($b).Trim([char]0)',
  ], { encoding: 'utf8' }).trim();
  return tokenCache;
};

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 500));
  return t ? JSON.parse(t) : null;
};

const metros = (a, b) => {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

// ----------------------------------------------------------------- pedido ---
async function principal() {
if (!CODE) {
  console.log('uso: node verificar-presencia.mjs LT-XXXX');
  console.log('     correlo con el Rider parado en el local, apenas confirma el retiro.');
  return salir(1);
}
const [pedido] = await rest(`orders?code=eq.${CODE}&select=id,code,status,picked_up_at`);
if (!pedido) { console.log(`no existe ${CODE}`); return salir(1); }
if (!['picked_up', 'on_the_way', 'arrived'].includes(pedido.status)) {
  console.log(`${CODE} está en ${pedido.status}. Esta medición es del RETIRO: correla con el`);
  console.log('pedido ya retirado y el Rider todavía en el local.');
  return salir(1);
}

const [punto] = await sql(
  `select latitude::float8 as lat, longitude::float8 as lng, source, confidence, accuracy_m::float8 as accuracy_m,
          human_verified, verified_by_rider_presence, presence_status
     from private.rider_map_business_locations where business_id = '${BUSINESS_ID}';`,
);
if (!punto) { console.log('el negocio no tiene punto de retiro cargado'); return salir(1); }

console.log(`\npunto configurado: ${punto.lat}, ${punto.lng}  source=${punto.source} `
  + `confianza=${punto.confidence} precisión declarada=${punto.accuracy_m} m`);
console.log(`ventana de ${MINUTOS} min sobre ${CODE}. Buscando un fix de <= ${PRECISION_MAXIMA} m.\n`);
console.log('  seq   hora        precisión   distancia al punto');

// ------------------------------------------------------------- la medición --
const vistos = new Set();
const candidatos = [];
const hasta = Date.now() + MINUTOS * 60_000;
while (Date.now() < hasta && candidatos.length < CANDIDATOS) {
  const filas = await rest(
    `rider_locations?order_id=eq.${pedido.id}&select=receipt_sequence,created_at,lat,lng,accuracy`
    + '&order=receipt_sequence.asc',
  );
  for (const f of Array.isArray(filas) ? filas : []) {
    if (vistos.has(f.receipt_sequence)) continue;
    vistos.add(f.receipt_sequence);
    const d = metros({ lat: punto.lat, lng: punto.lng }, { lat: Number(f.lat), lng: Number(f.lng) });
    const acc = Number(f.accuracy);
    console.log(`  ${String(f.receipt_sequence).padStart(4)}  ${String(f.created_at).slice(11, 19)}  `
      + `${acc.toFixed(1).padStart(7)}m   ${d.toFixed(1).padStart(8)}m`
      + `${acc <= PRECISION_MAXIMA ? '' : '   (precisión insuficiente)'}`);
    if (acc <= PRECISION_MAXIMA) candidatos.push({ ...f, accuracy: acc, distancia: d });
    if (candidatos.length >= CANDIDATOS) break;
  }
  if (candidatos.length < CANDIDATOS) await new Promise((s) => setTimeout(s, 4000));
}

if (candidatos.length === 0) {
  console.log(`\nNO CONCLUYE: ningún fix bajó de ${PRECISION_MAXIMA} m en la ventana.`);
  console.log('El punto queda como estaba. Volvé a medir con el equipo quieto y cielo despejado.');
  fs.writeFileSync(path.join(EV, `presencia-${CODE}-sin-fix.json`),
    JSON.stringify({ code: CODE, punto, candidatos: [], veredicto: 'sin_fix' }, null, 2));
  return salir(3);
}

// El mejor es el de menor incertidumbre, no el más cercano: elegir el más
// cercano sería elegir el resultado que uno quiere.
candidatos.sort((a, b) => a.accuracy - b.accuracy);
const m = candidatos[0];
const confirmado = m.distancia <= DISTANCIA_MAXIMA;

console.log(`\nfix elegido (el de mejor precisión): ${m.lat}, ${m.lng}`);
console.log(`  precisión ${m.accuracy.toFixed(1)} m · distancia al punto ${m.distancia.toFixed(1)} m`);

await sql(`
update private.rider_map_business_locations
   set verified_by_rider_presence = ${confirmado},
       presence_checked_at = now(),
       presence_distance_m = ${m.distancia.toFixed(2)},
       presence_accuracy_m = ${m.accuracy.toFixed(2)},
       presence_status = '${confirmado ? 'confirmed' : 'discrepancy'}'
 where business_id = '${BUSINESS_ID}';`);

const despues = await sql(`
select latitude::float8 as lat, longitude::float8 as lng, source, human_verified,
       verified_by_rider_presence, presence_status, presence_distance_m::float8 as presence_distance_m,
       presence_accuracy_m::float8 as presence_accuracy_m, presence_checked_at
  from private.rider_map_business_locations where business_id = '${BUSINESS_ID}';`);

const evidencia_json = {
  code: CODE, punto_configurado: punto, medicion: m,
  candidatos, regla: { PRECISION_MAXIMA, DISTANCIA_MAXIMA },
  veredicto: confirmado ? 'confirmed' : 'discrepancy', despues,
};
fs.writeFileSync(path.join(EV, `presencia-${CODE}.json`), JSON.stringify(evidencia_json, null, 2));

if (confirmado) {
  console.log(`\nPRESENCIA CONFIRMADA — ${m.distancia.toFixed(1)} m <= ${DISTANCIA_MAXIMA} m.`);
  console.log('verified_by_rider_presence=true. La coordenada no cambió: sigue siendo la misma,');
  console.log('ahora con una medición del Rider en el local que la respalda.');
  console.log('`human_verified` sigue en false: nadie confirmó todavía el pin contra la puerta.');
} else {
  console.log(`\nPICKUP_LOCATION_DISCREPANCY — ${m.distancia.toFixed(1)} m > ${DISTANCIA_MAXIMA} m.`);
  console.log('El punto NO se sobrescribió. Una distancia grande no dice cuál es el punto bueno.');
  console.log('Queda registrada la discrepancia para mirarla con alguien del comercio.');
}
console.log(`\nevidencia: ${path.join(EV, `presencia-${CODE}.json`)}`);
return salir(confirmado ? 0 : 4);
}

await principal();
