#!/usr/bin/env node
/*
 * ALTA DE LA IDENTIDAD CON LA QUE EL ROBOT OPERA EL PANEL. UNA VEZ, A MANO.
 *
 * Esto NO corre dentro de una prueba: es el trámite previo. Da de alta una
 * cuenta dedicada, le pone el rol más chico que le alcance y guarda su
 * contraseña —generada por la máquina— en el Credential Manager de Windows,
 * para que ninguna persona tenga que conocerla ni escribirla nunca.
 *
 * POR QUÉ NO ALCANZA CON LA PANTALLA PÚBLICA
 * ------------------------------------------
 * Porque el alta normal no puede terminar en este proyecto. Auth de producción
 * tiene `mailer_autoconfirm = false` y no tiene SMTP propio: una cuenta creada
 * desde el Panel queda esperando un correo de confirmación que hoy nadie puede
 * entregar de forma automatizable, y sin confirmar no entra. La API de
 * administración es la única vía que existe, igual que para el primer dueño
 * (`bootstrap-first-business-owner.mjs`, mismo precedente, mismo mecanismo).
 *
 * LA CREDENCIAL ADMINISTRATIVA NO SE BUSCA SOLA
 * ---------------------------------------------
 * Este guion NO va a buscar la clave de servicio a ningún lado. Hay que
 * dársela, y eso es a propósito: un guion que se consigue solo la credencial
 * más fuerte del proyecto es un guion que puede hacer cualquier cosa sin que
 * nadie lo haya decidido. Acá la decisión es de quien lo ejecuta, cada vez.
 *
 *   $j = (supabase projects api-keys --project-ref wwcpogltfgzgkrlilbcd `
 *       --reveal --output-format json | Out-String | ConvertFrom-Json)
 *   $env:SUPABASE_SERVICE_ROLE_KEY = ($j.keys |
 *       Where-Object { $_.name -eq 'service_role' }).api_key
 *   node scripts/e2e-production-sale/provisionar-identidad-panel.mjs            # ensayo
 *   node scripts/e2e-production-sale/provisionar-identidad-panel.mjs --confirm  # escribe
 *   Remove-Item Env:\SUPABASE_SERVICE_ROLE_KEY
 *
 * Las dos partes que cuestan encontrar: sin `--reveal` el CLI devuelve las
 * claves recortadas, y la respuesta no es un arreglo sino un objeto con `keys`
 * adentro. Se documenta acá porque probarlo costó dos intentos.
 *
 * Ningún módulo del harness lee esa variable —hay una prueba que lo comprueba—.
 * Vive un rato en la consola de quien aprovisiona y ahí se queda.
 *
 * QUÉ ESCRIBE, EXACTAMENTE
 * ------------------------
 *   · una cuenta de Auth con el correo del contrato, con el correo dado por
 *     confirmado y con una contraseña aleatoria de 32 caracteres;
 *   · UNA fila en `business_members` con rol `admin`;
 *   · su estado de seguridad y su perfil de equipo, como cualquier integrante;
 *   · un evento de auditoría `member_activated`.
 *
 * Y nada más. No toca a ningún otro integrante, no cambia roles ajenos, no
 * otorga `owner` —ni siquiera si se lo piden— y no modifica el comercio.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { PRODUCCION } from './contrato.mjs';
import {
  IDENTIDAD_PANEL, NEGOCIO_ID, RUTAS_IDENTIDAD, correoDelPanel, evaluarRolDelPanel,
} from './identidades.mjs';
import { generarContrasena, guardarSecreto, leerSecreto } from './secretos-windows.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const banderas = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2)));
const confirmado = banderas.has('confirm');
const rotar = banderas.has('rotar');

const abortar = (mensaje) => {
  console.error(`\nABORTADO. ${mensaje}`);
  process.exit(1);
};

/** La misma guardia de destino que usa el push de migraciones. */
function guardiaDeDestino() {
  const salida = execFileSync(process.execPath, [
    path.join(RAIZ, 'scripts', 'assert-production-supabase-target.mjs'),
    '--ref', PRODUCCION.supabaseRef,
    '--url', `https://${PRODUCCION.supabaseRef}.supabase.co`,
    '--category', 'alta de identidad E2E',
  ], { encoding: 'utf8' });
  console.log(salida.trim());
}

/**
 * La ficha es un puntero, no un secreto: dice QUIÉN es la identidad y DÓNDE
 * quedó guardada su contraseña, nunca cuál es. Vive en `.local/`, que está en
 * .gitignore.
 */
