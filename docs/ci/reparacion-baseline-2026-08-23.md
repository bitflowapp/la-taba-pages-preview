# Reparación del baseline de CI · 2026-08-23

Tres defectos preexistentes en `main` dejaban CI rojo en **todas** las ramas.
Al repararlos aparecieron otros cuatro que estaban tapados detrás: mientras el
job moría en el paso 6 o en el 9, los pasos de más abajo no llegaban a correr, y
lo que estaba roto ahí no se veía. **Siete en total**, en cascada: cada
reparación destapaba la siguiente.

Este documento guarda la evidencia de que existían y de que dejaron de existir,
para que la reparación se pueda auditar sin creerle a nadie.

| # | defecto | job | lo tapaba |
|---|---|---|---|
| 1 | `supabase start` no parseaba `config.toml` | migraciones | — (del encargo) |
| 2 | el Commercial catalog gate no podía pasar nunca | web | — (del encargo) |
| 3 | `panel-timestamp-unambiguous` leía el huso del runner | web | — (del encargo) |
| 4 | una migración empezaba con BOM de UTF-8 | migraciones | el 1 |
| 5 | Deno reinstalaba `node_modules` y rompía el E2E | web | el 2 |
| 6 | el arnés del aviso de PWA no declaraba `meta viewport` | web (E2E) | el 2 y el 5 |
| 7 | «Volver al Rider» pisaba el recentrado a 320 px | web (E2E) | el 2 y el 5 |

Los defectos 6 y 7 sólo se pudieron ver cuando el E2E llegó a **correr**: con el
5 sin reparar, las 462 pruebas morían antes de abrir un navegador.

## Cómo se reprodujo

Rama nueva desde `main` en `0fd9fda`, sin arrastrar ningún otro trabajo. El CLI
de Supabase usado es el mismo que fija `.github/workflows/ci.yml`
(`SUPABASE_CLI_VERSION: 2.101.0`), descargado del release oficial.

## 1 · `supabase start` no parseaba el config

**Antes**

```
$ supabase start
failed to parse config: decoding failed due to the following error(s):

'config.config' has invalid keys: local_smtp
```

Job afectado: «Migrations, pgTAP and isolated restore». Moría en el paso 6 de 9,
a los ~22 s, sin correr ninguna de sus 162 aserciones pgTAP ni el simulacro de
restauración.

**La medición que decidió el arreglo**

`supabase init --force` con ese mismo CLI, en un directorio vacío, emite:

```
[inbucket]
enabled = true
# Port to use for the email testing server web interface.
port = 54324
# Uncomment to expose additional ports for testing user applications that send emails.
# smtp_port = 54325
# pop3_port = 54326
# admin_email = "admin@email.com"
# sender_name = "Admin"
```

`diff` contra nuestro bloque: **idénticos salvo el encabezado de sección**. O
sea que `local_smtp` era un renombre que el CLI fijado todavía no acepta, no una
configuración distinta. Por eso el arreglo es el renombre y no una actualización
del CLI: subirlo cambiaría la versión contra la que se validan todas las
migraciones, que es una decisión aparte.

**Después**

```
$ supabase start
failed to inspect service: Cannot connect to the Docker daemon at unix:///var/run/docker.sock.
```

Pasa el parseo y llega hasta Docker, que el contenedor de trabajo no tiene y el
runner sí.

**Guardia** · `npm run supabase:config:check`, dentro de `npm run check`.

## 2 · El Commercial catalog gate no podía pasar nunca

**Antes**

```
$ npm run catalog:release:validate
ERROR Falta el catálogo real. Indicá TABA_CATALOG_FILE o pasá su ruta como argumento.
exit 1
```

Job afectado: «Web, backend, fiscal and security gates». Moría en el paso 9 de
18, dejando *skipped* las pruebas unitarias, el servicio fiscal, las firmas de
Mercado Pago, el E2E y el SBOM.

**Por qué no era un defecto del validador**

Fallar cerrado sin catálogo es su diseño, declarado en tres documentos y exigido
por su propia prueba (`tests/catalog-release-gates.test.mjs`). Es una compuerta
de *release*: el catálogo comercial aprobado se indica en el momento del
release y no vive en el repositorio.

**Por qué no se lo apuntó a un archivo del repo**

| candidato | resultado medido |
|---|---|
| `data/catalog-template.csv` | 21 columnas, 0 filas → «no contiene productos» |
| `catalog/products.csv` | 2.067 errores sobre 92 filas: otra disposición de columnas, y el validador exige imagen aprobada para cada producto |

