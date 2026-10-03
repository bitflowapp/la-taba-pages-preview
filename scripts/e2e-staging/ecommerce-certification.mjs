// CERTIFICACIÓN E-COMMERCE EN STAGING — punto de entrada.
//
// Corre contra el STAGING REAL de La Taba (Supabase `la-taba-staging`) y nada más,
// sobre UN tenant propio y aislado (`qa-ecom-cert`). No toca el negocio de Staging
// que usan otras certificaciones, no usa Mercado Pago y no cobra nada.
//
//   node scripts/e2e-staging/ecommerce-certification.mjs --preflight
//   node scripts/e2e-staging/ecommerce-certification.mjs --confirm STAGING_MUTATION_OK [--phases a,b,c] [--evidence-dir <dir>] [--keep-tenant-open]
//   node scripts/e2e-staging/ecommerce-certification.mjs --reconcile <evidence dir>
//
// Con `--target local` las mismas fases corren, por HTTP real, contra el PostgREST
// local delante de un PostgreSQL con las migraciones del repo: no lee ninguna clave
// real y de la máquina no sale nada. No es Staging y no lo reemplaza (ver
// `ecommerce/local-target.mjs`). Pide su propia confirmación y la ruta de la compuerta:
//
//   TABA_LOCAL_GATE=<módulo de la compuerta> node scripts/e2e-staging/ecommerce-certification.mjs --target local --preflight
//   TABA_LOCAL_GATE=<módulo de la compuerta> node scripts/e2e-staging/ecommerce-certification.mjs --target local --confirm LOCAL_MUTATION_OK [...]
//
// La implementación vive en `scripts/e2e-staging/ecommerce/` (entorno, transporte,
// tenant, pedidos y una fase por archivo).
import { main } from './ecommerce/cli.mjs';

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`ECOMMERCE_CERTIFICATION_BLOCKED:${String(error?.message || error).slice(0, 300)}\n`);
  process.exitCode = 2;
}
