# Reporte de lote comercial de preview TABA

Fecha: 2026-07-26
Rama: `feat/taba-production-beverages`
Alcance: catalogo aislado de preview (`?demo=1`).

## Resultado

- Productos concretos procesados: **14**.
- Identidades `EXACTA`: **14**.
- Identidades `PARCIAL`: **0**.
- Masters WebP: **14**, 1000 x 1000.
- Miniaturas WebP: **14**, 400 x 400.
- Assets integrados en preview: **14**.
- Productos con fallback neutro: **2**.

Los cuatro assets nuevos son Heineken Original 473 ml, Imperial Extra Lager 473 ml, Villavicencio Sin Gas 500 ml y Corona Extra 355 ml pack x12. Cada uno fue descargado desde la URL registrada, cotejado por SHA-256 y normalizado en fondo blanco sRGB, con proporcion preservada.

Las ocho fuentes originales permanecen `APROBADOS`. Las cuatro nuevas tienen identidad exacta pero `rights_status=PENDIENTE_DERECHOS`: la procedencia publica esta auditada, sin pretender una licencia comercial inexistente. Produccion sigue fail-closed y no consume este catalogo.
