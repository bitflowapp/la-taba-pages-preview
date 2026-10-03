# TABA2 production-readiness release manifest

Estado: release candidate local integrado, no certificado para producción ni para piloto.

Fecha de cierre: 2026-08-03 (America/Buenos_Aires).

Este manifiesto registra evidencia local. No autoriza despliegues, pagos reales,
emisión fiscal, firma improvisada ni uso productivo. No se hizo push y no se
consultó ni modificó producción.

## 1. Repositorios

| Repositorio | Git common dir | Alcance | Separación |
| --- | --- | --- | --- |
| Web/backend/Windows | C:\Users\marco\dev\la-taba-pages-preview\.git | Storefront, Supabase, panel, Tauri/Windows, fiscal, Mercado Pago y contratos backend Rider | RC integrado en C:\1212\la-taba-production-rc1 |
| Rider Android | D:\1212\la-taba-rider-android\.git | Flutter/Android Rider | RC separado en D:\1212\la-taba-rider-production-rc1 |

C:\1212\la-taba-rider-android es una junction al repositorio de D:. Los
directorios sin metadata Git no se contabilizaron como repositorios.

## 2. Inventario Git final

Se ejecutó git worktree list --porcelain y, en cada worktree registrado,
git branch --show-current, git rev-parse HEAD, git status --porcelain,
git diff --check y git log -1 --oneline. DiffCheck=0 en todos. Los árboles
dirty preexistentes o de diagnóstico se preservaron sin reset, clean, stash,
amend, push ni checkout forzado.

### Web/backend/Windows

| Worktree | Rama | HEAD | Git |
| --- | --- | --- | --- |
| C:\Users\marco\dev\la-taba-pages-preview | main | 9cd8f8940671b1d8314a6f25abb6ccb4b8247cc4 | dirty(35), DiffCheck=0 |
| C:\1212\la-taba-business-fiscal-closure | feature/business-fiscal-document-closure | 89bda02b73b651cc42f8c9fa3a008903501f89e9 | clean |
| C:\1212\la-taba-business-intake-hardening | fix/business-order-intake-reliability | c6d6a7b56df46fb6989b7e6584a165ff915de6c1 | clean |
| C:\1212\la-taba-business-windows-scanner-fiscal | feature/business-windows-scanner-fiscal | ba0bdceb3c4d8d73997dfe67381ccd92ae8808b5 | clean |
| C:\1212\la-taba-catalog-checkout-premium | feature/catalog-checkout-premium | 41e27133849321cb65b61e14376d57c295cf5c2e | clean |
| C:\1212\la-taba-catalog-expansion | feature/catalog-expansion-argentina | 67aa86d53be6d774fd88bc1939e4a14ea5837207 | clean |
| C:\1212\la-taba-e2e-ci-fix | fix/e2e-ci-determinism | c4fe906128c75d2ebb20a895290113d8405aafe0 | clean |
| C:\1212\la-taba-final-ux-integration | integration/taba-final-ux | ed722463a44498a9bd5d1e7b4ebdac145b89d5b5 | clean |
| C:\1212\la-taba-final-ux-recovered | recovery/taba-final-ux-63a7cf3 | 425c4aedd9b5d3b418e7949cf1f511c8077368b4 | clean |
| C:\1212\la-taba-mostador-patagonico | feature/mostrador-patagonico-v1 | 2e5f02b5d201f9addbe6d1d1a8f8b5aa900bbde0 | clean |
| C:\1212\la-taba-platform-rc-clean-integration | integration/taba-platform-rc-clean | c6d6a7b56df46fb6989b7e6584a165ff915de6c1 | clean |
| C:\1212\la-taba-production-rc1 | release/taba2-production-rc1 | 4ca22af6d425c422fdca2be8e11798a2de170033 | clean |
| C:\1212\la-taba-promos-packshots | feature/catalog-packshots-promos | 64615dbd594279945257078f315ec911dbade5d6 | dirty(51), preservado |
| C:\1212\la-taba-real-orders-staging | staging/real-orders-walter | c6270589756214eac617515248e93a8e8819190b | dirty(9), preservado |
| C:\1212\la-taba-real-pilot-staging | release/taba-real-pilot-staging | 9a99698ddbe7ef5de10c779699ca58e74f3b379a | dirty(9), preservado |
| C:\1212\la-taba-redesign-rojo | feature/la-taba-redesign-rojo | c6270589756214eac617515248e93a8e8819190b | dirty(11), preservado |
| C:\1212\la-taba-rider-server-contracts | feature/rider-delivery-server-contracts | 4960da279f0f668559ab55b6a751576b18232b95 | clean |
| C:\1212\la-taba-rider-staging-certification-backend | fix/rider-staging-certification | d0b995eaa642a8c78a28a0a9d966a3bdd89b6e7b | clean |
| C:\1212\la-taba-staging-pilot | release/taba-staging-pilot | ed722463a44498a9bd5d1e7b4ebdac145b89d5b5 | dirty(1), preservado |
| C:\1212\la-taba-tracking-premium-visual | feature/tracking-onthe-way-premium-visual | 1c85881db65266f9e62bba68517e5bddff869439 | clean |
| C:\1212\la-taba-ui-polish-brand | fix/la-taba-ui-polish-brand | c6270589756214eac617515248e93a8e8819190b | dirty(22), preservado |
| C:\1212\la-taba2-argentina-ecommerce | feature/taba2-argentina-ecommerce | e0d74a2469b5eb80c30f33679cd1251d62a29cd9 | clean |
| C:\1212\la-taba2-catalog-finalization | feature/taba2-p0-catalog-finalization | edbe15e908c18ed04a962504ec626e32a16fe79c | clean |
| C:\1212\la-taba2-commercial-catalog-authority | feature/taba2-commercial-catalog-authority | 6d3d1e7a40dd7ba07be0c5945dbd1f81b7e94ada | clean |
| C:\1212\la-taba2-mercadopago-checkout | feature/taba2-mercadopago-checkout | 051413a24839c9c916a457bce77cf65898041f27 | clean |
| C:\1212\la-taba2-storefront-motion | feature/taba2-storefront-motion | cb3751bf8f35b1878c316e3b3ef89f88b3d99903 | clean |
| D:\1212\la-taba-migration-fetch-audit | detached | 7df4643c2e0bbcccb2eff435217fb43a5663c1a6 | dirty(25), diagnóstico preservado, fuera del RC |
| D:\1212\la-taba2-mercadopago-staging-rc1 | release/taba2-mercadopago-staging-rc1 | c5e2a858695788356293d4d45b9396d2fc034c90 | dirty(23), diagnóstico preservado, fuera del RC |

