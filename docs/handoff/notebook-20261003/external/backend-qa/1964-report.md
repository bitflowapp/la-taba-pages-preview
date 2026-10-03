# Prueba de venta real — 20260822-200128-33bad4c7

Modo: **AUTOMÁTICO — VENTA REAL**

```text
TABA PRODUCTION SALE E2E

Precheck ............... PASS · CASO_4_REANUDACION · venta
Business auth .......... PASS · sesión guardada reutilizada
Customer auth .......... PASS · sesión guardada reutilizada
Reception .............. SKIP · CASO_4_REANUDACION: el stock ya estaba cargado, no se recibe de nuevo
Publication ............ SKIP · CASO_4_REANUDACION: ya estaba publicado
Customer cart .......... SKIP · reanudación de LT-0002: la compra ya había ocurrido
Checkout ............... SKIP · reanudación de LT-0002: la compra ya había ocurrido
Order created .......... PASS · LT-0002 · $4990.00 · reanudado desde «picked_up»
Business intake ........ PASS · LT-0002 visible en 3 ms
Accepted ............... PASS · accepted
Preparing .............. PASS · preparing
Ready .................. PASS · ready
Rider offered .......... PASS · el pedido ya tiene repartidor asignado
Rider accepted ......... PASS
Picked up .............. PASS · picked_up
Resultado .............. FAIL · EXCEPCION: Command failed: adb -s ZY32LHS6PS shell uiautomator dump /sdcard/taba-e2e-ui.xml

PRODUCTION SALE E2E — FAIL · EXCEPCION
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 10767 |
| pedido creado → visible en el Panel | 3 |
| Accepted | 1613 |
| Preparing | 1793 |
| Ready | 1657 |
| oferta → aceptada en el teléfono | 1673 |
| aceptado → retirado | 1595 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.