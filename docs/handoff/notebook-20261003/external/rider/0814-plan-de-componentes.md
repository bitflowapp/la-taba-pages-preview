# Plan de componentes — TABA2 Rider Commercial Redesign

Principio rector: **extender la arquitectura existente, no crear una paralela.** El
`RiderMapView` ya implementa el patrón mapa-protagonista y se reutiliza tal cual; lo que
falta es elevarlo a pantalla raíz y darle el chrome comercial (menú, drawer, modales).

---

## 1. Archivos nuevos

| Archivo | Contenido | Commit |
|---|---|---|
| `lib/core/theme/taba2_tokens.dart` | Sombras, radios de píldora, duraciones de animación y el mapeo único de tono semántico | 1 |
| `lib/core/widgets/taba2_modal.dart` | `showTaba2Modal()` + `Taba2ModalSpec` — lenguaje visual único de modales | 6 |
| `lib/domain/business/taba_business_identity.dart` | `TabaBusinessIdentity` (nombre, dirección, lat/lng opcionales, fuente documentada) | 2 |
| `lib/core/config/business_config.dart` | Instancia única `kTabaBusinessIdentity` + `matchesConfiguredBusiness()` fail-closed | 2 |
| `lib/features/map/presentation/rider_home_page.dart` | Pantalla raíz map-first que reemplaza a `OrdersPage` como home | 3 |
| `lib/features/map/presentation/widgets/rider_home_sheet_states.dart` | Contenido del sheet para los estados A, B, C | 4 |
| `lib/features/shell/presentation/rider_drawer.dart` | Drawer con encabezado de sesión y tarjetas reales | 5 |
| `lib/features/shell/presentation/help_sheet.dart` | Hoja de ayuda local (sin soporte remoto inventado) | 3 |

## 2. Archivos modificados

| Archivo | Cambio | Commit |
|---|---|---|
| `core/theme/taba2_theme.dart` | Consumir los tokens nuevos; sin cambiar valores de color existentes | 1 |
| `features/map/presentation/widgets/map_overlay_controls.dart` | Adoptar tokens de sombra/píldora; `MapCircleButton` con estado *pressed* y `badge` opcional | 1, 3 |
| `features/map/presentation/rider_map.dart` | Aceptar `onMenu` (botón de menú a la izquierda) además de `onBack`; `leadingControl` configurable | 3 |
| `features/map/presentation/widgets/rider_sheet.dart` | `showHandle` condicional (sólo si es arrastrable) y subtítulo opcional | 4 |
| `features/orders/presentation/order_detail_page.dart` | Identidad centralizada en `_stops()`/`_mapData()`; CTA `Volver a la cola` en `delivered`; modales unificados | 2, 4, 6 |
| `features/auth/presentation/session_gate.dart` | `home:` pasa a `RiderHomePage` | 3 |
| `features/orders/presentation/orders_page.dart` | Se conserva como **vista de lista secundaria** accesible desde el drawer (*Entregas*) | 3, 5 |

## 3. Componentes reutilizados sin tocar

`MapStopPin`, `MapZoneBadge`, `RiderPuck`, `MapCompass`, `MapAttribution`,
`MapNotice`, `MapStatusCapsule`, `RiderStopList`, `OperationalStatusBanner`,
`ServiceBanner`, `AvailableOrderCard`, `AssignedOrderCard`.

---

## 4. Decisiones de diseño

### 4.1 El home pasa a ser el mapa, la lista no desaparece

`RiderHomePage` compone `RiderMapView` con los mismos controladores que hoy usa
`OrdersPage` (`OrdersController` + `DeliveryController`). Resuelve el estado dominante en
este orden, que es el orden real de prioridad operativa:

```
assigned != null                → delega en el flujo de entrega (estados D–H)
available.isNotEmpty            → estado C (pedido disponible; el primero de la cola)
status == loading || initial    → estado B
failure != null                 → estado I / error
resto                           → estado A
```