### Rider Android

| Worktree | Rama | HEAD | Git |
| --- | --- | --- | --- |
| D:\1212\la-taba-rider-android | fix/rider-android-runtime-hardening | 434c4d53e021579171398cfd10c3b6439730a22c | clean |
| D:\1212\la-taba-rider-live-contracts | feature/rider-live-contract-integration | f1f3f37c5e2793c40f672fbc9b099eee6a746dba | clean |
| D:\1212\la-taba-rider-pilot-readiness | feature/rider-pilot-readiness-ux | db645b51f89c8862da6ad29af16ec4e194c9cbc6 | clean |
| D:\1212\la-taba-rider-production-rc1 | release/taba2-rider-production-rc1 | 214d2b49eff7bb78e4459161a381f646ddf2034b | clean |

f1f3f37 contiene 434c4d5 y db645b5. No se encontró una corrección Android
posterior fuera de esa línea. El RC Android parte de f1f3f37 y sólo agrega
hardening de build, firma, CI, crash sanitizado y runbooks.

## 3. Fuentes, ancestros e integración

| Componente | Fuente verificada | Ancestro/base | Propósito y decisión |
| --- | --- | --- | --- |
| Base | c6d6a7b56df46fb6989b7e6584a165ff915de6c1 | propio | Intake e integración base |
| Catálogo final | edbe15e908c18ed04a962504ec626e32a16fe79c | c6d6a7b | Integrado mediante su descendiente storefront |
| Storefront motion | cb3751bf8f35b1878c316e3b3ef89f88b3d99903 | c6d6a7b; contiene edbe15e | Historial preservado |
| Windows/fiscal | 89bda02b73b651cc42f8c9fa3a008903501f89e9 | c6d6a7b | Historial preservado; resolución semántica probada |
| Rider backend | d0b995eaa642a8c78a28a0a9d966a3bdd89b6e7b | c6d6a7b | Historial preservado |
| Mercado Pago | 051413a24839c9c916a457bce77cf65898041f27 | c6d6a7b | La rama fue localizada, revisada, versionada y luego integrada; no se asumió su existencia |
| Rider Android | f1f3f37c5e2793c40f672fbc9b099eee6a746dba | 31003891de66c6a3d3fd78b3a4fbab0ac746ac4a | Repositorio separado |

