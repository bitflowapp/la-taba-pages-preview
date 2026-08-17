# TABA2 · Alta autogestionada + memoria del cliente · INFORME DE PRUEBAS

Todos los números son de esta misión, medidos ahora. Ninguno se copió de un
informe anterior.

---

## 1. Base de datos

### Stack de certificación

Reconstruido **desde cero**, no «103 más parches»:

| | |
|---|---|
| `project_id` | `taba2-prod-remediation-shadow` |
| puertos | API 55321 · DB 55322 · shadow 55320 |
| bootstrap | `supabase db reset --local` → **0 → 107 desde cero** |
| corridas de reset limpias | 4 (una por cada migración nueva agregada) |

Se reutilizaron los 5 containers del shadow que la misión anterior dejó, en vez
de crear otros 5. Los 23 containers históricos de la máquina no se tocaron.

### Suite completa

```
Files=14, Tests=521
All tests successful.
Result: PASS
```

| Suite | Pruebas | Estado |
|---|---|---|
| `registration_approval_test` (**nueva**) | 98 | PASS |
| `customer_profile_isolation_test` (**nueva**) | 47 | PASS |
| `production_least_privilege_test` | 44 | PASS |
| `rider_multi_order_capacity_test` | — | PASS |
| `rider_multi_order_isolation_test` | — | PASS |
| `rider_multi_order_offer_test` | — | PASS |
| `rider_multi_order_security_test` (BOLA) | — | PASS |
| `back_office_role_isolation_test` | — | PASS |
| `business_timezone_windows_test` | — | PASS |
| `business_windows_scanner_fiscal_test` | — | PASS |
| `durable_offline_packing_test` | — | PASS |
| `fiscal_document_closure_test` | — | PASS |
| `production_operations_control_plane_test` | — | PASS |
| `public_tracking_gps_quality_test` | — | PASS |

**376 de baseline + 145 nuevas = 521.** El baseline de 376 que certificó la
remediación sigue entero: multi-pedido, catálogo, fiscal, planificador, tracking,
BOLA y RLS siguen verdes.

Los 9 archivos `*.local.sql` / `*.remote.sql` del directorio no son pgTAP: son
guiones de drill manual sin plan TAP. No forman parte de los 521 y su
«No plan found in TAP output» es preexistente.

### Lo que cubren las 145 nuevas

**`registration_approval_test` — 98**, en 24 secciones. Las que importan:

* pedir acceso no crea membresía, y la compuerta sigue contestando `role: null`;
* insistir no multiplica filas ni suma intentos;
* la sesión anónima del cliente no puede pedir acceso al equipo;
* el solicitante, un empleado con sesión válida, un Rider y el owner del comercio
  vecino: los cuatro reciben 42501 al intentar aprobar;
* nadie decide sobre su propia solicitud, ni un owner;
* `owner` no es otorgable; un admin no puede otorgar `admin`;
* una solicitud de Rider no se puede aprobar como admin;
* el Rider pendiente recibe 42501 en tablero, cola y GPS, y ve 0 pedidos con el
  rol real de PostgREST;
* aprobar crea membresía + seguridad + perfil, y aprobar de nuevo **no sube el
  rol**;
* el Rider aprobado registra su sesión y recibe su tablero;
* rechazo, espera de 24 h, y reuso de la misma fila con `attempt_count + 1`;
* borrar al solicitante, al revisor y al comercio: las tres cascadas, con la
  auditoría sobreviviendo a las tres.

**`customer_profile_isolation_test` — 47**:

* sin sesión no hay perfil (42501);
* el teléfono se guarda normalizado a dígitos, y los límites se prueban;
* la primera dirección queda predeterminada sola, la segunda no la roba;
* **dos predeterminadas las rechaza el índice único**, forzando el estado
  prohibido por UPDATE directo como superusuario;
* duplicados avisados sin crear filas;
* borrar la predeterminada la muda, nunca deja cero;
* el cliente B no ve ni toca nada de A: cinco intentos, incluido pasar el id
  ajeno en el payload;
* con el rol `authenticated` de verdad, cada uno ve una sola fila;
* 9 comprobaciones de grants: lectura sí, escritura nunca, `anon` nada;
* la identidad anónima tiene su propio perfil y no ve el de nadie.

### Controles negativos

Seis. Cada uno rompe a propósito una garantía y comprueba que la suite pasa a
**FAIL**; después se revierte y vuelve a PASS. Log completo en
`NEGATIVE-CONTROLS.log`.

