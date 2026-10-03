# Certificación E2E — rediseño rojo

Fecha: 2026-08-02

## Alcance certificado

- Rama: `feature/la-taba-redesign-rojo`.
- HEAD: `c6270589756214eac617515248e93a8e8819190b`.
- Árbol de trabajo: únicamente `index.html` y `styles.css` modificados.
- Sin commits, push, merge, deploy, cambios en main/staging, migraciones, Supabase ni producción.

## Servidor y puertos

La comprobación inicial del servidor oficial `node scripts/realtime-relay.mjs` respondió HTTP 200 en `http://127.0.0.1:8133/`; el proceso de preflight se detuvo con `Stop-Process -Id 20092`.

La certificación final ejecutó Playwright con `TABA_E2E_HTTP_PORT=8134` y `TABA_E2E_RELAY_PORT=18000`. Ambos puertos se reservaron mediante bind exclusivo y listeners reales. `reuseExistingServer` permanece en `false`; no se usó 8080 ni un servidor reutilizado.

## Resultado

`npm run test:e2e -- --workers=1 --retries=0`

- Exit code: 0
- 141/141 pruebas aprobadas
- Duración: 215.82 s (3m 36s)
- Sin retries ni skips añadidos.

La salida está en [sanitized-e2e-final-certification-raw.log](sanitized-e2e-final-certification-raw.log). Los intentos de recuperación previos también fueron conservados sólo en copias sanitizadas.

## Validaciones complementarias

| Comando | Resultado |
| --- | --- |
| `npm run check` | PASS |
| `npm test` | 635/636; única falla preexistente permitida |
| `npm run migrations:validate` | PASS (20 migraciones; aviso informativo del análisis estático) |
| `npm run catalog:images:verify` | PASS (22 SKU y 44 WebP demo) |
| `npm audit --audit-level=high` | PASS, 0 vulnerabilidades |
| `git diff --check` | PASS |

La falla de `tests/promotions.test.mjs:152` conserva el mismo blob que `HEAD` (`bf9161994f9dc47fbd684b957662fd9c822439bf`) y el código JavaScript no tiene cambios: la aserción preexistente sigue siendo `0 !== 800`.

## Remediación aplicada

La primera corrida identificó contratos visuales rotos por texto UTF-8 mal recodificado, una marca de header incompatible, una reserva inferior estática y un input de búsqueda menor de 16 px. La corrección quedó limitada a los dos archivos autorizados y devolvió los contratos de marca, PIN, safe-area, CTA, autozoom y etiquetas de categorías.

## Seguridad de evidencia

Los logs se revisaron y las copias que contenían identificadores de fixtures fueron redactadas antes de guardarse. No se conservaron JWT, tokens, contraseñas, cuerpos HTTP, UUID completos, referencias completas de pedido ni coordenadas en los logs de evidencia.
