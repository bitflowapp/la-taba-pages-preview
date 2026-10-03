# Prueba de venta real — 20260822-211702-157e19af

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
Resultado .............. FAIL · RIDER_AVISA: LT-0002 no llegó a on_the_way: quedó en picked_up · la aplicación avisa: «Sin conexión. Guardamos 13 puntos del recorrido para enviarlos al volver.» · último intento: no se pudo traer com.lataba.rider

PRODUCTION SALE E2E — FAIL · RIDER_AVISA
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 11365 |
| pedido creado → visible en el Panel | 3 |
| Accepted | 1687 |
| Preparing | 1608 |
| Ready | 2804 |
| oferta → aceptada en el teléfono | 1757 |
| aceptado → retirado | 1689 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.