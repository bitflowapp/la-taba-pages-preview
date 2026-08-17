# TABA2 · Alta autogestionada + memoria del cliente · EVIDENCIA

Misión: que TABA deje de depender de cuentas creadas a mano.
Destino productivo: `la-taba-production` (`wwcpogltfgzgkrlilbcd`), ledger **103 → 107**.

Todo lo que hay acá está medido, no inferido. Sin secretos.

## Índice

| Archivo | Qué contiene |
|---|---|
| `EXISTING-MODEL-REUSED.md` | Fase 0: `EXISTING MODEL → REQUIRED DELTA`. Qué ya existía, qué faltaba, y qué se decidió **no** crear |
| `REGISTRATION-STATE-MACHINE.md` | la máquina de estados del alta, las cinco pantallas del Panel y las tres del Rider |
| `APPROVAL-CONTRACT.md` | por qué aprobar es un solo acto, y las tres reglas que impiden la auto-escalada |
| `CUSTOMER-DATA-MODEL.md` | los campos reales del checkout clasificados en PERSIST SAFE / SESSION ONLY / NEVER STORE |
| `SECURITY-REPORT.md` | informe de seguridad, con los dos defectos que encontró el smoke en vivo |
| `RLS-MATRIX.md` | matriz de acceso medida contra producción, antes y después |
| `BOOTSTRAP-FIRST-BUSINESS-OWNER.md` | runbook del primer owner. **Listo, no ejecutado**: falta el correo del dueño real |
| `TEST-REPORT.md` | todos los totales de pruebas, con lo que es preexistente marcado como tal |
| `SYNTHETIC-CLEANUP.md` | evidencia del smoke sintético y de su limpieza, incluidos los dos intentos que fallaron |
| `PACKAGE-SCANS.md` | escaneos del cliente web y de la app Rider |
| `PREVIEWS-AND-BUILDS.md` | estado de los builds, y por qué no se desplegó ninguna preview |
| `LOCAL-CLEANUP.md` | qué se levantó local, qué se apagó, y los 23 containers que no se tocaron |
| `FINAL-REPORT.md` | **el informe final**: verdict, P0/P1/P2, compuertas humanas y líneas de seguridad |
| `REGISTRATION-MIGRATIONS.json` | manifiesto de las migraciones 104-107 con sus hashes, y los dos digests verificados |
| `PRODUCTION-PORTRAIT-BEFORE.json` | retrato de seguridad de producción **antes** del push (ledger 103) |
| `PRODUCTION-PORTRAIT-AFTER.json` | retrato **después** (ledger 107), con el bloque del alta |
| `remote-ledger-before.{json,txt}` | ledger remoto antes: 103 aplicadas, 2 pendientes, 0 drift |
| `remote-ledger-after.{json,txt}` | ledger remoto después: 107, local == remoto, 0 drift |
| `PRODUCTION-PUSH-GUARD.log` | las tres corridas de la guardia de destino |
| `PRODUCTION-PUSH.log` | el apply de las cuatro migraciones |
| `LIVE-SMOKE.log` | la corrida final del smoke sintético: 37 comprobaciones, limpieza 5/5 |
| `NEGATIVE-CONTROLS.log` | los seis controles negativos: romper cada garantía y ver la suite pasar a FAIL |
| `screenshots/` | 21 capturas: 5 pantallas del alta × 3 anchos, bandeja como owner y como empleado × 3 anchos |

## Lo que hay que leer primero

1. `EXISTING-MODEL-REUSED.md` — explica por qué esta misión escribió menos de lo
   previsto: dos de los tres tracks ya tenían su modelo, y lo que faltaba eran
   pruebas.
2. `SECURITY-REPORT.md` §5 — los dos defectos que encontró el smoke contra
   producción alojada, ninguno visible desde un stack local.
3. `TEST-REPORT.md` §Preexistente — qué falla desde antes y no lo rompió esta
   misión.
