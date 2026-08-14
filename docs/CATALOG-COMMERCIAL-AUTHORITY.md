# Matriz de autoridad comercial del catálogo

Corte: 2026-08-14. Este documento prepara decisiones comerciales. No activa, importa ni publica datos.

## Alcance

- Fuente base: `catalog/products.csv`, con 92 registros existentes.
- Combos auditados: 7 entidades existentes en `data/combos.csv` y el manifiesto local.
- Total de filas en la matriz: 99.
- No se creó ningún SKU, precio, stock, combo ni imagen.
- Los valores marcados como “demo” son referencias del fixture local, no confirmación comercial.

La matriz completa está en [CATALOG-COMMERCIAL-AUTHORITY.csv](../catalog/CATALOG-COMMERCIAL-AUTHORITY.csv). Expone también `estado`, `ahorro_calculado` y `ahorro_mostrado`.

## Totales por estado

| Estado | Total |
|---|---:|
| READY | 0 |
| NEEDS_PRICE | 61 |
| NEEDS_STOCK | 0 |
| NEEDS_IMAGE | 9 |
| NEEDS_PRESENTATION | 0 |
| NEEDS_COMMERCIAL_APPROVAL | 27 |
| REJECTED_DATA_CONFLICT | 2 |

No se marcó ningún registro READY: las fuentes mantienen derechos, stock o confirmación comercial pendientes. Los 11 productos comprables del demo quedan registrados como disponibles “demo”, no como autorizados para publicar.

## Tipo de producto

| Tipo | Total |
|---|---:|
| INDIVIDUAL | 71 |
| PACK | 12 |
| COMBO | 7 |
| MIXER | 8 |
| COMPLEMENTO | 1 |

PACK y COMBO permanecen separados. Un pack es el mismo producto en múltiples unidades; un combo reúne productos distintos.

## Estado de imágenes

| Estado de imagen | Total |
|---|---:|
| APPROVED | 78 |
| PACK_NEEDS_COMPOSITION | 11 |
| MISSING | 9 |
| WRONG_PRESENTATION | 1 |
| LOW_QUALITY | 0 |

Los 11 casos PACK_NEEDS_COMPOSITION son activos que no comunican honestamente el multipack. Budweiser x6 sí tiene una composición visual del pack; Heineken x6 permanece rechazado porque el activo coincide con la lata individual.

## Prioridad comercial

La prioridad se tomó de la prioridad existente en catálogo y de la relevancia de la misión; no implica alta automática.

- MUST HAVE: Fernet, Coca-Cola, hielo, cerveza adicional, packs reales y conflicto Smirnoff a resolver.
- HIGH VALUE: mixers, energizantes y aperitivos con identidad aprobada.
- NICE TO HAVE: vinos, aguas y otras extensiones no urgentes.

## TOP 20 PARA COMPLETAR LA GÓNDOLA

1. Fernet Branca Edición Mundial — botella 750 ml.
2. Coca-Cola Sabor Original — botella PET 2,25 L.
3. Coca-Cola Sin Azúcar — botella PET 2,25 L.
4. Hielo Cristal — bolsa 4 kg.
5. Quilmes Clásica — lata 710 ml.
6. Patagonia Lager del Sur — botella 730 ml.
7. Heineken — lata 710 ml.
8. Corona Extra — botella 330 ml.
9. Imperial Golden — lata 473 ml.
10. Brahma Chopp — botella retornable 1 L.
11. Amstel Lager — lata 473 ml.
12. Budweiser — lata 473 ml, pack x6.
13. Fernet Vittone — botella 1 L.
14. Smirnoff — botella 700 ml, bloqueado por conflicto 700/750 ml.
15. Schweppes Tónica — lata 354 ml.
16. Gancia — botella 950 ml.
17. Martini Bianco — botella 1 L.
18. Sprite Sin Azúcar — botella PET 2,25 L.
19. Pepsi Black — botella PET 2,25 L.
20. Speed Zero — lata 473 ml.

## READY NOW

No hay candidatos READY para publicación.

Los 11 comprables del demo son: Red Bull Original, Speed Original, Speed Zero, Monster Mango Loco, Heineken 473 ml, Imperial Golden, Imperial Extra Lager, Imperial APA, Imperial Cream Stout, Schneider Rubia y Corona Extra. Sus precio/stock aparecen en la matriz como “demo” porque la autoridad de fuente sigue siendo review_only o con derechos pendientes.

