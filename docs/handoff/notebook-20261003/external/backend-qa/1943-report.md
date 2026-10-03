# Prueba de venta real — 20260822-173833-587a4c62

Modo: **AUTOMÁTICO — ENSAYO (no escribe nada)**

```text
TABA PRODUCTION SALE E2E

Precheck ............... BLOCKED · PHYSICAL_STOCK_NOT_ATTESTED: no hay atestación de stock físico: falta TABA2_E2E_PHYSICAL_QTY y TABA2_E2E_PHYSICAL_CONFIRMATION
Business auth .......... BLOCKED · PANEL_SIN_CREDENCIAL: no hay contraseña guardada para la identidad del Panel: corré scripts/e2e-production-sale/provisionar-identidad-panel.mjs
Customer auth .......... BLOCKED · CLIENTE_SIN_APROVISIONAR: no hay cliente de prueba utilizable (CLIENTE_SIN_PERFIL) y este ensayo no tiene permiso para crearlo: agregá --aprovisionar
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

PRODUCTION SALE E2E — DRY RUN BLOCKED · atestacion: PHYSICAL_STOCK_NOT_ATTESTED · identidadPanel: PANEL_SIN_ROL · repartidor: RIDER_SIN_DISPOSITIVO · sesionPanel: PANEL_SIN_CREDENCIAL · sesionCliente: CLIENTE_SIN_APROVISIONAR
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 11248 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.