El merge-base del RC web/backend con la base es c6d6a7b. La divergencia
base...RC es 0/67 commits al contar las historias integradas y 20 commits
first-parent propios de la construcción del RC. No hubo cherry-pick masivo ni
resolución automática ours/theirs.

Mercado Pago fue observado inicialmente como trabajo no versionado sobre
cb3751b; se auditó, se convirtió en siete commits focales hasta 051413a y se
integró recién entonces. No se utilizó el worktree staging dirty como fuente.

## 4. Commits del RC

### Web/backend/Windows

1. dc36d76be1f3b054b32a37fc0633f1b1e963704e — merge(rc): integrate TABA2 catalog and storefront motion
2. 7df4643c2e0bbcccb2eff435217fb43a5663c1a6 — test(catalog): make clean-clone validation reproducible
3. 5ceba0c92e62fd3ddbf1db4be635a2ef707f7c39 — merge(rc): integrate Windows operations and fiscal closure
4. d8ffc55e74857da361ecbbd86cf39e4dd873ee5b — merge(rc): integrate certified Rider server contracts
5. b4da753fb03df33a8b4ca303b2a6372b931ed1af — merge(rc): integrate Mercado Pago Checkout Pro
6. e8a2591ecd79cc6d7c945e3699fc5d5acd1035af — test(rc): apply integrated migrations in isolated Supabase clone
7. 48489ea85a397bd4f3fc19f437bbb34b310b6f77 — feat(operations): add durable control plane and daily close
8. a0e896db91e92f2ef10361481134610cbd869e1b — feat(desktop): add operation center and audited daily close
9. 3a034ee0ad1191533d970d731bd2072ab9086c64 — feat(desktop): harden continuity support and signed updates
10. 0d7e2a4af16f89cb2f46ae2aeaed84015c55b125 — fix(payments): gate real Mercado Pago smoke explicitly
11. 8daa307c00ed00ffd930d6a1d46313e5b6841b47 — ci(release): add gated build restore and sbom
12. afa0843fc481419a444583d6cc8d50bcdc42669c — feat(operations): make packing recovery durable
13. 44b1018da27808f17508d3447c5bc979a284efd8 — test(performance): add reproducible RC regression budget
14. 0bae129896c0d71385f4a9aff838de1bfccb2cf2 — docs(operations): add RC continuity and certification runbooks
15. 1f240e5ce7434c82d3ee6ae05cb85d0c6faa2466 — docs(operations): normalize runbook hygiene
16. c65947bf64a45937ee4b7eec86d3a5bba3cae222 — fix(database): make packing grants explicit
17. 5cb6bd556e2a055ede7fdbc455d6869e1d94ce03 — test(ci): assert immutable release tooling
18. f43aa8bfcff31b45b09d5304ab9560e6f73ced9e — test(e2e): serialize shared runtime certification
19. a70133381d922eaf2989cdd068ae66bdd40f3bee — fix(storefront): preserve physical touch target minimum
20. 4ca22af6d425c422fdca2be8e11798a2de170033 — fix(runtime): expose deterministic startup readiness

### Rider Android

1. 1150048 — ci(android): gate and attest signed rider builds
2. 214d2b49eff7bb78e4459161a381f646ddf2034b — chore(rider): add sanitized crash and release runbooks

## 5. Modelo operativo integrado

El RC conserva catálogo, bloqueo de precio pendiente, stock autoritativo,
carrito, checkout, pedidos, panel, scanner, packing, POS, inventario, Rider,
tracking, entrega, fiscal outbox, ARCA, CAE, QR, PDF, almacenamiento privado,
impresión, notas de crédito y reconciliación.

Se agregó sólo hardening operativo:

