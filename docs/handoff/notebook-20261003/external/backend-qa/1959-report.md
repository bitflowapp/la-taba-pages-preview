# Prueba de venta real — 20260822-192940-1e578e93

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
Order created .......... PASS · LT-0002 · $4990.00 · reanudado desde «ready»
Business intake ........ PASS · LT-0002 visible en 3 ms
Accepted ............... PASS · accepted
Preparing .............. PASS · preparing
Ready .................. PASS · ready
Rider offered .......... PASS
Rider accepted ......... PASS
Resultado .............. FAIL · RIDER_NO_AVANZA: LT-0002 no llegó a picked_up/on_the_way: quedó en assigned

PRODUCTION SALE E2E — FAIL · RIDER_NO_AVANZA
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 10971 |
| pedido creado → visible en el Panel | 3 |
| Accepted | 1866 |
| Preparing | 1727 |
| Ready | 1772 |
| listo → oferta al repartidor | 16724 |
| oferta → aceptada en el teléfono | 20416 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.