# Prueba de venta real — 20260822-181902-20b06a99

Modo: **AUTOMÁTICO — ENSAYO (no escribe nada)**

```text
TABA PRODUCTION SALE E2E

Precheck ............... BLOCKED · PHYSICAL_STOCK_NOT_ATTESTED: no hay atestación de stock físico: falta TABA2_E2E_PHYSICAL_QTY y TABA2_E2E_PHYSICAL_CONFIRMATION
Business auth .......... PASS · sesión guardada reutilizada
Customer auth .......... PASS · sesión guardada reutilizada
Reception .............. SKIP · ensayo
Publication ............ SKIP · ensayo
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
On the way ............. SKIP · ensayo
Tracking ............... SKIP · ensayo
Arrived ................ SKIP · ensayo
PIN .................... SKIP · ensayo
Delivered .............. SKIP · ensayo
Stock N-1 .............. SKIP · ensayo
Persistence ............ SKIP · ensayo

PRODUCTION SALE E2E — DRY RUN BLOCKED · atestacion: PHYSICAL_STOCK_NOT_ATTESTED · repartidor: RIDER_SIN_DISPOSITIVO
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 10145 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.