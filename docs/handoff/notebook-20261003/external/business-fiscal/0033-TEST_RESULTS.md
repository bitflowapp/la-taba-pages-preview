# Resultados finales de pruebas y gates

Fecha: 2026-08-02  
Worktree: `C:\1212\la-taba-business-intake-hardening`

## Resultados

| Comando/cobertura | Resultado |
|---|---|
| Guard del runner de staging | PASS — 4/4 |
| Unitarias e integración completas | PASS — 657/657 |
| E2E focal local repetido | PASS — 9/9 (`--repeat-each=3`) |
| Smoke Playwright con Supabase staging real | PASS — 1/1 |
| Login QA público y sesión | PASS — HTTP 200 / HTTP 200 |
| Membership autenticada | PASS — owner activa, HTTP 200 |

## Gates solicitados

| Gate | Resultado |
|---|---|
| `npm run check` | PASS |
| `npm test` | PASS — 657/657 |
| `npm run migrations:validate` | PASS — 20 migraciones; sólo avisos informativos del analizador estático |
| `npm run catalog:images:verify` | PASS — 22 productos y 44 WebP demo; lista comercial vacía permitida |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilidades |
| `git diff --check` | PASS |

## Cobertura de confiabilidad

- Snapshot antes y después de abrir Negocio.
- Ventana snapshot/suscripción.
- Realtime ausente y polling PostgreSQL.
- Offline/online, `pageshow`, foreground y recarga completa.
- Dos y tres pestañas, cierre de pestaña y una alerta global.
- Deduplicación de eventos/snapshots.
- Revisión antigua después de nueva.
- Payload parcial y snapshot incompleto fail-closed.
- Membership incorrecta, token expirado y filtro exacto por business.
- 50 pedidos consecutivos y doble confirmación del cliente.
- `submitted→accepted→preparing` sin retroceso.
- Cleanup terminal y restauración de stock.

## Incidencias de prueba corregidas

- El contador E2E multitab acumulativo se cambió a `baseline + 1` para eliminar una suposición flaky sobre qué pestaña emitía la primera alerta.
- El smoke real dejó de esperar una etiqueta visual “Aceptado”: producto agrupa `accepted` como “Preparando”. Ahora verifica `data-next-status`, estado PostgreSQL y revisión creciente.
- Playwright staging tiene trace desactivado y usa output temporal eliminado siempre para no persistir campos Auth.

## Evidencia

- `unit-full.log`
- `e2e-focal.log`
- `gates.log`
- `STAFF_LOGIN_VERIFICATION.md`
- `STAGING_SMOKE_FINAL.md`
- `CLEANUP_VERIFICATION.md`
- `staging-business-intake-result.json`
- `staging-business-intake-status.png`
- `staging-business-intake-synthetic-card.png`

