/*
 * Runner de consultas GARANTIZADO read-only contra staging o producción.
 *
 * Existe para que las auditorías (incluidas las delegadas) puedan medir la base
 * sin poder mutarla ni por accidente: rechaza cualquier cosa que no sea UNA
 * sola sentencia SELECT (o WITH ... SELECT). Sin INSERT/UPDATE/DELETE/DDL, sin
 * múltiples sentencias, sin llamadas a funciones vía SELECT que muten (eso
 * queda bajo responsabilidad de quien consulta: no invocar funciones acá).
 *
 *   node scripts/consulta-solo-lectura.mjs --ref=<staging|produccion> --sql="select ..."
 *   node scripts/consulta-solo-lectura.mjs --ref=produccion --archivo=consulta.sql
 *
 * Salida: JSON por stdout.
 */
import { readFileSync } from 'node:fs';
import { conToken } from './lib/supabase-cli-token.mjs';

const REFS = { staging: 'ukxqbgswjlibmnjemrzd', produccion: 'wwcpogltfgzgkrlilbcd' };

const banderas = new Map();
for (const a of process.argv.slice(2)) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i === -1) banderas.set(a.slice(2), true);
  else banderas.set(a.slice(2, i), a.slice(i + 1));
}

const refNombre = String(banderas.get('ref') || '');
const ref = REFS[refNombre];
if (!ref) {
  console.error(`ABORTAR: --ref debe ser uno de: ${Object.keys(REFS).join(', ')}`);
  process.exit(2);
}

let sql = banderas.get('sql') ? String(banderas.get('sql')) : '';
if (!sql && banderas.get('archivo')) sql = readFileSync(String(banderas.get('archivo')), 'utf8');
sql = sql.trim().replace(/;\s*$/, '');
if (!sql) {
  console.error('ABORTAR: falta --sql o --archivo');
  process.exit(2);
}

// La guarda: una sola sentencia, y tiene que EMPEZAR por select o with.
const normalizado = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().toLowerCase();
if (!/^(select|with)\b/.test(normalizado)) {
  console.error('ABORTAR: sólo se aceptan sentencias SELECT / WITH...SELECT.');
  process.exit(2);
}
if (normalizado.includes(';')) {
  console.error('ABORTAR: una sola sentencia, sin punto y coma intermedio.');
  process.exit(2);
}
for (const prohibida of ['insert ', 'update ', 'delete ', 'truncate ', 'alter ', 'create ', 'drop ', 'grant ', 'revoke ', 'copy ', 'vacuum ', 'refresh ', 'set ', 'reset ', 'do ']) {
  if (normalizado.startsWith(prohibida)) {
    console.error(`ABORTAR: sentencia prohibida (${prohibida.trim()}).`);
    process.exit(2);
  }
}

await conToken(async (token) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'taba2-consulta-solo-lectura/1.0' },
    body: JSON.stringify({ query: sql }),
  });
  const t = await r.text();
  if (!r.ok) {
    console.error(`HTTP ${r.status} · ${t.slice(0, 1200)}`);
    process.exit(1);
  }
  console.log(t);
});