Lo segundo además contradice el runtime comercial vigente: la migración 108 dejó
de exigir imagen para publicar, y 30 de los 33 SKU comprables se venden con el
recurso propio de TABA. Forzarlo sería cambiar la política comercial para que un
paso de CI se ponga verde.

**Después** · `npm run catalog:release:ci` distingue tres estados:

| estado | código | qué dice |
|---|---|---|
| hay catálogo | el de la compuerta estricta | `CORRIENDO sobre <ruta>` |
| mal indicado | 1 | `MAL INDICADA` — una variable mal escrita no se parece a «no había» |
| no hay catálogo | 0 | `NO CORRIÓ`, qué quedó sin validar y dónde sí corre |

La compuerta estricta no se tocó: `npm run verify` y `npm run release:folder`
la siguen corriendo con sus dientes puestos.

## 3 · `panel-timestamp-unambiguous` dependía del huso del runner

**Antes**, con el contenedor en UTC:

```
not ok 1 - el defecto de es-AR realmente confundía las dos horas
  + actual - expected
  + '13/8/2026, 12:30:00'
  - '12/8/2026, 12:30:00'
```

**Raíz** · El control formateaba sin declarar zona, así que leía la del aparato.
Los dos instantes de la prueba —21:30 y 09:30 de Argentina— caen el mismo día en
Argentina y en días distintos en UTC, de modo que los textos diferían por el
calendario y no por la ambigüedad de 12 horas que se estaba demostrando.

**Después** · Corrida bajo cinco husos:

| TZ | resultado |
|---|---|
| `UTC` | 5/5 |
| `America/Argentina/Buenos_Aires` | 5/5 |
| `Pacific/Auckland` | 5/5 |
| `America/Los_Angeles` | 5/5 |
| `Asia/Kolkata` | 5/5 |

## 4 · Una migración empezaba con BOM de UTF-8

Este no estaba en el encargo: **apareció al reparar el 1**. Mientras el config no
parseaba, el stack no arrancaba y las migraciones no se aplicaban nunca, así que
el defecto llevaba días tapado.

**Después de reparar el 1**, el job llegó a aplicar 112 migraciones y murió en la
113:

```
Applying migration 20260807155000_rider_map_location_contract_reconciliation.sql...
ERROR: syntax error at or near "﻿" (SQLSTATE 42601)
At statement: 0
﻿-- ============================================================================
^
```

Ese `﻿` es el BOM de UTF-8 (`EF BB BF`). Un editor de Windows lo pone solo, no se
ve en ningún diff, y Postgres lo lee como un carácter fuera de lugar antes del
primer statement. Costó igual que el anterior: ni las 162 aserciones pgTAP ni el
simulacro de restauración llegaron a correr.

**Archivos afectados** (los dos únicos del repositorio):

| archivo | rol |
|---|---|
| `supabase/migrations/20260807155000_rider_map_location_contract_reconciliation.sql` | el que mató la corrida |
| `supabase/tests/order_intake_dispatch_audit.local.sql` | prueba pgTAP; habría muerto igual al correrla |

**Fix** · Quitar los tres bytes. El contenido queda intacto (19.713 → 19.710 y
17.960 → 17.957 bytes).

**Guardia** · `npm run migrations:validate` mira el byte crudo de cada `.sql`
—leerlo como `utf8` esconde el BOM como un carácter invisible— y rechaza con un
error que dice cómo arreglarlo. Corre en CI antes del job caro, y tarda segundos.

## 5 · Deno reinstalaba `node_modules` y el E2E se quedaba sin navegadores

Este tampoco estaba en el encargo: **apareció al reparar el 2**. Mientras el
Commercial catalog gate fallaba en el paso 9, el job no llegaba nunca al 15, así
que el E2E llevaba días sin ejecutarse y nadie sabía cómo estaba.

Con el gate destrabado corrió por primera vez y perdió **460 de 462** pruebas,
todas con el mismo mensaje (corrida 32653485259, y otra vez en la 32653901067):

```
Error: browserType.launch: Executable doesn't exist at
  <cache de Playwright del runner>/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell
Executable doesn't exist at
  <cache de Playwright del runner>/webkit-2336/pw_run.sh
```

358 fallas de Chromium y 102 de WebKit. Pero el paso que descarga navegadores
había terminado **en verde**, seis pasos antes:

```
Chrome Headless Shell 148.0.7778.96 (playwright chromium-headless-shell v1223) downloaded to .../chromium_headless_shell-1223
WebKit 26.4 (playwright webkit v2287) downloaded to .../webkit-2287
```

