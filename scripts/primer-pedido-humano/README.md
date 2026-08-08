# Herramientas del primer pedido humano físico

Todo esto es para **un solo pedido real**, contra `la-taba-staging`. Nada de acá
toca producción y nada muta un pedido por SQL: el negocio cancela desde su Panel
y el Rider entrega desde su app, que es lo que haría una persona.

**Requisito previo del reparto:** el teléfono tiene que tener **datos móviles**.
Sin eso no hay seguimiento en vivo ni forma de confirmar el código en la puerta.
Está explicado en `FULL-E2E-HANDOFF.md`, sección 7.5.

## Cómo se distingue el pedido humano de los QA viejos

En la cola del Panel conviven pedidos de prueba de sesiones anteriores. La
diferencia no es visual, es del dato:

| | |
| --- | --- |
| Pedido humano | entra por el storefront publicado → `origin = 'production'` |
| Pedidos QA sembrados | `origin = 'qa'` |

`monitor.mjs` engancha solo el `production` vivo más reciente. **Si hubiera más
de uno, se planta y pide el código a mano**: no adivina cuál es.

## Durante la entrega

```bash
node monitor.mjs               # engancha el pedido humano y vigila
node monitor.mjs LT-0104       # o vigilando un código concreto
```

Refresca cada 6 s y grita si pasa algo que no puede pasar: ARCA emitiendo,
`LT-0030` moviéndose, el pedido duplicado, ubicaciones repetidas (exactly-once
roto), el stock cayendo más de una unidad, o —al terminar— coordenadas que
sobrevivieron a la entrega, el Rider que no queda libre, o un `delivered` sin
código confirmado.

En cada línea se ve: estado y revisión, total, stock, GPS (cantidad de puntos,
antigüedad del último y si está **EN VIVO**, es decir menos de 15 s), las dos
outbox y el estado del código.

## Si algo sale mal

```bash
node rollback.mjs LT-0104              # diagnostica y dice el camino exacto
node rollback.mjs LT-0104 --verificar  # comprueba que quedó limpio
```

No ejecuta nada por su cuenta. Según el estado te da el camino:

- **Antes de que el Rider lo tome** (`received` … `ready`): se retira desde el
  Panel con motivo obligatorio (`negocio-cancelar.mjs`). La unidad vuelve al
  stock por el mismo camino que cualquier cancelación del negocio.
- **Ya tomado** (`assigned` … `arrived`): se termina desde la app como una
  entrega real. El código lo tiene el cliente en su seguimiento
  (`cliente-tracking.mjs`), y después `llegada-y-codigo.ps1` y `entregar.ps1`.

## Los archivos

| | |
| --- | --- |
| `monitor.mjs` | vigilancia en vivo, sólo lectura |
| `rollback.mjs` | diagnóstico y verificación del rollback |
| `panel-sesion.mjs` | abre el Panel del negocio y deja la sesión guardada |
| `negocio-cancelar.mjs` | cancela desde la UI real del Panel, con motivo |
| `cliente-tracking.mjs` | recupera el código desde el navegador del cliente |
| `llegada-y-codigo.ps1` | llegada + rechazo del código incorrecto, en el Moto |
| `entregar.ps1` | confirma la entrega, en el Moto |

Los dos `.ps1` corren contra el arnés del repo del Rider
(`la-taba2-rider-first-physical-e2e/scripts/qa`) y **abortan si el proyecto no es
el staging autorizado**.
