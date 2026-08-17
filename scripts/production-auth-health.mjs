// Salud del Auth productivo. SOLO LECTURA, para correr el dia 1 y todos los dias.
//
// `production-health-check.mjs` mira la base y el scheduler. Esto mira la
// IDENTIDAD, que es lo que empieza a moverse el dia que el alta se abre:
//
//   · el servicio de Auth contesta
//   · hay SMTP propio, o se sigue con el remitente integrado
//   · cuantas identidades entraron en la ultima hora y en el ultimo dia
//   · cuantas son anonimas (visitas) y cuantas con correo (equipo)
//   · cuantas cuentas quedaron sin confirmar
//   · cuantas solicitudes de acceso estan esperando, y desde cuando
//   · si hay un pico que no se parece a un dia normal
//
// Un pico de identidades anonimas sin ningun pedido es la forma que tiene el
// abuso de alta de verse desde adentro: cuesta cuota de correo, ensucia la
// tabla y hoy no lo frena ningun captcha.
//
//   $env:SUPABASE_ACCESS_TOKEN = <token del CLI>
//   node scripts/production-auth-health.mjs --ref wwcpogltfgzgkrlilbcd \
//     [--key-file <clave publicable>] [--report <archivo.json>]
//
// Salida 0 = todo dentro de lo esperado. 1 = hay algo que mirar. 2 = no se pudo.

import fs from 'node:fs';
import process from 'node:process';

const PRODUCTION_REF = 'wwcpogltfgzgkrlilbcd';
const CANONICAL_BUSINESS = '00000000-0000-4000-8000-000000000001';

// Umbrales para un comercio: no son estadistica, son sentido comun operativo.
// Un local no da de alta 50 cuentas de equipo en una hora.
const UMBRAL_ANONIMAS_HORA = 40;
const UMBRAL_CON_CORREO_HORA = 10;
const UMBRAL_SOLICITUD_VIEJA_HORAS = 48;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const ref = (arg('ref') || '').trim();
if (ref !== PRODUCTION_REF) { console.error(`--ref debe ser ${PRODUCTION_REF}`); process.exit(2); }

const PAT = process.env.SUPABASE_ACCESS_TOKEN;
if (!PAT) { console.error('falta SUPABASE_ACCESS_TOKEN'); process.exit(2); }

const keyFile = arg('key-file');
const KEY = ((arg('key') || (keyFile ? fs.readFileSync(keyFile, 'utf8') : '')) || '').trim();

const avisos = [];

async function sql(query) {
  if (!/^\s*(select|with)\b/i.test(query)) throw new Error('esta sonda solo lee');
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`SQL ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : [];
}

async function configAuth() {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  if (!r.ok) throw new Error(`config/auth ${r.status}`);
  return r.json();
}

const reporte = { schemaVersion: 1, ref, checkedAt: new Date().toISOString() };

console.log(`--- SALUD DEL AUTH PRODUCTIVO (${ref}) ---\n`);

// 1 · el servicio contesta
if (KEY) {
  const r = await fetch(`https://${ref}.supabase.co/auth/v1/settings`, { headers: { apikey: KEY } });
  reporte.servicio = { status: r.status, ok: r.ok };
  console.log(`  servicio de Auth   : ${r.ok ? 'contesta' : `HTTP ${r.status}`}`);
  if (!r.ok) avisos.push(`el servicio de Auth contesta ${r.status}`);
} else {
  reporte.servicio = { status: null, ok: null, nota: 'sin clave publicable no se pregunta por el camino publico' };
  console.log('  servicio de Auth   : no se probo (falta --key-file)');
}

// 2 · correo
const cfg = await configAuth();
const smtpPropio = Boolean(cfg.smtp_host);
reporte.correo = {
  smtpPropio,
  host: smtpPropio ? String(cfg.smtp_host) : null,
  remitente: cfg.smtp_admin_email || null,
  nombreRemitente: cfg.smtp_sender_name || null,
  correosPorHora: cfg.rate_limit_email_sent,
  confirmacionExigida: cfg.mailer_autoconfirm === false,
  siteUrl: cfg.site_url,
};
console.log(`  correo             : ${smtpPropio ? `SMTP propio (${cfg.smtp_host})` : 'remitente integrado'} · ${cfg.rate_limit_email_sent}/hora`);
console.log(`  site_url           : ${cfg.site_url}`);
if (!smtpPropio) avisos.push('sin SMTP propio: el alta publica no puede entregar el correo de confirmacion');
if (String(cfg.site_url || '').includes('localhost')) avisos.push('el site_url es local: los enlaces del correo no llegan a ningun lado');