1223 contra 1234. 2287 contra 2336. No faltaban navegadores: eran los de **otra
versión de Playwright**. Entre un paso y el otro `node_modules` cambió.

**Causa raíz** · El paso 14, `npm run test:webhook`, corría Deno con
`--node-modules-dir=auto`. Con esa bandera Deno ve el `package.json` de la raíz,
lo trata como proyecto Node y materializa `node_modules` resolviendo los
**rangos** de ese archivo contra el registro; el `package-lock.json` no lo lee.
`@playwright/test: ^1.60.0` resolvía a 1.62.1 y pisaba el 1.60.0 que `npm ci`
había instalado en el paso 4. En el log del paso 14:

```
Initialize playwright@1.62.1
Initialize @playwright/test@1.62.1
Initialize playwright-core@1.62.1
```

**Por qué nadie lo vio** · npm no se entera. Reproducido en este contenedor:

```
$ npm ci && node -p "require('./node_modules/@playwright/test/package.json').version"
1.60.0
$ npm run test:webhook            # sale 0: 22 pruebas Deno + 12 Node, todas verdes
$ node -p "require('./node_modules/@playwright/test/package.json').version"
1.62.1
$ diff <(...node_modules/.package-lock.json antes) <(... después)
cambiados=0 agregados=0 quitados=0
```

La contabilidad de npm sigue diciendo 1.60.0 con 1.62.1 en el disco. El paso que
rompe termina en verde, y el síntoma aparece ocho minutos después en un paso que
no habla de webhooks, disfrazado de «falta un navegador».

**Fix** · `--node-modules-dir=none`. Esas pruebas no necesitan nada del árbol de
npm: su única dependencia npm es `npm:mercadopago@3.2.1`, con la versión clavada
en el propio especificador, y Deno la resuelve de su caché global. Con `none`
corren las 22 igual y no tocan un archivo:

```
$ npm ci && npm run test:webhook
ok | 22 passed | 0 failed (652ms)
# pass 12  # fail 0
$ node -p "require('./node_modules/@playwright/test/package.json').version"
1.60.0
$ node scripts/check-node-modules-pinned.mjs
node_modules coincide con package-lock.json: 27 paquetes comprobados.
```

**Fix 2, por si vuelve por otro lado** · `@playwright/test` era la única
dependencia declarada con rango. Pasa a `1.60.0` exacto: la versión instalada no
cambia —el lockfile ya la fijaba— pero deja de haber margen para que alguna
herramienta que re-resuelva se lleve otra, y con Playwright otra versión son
otros navegadores.

**Guardia** · `scripts/check-node-modules-pinned.mjs` compara la versión **en
disco** de cada paquete instalado contra la que fija el lockfile. Corre en CI
entre el paso 14 y el 15 —después de lo que pisaba, antes de lo que se rompía—.
Sobre el árbol pisado dice:

```
node_modules NO coincide con package-lock.json.

  node_modules/@playwright/test
    lockfile: 1.60.0
    en disco: 1.62.1
```

Los opcionales de otras plataformas (`@img/sharp-darwin-arm64` y compañía) no
cuentan como falta: no se instalan acá a propósito.

**Regresiones** · `tests/node-modules-fijado-para-el-e2e.test.mjs`, 7 pruebas:
que el paso de Deno no lleve `auto`, que su única dependencia npm siga clavada en
el import, que ninguna dependencia declare rango, que el Playwright en disco sea
el del lockfile, que CI corra la guardia **entre** los dos pasos —el orden es el
defecto—, y que la guardia acepte un árbol sano y rechace uno pisado diciendo
`npm ci`.

## 6 · El arnés del aviso de PWA maquetaba 980 px, no 390

Con el 5 reparado, el E2E corrió entero por primera vez: **460 de 462**. Las dos
que quedaron son estas.

```
Error: el aviso se superpone al control: por eso tiene que poder cerrarse
Expected: "aviso"
Received: "control"
  tests/e2e/pwa-update-lifecycle.spec.mjs:232
```

La prueba afirma que el aviso de actualización TAPA el botón «Agregar» —esa es
la premisa de por qué el aviso tiene que poder cerrarse: le pasó a una persona
de verdad—. En el runner no lo tapaba.

**Causa raíz** · El arnés arma su propia página y le pide a Playwright un
contexto con `viewport: 390×664` e `isMobile: true`. Pero esa página **no
declara `meta viewport`**, y sin él Chromium en emulación móvil no maqueta a
390: cae a su ancho por defecto de 980 px y escala. El «viewport de iPhone 13»
que la prueba dice usar no existía dentro de la página.

Medido en este contenedor, con la misma página y las dos variantes:

