# La suite completa de navegador, en este entorno

## El resultado, en una línea

**498 pasan · 44 fallan · 2,8 h.** Las 44 fallan IGUAL en `main`: mismas
pruebas, mismas líneas, cero regresiones de esta integración.

Y las tres suites que este trabajo sí toca —`panel-bandeja-movil`,
`panel-escalabilidad`, `panel-responsive`— pasan **34 de 34**.

## Lo que se corrió

`npx playwright test` sin filtro de proyecto: **541 pruebas en 65 archivos**,
chromium y mobile-webkit, con `workers: 1` y **`retries: 0`** —el valor local,
que es más estricto que el de CI, donde `retries: 1` más el reporte de
inestables permiten distinguir ruido de regresión—.

## El límite del entorno, dicho antes que los resultados

Este contenedor corre entre cinco y diez veces más lento que el runner de CI
—que resuelve el mismo trabajo dentro de los 45 minutos que le da
`.github/workflows/ci.yml`—. No cambia el veredicto de ninguna prueba; cambia
cuánto tarda en llegar.

## Las fallas de `address-flow.spec.mjs` son del entorno, y se puede demostrar

`index.html` carga MapLibre desde `unpkg.com`. El proxy de este entorno corta
ese túnel a mitad de transferencia de forma intermitente:

```
recentRelayFailures:
  kind:   ws_closed_mid_exchange
  detail: tunnel closed (code 1006, Connection ended) after 6s
  host:   unpkg.com:443
```

Sin la librería, el mapa no abre. Y el producto **hace lo correcto**: deja el
botón deshabilitado y lo dice. Del `error-context` de la propia falla:

```
- status: No pudimos abrir el mapa. Ajustá el punto con los controles antes de confirmarlo.
- button "Confirmar ubicación" [disabled]
```

La prueba espera a poder tocar «Confirmar ubicación» y agota sus 45 s.

**Por qué esto no puede venir de esta integración**: el diff no toca el mapa, ni
la hoja de direcciones, ni el checkout del cliente, ni `maplibre`, ni
`index.html` fuera del token `?v=` del CSS. La lista completa de archivos
tocados está en el PR.

## La prueba de que son del entorno: la misma corrida contra `main`

No alcanza con explicar por qué fallan. Se corrieron los mismos archivos contra
`main` —`88f40a2`, sin una línea de esta integración— en un worktree aparte y
con los puertos separados que `playwright.config.mjs` ofrece justamente para
esto (`TABA_E2E_HTTP_PORT`, `TABA_E2E_RELAY_PORT`), en serie para que ninguna
corrida le robe el host a la otra.

| archivo | `main` | integración | pruebas que fallan, en las dos |
| --- | --- | --- | --- |
| `address-flow` | 5 fallan · 11 pasan | 5 fallan | `151:3` `191:3` `231:3` `324:3` `465:3` |
| `beverage-storefront` | 3 fallan · 9 pasan | 3 fallan | `6:1` `239:1` `401:1` |
| `customer-profile` | 1 falla · 2 pasan | 1 falla | `8:1` |
| `delivery-proof` | 1 falla · 8 pasan* | 1 falla | `9:1` |
| `demo-realtime-profile` | 1 falla | 1 falla | `18:1` |
| `demo-realtime-reliability` | 5 fallan · 3 pasan | 5 fallan | `22:1` `92:1` `137:1` `167:1` `211:1` |
| los otros 16 archivos | 28 fallan · 73 pasan | 28 fallan | conjunto **idéntico**, comparado con `comm` |

### El conjunto completo, comparado elemento por elemento

```
integración (resto): 28   main (resto): 28
sólo en la integración:  (vacío)
sólo en main:            (vacío)
en ambas:                28
```

Sumando los seis archivos de arriba: **44 de 44**. Ninguna prueba falla en esta
rama que no falle también en `main`.

### El que había que mirar con lupa: `panel-order-recovery`

Es la única suite del Panel entre las que fallan, así que merece decirse
aparte. Falla lo mismo en las dos ramas:

| | `main` | integración |
| --- | --- | --- |
| `125:1` (4 anchos) | ✘ 45,0 s | ✘ 45,0 s |
| `154:1` (1 ancho) | ✓ 25,7 s | ✓ |
| `177:1` (4 anchos) | ✘ 45,0 s | ✘ 45,0 s |
| `204:1` (1 ancho) | ✓ 25,6 s | ✓ |

El corte es limpio y explica solo: las dos que fallan recorren **cuatro anchos**
(320, 360, 390, 432) con una carga de página completa en cada uno, contra un
tope de 45 s. En este contenedor una carga cuesta unos 12 s, así que cuatro no
entran. Las dos que usan un ancho pasan con 25 s de sobra.

Se verificó además que el atributo `data-panel-region="operations"` que esta
integración agrega a `business-operations-center.js` no puede ser la causa:
ninguna prueba compara el marcado de esa sección —todas la buscan por
`[data-business-ops-center]`, y un atributo de más no cambia ese selector— y las
2.377 pruebas unitarias, que cubren ese archivo, pasan.

\* La corrida de `delivery-proof` incluyó además `delivery-location-confirmation`
entero, que **pasó**. Vale la pena decirlo: no es que «todo lo que toca el mapa
falla». Fallan las pruebas que esperan a que el mapa ABRA o que exigen una
consola limpia. Las demás pasan, también acá.

**Las mismas pruebas, en las mismas líneas, en las dos ramas: 16 de 16.** No son
una regresión de esta integración.

## Las dos formas que toma la misma causa

1. **Tiempo agotado (45 s).** La prueba espera a poder tocar «Confirmar
   ubicación», y el botón está deshabilitado porque el mapa no abrió.
2. **Consola sucia.** Pruebas como `customer-profile:8:1` —«sin overflow ni PII
   en consola»— y las de `demo-realtime-reliability` afirman que la consola no
   tiene errores, y encuentran `Failed to load resource: net::ERR_CONNECTION_RESET`.

Las dos salen del mismo lugar: el `<script>` de MapLibre que `index.html` carga
desde `unpkg.com`.

## Qué se intentó antes de dar por cerrado que es del entorno

* `curl` a través del mismo proxy: **5 de 5**, 1 MB en 0,2-0,45 s. El host es
  alcanzable.
* Chromium al mismo URL: `net::ERR_CONNECTION_RESET`, siempre.
* Con el proxy declarado explícitamente en `chromium.launch({ proxy })`: igual.
* Con `--disable-features=EncryptedClientHello`, por si era ECH: igual.

El proxy registra del lado suyo `1751 B sent, 39 B received` y cierra: el
`ClientHello` de Chromium —más grande que el de curl— no sobrevive al relevo de
salida. **No se desactivó la verificación TLS ni se tocó `HTTPS_PROXY`**, que es
lo que el entorno pide explícitamente que no se haga, y **no se subió ningún
timeout** para tapar el síntoma.

## Cómo verificarlo en un entorno con red estable

```bash
npm run test:e2e
```

En CI, donde `unpkg.com` responde, estas pruebas no dependen de nada que esta
integración haya cambiado.
