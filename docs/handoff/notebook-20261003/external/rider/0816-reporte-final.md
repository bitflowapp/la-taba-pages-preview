# Reporte final — TABA2 Rider Commercial Redesign

**TABA2_RIDER_COMMERCIAL_REDESIGN_READY_FOR_PHYSICAL_REVIEW**

Fecha: 2026-08-05. Sin push. Sin deploy. Sin instalación en dispositivo.

---

## 1–5. Worktree, rama y estado de Git

| | |
|---|---|
| Worktree | `D:\1212\worktrees\taba2-rider-commercial-redesign` |
| Rama | `feature/taba2-rider-commercial-redesign` |
| HEAD inicial | `95294d9d36a6429a21a562ea6a48b8c9ecbf8523` |
| HEAD final | `6cdaac8` |
| Git inicial | limpio (0 entradas) |
| Git final | limpio (0 entradas), `git diff --check` sin hallazgos |
| Fuente `taba2-rider-map` | `95294d9…`, limpio — **intacta** |
| Automatización del smoke | `8e2b671`, limpio — **intacta** |
| APK target del smoke | `d64d6889…ed781299` — **no reemplazado** |

## 6. Arquitectura encontrada

Flutter 3.44.6 / Dart 3.12.2, Material 3, null-safety. Feature-first
(`core/ domain/ data/ platform/ features/`), estado con `ChangeNotifier`
inyectado por constructor, sin router declarativo. Dependencias de producción:
`flutter_map`, `latlong2`, `url_launcher` — **no se agregó ninguna**.

Hallazgo estructural: la app era *list-first*; el mapa sólo existía dentro de
`OrderDetailPage`, detrás de un `Navigator.push`. No había drawer.

## 7. Archivos modificados

`core/theme/taba2_theme.dart`, `core/config/app_config.dart`,
`core/widgets/operational_status_banner.dart`,
`features/map/presentation/rider_map.dart`,
`features/map/presentation/widgets/map_overlay_controls.dart`,
`features/map/presentation/widgets/rider_sheet.dart`,
`features/orders/presentation/order_detail_page.dart`,
`features/orders/presentation/orders_page.dart`,
`features/orders/presentation/widgets/order_card.dart`,
`features/auth/presentation/session_gate.dart`.

## 8. Componentes creados

| Archivo | Rol |
|---|---|
| `core/theme/taba2_tokens.dart` | Radios, elevación, sombras, motion, `Taba2Tone` |
| `core/widgets/taba2_modal.dart` | `Taba2ModalSpec` + `showTaba2Modal` |
| `core/config/business_config.dart` | `kTabaBusinessIdentity` |
| `domain/business/taba_business_identity.dart` | Identidad, matching, query de navegación |
| `features/map/presentation/rider_home_page.dart` | Pantalla raíz map-first |
| `features/shell/presentation/rider_drawer.dart` | Drawer |
| `features/shell/presentation/help_sheet.dart` | Ayuda local |
| `features/orders/presentation/order_presentation.dart` | Proyección pre-claim y stops compartidos |
| `features/orders/presentation/widgets/claim_status_banner.dart` | Resultado de claim compartido |
| `features/orders/presentation/widgets/order_fact.dart` | Dato corto reutilizable |
| `tool/screenshots.dart` | Generador de capturas |

## 9. Sistema visual

Tokens centralizados en `taba2_tokens.dart`: `Taba2Radius` (pill/control/cta/
block/sheet/modal), `Taba2Elevation`, `Taba2Shadow`, `Taba2Motion` y
`Taba2Tone` + `Taba2ToneStyle`. `RiderMapStatusTone` y `OperationalTone` ahora
mapean al mismo tono, así que una advertencia se ve igual en cápsula, aviso y
banner. **Ningún valor de color de la paleta TABA2 cambió.**

## 10–11. Estados cubiertos y bottom sheet

Cola: Buscando pedidos · Sin pedidos · Pedido disponible · Sin conexión ·
Sesión vencida. Entrega: Yendo a La Taba 2 · Pedido retirado · Yendo al cliente ·
Llegaste · Entrega completada. Más: retiro no reconocido (fail-closed), GPS
stale/none, cola de ubicación pendiente, sin coordenadas.

Cada estado tiene cápsula, encabezado (tarea), subtítulo (próximo paso) y **un
único CTA principal**. Matriz completa en `state-machine-visual.md`.

## 12. Drawer

