# Promociones de preview TABA

Fecha: 2026-07-26
Alcance: sólo `?demo=1`; producción no lee este archivo ni el estado sandbox.

`data/preview-promotions.csv` es la fuente de registro comercial. Sus dos filas
actuales son `PROMO_CANDIDATE`: proceden de carteles visibles en fotos, pero no
tienen precio normal, precio promocional, vigencia ni aprobación humana
verificables. Por ello ambas se cargan con `active=false` y no se muestran en
Home, catálogo, producto ni carrito.

Una promoción sólo se puede activar desde Negocio si registra SKU exacto,
tipo, precio o descuento verificable, vigencia, evidencia y referencia de
aprobación humana. El motor centralizado recalcula el descuento desde esos
campos, persiste el resultado en el pedido sandbox y evita promociones
solapadas para el mismo SKU y período.
