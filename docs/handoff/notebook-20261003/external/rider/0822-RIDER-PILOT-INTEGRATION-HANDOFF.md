# TABA2 Rider · línea integrada de piloto

Identidad certificada + UX comercial, en una sola línea, con gate físico corrido
sobre el APK integrado.

---

## 1 · Los tres HEADs

| | commit | qué es |
|---|---|---|
| Identidad | `acc253a` | `feature/taba2-rider-identity-biometrics`, certificada en staging después de la pasada de UX |
| UX comercial | `8e9cd4f` | `feature/taba2-rider-commercial-ux`, sobre `ae90ab6` |
| **Integrado** | **`d98184f`** | `feature/taba2-rider-pilot-integration` |

## 2 · Ancestry

Medida con `git merge-base --is-ancestor`, no supuesta:

```
ae90ab6  el mapa es la superficie permanente          ← merge-base exacto
  ├─ 4796a7c → 3222d3f → acc253a     identidad, biometría, revocación
  └─ 94adf07 → 8e9cd4f               UX comercial
        ↓
      42c0940  merge (dos padres, ambas historias enteras)
        ├─ fc46037  el barrio no se dice dos veces
        ├─ 7161ca7  sacar el encabezado que caía en el pliegue
        └─ d98184f  la barra del tiempo no se estaba dibujando
```

`acc253a` no es ancestro de `8e9cd4f` ni al revés: son dos ramas hermanas del
mismo punto. El merge es real, con `--no-ff`; no hubo reset, rebase, amend ni
stash, y ninguna de las dos ramas originales se movió.

## 3 · Conflictos reales

**Textuales: uno.** Identidad tocó 39 archivos, la UX 29, y la intersección es
exactamente `lib/review/review_fixtures.dart`, en líneas distintas (identidad
agrega un mixin a la clase de sesión en la 289; la UX agrega un método en la 112
y campos en la 407). Git lo resolvió solo y se verificó a mano que las dos
mitades estén.

**Semánticos: dos, ninguno con conflicto textual.** Son los que importaban y por
eso el encargo pedía revisarlos aunque el merge saliera limpio:

1. **La puerta biométrica va delante de la pantalla principal.** Identidad
   agregó a `SessionGate` un `if (controller.isLocked) return
   BiometricUnlockPage(...)` antes del `hasRiderAccess`, y en
   `AuthenticatedSessionPage` una hoja de alta que se ofrece 400 ms después de
   entrar. Si esa puerta se cerrara en el build de revisión, los trece
   escenarios de UX quedarían inalcanzables en el teléfono y el gate físico
   sería imposible de correr. **No se cierra**: el origen de sesión de revisión
   lleva el mixin `BiometricsUnavailableSessionDataSource`, que reporta
   `gate: noSession` y `canOffer: false`. Verificado y fijado por prueba.
2. **El repositorio de operaciones viaja por dentro del `SessionGate` que
   identidad modificó.** Si el forward se perdiera, el controlador construiría
   el puente nativo y —en un flavor sin backend— los trece estados volverían a
   abrir con «Sin conexión» en rojo, que es justo el defecto que la pasada de UX
   vino a tapar. **No se perdió**: identidad no tocó esa parte, y ahora hay una
   prueba que cuenta las lecturas del repositorio inyectado.

**Reparto de autoridad, respetado tal cual lo fija el encargo.** Identidad manda
sobre autenticación, revocación, biometría, sesión y RBAC: nada de eso se tocó.
La UX manda sobre presentación, jerarquía, hojas, pago, turno y ficha: la prueba
más dura de que se preservó es que **los diez renders de la UX salen byte a byte
idénticos** antes y después del merge.

**Puente nativo**: las dos superficies conviven. Seis métodos de turno/despacho
(`riderWorkNow`, `riderStartShift`, `riderPauseShift`, `riderResumeShift`,
`riderEndShift`, `riderShiftHeartbeat`) más `getRiderOperationalState`,
`acceptRiderDispatchOffer` y `rejectRiderDispatchOffer`, y los cinco de
biometría. El datasource de operaciones los llama a todos y ninguno falta.

## 4 · Lo que encontró el gate físico

Tres defectos que **ninguna de las 376 pruebas veía**, y que valen como
justificación del gate:

1. **La barra de tiempo de la oferta no se dibujaba.** Medía bien, tenía el
   color bien, y era invisible: el relleno era un `ColoredBox` suelto dentro de
   un `Stack`, donde recibe restricciones flojas y sin hijo se resuelve en cero
   de alto. En el Moto se vio con la oferta a 22 de 30 segundos y la pista
   completamente lisa. Todas las pruebas miraban el texto, y el texto —«Quedan
   22 s»— estaba perfecto. La prueba nueva mide la geometría del relleno.
2. **El barrio se decía dos veces.** Sin `customer_street_address`, el titular
   cae en `customer_address`, que ya lo trae adentro: «Los Álamos 1450,
   Confluencia» con «Confluencia» repetido debajo.
3. **Un encabezado huérfano.** «Actividad de hoy» quedaba como última línea
   visible de la hoja colapsada, con sus datos abajo del corte.

