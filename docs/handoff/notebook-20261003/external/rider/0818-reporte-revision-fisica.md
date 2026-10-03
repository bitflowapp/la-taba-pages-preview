# Revisión física — TABA2 Rider Commercial Redesign

**No se alcanza la declaración máxima.** Ver §17.

Fecha: 2026-08-05. Sin push. Sin deploy. Staging intacto.

---

## 1. Dispositivo

| | |
|---|---|
| Modelo | Motorola moto g15 (`lamu_g`), serie `ZY32LHS6PS` |
| Pantalla | 1080 × 2400 px @ 400 dpi = **432 × 960 dp lógicos** |
| Elección | **Único Android conectado.** El encargo pedía preferir otro equipo para no interferir con el smoke; no había ninguno más. Se usó el Moto bajo las condiciones que el propio encargo autoriza: `moto-g15.lock` libre, instalación exclusiva del package de revisión, staging sin tocar |

El marcador `rider-staging-smoke-pending.txt` declaraba el smoke
`BLOCKED_NOT_STARTED`, `DEVICE_TOUCHED=false`, `MOTO_G15_LOCK_ACQUIRED=false`.

## 2. Package instalado

`com.lataba.rider.review` — «TABA2 Rider · Revisión», instalado **lado a lado**.
Etiqueta de entorno visible dentro de la app: `REVISIÓN · DATOS DE PRUEBA`.

## 3. APK y hash

| | |
|---|---|
| Ruta | `build/app/outputs/flutter-apk/app-commercialreview-debug.apk` |
| SHA-256 | `47d02049618888a7969e8ae7701031bca883a3a5b9ac0c030ab62502cef2bade` |
| Tamaño | 170 973 174 bytes |
| Build previo (antes del ajuste de fixture) | `56b233df50b05d76079fd0f62d255687fcba10eb4e32fa121e3fd04e3791d279` |

Sin credenciales: el flavor declara `TABA_SUPABASE_URL`, `TABA_PUBLISHABLE_KEY`
y `TABA_BUSINESS_ID` como cadenas vacías, y `main_review.dart` nunca construye
las fuentes nativas de sesión, pedidos ni entrega.

## 4. Staging intacto

Verificado **antes y después** de instalar, y otra vez al cerrar:

| | |
|---|---|
| SHA-256 del APK instalado | `d64d688985f2a998694ac9e0851fab272db26e7905fbfa2344985a62ed781299` |
| ¿Coincide con el target congelado del smoke? | **Sí, idéntico** |
| `firstInstallTime` | 2026-08-02 22:20:15 (sin cambios) |
| `lastUpdateTime` | 2026-08-05 03:25:22 (sin cambios) |
| `versionCode` | 1 (sin cambios) |
| `com.lataba.rider.staging.test` | sigue instalado, sin tocar |

No se usó `pm clear`, ni desinstalación, ni restauración, ni migración de
sesiones. `font_scale` se cambió a 1.5 para la prueba de accesibilidad y se
**restauró a 1.0** al terminar.

## 5. Estados recorridos

Los 12, en dispositivo real:

| # | Estado | Captura | Resultado |
|---|---|---|---|
| 1 | Sin pedidos | `01` | Cápsula «Sin pedidos», una acción (`Actualizar`), retiro visible |
| 2 | Buscando pedidos | `02` | Espera honesta, CTA deshabilitado «Actualizando…» |
| 3 | Pedido disponible | `03` | Un CTA, zona aproximada, sin domicilio exacto |
| 4 | Varios pedidos | `04`, `04b` | **Defecto P1-1**, ver §12 |
| 5 | Yendo a La Taba 2 | `05` | La Taba 2 / Mendoza 827, domicilio exacto ya visible |
| 6 | Retirado en La Taba 2 | `06` | CTA «Iniciar recorrido» |
| 7 | Yendo al cliente | `07` | Correcto |
| 8 | Llegaste | `08` | CTA «Ingresar código» |
| 9 | Ingreso de código | `08b`–`08f` | Teclado numérico, foco, código incorrecto rechazado, correcto confirma |
| 10 | Entrega completada | `09`, `08f` | «Volver a la cola», sin CTA mutante, soporte oculto |
| 11 | Sin conexión | `10` | Aviso **no bloqueante**, `Actualizar` sigue disponible |
| 12 | Drawer y modal | `11`, `11b`, `12` | Correctos |

