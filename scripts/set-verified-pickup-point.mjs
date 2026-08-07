// Fija el punto de retiro VERIFICADO del negocio.
//
// Existe porque el punto no se puede deducir. Medido el 2026-08-07:
//
//   - el repositorio declara la dirección `Mendoza 827, Neuquén` pero también
//     declara, en dos lugares distintos, que NO tiene coordenada verificada
//     para ella (`businessLocationVerified: false` en js/config.js y
//     `BusinessCoordinatesSource.backendProjectionOnly` en el Rider);
//   - staging no guarda ninguna otra coordenada del negocio;
//   - un geocodificador público resuelve «Mendoza 827, Neuquén» en **Zapala**,
//     a unos 180 km, y acotado a Neuquén Capital sólo devuelve el centroide de
//     la calle, no la altura 827.
//
// Por eso la coordenada entra por acá, a mano, con una persona que la confirmó
// contra la puerta del local. No hay camino automático honesto.
//
//   node scripts/set-verified-pickup-point.mjs <lat> <lng> [precisión_m]
//
// Guardas, todas antes de mutar:
//   1. sólo el negocio de staging declarado;
//   2. la coordenada tiene que caer dentro del recuadro de Neuquén Capital que
//      declara js/config.js — esto es lo que habría frenado el punto de Zapala;
//   3. no degrada un punto ya verificado a menos que se pase --reemplazar;
//   4. idempotente: aplicar dos veces la misma coordenada no cambia nada.
import { execFileSync } from 'node:child_process';

const REF = 'ukxqbgswjlibmnjemrzd';
const BUSINESS_ID = '00000000-0000-4000-8000-000000000001';
// js/config.js -> defaultMapBounds: [[-38.982, -68.105], [-38.904, -67.955]]
const LIMITES = { latMin: -38.982, latMax: -38.904, lngMin: -68.105, lngMax: -67.955 };

const banderas = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const reemplazar = banderas.has('--reemplazar');
const lat = Number(args[0]);
const lng = Number(args[1]);
const precision = args[2] == null ? null : Number(args[2]);

if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
  console.error('uso: node scripts/set-verified-pickup-point.mjs <lat> <lng> [precisión_m] --confirmado-por-humano [--reemplazar]');
  process.exit(2);
}

// Escribir `business_verified` es AFIRMAR que una persona miró el punto contra
// la puerta del local. Ningún automatismo puede afirmar eso, así que la
// afirmación tiene que venir escrita en la invocación.
//
// Esta guarda existe porque ya pasó: probando el script se aplicó el centroide
// de la calle que devolvió un geocodificador, como si estuviera verificado.
// Hubo que revertirlo. Que el modo por defecto no mute es lo mínimo.
if (!banderas.has('--confirmado-por-humano')) {
  console.error(
    'ABORTAR: falta --confirmado-por-humano.\n'
    + `  Punto propuesto: ${lat}, ${lng}${precision == null ? '' : ` (±${precision} m)`}\n`
    + '  Sólo agregá esa bandera si una persona confirmó este pin contra la\n'
    + '  puerta de La Taba 2 en Mendoza 827. Un resultado de geocodificador no\n'
    + '  alcanza: acá uno resolvió la misma dirección en Zapala, a 180 km.',
  );
  process.exit(2);
}
if (lat < LIMITES.latMin || lat > LIMITES.latMax || lng < LIMITES.lngMin || lng > LIMITES.lngMax) {
  console.error(
    `ABORTAR: ${lat}, ${lng} cae fuera de Neuquén Capital `
    + `(lat ${LIMITES.latMin}..${LIMITES.latMax}, lng ${LIMITES.lngMin}..${LIMITES.lngMax}). `
    + 'Un punto de retiro fuera de la ciudad manda al Rider a otro lado.',
  );
  process.exit(2);
}
if (precision != null && (!Number.isFinite(precision) || precision < 0)) {
  console.error('ABORTAR: la precisión, si se informa, es un número de metros no negativo');
  process.exit(2);
}

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
const rest = async (p, init = {}) => {
  const r = await fetch(`${URL_BASE}/rest/v1/${p}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${p} :: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
};

const [negocio] = await rest(`businesses?id=eq.${BUSINESS_ID}&select=id,name,address`);
if (!negocio) throw new Error(`ABORTAR: el negocio ${BUSINESS_ID} no existe en este proyecto`);
console.log(`negocio: ${negocio.name} — ${negocio.address}`);

// `private` no se expone por PostgREST: la escritura va por la Management API,
// igual que la lectura de diagnóstico del resto de esta rama.
const sql = `
do $verificado$
declare
  v_actual private.rider_map_business_locations%rowtype;
begin
  select * into v_actual from private.rider_map_business_locations
   where business_id = '${BUSINESS_ID}';

  if found and v_actual.source = 'business_verified' and not ${reemplazar} then
    raise exception 'ya hay un punto business_verified; usar --reemplazar para pisarlo';
  end if;

  insert into private.rider_map_business_locations
    (business_id, latitude, longitude, source, accuracy_m, updated_at)
  values ('${BUSINESS_ID}', ${lat}, ${lng}, 'business_verified',
          ${precision == null ? 'null' : precision}, statement_timestamp())
  on conflict (business_id) do update
     set latitude = excluded.latitude,
         longitude = excluded.longitude,
         source = excluded.source,
         accuracy_m = excluded.accuracy_m,
         updated_at = excluded.updated_at;
end
$verificado$;

select business_id, latitude, longitude, source, accuracy_m, updated_at
  from private.rider_map_business_locations where business_id = '${BUSINESS_ID}';
`;

const token = execFileSync('powershell', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  'Add-Type -Namespace "" -Name TabaCred2 -MemberDefinition \'[DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool CredRead(string t, uint y, uint f, out IntPtr c); [DllImport("advapi32.dll")] public static extern void CredFree(IntPtr b); [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public uint Flags; public uint Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }\'; $p=[IntPtr]::Zero; [void][TabaCred2]::CredRead("Supabase CLI:supabase",1,0,[ref]$p); $c=[System.Runtime.InteropServices.Marshal]::PtrToStructure($p,[type][TabaCred2+CREDENTIAL]); $b=New-Object byte[] $c.CredentialBlobSize; [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$c.CredentialBlobSize); [TabaCred2]::CredFree($p); [System.Text.Encoding]::UTF8.GetString($b).Trim([char]0)',
], { encoding: 'utf8' }).trim();

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const salida = await res.text();
if (!res.ok) throw new Error(`la escritura falló: ${salida.slice(0, 400)}`);
console.log('punto de retiro:', salida);
console.log('\nAplicado como business_verified. Los pedidos NUEVOS lo fotografían al crearse;');
console.log('los ya emitidos conservan su instantánea, que es inmutable por contrato.');