function escribirFicha({ userId, correo, rol }) {
  const destino = path.join(RAIZ, RUTAS_IDENTIDAD.panelIdentidad);
  mkdirSync(path.dirname(destino), { recursive: true });
  writeFileSync(destino, `${JSON.stringify({
    nombre: IDENTIDAD_PANEL.nombreHumano,
    userId,
    correo,
    rol,
    credencial: `referencia al Credential Manager de Windows: ${IDENTIDAD_PANEL.credencial}`,
    aprovisionadaUtc: new Date().toISOString(),
  }, null, 2)}\n`);
  console.log(`  ficha .......... ${RUTAS_IDENTIDAD.panelIdentidad} (sin secretos)`);
}

async function main() {
  guardiaDeDestino();

  const credencialAdministrativa = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!credencialAdministrativa) {
    abortar(
      'falta SUPABASE_SERVICE_ROLE_KEY en el entorno.\n'
      + 'Este guion no la busca solo: la decisión de usar la credencial más fuerte del\n'
      + 'proyecto es de quien lo ejecuta. Está arriba, en el comentario, cómo obtenerla\n'
      + 'y cómo borrarla del entorno al terminar.',
    );
  }

  const correo = correoDelPanel();
  const admin = createClient(`https://${PRODUCCION.supabaseRef}.supabase.co`, credencialAdministrativa, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. El comercio ────────────────────────────────────────────────────────
  const { data: negocio, error: errorNegocio } = await admin
    .from('businesses').select('id, name, is_active').eq('id', NEGOCIO_ID).maybeSingle();
  if (errorNegocio) abortar(`no se pudo leer el comercio: ${errorNegocio.message}`);
  if (!negocio?.is_active) abortar('el comercio no existe o está dado de baja');

  // ── 2. ¿Qué hay ya? ───────────────────────────────────────────────────────
  const { data: lista, error: errorLista } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (errorLista) abortar(`no se pudo listar identidades: ${errorLista.message}`);
  const existente = (lista?.users || []).find((u) => String(u.email || '').toLowerCase() === correo);

  const { data: miembros, error: errorMiembros } = await admin
    .from('business_members').select('user_id, role, is_active').eq('business_id', NEGOCIO_ID);
  if (errorMiembros) abortar(`no se pudo leer el equipo: ${errorMiembros.message}`);
  const membresia = existente ? (miembros || []).find((m) => m.user_id === existente.id) : null;
  const ajenos = (miembros || []).filter((m) => m.user_id !== existente?.id);

  /*
   * La compuerta que impide que esto se convierta en una puerta trasera: toca
   * UNA fila, la de la identidad del contrato, y sólo le pone el rol del
   * contrato. Cualquier otra cosa se rechaza y se resuelve desde el Panel.
   */
  if (membresia && membresia.role !== IDENTIDAD_PANEL.rol) {
    abortar(
      `${correo} ya es integrante con rol «${membresia.role}» y el contrato dice «${IDENTIDAD_PANEL.rol}». `
      + 'Este guion no cambia roles ya otorgados.',
    );
  }

  const guardada = leerSecreto(IDENTIDAD_PANEL.credencial);
  console.log('\n--- ALTA DE IDENTIDAD E2E ---');
  console.log(`  comercio ....... ${negocio.name}`);
  console.log(`  identidad ...... ${IDENTIDAD_PANEL.nombreHumano} <${correo}>`);
  console.log(`  rol ............ ${IDENTIDAD_PANEL.rol} (nunca ${IDENTIDAD_PANEL.rolesProhibidos.join('/')})`);
  console.log(`  cuenta ......... ${existente ? `ya existe (${existente.id})` : 'no existe: se va a CREAR'}`);
  console.log(`  integrante ..... ${membresia ? `sí (${membresia.role}, activo=${membresia.is_active})` : 'no: se va a CREAR'}`);
  console.log(`  contraseña ..... ${guardada ? 'ya guardada localmente' : 'no guardada: se va a GENERAR'}`);
  console.log(`  equipo ajeno ... ${ajenos.length} integrante(s), que no se tocan`);

  const crearCuenta = !existente;
  const crearMembresia = !membresia;
  const escribirClave = !guardada || rotar;
  if (!crearCuenta && !crearMembresia && !escribirClave && membresia?.is_active) {
    console.log('\nNada que hacer: la identidad ya está dada de alta.');
    escribirFicha({ userId: existente.id, correo, rol: membresia.role });
    process.exit(0);
  }

  if (!confirmado) {
    console.log('\nENSAYO. No se escribió nada. Volvé a correrlo con --confirm.');
    process.exit(2);
  }

  // ── 3. La cuenta ──────────────────────────────────────────────────────────
  const contrasena = escribirClave ? generarContrasena(32) : null;
  let userId = existente?.id || '';

  if (crearCuenta) {
    const { data: creada, error } = await admin.auth.admin.createUser({
      email: correo,
      password: contrasena,
      email_confirm: true,
      user_metadata: { taba_actor: 'team', taba_e2e_operator: true, nombre: IDENTIDAD_PANEL.nombreHumano },
    });
    if (error || !creada?.user?.id) abortar(`no se pudo crear la cuenta: ${error?.message || 'respuesta vacía'}`);
    userId = creada.user.id;
    console.log('  · cuenta creada, con el correo dado por confirmado');
  } else if (escribirClave) {
    /*
     * La cuenta existe y acá no hay contraseña guardada. No se puede
     * «recuperar» una: no se guarda en claro en ningún lado. La única salida
     * honesta es escribir una nueva, y se dice en voz alta —si esa cuenta la
     * estuviera usando alguien más, esto lo deja afuera—.
     */
    const { error } = await admin.auth.admin.updateUserById(userId, { password: contrasena });
    if (error) abortar(`no se pudo fijar la contraseña: ${error.message}`);
    console.log(rotar ? '  · contraseña rotada' : '  · no había contraseña guardada: se fijó una nueva');
  }

  // ── 4. El integrante, su estado de seguridad y su perfil ──────────────────
  if (crearMembresia) {
    const { error } = await admin.from('business_members')
      .insert({ business_id: NEGOCIO_ID, user_id: userId, role: IDENTIDAD_PANEL.rol, is_active: true });
    if (error) abortar(`no se pudo dar de alta al integrante: ${error.message}`);
    console.log(`  · integrante dado de alta con rol ${IDENTIDAD_PANEL.rol}`);
  } else if (membresia && membresia.is_active !== true) {
    const { error } = await admin.from('business_members')
      .update({ is_active: true }).eq('business_id', NEGOCIO_ID).eq('user_id', userId);
    if (error) abortar(`no se pudo reactivar al integrante: ${error.message}`);
    console.log('  · integrante reactivado');
  }

  const { error: errorSeguridad } = await admin.from('identity_user_security')
    .upsert({ business_id: NEGOCIO_ID, user_id: userId }, { onConflict: 'business_id,user_id' });
  if (errorSeguridad) console.log(`  · aviso: estado de seguridad no escrito (${errorSeguridad.message})`);

  const { error: errorPerfil } = await admin.from('staff_profiles')
    .upsert({ business_id: NEGOCIO_ID, user_id: userId, full_name: IDENTIDAD_PANEL.nombreHumano }, { onConflict: 'business_id,user_id' });
  if (errorPerfil) console.log(`  · aviso: perfil no escrito (${errorPerfil.message})`);

  // ── 5. El rastro de auditoría ─────────────────────────────────────────────
  const { error: errorAuditoria } = await admin.rpc('identity_record_audit_event', {
    p_event_type: 'member_activated',
    p_business_id: NEGOCIO_ID,
    p_actor_user_id: null,
    p_actor_role: 'system',
    p_subject_user_id: userId,
    p_session_id: null,
    p_metadata: {
      tool: 'provisionar-identidad-panel', role: IDENTIDAD_PANEL.rol, email: correo, automation: true,
    },
  });
  console.log(`  · auditoría ...... ${errorAuditoria ? `NO registrada (${errorAuditoria.message})` : 'member_activated'}`);

  // ── 6. La contraseña, al almacén del sistema ──────────────────────────────
  if (contrasena) {
    guardarSecreto(IDENTIDAD_PANEL.credencial, correo, contrasena);
    console.log('  · contraseña guardada en el Credential Manager de Windows');
  }

  // ── 7. La comprobación final, contra el servidor ──────────────────────────
  const { data: verificacion } = await admin.from('business_members')
    .select('role, is_active').eq('business_id', NEGOCIO_ID).eq('user_id', userId).maybeSingle();
  const compuerta = evaluarRolDelPanel(verificacion?.role);
  if (!compuerta.ok) abortar(`quedó mal dada de alta: ${compuerta.mensaje}`);

  escribirFicha({ userId, correo, rol: verificacion.role });

  console.log('\nListo.');
  console.log(`  user_id ........ ${userId}`);
  console.log(`  rol ............ ${verificacion.role} · activo=${verificacion.is_active}`);
  console.log('  contraseña ..... en el Credential Manager; ninguna persona la conoce ni la necesita');
  console.log('\nPara apagarla sin borrar nada: is_active=false en su fila de business_members.');
}

await main();
