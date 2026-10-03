# TABA — Propuesta visual premium

Auditoría, sistema de diseño, especificaciones y prototipos para el catálogo del
cliente y el panel del negocio.

**Fecha:** 2026-07-30
**Base auditada:** `C:\1212\la-taba-catalog-checkout-premium` @ `4197bdb`
(`feature/catalog-checkout-premium`, árbol sucio de otro agente)
**Modo:** sólo lectura. **No se modificó ningún archivo del repositorio.**

---

## Documentos

| Archivo | Qué contiene |
|---|---|
| [DESIGN_AUDIT.md](DESIGN_AUDIT.md) | Evidencia medida, problemas visuales vs bugs funcionales, auditoría de código, prioridades |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | Tokens, tipografía, espaciado, bordes, sombras, uso del rojo, estados de conexión, empty states, accesibilidad, breakpoints |
| [BUSINESS_MOBILE_SPEC.md](BUSINESS_MOBILE_SPEC.md) | Home operativa + detalle de pedido |
| [BUSINESS_DESKTOP_SPEC.md](BUSINESS_DESKTOP_SPEC.md) | Master-detail de tres paneles |
| [CATALOG_MOBILE_SPEC.md](CATALOG_MOBILE_SPEC.md) | Encabezado compacto, tarjeta, carrito sticky, empty state, sheet |
| [CATALOG_DESKTOP_SPEC.md](CATALOG_DESKTOP_SPEC.md) | Sidebar de categorías, grilla 3–5 col, carrito lateral |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Seis commits, archivos, pruebas, estimación, fuera de alcance |
| [RISK_REGISTER.md](RISK_REGISTER.md) | Riesgos, mitigaciones, criterio de reversión, limitaciones |

## Prototipos

Estáticos, autocontenidos, con productos y precios reales de TABA.

- `prototype-business-mobile.html`
- `prototype-business-desktop.html`
- `prototype-catalog-mobile.html`
- `prototype-catalog-desktop.html`
- `prototype-shared.css` — el sistema de diseño implementado

Se abren directamente en el navegador (`file://`) o con un servidor estático.

## Capturas

`screenshots/` — las ocho obligatorias más extras:

```
business-mobile-390x844.png     catalog-mobile-320x568.png
business-mobile-430x932.png     catalog-mobile-390x844.png
business-desktop-1280x900.png   catalog-mobile-430x932.png
                                catalog-tablet-768x1024.png
                                catalog-desktop-1280x900.png
```

Cada una tiene su variante `-full.png` (página completa).
Métricas: `screenshots/prototype-metrics.json`.

`screenshots/current/` — estado actual de la app, con
`audit-metrics.json` y `measurements.json`.

## Herramientas

`tools/` — todo reproducible:

| Script | Qué hace |
|---|---|
| `static-server.mjs` | Servidor estático de sólo lectura |
| `capture-current.mjs` | Captura y mide el estado actual |
| `measure-current.mjs` | Medición dirigida (pliegue, recortes, deriva) |
| `capture-prototypes.mjs` | Captura y verifica los prototipos |
| `probe-*.mjs`, `debug-fold.mjs` | Sondas puntuales |
| `dump-catalog.mjs` | Extrae el catálogo real → `catalog-data.json` |

Reproducir:

```sh
node tools/static-server.mjs "C:\1212\la-taba-catalog-checkout-premium" 8791 &
node tools/capture-current.mjs
node tools/static-server.mjs "C:\1212\artifacts\taba-opus-design-review" 8792 &
node tools/capture-prototypes.mjs
```

---

## Resultado en una tabla

| Métrica | Hoy | Propuesto |
|---|---|---|
| Primer precio del catálogo, 390×844 | 798 px | **476 px** |
| Precios visibles sin scrollear, 390×844 | **0** | **2** |
| Precios visibles sin scrollear, 320×568 | **0** | **2** |
| Encabezado del catálogo, 390×844 | 495 px | ~232 px |
| Nav del negocio oculta, 390×844 | **53 %** | **0 %** |
| Pestañas de la bandeja ocultas, 390×844 | **59 %** | **0 %** |
| Resumen operativo del negocio | ~390 px (2×2) | 64 px (1×4) |
| Pedidos visibles en escritorio 1280×900 | **0** | **7** |
| Banda inferior fija, 320×568 | 28 % | 22 % |
| Desborde horizontal | 0 | 0 |
| Controles <44 px | 0 | 0 (con excepciones documentadas) |

---

## Aviso sobre la evidencia

**Las cinco imágenes que el pedido daba por adjuntas nunca llegaron a la
conversación.** No se auditó a ciegas: se generó evidencia propia ejecutando la
app real en los seis breakpoints. Esa evidencia confirma de forma independiente
casi todos los síntomas descritos, y en `DESIGN_AUDIT.md §4` se listan las
sospechas del enunciado que la medición **no** confirmó.