Encabezado con saludo, marca y entorno reales; tarjetas de estado de conexión y
última sincronización; secciones Inicio, Entregas, Ayuda y Cerrar sesión.
Cierra al tocar fuera y antes de navegar, con scrim y `selected` semántico.
**Sin balance, ganancias, mensajes, pagos, horas, bonos ni logros.**
Perfil y Configuración se omiten: no existen esas pantallas.

## 13. Modales

`showTaba2Modal` con forma única. Migrados: permisos de seguimiento y detener
seguimiento. Nuevos: permiso de ubicación denegado, notificaciones denegadas,
ubicación del teléfono apagada. Atrás y scrim resuelven siempre a «no».
Pérdida de conexión y errores de sincronización quedan como avisos en el mapa
a propósito: bloquear al rider en la calle por algo que se recupera solo es
peor que decírselo.

## 14. Único negocio

`kTabaBusinessIdentity` (`La Taba 2`, `Mendoza 827`) alimenta pin, tarjeta de
retiro, bottom sheet, encabezado, cola, navegación y ayuda. No hay selector de
sucursal, listado ni texto genérico «Retiro». Un pedido cuya proyección nombre
otro comercio **falla cerrado**: no se rotula como La Taba 2, no ofrece acción
y registra `BUSINESS_IDENTITY_MISMATCH` sanitizado, una sola vez y sin IDs.
`business_id` no se tocó en ninguna capa.

## 15. Fuente de coordenadas — BLOQUEO

**No existen coordenadas verificadas de Mendoza 827 en el repositorio.**
`"Mendoza"` y `"La Taba 2"` → 0 coincidencias en HEAD `95294d9`. `supabase/`
vacío. Las únicas coordenadas del repo son fixtures de test
(`-34.6037,-58.3816` Obelisco; `-38.9516,-68.0591` Neuquén), ninguna documentada
como el comercio.

Resultado: `TabaBusinessIdentity` lleva `latitude`/`longitude` **nulos** y
`coordinatesSource: backendProjectionOnly`. El pin sigue usando el
`businessPoint` que proyecta el backend por pedido; si falta, se muestra la
dirección textual y el fallback. **No se inventó ninguna latitud ni longitud.**
`business_config.dart` documenta dónde iría una coordenada verificada.

## 16. Privacidad

Pre-claim: zona generalizada (grilla pública de 0,005°, círculo de 450 m) o
dirección con dígitos enmascarados; nunca el domicilio exacto, ni en pantalla,
ni en semántica, ni en la navegación externa. Post-claim: dirección exacta y
navegación. La regla vive ahora en **una sola implementación**
(`order_presentation.dart`), usada por la raíz y por el detalle.

## 17. Accesibilidad

Labels y roles en cada control; cápsula y avisos como `liveRegion`; `selected`
en el drawer; foco contenido y Atrás seguro en los modales; el color nunca es
el único indicador (punto de tono + texto); franja de arrastre de 44 dp;
controles del mapa ≥ 48 dp; CTA ≥ 48 dp; textos largos con `maxLines` y
elipsis. La dirección exacta pre-claim no se filtra por semántica (probado).

## 18. Responsive

Matriz 320/360/390/412/432 dp × textScale 1× y 2× sobre home, pedido
disponible, panel de código y drawer: **43 pruebas, cero overflow**. Se
corrigieron dos defectos reales encontrados así:

1. El bottom sheet fijaba el encabezado, y al envolverse empujaba el CTA fuera
   del sheet — 5,8 px ya en 320 dp con texto normal. El encabezado ahora
   acompaña al cuerpo y sólo la franja de agarre queda fija.
2. Los datos cortos (bultos, cobro, minutos) se salían hasta 158 px a 2× porque
   su fila no dejaba envolver el texto.

## 19. Pruebas

| Suite | Resultado |
|---|---|
| `flutter analyze` | **No issues found** |
| `flutter test` (Dart/widget/golden) | **202 pruebas, todas verdes** (base: 109) |
| Kotlin JVM `testStagingDebugUnitTest` | **14 suites, 68 pruebas, 0 fallos, 2 skipped** |
| `git diff --check` | sin hallazgos |
| Secret scan sobre el diff de rama | sin coincidencias |

Pruebas nuevas: identidad y fail-closed (10), drawer (11), pantalla raíz (12),
matriz de estados (10), modales (7), responsive (43).

Los 9 goldens afectados se regeneraron **después** de revisar cada diferencia.
Se corrigió además `pilot_location_permission.png`, que capturaba sólo el
`Scaffold` y por eso nunca contuvo el modal que nombra. Ninguna prueba se
modificó para ocultar una regresión; los cambios de expectativa son
consecuencia directa y verificada del rediseño.

