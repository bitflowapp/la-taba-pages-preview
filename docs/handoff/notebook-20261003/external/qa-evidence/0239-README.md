# TABA — Rediseño integral y plan de migración del rider Android

**Fecha:** 2026-07-31
**Naturaleza:** propuesta de diseño. **Nada de esto está implementado.**

## Estado del repositorio

El worktree `C:\1212\la-taba-catalog-checkout-premium` (rama `feature/catalog-checkout-premium`, HEAD `4197bdb`) **no fue modificado**. Sólo se realizaron operaciones de lectura, búsqueda y `git status`. No hay commits, ni push, ni merge, ni deploy. Todos los artefactos viven exclusivamente en este directorio.

**La aplicación Android del rider no existe.** Esta entrega la especifica; no la crea.

## Por dónde empezar

| Si querés… | Leé |
|---|---|
| Ver el impacto de un vistazo | `screenshots/BEFORE_AFTER_BOARD.png` |
| Entender qué está roto y por qué | `audit/DESIGN_AUDIT.md` |
| Saber por qué se eligió esta dirección visual | `design-system/DESIGN_DIRECTION.md` |
| Tocar los prototipos | `prototypes/*.html` — abrir en el navegador |
| Empezar a implementar | `implementation/IMPLEMENTATION_PLAN.md` y `implementation/FILE_CHANGE_MAP.md` |
| Planificar el rider | `rider-android/RIDER_ANDROID_MIGRATION_PLAN.md` |

## Contenido

```
2026-07-31/
├── README.md
├── audit/
│   ├── DESIGN_AUDIT.md              28 hallazgos P0–P3 + 4 bugs probables
│   ├── COMPONENT_INVENTORY.md       inventario técnico con riesgo y refactor
│   └── CSS_RISK_MAP.md              12 riesgos estructurales del CSS
├── design-system/
│   ├── DESIGN_DIRECTION.md          dos direcciones comparadas, una elegida
│   ├── TOKENS.md                    tokens con contrastes calculados
│   ├── TOKENS.json                  formato de intercambio + auditoría de 19 pares
│   ├── taba-tokens.css              implementación de referencia
│   ├── COMPONENT_RULES.md           reglas por componente
│   ├── ACCESSIBILITY.md             requisitos exigibles y plan de verificación
│   └── CROSS_PRODUCT_CONSISTENCY.md qué se comparte y qué no; vocabulario único
├── business/
│   ├── BUSINESS_MOBILE_SPEC.md
│   └── BUSINESS_DESKTOP_SPEC.md
├── catalog/
│   ├── CATALOG_MOBILE_SPEC.md
│   └── CATALOG_DESKTOP_SPEC.md
├── rider-android/                   14 documentos
├── prototypes/                      5 prototipos HTML/CSS navegables + CSS compartido
├── screenshots/                     39 capturas + tablero antes/después + 5 originales
├── assets/                          22 packshots reales + ASSET_SOURCES.md
├── implementation/                  8 documentos de plan
└── diagnostics/                     scripts de validación + resultados
```

## Prototipos

Se abren directamente en el navegador. Cada uno trae una barra de control para cambiar de estado.

| Archivo | Estados |
|---|---|
| `prototype-catalog-mobile.html` | con productos · carrito con productos · búsqueda · categoría vacía · producto pendiente · detalle · cargando · vista Inicio |
| `prototype-catalog-desktop.html` | carrito vacío · carrito con productos · búsqueda · categoría vacía · producto pendiente · detalle · cargando |
| `prototype-business-mobile.html` | pedidos nuevos · en preparación · sin pedidos · detalle · sin conexión · sincronizando · sección Local |
| `prototype-business-desktop.html` | pedidos nuevos · en preparación · sin pedidos · sin conexión · sincronizando |
| `prototype-rider-android.html` | 14 pantallas navegables del flujo completo |

Parámetros de URL para capturas deterministas: `?state=empty&view=catalog&chrome=0`, `?screen=ontheway&chrome=0`.

**Datos reales.** Los 22 productos, sus presentaciones y sus precios salen del catálogo de TABA. Incluye el caso real de producto sin precio (Red Bull Pack x4). No se inventaron precios, descuentos, popularidad, stock, urgencia ni reseñas. Los datos de pedidos y clientes son sintéticos, sin PII.

## Validación

39 capturas, 5 prototipos validados: **0 errores de consola · 0 desbordamiento · 0 objetivos táctiles por debajo de 44px · 0 inputs por debajo de 16px · 0 contenido tapado por el stack inferior · 0 pares de texto por debajo de AA**.

Detalle y reproducción en `diagnostics/PROTOTYPE_VALIDATION.md`.

## Los tres hallazgos que más importan

1. **P0-01 · La reserva de espacio inferior está calculada con un token que no resuelve.** `--taba-floating-cart-reserve` se declara en `:root` y por eso ignora los overrides de scope: el contenido reserva menos de lo que ocupa el stack, y la barra de carrito tapa el último precio. Hay además cuatro valores contradictorios para la altura de la nav (104 / 76 / 70 / 82px) cuando la real medida es 68px.
2. **P0-02 · El control de cantidad se superpone al nombre del producto.** `bottom: 136px` es un número mágico derivado de las filas fijas de la tarjeta. Ocurre justo en el estado más importante: el producto ya agregado.
3. **P1-06 · “Todos / 0 productos / carrito con 4” no es un bug.** La lógica de filtros y el estado vacío funcionan correctamente. Es un problema de arquitectura de información: el título nunca refleja la búsqueda activa, el chip de categoría sigue marcado, y el estado vacío no nombra la consulta ni ofrece limpiarla.

## Qué necesita decisión humana

- Aprobación de la dirección visual sobre los prototipos.
- Prueba en iPhone y Android **físicos** — la emulación devuelve `safe-area = 0` y no prueba nada.
- Cómo distinguir los dos “Speed Unlimited” que hoy se muestran idénticos.
- Alcance de la v1 del rider.
- Coordinación con el trabajo sin commitear que hay en el árbol antes de tocar nada.
