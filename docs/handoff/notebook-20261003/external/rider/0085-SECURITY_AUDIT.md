# Task 04 — auditoría de seguridad

## Controles revisados

| Control | Resultado | Evidencia |
|---|---|---|
| Sesión y `Authorization` | PASS | Sólo Kotlin obtiene `SessionManager.currentRequestContext()` |
| Refresh tras 401 | PASS | Un retry, mutex de sesión existente y sign-out si vuelve 401 |
| `service_role` | PASS | No aparece en el código Android ni en la prueba |
| RPC usado | PASS | Sólo `claim_available_rider_order` con cinco parámetros exactos |
| Escritura directa | PASS | No hay `PATCH/POST` de tabla ni inserción de eventos desde app |
| CAS server-side | PASS | `p_expected_revision` sale del snapshot y el RPC decide |
| Doble toque | PASS | Guard local por `public_code` más idempotencia server-side |
| Validación de respuesta | PASS | Objeto, estado asignado, delivery mode, ARS, dinero, revisión e items |
| Errores | PASS | Se exponen claves estables; no se propaga body, mensaje SQL ni causa |
| PII en disponibles | PASS | Sólo campos minimizados; sin UUID, email, dirección, teléfono o GPS |
| PII en claim | PASS | Snapshot asignado usa la proyección ya autorizada; IDs internos se ocultan |
| Logcat | PASS | El bridge no serializa tokens ni bodies crudos |
| Permisos nuevos | PASS | Task 04 no agrega ubicación, notificación ni foreground service |
| Producción | PASS | El flavor production sigue fail-closed y sin backend configurado |
| Histórico GPS | N/A | GPS y tracking están fuera de Task 04 |

## Clasificación de errores

- `40001` con el mensaje contractual de otro ganador:
  `orders_claim_taken_by_other`.
- `40001` por revisión/estado/rider esperado:
  `orders_revision_conflict`.
- 401: `session_expired`, con refresh único en Kotlin.
- JSON inválido, red o excepción inesperada: claves sanitizadas y reintentables
  sólo cuando el contrato lo permite.

## Límites explícitos

La anon/publishable key no autoriza por sí misma un claim: el RPC valida
`auth.uid()`, membresía activa, rol rider, business, modalidad, elegibilidad,
estado, revisión y asignación. La app no intenta sustituir esas validaciones.

La prueba de dos identidades reales aún requiere credenciales QA separadas;
no se considera válida una prueba con el mismo token ni una inspección por
`service_role`.
