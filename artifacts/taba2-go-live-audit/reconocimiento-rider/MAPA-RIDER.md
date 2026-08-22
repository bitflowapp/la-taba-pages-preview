# MAPA DE AUTOMATIZACIÓN — TABA2 Rider (producción, Moto G15)

Reconocimiento del **2026-08-22 04:43–04:47 (-03)** sobre el dispositivo `ZY32LHS6PS`.
Sesión **REAL de producción**. No se cambió ningún estado de pedido.

> **Este documento se escribió observando el aparato, no suponiendo.** Cada `bounds` de las
> tablas sale de un `uiautomator dump` real que está guardado en `dumps/`.

---

## 0. Resumen de una línea

La app **es automatizable por ADB con taps por coordenada**, porque Flutter publica un árbol de
accesibilidad rico (`content-desc` en todo) y **ningún control del flujo usa swipe**. Lo que **no**
es automatizable es el tramo humano: huella, pantalla de bloqueo, permisos nativos y el salto a
Google Maps. Y hoy, además, **este teléfono no puede usarse para ensayar el flujo**: tiene una
entrega real viva.

---

## 1. Estado actual del dispositivo (verificado, no modificado)

### 1.1 Dispositivo

| Dato | Valor | Cómo se obtuvo |
|---|---|---|
| Serial ADB | `ZY32LHS6PS` | `adb devices -l` |
| Modelo | `moto_g15` (`product:lamu_g`, `device:lamu`) | `adb devices -l` |
| **Resolución física** | **1080 x 2400 px** | `adb shell wm size` |
| **Densidad** | **400 dpi** (≈2.5x; 1 dp = 2.5 px) | `adb shell wm density` |
| Barra de navegación | `[0,2280][1080,2400]` (120 px de alto, 3 botones) | dump |
| Pantalla encendida | **Sí** (`mScreenOnFully=true`, `mWakefulness=Awake`) | `dumpsys power` |
| Pantalla bloqueada **ahora** | **No** (`mScreenLocked=false`, `showing=false`) | `dumpsys window policy` |
| **¿Tiene bloqueo seguro?** | **SÍ — `secure=true`, `deviceHasKeyguard=true`** | `dumpsys window policy` |
| Timeout de pantalla | `2147483647` ms (**nunca se apaga sola**) | `settings get system screen_off_timeout` |
| Servicio de accesibilidad activo | **Ninguno** (`enabled_accessibility_services=null`, `accessibility_enabled=0`) | `settings get secure` |

### 1.2 Paquetes Rider instalados

| Paquete | versionName | versionCode | Instalado | Rol |
|---|---|---|---|---|
| **`com.lataba.rider`** | **1.0.0** | **145** | 2026-08-17 19:18 | **PRODUCCIÓN — el que tiene la sesión real** |
| `com.lataba.rider.staging` | 1.0.0 | 1 | 2026-08-15 20:02 | staging |
| `com.lataba.rider.review` | 1.0.0 | 1 | 2026-08-15 19:03 | revisión comercial |
| `com.lataba.rider.staging.test` | (null) | 0 | 2026-08-12 02:06 | APK de instrumentación |

Actividad de lanzamiento: **`com.lataba.rider/.MainActivity`** (`android.intent.action.MAIN` + `LAUNCHER`).

> ⚠️ **El `versionCode=145` NO sale de `pubspec.yaml`** (que declara `1.0.0+1`). Sale de
> `.github/workflows/signed-production-candidate.yml:73` → `--build-number ${{ github.run_number }}`.
> Es decir: **145 es el número de corrida de GitHub Actions, no una versión del repo.** No se puede
> mapear a un commit leyendo el APK.

### 1.3 ¿Está autenticado? ¿Qué muestra al abrir?

**Sí, autenticado.** Al abrir muestra, en este orden:

1. **Una hoja modal de biometría** (`capturas/rider-01-home.png`): «Protegé tu sesión» →
   `Activar huella o rostro` / `Ahora no`. Bloquea el resto con un `Scrim`.
2. Detrás, ya cargado: **el mapa operativo con la entrega activa**.

El cajón lateral confirma la identidad: **«Hola» / «TABA2 Rider» / chip `PRODUCCIÓN`**, con
**«Seguimiento activo — Tu ubicación se está publicando»** y «Última sincronización 04:45».

### 1.4 ⚠️ SÍ tiene un pedido activo — y es LT-0001

| Campo | Valor observado |
|---|---|
| Pedido | **`LT-0001`** ← *el que está expresamente prohibido tocar* |
| Estado (cápsula del mapa) | **`Yendo al cliente`** (= `OrderStatus.onTheWay`) |
| Estado (lista Entregas) | **`En camino`** |
| Título de la hoja | `Llevá el pedido al cliente` |
| Retiro | La Taba 2 — Mendoza 827 — 25–31 m aprox. |
| Entrega | Mendoza 851, Neuquén Capital — 1.3 km aprox. |
| Contenido | 1 productos — Total ARS 17100.0 |
| Seguimiento | `GPS activo y publicación confirmada · Última confirmación hace 0s` |
| **CTA en pantalla** | **`Llegué`** en `[40,2110][1040,2250]` |

