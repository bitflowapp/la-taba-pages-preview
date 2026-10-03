# Cuentas sintéticas de staging QA

Las contraseñas se omiten deliberadamente. No se guardan secretos en reportes,
Git, capturas ni logs.

| Actor | Identidad | UUID | Estado |
| --- | --- | --- | --- |
| Cliente QA 1 | sesión Auth anónima sintética | `4678936e-2a34-4df4-b5c5-c0458238062e` | pedido `LT-0001` entregado |
| Cliente QA 2 | sesión Auth anónima sintética | `31b32d6a-b677-4eb5-b765-20213dda8443` | pedido `LT-0002` en camino |
| Negocio | `qa-business-staging@local.taba` | `542f6931-2050-476c-9cb3-f7e8d0b78254` | owner activo |
| Rider | `qa-rider-staging@local.taba` | `d1c72b84-1ab5-4a0a-989f-80f6843b609f` | rider activo |

Las identidades son sintéticas y sólo existen para staging QA. El cliente
anónimo no tiene contraseña ni recuperación cross-device por diseño; su token
de tracking permanece en la sesión del navegador y no se publica aquí.
