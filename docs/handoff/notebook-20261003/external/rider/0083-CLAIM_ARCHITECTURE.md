# La Taba Rider Android — Task 04: claim atómico

## Estado

Implementación local lista para revisión. El claim se ejecuta exclusivamente
por el RPC Gate 2 real de Supabase; no hay escritura directa a `orders`,
`business_members` ni a eventos desde Android.

La carrera remota con dos sesiones independientes queda pendiente de un
segundo login QA autorizado. La razón y el protocolo reproducible están en
`CONCURRENCY_TEST.md`.

## Contrato utilizado

```text
claim_available_rider_order(
  p_business_id uuid,
  p_public_code text,
  p_expected_revision bigint,
  p_expected_status text default 'ready',
  p_expected_rider_user_id uuid default null
) returns jsonb
```

La app envía siempre los cinco parámetros. El estado esperado es `ready` y el
rider esperado es `null`. La respuesta es un objeto JSONB con el snapshot
asignado y `idempotent_no_op`.

## Flujo de extremo a extremo

```text
Flutter botón
  -> OrdersController
  -> ClaimOrderUseCase
  -> OrdersRepository
  -> Kotlin MethodChannel
  -> MainActivity / executor
  -> SessionManager + token vigente
  -> SupabaseHttpClient POST /rest/v1/rpc/claim_available_rider_order
  -> BackendDtos.parseClaimResult
  -> BridgeResult sanitizado
  -> snapshot AssignedOrder en Flutter
```

Kotlin conserva la autoridad de sesión, `Authorization`, refresh único,
transporte HTTP, parámetros RPC y traducción de errores. Dart conserva la
interacción, loading, accesibilidad, resultado y navegación.

## CAS, idempotencia y carreras

1. El controlador comprueba que el código siga en la cola y que la revisión de
   la tarjeta coincida con la revisión actual.
2. Un `Set` local bloquea doble toque/concurrencia del mismo código mientras el
   RPC está en vuelo.
3. El servidor vuelve a comprobar membresía, elegibilidad, estado, rider y
   revisión dentro de la transacción y del lock de la fila.
4. El éxito usa el snapshot devuelto por el servidor; no hay mutación
   optimista. La fila desaparece de disponibles y el snapshot pasa a
   asignado sólo después de recibir la respuesta.
5. Un retry del mismo rider puede devolver `idempotent_no_op=true` y se trata
   como éxito, sin crear una segunda asignación.
6. El perdedor de la carrera se traduce a `orders_claim_taken_by_other`; se
   refrescan disponibles/asignado y no se muestra SQLSTATE ni texto crudo.
7. Una revisión vieja se traduce a `orders_revision_conflict`; se refresca y
   se exige un nuevo toque con la revisión visible actualizada.

## Archivos implementados

- Kotlin: `BackendContract`, `BackendDtos`, `BackendError`,
  `RiderRpcDataSource`, `BridgeCodec`, `RiderMethodChannel` y `MainActivity`.
- Dart: `ClaimResult`, DTO/repositorio, `ClaimOrderUseCase`,
  `OrdersController`, `OrderDetailPage` y el callback desde `OrdersPage`.
- Pruebas: parser/errores/HTTP 401/argumentos exactos en Kotlin; DTO,
  repositorio, controller, doble toque, carrera perdida, errores sanitizados,
  UI y MethodChannel en Dart.

## Fuera de alcance de Task 04

No se implementaron inicio de entrega, GPS, permisos, ForegroundService,
mapa, cola offline, código de entrega ni cambios en backend/web/main/
producción.
