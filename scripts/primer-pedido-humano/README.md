# Herramientas del primer pedido humano físico

Todo esto es para **un solo pedido real**, contra `la-taba-staging`. Nada de acá
toca producción y nada muta un pedido por SQL: el negocio cancela desde su Panel
y el Rider entrega desde su app, que es lo que haría una persona.

**Requisito previo del reparto:** el teléfono tiene que tener **datos móviles**.
Sin eso no hay seguimiento en vivo ni forma de confirmar el código en la puerta.
Está explicado en `FULL-E2E-HANDOFF.md`, sección 7.6.

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

## Cuando el Panel se maneja a mano

El Panel **re-dibuja la cola y reemplaza la tarjeta a los ~520 ms**. El campo de
motivo es un input suelto que no vive en el estado, así que en cada re-dibujo se
vacía; y la fila de botones se corre, porque la etiqueta del botón primario
cambia de ancho. Entre escribir el motivo y hacer click hay una ventana en la que
el motivo ya no está y el puntero ya no apunta donde apuntaba.

No es teoría. Una corrida escribió el motivo, el re-dibujo lo borró, y el click
de «Cancelar con motivo» terminó cayendo sobre «Aceptar pedido»: el pedido
avanzó tres estados sin que nadie lo pidiera. Por eso `panel-operar.mjs` pone el
motivo y dispara el click en el **mismo turno de JS**. Es la UI real del negocio
y su mismo comando; lo único que se evita es la carrera.

**Si lo operás a mano, la trampa es la misma:** escribí el motivo y tocá el botón
enseguida, y si dudás, re-escribilo justo antes.

## Los archivos

| | |
| --- | --- |
| `monitor.mjs` | vigilancia en vivo, sólo lectura |
| `rollback.mjs` | diagnóstico y verificación del rollback |
| `panel-sesion.mjs` | abre el Panel del negocio y deja la sesión guardada |
| `negocio-cancelar.mjs` | cancela desde la UI real del Panel, con motivo |
| `panel-operar.mjs` | retira pedidos con motivo y/o lleva uno hasta «listo» |
| `panel-abierto.mjs` | deja el Panel **abierto y con sesión** para que lo maneje una persona |
| `preflight-gate.mjs` | 16 chequeos antes de tocar un teléfono: sitio, catálogo, rider, Moto, alertas |
| `esperar-pedido.mjs` | espera el pedido que hace la persona y avisa su código |
| `ensayo-storefront.mjs` | recorre el camino del cliente **sin crear el pedido** |
| `snapshot.mjs` | foto de staging antes/después de una mutación |
| `cola-rider.mjs` | qué ve el rider en su cola, preguntado con SU sesión |
| `gps-vivo.mjs` | ¿está publicando GPS real este pedido, ahora? |
| `timeline-fixes.mjs` | timeline de fixes: captura contra llegada, y desorden |
| `cliente-tracking.mjs` | recupera el código desde el navegador del cliente |
| `llegada-y-codigo.ps1` | llegada + rechazo del código incorrecto, en el Moto |
| `entregar.ps1` | confirma la entrega, en el Moto |
| `medir-movimiento.mjs` | la prueba de desplazamiento: mide qué pasa cuando el teléfono **se mueve de verdad** |
| `verificar-presencia.mjs` | la verificación por presencia del punto de retiro, en el retiro real |
| `entorno.mjs` | de dónde sale cada ruta, para no clavar la de ninguna máquina |

## La verificación por presencia

El punto de La Taba 2 que tiene la base viene de un directorio público
contrastado, no de una medición sobre la puerta. En el primer retiro físico se
mide, con el Rider parado en el local y apenas confirmado el retiro:

```bash
node verificar-presencia.mjs LT-0107
```

Escucha las ubicaciones que la app publica para ese pedido —las mismas que ve el
cliente— y se queda con la de **mejor precisión**, no con la más cercana: elegir
la más cercana sería elegir el resultado que uno quiere. Con precisión peor que
20 m no concluye nada. A 30 m o menos escribe `verified_by_rider_presence=true`;
más lejos deja `PICKUP_LOCATION_DISCREPANCY` y **no toca la coordenada**, porque
que el Rider esté lejos no dice cuál es el punto bueno.

Nunca toca `human_verified`: estar cerca del punto no es haber confirmado el pin
contra la puerta. Eso lo afirma una persona, con `scripts/set-pickup-point.mjs
--confirmado-por-humano`.

## La prueba de desplazamiento

Todo lo demás se midió con el equipo **quieto**, y ahí los saltos entre fixes son
ruido del GPS, no movimiento. Esta es la única que necesita a una persona:

```bash
node medir-movimiento.mjs LT-0104     # ventana de 4 min; MINUTOS=6 para más
```

Durante la ventana se camina una distancia corta en un lugar seguro. **Siempre
detenido para tocar el teléfono, nunca conduciendo.** El script no pide tocar
nada: sólo mira lo que llega al servidor.

Distingue movimiento de ruido con un umbral que no es un gusto: por debajo de la
precisión que el propio GPS reporta, un desplazamiento es indistinguible del
ruido. Declara movimiento real sólo con al menos 3 saltos por encima de ese
umbral y más de 20 m de desplazamiento neto. Si no, dice que **no** hay
desplazamiento demostrado.

Los dos `.ps1` corren contra el arnés del repo del Rider y **abortan si el
proyecto no es el staging autorizado**. Por convención lo buscan como repo
hermano de éste; si está en otro lado, `-RiderWorktree <ruta>` o
`TABA_RIDER_WORKTREE`.

## Entorno

Nada tiene rutas de una máquina en particular. Lo que se puede ajustar:

| Variable | Para qué | Por defecto |
| --- | --- | --- |
| `SUPABASE_CLI` | binario del CLI de Supabase | `supabase` (el del `PATH`) |
| `TABA_EVIDENCIA` | dónde dejar capturas y medidas | `.taba-evidencia/` en el repo, **ignorada por git** |
| `TABA_RIDER_WORKTREE` | worktree del repo del Rider | repo hermano |
| `TABA_MOTO_SERIAL` | serial ADB del teléfono | `ZY32LHS6PS` |
| `TABA_STAGING_REF` | proyecto Supabase | `ukxqbgswjlibmnjemrzd` |
| `TABA_SITIO` | storefront publicado | `https://taba2-staging.pages.dev` |
| `TABA_SECRETS` | carpeta de credenciales de la máquina | **sin valor por defecto** |

`TABA_SECRETS` no tiene default a propósito: una ruta de credenciales no se
adivina ni se versiona. Los scripts que necesitan un login se plantan con un
mensaje claro si la variable no está.

La evidencia queda fuera de git a propósito: puede tener datos de una entrega
real.
