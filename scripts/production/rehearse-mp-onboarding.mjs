/*
 * Ensayo del alta de Mercado Pago de un comercio en el proyecto de producción, ANTES de que exista.
 *
 * Aplica, sobre una COPIA temporal de supabase/functions, el mismo binding que escribirá
 * scripts/production/bind-production.mjs para un ref ficticio, y corre ahí
 * supabase/functions/_shared/production-onboarding-rehearsal.deno.ts: conectar → callback → verificar, con la
 * llave final ausente. El árbol del repositorio no se toca; no hay red (Deno --deny-net) ni credenciales.
 *
 *   node scripts/production/rehearse-mp-onboarding.mjs [--ref <20 letras>] [--origin https://la-taba.pages.dev]
 *
 * Salida 0 = el alta funciona sobre el código del binding. 1 = no.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { ROOT } from '../lib/environments.mjs';
import { bindSellerOauth, addRefToList, FILES } from './bind-production.mjs';

const value = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const ref = value('--ref', 'rehearsalprodrefzzzz');
const origin = value('--origin', 'https://la-taba.pages.dev');
if (!/^[a-z]{20}$/.test(ref)) throw new Error('ref inválido');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taba-mp-onboarding-'));
try {
  const copy = path.join(temp, 'supabase', 'functions');
  fs.cpSync(path.join(ROOT, 'supabase', 'functions'), copy, { recursive: true });
  const write = (file, transform) => {
    const target = path.join(temp, file);
    fs.writeFileSync(target, transform(fs.readFileSync(target, 'utf8')), 'utf8');
  };
  write(FILES.sellerOauth, (source) => bindSellerOauth(source, { ref, origin, at: new Date().toISOString() }));
  write(FILES.recoveryDeployment, (source) => addRefToList(source, 'RECOVERY_FORBIDDEN_REFS = new Set([', ref, 'recovery-deployment.ts'));
  const result = spawnSync('npx', ['--yes', 'deno@2.6.1', 'test', '--node-modules-dir=none', '--allow-env', '--deny-net',
    // The shell joins arguments on Windows (npx is a .cmd): the only path is quoted.
    JSON.stringify(path.join(copy, '_shared', 'production-onboarding-rehearsal.deno.ts'))], {
    cwd: temp, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, TABA_REHEARSAL_PRODUCTION_REF: ref, TABA_REHEARSAL_PRODUCTION_ORIGIN: origin },
  });
  console.log(result.status === 0
    ? `ENSAYO DE ALTA OK: el binding de ${ref} vincula un comercio sin la llave final y rechaza la cuenta de La Taba.`
    : 'ENSAYO DE ALTA FALLÓ');
  process.exitCode = result.status === 0 ? 0 : 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
