# La suite completa de navegador, en este entorno

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

## Cómo verificarlo en un entorno con red estable

```bash
npm run test:e2e
```

En CI, donde `unpkg.com` responde, estas pruebas no dependen de nada que esta
integración haya cambiado.
