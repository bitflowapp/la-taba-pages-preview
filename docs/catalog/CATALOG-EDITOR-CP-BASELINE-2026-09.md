# Editor de catálogo · baseline CP compatible

Este registro establece el primer deployment compatible con las 143 migraciones de
Controlled Production. La publicación del catálogo continúa bloqueada.

## Baseline A

- Merge de [PR #108](https://github.com/bitflowapp/la-taba-pages-preview/pull/108):
  `a010ae414058e35445d38c05191882ca467267a1`.
- [CI canónico del merge](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/36293065734):
  base/pgTAP/restore, web/E2E y Windows, todos PASS. El CI Android del mismo SHA
  también pasó.
- [Deploy CP oficial](https://github.com/bitflowapp/la-taba-pages-preview/actions/runs/36293065706):
  PASS, incluido el smoke público en Chromium, Chrome Android y WebKit.
- El alias `la-taba-commercial-pilot.pages.dev` sirvió exactamente el merge
  anterior. La metadata declaró `catalogMode=none`, cero SKU aprobados y el
  grafo `0363f8cf0f8270c976cb443dd751b59dd09a72c8d13c7a2e5a9de9b74ed5b834`.
- La base CP conservó 46 filas del negocio real, 9 SKU canary dentro de esas
  filas, 46 precios pendientes, 46 stocks `NULL`, 46 imágenes pendientes, 46
  SKU distintos y 0 productos publicados. La consulta anónima devolvió 0.
- La QA autenticada usó el owner del **negocio de control** y una sustitución
  local del ID de negocio en el navegador. Probó navegación, precio, los tres
  estados de stock, un lote de dos filas y rechazo de otro negocio. Las filas
  QA quedaron en su estado original y el negocio de control siguió cerrado.

La identidad owner del negocio real sigue pendiente del correo que Walter usará.
Por eso este registro no afirma que una sesión real haya visto los 46 borradores
en el Panel. No se cargaron precios, conteos ni imágenes reales.

## Ensayo siguiente

Este commit sólo agrega evidencia. El deployment B debe conservar el mismo
grafo de migraciones y ejecutar el rollback B→A→B mediante el workflow oficial,
con smoke después de cada cambio. El deployment anterior a A tenía un grafo
de 140 migraciones y no es un destino compatible para ese ensayo.