Extras: `13`/`13b` a 150 % de escala, `14`/`15` privacidad pre/post claim,
`16` botón Atrás.

## 6. Drawer

| Comprobación | Resultado |
|---|---|
| «Hola» se ve intencional, no roto | ✅ La línea «TABA2 Rider» debajo le da contexto |
| Abre y cierra | ✅ |
| Cierra tocando fuera | ✅ (`11b`) |
| Botón Atrás cierra el drawer sin salir de la app | ✅ (`16`, la actividad sigue en primer plano) |
| Logout visible pero no accidental | ✅ Al pie, separado por divisor |
| Ningún dato inventado | ✅ Sólo estado de seguimiento y última sincronización |
| Nombres largos | ⚠️ No verificable en dispositivo: la sesión nativa no expone nombre. El widget acepta uno y lo trunca a dos líneas (probado en test) |
| Escala 150 % | ✅ Sin recortes (`13b`) |

## 7. Varios pedidos

- Primer pedido visible ✅
- **«Ver 2 pedidos más» NO visible con el sheet colapsado** ❌ → **P1-1**
- Acceso a Entregas desde el drawer ✅
- Retorno al mapa desde el drawer ✅

## 8. Único retiro

- Siempre «La Taba 2» ✅ en cola, sheet, encabezado y ayuda
- Siempre «Mendoza 827» ✅
- Sin selector de sucursal ✅
- Ningún otro comercio ✅
- **Sin coordenadas no hay pin falso** ✅ — el mapa muestra su texto de
  reemplazo y cada parada dice «Sin coordenadas: usá la dirección escrita»

## 9. Privacidad

Verificada con el domicilio exacto **presente en el fixture**, para probar que
la pantalla lo oculta y no que simplemente no lo tenía.

Volcado real del árbol de accesibilidad del dispositivo (`uiautomator dump`):

**Pre-claim** (`ui_preclaim.xml`):
```
Retiro. La Taba 2. Mendoza 827. Distancia Sin GPS
Entrega. Entrega. Zona Confluencia. Zona aproximada.
  La dirección exacta se muestra al aceptar.. Distancia Sin GPS
```
`Los Álamos 1450` **no aparece** en ninguna parte del árbol. ✅

**Post-claim** (`ui_postclaim.xml`):
```
Retiro. La Taba 2. Mendoza 827. Distancia Sin GPS
Entrega. Entrega. Los Álamos 1450, Confluencia. Distancia Sin GPS
```
✅ La separación pre/post claim se cumple también para TalkBack.

## 10. Conectividad

- Aviso **no bloqueante**: banda roja sobre el mapa, la app sigue usable ✅
- Explicación honesta: «Seguimos mostrando la última información confirmada» ✅
- Ninguna acción imposible ofrecida como disponible ✅ — sólo queda
  `Actualizar`, que es una lectura
- **No se afirma persistencia offline tras `force-stop`** ✅ — ningún texto lo
  menciona

## 11. Accesibilidad

- Etiquetas y roles presentes en todos los controles flotantes ✅
- Cápsula y avisos como `liveRegion` ✅
- Teclado numérico, foco automático y panel desplazado a la vista ✅
- Escala 150 %: drawer perfecto; mapa con **defecto P1-2** ❌
- Targets ≥ 48 dp ✅ (verificado en test y visualmente)

**No verificable en esta fase:** contraste bajo luz solar directa. Requiere a
una persona con el equipo en la calle; las capturas no lo prueban.

## 12. Hallazgos

### P0 — bloquea una acción o expone datos

**Ninguno.**

### P1 — confunde estado, CTA o pedido

**P1-1 · El acceso al resto de la cola no se ve.**
Con tres pedidos disponibles y el sheet en su altura por defecto, la pantalla
es **idéntica** a la de un solo pedido: los datos del pedido (3 bultos,
Efectivo, Cobro, 20 min) y el enlace «Ver 2 pedidos más» quedan por debajo del
pliegue. Hay que arrastrar el sheet para descubrir que existen otros pedidos.
Comparar `04-varios-pedidos.png` con `04b-varios-pedidos-sheet-expandido.png`.
Contradice el gate «Ver N pedidos más evidente / no esconder pedidos».

