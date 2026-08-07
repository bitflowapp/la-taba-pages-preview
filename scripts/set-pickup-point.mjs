// Fija el punto de retiro del negocio, con su procedencia declarada.
//
// POR QUÉ EXISTE
// --------------
// El punto no se puede deducir. Medido el 2026-08-07:
//
//   - el repositorio declara `Mendoza 827, Neuquén` y declara, en dos lugares
//     distintos, que NO tiene coordenada verificada para esa dirección;
//   - staging no guardaba ninguna otra coordenada del negocio;
//   - un geocodificador público resuelve «Mendoza 827, Neuquén» en ZAPALA, a
//     175 km; acotado a Neuquén Capital devuelve el centroide de la calle, no
//     la altura 827; y el único POI «La Taba» que conoce OSM está en Islas
//     Malvinas 145, otra calle.
//
// Por eso la coordenada entra por acá, a mano, y SIEMPRE con su procedencia.
//
//   node scripts/set-pickup-point.mjs <lat> <lng> --origen=<origen> [opciones]
//
//   --origen=business_verified              exige --confirmado-por-humano
//   --origen=public_directory_cross_checked exige --fuente="..."
//   --origen=qa_fixture                     valor de prueba
//   --confianza=low|medium|high
//   --precision=<metros>
//   --reemplazar                            para pisar un punto ya verificado
//
// GUARDAS, todas antes de mutar:
//   1. sólo el negocio declarado;
//   2. la coordenada tiene que caer dentro del recuadro de Neuquén Capital que
//      declara js/config.js — es lo que habría frenado el punto de Zapala;
//   3. `business_verified` exige afirmación humana explícita en la invocación;
//   4. no pisa un punto ya verificado sin --reemplazar;
//   5. imprime el punto anterior para que revertir sea copiar y pegar.
import { execFileSync } from 'node:child_process';

const REF = 'ukxqbgswjlibmnjemrzd';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
// js/config.js -> defaultMapBounds: [[-38.982, -68.105], [-38.904, -67.955]]
const LIMITES = { latMin: -38.982, latMax: -38.904, lngMin: -68.105, lngMax: -67.955 };
const ORIGENES = new Set(['business_verified', 'public_directory_cross_checked', 'qa_fixture']);

const crudos = process.argv.slice(2);
const banderas = new Map();
const libres = [];
for (const a of crudos) {
  if (!a.startsWith('--')) { libres.push(a); continue; }
  const i = a.indexOf('=');
  if (i === -1) banderas.set(a.slice(2), true);
  else banderas.set(a.slice(2, i), a.slice(i + 1));
}
const lat = Number(libres[0]);
const lng = Number(libres[1]);
const origen = String(banderas.get('origen') || '');
const confianza = banderas.get('confianza') ? String(banderas.get('confianza')) : null;
const precision = banderas.get('precision') ? Number(banderas.get('precision')) : null;
const fuente = banderas.get('fuente') ? String(banderas.get('fuente')) : null;
const reemplazar = banderas.has('reemplazar');

const abortar = (m) => { console.error(`ABORTAR: ${m}`); process.exit(2); };

if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
  abortar('faltan las coordenadas.\n  uso: node scripts/set-pickup-point.mjs <lat> <lng> --origen=<origen> [opciones]');
}
if (!ORIGENES.has(origen)) abortar(`--origen tiene que ser uno de: ${[...ORIGENES].join(', ')}`);
if (lat < LIMITES.latMin || lat > LIMITES.latMax || lng < LIMITES.lngMin || lng > LIMITES.lngMax) {
  abortar(`${lat}, ${lng} cae fuera de Neuquén Capital (lat ${LIMITES.latMin}..${LIMITES.latMax}, `
    + `lng ${LIMITES.lngMin}..${LIMITES.lngMax}). Un punto de retiro fuera de la ciudad manda al Rider a otro lado.`);
}
if (confianza && !['low', 'medium', 'high'].includes(confianza)) abortar('--confianza tiene que ser low, medium o high');
if (precision != null && (!Number.isFinite(precision) || precision < 0)) abortar('--precision es un número de metros no negativo');

