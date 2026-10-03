# Prueba de venta real — 20260825-173824-9ec4a6f9

Modo: **AUTOMÁTICO — ENSAYO (no escribe nada)**

```text
TABA PRODUCTION SALE E2E

Precheck ............... BLOCKED · RIDER_SIN_DISPOSITIVO: el teléfono del repartidor no aparece en adb: revisá el cable y que el teléfono esté con la depuración USB encendida
Business auth .......... PASS · sesión guardada reutilizada
Customer auth .......... PASS · cliente de prueba fabricado (dirección 74659185…)
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

PRODUCTION SALE E2E — DRY RUN BLOCKED · repartidor: RIDER_SIN_DISPOSITIVO
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 10359 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.