// 3 · identidades
const [alta] = await sql(`
  select
    count(*)::int as total,
    count(*) filter (where is_anonymous)::int as anonimas,
    count(*) filter (where not is_anonymous)::int as con_correo,
    count(*) filter (where created_at > now() - interval '1 hour')::int as ultima_hora,
    count(*) filter (where created_at > now() - interval '24 hours')::int as ultimo_dia,
    count(*) filter (where is_anonymous and created_at > now() - interval '1 hour')::int as anonimas_hora,
    count(*) filter (where not is_anonymous and created_at > now() - interval '1 hour')::int as correo_hora,
    count(*) filter (where not is_anonymous and confirmed_at is null)::int as sin_confirmar,
    count(*) filter (where not is_anonymous and confirmed_at is null
                      and created_at < now() - interval '24 hours')::int as sin_confirmar_viejas
  from auth.users;
`);
reporte.identidades = alta;
console.log(`  identidades        : ${alta.total} (anonimas ${alta.anonimas} · con correo ${alta.con_correo})`);
console.log(`  altas ultima hora  : ${alta.ultima_hora} · ultimo dia: ${alta.ultimo_dia}`);
console.log(`  sin confirmar      : ${alta.sin_confirmar} (mas de un dia: ${alta.sin_confirmar_viejas})`);
if (alta.anonimas_hora > UMBRAL_ANONIMAS_HORA) {
  avisos.push(`${alta.anonimas_hora} identidades anonimas en una hora: mirar si es trafico real o abuso de alta`);
}
if (alta.correo_hora > UMBRAL_CON_CORREO_HORA) {
  avisos.push(`${alta.correo_hora} cuentas con correo en una hora: mas de lo que un local da de alta`);
}

// 4 · solicitudes esperando
const [cola] = await sql(`
  select
    count(*) filter (where status = 'pending')::int as pendientes,
    count(*) filter (where status = 'pending' and requested_access = 'rider')::int as pendientes_rider,
    coalesce(max(extract(epoch from (now() - requested_at)) / 3600) filter (where status = 'pending'), 0)::int as espera_maxima_horas,
    count(*) filter (where status = 'approved')::int as aprobadas,
    count(*) filter (where status = 'rejected')::int as rechazadas
  from public.business_access_requests
  where business_id = '${CANONICAL_BUSINESS}';
`);
reporte.solicitudes = cola;
console.log(`  solicitudes        : ${cola.pendientes} esperando (rider ${cola.pendientes_rider}) · aprobadas ${cola.aprobadas} · rechazadas ${cola.rechazadas}`);
if (cola.pendientes > 0) console.log(`  espera mas larga   : ${cola.espera_maxima_horas} h`);
if (cola.espera_maxima_horas > UMBRAL_SOLICITUD_VIEJA_HORAS) {
  avisos.push(`hay una solicitud esperando hace ${cola.espera_maxima_horas} horas`);
}

// 5 · equipo y persiana
const [estado] = await sql(`
  select
    (select count(*) from public.business_members where business_id = '${CANONICAL_BUSINESS}' and is_active)::int as equipo,
    (select count(*) from public.business_members where business_id = '${CANONICAL_BUSINESS}' and role = 'owner' and is_active)::int as owners,
    (select count(*) from public.identity_sessions where revoked_at is null)::int as sesiones_vivas,
    (select ordering_enabled from public.businesses where id = '${CANONICAL_BUSINESS}') as ordering;
`);
reporte.equipo = estado;
console.log(`  equipo activo      : ${estado.equipo} (owners ${estado.owners}) · sesiones vivas ${estado.sesiones_vivas}`);
console.log(`  pedidos            : ${estado.ordering ? 'ABIERTOS' : 'cerrados'}`);
if (estado.owners === 0) avisos.push('el comercio no tiene owner: nadie puede aprobar una solicitud');

// 6 · auditoria reciente
const [auditoria] = await sql(`
  select count(*)::int as total,
         count(*) filter (where occurred_at > now() - interval '24 hours')::int as ultimo_dia
    from public.identity_audit_events;
`);
reporte.auditoria = auditoria;
console.log(`  eventos de identidad: ${auditoria.total} (ultimo dia ${auditoria.ultimo_dia})`);

reporte.avisos = avisos;
const destino = arg('report');
if (destino) {
  fs.writeFileSync(destino, `${JSON.stringify(reporte, null, 2)}\n`);
  console.log(`\n  reporte: ${destino}`);
}

if (avisos.length) {
  console.log('\n  A MIRAR:');
  for (const aviso of avisos) console.log(`    · ${aviso}`);
}
console.log(`\n  RESULTADO: ${avisos.length ? `${avisos.length} AVISO(S)` : 'SIN NOVEDAD'}`);
process.exitCode = avisos.length ? 1 : 0;
