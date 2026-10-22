// node scripts/local-db/clone.mjs <taba_local_name> [--from taba_local_base] [--apply-newer-than <migration>]
// Copies the template database (fast) and applies every migration newer than the template's last one.
import fs from 'node:fs';
import path from 'node:path';
import { psqlRaw, migrationFiles, localizeMigration } from './lib.mjs';

const name = process.argv[2];
const arg = flag => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; };
const template = arg('--from') || 'taba_local_base';
const after = arg('--apply-newer-than') || '20261021235000_security_hardening.sql';
if (!/^taba_local_[a-z0-9_]+$/.test(name || '')) throw new Error('Name must be taba_local_*');
psqlRaw('postgres', `drop database if exists ${name} with (force); create database ${name} template ${template};`);
const applied = [];
for (const file of migrationFiles()) {
  const base = path.basename(file);
  if (base <= after) continue;
  try {
    psqlRaw(name, 'set search_path=public,extensions;\n' + localizeMigration(fs.readFileSync(file, 'utf8')));
  } catch (error) {
    console.error(JSON.stringify({ db: name, failedMigration: base, message: String(error.message).slice(0, 2500) }));
    process.exit(1);
  }
  applied.push(base);
}
console.log(JSON.stringify({ db: name, template, applied }));
