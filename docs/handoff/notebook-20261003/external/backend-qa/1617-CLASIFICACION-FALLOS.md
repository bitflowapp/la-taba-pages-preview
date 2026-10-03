# Clasificación de fallos — gate TABA2 mobile design

HEAD evaluado: `c0db6ae69e6c7716507a2b8f0645582f95098c50`
Baseline de comparación: `4ca22af` (`release/taba2-production-rc1`), **ancestro directo** de HEAD.
`tests/e2e/customer-delivery.spec.mjs` y `js/customer-delivery.js` son **byte-idénticos**
entre baseline y HEAD (`git diff 4ca22af..HEAD --` vacío), así que la comparación aísla
el efecto del código de alrededor.

## Chromium — 170/170

Cero fallos. Manifiesto: `e2e/chromium.json`.

## Firefox — 163/170 (7 fallos, 0 regresiones)

### A. Limitación conocida de Playwright — 3 fallos

Error literal: `browser.newContext: options.isMobile is not supported in Firefox`.

| Test | Origen del `isMobile` |
| --- | --- |
| `honesty-mode.spec.mjs:242` | `isMobile: true` explícito |
| `mobile-touch-gesture.spec.mjs:26` | descriptor `devices['iPhone 13']` |
| `mobile-touch-gesture.spec.mjs:67` | descriptor `devices['iPhone 13']` |

Fallan en 2–4 ms (error de construcción del contexto, no aserción). Pasan los 3 en
Chromium. Independientes del commit: fallarían igual en cualquier árbol.

### B. Fallo baseline preexistente — 3 fallos

Fallan **idénticamente** en el baseline RC, donde el código de esta rama no existe.

| Test | Baseline `4ca22af` | HEAD `c0db6ae` |
| --- | --- | --- |
| `customer-delivery:296` editar Perfil y volver | FALLA | FALLA |
| `customer-delivery:462` bloquea por Perfil incompleto | FALLA | FALLA |
| `customer-delivery:491` bloquea sin direcciones | FALLA | FALLA |

### C. Flakiness del runner — 1 slot

Ambas corridas producen exactamente 4 fallos en `customer-delivery`, pero los conjuntos
**no coinciden**, y el fallo extra se intercambia de test:

| Test | Baseline `4ca22af` | HEAD `c0db6ae` |
| --- | --- | --- |
| `customer-delivery:347` 4 direcciones compactado | PASA | FALLA |
| `customer-delivery:631` borrar dirección seleccionada | FALLA | PASA |

Si HEAD hubiera roto `:347`, `:631` no habría mejorado en la dirección opuesta.

Confirmación por repetición directa de `:347` sobre HEAD (mismo commit, Firefox):

| Intento | Resultado |
| --- | --- |
| 1 | PASA (9,5 s) |
| 2 | FALLA (11,8 s) — `toHaveAttribute` |
| 3 | PASA (9,9 s) |

2 de 3 pasan sobre código idéntico ⇒ flakiness, no regresión.

## WebKit — 168/170 (2 fallos, 0 regresiones)

Ambos specs son **byte-idénticos** entre baseline y HEAD, y fallan igual en los dos
árboles con el mismo error:

| Test | Baseline `4ca22af` | HEAD `c0db6ae` | Error |
| --- | --- | --- | --- |
| `business-windows-operations:49` panel fiscal | FALLA (50,0 s) | FALLA (50,0 s) | `Test timeout of 45000ms exceeded` |
| `delivery-proof:9` comprobante de entrega | FALLA (13,3 s) | FALLA | `expect(locator).toContainText(expected) failed` |

Ninguna de las dos superficies (panel fiscal de Negocio, comprobante del rider) fue
tocada por esta rama. `delivery-proof:9` además ya venía fallando en WebKit en las
corridas previas de la sesión anterior (`pw-2-rama-webkit`, `pw-4-rc-webkit`, `pw-re`,
todas con el mismo testId `b1feb198c4a11a86df76-f684d8c3c0c8f4993d4f`).

## Conclusión

**Cero regresiones atribuibles a la rama `integration/taba2-mobile-design-review`.**

| Navegador | Pasan | Fallan | Regresiones |
| --- | --- | --- | --- |
| Chromium | 170/170 | 0 | 0 |
| Firefox | 163/170 | 7 | 0 |
| WebKit | 168/170 | 2 | 0 |

Los 9 fallos totales se reparten en 3 limitaciones conocidas de Playwright, 5 fallos
baseline preexistentes del RC y 1 slot flaky del runner. Ninguno es infraestructura:
el host se mantuvo estable (C: 356–386 MB libres) durante todo el gate.
