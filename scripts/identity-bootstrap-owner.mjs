#!/usr/bin/env node
/**
 * Alta del PRIMER dueño de un comercio, en un entorno recién creado.
 *
 * Es el único momento en que una cuenta de equipo se crea sin invitación,
 * porque todavía no existe nadie con autoridad para emitirla. De acá en
 * adelante, todas las altas —admin, staff y riders— pasan por
 * identity_create_invitation y quedan auditadas.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   TABA_BUSINESS_ID=... TABA_OWNER_EMAIL=... TABA_OWNER_NAME="..." \
 *   node scripts/identity-bootstrap-owner.mjs --confirm
 *
 * NO se copia nada de staging: ni usuarios, ni sesiones, ni tokens, ni riders
 * de prueba. La contraseña no se pasa por variable de entorno ni se imprime;
 * se envía un enlace de recuperación al correo y la persona elige la suya. Así
 * la contraseña del dueño no existe en ningún historial de consola ni en
 * ningún archivo.
 *
 * El script se niega a correr si el comercio ya tiene algún integrante: un
 * bootstrap que se puede repetir es una puerta trasera.
 */

import { createClient } from '@supabase/supabase-js';

const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const businessId = String(process.env.TABA_BUSINESS_ID || '').trim();
const ownerEmail = String(process.env.TABA_OWNER_EMAIL || '').trim().toLowerCase();
const ownerName = String(process.env.TABA_OWNER_NAME || '').trim();
const confirmed = process.argv.includes('--confirm');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function main() {
  validate();

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing, error: membersError } = await admin
    .from('business_members')
    .select('user_id, role')
    .eq('business_id', businessId);
  if (membersError) fail(`No pudimos leer el equipo del comercio: ${membersError.message}`);
  if ((existing || []).length > 0) {
    fail(
      `El comercio ya tiene ${existing.length} integrante(s). El bootstrap es para un entorno vacío; `
      + 'las altas siguientes van por invitación (identity_create_invitation).',
    );
  }

  const { data: business, error: businessError } = await admin
    .from('businesses')
    .select('id, name')
    .eq('id', businessId)
    .maybeSingle();
  if (businessError || !business) fail('El comercio no existe. Creálo antes de dar de alta a su dueño.');

  console.log(`Comercio: ${business.name} (${business.id})`);
  console.log(`Dueño:    ${ownerName} <${ownerEmail}>`);
  if (!confirmed) {
    console.log('\nEsto crea una cuenta real de dueño. Volvé a correrlo con --confirm.');
    process.exit(2);
  }

  // Se crea la cuenta SIN contraseña: la persona la elige desde el enlace.
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: ownerEmail,
    email_confirm: true,
    user_metadata: { taba_actor: 'owner' },
  });
  if (createError || !created?.user?.id) {
    fail(`No pudimos crear la cuenta: ${createError?.message || 'respuesta vacía'}`);
  }
  const ownerId = created.user.id;

  // service_role escribe la membresía: es el único camino habilitado fuera de
  // las RPC de identidad, y existe justamente para este arranque.
  const { error: memberError } = await admin
    .from('business_members')
    .insert({ business_id: businessId, user_id: ownerId, role: 'owner', is_active: true });
  if (memberError) {
    await admin.auth.admin.deleteUser(ownerId).catch(() => {});
    fail(`No pudimos crear la membresía: ${memberError.message}`);
  }

  const { error: profileError } = await admin
    .from('staff_profiles')
    .insert({ business_id: businessId, user_id: ownerId, full_name: ownerName });
  if (profileError) console.warn(`Aviso: el perfil no se creó (${profileError.message}).`);

  await admin
    .from('identity_user_security')
    .insert({ business_id: businessId, user_id: ownerId })
    .then(({ error }) => {
      if (error) console.warn(`Aviso: el estado de seguridad no se creó (${error.message}).`);
    });

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email: ownerEmail,
  });
  if (linkError) {
    console.warn(`Aviso: no pudimos generar el enlace para elegir contraseña (${linkError.message}).`);
    console.warn('Usá "Olvidé mi contraseña" en el Panel para completarlo.');
  }

  console.log('\nListo.');
  console.log(`  user_id: ${ownerId}`);
  console.log('  rol:     owner');
  console.log('  contraseña: la elige la persona desde el enlace de recuperación.');
  if (link?.properties?.action_link) {
    console.log('\nEnlace para elegir contraseña (entregalo por un canal seguro; vence):');
    console.log(`  ${link.properties.action_link}`);
  }
  console.log('\nDe acá en adelante, las altas se hacen desde el Panel por invitación.');
}

function validate() {
  const problems = [];
  if (!url.startsWith('https://')) problems.push('SUPABASE_URL debe ser https.');
  if (!serviceRoleKey) problems.push('Falta SUPABASE_SERVICE_ROLE_KEY.');
  if (!UUID.test(businessId)) problems.push('TABA_BUSINESS_ID no es un uuid.');
  if (!EMAIL.test(ownerEmail)) problems.push('TABA_OWNER_EMAIL no es un correo válido.');
  if (ownerName.length < 2) problems.push('Falta TABA_OWNER_NAME.');
  if (process.env.TABA_OWNER_PASSWORD) {
    problems.push(
      'No pases la contraseña por entorno: queda en el historial de la consola. '
      + 'El script manda un enlace para que la persona elija la suya.',
    );
  }
  if (problems.length > 0) fail(problems.join('\n'));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main().catch((error) => fail(error?.message || String(error)));