## 5 · Los trece estados, en el aparato

`artifacts/taba2-rider-commercial-ux/after-integrated-moto/`, capturas reales
del Moto G15 (1080×2400, 432×960 dp) con el APK integrado. Trece estados, todos
al primer intento:

fuera de turno · disponible · oferta con TTL · sin pedidos · sincronizando ·
pedido disponible · varios pedidos · yendo al comercio · retirado · yendo al
cliente · llegaste (+ desplazada + con teclado) · entregado · sin conexión.

Verificado sobre esas capturas: mapa presente en los trece; pill de estado
siempre visible y nombrando el estado; hoja contextual; una acción dominante por
paso; CTA nunca tapado, tampoco con el teclado numérico abierto; controles del
mapa y brújula accesibles; atribución sin invadir la banda de avisos;
`address_label` visible («Depto 3 C»); indicaciones sobre el pliegue; cobro
explícito arriba de todo; barra de TTL junto a los botones; panel de turno con
ventana, zona y tiempo restante.

**Privacidad pre-claim, en el aparato**: la oferta muestra «Zona Confluencia» y
«La dirección exacta se habilita sólo al aceptar». Sin domicilio, sin nombre,
sin teléfono.

## 6 · Offline y reconexión

Con Wi-Fi y datos apagados, sobre `yendo al cliente`:

- el mapa se queda (no hay pantalla en blanco);
- el pill sigue diciendo «Yendo al cliente»;
- la entrega activa no desaparece: dirección, paradas y CTA intactos;
- al volver la red, converge sin recrear nada;
- **un solo proceso** de `com.lataba.rider.review` antes, durante y después.

Capturas `offline-00-online`, `offline-01-sin-red`, `offline-02-reconectado`.

**Revocación de sesión sobre el APK integrado: NO se probó.** El build de
revisión no tiene backend por diseño, así que no hay sesión real que revocar. La
revocación está certificada en `RiderSessionLifecycleTest` y en los ensayos
contra staging de la sesión de identidad; repetirla en el aparato exige el
flavor staging con credenciales, y eso es mutar staging. Queda declarado como no
hecho, no como hecho de otra forma.

## 7 · Gates

| Gate | Resultado |
|---|---|
| `flutter analyze` | sin hallazgos |
| `flutter test` | **376 verdes** |
| Kotlin `testStagingDebugUnitTest` | **126 tests, 0 fallos**, 2 omitidos (piden credenciales de staging) |
| `assembleCommercialReviewDebug` | ✅ |
| `assembleStagingDebug` | ✅ |
| `assembleCommercialReviewRelease` | ✅ sin firmar (no hay keystore; el buildType pone `signingConfig = null`) |

Aritmética de los 376, para que se vea que no se perdió nada:
307 de base + 7 de identidad + 54 de la UX + 5 de integración + 3 de los
defectos que encontró el aparato.

Las suites de identidad que la regresión exigía están presentes y verdes en el
árbol integrado: `RiderSessionLifecycleTest`, `SessionManagerTest`,
`SupabaseAuthClientTest`, `TokenRefreshMutexTest`, `BiometricUnlockPolicyTest`,
`BiometricManifestGuardTest`, `SessionEnvelopeTest`.

## 8 · APK

`INTEGRADO-d98184f-commercialReview-debug.apk`
sha256 `2244527bbc47b4e7a5d80b0832fb9da255371a202cca01c073952b69e5a774f2`

El hash del APK extraído del teléfono coincide con el local (verificado con
`adb pull`, no con `adb shell cat`: en Windows eso corrompe binarios y da un
hash distinto que parece un fallo de integridad y no lo es).

## 8b · Rendimiento

Detalle completo en `after-integrated-moto/PERFORMANCE.md`. Resumen:

**Memoria, medida en build profile igual que la base**: 175.506 / 170.335 /
169.995 KB en tres arranques en frío, contra 191.164 / 191.516 / 191.119 KB de
`ae90ab6`. Entre 8 % y 11 % menos, con identidad y biometría adentro. **Sin
regresión.**

**Frames: no se pudo reproducir el método de la base y no se afirma nada.** En
este Android 15, `dumpsys SurfaceFlinger --latency` devuelve el período correcto
y después sólo ceros para la capa de la app, y `dumpsys gfxinfo` reporta 0
frames aun con el mapa arrastrándose visiblemente —mide HWUI, y Flutter no
dibuja por HWUI—. No se copia el 0,0 % de jank de la base como si fuera de esta
build. Lo que sí se sostiene: cero animaciones nuevas (la barra se repinta con
el tick de un segundo que ya existía), una sola instancia de mapa y un listener
por controlador a lo largo de los siete estados, cero adquisiciones y cero
publicaciones de GPS nuevas, y un solo proceso en el aparato.

## 9 · Contratos preservados

Sin tocar: SQL de auto-dispatch, ranking, migraciones, edge functions, backend,
staging, producción, ARCA, Mercado Pago, storefront.

