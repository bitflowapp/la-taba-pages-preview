# La Taba — Red Design Mobile V2

Fecha de validación: 2026-08-02  
Repositorio: `C:\1212\la-taba-redesign-rojo`  
Rama: `feature/la-taba-redesign-rojo`

## Resultado

- Home reconstruido con fondo carbón, header negro en dos franjas, wordmark proporcionado, hero rojo compuesto con assets canónicos, buscador integrado, promociones editoriales honestas, categorías oscuras, tarjetas blancas, beneficios y navegación inferior negra de cinco tabs.
- Capturas realizadas en modo demo local (`?demo=1`), con service worker bloqueado. No se usó Supabase, staging ni producción.
- No se creó commit ni se ejecutaron push, merge, reset, restore, stash, clean o deploy.

## Checks

- `npm run check`: PASS — release hygiene incluido.
- `npm test`: PASS — 636/636 tests.
- `git diff --check`: PASS.
- Playwright mobile/IOS focalizado: PASS — 24/24 (`mobile-touch-gesture`, `ios-autozoom-safety`, `ios-phantom-scroll`).

## Matriz física aproximada

| Viewport | Overflow X | Dirección truncada | Header/hero overlap | Input | Tabs móviles | Reserva final |
|---|---:|---:|---:|---:|---:|---:|
| 320×568 | no | no | 0 px | 16 px | 5 | 28.25 px |
| 360×800 | no | no | 0 px | 16 px | 5 | 28.36 px |
| 390×844 | no | no | 0 px | 16 px | 5 | 28.22 px |
| 430×932 | no | no | 0 px | 16 px | 5 | 27.70 px |
| 768×1024 | no | no | 0 px | 16 px | 5 | 28.00 px |
| 1280×900 | no | no | 0 px | 16 px | desktop | n/a |

La reserva final es la distancia entre el CTA final y el primer overlay fijo. El scroll llegó exactamente a su máximo en todos los viewports.

## Evidencia

Cada viewport incluye tres capturas:

- `home-{viewport}.png`: composición superior.
- `home-products-{viewport}.png`: categorías y tarjetas.
- `home-bottom-{viewport}.png`: final del scroll, beneficios, CTA y navegación.

Viewports: `320x568`, `360x800`, `390x844`, `430x932`, `768x1024`, `1280x900`.

## Veredicto

`LA_TABA_RED_DESIGN_MOBILE_V2_READY_FOR_PHYSICAL_REVIEW`
