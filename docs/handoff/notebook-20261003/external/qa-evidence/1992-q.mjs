import { consultar } from '../../scripts/e2e-production-sale/db-solo-lectura.mjs';
import { readFileSync } from 'node:fs';
let sql = process.argv[2];
if (sql === '-f') sql = readFileSync(process.argv[3], 'utf8');
const r = await consultar(sql);
console.log(JSON.stringify(r, null, 1));
