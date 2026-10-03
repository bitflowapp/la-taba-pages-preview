# Verificación de cleanup y aislamiento

Fecha: 2026-08-02

## Staging

| Control | Resultado |
|---|---|
| Pedidos del run final | PASS — 3/3 `cancelled` |
| Todos los sintéticos de la operación | PASS — 9/9 `cancelled`, 0 activos |
| Stock del producto | PASS — restaurado al baseline |
| Pedidos preexistentes | PASS — mismos IDs, status, revision y `updated_at` antes/después del run final |
| Memberships ajenas | Sin escrituras |
| Migraciones / `db push` | No ejecutados |

Los pedidos sintéticos se conservaron como registros terminales auditables según contrato; fueron retirados de la bandeja activa, no borrados físicamente.

## Secretos y temporales

| Control | Resultado |
|---|---|
| Directorios `taba-business-intake-staging-*` | 0 restantes |
| Trace, video o diagnóstico Playwright persistente | Ninguno |
| Variables `SUPABASE_STAFF_EMAIL`, `SUPABASE_STAFF_PASSWORD`, `TABA_SMOKE_CONFIRM` | Eliminadas del proceso operador |
| Coincidencias de la contraseña en artefactos/logs | 0 |
| Archivo privado | Conservado en `C:\1212\secrets\la-taba-staging-business-login.txt` |
| ACL del archivo privado | Owner actual, un ACE actual, sin herencia |

## Git

- Rama: `fix/business-order-intake-reliability`
- HEAD: `c6270589756214eac617515248e93a8e8819190b`
- Working tree: dirty esperado, 16 entradas; idéntico antes/después del smoke.
- Sin commit, push, merge, deploy, reset, restore, stash o clean.
- Worktree staging original `staging/real-orders-walter`: HEAD exacto preservado y sus nueve cambios Gate 2 preexistentes permanecen intactos.

