# TABA2 · Builds y previews

## 1. Cliente web (Customer + Panel)

Es un sitio estático: `index.html`, `js/`, `styles/`, `sw.js`. No hay paso de
bundling, así que «build» acá significa que el árbol publicable esté coherente y
firmado.

| | |
|---|---|
| `check-syntax` | PASS |
| `check-static-assets` | PASS |
| `check-precache-graph` | PASS · 94 módulos del grafo estático del cliente, todos en `sw.js` |
| `check-release-identity` | PASS · 127 archivos, digest `8b239b4b9f132192…`, `CACHE_NAME la-taba-runtime-v67-rider-multi-order` |
| `scan-secrets` | PASS |
| `runtime-config.js` | plantilla vacía: el árbol publicado **no** trae URL ni clave |

La firma se regeneró dos veces durante la misión, porque cambiaron archivos
publicables. La segunda vez es la que quedó.

## 2. App Rider

| | |
|---|---|
| `flutter analyze` | **No issues found** |
| `flutter test` | 632 / 632 |
| `:app:testStagingDebugUnitTest` | 195, 0 fallos |
| `:app:testProductionDebugUnitTest` | 195, 0 fallos |
| `:app:assembleStagingDebug` | **BUILD SUCCESSFUL** (16 min) · `app-staging-debug.apk`, 153,9 MB |

El `assemble` importa más de lo que parece: encadena `compileStagingDebugKotlin`
—el Kotlin nuevo— con `compileFlutterBuildStagingDebug` —el snapshot Dart— y con
el empaquetado. Es la prueba de que las dos mitades del alta compilan juntas y
entran en un APK.

### Lo que falta, y de quién depende

`tool/package_scan.dart` **se niega a analizar un paquete de depuración**, a
propósito: un escaneo de un debug no dice nada sobre lo que se publica. Correrlo
exige `assembleProductionRelease`, que a su vez exige el keystore de firma y la
aprobación de piloto que verifica el bloque `gradle.taskGraph.whenReady`.

Eso es una compuerta humana **preexistente** y no cambió: el alta autogestionada
no agregó ninguna configuración nueva al artefacto, y
`NativeAuthConfig.kt` + `build.gradle.kts` no tienen un byte de diferencia
respecto de `a23b6e4`. El procedimiento ya existe en
`.github/workflows/signed-production-candidate.yml`.

Queda como P1: **firmar y escanear el APK de producción**.

## 3. Previews

No se desplegó ninguna preview, y conviene decir por qué en vez de dejar la línea
vacía.

| Lo que la Fase 60 pedía | Estado |
|---|---|
| preview de rama de Customer/Business contra un entorno seguro | **no desplegada** |
| no mover el alias de producción | respetado: no se tocó ningún alias |
| preview mutante que administre producción | **evitado**, ver abajo |

El motivo es de seguridad, no de tiempo. Una preview del Panel sólo es útil si
puede *entrar* a un backend, y hoy el único backend con las migraciones 104-107
aplicadas **es producción**. Publicar una preview de rama apuntada a producción
sería exactamente lo que la propia Fase 60 prohíbe: «No permitir que preview
mutante administre production real».

Las dos alternativas honestas, las dos con una dependencia humana:

1. **Aplicar 104-107 a staging** (`ukxqbgswjlibmnjemrzd`) y apuntar la preview
   ahí. Requiere autorización explícita: esta misión tuvo
   `STAGING MUTATIONS = 0` como regla, y se respetó.
2. **Levantar el stack shadow con Kong expuesto** y apuntar una preview local.
   Sirve para revisar diseño, no para certificar nada que no esté ya certificado
   por las 521 pruebas de base y el smoke contra producción.

Mientras tanto, lo que una preview mostraría **ya está capturado**: las 21
capturas de `screenshots/` son el markup y la hoja de estilos reales renderizados
por Chromium en los tres anchos que la misión pidió.

Queda como P1: **preview de rama, con la decisión previa de contra qué backend**.
