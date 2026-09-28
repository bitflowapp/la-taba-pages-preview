// Verificación de plataforma del comercio real: la habilitación de pedidos online.
//
//   npm run opening:approve -- --verifier-email <operador@...> [--business la-taba-cp] [--min-products 1] [--note "..."]
//   npm run opening:approve -- --revoke --verifier-email <operador@...> --reason "..."
//
// Quién: un operador de plataforma, en su máquina, con la clave de servicio de
// CP (Credential Manager). El dueño NO puede hacerlo: `ordering_verified` no
// tiene permiso de escritura para personas y la RPC sólo la ejecuta
// `service_role`.
//
// Qué hace, en orden:
//   1. muestra la preparación (la misma del Panel) y se niega si falta algo;
//   2. pide escribir el identificador del comercio para confirmar (o --confirm);
//   3. llama a `platform_verify_business_ordering`, que VUELVE a evaluar todas
//      las compuertas adentro de la base, falla cerrada (OPENING_NOT_READY) y
//      deja auditoría con quién, cuándo, la nota y los números del catálogo.
//
// NUNCA abre el comercio: el local sigue cerrado hasta que el dueño lo abre
// desde el Panel. `--revoke` apaga los pedidos online (con motivo y auditoría).
import { createInterface } from 'node:readline/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REAL_BUSINESS_SLUG, connectControlledProduction, parseMinProducts, presentFrom, readOpeningReadiness,
  readOption, renderOpeningLines, resolveBusiness,
} from './opening-tools.mjs';
import { presentOpeningItem } from '../../js/core/store-opening-readiness.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;

export function parseApproveArgs(args = []) {
  const known = ['--business', '--verifier-email', '--min-products', '--note', '--confirm', '--revoke', '--reason'];
  const unknown = args.filter((arg) => arg.startsWith('--') && !known.includes(arg));
  if (unknown.length) throw Error(`Flag desconocido: ${unknown[0]}`);
  const verifierEmail = readOption(args, '--verifier-email', '');
  if (!EMAIL.test(verifierEmail)) throw Error('--verifier-email tiene que ser el correo de la cuenta del operador de plataforma.');
  const revoke = args.includes('--revoke');
  const reason = readOption(args, '--reason', '');
  if (revoke && (reason.trim().length < 3 || reason.length > 300)) throw Error('--revoke necesita --reason (3 a 300 caracteres).');
  const note = readOption(args, '--note', '');
  if (note.length > 300) throw Error('--note va hasta 300 caracteres.');
  return {
    business: readOption(args, '--business', REAL_BUSINESS_SLUG),
    verifierEmail,
    minProducts: parseMinProducts(args, 1),
    note: note.trim() || null,
    confirm: readOption(args, '--confirm', ''),
    revoke,
    reason: reason.trim(),
  };
}

/** Traduce el rechazo de la base a la lista de pasos pendientes, en palabras. */
export function describeRefusal(error) {
  const message = String(error?.message || '');
  if (message === 'OPENING_NOT_READY') {
    const codes = String(error?.details || '').split(',').map((code) => code.trim()).filter(Boolean);
    return ['La base rechazó la verificación: falta completar',
      ...codes.map((code) => `  ✗ ${code} · ${presentOpeningItem({ code, status: 'pending', blocking: true }).title}`)];
  }
  if (message === 'CONFIRMATION_MISMATCH') return ['La confirmación no coincide con el identificador del comercio. No se escribió nada.'];
  if (message === 'VERIFIER_NOT_FOUND') return ['Ese correo no corresponde a una cuenta confirmada y activa. No se escribió nada.'];
  return [`La base rechazó la operación (${error?.code || 'sin código'}). No se escribió nada.`];
}

async function askConfirmation(slug) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(`Para confirmar, escribí el identificador del comercio (${slug}): `)).trim();
  } finally {
    rl.close();
  }
}

async function main(args) {
  let options;
  try { options = parseApproveArgs(args); } catch (error) { console.error(`ERROR ${error.message}`); process.exitCode = 2; return; }
  const { admin } = await connectControlledProduction();
  const business = await resolveBusiness(admin, options.business);
  if (business.qa_fixture) console.log('Aviso: este comercio es un tenant QA.');

  const payload = await readOpeningReadiness(admin, business.id, options.minProducts);
  const presented = presentFrom(payload);
  console.log(`${business.name} (${business.slug}) — ${presented.headline}`);
  for (const line of renderOpeningLines(presented)) console.log(line);
  console.log('');

  if (!options.revoke && !presented.commercialReady) {
    console.log('VERIFICACIÓN RECHAZADA ANTES DE ESCRIBIR: completá los pasos pendientes y volvé a correr este comando.');
    process.exitCode = 3;
    return;
  }

  const confirmation = options.confirm || await askConfirmation(business.slug);
  if (confirmation !== business.slug) {
    console.log('La confirmación no coincide. No se escribió nada.');
    process.exitCode = 3;
    return;
  }

  const { data, error } = options.revoke
    ? await admin.rpc('platform_revoke_business_ordering', {
      p_business_id: business.id, p_actor_email: options.verifierEmail, p_confirm_slug: confirmation, p_reason: options.reason,
    })
    : await admin.rpc('platform_verify_business_ordering', {
      p_business_id: business.id, p_verifier_email: options.verifierEmail, p_confirm_slug: confirmation,
      p_min_products: options.minProducts, p_note: options.note,
    });
  if (error) {
    for (const line of describeRefusal(error)) console.log(line);
    process.exitCode = 3;
    return;
  }
  if (options.revoke) {
    console.log(data?.changed ? 'Pedidos online REVOCADOS. La web deja de tomar pedidos.' : 'No había nada que revocar.');
  } else {
    console.log(data?.changed
      ? `Comercio VERIFICADO (${data.verified_at}). Queda registrado quién y cuándo.`
      : 'El comercio ya estaba verificado. No se cambió nada.');
    console.log(`El local sigue ${data?.status === 'open' ? 'abierto' : 'cerrado'}: lo abre el dueño desde Panel › Abrir el negocio.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => { console.error(`OPENING_APPROVE_FAILED: ${error.message}`); process.exitCode = 2; });
}
