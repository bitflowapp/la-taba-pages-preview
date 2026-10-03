# LA TABA — HANDOFF NOTEBOOK → PC PRINCIPAL

Fecha de verificación UTC: 2026-10-03T20:33:49.231154+00:00.

NOTEBOOK_HANDOFF: PASS
READY_TO_CONTINUE_ON_MAIN_PC: YES

Sólo preservación Git y documentación. Sin despliegues, promociones, aplicaciones de migraciones, cambios en Staging/Controlled Production, dinero real ni infraestructura. Ningún archivo, stash, branch o worktree fue borrado.

## Leer primero

Backend y frontend comparten **bitflowapp/la-taba-pages-preview**. El checkout original seguía en `main` @ `31c900b7`; no era el último hardening. Se obtuvieron las ramas actuales desde GitHub y se crearon referencias locales, sin cambiar el checkout original. El backend avanzó remotamente durante la auditoría desde `9b106cf3` hasta `6fd0b6f48bc105bd153ffe6f0d7a4af6daa6115a`. Los snapshots siguientes fijan el corte aunque otra sesión continúe.

- Backend: `hardening/taba-ecommerce-production`; snapshot `handoff/notebook-20261003-backend-final`.
- Frontend: `feat/taba-frontend-commercial-polish`; snapshot `handoff/notebook-20261003-frontend-pr131`.
- Documento y ledgers: `handoff/notebook-20261003-documentation`.
- Rider: nuevo repositorio **privado** `bitflowapp/la-taba-rider-android`; conserva las 32 ramas originales y un detached HEAD adicional. No se usó `rider-hub`, que contiene otro proyecto.

## Repositorio web/backend

Nombre: bitflowapp/la-taba-pages-preview
Remote: https://github.com/bitflowapp/la-taba-pages-preview.git
Ruta notebook: `C:\Users\marco\dev\la-taba-pages-preview`
Working tree original: main, sucio; sus cinco archivos útiles están en `handoff/notebook-20261003-pages-preview`.

