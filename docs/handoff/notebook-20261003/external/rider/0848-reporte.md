# Corrida controlada del smoke Rider — NO CERTIFICADA

2026-08-05 · Moto G15 `ZY32LHS6PS` · run-id `85751d1b-b122-49c2-a7fd-6475e18dd670`

**No se declara `TABA2_RIDER_STAGING_AUTOMATED_SMOKE_CERTIFIED`.**
1 de 25 pasos. Bloqueo: `INITIAL_STATE_MISMATCH`.
Clasificación: **`AUTOMATION_DEFECT`**.

**Staging volvió exactamente al baseline.**

---

## 1. run-id

`85751d1b-b122-49c2-a7fd-6475e18dd670`

## 2. Hashes

| | Local | Instalado | |
|---|---|---|---|
| androidTest | `ecd8bca303c0ed48414f55b10e7095677e01b6e4c1b551b0bedefbec16259800` | idéntico | instalado en esta corrida con `install -r -t`, extraído y comparado |
| target | `d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299` | idéntico | sin tocar |

El APK viejo `6c28a572` fue reemplazado antes de ejecutar cualquier fase.

## 3. Baseline (medido de nuevo, no heredado)

31 pedidos · 0 QA-SMOKE activos · 0 claims QA · stock QA **19** (precio 400) ·
0 ubicaciones QA · membership `rider` activa · LT-0030 `arrived` rev 10 de otro
rider · sesión Rider QA vigente con cola visible · `qa-smoke` 0 · `qa-trace` 0 ·
DPAPI 0 · sin `adb forward/reverse`.

## 4. Order y order_items creados

**La siembra funcionó y cumplió todas las postcondiciones:**

```
code=QA-SMOKE-85751d1b; items=1; contrato de cola=PASS; pagos=0; comprobantes=0
```

`order_count_for_run=1`, `order_item_count_for_run=1`,
`queue_eligibility_contract=PASS`, `payment_count=0`,
`fiscal_document_count=0`. Cliente y dirección sintéticos de Ciudad QA,
producto `QA-TASK04-STAGING-ONLY`, `qa_no_charge`, cero Mercado Pago, cero
ARCA.

## 5. Refresh

**Resuelto.** El pedido apareció en la cola y se abrió. El checkpoint muestra
`interactionMethod=OBSERVATION_ONLY`, lo que significa que el código ya estaba
visible en la primera lectura y ni siquiera hizo falta forzar el refresh: la
rama de sincronización no se activó.

El defecto anterior `QA_ORDER_NOT_FOUND` **no se repitió**.

## 6. Tabla de 25 pasos

| Paso | Resultado |
|---|---|
| 1 — sesión QA / cola / localizar pedido | **FAIL** `INITIAL_STATE_MISMATCH` |
| 2 a 25 | no ejecutados |

## 7. Acciones físicas del usuario

Ninguna. No hizo falta ninguna intervención: el teléfono ya estaba desbloqueado
y autorizado.

## 8-13. Privacidad, GPS, lifecycle, offline, exactly-once, entrega

No ejecutados. No se afirma nada sobre ellos.

## 14. Stock

19 antes, **19** después. `order_items` totales: 34 antes, **34** después.

## 15. Cleanup

Completo y verificado de forma independiente:

```
cleanup-manifiesto   PASS  cache privada sin manifiesto
cleanup-red          PASS  no se tocó la red
cleanup-datos-qa     PASS  pedidos=1; stock restaurado=True; restantes=0
```

Estado final: 31 pedidos · 0 QA-SMOKE · 0 con el run-id · 1 activo (LT-0030
`arrived`) · stock 19 · order_items 34 · 0 ubicaciones QA · `qa-smoke` 0 ·
`qa-trace` 0 · DPAPI 0 · red wifi=1 data=1 · sin forward/reverse.

## 16. Rotación final

**No ejecutada, deliberadamente.** La rotación y el cierre de sesión
corresponden a una corrida terminada. Esta no lo está, y ejecutarlos destruiría
la sesión preservada que la próxima necesita como punto de partida — obligaría
a rehacer el gate de ingreso antes de poder reintentar.

No hay credencial expuesta: la contraseña del gate 3/3 murió con aquel proceso
y nadie la conoce, así que rotar ahora no agrega seguridad y sí quita el punto
de partida.

## 17. Secretos

Sin exposición. La service key vivió sólo en memoria. El manifiesto viajó por
stdin de `adb exec-in`. Ninguna traza ni log contiene dirección, código de
entrega, nombre ni token.

## 18. LT-0030 y datos humanos

`LT-0030` intacto: `arrived`, revisión 10, de otro rider. Ningún dato humano
fue leído ni modificado.

## 19. Git y lock

| | |
|---|---|
| app | `95294d9`, limpio |
| automatización | `366a0b5`, limpio, sin push |
| `moto-g15.lock` | adquirido 18:02:18Z, liberado tras verificar PID 7116 |
| `heavy-compute.lock` | no adquirido |

**No se modificó código durante la corrida**, según la política de la Fase 8.

## 20. Bloqueo

`INITIAL_STATE_MISMATCH` en `PREFLIGHT_AND_QUEUE`.

### Qué pasó

El pedido se encontró en la cola y se abrió. Inmediatamente después,
`observeState()` devolvió `no-observado`: la pantalla de detalle todavía no
había renderizado ningún CTA reconocible.

### Por qué

`openQaOrder` usa `screen.act()`, que espera un **cambio de firma** de la
pantalla —cantidad de nodos, longitud del texto— y devuelve apenas lo detecta.
Ese cambio ocurre cuando arranca la navegación, no cuando el detalle terminó de
dibujarse. `observeState()` se llama en el instante siguiente, sin esperar a
que aparezca el CTA.

El checkpoint lo respalda: `durationMs=7305` con `launchApp()` durmiendo 6000
ms, o sea que todo lo demás —encontrar, abrir y observar— ocurrió en ~1,3
segundos.

### Clasificación

**`AUTOMATION_DEFECT`.** No hay indicio de regresión en la app: el pedido era
elegible, apareció en la cola y respondió al toque. Falta una espera por señal
observable del detalle antes de leer el estado, igual que la que ya se agregó
para el refresh.

### Arreglo propuesto, no aplicado

`openQaOrder` debería esperar, tras el toque, a que aparezca alguno de los CTA
conocidos —`awaitText` sobre el conjunto de etiquetas— antes de devolver. Es
Kotlin, así que requiere recompilar androidTest y una autorización nueva.

No se aplicó durante la corrida, según la Fase 8.
