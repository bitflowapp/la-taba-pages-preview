# Prueba de venta real — 20260822-191256-52dd8ea6

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
Rider offered .......... PASS · ya estaba ofrecido (oferta pendiente): no se ofrece de nuevo
Resultado .............. FAIL · RIDER_NO_ACEPTA: el teléfono no tomó LT-0002

PRODUCTION SALE E2E — FAIL · RIDER_NO_ACEPTA
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 12178 |
| pedido creado → visible en el Panel | 3 |
| Accepted | 1642 |
| Preparing | 1948 |
| Ready | 1599 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.