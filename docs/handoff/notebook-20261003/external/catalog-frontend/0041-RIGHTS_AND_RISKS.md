# Derechos y riesgos — La Taba

## Regla aplicada

Las imágenes de fabricantes, distribuidores y retailers se trataron como referencias de investigación, nunca como assets autorizados para publicar. No se modificaron etiquetas, fondos o proporciones mediante IA. Cada asset descargado conserva URL, página de origen, fecha de consulta, dimensiones registradas y SHA-256 en `IMAGE_MANIFEST.csv`.

## Clasificación visual

| Estado | Cantidad | Tratamiento |
|---|---:|---|
| `retailer_research_only` | 1 | Fernet Branca 750 ml de Vea/Jumbo; limpio y exacto, pero sin autorización comercial. |
| `rejected` | 15 | Assets de El Lagar o de investigación con manos, fondo ambientado o encuadre que no cumple packshot. |
| `unknown_rights` | 105 candidatos sin asset verificado | No se asigna imagen por similitud de marca o presentación. |
| `official_reusable_candidate` | 0 | No se obtuvo una licencia o indicación explícita de reutilización comercial. |

## Riesgos de precio y disponibilidad

- La inflación, promociones y diferencias de canal pueden cambiar el precio después de la consulta. Los valores se conservan como `review_only`, `possibly_old`, `wholesale_only`, `outlier_review` o `pending`.
- Una etiqueta de mayorista no equivale a precio minorista Neuquén. No mezclar precio por pack con precio por unidad.
- Una ficha sin stock no se elimina del universo de productos reales, pero queda fuera de recomendación activa hasta nueva captura.
- Una carta de bar confirma que una bebida se sirve en Neuquén, no que exista stock empaquetado para entrega retail.
- Los precios de Jacc se excluyeron de comparables retail por ser valores de servicio en local.

## Riesgos de presentación

- Los campos `capacity` y `pack_quantity` quedan `no informado` cuando la fuente no lo expuso.
- No se asumió retornabilidad o descartabilidad en cervezas de 1 L.
- Se diferenciaron unidad, pack x6, pack x8, pack x12 y pack x24 cuando la fuente lo indicaba.
- Los packs mixtos Coca/Sprite/Fanta se mantienen como pack de fuente, pero no se debe inventar su composición interna.

## Riesgos regulatorios y de promoción

- Vinos, cervezas, fernet, gin, vodka y aperitivos requieren control de mayoría de edad y cumplimiento de normativa aplicable antes de activar venta o promoción.
- Las promociones están en `inactive/pending`; no hay acción de activación ni precio público aprobado.
- No se calculó margen porque no hay costo de adquisición, logística, impuestos ni comisiones validados.

## Requisitos antes de publicación

1. Obtener permiso escrito o asset de fabricante/distribuidor con derecho de uso comercial.
2. Verificar que marca, sabor, capacidad, envase, graduación y cantidad de pack coincidan con la ficha.
3. Recapturar precio y stock con destino Neuquén Capital, fecha/hora y canal exactos.
4. Reemplazar las imágenes rechazadas por packshots de fondo blanco sin recorte ni deformación.
5. Revisar legalmente las promociones, mayoría de edad y textos de bebidas alcohólicas.
