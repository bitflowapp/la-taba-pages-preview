# Qué hay en esta carpeta

`OVERNIGHT-CUSTOMER-RC.md` es el informe. Todo lo demás es la evidencia que lo
sostiene, para que cada número del informe se pueda verificar sin creerle a
nadie.

| archivo | qué es |
|---|---|
| `OVERNIGHT-CUSTOMER-RC.md` | **el informe.** Empezar por acá |
| `soak/soak.jsonl` | una línea por ciclo del soak: escenario, duración, memoria, oyentes, intervalos, temporizadores, fallas |
| `soak/soak-resumen.json` | el resumen del soak: totales y tendencia por cuartos |
| `soak-corrida-1-artefacto-de-stock/soak.jsonl` | la primera corrida, la que encontró un defecto del propio harness. Archivada a propósito |
| `staging/staging-readonly.json` | certificación del sitio publicado. Incluye la prueba en vivo de que el borde contesta 200 con HTML a rutas inexistentes |
| `perf-final.json` | performance con el worker ACTIVO, seis corridas, tres escenarios |
| `perf-antes-sniff-style.json` · `perf-con-sniff-script.json` | el A/B que decidió, con número, dónde inspeccionar el cuerpo de las respuestas y dónde no |
| `responsive/responsive-chromium.md` · `responsive-webkit.md` | 66 mediciones por motor en 320/360/375/390/412/432 |
| `a11y/a11y-chromium.md` · `a11y-webkit.md` | accesibilidad sin color: nombres, etiquetas, foco con tabulador real, movimiento reducido |
| `contraste/audit-chromium.md` | contraste y objetivos táctiles sobre el color realmente pintado |

El código está en la rama `feature/taba2-customer-overnight-rc`, worktree
`D:\1212\worktrees\taba2-customer-overnight-rc`. El informe también quedó
versionado adentro del repo como `CANDIDATA-CLIENTE-OVERNIGHT-RC.md`.

Nada de esto está publicado: no hubo deploy, ni push, ni mutación de staging.

## Cómo reproducir lo principal

```sh
cd D:\1212\worktrees\taba2-customer-overnight-rc
set TABA_E2E_HTTP_PORT=8170 & set TABA_E2E_RELAY_PORT=18870

npm run check
npm test
npx playwright test --project=chromium
npx playwright test --project=mobile-webkit

:: el service worker con el worker REALMENTE activo
npx playwright test tests/e2e/service-worker-degraded-recovery.spec.mjs

:: performance con el worker activo (necesita el relay levantado aparte)
node scripts/realtime-relay.mjs 8140
node scripts/measure-customer-performance.mjs --repeticiones=6

:: el soak
node scripts/soak-customer-overnight.mjs --minutos=50 --puerto=8140

:: la certificación de lo publicado (sólo GET)
node scripts/certify-staging-customer-readonly.mjs
```