| # | Garantía roto | Suite → |
|---|---|---|
| 1 | se permite la auto-aprobación | FAIL |
| 2 | `granted_role` acepta `owner` | FAIL |
| 3 | el perfil del cliente acepta un `user_id` del cliente | FAIL |
| 4 | se deja caer el índice de una sola predeterminada | FAIL |
| 5 | `anon` recibe EXECUTE sobre las RPC del alta | FAIL (dos suites) |
| 6 | `authenticated` recupera INSERT/UPDATE sobre `business_members` | FAIL |

Las reversiones del 3 y del 4 fallaron en el primer intento, y por un motivo que
vale registrar: el revert reponía la función desde la migración donde **nació**
(`20260728090000`) y no desde la que es su **autoridad actual**
(`20260729150000`). Reponer una versión vieja es una regresión silenciosa, no un
revert. Corregido, los seis controles cierran limpio.

---

## 2. Cliente web (Customer + Panel)

`npm test` — `node --test` sobre 188 archivos.

```
tests 1623
pass  1617
fail  6
```

Los **6 fallos son todos preexistentes** (ver §6). Archivos nuevos: 5.

### Los cinco archivos nuevos

| Archivo | Pruebas | Qué fija |
|---|---|---|
| `business-access-registration.test.mjs` | 12 | la máquina de estados de las cinco pantallas; que un estado desconocido caiga al ingreso y no al formulario; que ninguna pantalla filtre 403/PGRST/JWT/policy; que el motivo interno del comercio no llegue a la persona rechazada; que los datos escritos vuelvan al formulario; que un nombre con comillas no rompa el HTML |
| `business-access-inbox.test.mjs` | 12 | que los roles ofrecidos los decida el servidor; que un rol inventado no llegue a la pantalla; que un empleado no reciba botones de decisión; que a quien ya entró no se le ofrezca aprobar; que una solicitud de Rider sólo ofrezca `rider` |
| `supabase-auth-registration.test.mjs` | 13 | que crear la cuenta no llame a ninguna RPC de identidad; que un correo ya registrado no se confirme ni se desmienta; que entrar con la cuenta pendiente **conserve** la sesión; que un estado indeterminado sí la cierre |
| `panel-access-wiring.test.mjs` | 10 | el pegamento: qué pantalla queda después de cada respuesta del servidor |
| `business-access-inbox-view.test.mjs` | 7 | la bandeja como vista del centro de operación: permiso, carga única, y que aprobar mande el id y el rol de **esa** tarjeta |

(Cinco archivos, 54 pruebas nuevas, más una en el de hidratación del cliente.)

### Dos defectos que encontraron estas pruebas

1. **`CSS.escape` no está en todas partes.** Apretar «Aprobar» tiraba
   `ReferenceError` en Node y lo habría tirado en WebViews viejas.
2. **`humanizeFailure` dejaba pasar `permission denied for table X` entero.** El
   caso de función ya caía en el genérico, pero por accidente: sólo porque «rpc»
   está en el vocabulario prohibido.

Los dos corregidos, con la prueba que los detecta.

---

## 3. Playwright · responsive del alta (nuevo)

`tests/e2e/panel-access-registration.spec.mjs`, Chromium.

```
2 passed
```

| Qué mide | Resultado |
|---|---|
| las 5 pantallas del alta en 390×844, 430×932 y 1440×900 | sin desborde propio ni de página |
| alto de **cada** control que hay que apretar | ≥ 44px en los 3 anchos |
| la bandeja: tarjetas y no tabla | 0 `<table>`, 2 `.access-request-card` |
| la bandeja vista por un empleado | 0 botones de decisión |
| la pantalla de espera | ofrece actualizar y cerrar sesión, y **nada** operativo |
| capturas | 21, en `screenshots/` |

El harness fija `data-active-view="business"` antes de pintar: montar sobre la
vista de inicio dejaba entrar reglas escritas como
`body:not([data-active-view="business"])` y las etiquetas salían lavadas. Medir
en la vista equivocada es medir otra cosa.

## 4. Playwright · suite completa

Medida cuatro veces, y vale contar las cuatro porque la conclusion sale de
compararlas.

| Corrida | Arbol | Resultado | Tiempo |
|---|---|---|---|
| base | `39f13d0` | **358 / 358** | 14,8 min |
| mia, con el APK compilando en paralelo | rama | 358 pasan, 2 fallan | 21,2 min |
| mia, sola | rama | 357 pasan, 3 fallan | 17,8 min |
| mia, con el spec nuevo aliviado | rama | **359 / 360**, 1 falla | **14,3 min** |

