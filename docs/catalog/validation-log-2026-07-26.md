# Registro de validación (2026-07-26)

- npm run catalog:images:fetch -> PASS (12 fuentes verificadas y SHA-256 coincidente).
- npm run catalog:images:normalize -> PASS (12 masters y 12 miniaturas WebP).
- npm run catalog:images:verify -> PASS (24 WebP verificadas con fuente, derechos y SHA-256).
- npm run check -> PASS.
- npm test -> PASS (462 tests, 0 fallos).
- npm run test:e2e -> PASS (58 tests, 0 fallos).
- npm audit --audit-level=high -> PASS (0 vulnerabilidades).
- git diff --check -> PASS.
- Revisión visual -> PASS: ronda 1 (70 capturas), ronda 2 (75 capturas) y 8 estados focalizados de promociones; sin 404, errores críticos de consola ni overflow detectado.

La preview queda aislada al modo `?demo=1`; no se modificaron Supabase productivo, Auth, RLS, migraciones ni la ruta productiva fail-closed. Las promociones visibles sólo se habilitan si tienen SKU exacto, precio, vigencia y aprobación humana verificables.