**P1-2 · A 150 % de escala, el texto del mapa queda tapado por los controles.**
En `13-text-scale-150-llegaste.png` el mensaje «…no mostramos una ubicación
inventa**da**» queda cortado detrás de la brújula. La superficie de reemplazo
del mapa no reserva la columna derecha de controles. No hay excepción de
layout, por eso las pruebas automáticas no lo detectaron: es solape, no
desbordamiento.

### P2 — pulido visual

**P2-1 · Controles de mapa activos sobre una superficie sin mapa.**
Cuando no hay coordenadas, recentrar y la brújula se siguen mostrando y no
hacen nada (`_mapReady` nunca se activa porque no se construye el mapa).
Visible en `01`, `02`, `03`, `09`, `10`.

**P2-2 · El sheet expandido no se ajusta al contenido.**
En `04b` queda una gran franja crema vacía bajo el CTA y la acción principal
sube al medio de la pantalla, lejos del pulgar.

**P2-3 · Etiqueta de accesibilidad de la entrega redundante.**
`Entrega. Entrega. …` repite la palabra (tipo de parada + título) y hay un
punto doble antes de «Distancia».

**P2-4 · La atribución © OpenStreetMap se despega hacia arriba.**
Con el sheet muy expandido queda flotando junto a la cápsula de estado
(`08b`, `08d`), porque se posiciona respecto de la altura del sheet.

**Ningún hallazgo fue corregido durante la revisión**, conforme a la
instrucción: no hubo P0.

## 13. Archivos modificados

`android/app/build.gradle.kts` · `android/app/src/commercialReview/res/values/strings.xml` ·
`lib/core/config/flavor.dart` · `lib/main_review.dart` ·
`lib/review/review_scenario.dart` · `lib/review/review_fixtures.dart` ·
`lib/review/review_shell.dart` · `test/review/review_isolation_test.dart`

Ningún archivo de la app operativa cambió su comportamiento: el flavor nuevo
sólo agrega una rama a tres `switch` sobre `AppFlavor`.

## 14. Commits

```
d1ce78e test(review): give the offer a doorstep so masking can be proven
2c079b1 feat(review): add an isolated build for design review
```

## 15. Git

HEAD final `d1ce78e814b59ee7df1befdcc8e2a31c23912c3a`, rama
`feature/taba2-rider-commercial-redesign`, **árbol limpio**,
`git diff --check` sin hallazgos.

`flutter analyze` limpio · **216 pruebas Dart verdes** (14 nuevas de aislamiento
del build de revisión).

## 16. Locks

| Lock | Uso | Estado final |
|---|---|---|
| `heavy-compute.lock` | Adquirido dos veces (build y rebuild), carpeta atómica sin `-Force`, con `owner.txt` | **Liberado** tras verificar propiedad y PID muerto |
| `moto-g15.lock` | Adquirido para toda la fase de dispositivo | **Liberado** igual |

Al empezar, `heavy-compute.lock` estaba tomado por
`TABA2_UNIT_CATALOG_NORMALIZATION` (PID vivo). **No se tocó**: se hizo primero
todo el trabajo de código y se compiló recién cuando quedó libre.

## 17. Declaración

**No se declara `TABA2_RIDER_COMMERCIAL_REDESIGN_PHYSICALLY_REVIEWED`.**

La declaración exige, entre otras, dos condiciones que **no** se cumplen:

| Condición | Estado |
|---|---|
| Package aislado | ✅ |
| Staging intacto | ✅ |
| Revisión en dispositivo real | ✅ |
| Drawer correcto | ✅ |
| **Varios pedidos comprensibles** | ❌ **P1-1** |
| La Taba 2 / Mendoza 827 consistentes | ✅ |
| Privacidad correcta | ✅ |
| Cero overflow | ✅ |
| **Cero errores visibles** | ❌ **P1-2** |
| Git limpio | ✅ |

Estado real alcanzado:

**TABA2_RIDER_COMMERCIAL_REDESIGN_PHYSICALLY_REVIEWED_WITH_TWO_P1_FINDINGS**

Con P1-1 y P1-2 resueltos y una nueva pasada por esos dos estados, la
declaración queda disponible. No se declara listo para producción.
