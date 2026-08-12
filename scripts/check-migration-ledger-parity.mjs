// ============================================================================
//  Compuerta: el árbol local tiene que ser EXACTAMENTE el ledger de staging
// ============================================================================
//
//  QUÉ PROBLEMA RESUELVE, Y NO ES HIPOTÉTICO
//  -----------------------------------------
//  Pasaron las tres cosas, el mismo día, en el mismo proyecto:
//
//   1. Una sesión aplicó a staging dos migraciones que no estaban en ningún
//      commit. `supabase db push` quedó inutilizable PARA TODOS desde un árbol
//      limpio, y lo único que el CLI ofrecía era marcarlas `reverted`: mentir
//      sobre migraciones que sí estaban aplicadas.
//
//   2. Dos ramas distintas usaron el MISMO número de versión con contenido
//      distinto (20260812100000, y también 20260807110000..150000 entre las
//      ramas de ARCA y de pilot-ops). El CLI casa por versión, no por contenido:
//      da por aplicada una migración que nunca corrió, la saltea, y las
//      siguientes corren contra un esquema que no existe.
//
//   3. Hay seis ramas vivas con migraciones que staging NO tiene. Un `db push`
//      desde cualquiera de ellas aplica trabajo ajeno de arrastre.
//
//  LA REGLA
//  --------
//  Si el conjunto de versiones del árbol local no es EXACTAMENTE el del ledger
//  remoto, esto falla y nadie muta staging. No avisa: falla.
//
//  Y FALLA CERRADO TAMBIÉN CUANDO NO SABE. Si no puede leer el ledger remoto
//  —sin token, sin red, respuesta rara— el resultado es el mismo: no se sigue.
//  «No pude comprobarlo» y «está bien» no son lo mismo, y confundirlos es
//  justamente lo que hay que impedir.
//
//  Uso:
//    node scripts/check-migration-ledger-parity.mjs            # exige paridad
//    node scripts/check-migration-ledger-parity.mjs --explain  # además detalla
//
//  Como módulo:
//    import { assertLedgerParity } from './check-migration-ledger-parity.mjs';
//    await assertLedgerParity();   // lanza si no hay paridad
// ============================================================================
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = process.env.TABA_SUPABASE_PROJECT_REF || 'ukxqbgswjlibmnjemrzd';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Las versiones que el árbol declara: los 14 primeros caracteres del nombre. */
export function localMigrationSet(migrationsDir = path.join(root, 'supabase', 'migrations')) {
  const files = fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
  const versions = new Map();
  for (const file of files) {
    const version = file.slice(0, 14);
    if (!/^\d{14}$/.test(version)) {
      throw new Error(`nombre de migración sin versión de 14 dígitos: ${file}`);
    }
    // Dos archivos con la misma versión es la colisión del punto 2, pero dentro
    // de un mismo árbol. Se corta acá y no en el push.
    if (versions.has(version)) {
      throw new Error(`versión duplicada en el árbol: ${version} → ${versions.get(version)} y ${file}`);
    }
    versions.set(version, file);
  }
  return versions;
}

function accessToken() {
  const fromEnv = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (fromEnv) return fromEnv;
  // En esta máquina el token vive en el Administrador de credenciales de
  // Windows, que es de donde lo saca el propio CLI. Nunca se imprime.
  const value = execFileSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'scripts', 'read-supabase-token.ps1'),
  ], { encoding: 'utf8' }).trim();
  if (!/^sbp_[A-Za-z0-9]+$/.test(value)) throw new Error('token del CLI ilegible');
  return value;
}

export async function remoteLedgerSet() {
  const response = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select version from supabase_migrations.schema_migrations order by version' }),
  });
  if (!response.ok) throw new Error(`no se pudo leer el ledger remoto: HTTP ${response.status}`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('el ledger remoto no devolvió una lista');
  return new Set(rows.map((row) => row.version));
}

export async function assertLedgerParity({ explain = false } = {}) {
  const local = localMigrationSet();
  const remote = await remoteLedgerSet();

  const localOnly = [...local.keys()].filter((v) => !remote.has(v)).sort();
  const remoteOnly = [...remote].filter((v) => !local.has(v)).sort();

  if (explain || localOnly.length || remoteOnly.length) {
    console.log(`migraciones en el árbol : ${local.size}`);
    console.log(`filas en el ledger      : ${remote.size}`);
  }
  if (localOnly.length) {
    console.error(`\nEN GIT Y SIN APLICAR (${localOnly.length}):`);
    for (const v of localOnly) console.error(`  ${v}  ${local.get(v)}`);
    console.error('  Un `db push` desde esta rama las aplicaría a staging.');
  }
  if (remoteOnly.length) {
    console.error(`\nAPLICADAS EN STAGING Y AUSENTES DEL ÁRBOL (${remoteOnly.length}):`);
    for (const v of remoteOnly) console.error(`  ${v}`);
    console.error('  Esta rama NO puede reconstruir staging. Falta traer ese trabajo,');
    console.error('  no marcarlo como revertido.');
  }
  if (localOnly.length || remoteOnly.length) {
    throw new Error('LOCAL_MIGRATION_SET != REMOTE_LEDGER_SET: no se muta staging');
  }
  return { total: local.size };
}

const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const { total } = await assertLedgerParity({ explain: process.argv.includes('--explain') });
    console.log(`paridad de ledger: ${total}/${total}. Esta rama reconstruye staging exactamente.`);
  } catch (error) {
    console.error(`\nPREFLIGHT FALLIDO — ${error.message}`);
    process.exit(1);
  }
}