- Centro de operación con 13 clases de excepción, niveles INFO, WARNING,
  ACTION_REQUIRED y CRITICAL, acción concreta y correlation ID.
- cierre diario inmutable con pedidos, pagos, caja, inventario y fiscal;
- health y alertas durables, sin secretos ni datos sensibles completos;
- packing offline durable sólo sobre manifiestos previamente reconciliados;
- confirmación final y CAS en PostgreSQL al recuperar conectividad;
- cola local, outbox e impresión recuperables;
- backup SQLite con VACUUM INTO, SHA-256 y quick_check;
- diagnóstico de soporte sanitizado;
- updater Tauri fail-closed con endpoint HTTPS, clave pública y firma obligatoria;
- gates separados para Mercado Pago productivo, pago real, ARCA y piloto.

No se rediseñó el panel ni se agregó una función comercial nueva.

## 6. Migraciones

Hay 33 migraciones incrementales. El manifiesto ordenado nombre+SHA-256 tiene
SHA-256 agregado:

787140d1db646ce7eab96bad133fa401571c59b30695fef979d31aff078b423a

| Migración | SHA-256 |
| --- | --- |
| 20260531030000_la_taba_phase1_orders.sql | 729ee9d1f97fe1a83ff4e82a6448649503fb67cd79f7cdd11738250824f4c652 |
| 20260531040000_la_taba_phase1_hardening.sql | d87fc0f0264976e532f8ead72a1386b9b8d035511e60aeba1e5fbba2d8ed97df |
| 20260601205707_operational_orders_v1.sql | a1d6a5b2f4c398847ad441d63d22a3c40b8d5c9a01cc44816cf986e98c50e383 |
| 20260725030000_taba_production_orders.sql | 1824f10cfd75ae3cd96396f2db2c7e7225882d4e0fb8831d0840af66e1b9a0b0 |
| 20260725050000_tracking_rider_privacy.sql | 3d8c67c668f37bffef379cfa87f581d9541be50efb848d6d6eb46cb471e2c322 |
| 20260725060000_alcohol_reservations_abuse.sql | 1cb8d19b9ceefe67a8463c45f0890cfe27be8a8a844e5805769e7ec3b175b8d6 |
| 20260725070000_catalog_category_authority.sql | 5a1e158c6d0907ce091483b2109e2a1e7e878b2d3ffebf429b181e040042cba6 |
| 20260725080000_rider_assignment_tracking_gate.sql | e390266fcae4a9c21fb69cc301ceb95cb9f11095c62d6f846112e0270cbabfb6 |
| 20260725090000_delivery_handoff_code.sql | b85566aa8f09d6700cb376125d76f26ad458f3f90269479d0cdada03af4ef0a0 |
| 20260725100000_tracking_handoff_recovery.sql | 4f3038da041f5ecabb5f17275a93936514408345b6fe6880bc2e878fa4703530 |
| 20260725110000_catalog_publication_authority.sql | 4cd1d1c52ca388fbac6b9752f99f1633045478940bca86c38f79cd753368e375 |
| 20260725120000_business_contact_authority.sql | 4d93bfbdaadebcf95673a2750278ac7c246202ba99b601c65a93ede4859bab9b |
| 20260725130000_fix_tracking_token_regex.sql | 8372747f0253643eef0eb28ff38eb8d69c0e5fcd3bd0807da871d26852c644b2 |
| 20260728090000_customer_profiles_addresses.sql | 3cdc2b9cf227bdf08a33326d2917df7c438ec87aeada356d2d298b7f2f9ea78d |
| 20260729150000_customer_profile_completion.sql | afaabc09c679072589a8488df7818b2f3ea02ecc22bfebd55ea07f2f93232d2e |
| 20260729190000_customer_address_street_number_required.sql | a9038f30e1873ed8708f19500d7eb63287b7a93fe4e61f7efecba35bf96de11e |
| 20260729203000_public_tracking_terminal_visibility.sql | b38c4d7a20aa71f0ec0a5f82ed0c40a9804baf3f5d2f78922dde88594cab64be |
| 20260731230000_staging_qa_fixture_catalog.sql | 5395bd730be61896156933026d346930e1f609db245f904d6b51afaf2af87562 |
| 20260731231000_staging_qa_product_verification.sql | 64d9d93d4b9f706b7c509ca5e7cafc29c8faeb7fc44c579a62b8b676bb788b3d |
| 20260801020000_order_revision_and_event_sequence.sql | 28a442710d4a9b7abdae89d2bb102ac98cd798c5539bab04d6a8ca98f19f3652 |
| 20260802090000_mercadopago_checkout_pro_foundation.sql | 02fdf8bca9db1fe494e649227a23967e870baa5f2194973fd1b5ac678644f8ea |
| 20260802093000_mercadopago_checkout_pro_lifecycle.sql | 8ca962e693f02ce8f552e72cbbd85b94c84dd9aaac5612c72df0bb4f15a71a07 |
| 20260802094000_mercadopago_rate_limits.sql | 25662f1f3543a3a8011eaf79f5cf0a60bf137bb1f95ea29fb2e951f81ef15ea2 |
| 20260802100000_rider_delivery_server_contracts.sql | 6b7deccb96bdf3a61f1aa49c35aaeeb3f374818c00a5ac3a92954f84e5e4a3a2 |
| 20260802101000_rider_delivery_legacy_start_revocation.sql | 2a3d50dfc52277bc1ddc6796ac5496c2e4f200f985af4de927e3629fb63259c1 |
| 20260802102000_rider_delivery_legacy_claim_gps_revocation.sql | 32ea3845c1249d6c1cb498a1a77f1c6fda7ded813ad87639146c087e00e9e767 |
| 20260802103000_rider_queue_read_lock_mode.sql | 03b6a0f243e61dca8dd181b910df5888defcd49cb282da82d1dda6a7f9f690cb |
| 20260802104000_rider_location_receipt_revision.sql | e50d060a08afad930924a8c5459c881b9e5440e2b9b2abe077156b5fc4e40604 |
| 20260802160000_business_windows_scanner_fiscal.sql | bc3ba44d64faeeafc117cbe3e3dfca5d0c58e28e17703cd8c64ac5458ed724af |
| 20260802170000_fiscal_document_closure.sql | 40997629df153117c6dfae2900b5ec16a1703d2d3281fe6b044e622005954308 |
| 20260802171000_fiscal_document_closure_hardening.sql | f22cffe9b1fe8d3c358993058f235affb5172ce38501126addabbae11bb460b7 |
| 20260802180000_production_operations_control_plane.sql | 3288635af3f52fb7c6bbdbc9bf00b19dc9f9ef70ab10118f7432eb306dc1b898 |
| 20260802200000_durable_offline_packing.sql | 89b8cc751e332dc82bf9433722f1a4abc1819bc3cbf15b9ed52f22e8a91b00cb |

