# Riesgos y bloqueos — TABA2 Rider Commercial Redesign

Estado: Fase 1 cerrada. HEAD `95294d9`. Ningún archivo del repositorio modificado aún.

---

## Bloqueos declarados

### R-01 · No existen coordenadas verificadas de La Taba 2 (Mendoza 827) — BLOQUEO

**Evidencia.** Búsqueda exhaustiva en el worktree:
`"Mendoza"` → 0 coincidencias. `"La Taba 2"` → 0 coincidencias.
`supabase/` está vacío. No hay runtime config, fixtures de negocio ni `strings.xml` con
lat/lng. Las únicas coordenadas del repo son placeholders de test:
`-34.6037,-58.3816` (Obelisco, BA) y `-38.9516,-68.0591` (Neuquén capital), ninguna
documentada como la posición del comercio.

**Efecto.** No se puede cumplir la parte de §6 que pide centralizar coordenadas verificadas.

**Mitigación aplicada.** `TabaBusinessIdentity` se define con `latitude`/`longitude`
**nulos** y `coordinatesSource: backendProjectionOnly`. La UI muestra la dirección textual
*Mendoza 827*, el pin sigue dibujándose con el `businessPoint` que envía el backend, y si
ese punto falta se usa la superficie de fallback existente. **No se inventa lat/lng.**

**Para desbloquear.** Hace falta el registro real del negocio (Supabase `businesses`
o equivalente) o una coordenada verificada por operaciones. Fuera del alcance de esta tarea
(§4 prohíbe tocar backend/migraciones).

### R-02 · La sesión no expone el nombre del rider — BLOQUEO PARCIAL

**Evidencia.** `RiderSession` sólo tiene `state, userId, businessId, role,
expiresAtEpochSeconds, error`. En Kotlin, `SessionSnapshot`
(`android/.../auth/SessionModels.kt:38`) está documentado como *"Minimal session view
allowed to Flutter"* y su `toMap()` no incluye nombre ni email. El email sólo se usa como
parámetro de `signIn` y no se retiene.

**Efecto.** El encabezado *"Hola, &lt;nombre del Rider&gt;"* de §14 no puede poblarse con
datos reales sin ampliar el puente nativo de Auth — prohibido por §4.

**Mitigación aplicada.** El encabezado del drawer muestra "Hola" + "TABA2 Rider" + rol y
entorno reales. `RiderDrawer` acepta un `riderName` opcional que se renderiza en cuanto el
puente lo provea, con control de nombres largos (2 líneas + ellipsis). **No se hardcodea
ningún nombre.**

---

## Riesgos de ejecución

### R-03 · 13 goldens PNG se romperán con el cambio visual — ALTO

`test/golden/` tiene 3 suites y `test/goldens/` 13 PNG (`pilot_map_operational.png`,
`pilot_order_detail.png`, `pilot_claim_pending.png`, …). Cualquier cambio de composición
los invalida.

**Plan.** Los goldens se regeneran con `flutter test --update-goldens` **sólo** después de
verificar visualmente cada diferencia, y se reporta cuáles cambiaron y por qué. No se
borra ni se desactiva ninguna suite. Si un golden falla por una regresión real y no por el
rediseño, se corrige el código, no el golden.

### R-04 · Tests acoplados a texto exacto — ALTO

`pilot_readiness_ux_test.dart` depende de `find.text('TABA2 Rider')` (AppBar de
`OrdersPage`), de la etiqueta semántica literal
`'Pedido disponible PR-0001. retiro en Comercio de prueba. zona general Centro'`, de
`'Lista sincronizada'` y de `'No hay pedidos disponibles'`.

Al fijar la identidad a *La Taba 2*, la etiqueta semántica de `AvailableOrderCard` cambia.

**Plan.** Se actualizan las expectativas de los tests para reflejar el comportamiento
nuevo **correcto**, nunca para ocultar una regresión. Cada cambio de expectativa queda
justificado en el reporte final. `OrdersPage` se conserva (pasa a ser la vista *Entregas*
del drawer), así que la mayoría de esos tests siguen aplicando.

### R-05 · Fail-closed por negocio distinto puede vaciar la cola en staging — MEDIO

Si los datos de staging traen `businessName` distinto de *La Taba 2*
(los fixtures usan `'Comercio de prueba'` y `'Casa Central'`), la comparación estricta
ocultaría todos los pedidos.

**Plan.** `matchesConfiguredBusiness()` falla cerrado **para la presentación de identidad**
(no rotula un pedido ajeno como La Taba 2) pero no descarta el pedido en silencio: muestra
un estado explícito de discrepancia con acción *Actualizar* y registra un diagnóstico
sanitizado. La verificación real de pertenencia sigue siendo del backend vía `business_id`,
que no se toca.

### R-06 · Cambiar el home puede romper la restauración de sesión — MEDIO

`SessionGate` → `AuthenticatedSessionPage` construye hoy `OrdersPage` con
`OrdersController` + `DeliveryController`. Reemplazar el home exige preservar
`initState`/`dispose` y el `unawaited(_deliveryController.initialize())`.

**Plan.** `RiderHomePage` recibe los mismos controladores ya construidos por
`AuthenticatedSessionPage`; no crea ni destruye controladores propios.

### R-07 · El sheet expandido puede tapar los controles con textScale alto — MEDIO

`_collapsedFor()` escala la altura del sheet hasta `1.6×` y la limita a `0.62` de la
pantalla. Con contenido nuevo (drawer, estados A–C) puede haber overflow a 320 dp.

**Plan.** Pruebas de layout en 320/360/390/412/432 con `textScaler` 1.0 y 2.0, verificando
`tester.takeException() == null` y CTA visible.

### R-08 · Regenerar goldens exige CPU; el lock es compartido — BAJO

`D:\1212\_claude-locks` está libre (sólo hay 3 `.txt` marcadores, ningún directorio de
lock). El build staging debug y la regeneración de goldens se hacen bajo
`heavy-compute.lock` creado como **carpeta atómica sin `-Force`**, con `owner.txt`, y se
libera sólo tras verificar el PID propio.

---

## Restricciones que se respetan (verificadas antes de editar)

- Worktree fuente `D:\1212\worktrees\taba2-rider-map` en `95294d9`, Git limpio: **intacto**.
- Automatización del smoke `D:\1212\la-taba-rider-smoke-automation` en `8e2b671`: **no se toca**.
- APK target `d64d688985f2…ed781299`: **no se reemplaza**.
- Sin `git reset` / `clean` / `stash` / `amend` / `add .` / `push` / deploy.
- Sin instalar sobre `com.lataba.rider.staging` en el Moto; sin `pm clear`; sin androidTest.
- Sin tocar backend, Supabase, migraciones, RLS, RPC, claim/retiro/entrega, persistencia,
  GPS productivo, cola offline, Mercado Pago, ARCA, Panel, Storefront ni LT-0030.
- Declaración máxima: `TABA2_RIDER_COMMERCIAL_REDESIGN_READY_FOR_PHYSICAL_REVIEW`.
