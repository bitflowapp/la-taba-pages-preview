# Storefront comercial de TABA2 — evidencia

Sesión `TABA2_COMMERCIAL_STOREFRONT_PILOT`, 2026-08-09.
Rama `feature/taba2-storefront-commercial-pilot`, worktree
`D:\1212\worktrees\taba2-storefront-pilot`, base `66ba221`.

## Qué hay acá

```
evidencia/
  baseline/     capturas del storefront ANTES de tocar nada
  after/        capturas intermedias de cada corrección
  final/        revisión visual final: 4 anchos × 2 motores × 8 pantallas
  a11y/         accesibilidad y navegación por teclado
```

## Documentos

- `D:\1212\worktrees\taba2-storefront-pilot\STOREFRONT-COMERCIAL-HANDOFF.md`
  — qué puede resolver el software y qué sólo puede resolver el negocio.
- `D:\1212\_claude-locks\taba2-storefront-commercial-pilot.txt` — el lock de la
  sesión, con lo que se tocó y lo que no.

## Cómo reproducir

```powershell
cd D:\1212\worktrees\taba2-storefront-pilot
$env:TEMP='D:\1212\_claude-tmp\storefront-pilot'   # E: está al 100%
$env:TMP=$env:TEMP
npm ci
npm run check
npm test
$env:TABA_E2E_HTTP_PORT='8572'; $env:TABA_E2E_RELAY_PORT='18872'
npx playwright test
```
