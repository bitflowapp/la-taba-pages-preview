# Plan de ejecución — certificación backend E2E en staging

Runner: `scripts/e2e-staging/backend-e2e-certification.mjs` (este repositorio, rama
`qa/taba-backend-e2e-cert-20260930`). Un solo proceso, una sola corrida, un único
`ORDER_ID` principal seguido por todas las capas.

## 0 · Antes de mutar (bloqueante)

1. Proyecto por Management API = `la-taba-staging` (`ucbtjcurawxjwjdvvcvj`).
2. Claves de la corrida aceptadas por ESE proyecto (Auth settings + Auth admin).
3. La web publicada `taba2-staging.pages.dev` apunta a ese Supabase, declara
   `deploymentEnvironment: staging`, negocio `a57b1c20-…`, y su clave publicable es una
   clave de ese proyecto.
4. Observador SQL = `supabase_read_only_user`.
5. Ledger de migraciones de staging = repositorio (157/157, mismos nombres).
6. Negocio QA: slug `la-taba-staging`, nombre «La Taba (STAGING)», abierto y verificado.

Refs prohibidos en duro: CP `tkanbadcglszlcyfjvpv`, producción vieja
`wwcpogltfgzgkrlilbcd`, demo, CAUCE y Bit Flow. Si falla un punto: no se escribe nada.

## 1 · Aislamiento

- Identificador: `TABA_E2E_CERT_<YYYYMMDDHHMMSS>` (UTC). Viaja en `customer_notes` de cada
  pedido, en `device_label` de cada sesión, en las claves de idempotencia, en el motivo de
  los movimientos de stock, en `origin_reason` y en el nombre/slug del negocio B.
- Producto: `STG-009` (fixture sintético del tenant de staging, no alcohólico, stock 40).
  No se crea un producto nuevo porque el contrato vigente no lo permite sin fabricar
  derechos de imagen aprobados (`import_catalog_batch`) y porque un fixture
  `test_only` haría nacer el pedido con `origin='qa'`, que la bandeja del Panel excluye
  por diseño — y la certificación exige ver el mismo pedido en el Panel. Las cinco
  condiciones para usar un producto de catálogo se demuestran en `final-report.md`.
- Identidades de la corrida (se borran al final): 3 clientes anónimos, 1 usuario
  registrado sin membresía, 1 dueño de un negocio B QA inactivo.
- Operadores: cuentas QA existentes del tenant de staging (owner, staff, admin, 2 riders),
  con sesión de identidad propia de la corrida que se cierra al final.
- `service_role`: sólo `auth.admin.createUser/deleteUser` e `insert/delete` del negocio B
  y su membresía. Ninguna aserción la usa. Cada uso queda en `created-resources.json`.

## 2 · Secuencia

| # | Fase | Qué se ejecuta |
|---|---|---|
| 3 | Pedido real | cliente anónimo A → `create_order_with_items` (delivery, efectivo, 3 × STG-009) |
| 4 | Base de datos | observador: `orders`, `order_items`, totales, instantánea de entrega, evento, token, stock |
| 5 | Panel | `fetchBusinessOrderSnapshot()` + `fetchOrderEvents()` del repositorio del Panel, sesión staff |
| 15a | Negativos de creación | cantidad 0/negativa/> stock, producto no disponible/inexistente, negocio inexistente/no habilitado, campo inyectado, delivery sin punto / bajo mínimo, sin sesión, clave reutilizada con otro payload / por otro cliente |
| 10 | Idempotencia | repetición del pedido original; 20 repeticiones simultáneas; carreras de 2, 5 y 20 creaciones simultáneas con la misma clave nueva |
| 11A | Respuesta perdida | creación con socket abortado, verificación en base, reintento exacto |
| 11C | Revisión vieja | `transition_order` con revisión atrasada; dos operadores aceptan a la vez |
| 6 | Estados | received → accepted → preparing (11B: timeout + reintento) → ready, con negativos de arista |
| 7 | Rider | disponibilidad + latido, oferta, tablero, accept, pickup (revisión vieja), en camino, GPS, llegó; rider equivocado |
| 9 | Código | emisión por el cliente, código incorrecto, rider equivocado, código correcto, repetición |
| — | Cobro | `confirm_manual_order_payment` (efectivo) y su repetición |
| 8 | Tracking | DTO en cada estado; token ajeno, token incorrecto, enumeración, sin token, escritura |
| 12 | RLS | sin sesión, autenticado sin membresía, otro cliente, dueño de otro negocio, rider equivocado, miembro sin sesión de identidad |
| 13 | Eventos | cadena exacta, orden, actores, marcas de tiempo, Panel vs base, superficies |
| 11C' | Carrera destructiva | aceptar vs cancelar un pedido propio de la corrida |
| 14 | Stock | después de entregar y después de limpiar; huella de catálogo antes/después |
| 16 | Limpieza | devolución del cobro, cancelación, devolución auditada de stock, `classify_order_as_qa`, disponibilidad en false, cierre de sesiones, borrado de usuarios y negocio B, verificación posterior |

## 3 · Criterio

Cada verificación es un `check` con resultado `PASS`/`FAIL` en `checks.json`. Una fase
aprueba sólo si aprueban TODOS sus checks. `BACKEND_E2E_CERTIFIED` exige todas las fases.

## 4 · Recuperación

`created-resources.json` se escribe antes de usar cada recurso. Si el proceso muere:
`node scripts/e2e-staging/backend-e2e-certification.mjs --reconcile <directorio>`.
