# Prueba de venta real — 20260822-190014-d73b0104

Modo: **AUTOMÁTICO — VENTA REAL**

```text
TABA PRODUCTION SALE E2E

Precheck ............... PASS · CASO_2_PUBLICACION_VENTA · publicacion → venta
Business auth .......... PASS · sesión guardada reutilizada
Customer auth .......... PASS · sesión guardada reutilizada
Reception .............. SKIP · CASO_2_PUBLICACION_VENTA: el stock ya estaba cargado, no se recibe de nuevo
Publication ............ PASS · publicado con stock 6
Customer cart .......... PASS · 1 × Coca-Cola Original
Checkout ............... PASS · pago cash · dirección c3dd4089…
Order created .......... PASS · LT-0002 · $4990.00
Resultado .............. FAIL · PEDIDO_NO_LLEGA_AL_PANEL: el Panel no muestra LT-0002

PRODUCTION SALE E2E — FAIL · PEDIDO_NO_LLEGA_AL_PANEL
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 12490 |
| confirmar → pedido creado | 1709 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.