> 🔴 **Consecuencia operativa:** el próximo tap sobre `Llegué` avanza LT-0001 a `arrived` **en
> producción**. Ese botón está a un solo tap de distancia y ocupa el 20 % inferior de la pantalla.
> Cualquier harness que se ejecute contra este dispositivo **con esta sesión** puede romper un
> pedido real por un tap mal calculado.

### 1.5 Qué se hizo y qué no

**Se hizo** (todo reversible / no destructivo): `adb devices`, `dumpsys`, `am start`, `screencap`,
`uiautomator dump`, `adb pull`, un `KEYCODE_BACK` para cerrar la hoja de biometría, y navegación de
sólo lectura al cajón → «Entregas» → vuelta a «Inicio».

**No se hizo:** ningún `pm clear`, ninguna desinstalación, ningún cierre de sesión, ninguna
instalación de APK, ningún cambio de estado de pedido, ningún tap sobre `Llegué`, `Cerrar sesión`
ni `Activar huella o rostro`. **No se hizo `force-stop`** a propósito: la app está publicando GPS
para LT-0001 y matarla cortaría el seguimiento de una entrega viva.

**Estado en que quedó el teléfono:** app abierta en Inicio, LT-0001 intacto en `Yendo al cliente`.
Se borraron los `/sdcard/rider-0*.png|xml` que generó este reconocimiento. Se respetó un
`/sdcard/rider-cert-current.xml` preexistente que no es de esta sesión.

---

## 2. Jerarquía de UI — cómo se ve el árbol de verdad

### 2.1 El hallazgo que define todo el harness

**Flutter NO expone `resource-id` y NO expone `text`.** En los 4 dumps tomados, *todos* los nodos de
`com.lataba.rider` traen `resource-id=""` y `text=""`. El único `resource-id` del árbol es
`android:id/content` (el contenedor de Android) y `android:id/navigationBarBackground`.

**Pero sí expone `content-desc` en absolutamente todo**, y con etiquetas ricas y en español. Ese es
el selector a usar.

```
class="android.widget.Button"  resource-id=""  text=""
content-desc="Llegué"  clickable="true"  bounds="[40,2110][1040,2250]"
```

Tres consecuencias prácticas:

1. **Seleccioná por `content-desc`, nunca por `resource-id` ni por `text`.**
2. Los `ValueKey` de Flutter (`detail-delivery-action`, `dispatch-accept-action`, …) que existen en
   el código **no aparecen en el dump**. No sirven como selector vía ADB.
3. **Corrección empírica importante:** existe la advertencia de que «la accesibilidad de Flutter está
   apagada por defecto y el dump sale vacío». **En este aparato eso NO pasó.** Con
   `enabled_accessibility_services=null` y `accessibility_enabled=0`, el `uiautomator dump` devolvió
   el árbol semántico **completo** al primer intento. Motivo: UiAutomator se engancha él mismo como
   cliente de accesibilidad al dumpear, y eso enciende la semántica de Flutter. **No hace falta
   habilitar ningún servicio de accesibilidad.**
   *Salvedad defensiva:* la semántica se enciende de forma asíncrona, así que el primer dump
   inmediatamente después de `am start` puede llegar incompleto. **Dumpeá dos veces y quedate con el
   segundo.**

### 2.2 Rareza a tener en cuenta: `clickable` miente en el cajón

En la pantalla del mapa los botones vienen con `clickable="true"`. **En el cajón lateral, los ítems
`Inicio` / `Entregas` / `Ayuda` / `Cerrar sesión` vienen con `clickable="false"`** aunque responden
perfectamente al tap (lo verifiqué: tapeé «Entregas» y navegó).

> Si tu harness filtra por `clickable="true"` antes de tapear, **el cajón entero le va a resultar
> invisible**. Filtrá por `content-desc`, no por `clickable`.

---

## 3. Tabla: pantallas → elementos → cómo tocarlos

Coordenadas en píxeles físicos (1080x2400). El centro se calcula
`x=(x1+x2)/2`, `y=(y1+y2)/2`. Comando base: `adb shell input tap <x> <y>`.

### 3.1 Hoja modal de biometría — aparece al abrir la app
`dumps/rider-01-home.xml` · `capturas/rider-01-home.png`

| `content-desc` | Clase | click | `bounds` | Tap | Nota |
|---|---|---|---|---|---|
| `Protegé tu sesión` | View | false | `[60,1685][1020,1755]` | — | título |
| `Nadie más va a poder abrir tu sesión en este teléfono. Tu huella no sale del aparato.` | View | false | `[60,1775][1020,1870]` | — | cuerpo |
| `Activar huella o rostro` | **Button** | true | `[60,1930][1020,2060]` | (540,1995) | 🔴 **NO** — abre el sensor de huella, que ADB no puede resolver |
| `Ahora no` | **Button** | true | `[60,2080][1020,2200]` | (540,2140) | salida segura |
| `Scrim` | View | true | `[0,0][1080,1465]` | (540,700) | tapear acá también cierra |