Revisión estática: PASS. Aplicación desde cero, pgTAP y restore sobre copia
aislada: NOT_RUN, porque Docker no respondió y no hay psql/PostgreSQL local
alternativo. No se reinició Docker y no se conectó staging. El script de restore
aislado fue agregado, pero su mera existencia no se considera prueba.

## 7. Pruebas y gates

| Gate | Resultado |
| --- | --- |
| npm run verify:technical | PASS: Node 788/788, fiscal 22/22, Playwright 152/152, sin skip/todo en esas suites |
| Mercado Pago webhook | PASS local: Deno 4/4 y contratos Node 3/3 |
| Rust | cargo fmt PASS; clippy all-targets -D warnings PASS; cargo test 13/13 |
| npm audit --omit=dev raíz | PASS: 0 vulnerabilidades |
| npm audit --omit=dev bridge ARCA | PASS: 0 vulnerabilidades |
| Secret scan | PASS: sin credenciales de pago asignadas ni claves privadas |
| Release hygiene y diff check | PASS |
| Migraciones estáticas | PASS: 33, con avisos de política que requieren DB real |
| npm run verify | FAIL esperado en catálogo: falta TABA_CATALOG_FILE comercial real |
| pgTAP/restore aislado | NOT_RUN: Docker no disponible |
| Flutter analyze/test | PASS: analyze limpio; 65/65 |
| JVM Rider staging/production | 67 por flavor, 0 fail/error; 2 smokes con credenciales skipped por flavor, no contados como PASS |
| OSV Rider | PASS local: 26 paquetes, sin issues reportados por OSV Scanner 2.3.8 |
| Firma Windows | FAIL-CLOSED: falta TAURI_SIGNING_PRIVATE_KEY |
| Build Android production | FAIL-CLOSED sin confirmación/config/keystore |

