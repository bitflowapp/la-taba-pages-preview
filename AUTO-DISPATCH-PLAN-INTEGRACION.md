# Auto-dispatch · por qué no va al go-live, y cómo entra después

## La decisión

**No se despliega para el lanzamiento.** El reparto arranca con el flujo manual
de cola/claim, que es el que corre hoy.

Esto no es cautela genérica: es lo que dice la evidencia.

| Hecho medido | Consecuencia |
|---|---|
| `feature/taba2-automated-rider-dispatch` (`226bca2`) está **6 commits fuera** de `1d26c4b` | no está en staging, no está certificado ahí |
| Rider `feature/taba2-rider-shifts-dispatch` (`ae90ab6`) **nunca se pusheó**; el repo Rider no tiene remoto | la app con dispatch no existe fuera de esta máquina |
| El Moto G15 tiene `com.lataba.rider.staging` **1.0.0** | el teléfono del piloto corre el build SIN auto-dispatch |
| Base común con el desplegado: `eda13f8` | integrarlo es un merge real, no un fast-forward |

Aceptar pedidos reales no depende de esta feature, y el encargo pide
explícitamente que no dependa.

## Un riesgo que conviene ver antes de integrarlo

En la app Rider con auto-dispatch, `RiderHomePage` elige la superficie así:

```dart
widget.operationsController == null ? _buildQueueMap(...) : _buildDispatchMap(...)
```

Y en producción `AuthenticatedSessionPage` **siempre** construye un
`RiderOperationsController`. O sea: **en el build con auto-dispatch, la cola
manual queda inalcanzable.** No es un fallback en caliente; es un reemplazo.

Consecuencia práctica: si el auto-dispatch se despliega y el servidor de turnos
falla, el rider no tiene camino manual al que caer. Eso hay que resolverlo
**antes** de integrarlo, no después.

## Plan de integración (posterior al go-live)

1. **Decidir el fallback.** Que la ausencia de turno/oferta caiga a la cola
   manual en vez de mostrar sólo «fuera de turno». Es un cambio de una condición
   en `RiderHomePage`, pero es un cambio de producto: hay que quererlo.

2. **Integrar el lado web.** `226bca2` sobre la línea desplegada, resolviendo el
   merge desde `eda13f8`. Correr `npm run check`, `npm test`, `npm run test:e2e`
   y las migraciones de dispatch contra staging.

3. **Certificar el SQL de dispatch en staging.** Es lo que hoy no existe: el
   auto-dispatch funciona local y nadie lo probó contra la base real con turnos,
   ofertas, lease y expiración.

4. **Compilar e instalar el Rider con dispatch en el Moto**, y recorrer el
   circuito turno → oferta → aceptar → retiro → entrega con GPS real.

5. **Recién ahí**, decidir si reemplaza a la cola manual o convive con ella.

## Lo que sí entra al go-live desde el trabajo del Rider

El arreglo del **mapa permanente** (`ae90ab6`, rama
`feature/taba2-rider-shifts-dispatch`) está terminado y certificado en el Moto
G15: 307 tests verdes, 0% de jank, mapa presente en los nueve estados.

Pero vive **sobre** la rama de auto-dispatch, así que hoy no se puede desplegar
sin arrastrar el dispatch. Si se quiere el mapa sin el dispatch, hay que
portarlo a la línea del Rider que sí está instalada — son cinco archivos y está
descrito en `RIDER-ALWAYS-MAP-HANDOFF.md` del worktree del Rider.

**No bloquea aceptar pedidos**: es un defecto de comodidad del repartidor, no del
circuito comercial.