// `business_verified` AFIRMA que una persona miró el punto contra la puerta.
// Ningún automatismo puede afirmar eso, así que tiene que estar escrito en la
// invocación. Esta guarda existe porque ya pasó: probando la herramienta se
// aplicó el centroide de una calle como verificado, y hubo que revertirlo.
if (origen === 'business_verified' && !banderas.has('confirmado-por-humano')) {
  abortar('con --origen=business_verified hace falta --confirmado-por-humano.\n'
    + `  Punto propuesto: ${lat}, ${lng}\n`
    + '  Sólo agregala si una persona confirmó este pin contra la puerta del local.\n'
    + '  Un resultado de geocodificador no alcanza: uno resolvió esta misma dirección en Zapala.');
}
if (origen === 'public_directory_cross_checked' && !fuente) {
  abortar('con --origen=public_directory_cross_checked hace falta --fuente="cómo se obtuvo y contra qué se contrastó".\n'
    + '  Un punto sin procedencia escrita es indistinguible de uno inventado.');
}
const humanVerified = origen === 'business_verified';

function serviceKey() {
  const raw = execFileSync('C:/1212/scripts/supabase.exe',
    ['projects', 'api-keys', '--project-ref', REF, '--output', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const found = JSON.parse(raw).filter((e) => e.name === 'service_role');
  if (found.length !== 1) throw new Error('el proyecto no expone una service_role única');
  return found[0].api_key;
}
const KEY = serviceKey();
const URL_BASE = `https://${REF}.supabase.co`;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const [negocio] = await (await fetch(
  `${URL_BASE}/rest/v1/businesses?id=eq.${BUSINESS_ID}&select=id,name,address`, { headers },
)).json();
if (!negocio) abortar(`el negocio ${BUSINESS_ID} no existe en este proyecto`);
console.log(`negocio: ${negocio.name} — ${negocio.address}`);

const token = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  'Add-Type -Namespace "" -Name TabaCred3 -MemberDefinition \'[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string t, uint y, uint f, out IntPtr c); [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr b); [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }\'; $p=[IntPtr]::Zero; [void][TabaCred3]::CredRead("Supabase CLI:supabase",1,0,[ref]$p); $c=[System.Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][TabaCred3+CREDENTIAL]); $b=New-Object byte[] $c.CredentialBlobSize; [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$c.CredentialBlobSize); [TabaCred3]::CredFree($p); [System.Text.Encoding]::UTF8.GetString($b).Trim([char]0)',
], { encoding: 'utf8' }).trim();

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 500));
  return t ? JSON.parse(t) : null;
};

const antes = await sql(`select * from private.rider_map_business_locations where business_id = '${BUSINESS_ID}';`);
if (antes?.length) {
  const a = antes[0];
  console.log(`punto anterior: ${a.latitude}, ${a.longitude}  source=${a.source} human_verified=${a.human_verified ?? false}`);
  console.log('  revertir con: node scripts/set-pickup-point.mjs '
    + `${a.latitude} ${a.longitude} --origen=${a.source}`
    + `${a.source === 'business_verified' ? ' --confirmado-por-humano' : ''}`
    + `${a.source === 'public_directory_cross_checked' ? ' --fuente="restauración del punto anterior"' : ''} --reemplazar`);
  if (a.source === 'business_verified' && origen !== 'business_verified' && !reemplazar) {
    abortar('ya hay un punto business_verified; usar --reemplazar para degradarlo a propósito');
  }
}

const esc = (v) => (v == null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
await sql(`
insert into private.rider_map_business_locations
  (business_id, latitude, longitude, source, accuracy_m, confidence, human_verified, source_note, updated_at)
values ('${BUSINESS_ID}', ${lat}, ${lng}, ${esc(origen)}, ${precision == null ? 'null' : precision},
        ${esc(confianza)}, ${humanVerified}, ${esc(fuente)}, statement_timestamp())
on conflict (business_id) do update
   set latitude = excluded.latitude, longitude = excluded.longitude,
       source = excluded.source, accuracy_m = excluded.accuracy_m,
       confidence = excluded.confidence, human_verified = excluded.human_verified,
       source_note = excluded.source_note, updated_at = excluded.updated_at,
       -- Un punto nuevo invalida cualquier chequeo de presencia anterior.
       verified_by_rider_presence = false, presence_checked_at = null,
       presence_distance_m = null, presence_accuracy_m = null, presence_status = null;
`);

const despues = await sql(`
select latitude, longitude, source, confidence, human_verified, accuracy_m, source_note, updated_at
  from private.rider_map_business_locations where business_id = '${BUSINESS_ID}';`);
console.log('\npunto aplicado:');
console.log(JSON.stringify(despues, null, 2));
console.log('\nLos pedidos NUEVOS lo fotografían al crearse; los ya emitidos conservan su');
console.log('instantánea, que es inmutable por contrato.');
