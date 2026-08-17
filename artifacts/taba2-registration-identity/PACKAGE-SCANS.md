# TABA2 · Escaneos de paquete y de configuración

## 1. Cliente web (Customer + Panel)

`npm run check` — siete verificaciones en cadena.

| Verificación | Resultado |
|---|---|
| `check-syntax` | PASS |
| `check-static-assets` | PASS |
| `check-precache-graph` | PASS · 94 módulos del grafo estático del cliente, todos en `sw.js` |
| `check-release-hygiene` | **FALLA por 7 hallazgos preexistentes** (ver §4) |
| `check-release-identity` | PASS · digest `6e04bc61711e2510…`, 127 archivos, `CACHE_NAME la-taba-runtime-v67-rider-multi-order` |
| `check-location-contract` | PASS |
| `scan-secrets` | PASS · «no assigned payment credentials or private keys found» |

### Búsquedas específicas sobre lo publicable

| Qué se buscó | Dónde | Resultado |
|---|---|---|
| `service_role` / `sb_secret_` | `js/`, `index.html`, `sw.js`, `runtime-config.js` | **0 claves**. Las dos únicas apariciones del texto son una lista de jerga que el Panel filtra de la copia visible, y un comentario que advierte no incluirla. |
| clave JWT o secreta embebida (`eyJ…`, `sb_secret_…`) | idem | **0** |
| referencia a staging (`ukxqbgswjlibmnjemrzd`) | idem | **0** |
| `runtime-config.js` publicado | repo | plantilla vacía, falla cerrado: el despliegue reemplaza el objeto comentado |

### Los dos módulos nuevos y el precache

`business-access-registration.js` y `business-access-inbox.js` llegan por el
mismo camino que sus 34 hermanos del Panel: import dinámico. El aviso del
verificador de precache sigue diciendo **34**, es decir que los nuevos no
cambiaron esa cuenta, y su propio texto lo clasifica: «no es un camino del
cliente». El Panel se usa con red; el cliente que compra es el que tiene que
funcionar sin ella.

## 2. App Rider

### Búsquedas sobre el árbol que se compila

| Qué se buscó | Resultado |
|---|---|
| `service_role` / `SUPABASE_SERVICE` en `lib/` y `android/app/src/main/` | **0 usos**. Las 8 apariciones del texto están todas dentro de `NativeAuthConfig.kt`, y son **el guard que lo rechaza** más el comentario de un falso positivo histórico. |
| clave JWT o secreta embebida | **0** |
| flavor `production` apuntando a staging | no: cada flavor trae sus propios `buildConfigField` y production no lee ningún default |

### `NativeAuthConfig` intacto

```
git diff a23b6e4..HEAD -- android/app/src/main/kotlin/com/lataba/rider/auth/NativeAuthConfig.kt
                           android/app/build.gradle.kts
→ (vacío)
```

La Fase 25 pedía no tocar la seguridad de `NativeAuthConfig`. No se tocó **ni un
byte**, ni en el runtime ni en la capa de packaging.

### Lo que este escaneo NO cubre

`tool/package_scan.dart` inspecciona un **artefacto construido** —`classes*.dex`,
`resources.arsc`, el manifiesto binario, `assets/**` y el snapshot AOT de
`lib/**`— y se niega a analizar un paquete de depuración. Correrlo exige un
`assembleProductionRelease`, que a su vez exige el keystore de firma y la
aprobación de piloto que el bloque `gradle.taskGraph.whenReady` verifica.

Eso es una **compuerta humana preexistente**, ajena a esta misión, y no cambió:
el alta autogestionada no agregó ninguna configuración nueva al artefacto. Queda
como P1 en el informe final, con el procedimiento que ya existe
(`.github/workflows/signed-production-candidate.yml`).

## 3. Herramientas que sí usan `service_role`, y por qué está bien

Dos, las dos de línea de comandos, ninguna en un cliente:

| Herramienta | Para qué |
|---|---|
| `scripts/bootstrap-first-business-owner.mjs` | crear el primer owner de un entorno vacío; es la única escritura de identidad habilitada fuera de las RPC |
| `scripts/live-registration-smoke.mjs` | crear y borrar identidades QA sintéticas del smoke |

Las dos leen la credencial del entorno o del Credential Manager, ninguna la
imprime, y las dos pasan primero por
`scripts/assert-production-supabase-target.mjs`.

## 4. Los 7 hallazgos preexistentes de higiene

`check-release-hygiene` falla por rutas absolutas de disco local en archivos
versionados de **misiones anteriores**:

```
artifacts/production-remediation/CLEANUP-LOCAL-SHADOW.md   línea 44
artifacts/production-remediation/CLEANUP-LOCAL-SHADOW.md   línea 78
docs/RIDER-MULTI-ORDER-HANDOFF.md                          líneas 14, 15, 17, 18, 222
```

Verificado como preexistente: la misma verificación falla con los mismos 7
hallazgos sobre el árbol base (`39f13d0`), antes de un solo cambio de esta misión.
Ninguno de los archivos nuevos de esta misión aparece en la lista.

No se corrigieron a propósito. Editar la evidencia de otra misión para que una
compuerta pase de rojo a verde degrada la evidencia, que es lo único que esa
compuerta protege. Queda como P1 con su lista exacta.
