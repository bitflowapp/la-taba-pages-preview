#!/usr/bin/env node
/**
 * Alta del PRIMER dueño de un comercio en un entorno recién creado.
 *
 * Existe por un problema de arranque real: la autoridad de TABA vive en
 * business_members, todas las altas la exigen, y en un proyecto nuevo no hay
 * nadie que la tenga. Alguien tiene que ser el primero.
 *
 * Lo que este script NO es, y por qué:
 *
 *   · No es "el primero que se registra queda de dueño". Esa regla convierte
 *     una carrera en una toma de control, y no se puede deshacer.
 *   · No es una RPC. No hay ninguna función en la base que otorgue owner sin un
 *     owner previo, y no la va a haber: la excepción vive acá afuera, con
 *     credencial administrativa, fuera del alcance de cualquier cliente.
 *   · No se puede repetir. Si el comercio ya tiene gente, se niega. Un
 *     bootstrap repetible es una puerta trasera.
 *
 * Uso:
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *   TABA_OWNER_EMAIL=persona@dominio \
 *   TABA_OWNER_NAME="Nombre Apellido" \
 *   node scripts/bootstrap-first-business-owner.mjs \
 *     --ref wwcpogltfgzgkrlilbcd \
 *     --business 00000000-0000-4000-8000-000000000001 \
 *     --confirm
 *
 * Sin --confirm hace un ensayo: comprueba todo, no escribe nada, e imprime lo
 * que haría. Es el modo por defecto a propósito.
 *
 * La contraseña no se pasa nunca. Se crea la cuenta sin contraseña y se emite
 * un enlace de recuperación para que la persona elija la suya: así no queda en
 * el historial de la consola, ni en un archivo, ni en la memoria de nadie.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? '' : String(process.argv[i + 1] || '').trim();
}

const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ownerEmail = String(process.env.TABA_OWNER_EMAIL || '').trim().toLowerCase();
const ownerName = String(process.env.TABA_OWNER_NAME || '').trim();
const ref = arg('ref');
const businessId = arg('business');
const confirmed = process.argv.includes('--confirm');

function fail(message) {
  console.error(`\nABORTADO. ${message}`);
  process.exit(1);
}

// ── 1. La guardia de destino, antes de abrir una conexión ──────────────────
// Es la misma que usa el push de migraciones. Se reutiliza en vez de repetir su
// criterio acá, para que exista UN solo lugar que sepa cuál es production.
function assertTarget() {
  if (!ref) fail('Falta --ref. No hay destino por defecto: hay que escribirlo.');
  const guard = spawnSync(
    process.execPath,
    [
      path.join(ROOT, 'scripts', 'assert-production-supabase-target.mjs'),
      '--ref', ref,
      '--url', url,
      '--category', 'bootstrap first owner',
    ],
    { stdio: 'inherit' },
  );
  if (guard.status !== 0) fail('la guardia de destino no dejó pasar.');
}

function validate() {
  const problems = [];
  if (!url.startsWith('https://')) problems.push('SUPABASE_URL debe ser https.');
  if (!serviceRoleKey) problems.push('Falta SUPABASE_SERVICE_ROLE_KEY.');
  if (!UUID.test(businessId)) problems.push('--business no es un uuid.');
  if (!EMAIL.test(ownerEmail)) problems.push('TABA_OWNER_EMAIL no es un correo válido.');
  if (ownerName.length < 2 || ownerName.length > 120) problems.push('TABA_OWNER_NAME debe tener entre 2 y 120 caracteres.');
  if (process.env.TABA_OWNER_PASSWORD) {
    problems.push(
      'No pases la contraseña por entorno: queda en el historial de la consola. '
      + 'El script emite un enlace para que la persona elija la suya.',
    );
  }
  if (problems.length > 0) fail(problems.join('\n'));
}

async function main() {
  assertTarget();
  validate();

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 2. El comercio tiene que existir y estar activo ──────────────────────
  const { data: business, error: businessError } = await admin
    .from('businesses')
    .select('id, name, is_active')
    .eq('id', businessId)
    .maybeSingle();
  if (businessError) fail(`No pudimos leer el comercio: ${businessError.message}`);
  if (!business) fail('El comercio no existe. Creálo antes de darle un dueño.');
  if (business.is_active !== true) fail('El comercio está dado de baja.');

  // ── 3. Idempotencia y no repetición ──────────────────────────────────────
  const { data: members, error: membersError } = await admin
    .from('business_members')
    .select('user_id, role, is_active')
    .eq('business_id', businessId);
  if (membersError) fail(`No pudimos leer el equipo: ${membersError.message}`);

  if ((members || []).length > 0) {
    // Ya hay gente. La única salida buena es que el dueño pedido YA sea el
    // dueño: eso hace que volver a correr esto sea inofensivo.
    const { data: existingUser } = await admin.auth.admin
      .listUsers({ page: 1, perPage: 200 })
      .then((r) => ({ data: (r?.data?.users || []).find((u) => String(u.email || '').toLowerCase() === ownerEmail) }))
      .catch(() => ({ data: null }));
    const already = existingUser
      && (members || []).find((m) => m.user_id === existingUser.id && m.role === 'owner' && m.is_active);
    if (already) {
      console.log(`\nNada que hacer: ${ownerEmail} ya es owner activo de ${business.name}.`);
      process.exit(0);
    }
    fail(
      `El comercio ya tiene ${members.length} integrante(s) y ninguno es ${ownerEmail}.\n`
      + 'El bootstrap es para un entorno sin equipo. Las altas siguientes van por\n'
      + 'invitación (identity_create_invitation) o por solicitud aprobada\n'
      + '(identity_review_access_request), que quedan auditadas.',
    );
  }

  console.log('\n--- BOOTSTRAP PRIMER OWNER ---');
  console.log(`  Comercio : ${business.name} (${business.id})`);
  console.log(`  Dueño    : ${ownerName} <${ownerEmail}>`);
  console.log(`  Equipo   : 0 integrantes (correcto para un bootstrap)`);

  if (!confirmed) {
    console.log('\nENSAYO. No se escribió nada.');
    console.log('Volvé a correrlo con --confirm para crear la cuenta de verdad.');
    process.exit(2);
  }

  // ── 4. La cuenta, sin contraseña ─────────────────────────────────────────
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
    user_metadata: { taba_actor: 'owner' },
  });
  if (createError || !created?.user?.id) {
    fail(`No pudimos crear la cuenta: ${createError?.message || 'respuesta vacía'}`);
  }
  const ownerId = created.user.id;

  // ── 5. La membresía, con credencial de servicio ──────────────────────────
  // El guard de membresías tiene una vía explícita para service_role. Es la
  // única escritura de identidad que ocurre fuera de una RPC, y existe
  // justamente para este arranque.
  const rollback = async (why) => {
    await admin.auth.admin.deleteUser(ownerId).catch(() => {});
    fail(`${why} La cuenta recién creada se borró para no dejar una identidad huérfana.`);
  };

  const { error: memberError } = await admin
    .from('business_members')
    .insert({ business_id: businessId, user_id: ownerId, role: 'owner', is_active: true });
  if (memberError) await rollback(`No pudimos crear la membresía: ${memberError.message}.`);

  const { error: securityError } = await admin
    .from('identity_user_security')
    .insert({ business_id: businessId, user_id: ownerId });
  if (securityError) await rollback(`No pudimos crear el estado de seguridad: ${securityError.message}.`);

  const { error: profileError } = await admin
    .from('staff_profiles')
    .insert({ business_id: businessId, user_id: ownerId, full_name: ownerName });
  if (profileError) await rollback(`No pudimos crear el perfil: ${profileError.message}.`);

  // ── 6. El rastro de auditoría ────────────────────────────────────────────
  // Es la única alta de identidad que no pasa por una RPC, así que es también
  // la única que no deja evento sola. Sin esto, el primer owner sería el único
  // integrante del comercio cuya alta no figura en ningún lado.
  const { error: auditError } = await admin.rpc('identity_record_audit_event', {
    p_event_type: 'business_owner_bootstrapped',
    p_business_id: businessId,
    p_actor_user_id: null,
    p_actor_role: 'service_role',
    p_subject_user_id: ownerId,
    p_session_id: null,
    p_metadata: { tool: 'bootstrap-first-business-owner', ref, email: ownerEmail },
  });

  // ── 7. La contraseña la elige la persona ─────────────────────────────────
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: ownerEmail,
  });

  /*
   * El `action_link` que devuelve Supabase apunta a `/auth/v1/verify` y termina
   * redirigiendo al site_url con la sesión escrita en el fragmento. Esta app no
   * lee sesiones de la URL —`detectSessionInUrl: false`, a propósito—, así que
   * ese enlace aterrizaría en la home sin hacer nada.
   *
   * El enlace bueno es el mismo que arma la plantilla del correo: la pantalla
   * /cuenta/ con el `token_hash`, que se canjea por POST.
   */
  const siteUrl = (arg('site-url') || link?.properties?.redirect_to || '').replace(/\/+$/, '');
  const hash = link?.properties?.hashed_token || '';
  const enlaceUtil = siteUrl && hash ? `${siteUrl}/cuenta/?token_hash=${hash}&type=recovery` : '';

  console.log('\nListo.');
  console.log(`  user_id : ${ownerId}`);
  console.log('  rol     : owner');
  console.log(`  auditoría: ${auditError ? `NO se pudo registrar (${auditError.message})` : 'business_owner_bootstrapped'}`);
  console.log('  contraseña: la elige la persona desde el enlace de recuperación.');
  if (linkError) {
    console.log('\nNo se pudo emitir el enlace acá. Con SMTP configurado, la persona puede');
    console.log('usar "Olvidé mi contraseña" en el Panel y completar el alta por ese camino.');
  } else if (enlaceUtil) {
    console.log('\nEnlace para elegir contraseña (entregalo por un canal seguro; vence en una hora):');
    console.log(`  ${enlaceUtil}`);
  } else {
    console.log('\nSe emitió el enlace pero falta saber el host canónico para armarlo.');
    console.log('Volvé a correrlo con --site-url https://<host> o usá "Olvidé mi contraseña".');
  }
  console.log('\nDe acá en adelante las altas salen del Panel: por invitación, o aprobando');
  console.log('una solicitud. Este script ya no vuelve a correr sobre este comercio.');
}

main().catch((error) => fail(error?.message || String(error)));