| Frente | Branch | HEAD local | HEAD remoto | PR |
|---|---|---|---|---|
| Backend | hardening/taba-ecommerce-production | 6fd0b6f48bc105bd153ffe6f0d7a4af6daa6115a | 6fd0b6f48bc105bd153ffe6f0d7a4af6daa6115a | [#133](https://github.com/bitflowapp/la-taba-pages-preview/pull/133), draft, contra main |
| Frontend | feat/taba-frontend-commercial-polish | 737371ba82cae6e309cff04c97984443c52c8def | 737371ba82cae6e309cff04c97984443c52c8def | [#131](https://github.com/bitflowapp/la-taba-pages-preview/pull/131), draft, contra fix/taba-catalog-runtime-stability |

GitHub informa **46 commits en #131** y **152 en #133** al corte. No se asumieron los 12 commits históricos. Frontend tiene los tres checks relevantes en verde. Consultar `repos-inventory.json` para los checks del backend: los del último SHA pueden seguir en curso; el verde del SHA anterior no certifica automáticamente el nuevo. El handoff certifica recuperabilidad, no release.

Documentación vigente del backend ya está en el HEAD remoto: `LA_TABA_AUTONOMOUS_STATUS.md`, `LA_TABA_AUTONOMOUS_BACKEND_REPORT.md`, `docs/ecommerce-hardening/findings-register.json` y evidencias `artifacts/taba-autonomous-20261003/`. El informe distingue READY_FOR_STAGING de las compuertas CP/dinero real; esta tarea no ejecuta sus pasos de operación. Leer ese informe para las decisiones Owner 1–2 y el orden de PRs #130/#133.

Trabajo transferido: 14 snapshots de cambios locales, 108 ramas de archivo del depósito activo, 31 ramas de archivo del depósito relocalizado y recuperación del stash. Los commits de preservación usan índices temporales y `commit-tree`: **los worktrees originales permanecen sucios**, pero sus bytes útiles están commiteados y pusheados en las ramas indicadas. Los 238 archivos se compararon por blob y coinciden con el snapshot. No se integraron estos frentes antiguos sobre el hardening actual.

Trabajo pendiente: revisar funcionalmente los snapshots G antes de integrar. El test histórico de preview tiene una aserción de SHA fuente fijada a `317bbe9`; preservar ese test no significa que vaya a pasar tras un commit nuevo. Las migraciones del audit viejo incluyen cambios de whitespace y contratos de Rider; no se aplicaron. Configuración runtime con keys, metadatos `supabase/.temp`, scripts transitorios de login y evidencias raw quedan locales con motivos exactos.

## Repositorio Rider

Nombre: bitflowapp/la-taba-rider-android
Remote: https://github.com/bitflowapp/la-taba-rider-android.git
Ruta notebook: `D:\1212\la-taba-rider-android`
Branch original: `fix/rider-android-runtime-hardening`
HEAD local y remoto: `434c4d53e021579171398cfd10c3b6439730a22c`
PR: ninguno creado.
Working tree: limpio; los 27 worktrees inspeccionados estaban limpios.
Push: las 33 puntas se verificaron por `ls-remote` y en un clon independiente.

Este repo no tenía remote. Se creó privado para evitar perder trabajo ni mezclarlo con otros repos. La rama por defecto inicial de GitHub puede ser `chore/taba2-rider-release-hardening-rc2`; los comandos de recuperación seleccionan explícitamente la rama original. Todos los frentes de Rider están conservados; no se declaró que una rama histórica integre a las demás.

## Depósito antiguo relocalizado y stash

Git dir: `E:\taba-backups\la-taba-pages-20260725-enospc\relocated-runtime\git-dir`
Remote original: mismo repo web. HEAD: `edb10db5a0b92d18fad8e13ece61145a544b98a8`, branch `feat/taba-production-beverages`.
52 ramas y 40 registros antiguos de worktrees; algunos apuntan a rutas ausentes y otros a rutas hoy usadas por otro depósito. No se repararon ni borraron. Sus refs se importaron mediante Git y cada HEAD local tiene una referencia remota exacta. Las carpetas `relocated-original` y `verified-copy` sólo conservan directorios sin archivos útiles de La Taba.

Stash: `stash@0` @ `3393f686c86f8b6808da15a587dbad6c95e5cba3`, «codex-temp-before-pr32-merge», frente `feature/premium-mobile-business-inbox-ui`. Sus cinco blobs de código/tests **no aparecían en las ramas remotas ajenas al handoff**. Recuperación: `handoff/notebook-20261003-backup-stash-business-inbox` @ `0b700bce51d0952c6bc3c694fbc378525e02d587`. Se excluyeron seis archivos `.idea` de metadatos/cache del IDE; el stash original sigue intacto. No se hizo apply/pop/drop sobre ningún worktree. Los repos activos web y Rider no tenían stash.

## Commits nuevos de preservación

| Branch | SHA remoto verificado | Archivos | Tipo |
|---|---|---:|---|
| handoff/notebook-20261003-commerce-v3-c-capturas | 3b78ad3a0517fceaab9cddb9e5dfa5f48ba9cd8a | 5 | uncommitted snapshot |
| handoff/notebook-20261003-promos-packshots | 6fd46ae0b8c04b0ded5c21a7df3f38c8a6e817a8 | 51 | uncommitted snapshot |
| handoff/notebook-20261003-real-orders-staging | 4037ac67087779c565e161993eff007581dfbada | 9 | uncommitted snapshot |
| handoff/notebook-20261003-real-pilot-staging | a386b2790e04d24ce10f26b9bcb3011fa282be48 | 49 | uncommitted snapshot |
| handoff/notebook-20261003-redesign-rojo | 67972cf9aa05c8c19b247b251c84348dc18af1b1 | 11 | uncommitted snapshot |
| handoff/notebook-20261003-ui-polish-brand | 9446beaee9a560d8034bb1b7b925360142a62dfe | 22 | uncommitted snapshot |
| handoff/notebook-20261003-business-panel-automation | fc406588d2b1455e3e9b272d194dbae0335d5c0f | 3 | uncommitted snapshot |
| handoff/notebook-20261003-pages-preview | 9c6232efb8e69120c7e2180276b250b6032286c6 | 5 | uncommitted snapshot |
| handoff/notebook-20261003-taba2-production-candidate | 375633b39ece4879d43f5f499c79b0ae50654814 | 8 | uncommitted snapshot |
| handoff/notebook-20261003-commerce-v3 | ba8c393da8886404de953909c89cdd9b96dbdb87 | 7 | uncommitted snapshot |
| handoff/notebook-20261003-migration-fetch-audit | fd77257f88ca2f7f13546734d302790b7cf116bd | 25 | uncommitted snapshot |
| handoff/notebook-20261003-taba2-commerce-growth | fc3be5c6c2e90fc5dfa5d2aac6c997a509c43004 | 26 | uncommitted snapshot |
| handoff/notebook-20261003-taba2-weekend-launch | 7343f968cd23c153590daadf34d800e252e832db | 14 | uncommitted snapshot |
| handoff/notebook-20261003-taba2-production-auth-go-live | 51b8e2e776f553a32c6a4677b522f0b4611f86ff | 3 | uncommitted snapshot |
| handoff/notebook-20261003-backup-stash-business-inbox | 0b700bce51d0952c6bc3c694fbc378525e02d587 | 5 | stash snapshot |
| handoff/notebook-20261003-external-backend-qa | e988d85e89de878f48af3d33de5ac85b5d0dc7fa | 238 | external historical evidence |
| handoff/notebook-20261003-external-qa-evidence | d72bdd5df97c16fdfac13eb8102ac51ab97d3c42 | 233 | external historical evidence |
| handoff/notebook-20261003-external-business-fiscal | 161dab838beab7500d16e5ddf19038782c6c914c | 64 | external historical evidence |
| handoff/notebook-20261003-external-catalog-frontend | a9901c6a5b925744cbb72bcf481fd005b5170d95 | 198 | external historical evidence |
| handoff/notebook-20261003-external-rider | 86be5f9513e948ade9311129998b6a5031cac490 | 204 | external historical evidence |
| handoff/notebook-20261003-external-commercial-media | d9b632f1a1568f0d1c1bdab92c68168e52631137 | 77 | external historical evidence |
| handoff/notebook-20261003-archive-sources | ef9b6c233f4fd60e6ce744f06d0f290027046bdd | 68 | source snapshots from ZIPs |

Las listas completas de ramas originales y sus referencias recuperables están en `local-branches.csv`. Las ramas de archivo son snapshots de HEADs existentes; crear esas refs no introduce cambios de producto.

## Worktrees activos

Estado = al inventario, retenido sin alterar el checkout. Integrado = ancestro de origin/main, no equivalencia por squash. Ninguno se descarta durante este handoff.

| Ruta | Branch / HEAD | Estado | Integrado origin/main | Recuperación de cambios sin commit |
|---|---|---|---|---|
| `C:/1212/la-taba-arca-homologation-readiness` | `feature/taba2-arca-homologation-readiness` / `13936d5eedd36a211fa2ab4d255f30ad8fc0dbed` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-business-fiscal-closure` | `feature/business-fiscal-document-closure` / `89bda02b73b651cc42f8c9fa3a008903501f89e9` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-business-intake-hardening` | `fix/business-order-intake-reliability` / `c6d6a7b56df46fb6989b7e6584a165ff915de6c1` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-business-operations-final` | `feature/taba2-business-operations-final` / `8028dcc26ab271a0d7bb9acb81784d3e41ddae7f` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-business-windows-scanner-fiscal` | `feature/business-windows-scanner-fiscal` / `ba0bdceb3c4d8d73997dfe67381ccd92ae8808b5` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-catalog-checkout-premium` | `feature/catalog-checkout-premium` / `41e27133849321cb65b61e14376d57c295cf5c2e` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-catalog-expansion` | `feature/catalog-expansion-argentina` / `67aa86d53be6d774fd88bc1939e4a14ea5837207` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-commerce-v3` | `(detached)` / `a4d54dea45c8822a2c50956fad86ac90c1610292` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-commerce-v3-c-capturas` |
| `C:/1212/la-taba-e2e-ci-fix` | `fix/e2e-ci-determinism` / `c4fe906128c75d2ebb20a895290113d8405aafe0` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-final-ux-integration` | `integration/taba-final-ux` / `ed722463a44498a9bd5d1e7b4ebdac145b89d5b5` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-final-ux-recovered` | `recovery/taba-final-ux-63a7cf3` / `425c4aedd9b5d3b418e7949cf1f511c8077368b4` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-mercadopago-oauth` | `integration/taba-v5-ci-gate-fix` / `a4d54dea45c8822a2c50956fad86ac90c1610292` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-mostador-patagonico` | `feature/mostrador-patagonico-v1` / `2e5f02b5d201f9addbe6d1d1a8f8b5aa900bbde0` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-platform-rc-clean-integration` | `integration/taba-platform-rc-clean` / `c6d6a7b56df46fb6989b7e6584a165ff915de6c1` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-premium-catalog-launch` | `feature/taba-premium-catalog-launch` / `eb1f33d7e2579365a0bdab488fe9fe273f9a7341` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-production-rc1` | `release/taba2-production-rc1` / `4ca22af6d425c422fdca2be8e11798a2de170033` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-promos-packshots` | `feature/catalog-packshots-promos` / `64615dbd594279945257078f315ec911dbade5d6` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-promos-packshots` |
| `C:/1212/la-taba-real-orders-staging` | `staging/real-orders-walter` / `c6270589756214eac617515248e93a8e8819190b` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-real-orders-staging` |
| `C:/1212/la-taba-real-pilot-staging` | `release/taba-real-pilot-staging` / `9a99698ddbe7ef5de10c779699ca58e74f3b379a` | sucio; ya preservado o excluido por clasificación | no / Rider independiente | `handoff/notebook-20261003-real-pilot-staging` |
| `C:/1212/la-taba-redesign-rojo` | `feature/la-taba-redesign-rojo` / `c6270589756214eac617515248e93a8e8819190b` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-redesign-rojo` |
| `C:/1212/la-taba-rider-server-contracts` | `feature/rider-delivery-server-contracts` / `4960da279f0f668559ab55b6a751576b18232b95` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-rider-staging-certification-backend` | `fix/rider-staging-certification` / `d0b995eaa642a8c78a28a0a9d966a3bdd89b6e7b` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-staging-pilot` | `release/taba-staging-pilot` / `ed722463a44498a9bd5d1e7b4ebdac145b89d5b5` | sucio; ya preservado o excluido por clasificación | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-tracking-premium-visual` | `feature/tracking-onthe-way-premium-visual` / `1c85881db65266f9e62bba68517e5bddff869439` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-ui-polish-brand` | `fix/la-taba-ui-polish-brand` / `c6270589756214eac617515248e93a8e8819190b` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-ui-polish-brand` |
| `C:/1212/la-taba2-argentina-ecommerce` | `feature/taba2-argentina-ecommerce` / `e0d74a2469b5eb80c30f33679cd1251d62a29cd9` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba2-beverage-assets-v2` | `feature/taba2-beverage-assets-v2` / `e0d74a2469b5eb80c30f33679cd1251d62a29cd9` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba2-beverage-catalog-home` | `feature/taba2-beverage-catalog-home` / `3e1f90d3a60a4dcb6b3d7eda943a54e4b061a614` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba2-catalog-finalization` | `feature/taba2-p0-catalog-finalization` / `edbe15e908c18ed04a962504ec626e32a16fe79c` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba2-commercial-catalog-authority` | `feature/taba2-commercial-catalog-authority` / `6d3d1e7a40dd7ba07be0c5945dbd1f81b7e94ada` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba2-mercadopago-checkout` | `feature/taba2-mercadopago-checkout` / `051413a24839c9c916a457bce77cf65898041f27` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba2-mobile-brand-refresh` | `feature/taba2-mobile-brand-refresh` / `0e2e32866f468a8f00e60acd08fde3258b3d412c` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba2-mobile-design-integration` | `integration/taba2-mobile-design-review` / `08bb17a0a17d7b86847b9a782f35b23037073094` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba2-mobile-layout-hardening` | `fix/taba2-mobile-layout-hardening` / `fd87c1ac164244d19ea7a5344e0afff05db80db2` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba2-storefront-motion` | `feature/taba2-storefront-motion` / `cb3751bf8f35b1878c316e3b3ef89f88b3d99903` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `C:/Users/marco/dev/la-taba-business-panel-automation` | `feature/taba-business-panel-automation` / `523d3d00bc303c9333f4c2f77aefb2b3b0e24f89` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-business-panel-automation` |
| `C:/Users/marco/dev/la-taba-pages-preview` | `main` / `31c900b7e4d66a89e80c535e59ed30fdad03ea3a` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-pages-preview` |
| `C:/Users/marco/worktrees/taba2-production-candidate` | `release/taba2-production-candidate` / `317bbe9dc1c987c31ea4e0915784f881f61f24b6` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-taba2-production-candidate` |
| `D:/1212/la-taba-business-fiscal-homologation-gate-fix` | `fix/taba2-fiscal-homologation-gate` / `d1aa4a63da1f9fda01be39e64314afcfa77098ac` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-business-packing-fixture-fix` | `fix/taba2-packing-capacity-unit-fixture` / `0a062fb0c1f77f6e6c27982edd84ee28000bc912` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-business-synthetic-certification` | `test/taba2-business-synthetic-certification` / `5e0c39065b316cd4adb2c2180be2a2ee2af90516` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-business-synthetic-recertification` | `test/taba2-business-synthetic-recertification-8028dcc` / `73a37b09e0a3d21fce61f5c97cc167ef022fdcb0` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-business-synthetic-recertification-final` | `test/taba2-business-synthetic-recertification-final` / `e59e28db78bfadc976d2f4b92cba5f8e0df06eb2` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-commerce-v3` | `release/taba-production-rc` / `01035c98e0e7651452dc2cce71fd5d547b514b63` | sucio; ya preservado o excluido por clasificación | no / Rider independiente | `handoff/notebook-20261003-commerce-v3` |
| `D:/1212/la-taba-e2e-test-staging-certification` | `test/taba2-e2e-test-staging-certification` / `4caa1f1cda3d6d21da704570a073970e82ad0ae7` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-e2e-test-staging-rc` | `release/taba2-e2e-test-staging-rc` / `6294a989f67aada984f66cc2312142db63a563a0` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-migration-fetch-audit` | `(detached)` / `7df4643c2e0bbcccb2eff435217fb43a5663c1a6` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-migration-fetch-audit` |
| `D:/1212/la-taba-production-rc1-business-certification` | `test/taba2-rc1-business-panel-certification` / `06b330169f6b2e1f43206b1b1cc85d767e50e01f` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-production-rc1-business-integration` | `integration/taba2-rc1-business-panel` / `b6d27daf89f04132bf348981869524c21802fe93` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-arca-fiscal-automation` | `feature/taba2-arca-fiscal-automation` / `af93aeb6c7538655cdc9ab38daebbfea027bfe3f` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-business-panel-hardening` | `feature/taba2-business-panel-hardening` / `c7c3bbd5348bbd9891661784b600c3d20204b285` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-ci-release-stability` | `feature/taba2-ci-release-stability` / `7e31794196c6df7de07be2c4116af5baa5f20e85` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-commerce-growth` | `feature/taba2-commerce-growth-engine` / `0192c68d22db8368d48aec3f68cbacecfaf88b98` | sucio; ya preservado o excluido por clasificación | no / Rider independiente | `handoff/notebook-20261003-taba2-commerce-growth` |
| `D:/1212/la-taba2-commercial-activation` | `feature/taba2-commercial-activation` / `f39b6e25e399c55ce3ed3e5a07b7fb9205af7e6b` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-commercial-p1-closure` | `feature/taba2-commercial-p1-closure` / `b66add06231ff9df5be25144a854a9c1858f01c4` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-commercial-shelf-stage1` | `feature/taba2-commercial-shelf-stage1` / `9cc051af1712e248117ad50fd19d11e06c040837` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-commercial-skills-pack` | `feature/taba2-commercial-skills-pack` / `c03b16647612e03830fce97b7e86425367c3e079` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-commercial-storefront` | `feature/taba2-commercial-storefront` / `6dd05655a491897037af84a77808e7680bb50401` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-commercial-stories` | `feature/taba2-commercial-stories` / `27155217f0c1f68fb474ab7230bff90de22cbbd9` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-fable-visual-polish` | `feature/taba2-fable-visual-polish` / `c761a8d43a9e4abcd17c7687e3e8a25ad545db93` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-final-launch-ux-perf` | `feature/taba2-final-launch-ux-perf` / `2ef12280118a09f7efe305a1951c85f5b328eb58` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-first-physical-e2e` | `test/taba2-first-human-physical-order` / `66ba221e90436015c7f038ee3ecacc13654ff448` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-gondola-neuquen` | `feature/taba2-gondola-comercial-neuquen` / `786e6a6963f764a1264a925f0099c0cecc196d79` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-gondola-retail-final` | `feature/taba2-gondola-retail-final` / `0fd9fda2beb077318f4963a99e0d66fa330e7f4e` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-launch-ux-polish` | `feature/taba2-launch-ux-polish` / `3888b611b5a6a66bdb66d3d0a464bb1767eaa3c4` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-mercadopago-production-ready` | `feature/taba2-mercadopago-production-ready` / `4f2bd366d9e8514827dde9d61793fd5a19fc7f3b` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-mercadopago-staging-rc1` | `release/taba2-mercadopago-staging-rc1` / `0587712be87bc32ebae6be75220eeb863780387c` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-payment-recovery-p0` | `fix/taba2-p0-payment-recovery-ux` / `3e48bb0bcd777276d23c542c60fec94ed8b0ed84` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-pilot-integration` | `release/taba2-pilot-integration` / `a8b93cfa449256595a240c3b33f181941ce6b5eb` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-pilot-ops` | `feature/taba2-pilot-ops` / `03c2fbdf4b3ba70dbd116788bb3e8612d0fc491d` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-pilot-rc` | `release/taba2-pilot-rc` / `55093e030f3a5c3bc7957a7c38588fcde730dc30` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-real-orders-ops` | `feature/taba2-real-orders-ops` / `aed0293c32d5cbf5a4599e5eb4f46033192bb84e` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-retail-catalog-normalization` | `feature/taba2-panel-retail-publication-flow` / `95ac129f12fb85d0ede7f0c40757df4d2406a8a9` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-retail-unit-publication` | `feature/taba2-retail-unit-publication` / `1c7455029f5390b127844d4afd708705e8083566` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-rider-multi-order-backend` | `feature/taba2-rider-multi-order-backend` / `f4d5bc82a3e99eab2ed81f8de7ed8c8b95cf61eb` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-tracking-visual-polish` | `feature/taba2-tracking-visual-polish` / `4ea98c6d040633f7f5cb24dfdb4839706cb3a76f` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-unit-catalog-normalization` | `feature/taba2-unit-catalog-normalization` / `b8ac9a3a5aaca5ba883c2d68dfc2efa62d7f3c6f` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-weekend-launch` | `despliegue/main-e5f390e` / `e5f390e27dd2479cec71c24a9675ccbd71d53a4f` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-taba2-weekend-launch` |
| `D:/1212/la-taba2-whatsapp-commerce` | `feature/taba2-whatsapp-commerce` / `c1e7cb66d216086d4951b79390068e09d6a7c8d2` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-automated-rider-dispatch` | `feature/taba2-automated-rider-dispatch` / `226bca2fea3bcd4f593c29fdef472c9be7e0c1c7` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-business-commercial-mobile` | `feature/taba2-business-commercial-mobile` / `88d7ccf65c2fc902b302ab721b80193837b47b7e` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-business-operations-delivery` | `integration/taba2-schema-canonical` / `edad48a24d4c4d2b76880e6f1ceb40072eae3318` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-catalog-image-pipeline` | `feature/taba2-catalog-image-pipeline` / `d87fb6ed1237eb9f84ec688de38456a038d2d89f` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-catalog-premium` | `feature/taba2-catalog-premium-purchase` / `280213ded33d66d5259faf5534c7885e74203410` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-commercial-candidate` | `release/taba2-commercial-candidate` / `da56ce9fcbae77bff6f2334b596149b67c2c3e11` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-commercial-hardening` | `release/taba2-commercial-hardening` / `e160fb15dcff3e77706316a3d4b9284794725f3f` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-commercial-production-hardening` | `feature/taba2-commercial-production-hardening` / `0a5f6d0d64b27b9e5ba6cb48d262c2bf48c159ed` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-customer-experience` | `integration/taba2-customer-experience` / `11cd59d8e9fe28a16ad99b9cc7435bd1758924bc` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-customer-overnight-rc` | `feature/taba2-catalog-visual-polish` / `eed44a62b6813ff4bec1c800ea63fa41fb74a3f8` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-customer-postdemo` | `fix/taba2-customer-postdemo-hardening` / `9ef9aee0fa318636ae5a8487589981a66e199ae7` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-digital-commerce` | `feature/taba2-digital-commerce-100` / `e59ac1c5eefc49fe6835aa2d05a43896c0ded1f9` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-identity-session-biometrics` | `feature/taba2-identity-session-biometrics` / `a0bbac99d242a9c7ec9bd58fa36933381572f380` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-live-schema-reconciliation` | `release/taba2-commercial-rc` / `bc9af92e1f11ce790fb2d620c24acf844053125d` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-live-tracking-ux` | `feature/taba2-live-tracking-production-ux` / `73fdb4c5dd9fcc15a7c86cfb19350c25e808fd1f` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-location-truth-web` | `fix/taba2-location-truth` / `9621d8313524ca30b0348315f739c8c37a7f6a6c` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-map-marker-semantics` | `fix/taba2-map-marker-semantics` / `24e38f4d6579741e5465328a569c660dde112e62` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-operational-frontend` | `integration/taba2-operational-frontend` / `f16c6d92d968f286b69c6562c75fe98958937bcb` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-operational-resilience` | `fix/taba2-operational-resilience` / `eda13f833bfc54f52a838ac1f76459b7ae276a5b` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-order-intake-dispatch` | `fix/taba2-order-intake-dispatch` / `59d8e036df10650070afbaec9cfc20705dd5b742` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-order-recovery-panel` | `deploy/taba2-order-recovery-panel` / `0efe1dc3efb8a9fb0d9036d5f25b5e4b6ae671bb` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-pilot-rc1` | `release/taba2-pilot-rc1` / `f4588f9e2e5993dfb2c7a260bf0e525223d45ba4` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-pilot-rc2-web` | `release/taba2-pilot-rc2` / `f611492a5814bf9aeea2469491e6272b9b99663d` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-production-auth-go-live` | `feature/taba2-production-auth-go-live` / `34c6ee3601eaf83af819b56ee9aab0a5cd419c80` | sucio; ya preservado o excluido por clasificación | sí | `handoff/notebook-20261003-taba2-production-auth-go-live` |
| `D:/1212/worktrees/taba2-production-backend-remediation` | `feature/taba2-production-backend-remediation` / `38372091036b3d4f0b3119e2701bd17724d83c32` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-production-blockers` | `fix/taba2-production-blockers` / `cc9e88f1137ca0f65c44234f7270f63774f45c20` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-production-launch-plan` | `docs/taba2-production-launch-plan` / `5470ac66e4f155d140361294084fa61deb012174` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-production-rc2` | `release/taba2-production-external-enablement` / `ed0eebed82b73c451c4b55bcfde756c7647c7a85` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-production-supabase-provisioning` | `ops/taba2-production-supabase-provisioning` / `d9e279c7ed5a0058da9460f632378a306a0d3102` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-pwa-gondola-integration` | `feature/taba2-pwa-production-integration` / `190b344d11790c8ae606024d7919b07df2799726` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-pwa-install` | `feature/taba2-pwa-installable` / `105f85abf6b2baec24d6b7942a8e17f15416e8af` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-shelf-glow-final-polish` | `feature/taba2-shelf-glow-final-polish` / `5758b46c822b9f68bbdda31eaf895494dcb456ae` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-storefront-pilot` | `feature/taba2-storefront-commercial-pilot` / `90a28a119e5cd97a66e3b3b56a35ad58ab508b1b` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-tracking-always-map` | `feature/taba2-tracking-always-on-map` / `36b6f3df1595a7e51dc885a569fec3326e2ab0af` | limpio | sí | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-rider-android` | `fix/rider-android-runtime-hardening` / `434c4d53e021579171398cfd10c3b6439730a22c` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `C:/1212/la-taba-rider-map-contracts` | `feature/rider-map-location-contracts` / `898cea6d444e63adeed61f8079cead750036da0c` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-rider-live-contracts` | `feature/rider-live-contract-integration` / `f1f3f37c5e2793c40f672fbc9b099eee6a746dba` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-rider-pilot-readiness` | `feature/rider-pilot-readiness-ux` / `471f79ef9a9f47ebb9018f5962b0d6538319ccde` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-rider-production-rc1` | `release/taba2-rider-production-rc1` / `5231a87fc8df9d0b37b263938304935b9213a2d4` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba-rider-smoke-automation` | `test/taba2-rider-staging-smoke-automation` / `8e2b671c4123b8916fe628739b5c1d4490c6ae0b` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/la-taba2-rider-first-physical-e2e` | `test/taba2-rider-first-human-physical-order` / `a843b4aaae7b38524e9f2e572ec1965a8e1cd096` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-location-truth-rider` | `fix/taba2-rider-location-truth` / `4ad0b551d0ae94563d14928b4e90daa3d1f0acd9` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-auto-dispatch` | `feature/taba2-rider-shifts-dispatch` / `ae90ab6cefeb319c7e033fe8e4938fb5fa03f92d` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-commercial-p1-fix` | `fix/taba2-rider-commercial-review-p1` / `9b498db2a75e5ff4a4bb93e0d502d0b5f2848109` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-commercial-polish` | `feature/taba2-rider-commercial-polish` / `1b234a7fdd82f969ac52c26708d3c8f1056b9adf` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-commercial-redesign` | `feature/taba2-rider-commercial-redesign` / `d1ce78e814b59ee7df1befdcc8e2a31c23912c3a` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-commercial-ux` | `feature/taba2-rider-commercial-ux` / `8e9cd4f0efb65d2847df668e4851d2060ec23bf9` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-identity-biometrics` | `feature/taba2-rider-identity-biometrics` / `acc253a4bdd5cba1090be24d77f617af33f8de19` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-map` | `codex/rider-map-staging` / `95294d9d36a6429a21a562ea6a48b8c9ecbf8523` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-map-cert-baseline` | `(detached)` / `df44dafb674910007f7a41fa2a987b4a9abbfb2a` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-map-hardening` | `feature/taba2-rider-map-hardening` / `5231a87fc8df9d0b37b263938304935b9213a2d4` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-map-visual-polish` | `codex/taba2-rider-map-visual-polish` / `471f79ef9a9f47ebb9018f5962b0d6538319ccde` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-multi-order` | `feature/taba2-rider-multi-order` / `76dbb40c258fc705329de2cfca38a188a9c1529b` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-multi-order-board-fix` | `feature/taba2-rider-multi-order-board-fix` / `5231a87fc8df9d0b37b263938304935b9213a2d4` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-pilot-integration` | `feature/taba2-rider-pilot-integration` / `894267af0a274fab95d3a7237c3895ab0ac20a4c` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-pilot-rc2` | `release/taba2-rider-pilot-rc2` / `ff6d01480b36cfb02fd7e3fb6aabdbdfa6ccf4df` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-production-auth` | `feature/taba2-rider-production-auth` / `1a04870e3583cb5a6acdabf4129c6f4f9c9c3f40` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-production-rc2` | `fix/taba2-rider-second-delivery-start` / `94c6464b6b10a14db3aaf1f773c22377ae38c5ed` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-rc2-integration` | `release/taba2-rider-rc2-integration` / `3875c3c532b8b9baa3a4e90d45268de2b90acb70` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-release-hardening-rc2` | `chore/taba2-rider-release-hardening-rc2` / `e9517a93a015474bdb9a73854ac79094cf53f76e` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |
| `D:/1212/worktrees/taba2-rider-sheet-ux-polish` | `feature/taba2-rider-map-polish-v2` / `6cb55aaf12c031ec48b4bd1dc940cdf2426e7b6a` | limpio | no / Rider independiente | `sin código útil pendiente; ver clasificación` |

Hay 140 worktrees activos (113 web y 27 Rider), 15 con cambios locales al inventario. `worktrees-inventory.json` contiene el status completo, ignored, HEAD, relación con main y rama recuperable de cada uno. Los 40 registros del backup se detallan en `backup-worktrees-inventory.json`; **NO borrar** ninguno hasta comprobar el handoff en la PC.

## Evidencias y artefactos locales

Se conservaron 1014 archivos externos útiles: 668 informes Markdown y el resto código/QA histórico, con 17 versiones redactadas. Además se recuperaron 68 fuentes únicas de ZIPs. Sus rutas originales, ruta Git, branch y blob están en `recovered-evidence-index.csv`; son archivos históricos para inspeccionar y **no ejecutar automáticamente**. No se copiaron carpetas: el contenido se incorporó a árboles Git con procedencia individual.

`local-only-artifacts.csv` es la lista exacta de 14111 archivos retenidos con ruta, tamaño en bytes, descripción y razón. Incluye capturas/videos, logs, trace ZIPs, paquetes de QA, configuraciones y originales sensibles de documentos redactados. Los artefactos grandes o raw no se publicaron. No se borró ninguno.

Dos ZIPs parciales de Playwright en `D:\1212\taba2-p0-runtime-certification\chromium\.playwright-artifacts-3` tienen el directorio central truncado; 7-Zip identifica recursos de traces, no un paquete fuente independiente. No se repararon ni descartaron. Los demás ZIPs fuente examinados conservaron sus entradas únicas útiles; se excluyó código de Ojo Claro ajeno a La Taba.

## Configuración a recrear en la PC principal

- Acceso GitHub a bitflowapp y al repo privado de Rider; autenticarse en Git/gh sin guardar tokens en el repo.
- Node y dependencias **según el package-lock/package.json de la rama recuperada**. Docker para los gates canónicos aislados de base/stack, cuando se decida verificarlos. No ejecutar despliegues ni migraciones hospedadas para recuperar Git.
- Para Rider: Flutter/Dart y Android SDK/JDK compatibles con el repo; rutas de SDK en `android/local.properties`, wrappers y caches regenerables. Claves de firma mediante almacenamiento seguro existente; no recrear o publicar una identidad de firma sin decidirlo.
- Variables/configuración de Supabase, Mercado Pago, Cloudflare y ARCA que necesite el frente elegido, mediante el mecanismo seguro ya usado. Runtime público y keys se materializan fuera del commit; `.env`, tokens de Management API, service_role, OAuth/webhook secrets, claves de firma y CI secrets no se transfieren por Git.
- Almacén local excluido: `C:\Users\marco\.taba-secrets`; sesiones browser/E2E y `supabase/.temp` se recrean. Este documento y los ledgers no contienen sus valores.

Gitleaks 8.30.1 revisó commits locales, cambios útiles, evidencias y fuentes de archivos comprimidos. Las alertas de historia web/Rider eran fixtures de tests; las credenciales reales/configuración de evidencia externa se excluyeron o redactaron. El escaneo final del material publicado quedó sin hallazgos. No se rotaron ni modificaron secretos en servicios.

## Comandos para la PC principal

### Repositorio nuevo

Ejecutar en el directorio donde se guardan repositorios; las carpetas las crea Git.

```powershell
gh auth status
git clone --branch hardening/taba-ecommerce-production https://github.com/bitflowapp/la-taba-pages-preview.git la-taba-pages-preview
Set-Location la-taba-pages-preview
git status --short --branch
git branch -vv
git rev-parse HEAD
# SHA al corte: 6fd0b6f48bc105bd153ffe6f0d7a4af6daa6115a
# Frontend separado, desde la misma fuente de verdad:
git worktree add -b handoff/main-pc-20261003-frontend ..\la-taba-frontend-main-pc origin/feat/taba-frontend-commercial-polish
git -C ..\la-taba-frontend-main-pc rev-parse HEAD
# Esperado: 737371ba82cae6e309cff04c97984443c52c8def
# Leer el handoff directamente desde Git:
git show origin/handoff/notebook-20261003-documentation:LA_TABA_NOTEBOOK_TO_MAIN_PC_HANDOFF.md
```

Desde el directorio padre, Rider:

```powershell
git clone --branch fix/rider-android-runtime-hardening https://github.com/bitflowapp/la-taba-rider-android.git la-taba-rider-android
git -C la-taba-rider-android status --short --branch
git -C la-taba-rider-android branch -vv
git -C la-taba-rider-android rev-parse HEAD
# Esperado: 434c4d53e021579171398cfd10c3b6439730a22c
```

### Repositorio existente: inspeccionar y preservar antes de fetch/switch

Ejecutar dentro del repo correcto. El stash siguiente es local y no se borra. Si preferís un commit propio, revisar secretos y seleccionar archivos explícitos antes de commitear. No pushear credenciales.

```powershell
git remote -v
git status --short --branch
git branch -vv
git worktree list
git diff
git diff --cached
git ls-files --others --exclude-standard
# Si hay cambios propios: preservarlos localmente antes de continuar.
# Ejecutar sólo si hay cambios; no incluir archivos ignored ni publicar el stash:
git stash push --include-untracked -m "main-pc-before-notebook-handoff-20261003"
git stash list
git fetch --all --prune
git status --short --branch
git branch -vv
# Si ya existe una rama local backend:
git rev-list --left-right --count hardening/taba-ecommerce-production...origin/hardening/taba-ecommerce-production
git log --oneline --left-right hardening/taba-ecommerce-production...origin/hardening/taba-ecommerce-production
```

En la comparación `local...origin`, la primera cifra cuenta commits exclusivos locales. **Si es 0**, y el árbol está limpio:

```powershell
# Si la rama existe localmente:
git switch hardening/taba-ecommerce-production
git merge --ff-only origin/hardening/taba-ecommerce-production
# Si NO existe localmente, usar en su lugar:
# git switch --track -c hardening/taba-ecommerce-production origin/hardening/taba-ecommerce-production
git rev-parse HEAD
git rev-parse origin/hardening/taba-ecommerce-production
git ls-remote --heads origin hardening/taba-ecommerce-production
# Las tres verificaciones deben coincidir.
```

Si hay commits propios, divergencia, otra rama checkoutada en un worktree, o `--ff-only` falla, conservar la rama local y usar un worktree nuevo desde el snapshot:

```powershell
git worktree add -b handoff/main-pc-20261003-backend ..\la-taba-backend-recuperado origin/handoff/notebook-20261003-backend-final
git -C ..\la-taba-backend-recuperado status --short --branch
git -C ..\la-taba-backend-recuperado rev-parse HEAD
# Esperado: 6fd0b6f48bc105bd153ffe6f0d7a4af6daa6115a
```

Para frontend, inspeccionar primero si su rama local existe; comparar con `origin/feat/taba-frontend-commercial-polish`. Usar `switch` + `merge --ff-only` únicamente con cero commits locales exclusivos, o el worktree aislado ya indicado. Antes de aplicar un stash propio, revisar `git stash show --stat` y usar `git stash apply` en una rama propia de revisión; **no pop/drop**. Resolver conflictos por archivo, mantener ambos trabajos y correr pruebas del frente antes de integrar. Nunca reset, clean, rebase destructivo o force push.

### Trabajo paralelo, evidencias y snapshots históricos

```powershell
git for-each-ref --format="%(refname:short) %(objectname)" refs/remotes/origin/handoff
git show origin/handoff/notebook-20261003-documentation:docs/handoff/notebook-20261003/local-branches.csv
git show origin/handoff/notebook-20261003-documentation:docs/handoff/notebook-20261003/recovered-evidence-index.csv
# Recuperar el stash histórico de negocio en una rama aislada:
git worktree add -b handoff/main-pc-20261003-business-inbox ..\la-taba-business-inbox-recuperado origin/handoff/notebook-20261003-backup-stash-business-inbox
git -C ..\la-taba-business-inbox-recuperado rev-parse HEAD
# Esperado: 0b700bce51d0952c6bc3c694fbc378525e02d587
```

Para cualquier otra fila de `local-branches.csv`, usar su `remote_recovery_branch` con `git worktree add -b <rama-local-nueva> <ruta-nueva> origin/<remote_recovery_branch>` y verificar el SHA de la fila. Para un archivo externo, el índice da `branch` y `git_path`; `git show origin/<branch>:<git_path>` recupera sus bytes desde GitHub. Las versiones `.redacted.txt` son archivos de evidencia: requieren recrear configuración y revisión antes de ejecutarse. No mergear en bloque ramas históricas.

Si la rama backend de origin ya avanzó al retomar, el SHA del snapshot sigue siendo el corte verificable. Comparar su avance con `git log --oneline origin/handoff/notebook-20261003-backend-final..origin/hardening/taba-ecommerce-production` antes de elegir seguir el último HEAD.

## Verificación final

- Todos los HEAD de las ramas locales de los depósitos activo, Rider y backup están alcanzables desde origin; conteo de commits de branches ausentes de origin: **0 en cada depósito**.
- Backend y frontend tienen SHA local/remoto/snapshot idénticos y sus PR apuntan al HEAD esperado al corte.
- Los 238 archivos de cambios locales útiles coinciden por blob con sus snapshots. El stash único se conserva en origen sin eliminación local.
- Se verificaron ramas recuperables en clones nuevos creados exclusivamente mediante GitHub. La documentación y los archivos externos nuevos se verifican de la misma forma tras su push final.
- Los informes autónomos actuales ya se recuperan con el hardening. Los informes externos antiguos tienen procedencia y se mantienen separados de la línea de producto.
- Artefactos raw/grandes, temporales y configuración sensible quedan intactos en notebook con listado exacto. No existe código importante único de La Taba pendiente de persistencia remota; las caches/dependencias se regeneran.
- No hay autorización de release por este handoff. Mantener las compuertas y decisiones de operación de la rama actual.
