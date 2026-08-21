// Corre las DOS sondas read-only del Auth productivo, con el token del CLI
// prestado por el entorno (nunca impreso, nunca en argv) y la clave publicable
// tomada del runtime-config PÚBLICO que sirve el sitio productivo.
//
//   node artifacts/taba2-go-live-audit/auth/run-sondas-lectura.mjs
//
// Sondas (ambas leídas antes de correr; ninguna muta):
//   · scripts/production-auth-posture.mjs  (npm run production:auth)
//   · scripts/production-auth-health.mjs   (npm run production:auth:health)
//
// La clave publicable es pública por diseño (viaja en cada page-load del sitio);
// igual acá sólo se persiste en un archivo temporal fuera del repo y las sondas
// la reportan por huella.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { conToken } from '../../../scripts/lib/supabase-cli-token.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, '..', '..', '..');
const REF = 'wwcpogltfgzgkrlilbcd';

// 1 · clave publicable, del runtime-config público del sitio productivo (GET).
const r = await fetch('https://la-taba.pages.dev/runtime-config.js');
if (!r.ok) throw new Error(`runtime-config.js -> ${r.status}`);
const js = await r.text();
const m = js.match(/publishableKey:\s*'(sb_publishable_[A-Za-z0-9_-]+)'/);
if (!m) throw new Error('no se encontró publishableKey en el runtime-config publicado');
const keyFile = path.join(os.tmpdir(), `taba2-audit-publishable-${process.pid}.key`);
fs.writeFileSync(keyFile, m[1], 'utf8');

try {
  await conToken(async () => {
    for (const [nombre, guion, reporte] of [
      ['POSTURA (production:auth)', 'scripts/production-auth-posture.mjs', 'posture-report.json'],
      ['SALUD (production:auth:health)', 'scripts/production-auth-health.mjs', 'health-report.json'],
    ]) {
      console.log(`\n=================== ${nombre} ===================`);
      const res = spawnSync(process.execPath, [
        guion, '--ref', REF, '--key-file', keyFile,
        '--report', path.join(AQUI, reporte),
      ], { cwd: RAIZ, stdio: 'inherit' });
      console.log(`--- exit code: ${res.status}`);
      if (res.status !== 0 && res.status !== 1) process.exitCode = 2;
    }
  });
} finally {
  fs.rmSync(keyFile, { force: true });
}
