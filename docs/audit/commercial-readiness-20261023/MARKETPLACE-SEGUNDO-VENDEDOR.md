# Marketplace con un segundo vendedor de prueba: escenario preparado

24/10/2026. Complementa [`VERIFICACION-MARKETPLACE.md`](../mercadopago-final-20261023/lanzamiento/VERIFICACION-MARKETPLACE.md), que explica por qué hace falta (R-MKT-1/2/3: hoy el vendedor de QA es también el dueño de la integradora, así que Mercado Pago marca `marketplace: NONE` y el `user_id` del webhook no distingue vendedor de dueño).

## Qué quedó hecho

| Paso | Estado |
|---|---|
| Diagnóstico de sólo lectura (`qa-mp-marketplace.mjs preflight`) | dueño de la integradora TestApp `4861627125869370` = usuario de prueba ✔; comercio QA B existe, cerrado, aislado ✔; credenciales del comprador y del dueño B ✔ |
| **G2** — comercio QA B habilitado para vender UN producto sintético (`QA-MKT-001`, ARS 100, stock 5) | **hecho el 24/10** (sólo QA; el comercio sigue cerrado fuera de las ventanas de QA) |
| Diagnóstico después | **sin bloqueos técnicos**: sólo quedan los pasos con cuenta y dinero ficticio (`despliegue-qa/marketplace-preflight-despues.json`) |

## La única acción que requiere autorización personal

**G1 — crear UNA cuenta de prueba tipo *Vendedor*** en TestApp-ae01fd1d → *Cuentas de prueba*, con la sesión de Developers del vendedor de prueba `3594962708`. Es irreversible (las cuentas de prueba no se borran; límite 15). Guardar su usuario y clave en el Administrador de credenciales como `TABA2 E2E:RECOVERY MP TEST SELLER B` (JSON `id`, `nickname`, `password`, `siteId`, `profile`), nunca por chat.

## Después de G1 (dinero ficticio)

El consentimiento del vendedor B (G3) y la compra APRO con la tarjeta de prueba oficial (G4) los hace **una persona en su propio navegador**: la herramienta arma los enlaces y verifica en el servidor, nunca tipea credenciales de Mercado Pago ni datos de tarjeta.

```
node scripts/recovery/qa-mp-marketplace.mjs preflight --seller <id B>         # sin bloqueos
node scripts/recovery/qa-mp-e2e.mjs connect-url --tenant b                    # el vendedor B consiente (G3, ventana aislada)
node scripts/recovery/qa-mp-e2e.mjs verify --tenant b                         # integrator_environment_matches: true
node scripts/recovery/qa-mp-e2e.mjs window-open --tenant b
node scripts/recovery/qa-mp-e2e.mjs checkout --tenant b --sku QA-MKT-001 --scenario APRO    # compra APRO de ARS 100 (G4)
node scripts/recovery/qa-mp-e2e.mjs worker                                    # dos pasadas
node scripts/recovery/qa-mp-marketplace.mjs verify --session <id> --seller <id B>
node scripts/recovery/qa-mp-e2e.mjs window-close --tenant b
```

`verify` aprueba si: la preferencia es `MP-MKT-4861627125869370` con `collector_id` = B; el pago lo cobra B; **el webhook firmado se rutea al comercio B (R-MKT-1)**; el vendedor A no puede leer ni buscar el pago (R-MKT-3); un pedido y un descuento de stock, sólo en B; cero discrepancias.

## Si no se autoriza G1

El primer cobro real de control de Walter (`LANZAMIENTO.md` §5) es el mismo experimento con dinero real (integrador ≠ vendedor) y se mira en este orden: respuesta del webhook 201, recibo ruteado al comercio, pedido único. Si el webhook respondiera 503, el dinero no se pierde (el barrido de verdad del proveedor lee el pago con el token del vendedor; en la prueba APRO el pedido quedó completo 9 s después del pago) pero el comercio no sigue abriendo hasta corregirlo.
