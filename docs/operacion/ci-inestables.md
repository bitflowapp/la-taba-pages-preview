# El gate de navegador: reintentos, y cómo leer un verde

462 pruebas de navegador, Chromium y WebKit móvil, entre 28 y 33 minutos por
corrida. Este documento dice qué política de reintentos hay, por qué, y cómo se
interpreta cada resultado. No hace falta conocer ninguna conversación previa.

## La política

```
retries: process.env.CI ? 1 : 0
```

| dónde | reintentos | por qué |
|---|---|---|
| local | **0** | quien escribe una prueba tiene que ver su carrera la primera vez, no ganarla por reintento |
| CI | **1** | recuperar la corrida cuando el motor o el runner fallan, sin pagar 30 minutos y un `main` en rojo |

## Por qué 1 en CI: los números

Medido sobre el historial, no supuesto. Tres corridas de `main` murieron por
este gate. **Ninguna era una regresión.**

| SHA | prueba | motor | qué pasó |
|---|---|---|---|
| `109d78a` | `business-windows-operations:144` | chromium | el formulario pedía la frase de confirmación que la prueba **acababa de escribir**: el click llegó antes que el `fill` |
| `109d78a` | `launch-ux-checkout-reorder:559` | chromium | una de las dos muestras de alto midió **0**: se midió antes de que el navegador maquetara |
| `956fa74` | `catalog-card-glow:68` | mobile-webkit | `WebKit encountered an internal error` dentro de `waitForURL` — falla del motor, no del producto |

Las dos primeras corrieron sobre un **árbol de hash idéntico** al de `d313980`,
que había pasado **462/462** minutos antes:

```
109d78a  tree=e13e205e747b828a4896f098a60bbadcc7a901ca   FALLÓ
d313980  tree=e13e205e747b828a4896f098a60bbadcc7a901ca   462/462
```

Los mismos bytes, dos veredictos opuestos. Eso no es una regresión: es ruido.

**Por qué global y no sólo WebKit.** Dos de las tres fueron de Chromium.
Reintentar sólo WebKit habría dejado pasar la mayoría.

## Lo que un reintento NO significa

Reintentar sin más convierte «verde» en dos cosas distintas: la corrida limpia y
la que necesitó una segunda oportunidad. Si no se distinguen, un reintento que
pasa por casualidad tapa una regresión de verdad y nadie se entera nunca.

Por eso hay un informe: `tests/e2e-infra/reporter-inestables.mjs`.

| inestables | resultado | qué ves |
|---|---|---|
| **0** | 🟢 verde | `E2E estable: ninguna prueba necesitó reintento.` |
| **1 a 3** | 🟢 verde **con aviso** | un `::warning::` por prueba, con nombre y el error de su primer intento, más `El verde de esta corrida NO es un verde limpio.` |
| **4 o más** | 🔴 **rojo** | `::error::N inestables supera el umbral de 3: la corrida se considera INESTABLE, no verde.` |

El umbral se cambia con `TABA_E2E_FLAKY_MAX`.

Una corrida donde muchas pruebas se recuperan por reintento no está sana, y
llamarla verde sería el mismo silencio que esta política existe para romper.

**Una prueba que falla las dos veces sigue roja**, con su mensaje intacto. El
informe no puede pisar el estado de una corrida ya fallida.

## Cómo saber si algo viene flakeando hace rato

Cada corrida sube un artefacto `e2e-flaky-<run_id>-<attempt>`:

```json
{
  "total": 1,
  "umbral": 3,
  "estado": "passed",
  "pruebas": [
    { "nombre": "[mobile-webkit] catalog-card-glow.spec.mjs › HOME · el rail",
      "error": "Error: page.waitForURL: WebKit encountered an internal error" }
  ]
}
```

Se retiene 30 días. Bajando dos o tres y comparando los nombres se responde «¿es
la primera vez o viene pasando?» sin montar una base de datos.

**Si una prueba aparece en varias corridas seguidas, es deuda, no ruido.**
Repararla es el trabajo: la tolerancia de 1 a 3 existe para que un error del
motor no cueste media hora, no para convivir con una prueba que nadie arregla.

## Trazas

```
--trace=on-first-retry
```

Con reintentos, lo que hay que poder mirar es **justo el intento que se
recupera**, y ese es el que esta opción graba. Una prueba que falla las dos
veces también deja la traza de su reintento.

```
npx playwright show-trace test-results/<carpeta>/trace.zip
```

Las trazas viajan en el artefacto `playwright-failure-<run_id>-<attempt>`.

## Lo que esta política no permite

- **Apagar una prueba para estabilizar el gate.** Hay una prueba que falla si
  aparece un `test.skip(`, `test.fixme(` o `test.fail(` en cualquier spec de
  `tests/e2e`. Una prueba apagada no es una prueba estable.
- **Reintentar en local.** Comprobado resolviendo la configuración de verdad en
  dos procesos, con y sin `CI`: 0 y 1.
- **Que el reporter se caiga del comando.** Nombrar reporters en la línea de
  comandos **reemplaza** los del config, así que el de inestables viaja
  explícito en el paso de CI y hay una prueba que lo exige.

## Correrlo a mano

```
npm run test:e2e                        # local, sin reintentos
CI=1 npm run test:e2e                   # como en CI, con 1 reintento
npm run test:e2e -- --project=chromium  # un solo motor
```

## Qué está probado

`tests/ci-politica-de-inestables.test.mjs`, 10 casos: que local sea 0 y CI sea 1
—resolviendo la configuración en dos procesos—, corrida limpia, una inestable
aislada, umbral superado, regresión determinista que sigue roja, el nombre con
su motor, el informe en disco, el cableado de CI y la prohibición de apagar
pruebas.

Además, verificado **contra Playwright real** con pruebas de mentira construidas
para el caso:

| caso | resultado |
|---|---|
| una que falla y se recupera, `CI=1` | verde, `1 flaky`, aviso con nombre y error |
| una determinista rota, `CI=1` | **roja** — el reintento no la salva |
| cinco inestables, umbral 3 | **roja** por umbral |
| la inestable **sin** `CI` | **roja** — en local no se reintenta |
