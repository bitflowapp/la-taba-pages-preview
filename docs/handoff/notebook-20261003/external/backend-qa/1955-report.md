# Prueba de venta real — 20260822-185200-12ef0062

Modo: **AUTOMÁTICO — VENTA REAL**

```text
TABA PRODUCTION SALE E2E

Precheck ............... PASS · CASO_1_RECEPCION_PUBLICACION_VENTA · recepcion → publicacion → venta · recibir 6
Business auth .......... PASS · sesión guardada reutilizada
Customer auth .......... PASS · sesión guardada reutilizada
Ejecución .............. FAIL · P0_STOCK_INESPERADO: stock 0 → 1 y tenía que quedar en 6

PRODUCTION SALE E2E — FAIL · P0_STOCK_INESPERADO
```

## Latencia de cada transición

| transición | ms |
|---|---|
| precheck | 11171 |

El PIN de entrega se leyó de la pantalla del cliente y no se escribió en ningún archivo.