Las pruebas con proveedor, staging, hardware y datos reales no se sustituyeron
por fixtures. Las ejecuciones fallidas intermedias de E2E se corrigieron sin
omitir casos; el resultado final es 152/152 con un worker para evitar compartir
un runtime no aislado.

## 8. Builds, hashes y SBOM

Build Tauri local sobre HEAD 4ca22af6d425c422fdca2be8e11798a2de170033.
Los tres artefactos tienen Authenticode=NotSigned, sin timestamp ni certificado;
son evidencia local no distribuible.

| Artefacto | Tamaño | SHA-256 |
| --- | ---: | --- |
| D:\1212\taba-rc1-cargo-target\release\taba-negocio.exe | 19,640,832 | eaa0987dbac86b27a4355551269f6aaf964175cf9597ad4806403a84db09324d |
| D:\1212\taba-rc1-cargo-target\release\bundle\msi\TABA Negocio_0.1.0_x64_en-US.msi | 9,662,464 | c9f60873d2283cd26d827b509f60e0ffcd79c4973ca43ef0bb6cdfde00b16321 |
| D:\1212\taba-rc1-cargo-target\release\bundle\nsis\TABA Negocio_0.1.0_x64-setup.exe | 8,005,012 | 39c2448b189e25823fa4a488400db1f649d41b83d1b42e8aec936edbfdae581e |

Evidencia de hashes:
C:\1212\artifacts\la-taba-production-readiness\windows-unsigned-4ca22af.json
(SHA-256 3a44f35699d37401c309a7c7a0a106589a180d04b0736445c8a11a7cd175433b).

SBOM CycloneDX 1.5:
C:\1212\artifacts\la-taba-production-readiness\sbom-4ca22af.cdx.json,
617 componentes, SHA-256
d9ca015c2698b68fb8327223de6fcce72c8f03081845e03364acd45262c57625.

Android local:
D:\1212\la-taba-rider-production-rc1\build\app\outputs\flutter-apk\app-staging-debug.apk,
162,011,582 bytes,
SHA-256 4aceb7a652b20832effef007f4eb00a1557e6c82d214c594ac6eecaae6556846.
Es debug-signed, no distribuible y no sustituye AAB productivo firmado.

No se construyó un release Windows firmado ni un AAB productivo. El pipeline
manual construye una sola vez, exige firma/timestamp/update signatures y genera
RELEASE.json, SHA256SUMS y SBOM antes de cualquier promoción.

## 9. Rendimiento

Evidencia:
C:\1212\la-taba-production-rc1\artifacts\performance\local-rc1.json,
SHA-256 88058e833ddaf9896b262622102b512bd33cafcda17a3ac52054f27df53bfb92.

Medición local repetible: 7 muestras por perfil sobre Windows host y loopback
Chromium; no es hardware ni red real.

| Métrica | Desktop p50/p95 ms | Mobile emulado p50/p95 ms |
| --- | ---: | ---: |
| Carga inicial | 1151.92 / 1331.47 | 793.56 / 995.81 |
| Render catálogo | 126.70 / 256.62 | 99.55 / 120.52 |
| Búsqueda | 74.39 / 102.94 | 47.05 / 64.82 |
| Actualizar carrito | 433.42 / 634.91 | 423.55 / 450.03 |
| Render carrito | 63.06 / 95.04 | 51.20 / 79.98 |
| Tracking | 23.36 / 27.57 | 21.05 / 26.18 |
| Panel negocio | 114.94 / 136.83 | 104.84 / 236.94 |

PDF fiscal sintético determinista: 10 muestras, p50 21.73 ms, p95 98.28 ms,
8,898 bytes, SHA-256 determinista
9bff90dc4fede4276460fa69b92d4d81993dfb38dfe5fd0c3be8fb8b38040f9b.
Los presupuestos locales pasaron. Preference, webhook+DB, CAS, cierre, Storage
privado, spool físico, Moto G15, iPhone y redes reales están NOT_RUN.

## 10. Seguridad, continuidad y observabilidad

