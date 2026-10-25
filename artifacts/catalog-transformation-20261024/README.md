# Transformación comercial del catálogo — herramientas y evidencia (2026-10-24)

Informe: [`docs/audit/catalog-transformation-20261024/INFORME.md`](../../docs/audit/catalog-transformation-20261024/INFORME.md).

| Carpeta | Qué hay |
|---|---|
| `comparacion/` | Pares antes/después de capturas **reales** del Moto G15 (WebP, sin barra de estado) y `index.html` |
| `catalogo/` | Hojas de contacto de los 52 SKU (foto + nombre + contenido + envase) para revisar a ojo que cada foto corresponde |
| `rendimiento/` | JSON de las corridas en el teléfono: carga fría/caliente, A/B, fluidez de scroll y red caída |
| `accesibilidad/` | Resultado de axe-core y de zonas táctiles, antes y después |
| `e2e/` | Registro de cada lote de la suite e2e y `resumen.txt` |
| `tools/` | Todo lo que generó lo anterior |

Las PNG crudas de 1080×2400 **no se versionan** (peso y, sobre todo, porque el Moto G15 es un teléfono personal: una captura
puede traer una notificación de terceros). Se regeneran con las herramientas de abajo.

## Medir en el Moto G15 físico

Requisitos: depuración USB autorizada, `adb reverse tcp:8261 tcp:8261` y
`adb forward tcp:9261 localabstract:chrome_devtools_remote`, y la tienda abierta en una pestaña de Chrome del teléfono.
El arnés (`tools/moto.mjs`) **maneja sólo esa pestaña**, con toques reales por DevTools, y se protege solo:

- se niega a escribir en el teléfono (`adb input`) si Chrome no está al frente;
- no conserva ninguna captura con una notificación emergente encima (la marca `-CON-NOTIFICACION` y hay que descartarla);
- espera si hay una persona tocando el teléfono (`personaTocando`);
- la red lenta o caída se emula **sólo en esa pestaña** por DevTools: no se toca la conectividad ni el plan de datos.

```powershell
node scripts/realtime-relay.mjs 8261                                   # preview (demo con vitrina)
node artifacts/catalog-transformation-20261024/tools/moto-audit.mjs antes|despues   # recorrido de compra completo
node artifacts/catalog-transformation-20261024/tools/moto-nav.mjs despues catalog "list" "cat:cervezas" "shot:x"
node artifacts/catalog-transformation-20261024/tools/moto-fluidez.mjs despues       # cuadros por segundo con gestos reales
node artifacts/catalog-transformation-20261024/tools/moto-offline.mjs despues       # recarga y compra sin conexión
node artifacts/catalog-transformation-20261024/tools/revisar-privacidad.mjs         # montajes para mirar TODAS las capturas
node artifacts/catalog-transformation-20261024/tools/generar-comparacion.mjs        # pares WebP + index.html
```

## Rendimiento: A/B honesto

`tools/serve-compressed.mjs` sirve el árbol con brotli, ETag y `max-age=0, must-revalidate`, y con `H2_CERT`/`H2_KEY` por
HTTP/2 (certificado propio; el error se ignora sólo en la sesión de DevTools, `MOTO_IGNORE_CERTS=1`). Con
`GIT_BASE_FILES` y `GIT_BASE_REF` sirve ciertos archivos **como estaban en una referencia fija**, así «antes» y «después» salen
del mismo servidor y la misma red. **Fijar siempre `GIT_BASE_REF`**: sin él, tras commitear, `HEAD` ya es el «después».

```powershell
MOTO_IGNORE_CERTS=1 MODO=prod PERFILES=fast-4g,slow-4g REPS=3 SOLO_FRIA=1 TABA_BASE=https://localhost:8264 `
  node artifacts/catalog-transformation-20261024/tools/moto-perf.mjs despues
node artifacts/catalog-transformation-20261024/tools/resumen-rendimiento.mjs
```

`MODO=prod` ejerce el camino productivo con el catálogo de Supabase simulado por el arnés de las e2e
(`tests/e2e/catalog-runtime-fixture.mjs`): el panel del negocio no se descarga, que es lo que vive un cliente real.

## Catálogo y accesibilidad

```powershell
npm run catalog:commercial:readiness               # 52 SKU: completo / sin foto / defectos; 0 listos para vender
node artifacts/catalog-transformation-20261024/tools/hoja-de-contacto.mjs   # revisión a ojo de las fotos
AXE_PATH=<axe.min.js> BASE=http://127.0.0.1:8262 node artifacts/catalog-transformation-20261024/tools/a11y-audit.mjs despues
```

`axe-core` se instala **fuera del repo** (no se agregó ninguna dependencia a `package.json`).

## Suite e2e en lotes

`tools/run-all-e2e.sh` corre Chromium (12 lotes), WebKit móvil (8) y recuperación (4), **uno por vez**, con puertos propios
(8265/18765) y un temporal fuera de las unidades casi llenas; un lote rojo se repite una vez y queda registrado.
