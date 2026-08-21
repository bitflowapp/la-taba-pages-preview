// AUDITORÍA READ-ONLY: descarga el cliente servido en producción y lo escanea.
// No imprime valores de secretos: sólo etiquetas, archivos y conteos.
import fs from 'node:fs';
import path from 'node:path';
import { scanText, isServiceRoleJwt } from 'file:///scripts/scan-secrets.mjs';

const BASE = 'https://la-taba.pages.dev/';
const OUT = 'artifacts/taba2-go-live-audit/seguridad/raw/cliente/descargas';
const LISTA = 'artifacts/taba2-go-live-audit/seguridad/raw/cliente/precache-list.txt';

fs.mkdirSync(OUT, { recursive: true });
const rutas = fs.readFileSync(LISTA, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);

const resultados = [];
let bajados = 0;
for (const ruta of rutas) {
  const url = BASE + ruta;
  const local = path.join(OUT, ruta.replace(/\?.*$/, '').replace(/\//g, '__') || 'root.html');
  let status = 0; let text = '';
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'taba2-go-live-audit-readonly/1.0' } });
    status = r.status;
    text = await r.text();
  } catch (e) {
    resultados.push({ ruta, status: 'FETCH_ERROR', hallazgos: [String(e.message).slice(0, 120)] });
    continue;
  }
  fs.writeFileSync(local, text);
  bajados += 1;

  const hallazgos = [];
  // 1. Familias de secretos del escáner del repo (no imprime valores).
  for (const label of scanText(text)) hallazgos.push(`secreto: ${label}`);
  // 2. JWTs presentes: decodificar el rol de cada uno (sin imprimir el token).
  const jwts = text.match(/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g) || [];
  for (const jwt of jwts) {
    let rol = '(indecodificable)';
    try {
      const p = JSON.parse(Buffer.from(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      rol = `role=${p.role ?? '?'} ref=${p.ref ?? '?'}`;
    } catch {}
    hallazgos.push(`JWT embebido (${rol})${isServiceRoleJwt(jwt) ? ' *** SERVICE_ROLE ***' : ''}`);
  }
  // 3. Formatos nuevos de claves Supabase.
  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) hallazgos.push('*** sb_secret_ presente ***');
  const pub = text.match(/sb_publishable_[A-Za-z0-9_-]{5,}/g) || [];
  if (pub.length) hallazgos.push(`sb_publishable_ presente (${pub.length} ocurrencia/s, esperable)`);
  // 4. Referencias a staging.
  const staging = (text.match(/ukxqbgswjlibmnjemrzd/g) || []).length;
  if (staging) hallazgos.push(`*** referencia a STAGING ukxqbgswjlibmnjemrzd x${staging} ***`);
  // 5. Ref de producción (informativo).
  const prod = (text.match(/wwcpogltfgzgkrlilbcd/g) || []).length;
  if (prod) hallazgos.push(`ref de producción x${prod} (informativo)`);
  // 6. Palabra service_role fuera de JWT (código que la mencione).
  if (/service_role/.test(text)) hallazgos.push('menciona la cadena "service_role" (revisar contexto)');

  if (hallazgos.length) resultados.push({ ruta, status, hallazgos });
}

console.log(`descargados: ${bajados}/${rutas.length}`);
console.log('--- archivos con señales ---');
for (const r of resultados) {
  console.log(`${r.ruta} [${r.status}]`);
  for (const h of r.hallazgos) console.log(`   - ${h}`);
}
if (!resultados.length) console.log('(ninguno)');
