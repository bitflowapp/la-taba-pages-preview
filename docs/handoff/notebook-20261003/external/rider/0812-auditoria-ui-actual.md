# Auditoría de la UI actual — TABA2 Rider

Worktree auditado: `D:\1212\worktrees\taba2-rider-commercial-redesign`
Rama: `feature/taba2-rider-commercial-redesign`
HEAD auditado: `95294d9d36a6429a21a562ea6a48b8c9ecbf8523`
Fuente: worktree `D:\1212\worktrees\taba2-rider-map` (`codex/rider-map-staging`), **no modificado**.
Fecha: 2026-08-05

---

## 1. Arquitectura real encontrada

Flutter 3.44.6 / Dart 3.12.2, null-safety, Material 3.

Dependencias de producción (`pubspec.yaml`): `flutter_map ^8.3.1`, `latlong2 ^0.10.1`,
`url_launcher ^6.3.2`. **No hay** provider/riverpod/bloc/get_it: el estado se maneja con
`ChangeNotifier` + `AnimatedBuilder`/`addListener` y se inyecta por constructor.

Organización feature-first:

```
lib/
  app.dart                     MaterialApp + AuthController
  main.dart / main_staging.dart / main_production.dart
  core/      config (AppConfig, AppFlavor), theme (taba2_theme), logging,
             errors, result, routing (app_router.dart = 48 bytes, vacío),
             time, validation, widgets (app_error_view, operational_status_banner)
  domain/    auth, delivery, map, orders           <- modelos puros
  data/      dto, mappers, datasources, repositories
  platform/  rider_method_channel, rider_event_channel, platform_codec,
             platform_permissions
  features/  auth, delivery, map, orders           <- application/ + presentation/
```

Navegación: **no hay router declarativo**. `app_router.dart` está vacío (48 bytes).
Se usa `MaterialApp(home: SessionGate(...))` y un único `Navigator.push` con
`MaterialPageRoute` desde `OrdersPage` hacia `OrderDetailPage`.

Sabores: `AppFlavor.staging` → `com.lataba.rider.staging`;
`AppFlavor.production` → `com.lataba.rider` (`lib/core/config/flavor.dart`).

---

## 2. Pantallas existentes

| # | Pantalla | Archivo | Rol |
|---|---|---|---|
| 1 | `_RestoringSessionPage` | `features/auth/presentation/session_gate.dart:16` | Spinner de restauración de sesión |
| 2 | `LoginPage` | `features/auth/presentation/login_page.dart` | Login email/contraseña (delegado a Kotlin) |
| 3 | `OrdersPage` | `features/orders/presentation/orders_page.dart` | **Home actual**: AppBar + ListView de cola |
| 4 | `OrderDetailPage` | `features/orders/presentation/order_detail_page.dart` | Detalle operativo, **map-first**, por pedido |
| 5 | `ActiveDeliveryPage` | `features/delivery/presentation/active_delivery_page.dart` | Archivo de 38 bytes — **stub vacío, no referenciado** |

**Hallazgo estructural principal:** la app es *list-first*. El mapa sólo existe dentro de
`OrderDetailPage`, detrás de un `Navigator.push`. El home (`OrdersPage`) es un
`Scaffold` con `AppBar` + `ListView` de tarjetas, sin mapa, sin drawer y sin cápsula de
estado. La referencia visual exige exactamente lo contrario: mapa protagonista en la raíz.

---

## 3. Componentes de UI actuales

### 3.1 Sistema visual — `core/theme/taba2_theme.dart`

Ya existen tokens propios y son buenos. `Taba2Colors`: `canvas #FFFEFC`, `surface #FFFFFF`,
`surfaceSubtle`, `graphite #1F2329`, `muted`, `outline`, `red #BC1F2D`, `redDark`,
`success #1F6B46`, `warning #925F00`, `error #B3261E`, `cream #FAF7F2`, `creamLine`,
`ink #14171B`, `live #1FA45B`, `mapCanvas #E9E6E1`, `riderBlue #1769E0`, `mapCustomer`.

