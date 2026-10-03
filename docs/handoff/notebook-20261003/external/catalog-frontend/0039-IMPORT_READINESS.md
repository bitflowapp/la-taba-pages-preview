# Preparación para importación — La Taba

## Estado general

`RESEARCH_ONLY — NOT READY TO IMPORT`

Los archivos están listos para revisión comercial y no para carga automática en producción. No se tocó código, repositorio, rama, Supabase ni producción.

## Checklist de campos

| Campo | Estado | Nota |
|---|---|---|
| SKU candidato | listo | `LT-CAN-001` a `LT-CAN-120`, únicos. No reemplazan SKU técnico definitivo. |
| Marca/nombre exacto | parcial | Alto en fichas Vea/El Lagar; bajo cuando la fuente agrupa sabores o no separa producto. |
| Categoría | listo | 15 categorías requeridas cubiertas. |
| Presentación/capacidad | parcial | `no informado` se preserva; no se inventaron capacidades. |
| Unidad/pack/cantidad | listo con revisión | Se distinguen unit, pack x6, x8, x12 y x24; revisar composición de packs mixtos. |
| ABV | parcial | Solo se registra cuando la fuente lo informa; falta completar varias bebidas alcohólicas. |
| Precio | no aprobado | Hay 73 observaciones de precio; todas son candidatas o señales, no precios publicados. |
| Stock | parcial | Señales de disponibilidad y falta de stock; requiere captura por zona/canal. |
| Imagen | no listo | 1 asset solo para investigación visual; 15 rechazados; 105 candidatos sin asset verificado. |
| Derechos | no listo | No hay `official_reusable_candidate`. Requiere permiso o asset licenciado. |
| Regionalidad Neuquén | parcial | Mabellini tiene evidencia fuerte; gins/cervezas regionales requieren ficha de productor. |
| Promociones | no listo | 13 filas `inactive/pending`; margen desconocido y precios parcialmente pendientes. |

## Validaciones realizadas

- Parseo de los siete CSV principales sin errores.
- 120 filas de catálogo y 120 SKU únicos.
- 78 filas de fuentes de precio.
- 13 promociones, todas con estado inactivo/pendiente.
- 12 leads/productos regionales.
- 20 registros de rechazo o incertidumbre.
- Sin URLs con espacios en los CSV.
- Sin packs con cantidad menor a 2.
- Sin uso de secretos, datos personales, credenciales o identificadores internos de La Taba.

## Próxima pasada recomendada

1. Capturar precios y disponibilidad con destino real de Neuquén Capital en 2 o 3 canales comparables.
2. Solicitar a proveedores regionales las fichas de producto, ABV, presentación, logística y derechos de imagen.
3. Separar definitivamente los SKU mixtos y confirmar envases retornables/descartables.
4. Reemplazar imágenes rechazadas con packshots autorizados y medir dimensiones reales.
5. Recalcular medianas, diferencias y precios candidatos solo sobre fuentes comparables y vigentes.
6. Revisar mayoría de edad y normativa antes de cualquier activación comercial.
