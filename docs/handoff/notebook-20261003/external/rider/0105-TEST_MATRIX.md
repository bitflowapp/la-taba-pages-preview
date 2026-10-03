# Matriz de pruebas Gate 0 → implementación

## Convenciones

- Unit: Dart/Kotlin sin dispositivo ni red.
- Integration: Flutter con bridge fake y backend contract fixtures.
- Instrumented: Android emulator/device con lifecycle real.
- Physical: Moto G15 y una red staging controlada.
- Las pruebas de backend existentes permanecen en el backend; la app no las reemplaza.

| ID | Nivel | Escenario | Resultado esperado |
|---|---|---|---|
| AUTH-01 | Unit | email/password vacío | No sale request; error de validación. |
| AUTH-02 | Integration | login válido + rider activo | Sesión lista; tokens no cruzan a Dart. |
| AUTH-03 | Integration | 401/429 | Mensaje sanitizado; no se persiste contraseña. |
| AUTH-04 | Unit | rol owner/staff/inactivo | Acceso rider denegado. |
| AUTH-05 | Instrumented | dos refresh simultáneos | Un solo refresh; pareja de tokens consistente. |
| AUTH-06 | Integration | refresh rotado | Service y Flutter reciben `session_changed`. |
| AUTH-07 | Instrumented | logout | Se detiene service antes de borrar token. |
| ORDER-01 | Unit | lista RPC con `revision` bigint/string | DTO conserva integer positivo. |
| ORDER-02 | Integration | cola disponible | Muestra sólo campos de la RPC, sin UUID/address exacta. |
| ORDER-03 | Integration | claim exitoso | Guarda payload, assignee, `revision` nueva y `idempotent_no_op=false`. |
| ORDER-04 | Integration | doble claim mismo rider | Segundo éxito no-op, un evento. |
| ORDER-05 | Integration | dos riders mismo pedido | Sólo uno gana; otro recibe `40001`. |
| ORDER-06 | Integration | revisión vieja | Se descarta snapshot y se fuerza refresh. |
| ORDER-07 | Integration | pedido pickup | Claim rechazado; no se permite GPS. |
| DELIVERY-01 | Integration | start desde assigned | `on_the_way`, service armado y activo. |
| DELIVERY-02 | Integration | start repetido | Éxito idempotente, sin segundo evento. |
| DELIVERY-03 | Integration | start no asignado | `42501`, service no captura. |
| DELIVERY-04 | Integration | estado inválido | `40001`, UI conserva estado remoto. |
| GPS-01 | Unit | lat/lng NaN, Infinity o fuera de rango | Se descarta sin request. |
| GPS-02 | Unit | accuracy 251 / heading 360 / speed 71 | Se descarta sin request. |
| GPS-03 | Unit | `captured_at` futuro o >3 min viejo | Se descarta/encola sólo si sigue dentro de TTL. |
| GPS-04 | Integration | publicación correcta | RPC exacta con revision/captured_at; usa respuesta server. |
| GPS-05 | Integration | `P0001` demasiado pronto | Reintenta con backoff; no marca terminal. |
| GPS-06 | Integration | `40001` revision | Detiene drain, refresh, no reescribe muestra silenciosamente. |
| GPS-07 | Integration | otro rider | Stop de publicación; error sanitizado. |
| GPS-08 | Integration | `arrived` | Sigue permitido por Gate 2 hasta confirmación. |
| GPS-09 | Integration | delivered/canceled/rejected | Stop inmediato y purge. |
| GPS-10 | Unit | response sin sequence/recorded_at | No se presenta como publicado; error de contrato. |
| QUEUE-01 | Unit | enqueue offline | Registro cifrado con TTL y revisión. |
| QUEUE-02 | Instrumented | process kill/recreate | Cola persiste y no expone texto plano. |
| QUEUE-03 | Unit | TTL vencido | Drop con `stale_expired`; jamás se envía. |
| QUEUE-04 | Unit | límite máximo | Drop oldest según política aprobada; métrica sin coordenada. |
| QUEUE-05 | Integration | online | Drena FIFO cada >=5 s. |
| QUEUE-06 | Integration | terminal durante drain | Cancela requests y purga. |
| SERVICE-01 | Instrumented | `startForeground` | Notificación visible dentro del deadline Android. |
| SERVICE-02 | Instrumented | pantalla apagada | Location callback sigue mientras OS lo permita. |
| SERVICE-03 | Instrumented | swipe recientes | Service sigue; Flutter recovery funciona. |
| SERVICE-04 | Instrumented | permiso denegado/revocado | Estado degradado visible; no request GPS. |
| SERVICE-05 | Instrumented | notification denied | Política aprobada: no iniciar si Android exige notificación visible. |
| SERVICE-06 | Physical | ahorro de batería OEM | Resultado se documenta, no se promete universalidad. |
| MAP-01 | Unit | age 5 s | `fresh`, marcador actual. |
| MAP-02 | Unit | age 25 s | `delayed`, último marcador, sin live. |
| MAP-03 | Unit | age 60 s | `lost`, sin movimiento/ETA inventados. |
| MAP-04 | Unit | sin fix/sequence viejo | `none` o conserva sólo el último válido. |
| MAP-05 | Instrumented | rotación/background | MapLibre no duplica instancia ni listeners. |
| REC-01 | Integration | Flutter process death | Service devuelve snapshot y Dart reconcilia. |
| REC-02 | Instrumented | service recreate activo | Refresh Auth + order; reanuda sólo si asignado. |
| REC-03 | Integration | pedido terminal al reabrir | Stop, notification cancel y purge. |
| REC-04 | Physical | reboot device | Resultado best-effort documentado por OEM. |
| REC-05 | Physical | Force stop | No se promete restart; recovery al abrir manualmente. |
| SEC-01 | Unit | logger con token/coords/address | Sanitiza todos. |
| SEC-02 | Instrumented | APK config production | No endpoint staging ni service_role. |
| SEC-03 | Integration | DTO público | No history, no internal rider UUID. |
| SEC-04 | Integration | terminal | No ubicación exacta después del stop. |

## Pruebas de contrato contra staging

Se ejecutan sólo con cuentas y pedidos QA aprobados:

1. `list_available_rider_orders` devuelve `revision`.
2. Claim concurrente con dos riders produce un único ganador.
3. Start usa `start_rider_delivery` y no `change_order_status` directo.
4. Publish exige revisión y devuelve `sequence`/`recorded_at`.
5. GPS demasiado rápido, viejo, futuro, impreciso y de otro rider es rechazado.
6. `get_public_order_tracking` devuelve un único fix redondeado o null, nunca historial.
7. Confirmación de código detiene el servicio y el tracking ya no expone ubicación exacta.

## Evidencia mínima física

Guardar fuera de Git: device model/OS, app version, hora redondeada, estado, edad del último fix, resultado HTTP categorizado y screenshot sin PII. Nunca guardar lat/lng, token, JWT, dirección, teléfono, email o código de entrega.

