# Corrida real del smoke Rider — NO CERTIFICADA

2026-08-05 · Moto G15 `ZY32LHS6PS` · agente PID 7116

**No se declara `TABA2_RIDER_STAGING_AUTOMATED_SMOKE_CERTIFIED`.**
1 de 25 pasos ejecutados. El paso 1 falló con `QA_ORDER_NOT_FOUND`.

**Staging quedó exactamente como estaba.** 31 pedidos, stock QA 19, LT-0030 en
`arrived` intacto, 0 pedidos QA, 0 ubicaciones QA.

---

## Cuatro intentos, cuatro defectos, todos míos

| # | run-id | Murió en | Causa | Mutó | Fix |
|---|---|---|---|---|---|
| 1 | `1ea77ba1` | antes de sembrar | pipe directo sobre `ConvertTo-TabaFlatArray` | no | `7b189ae` |
| 2 | `7913d524` | 400 en el insert | columnas inexistentes y obligatorias faltantes | no | `6d305c0` |
| 3 | `c977051b` | antes de sembrar | dirección elegida por heurística de nombre | no | `2347585` |
| 4 | `c1daae11` | **paso 1 de 25** | el pedido sembrado no aparece en la cola del Rider | **sí, y se limpió** | pendiente |

Ninguno fue un defecto de la app, del dispositivo ni de staging. Los cuatro
fueron de mi automatización, y los tres primeros sólo se manifestaron al correr
contra el backend real.

### Intento 3 — el más serio

Filtraba clientes cuyo nombre matcheara `qa|smoke|test` y después tomaba
**cualquier dirección suya**. Staging tiene domicilios reales de Neuquén y CABA:
una coincidencia de nombre no dice nada sobre a qué dirección se apunta. De las
10 direcciones de staging, **una sola está completa** y es la sintética de
"Ciudad QA". Ahora la selección exige dirección viva y completa en todos sus
campos, deriva el cliente de ella, y aborta si no hay exactamente una.

### Intento 4 — hasta dónde llegó

La siembra funcionó: un pedido QA elegible, `QA-SMOKE-c1daae11`, con
`payment_method=qa_no_charge`, cliente y dirección sintéticos, cero pagos y
cero comprobantes.

El paso 1 falló en 6,5 s. El checkpoint lo dice sin ambigüedad:

```
sessionPresent=true
authenticatedStateVisible=false
initialState=no-observado
classification=QA_ORDER_NOT_FOUND
```

La cola era visible —el `awaitText` del encabezado pasó de inmediato— pero el
código `QA-SMOKE-c1daae11` no figuraba en ella.

**El cleanup hizo exactamente lo suyo**: `pedidos=1; stock restaurado=True;
restantes=0`. Es la primera validación end-to-end del cleanup contra datos
reales, y pasó.

## Dos hipótesis para el paso 1

No las verifiqué: verificarlas exige otra corrida y ya gasté cuatro.

1. **El pedido no tiene `order_items`.** La siembra crea la fila de `orders`
   pero ninguna línea. Es razonable que `get_rider_queue` excluya un pedido sin
   items, y explicaría que la cola se renderice bien y no lo liste.
2. **La cola venía cacheada.** La fase lanza la app y lee, pero no fuerza un
   refresh. Si la app tenía la cola vacía anterior en memoria, el pedido recién
   sembrado no aparecería hasta un pull-to-refresh.

La primera es la más probable y la más fácil de descartar: basta comparar
`order_items` de un pedido QA histórico que sí llegó a la cola.

## Por qué freno acá

Cuatro intentos sobre una autorización de una corrida. Los tres primeros no
mutaron; el cuarto sí, y aunque el cleanup lo resolvió limpio, seguir
parcheando y reintentando contra una operación mutante es justo lo que la
disciplina del gate dice que no hay que hacer.

El próximo paso correcto no es un quinto intento a ciegas: es descartar la
hipótesis de `order_items` **leyendo** un pedido QA histórico, corregir la
siembra con esa evidencia, y recién entonces pedir una autorización nueva.

## Estado final verificado

| | |
|---|---|
| Pedidos totales | **31** — baseline |
| `QA-SMOKE-*` | **0** |
| Pedidos con el run-id sembrado | **0** |
| Activos | **1** — `LT-0030` `arrived`, intacto |
| Stock QA | **19** — baseline |
| Ubicaciones QA | 0 |
| Sesión Rider QA | preservada (`rider_session.enc`) |
| `cache/qa-smoke` · `cache/qa-trace` | 0 · 0 |
| DPAPI temporal | 0 archivos |
| Red del teléfono | wifi=1 data=1, sin tocar |
| `moto-g15.lock` | liberado tras verificar PID |
| `heavy-compute.lock` | no adquirido, no tocado |

**Contraseña QA no rotada y sesión no cerrada, a propósito.** Esos dos pasos del
cleanup corresponden a una corrida completa. El smoke no se completó, y
ejecutarlos ahora destruiría el punto de partida que la próxima corrida
necesita — la sesión preservada del gate de ingreso.

## Git

| | |
|---|---|
| app | `95294d9`, sin cambios, limpio |
| automatización | `2347585`, limpio, sin push |

Tres commits nuevos, uno por defecto, cada uno con su causa:
`7b189ae`, `6d305c0`, `2347585`.

Suite de guards host: 32/32 después de cada fix.