**Forma recomendada de cerrarla:** `adb shell input keyevent KEYCODE_BACK` — probado, funciona, y
no requiere coordenadas. Es lo que usé.

> **Fragilidad:** esta hoja **se interpone en cada arranque** mientras la biometría no esté activada.
> Todo script debe empezar con un paso «si aparece la hoja, mandá BACK» — si no, el primer tap del
> flujo va a pegarle al `Scrim` y no va a hacer nada.
> Mientras la hoja está arriba, **el resto de la pantalla no existe en el dump** (Flutter excluye la
> ruta de abajo por la barrera modal). O sea: si tu dump sólo trae 4 nodos, es esto.

### 3.2 Inicio / mapa — CON pedido asignado (`onTheWay`)
`dumps/rider-02-home.xml` · `capturas/rider-02-home.png`

| `content-desc` | Clase | click | `bounds` | Tap | Nota |
|---|---|---|---|---|---|
| `Mapa operativo del pedido LT-0001` | View | false | `[0,0][1080,2400]` | — | **contenedor raíz — leelo para saber qué pedido está en pantalla** |
| *(sin desc)* | View | true, scrollable | `[0,0][1080,1488]` | — | superficie del mapa (pan/zoom) |
| `Retiro en el negocio` | ImageView | false | `[695,514][835,699]` | — | pin del comercio |
| `Tu posición` | ImageView | false | `[722,632][822,732]` | — | pin del rider |
| `Entrega del cliente` | ImageView | false | `[60,886][200,1071]` | — | pin del destino |
| **`Estado: Yendo al cliente`** | View | false | `[336,123][744,248]` | — | **cápsula de estado — el mejor testigo del paso actual** |
| `Abrir el menú` | Button | true | `[40,126][160,246]` | **(100,186)** | abre el cajón |
| `Reportar un problema` | Button | true | `[920,126][1040,246]` | (980,186) | abre «¿Qué pasó?» |
| `Brújula: el mapa mira al norte` | Button | true | `[920,1028][1040,1148]` | (980,1088) | inocuo |
| `Recentrar mapa` | Button | true | `[920,1178][1040,1298]` | (980,1238) | inocuo |
| `Abrir en Google Maps` | Button | true | `[920,1328][1040,1448]` | (980,1388) | ⚠️ sale de la app |
| `Atribución del mapa: OpenStreetMap` | Button | **false** | `[40,1418][310,1468]` | — | no accionable |
| `Desplegar u ocultar el detalle del pedido` | Button | true | `[0,1488][1080,1598]` | (540,1543) | **handle de la hoja — tap simple, no hace falta swipe** |
| *(ScrollView)* | ScrollView | false, scrollable | `[0,1598][1080,2090]` | — | cuerpo desplazable de la hoja |
| `Llevá el pedido al cliente` | View | false | `[40,1598][915,1668]` | — | título del paso |
| `LT-0001` | View | false | `[915,1608][1040,1658]` | — | **código del pedido** |
| `Avisá cuando llegues al domicilio.` | View | false | `[40,1678][1040,1726]` | — | subtítulo |
| `Retiro. La Taba 2. Mendoza 827. Distancia 31 m aprox.` | View | false | `[40,1756][1040,1913]` | — | parada 1 |
| `Entrega. Entrega. Mendoza 851, Neuquén Capital. Distancia 1.3 km aprox.` | View | false | `[40,1913][1040,2031]` | — | parada 2 |
| `GPS activo y publicación confirmada. Pedido LT-0001 · Última confirmación hace 0s` | View | false | `[40,2071][1040,2090]` | — | banner de seguimiento |
| **`Llegué`** | **Button** | true | **`[40,2110][1040,2250]`** | (540,2180) | 🔴 **CTA primario — NO TOCAR con LT-0001 en pantalla** |

> **Regla geométrica del CTA primario:** está **fijado al pie de la hoja**, ocupa todo el ancho útil
> (`x` de 40 a 1040) y vive en `y ≈ 2110–2250`. **Es la misma caja en todos los pasos del flujo** —
> sólo cambia el `content-desc`. Eso es bueno para el harness (un solo selector) y peligroso a mano
> (siempre hay un botón que avanza el pedido en el mismo lugar).

### 3.3 Cajón lateral (drawer)
`dumps/rider-03-menu.xml` · `capturas/rider-03-menu.png`

