# Preparación comercial de la vitrina Neuquén

Generado por `scripts/catalog-commercial-readiness.mjs` el 2026-10-25. No modifica ningún dato comercial.

> **Ningún producto está «listo para vender».** La vitrina es demostrativa: el dueño todavía no aprobó los precios por SKU, el stock está sin confirmar y falta el documento del acuerdo que respalda las fotos. Este informe separa lo técnicamente completo de lo que espera una decisión.

## Resumen

| | |
|---|---|
| SKU evaluados | 52 |
| Completos con foto autorizada (declarada) | 42 |
| Completos sin foto (placeholder propio) | 10 |
| Incompletos / defectuosos | 0 |
| Precio: mantiene vigente / conflicto de margen / pendiente de comparación | 32 / 14 / 6 |
| Costo derivado (no medido) | 2 |
| Antigüedad del costo mayorista | 68 días |
| Productos con alcohol (+18) | 23 |
| Aprobación comercial pendiente | 52 de 52 |

## Qué tiene que decidir o aportar el responsable del negocio

1. **Aprobar precios por SKU.** Los 14 «conflicto de margen» y los 6 «pendiente de comparación» **no se tocaron**: los precios vigentes se conservan tal cual.
2. **Confirmar stock** de los 52 (hoy `BUSINESS_CONFIRMATION_REQUIRED`).
3. **Documentar el acuerdo de fotos** (`TABA-AUT-2026-08-001` y sus ampliaciones están «declaradas»; falta el documento o el paquete de packshots de cada marca).
4. **Aportar o aprobar fotos** de los SKU sin foto, o aceptar el placeholder propio.
5. **Fotografía editorial** (banners, hero, historias): 18 piezas de terceros sin autorización comercial documentada. En producción no se publican hasta que se completen en `docs/catalog/promo-rights.json` y `js/core/promo-rights.js`.

## Detalle por SKU