- **GPS y publicación**: cadencia sin cambios, sin adquisiciones nuevas.
- **Cola offline**: sin tocar; verificada en el aparato.
- **Claim / auto-dispatch**: RPC y `operationId` sin cambios.
- **Privacidad pre-claim**: `preClaimDeliveryLabel` y `maskAddressNumbers`
  intactas; verificada en pantalla.
- **Código de entrega**: panel, reintentos, bloqueo temporal e idempotencia sin
  cambios.
- **Identidad**: autenticación, revocación, biometría, sesión y RBAC sin tocar
  una línea.
- **Nombre y teléfono del cliente**: no existen en el proyectado asignado y no
  se inventan.

## 10 · Qué se hizo en el teléfono

Se tomó `moto-g15.lock` con las cinco señales del encargo medidas una por una y
anotadas: sin lock ajeno (el de identidad ya no existe), adb en `device`, cero
procesos de instrumentación, paquetes conocidos, y la app ajena en foreground
**quieta 44 min en una pantalla de error estática** —captura de sólo lectura
archivada—. La decisión anterior de esperar respondía a evidencia de trabajo
activo que ya no estaba.

Sólo se instaló `com.lataba.rider.review`. Sin `pm clear`, sin desinstalar, sin
factory reset. `com.lataba.rider.staging` quedó donde estaba, con sus datos.
Se concedieron a la app de revisión los permisos de ubicación y notificaciones
—permisos reales del sistema, no GPS falso— porque el diálogo de Android
bloqueaba la pasada. Wi-Fi apagado y vuelto a encender para la prueba de
offline, y restaurado.

`STAGING_MUTATED=false` · `BACKEND_TOUCHED=false` · `PEDIDOS_TOCADOS=ninguno` ·
`GPS_FALSO=no`

## 11 · Deuda

**P1**

- **Jank por frame sin medir.** Ni `SurfaceFlinger --latency` ni `gfxinfo`
  sirven para Flutter en este Android. Hace falta el camino propio de Flutter:
  `flutter run --profile` con DevTools, o instrumentar `FrameTiming`. La nota
  está en `PERFORMANCE.md` para que nadie repita el intento fallido.
- **Revocación de sesión no reprobada sobre el APK integrado.** El build de
  revisión no tiene backend, así que no hay sesión real que revocar. Está
  certificada en Kotlin y contra staging por la sesión de identidad; repetirla
  en el aparato exige el flavor staging con credenciales.
- **`delivered → idle` verificado por instrumentación, no por captura.** La
  fixture de revisión conserva el pedido asignado después de entregar, así que
  en el teléfono el botón «Volver a la cola» no llega a vaciar la pantalla. La
  transición real está fijada por `always_on_map_test.dart`, paso 7.
- **Nombre y teléfono del cliente no existen en el contrato.** Las referencias
  compartidas los muestran y en la puerta sirven. Requiere ampliar el proyectado
  del pedido asignado.

**P2**

- **`Sin GPS` aparece dos veces** en la lista de paradas, una por parada.
  `rider_map_test.dart` lo fija con `findsNWidgets(2)` y ese test protege una
  honestidad real, así que no se tocó.
- **La fixture de revisión no separa calle y barrio.** Ejercita el camino en que
  `customer_address` los trae juntos; el camino separado sólo lo cubre una
  prueba de widget.
- **`unit_price` de cada producto** sigue sin agrupar miles.

**POST-PILOT**

- **Tiles de OpenStreetMap.** Sigue vigente: la política de uso de los
  servidores públicos desaconseja producción. Antes de ampliar la flota hay que
  decidir proveedor.
- **Sonido y vibración configurables para la oferta.** No hay contrato de
  preferencias; el háptico que existe es de transición confirmada.
- **El camino de la cola de pedidos es código muerto en la app real**, porque
  `SessionGate` siempre construye el controlador de operaciones. Conserva tests;
  habría que decidir si se retira.
- **Aplicar las 6 migraciones de identidad** junto con su cliente, en ese orden,
  antes del piloto.

## 12 · Declaración

**TABA2_RIDER_COMMERCIAL_UX_READY_FOR_PILOT**

Emitida sobre `d98184f`, el APK integrado
`2244527bbc47b4e7a5d80b0832fb9da255371a202cca01c073952b69e5a774f2`, con el gate
físico del Moto G15 corrido: trece estados recorridos en el aparato, mapa
presente en todos, estado nombrado en la cápsula, una acción dominante por paso,
CTA nunca tapado —tampoco con el teclado numérico abierto—, ficha de entrega
legible con puerta, indicaciones y cobro sobre el pliegue, oferta con su tiempo
a la vista, panel de turno con ventana y restante, entrega cerrada que no
arrastra instrucciones, pérdida y recuperación de red sin perder la entrega, y
un solo proceso a través de todo.

Lo que la firma **no** cubre, dicho para que nadie lo suponga: el jank por frame
no se midió en esta build, la revocación de sesión no se reprobó sobre el APK
integrado, y `delivered → idle` está certificado por instrumentación y no por
captura. Los tres están en la deuda con su motivo.