`Taba2Space`: `xxs 4 / xs 8 / sm 12 / md 16 / lg 24 / xl 32`, `controlHeight 52`,
`tapTarget 48`, `radius 16`, `ctaHeight 56`, `sheetRadius 28`, `mapControl 48`.

`buildTaba2Theme()` construye un `ThemeData` M3 claro, con `Typography.material2021()`.

Brechas: no hay tokens de elevación/sombra (las sombras están inline y duplicadas en
`MapCircleButton`, `MapStatusCapsule`, `MapNotice`, `RiderSheet`), no hay familia de tono
semántico compartida entre `RiderMapStatusTone` y `OperationalTone` (dos enums paralelos),
y no hay token de radio de píldora (se repite `99` a mano).

### 3.2 Mapa — `features/map/presentation/`

- `rider_map.dart` (808 líneas) — `RiderMapView`: `Stack` con mapa a pantalla completa,
  top bar, avisos flotantes, controles circulares y bottom sheet. Cámara con `fitCamera`
  + offset por chrome, reintento hasta 8 frames. Fallback `_MapFallbackSurface` cuando no
  hay coordenadas. Fallo de tiles → `MapNotice`. Abre Google Maps por `url_launcher` con
  `Uri.https('www.google.com','/maps/search/', {api:1, query: address})`.
- `widgets/map_overlay_controls.dart` — `MapCircleButton` (48 dp, elevación 3, `Semantics`),
  `MapStatusCapsule` (caption + valor + punto de color, `liveRegion`), `MapCompass`
  (`CustomPaint`), `MapNotice`, `MapAttribution`.
- `widgets/rider_sheet.dart` — `RiderSheet` (crema, radio 28, handle, cuerpo scrollable,
  footer fijo), `RiderStopList`/`_StopRow` con conector vertical entre retiro y entrega.
- `widgets/map_markers.dart` — `MapStopPin`, `MapZoneBadge`, `RiderPuck`, `FreshnessBadge`.
- `application/map_controller.dart` — 61 bytes, **vacío**.
- `map_style.dart` — 416 bytes, MapLibre deliberadamente sin configurar.

**El patrón de referencia ya está implementado, pero sólo para un pedido.**

### 3.3 Cola — `features/orders/presentation/`

- `orders_page.dart` — `AppBar` con título `TABA2 Rider`, botón refrescar y
  `PopupMenuButton` con una sola opción "Cerrar sesión" (**el único acceso a cuenta hoy**).
  Cuerpo: `_QueueStateBanner` + sección "Tu entrega activa" + sección "Pedidos disponibles".
- `widgets/order_card.dart` — `AvailableOrderCard`, `AssignedOrderCard`, con `Semantics`
  compuesta y `_Fact`/`_InfoLine`.
- `order_detail_page.dart` (1101 líneas) — orquesta todo: mapa, estado, CTA único,
  panel de código, incidencias, recibos, permisos.

### 3.4 Compartidos

- `core/widgets/operational_status_banner.dart` — banner con `OperationalTone`
  (`success/warning/error/progress`), `liveRegion`, acción opcional.
- `features/delivery/presentation/widgets/service_banner.dart` — estado del servicio nativo.
- `features/map/presentation/widgets/freshness_badge.dart` — 40 bytes, vacío.

### 3.5 Drawer

**No existe.** No hay `Drawer`, `NavigationDrawer` ni `Scaffold.drawer` en todo `lib/`.
La única navegación de cuenta es el `PopupMenuButton` de `OrdersPage`.

### 3.6 Modales existentes