| `content-desc` | Clase | click | `bounds` | Tap | Nota |
|---|---|---|---|---|---|
| `Hola. TABA2 Rider. Entorno PRODUCCIÓN` | View | false | `[40,163][720,363]` | — | **testigo de identidad y de entorno** |
| `Seguimiento activo. Tu ubicación se está publicando.` | View | false | `[40,423][720,583]` | — | estado del tracker |
| `Última sincronización. 04:45` | View | false | `[40,613][720,773]` | — | reloj de sync |
| `Inicio` | Button | **false** | `[40,833][720,953]` | (380,893) | navega al mapa |
| `Entregas` | Button | **false** | `[40,953][720,1073]` | (380,1013) | lista de entregas |
| `Ayuda` | Button | **false** | `[40,1073][720,1193]` | (380,1133) | hoja de ayuda |
| `Cerrar sesión` | Button | **false** | `[40,2120][720,2240]` | (380,2180) | 🔴 **PROHIBIDO** |

> 🔴 **Trampa de coordenadas:** `Cerrar sesión` está en **(380, 2180)** y `Llegué` en **(540, 2180)**.
> **Misma `y`.** Un script que tapee «el botón de abajo» sin verificar qué pantalla está arriba puede
> cerrar la sesión de producción creyendo que confirma una entrega. **Verificá siempre el dump antes
> de tapear en la franja `y > 2000`.**

### 3.4 Pantalla «Entregas»
`dumps/rider-04-entregas.xml` · `capturas/rider-04-entregas.png`

| `content-desc` | Clase | click | `bounds` | Tap | Nota |
|---|---|---|---|---|---|
| `Open navigation menu` | Button | true | `[10,113][130,233]` | (70,173) | ⚠️ **en INGLÉS** — es el tooltip por defecto del `AppBar` de Material, sin traducir |
| `TABA2 Rider` | View | false | `[180,144][469,202]` | — | título |
| `Actualizar pedidos` | Button | true | `[960,113][1080,233]` | (1020,173) | refresco — inocuo |
| `Actualizado 04:46` | View | false | `[40,273][1040,313]` | — | reloj |
| `Tu entrega activa` | View | false | `[40,373][1040,443]` | — | encabezado de sección |
| `Pedido asignado LT-0001. Estado En camino` | Button | false | `[40,473][1040,926]` | — | **capa semántica de la tarjeta — el mejor lugar para leer estado** |
| `Pedido LT-0001\nEn camino\nMendoza 851, Neuquén Capital\n1 productos\nTotal ARS 17100.0\nAbrir entrega` | View | **true** | `[40,473][1040,926]` | (540,699) | tarjeta clickeable → abre el detalle |
| `GPS activo y publicación confirmada. Pedido LT-0001 · Última confirmación hace 0s` | View | false | `[40,956][1040,1116]` | — | banner |

> Ojo: hay **dos nodos superpuestos con el mismo `bounds`**. El accionable es el segundo
> (`clickable=true`), no el que empieza con «Pedido asignado». Si tu harness toma «el primero que
> matchea LT-0001», va a agarrar el que no responde.

---

## 4. Strings exactos del flujo, con archivo:línea

### 4.1 ⚠️ Advertencia sobre la rama a citar

El encargo apuntaba a `feature/taba2-rider-shifts-dispatch`. **Esa rama no corresponde al APK
instalado.**

| Evidencia | Resultado |
|---|---|
| `feature/taba2-rider-shifts-dispatch` | `ae90ab6`, **2026-08-11**. **No contiene** «Protegé tu sesión» |
| APK de producción instalado | **2026-08-17**, y **sí muestra** la hoja de biometría |
| `feature/taba2-rider-self-registration` | `e251713`, **2026-08-17**. **Sí contiene** la biometría y todos los textos observados |

**Todas las citas de abajo son de `feature/taba2-rider-self-registration` (`e251713`)**, que es la
rama cuyos textos coinciden **uno a uno** con lo que muestra el aparato. Verificado contra el dump:
`Llevá el pedido al cliente`, `Avisá cuando llegues al domicilio.`, `Yendo al cliente`, `Llegué`,
`Abrir el menú`, `Recentrar mapa`, `Desplegar u ocultar el detalle del pedido`, `PRODUCCIÓN`,
`Seguimiento activo`, `Última sincronización`, `Inicio`/`Entregas`/`Ayuda`/`Cerrar sesión`.

Dos apuntes más:
- **El working tree del repo Rider NO está en ninguna de las dos**: está en
  `fix/rider-android-runtime-hardening` (`434c4d5`). No se hizo checkout (sólo lectura). Para ver
  estos archivos en disco hay que cambiar de rama a mano.
- El `versionCode=145` no permite confirmar el commit exacto (§1.2), así que **la equivalencia
  rama↔APK es una inferencia por coincidencia de textos y fecha, no una prueba criptográfica.**

