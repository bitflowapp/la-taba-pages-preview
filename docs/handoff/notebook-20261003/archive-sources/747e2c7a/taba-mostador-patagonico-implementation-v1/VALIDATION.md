# TABA — Validación de la implementación "Mostrador Patagónico" V1

Worktree: `C:\1212\la-taba-mostador-patagonico`
Rama: `feature/mostrador-patagonico-v1`
HEAD de partida: `425c4aedd9b5d3b418e7949cf1f511c8077368b4` (sin commits nuevos)

## Corridas del repositorio

```text
npm run check      → Release hygiene check passed
npm test           → tests 605 · pass 605 · fail 0 · skipped 0 · todo 0
git diff --check   → sin problemas de espacios ni conflictos
```

### Focales E2E ejecutadas (no se corrieron dos suites completas)

| Suite | Resultado |
|---|---|
| `beverage-storefront.spec.mjs` | 11 passed |
| `commercial-polish.spec.mjs` | 4 passed |
| `approved-beverage-demo.spec.mjs` | 2 passed |
| `la-taba.spec.mjs` | 15 passed |
| `mobile-touch-gesture.spec.mjs` | 2 passed |
| `business-inbox.spec.mjs` | 2 passed |
| `business-catalog.spec.mjs` | 1 passed |
| `business-setup.spec.mjs` | 1 passed |
| `business-reports-cashbox.spec.mjs` | 1 passed |
| `customer-profile.spec.mjs` | 2 passed |
| `customer-delivery.spec.mjs` | 11 passed |
| `showcase.spec.mjs` | 7 passed |
| `showcase-map-lifecycle.spec.mjs` | 1 passed |
| `tracking-arriving.spec.mjs` | 1 passed |
| `tracking-terminal-expiry.spec.mjs` | 2 passed |
| `honest-map.spec.mjs` | 2 passed |
| `delivery-code.spec.mjs` | 1 passed |
| `delivery-proof.spec.mjs` | 1 passed |
| `cancel-confirmation.spec.mjs` | 2 passed |
| `honesty-mode.spec.mjs` | 7 passed |
| `direct-ordering-growth.spec.mjs` | 1 passed |
| `simulation.spec.mjs` | 3 passed |
| `realtime.spec.mjs` | 2 passed |
| `promotions.spec.mjs` | 2 passed |
| `ios-blank-screen.spec.mjs` | 6 passed |
| `sandbox-flow.spec.mjs` | 5 passed |
| `operational-hardening.spec.mjs` | 2 passed |

Cero fallos en todas las focales.

## Capturas y medición automática

```text
node tools/capture.mjs
capturas=12 fallos=0
```

Evidencia de máquina en `capture-results.json`. Por escenario se registran:
errores de consola, `pageerror`, desbordamiento horizontal, objetivos táctiles
por debajo de 44 px, campos por debajo de 16 px y solapes con superficies
sticky medidos al final del scroll.

| Captura | Overflow | Reserva inferior | Primarias visibles | Consola | `pageerror` |
|---|---:|---:|---:|---:|---:|
| `catalog-mobile-320x568` | 0 | 68px | 0 | 0 | 0 |
| `catalog-mobile-390x844` | 0 | 68px | 0 | 0 | 0 |
| `catalog-mobile-cart-390x844` | 0 | 132px | 0 | 0 | 0 |
| `catalog-mobile-empty-390x844` | 0 | 68px | 1 (`Limpiar búsqueda`) | 0 | 0 |
| `catalog-desktop-1280x900` | 0 | 0px | 0 | 0 | 0 |
| `business-mobile-320x700` | 0 | 0px | 0 | 0 | 0 |
| `business-mobile-390x844` | 0 | 0px | 1 (`Aceptar pedido`) | 0 | 0 |
| `business-mobile-order-390x844` | 0 | 0px | 1 (`Aceptar pedido`) | 0 | 0 |
| `business-desktop-1024x768` | 0 | 0px | 1 (`Aceptar pedido`) | 0 | 0 |
| `business-desktop-1280x900` | 0 | 0px | 1 (`Aceptar pedido`) | 0 | 0 |
| `business-desktop-1440x1000` | 0 | 0px | 1 (`Aceptar pedido`) | 0 | 0 |
| `business-desktop-1920x1080` | 0 | 0px | 1 (`Aceptar pedido`) | 0 | 0 |

## Contratos verificados

- **`PREVIEW INTERNA` ausente** de la experiencia cliente: 0 coincidencias en el
  markup, en los estilos y en el texto renderizado de cada captura.
- **Consulta de búsqueda**: aparece sólo en el input y en `No encontramos
  «consulta»`. El título pasa a `Resultados`; no se genera chip de consulta.
- **Ninguna categoría activa** con búsqueda activa (medido: 0 elementos
  `.category-button.active`).
- **Control de orden oculto** con 0 resultados.
- **`Precio a confirmar` no comprable**: la acción queda deshabilitada y con
  rótulo `A confirmar` (`approved-beverage-demo.spec.mjs`).
- **Código de entrega**: el negocio sólo recibe estado de validación. La
  expresión `código … <4+ dígitos>` no aparece en ninguna captura del negocio.
- **Packshot**: relación medida `0.776` del alto útil, `object-fit: contain`,
  sin recorte ni deformación.
- **Precios sobre el pliegue** en 390×844: 2 (umbral ≥ 2).
- **Targets táctiles**: 0 controles por debajo de 44 px en las superficies
  auditadas.
- **Inputs**: 0 campos por debajo de 16 px, también en escritorio.
- **Overflow horizontal**: 0 px en los 12 escenarios.
- **Contenido tapado por superficies sticky**: 0 nodos de texto al final del
  scroll en los 12 escenarios.
- **Una sola acción primaria dominante** en el negocio a 1024, 1280, 1440 y
  1920.

## Límites de esta evidencia

- La corrida usa Chromium local: no sustituye una prueba en dispositivo físico
  para safe area real, teclado abierto, VoiceOver/TalkBack, zoom ni rendimiento.
- No se ejecutaron las dos suites E2E completas: esa certificación queda para la
  fase posterior a la revisión visual.
- Los datos de las capturas del negocio son sintéticos y locales, sembrados por
  la propia herramienta; no hay PII real ni requests a Supabase.