## Fernet

| Producto | Presentación | Imagen | Precio | Stock | Estado | Falta |
|---|---|---|---|---|---|---|
| Brancamenta | Botella 450 ml | Falta / no frontal | — | — | NEEDS_IMAGE | Imagen frontal válida, precio, stock y autoridad |
| Buhero Negro | Botella 450 ml | OK visual | — | — | NEEDS_PRICE | Precio, stock y autoridad |
| Fernet Branca Edición Mundial | Botella 750 ml | OK visual | — | — | NEEDS_PRICE | Precio, stock y autoridad |
| Fernet Vittone | Botella 1 L | OK visual | — | — | NEEDS_PRICE | Precio, stock y autoridad |

No se creó Fernet + Coca: no existe una entidad de combo comercialmente aprobada para publicarla.

## Coca-Cola y mixers

Coca-Cola Original y Coca-Cola Sin Azúcar tienen unidades minoristas de 2,25 L con identidad y frente local verificados, pero falta precio, stock confirmado y autoridad. También existen packs de abastecimiento de Coca-Cola, Sprite, Fanta y Schweppes; están clasificados como PACK y no deben publicarse como unidades minoristas.

No se intercambian imágenes entre presentaciones.

## Hielo

Hielo Cristal, bolsa de 4 kg, existe como COMPLEMENTO con imagen visual aprobada. Falta precio, stock y autorización comercial.

## Vodka y destilados

Smirnoff 700 ml queda en `REJECTED_DATA_CONFLICT`: la imagen disponible declara 750 ml y el SKU declara 700 ml. No se maquilla como NEEDS_IMAGE ni se inventa una corrección.

Tanqueray Dry 700 ml, Bombay Sapphire 750 ml, Bosque Nativo 500 ml y Johnnie Walker Red Label 750 ml tienen candidatos con identidad visual, pero faltan precio, stock y autoridad.

## Cervezas

El catálogo conserva 7 cervezas comprables de demo y candidatos adicionales existentes: Quilmes, Patagonia, Heineken 710 ml, Stella Artois sin alcohol, Corona 330 ml, Imperial Golden 473 ml, Brahma Chopp 1 L y Amstel Lager 473 ml.

La ampliación razonable hacia 10–15 cervezas queda sujeta a completar autoridad. No se inventaron marcas ni presentaciones.

## Packs

- Budweiser 473 ml pack x6: imagen del pack correcta; falta precio, stock y aprobación comercial.
- Heineken 473 ml pack x6: REJECTED_DATA_CONFLICT; el activo coincide con la lata individual y no verifica el pack.
- Coca-Cola, Sprite, Fanta, Schweppes y Red Bull: packs existentes de abastecimiento/review_only; requieren autoridad de venta minorista y composición visual apropiada.

## Combos existentes y ahorro

Los siete combos configurados se clasifican como COMBO y no como PACK. El ahorro se calcula como:

`sumatoria de precios individuales - precio promocional`

| Combo | Precio combo | Ahorro calculado | Ahorro mostrado |
|---|---:|---:|---:|
| Previa Imperial | ARS 15.800 | ARS 2.200 | ARS 2.200 |
| Heineken x6 | ARS 21.000 | ARS 2.400 | ARS 2.400 |
| Corona Extra x6 | ARS 19.400 | ARS 2.200 | ARS 2.200 |
| Birra y energía | ARS 15.700 | ARS 2.150 | ARS 2.150 |
| Tabla de cervezas | ARS 17.100 | ARS 2.000 | ARS 2.000 |
| Noche larga | ARS 20.000 | ARS 2.752 | ARS 2.752 |
| Cuatro para arrancar | ARS 10.500 | ARS 1.200 | ARS 1.200 |

La cuenta coincide en todos los combos auditados. No se agregó ningún ahorro independiente ni se creó Fernet + Coca.

## BLOCKED

Las causas precisas están por fila en el CSV. Las principales son:

- Falta precio confirmado por Walter: 61 filas.
- Falta imagen frontal válida: 9 filas.
- Falta autoridad comercial/publicación o derechos/stock de fuente: 27 filas.
- Smirnoff 700 ml: conflicto de imagen 750 ml contra SKU 700 ml.
- Heineken x6: no hay pack verificable y el activo coincide con la lata individual.
