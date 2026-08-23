# Reparación del baseline de CI · 2026-08-23

Tres defectos preexistentes en `main` dejaban CI rojo en **todas** las ramas.
Ninguno era de producto. Este documento guarda la evidencia de que existían y de
que dejaron de existir, para que la reparación se pueda auditar sin creerle a
nadie.

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

## Verificación local de la rama reparada

| comprobación | resultado |
|---|---|
| `npm run check` | verde |
| `npm test` | 2079/2079, contenedor en UTC |
| `npm run migrations:validate` | verde |
| `npm run catalog:images:verify` | verde |
| `npm run catalog:release:ci` | verde, declarando que la compuerta no corrió |
| `npm run secrets:scan` | verde |
| `npm audit --omit=dev` (raíz y fiscal) | 0 vulnerabilidades |
| `fiscal:build` + `fiscal:test` | 22/22 |
| `npm run test:webhook` | 12/12 |
| `supabase start` con el CLI 2.101.0 | pasa el parseo |

`npm run test:e2e` no se pudo correr en el contenedor de trabajo: necesita
webkit, y sólo hay un Chromium de build distinto al que fija Playwright. Ese
paso lo verifica CI, que además ahora lo corre de verdad: con el gate destrabado
dejó de quedar *skipped*.
