# Prueba de venta real — 20260822-212252-9a9c5b87

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
Business intake ........ PASS · LT-0002 visible en 2 ms
Accepted ............... PASS · accepted
Preparing .............. PASS · preparing
Ready .................. PASS · ready
Rider offered .......... PASS · el pedido ya tiene repartidor asignado
Rider accepted ......... PASS
Picked up .............. PASS · picked_up
Resultado .............. FAIL · RIDER_AVISA: LT-0002 no llegó a on_the_way: quedó en picked_up · la aplicación avisa: «La entrega no se inició. No pudimos iniciar la entrega. Intentá nuevamente. La entrega no se inició No pudimos iniciar la entr

PRODUCTION SALE E2E — FAIL · RIDER_AVISA
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 11342 |
| pedido creado → visible en el Panel | 2 |
| Accepted | 1866 |
| Preparing | 1635 |
| Ready | 1584 |
| oferta → aceptada en el teléfono | 1737 |
| aceptado → retirado | 1648 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.