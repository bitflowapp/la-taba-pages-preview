# Rider · APK productivo para la prueba física

Construido el **2026-08-17** para certificar el flujo humano real:
identidad → login Rider → solicitud → pending → owner aprueba → Rider operativo.

---

## 1. La autoridad, elegida por contención y no por fecha

`feature/taba2-rider-self-registration` @ **`e251713`**.

No se compiló a ciegas: se comprobó que ese commit **contiene** las doce líneas
de trabajo, con `git merge-base --is-ancestor`. Todas dieron CONTENIDA:

| línea | rama |
|---|---|
| self registration (`sign_up_page.dart`, `access_application_page.dart`) | es el propio `e251713` |
| production auth | `feature/taba2-rider-production-auth` |
| habilitación externa productiva | `release/taba2-rider-production-external-enablement` |
| RC2 e integración RC2 | `release/taba2-rider-production-rc2`, `…rc2-integration` |
| release hardening | `chore/taba2-rider-release-hardening-rc2` |
| map polish v2 · sheet UX · map hardening | `feature/taba2-rider-map-polish-v2`, `…sheet-ux-polish`, `…map-hardening` |
| multi-order y su board fix | `feature/taba2-rider-multi-order`, `…multi-order-board-fix` |
| commercial polish | `feature/taba2-rider-commercial-polish` |
| pilot integration | `feature/taba2-rider-pilot-integration` |

**Y por qué hacía falta rehacerlo:** el APK que ya existía se construyó desde
`a23b6e41`, que es **el commit anterior**. Las dos pantallas que este gate
necesita —alta y solicitud de acceso— no existen ahí. Verificado con
`git ls-tree`: en `a23b6e41` esos archivos no están.

## 2. El artefacto

| | |
|---|---|
| ruta | `build/app/outputs/flutter-apk/app-production-profile.apk` |
| tamaño | **70,5 MB** |
| package | **`com.lataba.rider`** (el de producción; staging sería `com.lataba.rider.staging`) |
| versionCode | **145** — derivado de `git rev-list --count HEAD`, no se puede resetear |
| versionName | 1.0.0 · label `TABA2` |
| minSdk / targetSdk | 24 / 36 |
| flavor · tipo | `production` · **profile** |
| firma | **clave de depuración** |

### Por qué `profile` y no `release`

El `build.gradle.kts` exige un keystore de subida aprobado para cualquier tarea
`…Release` de production, y no hay fallback a la clave debug. **No se inventó
ningún keystore productivo.** La compuerta se lee en el código: se dispara sólo
para tareas que matchean `^(assemble|bundle|package|install)…Release(Bundle)?$`,
así que un build `profile` queda firmado con la clave de depuración —instalable
para una prueba física— y con la configuración productiva real.

Es el mismo tipo de artefacto que la misión anterior había dejado, y no sirve
para Play Store, que es exactamente lo que se pidió.

## 3. La configuración productiva, inyectada por entorno

El flavor `production` no trae valores en el árbol: los toma del entorno, y sólo
si la autorización explícita está presente (`gatedProductionValue`).

| variable | valor |
|---|---|
| `TABA2_CONTROLLED_PRODUCTION_PILOT_APPROVAL` | la cadena exacta que exige el gradle |
| `TABA_PRODUCTION_BACKEND_PROJECT_REF` | `wwcpogltfgzgkrlilbcd` |
| `TABA_PRODUCTION_SUPABASE_URL` | `https://wwcpogltfgzgkrlilbcd.supabase.co` |
| `TABA_PRODUCTION_PUBLISHABLE_KEY` | la clave **publicable** (46 car.) |
| `TABA_PRODUCTION_BUSINESS_ID` | `00000000-0000-4000-8000-000000000001` |

Las variables se limpiaron del entorno al terminar.

## 4. Escaneo del paquete

Con la herramienta del propio repo, que lee **el artefacto y no el árbol**:

```
dart run tool/package_scan.dart --artifact …app-production-profile.apk \
  --channel production --expect-host wwcpogltfgzgkrlilbcd.supabase.co
```

| | |
|---|---|
| entradas | 186 |
| bytes | 82.589.798 |
| **backend hosts** | **`wwcpogltfgzgkrlilbcd.supabase.co`**, y ninguno más |
| findings | **[]** |
| veredicto | **`clean: true`** |

### Segunda verificación, independiente

Extrayendo las 186 entradas y buscando por patrón:

| patrón | resultado |
|---|---|
| ref de producción | presente (`classes7.dex`, `classes9.dex`) |
| **ref de staging** | **ninguna coincidencia** |
| business canónico | presente |
| clave publicable | presente, 46 caracteres |
| **`service_role`** | **ninguna coincidencia** |
| `sb_secret_` | **1 coincidencia — y es un prefijo suelto de 10 caracteres, sin nada detrás** |

Ese último se miró de cerca en vez de darlo por bueno o por malo: es el literal
de la guardia que **rechaza** claves secretas, no una credencial. Una clave real
tendría ~30 caracteres más. La misma distinción que hace el escáner del repo
cuando dice que sus reglas matchean la forma del valor y no la mención del
nombre.

## 5. Espacio en disco

No hizo falta liberar nada para compilar. El build usó los caches dedicados que
ya existían en la unidad con espacio:

| | |
|---|---|
| `PUB_CACHE` | `D:\1212\taba-rider-pub-cache` (13.413 entradas) |
| `GRADLE_USER_HOME` | `D:\1212\taba-rider-gradle-home` (62.121 entradas) |
| `TMP` / `TEMP` | `D:\1212\taba-rider-temp` |
| temp de la JVM | `D:\Work\tmp` (ya estaba en `JAVA_TOOL_OPTIONS`) |

D: tenía 60 GB libres. **C: no participó del build** y quedó como estaba (2,35 GB
libres, después de los 2,27 GB que se habían liberado antes vaciando el Temp del
usuario). No se tocó Docker ni ningún dato.

## 6. Lo que falta, y es físico

`adb devices` no lista ningún aparato, ni después de reiniciar el servidor. El
teléfono **`ZY32LHS6PS` no está conectado**.

El lock del aparato quedó **libre**, con una condición heredada del gate anterior
que se respeta: `com.bitflow.inspecciones` no se reinstala, no se degrada, no se
le borran datos y no se desinstala. La instalación del Rider es de otro package
(`com.lataba.rider`) y no lo toca.