Con más de un pedido disponible, el sheet muestra el primero y un enlace
**Ver los N pedidos** que abre `OrdersPage` — se conserva la lista completa sin
convertir el home en una lista.

### 4.2 Un solo botón circular inferior

El código ya usa `_recenter()` que hace `rotate(0)` + `fitCamera()`. Se conserva **un**
control (`map-recenter`), tal como pide §9. La brújula sigue siendo un control aparte
porque tiene una función distinta y ya existía; sólo aparece cuando el mapa está rotado.

### 4.3 Soporte = ayuda local

No existe soporte remoto. El botón superior derecho abre `help_sheet.dart` con:
problemas comunes, cómo reportar una incidencia (que sí existe: `reportDeliveryIssue`) y
el estado técnico sanitizado. **No** simula llamada, WhatsApp ni teléfono.

### 4.4 Drawer con datos reales únicamente

| Elemento | Fuente real | Si no hay dato |
|---|---|---|
| Saludo | — | "Hola" a secas; ver bloqueo R-02 |
| Identidad | `AppConfig.brandName` + `'Rider'` | siempre presente |
| Rol / entorno | `RiderSession.role`, `AppConfig.environmentLabel` | siempre presente |
| Tarjeta *Entregas de hoy* | **no existe endpoint** → se omite | omitida |
| Tarjeta *Estado de conexión* | `DeliveryController.service` | siempre presente |
| Tarjeta *Última sincronización* | `OrdersViewState.lastSyncedAt` | "Sin confirmar" |
| Secciones | Inicio, Entregas (`OrdersPage`), Ayuda, Cerrar sesión | — |

**No se crean** Perfil ni Configuración: no existen esas pantallas y §14 prohíbe
pantallas vacías. Se dejan fuera y se declara en el reporte.

### 4.5 Modales unificados

`showTaba2Modal()` recibe un `Taba2ModalSpec { icon, title, body, primaryLabel,
onPrimary, secondaryLabel, onSecondary, tone }` y produce un `AlertDialog` con:
`barrierDismissible` según criticidad, foco contenido, `Semantics(scopesRoute, namesRoute)`,
botón Atrás seguro y contraste verificado. Los tres modales existentes se migran a este
helper conservando su texto y su comportamiento exacto.

### 4.6 Identidad del comercio

```dart
class TabaBusinessIdentity {
  const TabaBusinessIdentity({
    required this.name,
    required this.address,
    this.latitude,
    this.longitude,
    required this.coordinatesSource,
  });
  bool get hasVerifiedCoordinates => latitude != null && longitude != null;
}

const kTabaBusinessIdentity = TabaBusinessIdentity(
  name: 'La Taba 2',
  address: 'Mendoza 827',
  coordinatesSource: BusinessCoordinatesSource.backendProjectionOnly,
);
```

Reglas de uso:

1. El **nombre y la dirección visibles** salen siempre de `kTabaBusinessIdentity`; se dejan
   de mostrar `businessName`/`businessAddress` crudos y el genérico `'Retiro'`.
2. El **pin del mapa** sigue usando `businessPoint` del backend. Si es `null`, se muestra
   la dirección textual y el fallback. **No se inventa lat/lng.**
3. `matchesConfiguredBusiness(order)` compara el nombre/dirección proyectados con la
   identidad configurada de forma normalizada. Si no coinciden: **fail-closed** — el pedido
   no se presenta como de La Taba 2, se registra `SanitizedLogger.event('BUSINESS_IDENTITY_MISMATCH')`
   sin IDs ni datos humanos, y la UI pide actualizar.
4. `business_id` no se toca en ninguna capa.

---

## 5. Orden de commits

1. Sistema visual (tokens, sombras, tonos unificados)
2. Identidad de La Taba 2 (modelo + config + uso en sheet/pin/navegación)
3. Pantalla raíz map-first (menú, estado, ayuda, recenter, SafeArea)
4. Bottom sheet contextual por estado (A–I)
5. Drawer
6. Modales operativos unificados
7. Accesibilidad, responsive y microcopy + pruebas nuevas
