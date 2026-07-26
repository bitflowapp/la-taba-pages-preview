# Registro de validación (2026-07-26)

- npm run catalog:images:fetch -> PASS (8 fuentes verificadas y SHA-256 coincidente).
- npm run catalog:images:normalize -> PASS (8 masters y 8 miniaturas WebP).
- npm run catalog:images:verify -> PASS (16 WebP verificadas con fuente, derechos y SHA-256).
- npm run check -> PASS.
- npm test -> PASS (446 tests, 0 fallos).
- npm run test:e2e -> PASS (53 tests, 0 fallos).
- git diff --check -> PASS.

La preview queda aislada al modo local/demo; no se modificaron checkout, tracking, Auth, Supabase, RLS ni lógica productiva.
