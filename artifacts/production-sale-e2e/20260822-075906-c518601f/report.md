# Prueba de venta real — 20260822-075906-c518601f

Modo: **ENSAYO (no crea pedido)**

```text
TABA PRODUCTION SALE E2E

Precheck ............... BLOCKED · NO_PUBLICADO: el producto no está publicado: falta la recepción física y publicarlo desde el Panel
Customer cart .......... SKIP · ensayo
Checkout ............... SKIP · ensayo
Order created .......... SKIP · ensayo
Business intake ........ SKIP · ensayo
Accepted ............... SKIP · ensayo
Preparing .............. SKIP · ensayo
Ready .................. SKIP · ensayo
Rider offered .......... SKIP · ensayo
Rider accepted ......... SKIP · ensayo
Picked up .............. SKIP · ensayo
Tracking ............... SKIP · ensayo
PIN .................... SKIP · ensayo
Delivered .............. SKIP · ensayo
Stock N-1 .............. SKIP · ensayo
Persistence ............ SKIP · ensayo

PRODUCTION SALE E2E — DRY RUN BLOCKED · NO_PUBLICADO
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | [PIN-REDACTADO] |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.