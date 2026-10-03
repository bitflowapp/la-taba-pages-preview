# Prueba de venta real — 20260822-220452-8d02a965

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
Resultado .............. FAIL · SEGUIMIENTO_OCUPADO: el teléfono está publicando el recorrido de LT-0001 y la aplicación admite UNA entrega por vez, así que LT-0002 no puede iniciar el suyo. No es el botón ni el GPS: es `delivery_already_active`, que se

PRODUCTION SALE E2E — FAIL · SEGUIMIENTO_OCUPADO
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 11420 |
| pedido creado → visible en el Panel | 3 |
| Accepted | 1584 |
| Preparing | 1633 |
| Ready | 1618 |
| oferta → aceptada en el teléfono | 1612 |
| aceptado → retirado | 1585 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.