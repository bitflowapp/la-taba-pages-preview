# TABA - Clasificacion del diff funcional pre-commit

Base: `4197bdbc1df7d3eb1328afc4a7a01e1067f14316`
Rama: `feature/catalog-checkout-premium`

## Criterio

- Commit 1: autoridad de Perfil, checkout y direcciones; no incluye E2E generales.
- Commit 2: relay autoritativo, seguridad de sala, recuperación y cache/runtime que acompaña el protocolo.
- Commit 3: sólo certificación E2E y harness; no agrega comportamiento de producto.
- Los archivos mixtos se separan con staging por hunks. No se usa `git add .` ni `git add -A`.

## Archivos

| Archivo | Responsabilidad | Commit destino | Hunks mixtos | Pruebas | Riesgo | Decisión |
|---|---|---:|---|---|---|---|
| `index.html` | Checkout sin campos duplicados; version runtime | 1 + 2 | Sí | checkout, PWA, startup | Alto | Hunk DOM en C1; version en C2 |
| `js/app.js` | Retorno Perfil; status/key del relay | 1 + 2 | Sí | profile checkout, realtime | Alto | Hunks separados |
| `js/business.js` | Estado de sincronización del negocio | 2 | No | business/realtime | Medio | C2 |
| `js/core/profile-checkout.js` | Autoridad sandbox/producción/none | 1 | No | unitarias checkout | Alto | C1 |
| `js/core/realtime-sync.js` | Snapshot, revisión, merge, ACK/backoff | 2 | No | realtime unitarias | Alto | C2 |
| `js/customer-delivery.js` | Checkout basado en Perfil/direcciones | 1 | No | customer-delivery | Alto | C1 |
| `js/customer-profile-view.js` | Perfil editable y retorno al pedido | 1 | No | profile E2E/unitarias | Alto | C1 |
| `js/delivery.js` | Estado relay en negocio/rider | 2 | No | business/delivery | Medio | C2 |
| `js/realtime.js` | Transporte, polling, foreground/online, ACK | 2 | No | realtime E2E/unitarias | Alto | C2 |
| `js/repositories/repository_factory.js` | Repositorio sandbox de Perfil | 1 | No | repository | Alto | C1 |
| `js/repositories/sandbox_order_repository.js` | Perfil sandbox asociado al repository | 1 | No | sandbox/repository | Medio | C1 |
| `js/repositories/sandbox_customer_profile_repository.js` | Persistencia temporal de Perfil sintético | 1 | No | release/profile | Alto | C1 |
| `scripts/realtime-relay.mjs` | Relay HTTP/SSE autoritativo y key | 2 | No | relay state/E2E | Alto | C2 |
| `scripts/realtime-relay-state.mjs` | Estado persistente, hash, TTL, merge stale-safe | 2 | No | relay state unitarias | Alto | C2 |
| `styles/checkout.css` | Superficie checkout Perfil/direcciones | 1 | No | checkout E2E | Medio | C1 |
| `sw.js` | Cache versionada del runtime confiable | 2 | No | PWA/GitHub Pages | Medio | C2 |
| `tests/customer-profile-completion.test.mjs` | Higiene de checkout/Profile | 1 | No | unitarias | Bajo | C1 |
| `tests/repository.test.mjs` | Authority y repository Profile | 1 | No | unitarias | Bajo | C1 |
| `tests/release-hygiene.test.mjs` | Fixtures sintéticos del Perfil sandbox | 1 | No | unitarias | Medio | C1 |
| `tests/realtime-sync.test.mjs` | Labels y reglas del relay | 2 | No | unitarias | Bajo | C2 |
| `tests/realtime-relay-state.test.mjs` | Persistencia, key, TTL, revisión y merge | 2 | No | unitarias | Alto | C2 |
| `tests/github-pages.test.mjs` | Cache runtime versionada | 2 | No | unitarias | Bajo | C2 |
| `tests/pwa.test.mjs` | Entry point/cache runtime | 2 | No | unitarias | Bajo | C2 |
| `tests/startup-recovery.test.mjs` | Recovery shell y app version | 2 | No | unitarias | Bajo | C2 |
| `tests/e2e/helpers.mjs` | Helpers de seed/checkout/relay | 3 | No | E2E focales | Medio | C3 |
| `tests/e2e/customer-delivery.spec.mjs` | Perfil, direcciones, retorno, delivery/pickup | 3 | No | customer-delivery | Alto | C3 |
| `tests/e2e/demo-realtime-profile.spec.mjs` | Perfil dentro de demo realtime | 3 | No | focal Profile | Alto | C3 |
| `tests/e2e/demo-realtime-reliability.spec.mjs` | Snapshot, ACK, recovery y seguridad | 3 | No | focal relay | Alto | C3 |
| `tests/e2e/business-inbox.spec.mjs` | Negocio y asignación | 3 | No | business | Medio | C3 |
| `tests/e2e/cancel-confirmation.spec.mjs` | Cancelación | 3 | No | cancelación | Medio | C3 |
| `tests/e2e/delivery-code.spec.mjs` | Código de entrega | 3 | No | delivery-code | Alto | C3 |
| `tests/e2e/direct-ordering-growth.spec.mjs` | Checkout y recompra | 3 | No | E2E general | Medio | C3 |
| `tests/e2e/honesty-mode.spec.mjs` | Preview cerrado y Perfil | 3 | No | E2E general | Medio | C3 |
| `tests/e2e/ios-blank-screen.spec.mjs` | Harness de recovery/app version | 3 | No | E2E recovery | Medio | C3 |
| `tests/e2e/la-taba.spec.mjs` | Flujos cliente/negocio/rider | 3 | No | E2E general | Alto | C3 |
| `tests/e2e/sandbox-flow.spec.mjs` | Sandbox end-to-end y no escritura de Perfil al confirmar | 3 | No | E2E sandbox | Alto | C3 |
| `tests/e2e/showcase.spec.mjs` | Showcase y datos sintéticos | 3 | No | showcase | Medio | C3 |
| `tests/e2e/tracking-arriving.spec.mjs` | Harness de scroll de tracking | 3 | No | tracking | Medio | C3; estrictamente harness |

## Riesgos y controles

Los tres archivos mixtos no se agregan completos: se usarán patches de índice generados desde el diff actual. Cada commit se verificará con `git diff --cached --check`, contenido staged y un worktree detached independiente antes del commit siguiente. Los procesos live no se detienen.
