# Reparación del baseline de CI · 2026-08-23

Tres defectos preexistentes en `main` dejaban CI rojo en **todas** las ramas.
Al repararlos aparecieron otros dos que estaban tapados detrás: mientras el job
moría en el paso 6 o en el 9, los pasos de más abajo no llegaban a correr, y lo
que estaba roto ahí no se veía. **Cinco en total.** Ninguno era de producto.

Este documento guarda la evidencia de que existían y de que dejaron de existir,
para que la reparación se pueda auditar sin creerle a nadie.

| # | defecto | job | lo tapaba |
|---|---|---|---|
| 1 | `supabase start` no parseaba `config.toml` | migraciones | — (del encargo) |
| 2 | el Commercial catalog gate no podía pasar nunca | web | — (del encargo) |
| 3 | `panel-timestamp-unambiguous` leía el huso del runner | web | — (del encargo) |
| 4 | una migración empezaba con BOM de UTF-8 | migraciones | el 1 |
| 5 | Deno reinstalaba `node_modules` y rompía el E2E | web | el 2 |

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

`npm run test:e2e` no se pudo correr en el contenedor de trabajo: necesita
webkit, y sólo hay un Chromium de build distinto al que fija Playwright. Ese
paso lo verifica CI, que además ahora lo corre de verdad: con el gate destrabado
dejó de quedar *skipped*.

Lo que sí se pudo comprobar acá sobre el defecto 5 es su causa entera —el
pisotón, que npm no lo registre, que `none` lo evite y que la guardia lo
atrape—, que es lo que decide si el E2E encuentra sus navegadores.

## Estado de los jobs

Corrida 32653901067, sobre `1789533` (los defectos 1 a 4 reparados, el 5 todavía
no):

| job | resultado |
|---|---|
| Migrations, pgTAP and isolated restore | **verde** — 1 y 4 reparados: aplicó todas las migraciones, corrió las 162 aserciones y el simulacro de restauración |
| Windows Rust and unsigned verification bundles | **verde** |
| Web, backend, fiscal and security gates | pasos 1–14 verdes (2 y 3 reparados), rojo en el 15 por el defecto 5 |