| | ancho de maquetado | alto del aviso | y del aviso | centro del control | veredicto |
|---|---|---|---|---|---|
| sin `meta viewport` (como estaba) | **980×1668** | 47 px | 1538 | **1537** | `control` |
| con `meta viewport` | **390×664** | 80 px | 500 | 532 | `aviso` |

Un píxel, y del lado equivocado. A 980 px de maquetado el texto del aviso entra
en UNA línea, así que el aviso mide 47 px en vez de 80 y su borde superior cae
justo por debajo del centro del botón. Lo decidían las métricas de la tipografía
del aparato: donde el texto envolvía a dos líneas el aviso tapaba y la prueba
pasaba; en el runner no envolvía.

**Fix** · Declarar en el arnés el MISMO `meta viewport` que sirve `index.html`.
Con él la página maqueta 390×664 de verdad y la prueba mide lo que dice medir.

**Comprobado** · Con el arnés sin el meta, la prueba falla acá con el mismo
mensaje que en CI. Con el meta, las 5 del archivo pasan.

## 7 · «Volver al Rider» pisaba el botón de recentrado a 320 px

```
Error: 320px: el CTA no pisa el recentrado
Expected: <= 243
Received:    244
  tests/e2e/tracking-follow-mode.spec.mjs:167
```

Un píxel otra vez, y otra vez la tipografía. La píldora «Volver al Rider» mide
**170 px en este contenedor y 186 en el runner**: `system-ui` resuelve a fuentes
distintas y el mismo texto ocupa 16 px más. El diseño tenía 6 px de margen.

**Debajo del margen había un error de aritmética.** La píldora va CENTRADA sobre
el escenario, así que cada píxel que ocupa el control de la esquina hay que
reservarlo **dos veces**, uno de cada lado. El recentrado mide hasta 48 px y
vive a 15 del borde —63—, y `max-width` reservaba `100% - 118px`: menos que 63,
y menos aún que 126.

Medido con el marcado y el CSS reales, antes:

| caso | ancho de la píldora | holgura contra el recentrado | derrame |
|---|---|---|---|
| etiqueta real, tipografía de acá | 170 px | +14 px | — |
| etiqueta real, tipografía del runner | ~186 px | **−2 px** | — |
| etiqueta larga (clamp actuando) | 200 px | **+1 px de invasión** | **419 px de contenido en una caja de 200** |

La última fila es la peor: cuando el clamp SÍ actuaba, `white-space: nowrap` sin
`overflow` hacía que las letras cruzaran por encima del recentrado mientras la
caja —lo que mide una prueba— juraba que no lo tocaba. Una prueba que mide la
caja habría dado verde sobre eso.

**Fix**, en tres capas:

1. `max-width: calc(100% - 126px)` — el doble de la huella real del recentrado
   (15 + 48), que es lo que exige estar centrado. Hace que la invariante valga
   por construcción, sin depender de la tipografía.
2. El texto se recorta DENTRO de la píldora (`overflow: hidden`,
   `text-overflow: ellipsis`, `min-width: 0` para que el ítem flex pueda
   encogerse). El modo de falla deja de ser «tapar el control».
3. A ≤ 400 px la píldora se ajusta el cinturón —padding, gap, ícono y cuerpo—
   para que la etiqueta entera entre sin recortarse en los anchos que el gate
   recorre. Lo de arriba es la garantía; esto es para que no haga falta usarla.

Medido después, con el marcado y el CSS reales, en las cuatro anchuras del gate:

| anchura | etiqueta real | tipografía más ancha | etiqueta imposible |
|---|---|---|---|
| 320 px | +20,8 px | +12,6 px | +3 px |
| 360 px | +40,8 px | +32,6 px | +3 px |
| 390 px | +55,8 px | +47,6 px | +3 px |
| 432 px | +70,0 px | +62,8 px | +3 px |

Holgura positiva en los doce casos y derrame cero en todos. Antes, el peor caso
real era −2.

**Guardia** · `tests/mapa-pildora-no-pisa-el-recentrado.test.mjs` comprueba la
ARITMÉTICA, no el píxel: que la reserva cubra dos veces la mayor huella
declarada del recentrado —la hoja lo redefine cuatro veces y cuál gana depende
del estado del pedido, así que se toma el peor—, que la píldora siga centrada
(que es lo que obliga al doble), y que el recorte y el bloque angosto sigan
puestos. Corre en segundos; el píxel lo sigue midiendo el E2E.

