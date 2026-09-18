# TABA Rider — artefacto de la candidata

**Fecha de corte:** 2026-09-18 · acompaña a `TABA-PRODUCTION-RC-MANIFEST.md`

## Identidad del artefacto

| Campo | Valor |
|---|---|
| `RIDER_RELEASE_HEAD` | `5231a87fc8df9d0b37b263938304935b9213a2d4` |
| Repositorio | `D:\1212\la-taba-rider-production-rc1` |
| Rama | `release/taba2-rider-production-rc1` |
| Remoto | **ninguno** — el repositorio del Rider no tiene remoto configurado |
| Árbol de trabajo | limpio |
| Sabor | `commercialReview` |
| `PACKAGE_ID` | `com.lataba.rider.review` |
| `VERSION_NAME` | `1.0.0` |
| `VERSION_CODE` | `1` |
| Tipo | APK |
| Modo | **release** (no debug) |
| Firma | **sin firmar** — ver el bloqueante abajo |
| Ruta | `build/app/outputs/flutter-apk/app-commercialreview-release.apk` |
| Tamaño | 53.012.914 bytes (50,6 MB) |
| `SHA-256` | `157ee555cf21882e37bc1283099c43693d0cc5fdb2eee7ebc88eb9a74edd419b` |
| compileSdk | 36 |

## Qué reemplaza, y por qué hacía falta

El único artefacto que había registrado era
`artifacts/android-local/RELEASE.json`, y no correspondía a este código:

| | Artefacto anterior | Este artefacto |
|---|---|---|
| Commit | `214d2b4` | `5231a87` |
| Distancia | **86 commits atrás** de la punta auditada | la punta auditada |
| Canal | `staging_debug_verification` | `commercialReview` release |
| Modo | **debug** | release |
| Backend | staging `ukxqbgswjlibmnjemrzd` — **borrado** | ninguno, por diseño |
| Tamaño | 162.011.582 bytes | 53.012.914 bytes |
| Desplegado | `deployPerformed: false` | no aplica |

`214d2b4` sí es antepasado de `5231a87`, así que no había nada perdido ni
divergente: simplemente el APK registrado era viejo, era debug y apuntaba a un
proyecto Supabase que ya no existe. **Cualquier Rider construido con el sabor
`staging` hoy habla con una base inexistente**, porque ese ref está fijo en
`lib/core/config/flavor.dart:34` y en `android/app/build.gradle.kts:70-71`.

## Por qué `commercialReview` y no `staging` ni `production`

- **`staging`** apuntaría al proyecto borrado. Construirlo sería producir otro
  artefacto que no puede funcionar.
- **`production`** no se puede construir: sus cuatro valores de backend salen de
  variables de entorno protegidas por
  `TABA2_CONTROLLED_PRODUCTION_PILOT_APPROVAL` y **no hay nada en el
  repositorio**. `AppFlavor.production.backendProjectRef` devuelve `null`. Es
  deliberado y es correcto: sin autorización de piloto, la compuerta de Gradle
  rechaza el build.
- **`commercialReview`** no lleva ninguna configuración de backend —cadenas
  vacías en los cuatro `buildConfigField`— y se alimenta de fixtures locales.
  Es el único sabor que se construye y corre sin depender de un backend vivo.

Sirve para lo que hacía falta acá: demostrar que la punta auditada **compila en
modo release**, y dejar un artefacto con identidad registrada que reemplace al
debug viejo.

## `RIDER_RELEASE_SIGNING_BLOCKER`

**SÍ.** El APK está **sin firmar**: `apksigner verify` devuelve
`DOES NOT VERIFY — Missing META-INF/MANIFEST.MF`. En consecuencia **no se puede
instalar en un teléfono**.

La causa no es un error del build. `android/app/build.gradle.kts` sólo configura
la firma si están las cuatro variables de entorno
`TABA_ANDROID_KEYSTORE_PATH`, `TABA_ANDROID_KEYSTORE_PASSWORD`,
`TABA_ANDROID_KEY_ALIAS` y `TABA_ANDROID_KEY_PASSWORD`; si falta alguna,
`signingConfig = null`. No hay `android/key.properties` y **no existe ningún
keystore de TABA**.

El único keystore presente en esta máquina es
`D:\secure\bitflow-signing\bitflow-production.jks`, que pertenece a **Bit Flow /
APEX, otro producto**. Firmar el Rider de TABA con esa clave ataría la identidad
de la aplicación de TABA a la clave de otro producto: es una decisión de
identidad difícil de revertir —Android no deja cambiar la clave de firma de un
`applicationId` ya distribuido— y no se tomó. No se inventaron credenciales.

Para un artefacto instalable hace falta una de estas dos, y las dos son
decisiones externas:

1. crear un keystore de TABA, guardarlo como se guarda el de Bit Flow, y
   exportar las cuatro variables; o
2. construir en modo debug, que se firma con la clave de depuración — sirve para
   probar en un teléfono, no para distribuir.

## Pruebas

Ver el informe de la reconciliación para el resultado de `flutter test` sobre
`5231a87`.

## Contratos con la candidata de comercio

`npm run location:check` con `TABA_RIDER_REPO` apuntando a este repositorio
verifica la coordenada del comercio en las dos superficies a la vez:

```
contrato de ubicación: La Taba 2 — Mendoza 827, Neuquén
  -38.9460616, -68.0533209  source=public_directory_cross_checked
  Rider verificado en D:/1212/la-taba-rider-production-rc1
las superficies coinciden con el contrato.
```

Hasta este corte esa comprobación venía **salteándose en silencio**: sin la
variable, el script avisa «no se encontró el repositorio del Rider al lado; su
coordenada no se verificó» y **igual sale en verde**. Conviene exportar
`TABA_RIDER_REPO` en cualquier corrida que pretenda acreditar el contrato.

El resto de los contratos entre apps —intake, asignación, retiro, entrega,
código de entrega— **no se pudo ejercitar**: pide un backend de staging vivo, y
no lo hay. Queda `SIN VERIFICAR EN VIVO`.
