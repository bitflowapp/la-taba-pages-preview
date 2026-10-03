# Prueba de venta real — 20260822-190838-07195df3

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
Order created .......... PASS · LT-0002 · $4990.00 · reanudado desde «received»
Business intake ........ PASS · LT-0002 visible en 3 ms
Accepted ............... PASS · accepted
Preparing .............. PASS · preparing
Ready .................. PASS · ready
Resultado .............. FAIL · EXCEPCION: la consulta invoca una función que puede mutar

PRODUCTION SALE E2E — FAIL · EXCEPCION
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 10912 |
| pedido creado → visible en el Panel | 3 |
| Accepted | 7539 |
| Preparing | 7726 |
| Ready | 7620 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.