| Modal | Ubicación | Tipo |
|---|---|---|
| Permisos para el seguimiento | `order_detail_page.dart:586` | `AlertDialog` con icono, 2 acciones |
| ¿Detener seguimiento técnico? | `order_detail_page.dart:613` | `AlertDialog`, 2 acciones |
| Selector de incidencia | `order_detail_page.dart:500` | `showModalBottomSheet` + 7 `ListTile` |

No comparten un lenguaje visual común: cada uno construye su propio `AlertDialog`.
No hay modal de "sin conexión", "sesión expirada", "pedido cancelado" ni
"entrega completada" — esos estados hoy se comunican sólo por banners dentro del sheet.

---

## 4. Identidad del negocio

**No hay ninguna identidad comercial fija en el código.** Búsqueda exhaustiva:

- `"Mendoza"` → **0 coincidencias** en todo el repositorio.
- `"La Taba 2"` → **0 coincidencias** en todo el repositorio.
- `brandName` → `'TABA2'` (constante en `core/config/app_config.dart:15`), es la marca de la
  *app*, no del comercio.

El nombre y la dirección del comercio llegan **en runtime** desde la proyección del backend:

- `AvailableOrder.businessName` / `.businessAddress` / `.businessPoint` / `.pickupBranch`
- `Order.businessName` / `.businessAddress` / `.businessPoint`
- `order_mapper.dart:17` → `businessName: dto.businessName ?? dto.pickupBranch`
- `order_detail_page.dart:252` → `title: data.businessName ?? 'Retiro'`

Es decir: hoy la UI muestra literalmente lo que mande el servidor, y cae al texto genérico
`'Retiro'` / `'Dirección de retiro no informada'` cuando falta. Los fixtures de test usan
`'Comercio de prueba'` y `'Casa Central'`.

`business_id` existe en la capa de sesión y seguridad (`RiderSession.businessId`,
`StoredSession.businessId` en Kotlin con `require(businessId.isNotBlank())`) — **no se toca**.

## 5. Coordenadas

**No existen coordenadas verificadas de La Taba 2 / Mendoza 827 en el repositorio.**

Todas las coordenadas encontradas son fixtures de test, y ninguna está documentada como la
posición real del comercio:

| Coordenada | Dónde | Qué es |
|---|---|---|
| `-34.6037, -58.3816` | `test/golden/pilot_map_golden_test.dart`, `test/features/map/*`, `android/**/BackendDtosTest.kt` | Obelisco, Buenos Aires — placeholder genérico |
| `-34.6137, -58.3916` | ídem | placeholder de cliente |
| `-38.9516, -68.0591` | `test/features/map/order_detail_map_actions_test.dart:15`, `delivery_privacy_test.dart:7` | Neuquén capital — placeholder regional |
| `-38.9549, -68.0624` | ídem | placeholder de cliente |

No hay `supabase/` con migraciones (el directorio está vacío), no hay fixtures de negocio,
no hay runtime config con lat/lng, no hay `strings.xml` con datos del comercio.

**Consecuencia (bloqueo declarado, ver `riesgos.md` R-01):** no se pueden centralizar
coordenadas verificadas. Se implementa `TabaBusinessIdentity` con `latitude`/`longitude`
**nulos**, se muestra la dirección textual, y el pin sigue dibujándose con el
`businessPoint` que envía el backend. No se inventa ninguna latitud ni longitud.

---

## 6. Privacidad pre/post claim (estado actual — correcto, se conserva)

`domain/map/delivery_privacy.dart` implementa:

- `approximateZoneStepDegrees = 0.005` (~550 m) y `coarsenToDeliveryZone()` que ajusta el
  punto exacto a una grilla pública; dos pedidos de la misma manzana colapsan al mismo centro.
- `approximateZoneRadiusMeters = 450` para el círculo dibujado.
- `maskAddressNumbers()` que reemplaza dígitos conservando el primero de cada corrida.