Rutas relativas a `D:\1212\la-taba-rider-android\`.

### 4.2 CTA primario del flujo de entrega
Todos en `lib/features/orders/presentation/order_detail_page.dart`.

| Paso | Reposo | Ocupado (busy) | Línea |
|---|---|---|---|
| Aceptar el pedido de la cola | `Aceptar pedido` | `Tomando pedido…` | **588** |
| **Retirado / recogido** | **`Confirmar retiro`** | `Confirmando retiro…` | **618** |
| **En camino** | **`Iniciar y abrir Maps`** | `Iniciando recorrido…` | **626** / 625 |
| **Llegué** | **`Llegué`** | `Registrando llegada…` | **634** |
| **Confirmar entrega** (con 4 dígitos ya cargados) | **`Confirmar entrega`** | `Confirmando entrega…` | **642** |
| Revelar el campo del PIN (sin 4 dígitos aún) | `Ingresar código` | — | **650** |
| Post-entrega | `Volver a la cola` | — | **604** |
| Post-entrega con tracker vivo | `Detener seguimiento` | — | **610** |

> **`Confirmar entrega` no existe hasta que el campo tiene 4 dígitos.** Antes, el mismo botón dice
> `Ingresar código` y sólo hace scroll + foco al campo. Son el mismo control físico, con dos
> `content-desc` distintos según el contenido del input.

### 4.3 Aceptar / rechazar oferta

| Control | String | Archivo:línea |
|---|---|---|
| Aceptar oferta (mapa) | `Aceptar oferta` / busy `Aceptando…` | `lib/features/map/presentation/rider_home_page.dart:631` |
| Rechazar oferta (mapa) | `Rechazar` | `lib/features/map/presentation/rider_home_page.dart:641` |
| Aceptar (tarjeta de oferta) | `Aceptar` / busy `Aceptando…` | `lib/features/orders/presentation/widgets/offer_request_card.dart:195` |
| Rechazar (tarjeta de oferta) | `Rechazar` | `lib/features/orders/presentation/widgets/offer_request_card.dart:187` |
| Rechazar (lista) | `Rechazar` | `lib/features/orders/presentation/orders_page.dart:754` |
| Título con oferta | `Nueva oferta` | `rider_home_page.dart:604` |

### 4.4 Títulos, subtítulos y cápsula por estado
`lib/features/orders/presentation/order_detail_page.dart`

| `OrderStatus` | Título de la hoja | línea | Cápsula `Estado:` | línea |
|---|---|---|---|---|
| `assigned` | `Retirá el pedido` | 339 | `Yendo a La Taba 2` | 406 |
| `pickedUp` | `Iniciá el recorrido` | 340 | `Pedido retirado` | 407 |
| **`onTheWay`** | **`Llevá el pedido al cliente`** | **341** | **`Yendo al cliente`** | **408** |
| `arrived` | `Cerrá la entrega` | 342 | `Llegaste` | 409 |
| `delivered` | `Entrega finalizada` | 343 | — | — |

Subtítulos: `Avisá cuando llegues al domicilio.` (**357**), `Pedí el código de 4 dígitos a quien
recibe.` (**358**).

Etiquetas canónicas del enum en `lib/domain/orders/order_status.dart` (`label`): `En camino`
(`on_the_way`), `Retirado` (`picked_up`), `Llegó` (`arrived`), `Asignado`, `Entregado`.

> **Cuidado con la doble nomenclatura:** el mismo estado se llama **`Yendo al cliente`** en la
> cápsula del mapa y **`En camino`** en la lista de Entregas. Lo confirmé en pantalla: ambas
> aparecieron simultáneamente para LT-0001. Un aserto que espere un solo texto va a fallar según en
> qué pantalla mire.

### 4.5 Biometría
`lib/features/auth/presentation/biometric_unlock_page.dart`

| String | Línea |
|---|---|
| `Protegé tu sesión` | 129 |
| `Nadie más va a poder abrir tu sesión en este teléfono. Tu huella no sale del aparato.` | 140 |
| `Activar huella o rostro` | 151 |
| `Ahora no` | 159 |

### 4.6 Cajón lateral
`lib/features/shell/presentation/rider_drawer.dart`: `Inicio` (98), `Entregas` (105), `Ayuda` (111),
`Cerrar sesión` (127), `Seguimiento activo` (277), `Última sincronización` (312).
Chip de entorno `PRODUCCIÓN` en `lib/core/config/flavor.dart:21`.

### 4.7 Sin pedido activo
`lib/features/map/presentation/rider_home_page.dart`, función `_buildAwaitingAssignment` (**921**).

---

## 5. El PIN — pantalla de confirmación de entrega

**No es una pantalla aparte y no son 4 campos separados.** Es una sección
(`_DeliveryCodePanel`) dentro de **la misma hoja del mapa**, que aparece sólo cuando
`status == OrderStatus.arrived`. Archivo: `lib/features/orders/presentation/order_detail_page.dart`.

| Propiedad | Valor | Línea |
|---|---|---|
| Estructura | **UN SOLO `TextField`** | ~1063 |
| Etiqueta de accesibilidad del bloque | `Confirmación de entrega` | **1052** |
| Título visible | `Código de entrega` | **1054** |
| Instrucción | `Ingresá el código de 4 dígitos.` | **1059** |
| `keyboardType` | `TextInputType.number` | ~1067 |
| `inputFormatters` | `FilteringTextInputFormatter.digitsOnly` → **sólo dígitos** | **1069** |
| `maxLength` | **4** | **1075** |
| `obscureText` / `obscuringCharacter` | `true` / `'•'` | **1074** |
| `hintText` | `• • • •` (U+2022 separados por espacios) | **1079** |
| `counterText` | `''` (contador oculto) | ~1080 |
| `textInputAction` | `TextInputAction.done` → **Enter confirma** | ~1070 |
| `autofillHints` | `<String>[]` (autofill desactivado) | ~1071 |
| `enabled` | `!busy && result?.code != 'temporarily_locked'` | **1066** |

**Qué acepta:** exactamente 4 dígitos. El botón `Confirmar entrega` sólo se materializa cuando el
contenido matchea `^\d{4}$`; antes dice `Ingresar código`.

**Al confirmar BIEN:** recibo `Entrega confirmada` (**1127**) + `La entrega quedó confirmada y el
seguimiento se detuvo.`; la cápsula pasa a `Entrega completada`; el título a `Entrega finalizada`
(343); el CTA a `Volver a la cola` (604).

**Al confirmar MAL:**

| Caso | Texto | Línea |
|---|---|---|
| Código incorrecto | `Código incorrecto. Revisalo con la persona que recibe el pedido.` | **1040** |
| Bloqueado | `El código está bloqueado temporalmente.` | **1043** |
| Bloqueado con reintento | `Esperá <N> segundos antes de volver a intentar.` | ~1044 |
| Sin red | `Sin conexión: todavía no se confirmó la entrega.` | ~1045 |

Con `incorrect_code` **el campo se limpia solo** y se regenera el `operationId`. Con
`temporarily_locked` **el input queda `enabled:false`** — reintentar a ciegas no escribe nada.

---

## 6. «Sin pedido activo» vs «con pedido asignado»

Ambos son **la misma pantalla**: el mapa es la superficie permanente y sólo cambia el contenido de
la hoja inferior. Eso simplifica el harness: **el selector de pantalla es la cápsula de estado**
(`content-desc` que empieza con `Estado: `, `Turno: ` u `Oferta: `).

### 6.1 Sin pedido activo — `_buildAwaitingAssignment` (rider_home_page.dart:921)

| Elemento | Texto | Línea |
|---|---|---|
| **Cápsula** | **`Estado: Esperando pedidos`** | **1005** |
| **Título de la hoja** | **`Esperando pedidos`** | **941** |
| Subtítulo | `Cuando el negocio te asigne un pedido, aparecerá acá.` | **954** |
| Paradas dibujadas | **ninguna** (`stops: const <RiderStop>[]`) — no hay pines en el mapa | 957 |
| CTA | `Actualizar` / busy `Actualizando…` (secundario) | **965** |
| Fallback del mapa | `Todavía no hay nada que ubicar` | `rider_map.dart:124` |

Variantes del mismo estado vacío (importan porque **no** son «sin pedidos»):

| Condición | Cápsula | Título | Línea |
|---|---|---|---|
| Sin red | `Estado: Sin conexión` | `Sin conexión` | 985 / 938 |
| Sesión vencida | `Estado: Sesión vencida` | `Sesión vencida` | 992 / 936 |
| Respuesta ilegible | `Estado: Respuesta ilegible` | `No pudimos leer tus entregas` | 999 / 940 |

> El comentario del código (líneas 913-920) es explícito: se separaron a propósito para que un rider
> **no vea «Esperando pedidos» cuando en realidad la respuesta se descartó** y tiene entregas vivas.
> Para el harness: **`Esperando pedidos` significa «sin trabajo», no «todo bien»** — hay que
> distinguirlo de los otros tres.

Otros estados de espera: `Esperando una oferta` (598, modo dispatch), `Turno: Fuera de turno` (720),
`¿Querés trabajar ahora?` (749), `Estado: Sin pedidos` (1144), `Sin pedidos disponibles` (1152),
`Estado: Buscando pedidos…` (1138).

### 6.2 Con pedido asignado
Lo documentado en §3.2, medido en vivo: cápsula `Estado: Yendo al cliente`, contenedor raíz
`Mapa operativo del pedido LT-0001`, nodo con el código `LT-0001`, tres pines
(`Retiro en el negocio` / `Tu posición` / `Entrega del cliente`), dos paradas y CTA `Llegué`.

**Discriminador más barato y confiable:**
`content-desc` del nodo raíz = `Mapa operativo de TABA2 Rider` (sin pedido) vs
`Mapa operativo del pedido <CÓDIGO>` (con pedido) — `rider_map.dart:464`.
Un solo `grep` sobre el XML resuelve el estado **y** extrae el código del pedido.

---

## 7. Método de automatización recomendado

### 7.1 Receta base

```powershell
# 0) Resolución (verificar una vez; el harness NO debe hardcodear sin chequear)
adb -s ZY32LHS6PS shell wm size        # -> 1080x2400
adb -s ZY32LHS6PS shell wm density     # -> 400