- RLS, grants explícitos, search_path y permisos tienen pruebas estáticas y
  contractuales; la auditoría remota de Security Advisor/grants queda pendiente.
- El navegador no puede aprobar pagos ni calcular importes autoritativos.
- Access Token de Mercado Pago y service role no se incluyen en panel, Windows,
  Android ni Git.
- El gate productivo de Mercado Pago exige
  MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved; un pago real además exige la
  confirmación exacta del usuario.
- XML/WSAA/WSFE, QR, PDF, artifacts, print jobs, accounting policy, CAS,
  ambigüedad y reconciliación fiscal permanecen integrados.
- Correlation IDs enlazan checkout, payment, order, packing, delivery,
  fiscal_document y print_job.
- Diagnósticos y crash hooks sólo registran versión, estado, códigos,
  timestamps y correlation IDs sanitizados.
- Runbooks cubren pérdida de base/Storage, SQLite corrupto, PC reemplazada,
  teléfono perdido, credenciales/certificados, MP, Edge Functions y rollback.
- RTO/RPO y restauración no se declaran medidos hasta ejecutar el drill.

## 11. Despliegues, datos y cleanup

- Staging deploy: NONE.
- Producción: NONE.
- Pagos/proveedores: ninguna llamada ni dato real creado.
- ARCA: ninguna homologación ni emisión.
- Supabase remoto: ninguna migración, escritura, restore ni cambio de proyecto.
- Git remoto: sin push.
- Datos locales: fixtures sintéticos de tests, builds, SBOM, hashes y mediciones.
- Cleanup: procesos de prueba cerrados; artifacts de evidencia preservados.
  Los worktrees dirty ajenos al RC no se limpiaron para no destruir trabajo.

## 12. Rollback

El RC no fue desplegado, por lo que el rollback actual es no promoverlo. Para
staging/piloto, el diseño exige promover el mismo artifact firmado, migraciones
forward-only, backup/restore verificado, updater firmado con canal protegido,
rollback a artifact firmado anterior y reconciliación de outboxes antes de
cambiar versión. Nunca se propone rollback destructivo de base.

## 13. Bloqueos y riesgos

Bloqueos obligatorios:

1. Falta catálogo comercial real aprobado; npm run verify se detiene allí.
2. Docker no responde y no hay PostgreSQL local alternativo: pgTAP, aplicación
   desde cero, copia de staging y restore drill siguen NOT_RUN.
3. No se ejecutó staging completo ni Security Advisor/config/backups/PITR.
4. Mercado Pago de prueba requiere app/test accounts, secretos y HTTPS staging.
5. No existe autorización para pago real.
6. ARCA homologación no fue autorizada y faltan credenciales/política aprobada.
7. Falta firma de código Windows y updater con certificado legítimo.
8. Falta AAB Rider productivo firmado y crash ingestion remota sanitizada.
9. Scanner, térmica, A4, PC real, Moto G15, iPhone y matrices de red están NOT_RUN.
10. Falta restore drill con RTO/RPO medidos, staging smoke y responsables
    comerciales/contables/operativos.
11. Falta autorización I_AUTHORIZE_TABA2_CONTROLLED_PRODUCTION_PILOT.

Riesgos residuales: divergencias no observadas en infraestructura remota,
locks/duración reales de migración, pérdida/duplicación bajo fallas distribuidas
no simulables sin DB/proveedores, compatibilidad de drivers/spoolers, ejecución
background Android real, latencia móvil, políticas contables y respuesta de
operadores durante incidentes.

## 14. Declaraciones

No corresponde emitir TABA2_PRODUCTION_RC_LOCAL_CERTIFIED: fallan los gates de
catálogo y certificación PostgreSQL/restore.

No corresponden TABA2_PRODUCTION_RC_STAGING_CERTIFIED,
TABA2_PHYSICAL_OPERATIONS_CERTIFIED,
TABA2_MERCADOPAGO_TEST_FLOW_CERTIFIED,
TABA2_REAL_PAYMENT_SMOKE_CERTIFIED,
TABA2_ARCA_HOMOLOGATION_CERTIFIED ni
TABA2_READY_FOR_CONTROLLED_PRODUCTION_PILOT.

Producción fiscal y comercial permanece deshabilitada por diseño. No se declara
preparación para producción irrestricta.
