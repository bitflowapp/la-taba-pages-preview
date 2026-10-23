// node scripts/local-db/bootstrap.mjs <taba_local_name> [--up-to <migration file>]
import { bootstrapDatabase } from './lib.mjs';

const db = process.argv[2];
const i = process.argv.indexOf('--up-to');
try {
  const applied = bootstrapDatabase(db, { upTo: i > 0 ? process.argv[i + 1] : null });
  console.log(JSON.stringify({ db, migrations: applied.length, last: applied.at(-1) }));
} catch (error) {
  console.error(JSON.stringify({ db, failedMigration: error.migration, message: String(error.message).slice(0, 1500) }));
  process.exit(1);
}