Total en la rama = 360: los 358 del base mas los 2 nuevos.

### Que estaba pasando, y como se arreglo

La primera version del spec nuevo abria **un contexto de navegador por ancho**:
seis contextos y seis cargas de pagina para dos pruebas. Eso no rompio nada
propio; le corrio el reloj a los demas. La evidencia de que era eso y no una
regresion:

* los specs que fallaban eran **distintos en cada corrida**: `commercial-polish`,
  despues `business-inbox` + `business-windows-operations`, despues
  `cancel-confirmation`;
* **todos** pasan en aislamiento en la rama, y `cancel-confirmation` pasa 6 veces
  seguidas con `--repeat-each=3`;
* **todos** fallan de la misma forma: un elemento que existe en el DOM pero
  todavia no esta visible o clickeable dentro de los 5s del `expect`. Es la firma
  de un reloj corto bajo carga, no de logica rota;
* ninguno toca superficies de esta mision: son pantallas del Panel en modo demo.

El spec se reescribio para cargar una pagina y cambiar el viewport. Bajo de 22,7s
a 6,5s, y la suite volvio a su tiempo de base.

### La que queda

`cancel-confirmation.spec.mjs:51` falla en 1 de las corridas completas y pasa 6/6
en aislamiento. Queda como P1 de estabilidad de la suite, con su firma escrita:
`.inbox-order[data-inbox-order="LT-0002"]` resuelve al elemento y lo reporta
`hidden` durante 13 intentos. Es el sistema de revelado por animacion no
terminando dentro de los 5s.

---

## 5. App Rider

| Suite | Resultado |
|---|---|
| `flutter analyze` | **No issues found** |
| `flutter test` | **632 / 632 · All tests passed** |
| `:app:testStagingDebugUnitTest` | **195 tests, 0 fallos, 2 skipped** |
| `:app:testProductionDebugUnitTest` | **195 tests, 0 fallos, 2 skipped** |
| `:app:assembleStagingDebug` | **BUILD SUCCESSFUL** (16 min) · `app-staging-debug.apk`, 153,9 MB |

### Lo nuevo

| Archivo | Pruebas | Qué fija |
|---|---|---|
| `SessionManagerAccessRequestTest.kt` (Kotlin) | 11 | que crear la cuenta no escriba sesión en disco ni lleve rol; que una contraseña mal siga siendo un error y no una espera; que el recordatorio del disco no contenga tokens; que aprobar abra la sesión **pasando por la compuerta**; que una solicitud «aprobada» sin membresía viva no abra nada; que cerrar sesión olvide el recordatorio |
| `access_application_test.dart` (Dart) | 11 | que una espera se vea como espera y no como error; que el teléfono use teclado telefónico; que una validación rechazada no expulse a la persona de su solicitud; que un token muerto sí la devuelva al ingreso; que una espera **nunca** lleve rol |

---

## 6. Lo que falla desde antes, y no lo rompió esta misión

Verificado corriendo las mismas pruebas sobre el árbol base (`39f13d0`), antes de
un solo cambio:

| Prueba | Estado en el base | Estado ahora |
|---|---|---|
| `image verification accepts the approved demo…` | FALLA | FALLA |
| `tests/catalog-import.test.mjs` | FALLA | FALLA |
| `tracked release files satisfy every hygiene rule` | FALLA | FALLA |
| `tests/taba2-commercial-catalog-authority.test.mjs` | FALLA | FALLA |
| `photo intake pipeline is reproducible…` | FALLA | FALLA |
| `smoke sin confirmación falla antes de conectarse…` | FALLA | FALLA |

La única regresión que esta misión **sí** introdujo fue
`el árbol publicable coincide con la identidad firmada`, por cambiar archivos
publicables sin refrescar la firma. Se corrigió con `npm run release:identity` y
volvió a PASS.

---

## 7. Smoke sintético contra producción

`scripts/live-registration-smoke.mjs --ref wwcpogltfgzgkrlilbcd --confirm`

```
--- RESULTADO: PASS ---
```

**37 comprobaciones**, todas OK, incluida la limpieza 5/5. Es HTTP real: GoTrue
de verdad, PostgREST de verdad, roles `anon` y `authenticated` de verdad.

Detalle completo en `LIVE-SMOKE.log` y `SYNTHETIC-CLEANUP.md`, incluidos los dos
defectos que encontró y las dos corridas cuya limpieza falló antes de arreglarlos.