# 1) Dump + pull (desde PowerShell NO hace falta MSYS_NO_PATHCONV)
adb -s ZY32LHS6PS shell uiautomator dump /sdcard/ui.xml
adb -s ZY32LHS6PS pull /sdcard/ui.xml .\ui.xml

# 1-bis) Desde Git Bash SÍ hace falta, si no la ruta /sdcard se traduce a C:\...
MSYS_NO_PATHCONV=1 adb -s ZY32LHS6PS shell uiautomator dump /sdcard/ui.xml
MSYS_NO_PATHCONV=1 adb -s ZY32LHS6PS pull /sdcard/ui.xml ./ui.xml

# 2) Resolver el nodo por content-desc y tapear su centro
adb -s ZY32LHS6PS shell input tap 540 2180

# 3) PIN
adb -s ZY32LHS6PS shell input text 1234
```

**Regla de oro: `dump → parsear `content-desc` → calcular el centro de `bounds` → tapear`. Nunca
tapear una coordenada memorizada de una corrida anterior.** El CTA primario siempre vive en
`y≈2110–2250`, pero *qué* botón es depende del paso, y en el cajón esa misma franja es
`Cerrar sesión`.

### 7.2 El PIN, en concreto

1. Llegar a `arrived` → la cápsula dice `Estado: Llegaste`.
2. El campo autofocalea. Si el dump no lo muestra visible, tapear el CTA `Ingresar código` — hace
   `Scrollable.ensureVisible` y lo sube al viewport.
3. `adb shell input text 1234`. El `digitsOnly` filtra cualquier basura; `maxLength:4` corta.
   *Alternativa más robusta si `input text` se pierde con el IME de Flutter:*
   `input keyevent KEYCODE_1 KEYCODE_2 KEYCODE_3 KEYCODE_4`.
4. **Re-dumpear** (el teclado cambió toda la geometría) y tapear `Confirmar entrega`.
   O directamente `input keyevent KEYCODE_ENTER`, porque `textInputAction: done` dispara el submit.
5. Verificar `Entrega confirmada`.

### 7.3 Fragilidades — leer antes de escribir el harness

1. 🔴 **El teclado mueve TODO.** El campo del PIN está en el cuerpo desplazable y el CTA está fijado
   al pie de la hoja. Al abrir el IME, la hoja se redimensiona y **los `bounds` del CTA cambian**.
   *Hay que re-dumpear después de que abra el teclado, siempre.* Un tap con coordenadas de antes del
   teclado le pega a otra cosa.
2. 🔴 **`Cerrar sesión` (380,2180) y `Llegué` (540,2180) comparten `y`.** Verificá la pantalla antes
   de cualquier tap con `y > 2000`.
3. 🔴 **La hoja de biometría se interpone en cada arranque** y oculta el árbol de abajo. Manejala
   como primer paso (BACK).
4. 🟠 **`Iniciar y abrir Maps` lanza Google Maps** y la app pierde el foco. El harness tiene que
   detectar el cambio de paquete (`dumpsys window | grep mCurrentFocus`) y volver con BACK.
5. 🟠 **Diálogos de permisos nativos de Android** (ubicación precisa, notificaciones) tras
   `Continuar` en el modal `Permisos para el seguimiento`. Son de
   `com.google.android.permissioncontroller`, **con otros `content-desc` y en otro idioma posible**.
   Son de una sola vez por instalación, pero si aparecen y el script no los contempla, se cuelga.
6. 🟠 **Textos «busy» con elipsis U+2026**, no tres puntos: `Confirmando entrega…`, `Aceptando…`,
   `Registrando llegada…`. Un match por `"Confirmando entrega..."` **nunca** va a acertar.
7. 🟠 **`clickable="false"` en el cajón** aunque responda al tap (§2.2).
8. 🟠 **Nodos superpuestos** con el mismo `bounds` en «Entregas» (§3.4): elegí el `clickable=true`.
9. 🟠 **Contadores de oferta (`<N> s`)** son una carrera contra reloj: el harness tiene que aceptar
   dentro de la ventana o la oferta se vence sola.
10. 🟡 **Primer dump tras `am start` puede venir corto** (semántica asíncrona). Dumpeá dos veces.
11. 🟡 **El mapa es `scrollable`/`clickable` y ocupa `[0,0][1080,1488]`.** Un tap perdido ahí hace
    pan del mapa — inocuo, pero desplaza el encuadre y ensucia capturas comparativas.
12. 🟡 **`Open navigation menu` está en inglés** (§3.4) mientras el resto está en español. No
    asumas idioma uniforme.

### 7.4 Lo bueno

- **Ningún control del flujo usa swipe.** No hay `SlideAction`, `Dismissible`, `Draggable`,
  `onHorizontalDrag*`, `onPanUpdate` ni `onLongPress` en `lib/`. **Todo es tap simple.**
- El handle de la hoja (`Desplegar u ocultar el detalle del pedido`), aunque tiene arrastre
  vertical, **también tiene `onTap`**: se alterna con un tap, sin gesto.
- El `content-desc` es rico, en español y estable entre ramas (verificado: los strings del flujo son
  idénticos en `shifts-dispatch` y en `self-registration`, sólo cambian de línea).

---

## 8. Pantalla bloqueada / despertar por ADB

| Pregunta | Respuesta |
|---|---|
| ¿Está bloqueada ahora? | **No.** `mScreenLocked=false`, `showing=false`, pantalla encendida. |
| ¿Tiene bloqueo seguro? | **SÍ.** `secure=true`, `deviceHasKeyguard=true`. Hay PIN/patrón + huella. |
| ¿Se apaga sola? | **No.** `screen_off_timeout = 2147483647 ms`. |

**Despertar sin bloqueo seguro** (sirve si la pantalla se apagó pero el keyguard no se armó):
```
adb shell input keyevent KEYCODE_WAKEUP     # enciende (idempotente, no apaga)
adb shell input keyevent 82                 # MENU: descarta keyguard NO seguro
```

🔴 **Dependencia humana confirmada.** Como `secure=true`, si el teléfono llega a bloquearse de
verdad, **ADB no lo puede desbloquear**: `KEYCODE_WAKEUP` enciende la pantalla pero deja el keyguard
puesto, y `input keyevent 82` no sirve contra un keyguard seguro. Meter el PIN por
`input text` exige conocerlo y es frágil. **Alguien tiene que desbloquear el aparato a mano.**

**Mitigación recomendada** (no aplicada en este reconocimiento, para no tocar ajustes):
```
adb shell svc power stayon usb    # no se bloquea mientras esté por USB
```
Es reversible (`svc power stayon false`) y no toca datos. Hoy es casi redundante porque el timeout
ya es infinito — pero el timeout es una preferencia que cualquiera puede cambiar, y `stayon usb` no.

---

## 9. Qué NO se puede automatizar de forma confiable

1. 🔴 **El flujo de entrega en ESTE teléfono con ESTA sesión.** Tiene LT-0001 vivo en
   `Yendo al cliente`. Ensayar el flujo significa avanzar un pedido real. **Bloqueado por regla, no
   por técnica.**
2. 🔴 **La huella / rostro.** El sensor biométrico no se puede accionar por ADB en un aparato
   físico (`adb emu finger touch` es sólo de emulador). Si la sesión alguna vez exige desbloqueo
   biométrico, **es humano obligatorio**. Hoy se esquiva con `Ahora no`, pero si alguien activa la
   biometría, el harness queda afuera.
3. 🔴 **La pantalla de bloqueo del sistema** (§8). Humano obligatorio.
4. 🟠 **El salto a Google Maps** en `Iniciar y abrir Maps`: es otra app, con su propia UI, y el
   regreso depende de la pila de actividades.
5. 🟠 **Los diálogos de permisos nativos de Android.** Fuera del paquete de la app, textos del
   sistema, y en Android 14+ la ubicación precisa tiene un selector propio.
6. 🟠 **El GPS real.** El flujo exige un fix reciente (`Confirmar GPS`, `GPS pendiente`,
   `No hay un GPS válido…`). Sin mock location provider no se puede fabricar una posición, y el
   estado del turno depende de eso.
7. 🟠 **Las ofertas con countdown.** Dependen del despacho del servidor y vencen solas.
8. 🟡 **Los `ValueKey` de Flutter como selectores.** No existen en el mundo ADB (§2.1).
9. 🟡 **Cualquier aserto sobre distancias, relojes o «hace 0s»** — cambian entre dumps
   (vi 31 m → 26 m → 25 m en cuatro minutos, sin mover el teléfono).

### Recomendación de fondo

**No montar el harness contra `com.lataba.rider`.** Está instalado `com.lataba.rider.staging`
(§1.2), que es el mismo código con otro `applicationId` y otro backend. Automatizar ahí permite
recorrer el flujo entero —aceptar, retirar, salir, llegar, PIN— **sin riesgo sobre pedidos reales**.
Contra producción, limitar el harness a **lectura**: `dump`, `screencap` y verificación de estado,
con una lista negra dura de `content-desc` que nunca se tapean:

```
Llegué · Confirmar retiro · Iniciar y abrir Maps · Confirmar entrega · Aceptar pedido
Aceptar oferta · Aceptar · Rechazar · Cerrar sesión · Activar huella o rostro · Detener seguimiento
```

---

## 10. Archivos de este reconocimiento

```
artifacts/taba2-go-live-audit/reconocimiento-rider/
├── MAPA-RIDER.md
├── dumps/
│   ├── rider-01-home.xml        hoja de biometría (árbol de abajo oculto por el modal)
│   ├── rider-02-home.xml        mapa + pedido LT-0001 (onTheWay)  ← el dump principal
│   ├── rider-03-menu.xml        cajón lateral
│   └── rider-04-entregas.xml    pantalla «Entregas»
└── capturas/
    ├── rider-01-home.png        1080x2400
    ├── rider-02-home.png
    ├── rider-03-menu.png
    ├── rider-04-entregas.png
    └── rider-05-back-home.png   estado final: LT-0001 intacto en «Yendo al cliente»
```