| SKU | Presentación | Estado | Foto | Precio vigente | Propuesta | Pendientes |
|---|---|---|---|---:|---|---|
| `coca-cola-original-2250ml` | 2250 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 5.900 | conflicto_margen | 4 |
| `coca-cola-zero-2250ml` | 2250 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 5.900 | conflicto_margen | 4 |
| `coca-cola-original-lata-354ml` | 354 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 1.800 | mantiene_vigente | 3 |
| `coca-cola-zero-lata-354ml` | 354 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 1.800 | conflicto_margen | 4 |
| `sprite-original-2250ml` | 2250 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 5.900 | conflicto_margen | 4 |
| `sprite-zero-2250ml` | 2250 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 5.900 | conflicto_margen | 5 |
| `sprite-original-lata-354ml` | 354 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 1.800 | conflicto_margen | 4 |
| `fanta-naranja-2250ml` | 2250 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 5.900 | conflicto_margen | 4 |
| `pepsi-original-2000ml` | 2000 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 3.800 | conflicto_margen | 4 |
| `pepsi-black-1500ml` | 1500 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.650 | mantiene_vigente | 3 |
| `seven-up-original-2000ml` | 2000 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 3.800 | mantiene_vigente | 3 |
| `paso-de-los-toros-tonica-1500ml` | 1500 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 3.250 | mantiene_vigente | 3 |
| `paso-de-los-toros-pomelo-1500ml` | 1500 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 3.250 | conflicto_margen | 4 |
| `soda-manaos-sifon-2000ml` | 2000 ml · sifon | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 1.750 | pendiente_sin_comparador | 4 |
| `villa-del-sur-sin-gas-600ml` | 600 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 1.700 | mantiene_vigente | 3 |
| `villavicencio-sin-gas-1500ml` | 1500 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.400 | mantiene_vigente | 3 |
| `villavicencio-con-gas-500ml` | 500 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 1.900 | mantiene_vigente | 4 |
| `benedictino-sin-gas-2250ml` | 2250 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.250 | mantiene_vigente | 3 |
| `aquarius-pera-1500ml` | 1500 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 1.800 | mantiene_vigente | 3 |
| `aquarius-manzana-1500ml` | 1500 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 1.800 | mantiene_vigente | 3 |
| `aquarius-pomelo-2250ml` | 2250 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.650 | mantiene_vigente | 3 |
| `red-bull-original-250ml` | 250 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.800 | mantiene_vigente | 3 |
| `red-bull-sin-azucar-250ml` | 250 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.800 | conflicto_margen | 4 |
| `monster-green-zero-473ml` | 473 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 3.250 | mantiene_vigente | 3 |
| `speed-original-473ml` | 473 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.850 | mantiene_vigente | 3 |
| `speed-zero-473ml` | 473 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.850 | mantiene_vigente | 3 |
| `gatorade-cool-blue-500ml` | 500 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.000 | mantiene_vigente | 3 |
| `gatorade-manzana-1250ml` | 1250 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.650 | mantiene_vigente | 3 |
| `powerade-mountain-blast-500ml` | 500 ml · botella-pet | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 1.450 | mantiene_vigente | 3 |
| `quilmes-clasica-lata-473ml` | 473 ml · lata | COMPLETO_SIN_FOTO | SIN_FOTO | $ 2.050 | pendiente_sin_comparador | 4 |
| `quilmes-clasica-lata-473ml-pack-6` | 473 ml · lata · pack x6 | COMPLETO_SIN_FOTO | SIN_FOTO | $ 11.400 | pendiente_sin_comparador | 4 |
| `quilmes-clasica-botella-710ml` | 710 ml · botella | COMPLETO_SIN_FOTO | SIN_FOTO | $ 3.000 | conflicto_margen | 4 |
| `quilmes-stout-lata-473ml` | 473 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.050 | pendiente_sin_comparador | 4 |
| `brahma-chopp-lata-710ml` | 710 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 3.000 | mantiene_vigente | 3 |
| `budweiser-lata-473ml` | 473 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.350 | mantiene_vigente | 3 |
| `stella-artois-lata-473ml` | 473 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 3.600 | conflicto_margen | 4 |
| `corona-extra-botella-330ml` | 330 ml · botella | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 3.400 | mantiene_vigente | 3 |
| `andes-origen-rubia-lata-473ml` | 473 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.650 | mantiene_vigente | 3 |
| `andes-origen-roja-lata-473ml` | 473 ml · lata | COMPLETO_SIN_FOTO | SIN_FOTO | $ 2.650 | mantiene_vigente | 3 |
| `patagonia-amber-lager-botella-730ml` | 730 ml · botella | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 5.300 | mantiene_vigente | 3 |
| `fernet-branca-1000ml` | 1000 ml · botella | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 26.250 | pendiente_sin_comparador | 4 |
| `fernet-1882-750ml` | 750 ml · botella | COMPLETO_SIN_FOTO | SIN_FOTO | $ 8.950 | mantiene_vigente | 3 |
| `gancia-americano-450ml` | 450 ml · botella | COMPLETO_SIN_FOTO | SIN_FOTO | $ 4.350 | mantiene_vigente | 3 |
| `gancia-lima-limon-lata-473ml` | 473 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.550 | mantiene_vigente | 3 |
| `dr-lemon-vodka-pomelo-lata-473ml` | 473 ml · lata | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 2.200 | mantiene_vigente | 3 |
| `trapiche-origen-malbec-750ml` | 750 ml · botella | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 6.150 | mantiene_vigente | 3 |
| `dada-caramel-750ml` | 750 ml · botella | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 5.900 | mantiene_vigente | 3 |
| `cafayate-torrontes-750ml` | 750 ml · botella | COMPLETO_SIN_FOTO | SIN_FOTO | $ 5.400 | mantiene_vigente | 3 |
| `toro-viejo-clasico-tinto-750ml` | 750 ml · botella | COMPLETO_SIN_FOTO | SIN_FOTO | $ 2.550 | pendiente_coincidencia_parcial | 4 |
| `toro-tinto-1000ml` | 1000 ml · botella | COMPLETO_SIN_FOTO | SIN_FOTO | $ 2.300 | mantiene_vigente | 3 |
| `gin-gordons-700ml` | 700 ml · botella | COMPLETO_CON_FOTO | AUTORIZADA_DECLARADA | $ 16.800 | conflicto_margen | 4 |
| `vodka-skyy-700ml` | 700 ml · botella | COMPLETO_SIN_FOTO | SIN_FOTO | $ 9.500 | conflicto_margen | 4 |