`OrderMapData.deliveryDisplayPoint` devuelve la zona cuando
`customerLocationIsApproximate == true`. En `order_detail_page.dart:274-294` el pre-claim
siempre pasa `customerLocationIsApproximate: true` y prefiere `'Zona <generalZone>'` sobre
la dirección enmascarada. `_navigationAddress()` (línea 318) nunca entrega la dirección del
cliente antes del claim: pre-claim sólo devuelve el pickup.

`distanceToDeliveryKm()` mide contra el centro de zona, así que el número mostrado no
permite recuperar la dirección exacta.

**Brecha:** no hay un test que verifique explícitamente la separación pre/post claim a
nivel de widget (el test existente `delivery_privacy_test.dart` cubre sólo las funciones
puras). Se agregan en la Fase 3.

---

## 7. Identidad del rider (para el drawer)

`RiderSession` (`domain/auth/rider_session.dart`) expone únicamente
`state`, `userId`, `businessId`, `role`, `expiresAtEpochSeconds`, `error`.

En Kotlin, `SessionSnapshot` (`android/.../auth/SessionModels.kt:38`) está comentado como
*"Minimal session view allowed to Flutter"* y su `toMap()` emite exactamente esos campos.
El email se usa sólo como parámetro de `signIn` y no se retiene.

**Consecuencia (bloqueo declarado, ver `riesgos.md` R-02):** no hay nombre de rider
disponible. El encabezado del drawer no puede decir "Hola, <nombre>" con datos reales sin
modificar el puente nativo de Auth, que está fuera de alcance (§4). Se implementa el
encabezado degradando con honestidad y aceptando un nombre opcional para cuando el puente
lo provea.

---

## 8. Tests existentes (línea base a no romper)

23 archivos en `test/`, 5 en `integration_test/`, 13 goldens PNG.

Relevantes para UI:
- `test/features/pilot_readiness_ux_test.dart` — depende de `find.text('TABA2 Rider')` en
  `OrdersPage`, de la etiqueta semántica exacta de `AvailableOrderCard`, de
  `'Lista sincronizada'`, `'No hay pedidos disponibles'` y de la clave
  `ValueKey('detail-delivery-action')`.
- `test/features/map/rider_map_test.dart` (13 KB) — geometría del mapa, `map-recenter`.
- `test/features/map/order_detail_map_actions_test.dart` — acciones y navegación.
- `test/golden/pilot_operational_states_golden_test.dart` + `pilot_map_golden_test.dart` +
  `pilot_readiness_golden_test.dart` con 13 goldens PNG.
- `test/features/orders/orders_test.dart`, `claim_order_test.dart`,
  `test/features/delivery/start_delivery_test.dart`.

**Riesgo alto:** los goldens PNG se romperán con cualquier cambio visual. Ver `riesgos.md` R-03.

---

## 9. Resumen de brechas contra el objetivo comercial

| # | Brecha | Severidad |
|---|---|---|
| G-01 | El home no es el mapa; el mapa vive detrás de un push por pedido | Alta |
| G-02 | No existe drawer; sólo un `PopupMenuButton` con "Cerrar sesión" | Alta |
| G-03 | No existe botón de menú flotante ni soporte en el home | Alta |
| G-04 | No hay identidad de comercio centralizada; se muestra lo que mande el server | Alta |
| G-05 | No hay coordenadas verificadas del comercio | Alta (bloqueo) |
| G-06 | Sin estados de sheet para "no repartiendo" / "buscando pedidos" con mapa | Alta |
| G-07 | Modales sin lenguaje visual común; faltan offline/sesión/cancelado/completado | Media |
| G-08 | Tonos duplicados (`RiderMapStatusTone` vs `OperationalTone`) | Media |
| G-09 | Sombras y radios de píldora inline y duplicados, sin token | Baja |
| G-10 | Sin nombre de rider en la sesión para el encabezado del drawer | Media (bloqueo parcial) |
| G-11 | Sin pruebas de layout por ancho (320/360/390/412/432) | Media |
