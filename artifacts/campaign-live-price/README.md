# Campañas con marca y precio vivos del producto — evidencia

Rama `claude/caja-clara-premium-ui-960ncr`, apilada sobre `feat/taba-frontend-commercial-polish` (PR #131, `737371b`).
**Nada de esto está desplegado.** Las campañas siguen apagadas en `js/campaigns/campaign-config.js`
(`enabled: false`, aprobación `PENDIENTE`); las capturas las encienden sólo en la página de prueba con
`useQaCampaigns`, como las pruebas E2E.

## Cómo se generaron

- Las 46 fichas reales (`tests/fixtures/catalog-cp-46.json`) servidas por el backend en memoria de las E2E
  (`catalog-runtime-fixture.mjs`), modo producción, con las fotografías aprobadas por huella.
- Precios de prueba distintos por producto (Heineken $ 3.290, Red Bull $ 2.890, Coca-Cola $ 4.150,
  Aperol $ 13.990). **No son precios del local**: sirven para comprobar que la pieza dice el de la tarjeta.
- `antes/` sirve la base `737371b`; `despues/` sirve esta rama. Mismo navegador, mismo script y mismos datos.
- Cuadro final con movimiento reducido (`*-hero`, `*-inline`, `*-home`); `*-cuadros` son 16 cuadros de la
  escena con movimiento, cada ~380 ms, a 390 × 844 y 1366 × 768.

## Qué mirar

| Archivo | Antes | Después |
|---|---|---|
| `390x844-hero` / `360x800-hero` / `320x640-hero` | Título y «Ver Heineken»; ni producto ni precio | El precio de la tarjeta en el renglón de la acción, sin agregar un píxel de alto |
| `390x844-hero-cuadros` | La acción llega al 74–92 % (4,1–5,2 s) | Precio y acción llegan al 28–44 %, mientras se sirve |
| `1366x768-hero` / `1366x900-hero` | Rótulo escrito en la campaña | Rótulo = marca del producto; precio junto al botón |
| `360x800-inline` | Subtítulo partido en «·» al final de renglón | Cada dato entero («· 355 ml · Lata»), precio y acción |

La altura de la banda de apertura es la misma antes y después en 320, 360, 390 y 430 px y en 1366 × 768:
lo comprueba `tests/e2e/campaigns.spec.mjs` («la campaña ocupa la banda de apertura sin mover el primer
precio ni desbordar»).

## Qué comprueba que el dato es el real

`PROMO_PRODUCT_MATCHES_CATALOG` (en `tests/e2e/campaigns.spec.mjs`): por cada pieza (grilla, banda y franja)
compara contra las filas del backend la marca, el nombre y la presentación (contra la tarjeta), el precio
(contra el catálogo, la tarjeta, la ficha y el carrito), la foto (misma miniatura y original por huella)
y el stock. Después cambia el precio por Realtime (la pieza lo sigue en el mismo nodo, sin reiniciar la
escena) y corta el stock (la pieza se va; con ninguna campaña comprable vuelve la puerta editorial).
Una mutación que corre el precio de la pieza en $ 10 la pone en rojo.