## 20. Build

`flutter build apk --flavor staging --debug -t lib/main_staging.dart` →
**BUILD SUCCESSFUL** (345 s).
Artefacto: `build/app/outputs/flutter-apk/app-staging-debug.apk`
SHA-256 `a50a8b08a5043fbed0eb36d2dba33cb01dfaa11ca034abe5126c3d3892cd2cc8`
(distinto del target congelado del smoke, y nunca instalado).

## 21. Capturas

36 PNG en `screenshots/`: 12 estados × 320/390/432 dp, a 2× con Roboto real.
Comparación antes/referencia/resultado en
`comparacion-antes-referencia-resultado.md`. Los tiles salen en blanco a
propósito: un widget test no puede descargarlos y dibujar calles falsas
representaría mal lo que ve el rider.

## 22. Commits

```
6cdaac8 chore(tool): add the design-review screenshot generator
bc6f14b fix(ui): stop the sheet overflowing on real phones
de8bb4d feat(core): give operational modals one shape
279a248 feat(delivery): give every operational state its own sheet
bb53c76 feat(map): make the map the root screen
19e36e3 feat(shell): add the rider drawer and a local help sheet
a438639 feat(business): name La Taba 2 as the single pickup
cbe6cf2 feat(theme): add shared TABA2 visual tokens
```

El orden sugerido se reorganizó por una razón concreta: el botón de menú no
podía existir antes que el drawer, así que el drawer va antes que la pantalla
raíz. Sin commit monolítico y sin `git add .`.

## 23. Locks

`D:\1212\_claude-locks\heavy-compute.lock` adquirido como carpeta atómica sin
`-Force`, con `owner.txt` (OWNER, PID, CREATED_UTC, WORKTREE, HEAD, PURPOSE),
para el build y la regeneración de goldens. Liberado tras verificar propiedad y
que el PID registrado ya no vivía. `moto-g15.lock` nunca se pidió: no se usó el
teléfono. No se tocó ningún lock ajeno.

## 24. Bloqueos

| # | Bloqueo | Efecto | Qué falta |
|---|---|---|---|
| R-01 | Sin coordenadas verificadas de Mendoza 827 | El pin depende del `businessPoint` del backend; sin él, sólo dirección textual | El registro real del negocio o una coordenada validada por operaciones (fuera de alcance: §4 prohíbe tocar backend) |
| R-02 | La sesión nativa no expone el nombre del rider | El drawer saluda «Hola» sin nombre | Ampliar `SessionSnapshot` en el puente Auth (fuera de alcance) |
| — | Llegaron 3 de las 4 capturas de referencia | Falta la del drawer | El drawer se resolvió con la especificación estructural del §14 |

## 25. Artefactos

`D:\1212\artifacts\taba2-rider-commercial-redesign\`
`auditoria-ui-actual.md` · `state-machine-visual.md` · `plan-de-componentes.md` ·
`referencia-vs-taba2.md` · `riesgos.md` ·
`comparacion-antes-referencia-resultado.md` · `reporte-final.md` ·
`screenshots/` (36 PNG).

---

## Gates de aceptación

| Gate | Estado |
|---|---|
| Mapa protagonista | ✅ pantalla raíz |
| Estado inmediato | ✅ cápsula + encabezado + subtítulo |
| La Taba 2 único retiro | ✅ centralizado, fail-closed |
| Mendoza 827 consistente | ✅ cola, sheet, navegación, ayuda |
| Sin selector de negocio | ✅ probado |
| Sin coordenadas inventadas | ✅ probado, bloqueo declarado |
| Privacidad pre/post claim | ✅ una implementación, probada |
| Un CTA por estado | ✅ probado en toda la matriz |
| Bottom sheet contextual | ✅ |
| Drawer claro | ✅ |
| Modales claros | ✅ forma única |
| Cero datos falsos | ✅ probado |
| Cero overflow | ✅ 43 pruebas de layout |
| Accesibilidad | ✅ |
| Tests verdes | ✅ 202 Dart + 68 JVM |
| Git limpio | ✅ |
| Sin push / deploy | ✅ |
| App fuente intacta | ✅ |
| Smoke automation intacta | ✅ |
| APK target del smoke intacto | ✅ |

**No se declara:** listo para producción · validado físicamente · certificado en
staging · integrado al RC · smoke certificado.
