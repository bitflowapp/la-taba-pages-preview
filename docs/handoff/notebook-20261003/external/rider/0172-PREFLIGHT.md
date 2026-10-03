# Preflight de staging

- Fecha de ejecución: 2026-08-02 (America/Argentina/Buenos_Aires).
- Proyecto identificado desde la sesión autenticada del CLI: `ukxqbgswjlibmnjemrzd`, nombre `la-taba-staging`, estado `ACTIVE_HEALTHY`.
- No se utilizó producción.
- Backend canónico: `feature/rider-delivery-server-contracts` en `4960da279f0f668559ab55b6a751576b18232b95`, limpio.
- Android canónico: `feature/rider-live-contract-integration` en `f1f3f37c5e2793c40f672fbc9b099eee6a746dba`, limpio.

## Baseline minimizado

Consultas de solo lectura, autenticadas como operador QA del negocio autorizado. No se conservaron IDs ni PII.

| Conjunto | Cantidad | Huella SHA-256 de IDs (prefijo) |
| --- | ---: | --- |
| Pedidos preexistentes | 1 | `E80749E58318E515` |
| Memberships preexistentes | 1 | `733D3A068418DB3A` |
| Productos preexistentes | 1 | `0DA08400FE044011` |

- Pedido sintético creado: no.
- Stock modificado: no.
- Ningún dato humano fue reutilizado.