**Identidad de release** · Cambiar `styles/tracking.css` obliga a rotar
`CACHE_NAME` y el `?v=` de los archivos que lo llevan, y a volver a firmar. Es
la disciplina del repositorio para que la corrección llegue a las instalaciones
existentes sin que nadie borre nada:
`la-taba-runtime-v84-recepcion-idempotente` → `la-taba-runtime-v85-pildora-del-mapa`,
`?v=52` → `?v=53`.

## Verificación local de la rama reparada

| comprobación | resultado |
|---|---|
| `npm run check` | verde |
| `npm test` | 2082/2082, contenedor en UTC |
| `npm run migrations:validate` | verde |
| `npm run catalog:images:verify` | verde |
| `npm run catalog:release:ci` | verde, declarando que la compuerta no corrió |
| `npm run secrets:scan` | verde |
| `npm audit --omit=dev` (raíz y fiscal) | 0 vulnerabilidades |
| `fiscal:build` + `fiscal:test` | 22/22 |
| `npm run test:webhook` | 12/12 |
| `npm run migrations:validate` con BOM inyectado | rechaza, como debe |
| `supabase start` con el CLI 2.101.0 | pasa el parseo |

| `npm run deps:pinned:check` | verde, 27 paquetes comprobados |
| `npm run deps:pinned:check` con el árbol pisado | rechaza, nombrando el paquete y las dos versiones |
| `npm run check` (identidad de release) | verde tras rotar `CACHE_NAME` y `?v=` |
| `pwa-update-lifecycle.spec.mjs` en Chromium local | 5/5 con el fix; sin él falla con el mensaje de CI |
| geometría de la píldora del mapa, 4 anchuras × 3 tipografías | holgura positiva en 12/12, derrame 0 |

El E2E completo no se pudo correr en el contenedor de trabajo: necesita webkit,
y sólo hay un Chromium de build distinto al que fija Playwright. Sí se corrieron
specs sueltos apuntando ese Chromium, y el mapa del defecto 7 no dibuja acá —sin
red para los tiles, el botón de recentrado ni siquiera existe—, así que esa
geometría se midió con el marcado y el CSS reales en vez de a través del test.

Lo que sí se comprobó acá, entero: la causa del 5 —el pisotón, que npm no lo
registre, que `none` lo evite y que la guardia lo atrape—, el 6 reproducido y
cerrado sobre el test real, y la invariante del 7 en las cuatro anchuras del
gate bajo tres tipografías.

## Estado de los jobs

Corrida **32653901067**, sobre `1789533` (defectos 1 a 4 reparados):

| job | resultado |
|---|---|
| Migrations, pgTAP and isolated restore | **verde** — 1 y 4 reparados: aplicó todas las migraciones, corrió las 162 aserciones y el simulacro de restauración |
| Windows Rust and unsigned verification bundles | **verde** |
| Web, backend, fiscal and security gates | pasos 1–14 verdes (2 y 3 reparados), rojo en el E2E por el defecto 5 |

Corrida **32654796604**, sobre `38ca699` (defecto 5 reparado):

| job | resultado |
|---|---|
| Migrations, pgTAP and isolated restore | **verde** |
| Windows Rust and unsigned verification bundles | **verde** |
| Web, backend, fiscal and security gates | paso 15 —la guardia de `node_modules`— **verde**; el E2E corrió **26,8 minutos** en vez de morir a los 4, y pasó **460 de 462**. Las 2 restantes son los defectos 6 y 7 |

Corrida **32658459787**, sobre `9fdb8c4` (los siete reparados):

| job | resultado |
|---|---|
| Migrations, pgTAP and isolated restore | **verde** — 13 pasos, 0 no exitosos |
| Windows Rust and unsigned verification bundles | **verde** — 14 pasos, 0 no exitosos |
| Web, backend, fiscal and security gates | **verde** — 22 pasos, 0 no exitosos |

Corrida entera en **success**. Dentro del job web:

| paso | resultado |
|---|---|
| Commercial catalog gate | verde, declarando en el log que la compuerta NO corrió y qué quedó sin validar |
| Unit and contract tests | **2093/2093** |
| Locked dependencies still match the lockfile | verde, 27 paquetes comprobados |
| Full browser E2E | **462 passed (33,3 min)** |

Y en el de base de datos: el stack levantó con el CLI 2.101.0, se aplicaron
todas las migraciones, corrieron las 180 aserciones pgTAP y el simulacro de
restauración verificó el ciclo completo (1.443.103 bytes en 1.724 ms).

El salto del E2E es la medida de la cascada: **2** pruebas pasadas cuando el
gate se destrabó, **460** con el defecto 5 reparado, **462** con el 6 y el 7.
