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
 * ## Lo que hace, y lo que NO
 *
 * PROMUEVE una identidad que ya existe. No la crea: la persona se da de alta
 * sola por la pantalla pública del Panel —su nombre, su correo, su contraseña—,
 * confirma el correo, y recién ahí este guion le da el rol que nadie más puede
 * darle. **No toca su contraseña ni ninguna de sus credenciales.**
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
 * Con `--create-identity` vuelve al comportamiento viejo: crea la cuenta sin
 * contraseña y emite un enlace para que la persona elija la suya. Es para un
 * entorno donde nadie pueda darse de alta —sin SMTP, por ejemplo—. Se usó una
 * vez en producción y se revirtió a pedido: quien va a ser dueño quiere estrenar
 * su cuenta creándola él, no recibiéndola hecha.
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
/*
 * Por defecto este guion PROMUEVE una identidad que ya existe. Crearla es la
 * excepcion y hay que pedirla con `--create-identity`.
 *
 * El orden importa, y se aprendio ejecutandolo. La primera vez creo la cuenta y
 * emitio un enlace para que la persona eligiera su contrasena. Funciono, y aun
 * asi estaba mal: el dueno de un comercio no deberia estrenar su cuenta con una
 * identidad que le fabrico una herramienta. La cuenta la crea la persona, por
 * la pantalla publica, con su nombre, su correo y su contrasena. Lo unico que no
 * puede hacer sola es darse el rol de owner, porque no hay nadie que se lo de:
 * eso, y solo eso, es lo que hace este guion.
 *
 * `--create-identity` queda para un entorno donde nadie pueda darse de alta
 * -sin SMTP, por ejemplo- y haya que arrancar igual.
 */
const crearIdentidad = process.argv.includes('--create-identity');

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

  // La identidad se BUSCA. Sólo se crea si se pidió explícitamente.
  const { data: lista } = await admin.auth.admin
    .listUsers({ page: 1, perPage: 200 })
    .catch(() => ({ data: null }));
  const existente = (lista?.users || [])
    .find((u) => String(u.email || '').toLowerCase() === ownerEmail);

  if (!crearIdentidad) {
    if (!existente) {
      fail(
        `No existe ninguna cuenta con ${ownerEmail}.\n`
        + 'Este guion PROMUEVE una identidad que ya existe: la persona crea su cuenta\n'
        + 'desde la pantalla pública del Panel, con su contraseña, y confirma su correo.\n'
        + 'Recién después se la promueve acá.\n\n'
        + 'Si el entorno no permite que nadie se dé de alta —sin SMTP, por ejemplo— y\n'
        + 'hay que arrancar igual, está `--create-identity`.',
      );
    }
    if (!existente.email_confirmed_at && !existente.confirmed_at) {
      fail(
        `La cuenta de ${ownerEmail} existe pero NO confirmó su correo.\n`
        + 'Confirmar es la única prueba de que ese correo es suyo, y el comercio no se\n'
        + 'le da a una identidad sin confirmar.',
      );
    }
  } else if (existente) {
    fail(
      `Ya existe una cuenta con ${ownerEmail}. No se crea otra.\n`
      + 'Corré este guion SIN `--create-identity` para promover la que ya está.',
    );
  }

  console.log(`  Identidad: ${existente ? `ya existe (${existente.id}) — se PROMUEVE` : 'no existe — se va a CREAR'}`);

  if (!confirmed) {
    console.log('\nENSAYO. No se escribió nada.');
    console.log(`Volvé a correrlo con --confirm para ${existente ? 'promoverla' : 'crearla'} de verdad.`);
    process.exit(2);
  }

  // ── 4. La cuenta, sin contraseña ─────────────────────────────────────────
  let ownerId = existente?.id || '';
  if (!existente) {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: ownerEmail,
      email_confirm: true,
      user_metadata: { taba_actor: 'owner' },
    });
    if (createError || !created?.user?.id) {
      fail(`No pudimos crear la cuenta: ${createError?.message || 'respuesta vacía'}`);
    }
    ownerId = created.user.id;
  }

  // ── 5. La membresía, con credencial de servicio ──────────────────────────
  // El guard de membresías tiene una vía explícita para service_role. Es la
  // única escritura de identidad que ocurre fuera de una RPC, y existe
  // justamente para este arranque.
  // El rollback distingue los dos modos, y la diferencia no es cosmética:
  // borrar la cuenta está bien si la acabamos de crear nosotros, y está MAL si
  // es de una persona que se registró sola. Al promover se deshacen sólo las
  // filas que este guion escribió.
  const rollback = async (why) => {
    await admin.from('staff_profiles').delete().eq('business_id', businessId).eq('user_id', ownerId);
    await admin.from('identity_user_security').delete().eq('business_id', businessId).eq('user_id', ownerId);
    await admin.from('business_members').delete().eq('business_id', businessId).eq('user_id', ownerId);
    if (!existente) {
      await admin.auth.admin.deleteUser(ownerId).catch(() => {});
      fail(`${why} La cuenta recién creada se borró para no dejar una identidad huérfana.`);
    }
    fail(`${why} Se deshicieron las filas de esta corrida; la cuenta de la persona NO se tocó.`);
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
  //
  // Dos detalles que costaron el evento del PRIMER arranque real, y que la
  // tabla impone con CHECK:
  //
  //   · `actor_role` sólo acepta los roles del comercio y 'system'. Un
  //     bootstrap es 'system'; 'service_role' rebota.
  //   · `event_type` es una lista cerrada. No existe -ni hace falta- un tipo
  //     propio: lo que este arranque hace es activar al primer integrante, o
  //     sea 'member_activated'. Que fue un bootstrap lo dice la metadata.
  const { error: auditError } = await admin.rpc('identity_record_audit_event', {
    p_event_type: 'member_activated',
    p_business_id: businessId,
    p_actor_user_id: null,
    p_actor_role: 'system',
    p_subject_user_id: ownerId,
    p_session_id: null,
    p_metadata: {
      tool: 'bootstrap-first-business-owner',
      bootstrap: true,
      role: 'owner',
      ref,
      email: ownerEmail,
    },
  });

  // ── 7. La contraseña la elige la persona ─────────────────────────────────
  // Al PROMOVER no se emite ningun enlace: esa persona ya tiene su contrasena y
  // este guion no toca sus credenciales. El enlace existe solo para la cuenta
  // que acabamos de crear, que nace sin contrasena.
  const { data: link, error: linkError } = existente
    ? { data: null, error: null }
    : await admin.auth.admin.generateLink({ type: 'recovery', email: ownerEmail });

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
  console.log(`  auditoría: ${auditError ? `NO se pudo registrar (${auditError.message})` : 'member_activated (bootstrap)'}`);
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
