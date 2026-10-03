# Hoja de implementación para Codex

## Entrada autorizada

Usar exclusivamente:

- `catalog-demo.json`
- `approved-demo/`

No importar `pending/` ni `unresolved/`.

## Reglas

1. Respetar el SKU exacto y no convertir packs en unidades.
2. Mostrar `display_label` (`Unidad`, `Pack x4`, `Pack x6`, `Pack x12`).
3. No inferir precio cuando `demo_price_ars` sea `null`.
4. Mantener `requires_business_confirmation` hasta que el negocio confirme precio y stock.
5. Aplicar confirmación de mayoría de edad cuando `requires_age_confirmation` sea `true`.
6. No duplicar imágenes si dos ofertas comparten `shared_asset_group`; la diferencia comercial está en `offer`.
7. No crear promociones a partir de precios tachados o referencias externas.
8. Las imágenes son `RETAILER_SOLO_REFERENCIA`; restringirlas a demo hasta reemplazo autorizado.

## Integración sugerida en TABA

- Copiar las rutas relativas de `image` y `thumbnail` sin renombrar SKU.
- Mapear `category`, `subcategory`, `offer`, `demo_price_ars`, `recommendation_tags` y `complementary_categories`.
- Mantener el catálogo actual intacto hasta validar la importación en entorno demo.
- Ejecutar las validaciones existentes del proyecto, especialmente `catalog:validate`, `catalog:images:verify` y `catalog:release:validate` si están disponibles.

## Conteo

- Productos aprobados: 22
- Productos pendientes: 121
- Registros no resueltos: 35
