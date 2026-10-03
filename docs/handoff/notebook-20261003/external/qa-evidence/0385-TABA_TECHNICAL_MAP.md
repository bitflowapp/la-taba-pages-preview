# TABA TECHNICAL MAP

LAST VERIFIED:
2026-09-07 23:33:00 -03:00

## RELEASE ROOT
C:\1212\la-taba-mercadopago-oauth
feature/taba-mercadopago-oauth
34f055f

## FRONTEND
C:\1212\la-taba-mercadopago-oauth
feature/taba-mercadopago-oauth
34f055f

## BUSINESS PANEL
C:\1212\la-taba-mercadopago-oauth
feature/taba-mercadopago-oauth
34f055f

## BACKEND
C:\1212\la-taba-mercadopago-oauth\supabase
feature/taba-mercadopago-oauth
34f055f

## SUPABASE
ukxqbgswjlibmnjemrzd (staging) / wwcpogltfgzgkrlilbcd (production)
C:\1212\la-taba-mercadopago-oauth\supabase\migrations

## MERCADO PAGO
C:\1212\la-taba-mercadopago-oauth
feature/taba-mercadopago-oauth
34f055f

## RIDER
C:\1212\la-taba-rider-android (worktree: D:\1212\worktrees\taba2-rider-map)
codex/rider-map-staging
95294d9

## STAGING
https://taba2-staging.pages.dev
Cloudflare Pages
feature/taba-mercadopago-oauth
11aa86e / 34f055f

## PRODUCTION
https://la-taba.pages.dev
Cloudflare Pages
main
869a684d2c1c5316eb51b0c26b6dbf552892ab19

## MERCADO PAGO STAGING
https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-connect
https://auth.mercadopago.com.ar/authorization?client_id=2691240967769590&response_type=code&platform_id=mp&state={state}&redirect_uri=https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-oauth-callback&code_challenge={challenge}&code_challenge_method=S256&scope=read+write+offline_access
https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-oauth-callback
https://ukxqbgswjlibmnjemrzd.supabase.co/functions/v1/mercadopago-webhook
https://ukxqbgswjlibmnjemrzd.supabase.co

## MERCADO PAGO PRODUCTION
MISSING
MISSING
MISSING
https://wwcpogltfgzgkrlilbcd.supabase.co/functions/v1/mercadopago-webhook
https://wwcpogltfgzgkrlilbcd.supabase.co

## TESTS
C:\1212\la-taba-mercadopago-oauth
npm run check
npm run test:payments
npm run test:webhook
npm test
npx playwright test

## BUILD
npm run vendor:build
node scripts/deploy/preparar-artefacto.mjs --commit {sha}

## DEPLOYMENT
npx wrangler pages deploy dist_release --project-name taba2-staging --branch staging (staging)
GitHub Actions workflow deploy-production.yml via merge to main (production)

## DO NOT USE
- C:\1212\la-taba-production-rc1 (branch: release/taba2-production-rc1, commit: 4ca22af): worktree obsoleto del 3 de agosto de 2026, superseded por main y releases posteriores.
- C:\1212\la-taba-platform-rc-clean-integration (branch: integration/taba-platform-rc-clean, commit: c6d6a7b): rama del 2 de agosto de 2026, ya integrada en ancestros de main.
- C:\1212\la-taba-business-operations-final (branch: feature/taba2-business-operations-final, commit: 8028dcc): rama del 5 de agosto de 2026, ya integrada en PR #85 y PR #89.
- C:\Users\marco\dev\la-taba-business-panel-automation (branch: feature/taba-business-panel-automation, commit: 523d3d0): rama del 28 de agosto de 2026, ya integrada a través de PR #89 y PR #92 en la rama principal.
- C:\1212\la-taba2-mercadopago-checkout (branch: feature/taba2-mercadopago-checkout, commit: 051413a): implementación legacy del 10 de agosto de 2026 con credenciales globales, superseded por OAuth multi-seller.
- D:\1212\la-taba2-mercadopago-staging-rc1 (branch: release/taba2-mercadopago-staging-rc1, commit: 0587712): release del 11 de agosto de 2026, superseded por la arquitectura OAuth actual.
- D:\1212\la-taba2-payment-recovery-p0 (branch: fix/taba2-p0-payment-recovery-ux, commit: 3e48bb0): corrección P0 de agosto, ya absorbida en la base unificada.
- D:\1212\worktrees\taba2-pwa-install (branch: feature/taba2-pwa-installable, commit: 105f85a): implementación preliminar PWA del 18 de agosto de 2026, superseded por la integración completa en main.
- C:\1212\la-taba2-storefront-motion, C:\1212\la-taba2-argentina-ecommerce, C:\1212\la-taba2-beverage-catalog-home, C:\1212\la-taba2-mobile-design-integration: worktrees de revisión de diseño previos al 25 de agosto de 2026, ya consolidados en el catálogo multirubro.
