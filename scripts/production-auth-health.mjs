// Salud del Auth del destino explícito. SOLO LECTURA.
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
//   node scripts/production-auth-health.mjs --target controlled-production \
//     [--key-file <clave publicable>] [--report <archivo.json>]
//   node scripts/production-auth-health.mjs --target staging --business-id <uuid>
//   --ref conocido sigue admitido; no hay un destino implícito.
//
// Salida 0 = todo dentro de lo esperado. 1 = hay algo que mirar. 2 = no se pudo.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { TARGETS, parseArgs as parseHealthArgs, readOnlyAsk } from './production-health-check.mjs';

// Umbrales para un comercio: no son estadistica, son sentido comun operativo.
// Un local no da de alta 50 cuentas de equipo en una hora.
const UMBRAL_ANONIMAS_HORA = 40;
const UMBRAL_CON_CORREO_HORA = 10;
const UMBRAL_SOLICITUD_VIEJA_HORAS = 48;

export function parseAuthHealthArgs(argv) {
  const allowed = new Set(['--target', '--ref', '--business-id', '--key', '--key-file', '--report']);
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!allowed.has(flag)) throw new Error('opción desconocida; usar --help');
    if (seen.has(flag)) throw new Error(`opción repetida: ${flag}`);
    if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${flag} requiere un valor`);
    seen.add(flag);
  }
  const value = (name) => {
    const i = argv.indexOf(`--${name}`);
    if (i === -1) return undefined;
    const trimmed = argv[i + 1].trim();
    if (!trimmed) throw new Error(`--${name} requiere un valor`);
    return trimmed;
  };
  const target = value('target');
  const ref = value('ref');
  if (target && !Object.hasOwn(TARGETS, target)) throw new Error('--target tiene que ser production|controlled-production|staging');
  if (ref && !Object.values(TARGETS).some((entry) => entry.ref === ref)) throw new Error('--ref no reconocido por el catálogo de destinos');
  if (target && ref && ref !== TARGETS[target].ref) throw new Error('--target y --ref no corresponden al mismo proyecto');
  const options = parseHealthArgs(argv);
  if (!options.canonicalBusiness) throw new Error(`--business-id requerido para ${options.target}`);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(options.canonicalBusiness)) {
    throw new Error('el negocio del destino tiene que ser un uuid');
  }
  const key = value('key');
  const keyFile = value('key-file');
  if (key && keyFile) throw new Error('usar --key o --key-file, no ambos');
  return { ...options, key, keyFile };
}

// Importar la sonda no lee credenciales, no consulta ningún destino y no escribe.
// Las consultas agregadas conservan su significado: identidades y auditoría son
// métricas del proyecto; solicitudes y equipo pertenecen al negocio nombrado.
export async function runAuthHealthCheck({ options, sql, configAuth, probeAuth, now = () => new Date(), log = () => {} }) {
  const { ref, canonicalBusiness: CANONICAL_BUSINESS } = options;
  const avisos = [];
  const reporte = { schemaVersion: 1, target: options.target, ref, businessId: CANONICAL_BUSINESS, checkedAt: now().toISOString() };

  log(`--- SALUD DEL AUTH (${options.target}, ${ref}) ---\n`);

  // 1 · el servicio contesta
  if (probeAuth) {
    const r = await probeAuth();
    reporte.servicio = { status: r.status, ok: r.ok };
    log(`  servicio de Auth   : ${r.ok ? 'contesta' : `HTTP ${r.status}`}`);
    if (!r.ok) avisos.push(`el servicio de Auth contesta ${r.status}`);
  } else {
    reporte.servicio = { status: null, ok: null, nota: 'sin clave publicable no se pregunta por el camino publico' };
    log('  servicio de Auth   : no se probo (falta --key-file)');
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
  log(`  correo             : ${smtpPropio ? `SMTP propio (${cfg.smtp_host})` : 'remitente integrado'} · ${cfg.rate_limit_email_sent}/hora`);
  log(`  site_url           : ${cfg.site_url}`);
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
  log(`  identidades        : ${alta.total} (anonimas ${alta.anonimas} · con correo ${alta.con_correo})`);
  log(`  altas ultima hora  : ${alta.ultima_hora} · ultimo dia: ${alta.ultimo_dia}`);
  log(`  sin confirmar      : ${alta.sin_confirmar} (mas de un dia: ${alta.sin_confirmar_viejas})`);
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
  log(`  solicitudes        : ${cola.pendientes} esperando (rider ${cola.pendientes_rider}) · aprobadas ${cola.aprobadas} · rechazadas ${cola.rechazadas}`);
  if (cola.pendientes > 0) log(`  espera mas larga   : ${cola.espera_maxima_horas} h`);
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
  log(`  equipo activo      : ${estado.equipo} (owners ${estado.owners}) · sesiones vivas ${estado.sesiones_vivas}`);
  log(`  pedidos            : ${estado.ordering ? 'ABIERTOS' : 'cerrados'}`);
  if (estado.owners === 0) avisos.push('el comercio no tiene owner: nadie puede aprobar una solicitud');

  // 6 · auditoria reciente
  const [auditoria] = await sql(`
    select count(*)::int as total,
           count(*) filter (where occurred_at > now() - interval '24 hours')::int as ultimo_dia
      from public.identity_audit_events;
  `);
  reporte.auditoria = auditoria;
  log(`  eventos de identidad: ${auditoria.total} (ultimo dia ${auditoria.ultimo_dia})`);

  reporte.avisos = avisos;
  if (avisos.length) {
    log('\n  A MIRAR:');
    for (const aviso of avisos) log(`    · ${aviso}`);
  }
  log(`\n  RESULTADO: ${avisos.length ? `${avisos.length} AVISO(S)` : 'SIN NOVEDAD'}`);
  return { report: reporte, exitCode: avisos.length ? 1 : 0 };
}

export async function runAuthHealthCli(argv = process.argv.slice(2), {
  env = process.env, fetchImpl = fetch, readFile = fs.readFileSync, writeFile = fs.writeFileSync,
  stdout = console.log, stderr = console.error,
} = {}) {
  let token = '';
  let key = '';
  try {
    if (argv.includes('--help')) {
      stdout('node scripts/production-auth-health.mjs --target production|controlled-production|staging [--business-id uuid] [--key-file archivo] [--report archivo.json]');
      stdout('Destino explícito; staging requiere --business-id. --ref conocido sigue admitido. Sólo lectura.');
      return 0;
    }
    const options = parseAuthHealthArgs(argv);
    token = (env.SUPABASE_ACCESS_TOKEN || '').trim();
    if (!token) throw new Error('falta SUPABASE_ACCESS_TOKEN');
    key = (options.key || (options.keyFile ? readFile(options.keyFile, 'utf8') : '')).trim();
    const configAuth = async () => {
      const res = await fetchImpl(`https://api.supabase.com/v1/projects/${options.ref}/config/auth`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`config/auth ${res.status}`);
      return res.json();
    };
    const result = await runAuthHealthCheck({
      options, sql: readOnlyAsk({ ref: options.ref, token, fetchImpl }), configAuth, log: stdout,
      probeAuth: key ? () => fetchImpl(`https://${options.ref}.supabase.co/auth/v1/settings`, {
        headers: { apikey: key }, signal: AbortSignal.timeout(60_000),
      }) : null,
    });
    if (options.report) {
      writeFile(options.report, `${JSON.stringify(result.report, null, 2)}\n`);
      stdout(`\n  reporte: ${options.report}`);
    }
    return result.exitCode;
  } catch (error) {
    let message = String(error.message);
    for (const secret of [token, key].filter(Boolean)) message = message.split(secret).join('[REDACTED]');
    stderr(message);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runAuthHealthCli();
}
