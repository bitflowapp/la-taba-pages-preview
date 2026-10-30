# R-MKT-1: estado y pasos para cerrarlo (27/10/2026)

**Actualización 30/10:** [PREFLIGHT vigente](../mp-closure-20261030/PREFLIGHT.md). Sigue pendiente consentimiento B y APRO manual. El verificador ahora exige baseline **v2** anterior al checkout, delta exacto y evidencia positiva; las lecturas desconocidas fallan. No hace falta guardar el login del vendedor y no se solicita en este encargo.

Entorno: QA alojado `ixewllzzuzpqrkxzmfzx` (`environment: test`), integradora TestApp `4861627125869370`, dinero ficticio. Sin
producción, sin la cuenta de Walter, sin aplicaciones nuevas. Rama `fix/rmkt1-qa-tooling-20261027` apilada sobre #159 (sin merge).

**Estado: PREPARADO, NO EJECUTADO.** Los dos vendedores de prueba existen y son válidos; falta el consentimiento OAuth del
vendedor B y un pago APRO hecho por una persona. Mientras eso no ocurra, la integración multivendedor **no está certificada en QA**.

## 1. Quién es quién (verificado de sólo lectura el 27/10)

`node scripts/recovery/qa-mp-marketplace.mjs identities --seller 3796774164 --reserve 3796774158` → `all_pass: true`.

| Rol | Id | Qué se comprobó |
|---|---|---|
| Dueña de la integradora TestApp (`TestApp-ae01fd1d`) | `3594962708` | `/users/me` con el token de la aplicación y con el token directo del QA devuelve ese id, usuario de prueba MLA/AR |
| Vendedor A (comercio A de QA) | `3594962708` | Su conexión OAuth lee `/users/me` = `3594962708`: **A es también la dueña de la integradora** (por eso Mercado Pago marca sus preferencias `marketplace: NONE` y el `user_id` del aviso no distingue vendedor de dueña: R-MKT-1) |
| Comprador de prueba | `3594962710` | Cuenta distinta de A y de B |
| **Vendedor B (principal)** | `3796774164` | Existe, MLA, AR, activa; distinto de la dueña, de A y del comprador |
| Vendedor B (reserva) | `3796774158` | Ídem; distinto de los demás |

Lo que la API pública **no** puede probar: que B sea una cuenta de prueba (las etiquetas `test_user` sólo se ven en la propia
cuenta). El consentimiento OAuth y la tarjeta APRO sólo funcionan con cuentas de prueba, así que se confirma en esos pasos.

**Regla que no se puede deshacer:** un comercio de QA queda atado al primer vendedor que lo conecta (`seller_change_requires_migration`).
El comercio B sólo debe conectarse con **`3796774164`**. La reserva existe por si esa cuenta resultara inutilizable *antes* del primer
consentimiento; después de conectar, cambiarla exigiría otro comercio.

## 2. Qué quedó corregido o agregado en esta rama

| Qué | Por qué |
|---|---|
| `scripts/recovery/entrada-oculta.mjs` + `guardar-vendedor-b.mjs` + `tests/recovery-guardar-vendedor-b.test.mjs` (16 pruebas) | El guardado de credenciales fallaba en el *nickname* con «formato inesperado». Causa: el lector tomaba cada byte como texto; un id pegado trae CR+LF y el LF se entregaba a la pregunta siguiente como un Enter, dejando el usuario vacío (además Ctrl+V, flechas y marcas de pegado entraban como texto). Ahora: CR+LF es un solo Enter, un Enter sobre una respuesta vacía se ignora, Ctrl+V lee el portapapeles, el rechazo explica la causa **sin repetir el valor**, tras guardar se relee y compara (si no coincide se borra y se informa «NO SE GUARDÓ»). La mutación que vuelve al comportamiento original hace fallar 2 pruebas. |
| `qa-mp-marketplace.mjs identities` | Verifica la tabla de arriba sin imprimir tokens ni claves |
| `qa-mp-e2e.mjs replay-webhook` | Reenvío **firmado** (con el secreto de webhook de la TestApp) del aviso de un pago real de QA: mismo aviso repetido → `duplicate: true`; aviso nuevo; con pista `user_id` elegida. Comprueba que no se crea pedido y que el recibo se rutea a un solo comercio. Ensayado sobre el pago `185029125913` de A: 201/201/201, 2.º = duplicado, pedidos de A y B sin cambios (10 y 0) |
| `verify-tenant-isolation.mjs` | Esperaba `=== 3` productos de A y A tiene 4 (se agregó el producto real): reportaba una fuga que no existía. Ahora compara con el conteo real; 28/28 con sesiones reales (dueño A, dueño B, comprador, anónimo) |

## 3. Hallazgos para tener presentes (no son defectos de La Taba)

* **El comercio B no tiene fila de cobros hasta que consienta.** `activation --tenant b` muestra `settings_present: false` y eso es lo esperado: al terminar
  el OAuth, `mp_finish_oauth` crea la fila con `enabled = true` (entorno de prueba), `reserve_stock = true`, vencimiento 15 min y `manual_review`. No hay que configurar nada más.
* **R-MKT-3 con la dueña como vendedor A.** `verify` exige que el token de A no pueda leer el pago de B (404/403). Como A es también la dueña de la integradora, Mercado Pago podría dejarle
  leer pagos hechos *a través de su aplicación*. Si `seller_a_cannot_read_it` fallara con http 200, no es una fuga de La Taba: mirar `payment.marketplace_owner` y anotarlo. En producción, integradora y vendedor son cuentas distintas.
* **Los permisos declarados de la TestApp** (`GET /applications/4861627125869370`) incluyen `payments:refunds/read-only` y `payments:cancel/read-only`. Es una pista (no una conclusión) sobre el 401 del reembolso por API en QA; hay que
  mirar los permisos de la aplicación **productiva** cuando su dueño la habilite (`PROVEEDOR-REGLAS.md` §8).
* La evidencia hospedada previa de «importes manipulados» (`docs/audit/codex-payment-20261026/evidence/qa-adversarial.json`) devuelve `CHECKOUT_NOT_AVAILABLE` para todos los casos con el comercio cerrado, así que por sí sola no distingue el motivo. Lo que sí lo prueba es el banco de CI (`tampering`: con el comercio abierto, `total` y `unit_price` inyectados → 409; sesión anónima → 401).

## 4. Qué falta y quién lo hace

| # | Paso | Quién | Comando |
|---|---|---|---|
| H0 (opcional) | Guardar el login de B/reserva en el Credential Manager. **No hace falta para R-MKT-1**: el consentimiento lo hace la persona escribiendo la contraseña en la página de Mercado Pago | Marco, en su PowerShell | `node scripts/recovery/guardar-vendedor-b.mjs --id 3796774164` (primero con `--ensayo`; la reserva con `--reserva --id 3796774158`) |
| H1 | Consentimiento OAuth de B, en una ventana privada, con el login de **3796774164** | Marco | enlace de `connect-url --tenant b` (vale 10 min; generarlo en el momento) |
| H2 | Pago APRO de ARS 100 con el comprador de prueba, en un navegador normal (Checkout Pro rechaza navegadores automatizados) | Marco | enlace `init_point` de `checkout` (vale 15 min) |
| H3 (opcional) | «Devolver dinero» desde la actividad de B | Marco | luego `worker` y `inspect` |

## 5. Secuencia completa (PowerShell, desde la carpeta de esta rama: los comandos nuevos sólo existen en ella)

```powershell
$env:TMP='<carpeta temporal en D:>'; $env:TEMP=$env:TMP; cd <carpeta de esta rama>
$ev = '<carpeta de evidencia FUERA del repositorio público>'

# 0. Reservar QA (archivo de coordinación, fuera del repositorio) y comprobar quién es quién
node scripts/recovery/qa-mp-marketplace.mjs identities --seller 3796774164 --reserve 3796774158   # all_pass: true
node scripts/recovery/qa-mp-marketplace.mjs preflight --seller 3796774164                         # blockers: []
node scripts/recovery/qa-mp-marketplace.mjs snapshot --out "$ev\baseline-$(Get-Date -Format HHmm).json"   # línea base de A y B

# 1. H1: Marco abre el enlace en ventana privada y consiente como 3796774164
node scripts/recovery/qa-mp-e2e.mjs connect-url --tenant b
node scripts/recovery/qa-mp-e2e.mjs status --tenant b       # connection.status = connected, seller_id = 3796774164
node scripts/recovery/qa-mp-e2e.mjs verify --tenant b       # integrator_environment_matches: true

# 2. Abrir B sólo para la prueba y armar el pago APRO
node scripts/recovery/qa-mp-e2e.mjs window-open --tenant b --minutes 30
node scripts/recovery/qa-mp-e2e.mjs checkout --tenant b --sku QA-MKT-001 --scenario APRO --evidence "$ev\checkout-b.jsonl"
#    -> H2: Marco paga el init_point (15 min) con la tarjeta APRO oficial

# 3. Procesar y mirar
node scripts/recovery/qa-mp-e2e.mjs worker ; node scripts/recovery/qa-mp-e2e.mjs worker
node scripts/recovery/qa-mp-e2e.mjs inspect --tenant b --session <checkout_session_id>

# 4. Idempotencia y enrutamiento con avisos firmados (cuatro pistas distintas), luego procesar otra vez
node scripts/recovery/qa-mp-e2e.mjs replay-webhook --payment <id_pago> --user-id 3594962708    # la dueña de la integradora (también vendedor A)
node scripts/recovery/qa-mp-e2e.mjs replay-webhook --payment <id_pago> --user-id 3796774164    # la pista correcta
node scripts/recovery/qa-mp-e2e.mjs replay-webhook --payment <id_pago> --user-id 1             # una cuenta desconocida
node scripts/recovery/qa-mp-e2e.mjs replay-webhook --payment <id_pago>                          # sin pista
node scripts/recovery/qa-mp-e2e.mjs worker ; node scripts/recovery/qa-mp-e2e.mjs worker

# 5. Veredicto
node scripts/recovery/qa-mp-marketplace.mjs verify --session <checkout_session_id> --seller 3796774164 --baseline "$ev\baseline-<HHmm>.json" > "$ev\rmkt1-verify.json"

# 6. Cerrar: ventana, coordinación (CLOSED) y, si se hizo H3, conciliar la devolución externa
node scripts/recovery/qa-mp-e2e.mjs window-close --tenant b
```

`verify` aprueba si todos son verdaderos: `preference_is_marketplace`, `preference_client_is_testapp`, `preference_collector_is_seller_b`,
`payment_collector_is_seller_b`, `payment_approved`, `webhook_valid_and_routed_to_b` (**R-MKT-1**), `seller_a_cannot_search_it`, `seller_a_cannot_read_it` (ver §3),
`order_in_b_only`, `tenant_a_unchanged`, `tenant_b_one_order`, `tenant_b_one_intent`, `tenant_b_stock_down_by_purchase`.

**Se aborta y se informa, sin reintentar a ciegas, si:** el consentimiento devuelve `integrator_account` o `seller_in_use`; Mercado Pago responde 2034 (se mezcló una cuenta real);
el webhook responde 503 (el barrido de verdad del proveedor igual crea el pedido, pero R-MKT-1 queda **no cerrada**); o el pago queda `in_process` (no se da por rechazado: se espera al proveedor).

## 6. Qué cuenta como certificado

«CERTIFICADA EN QA» sólo si `verify` da `all_pass: true` **y** las cuatro pasadas de `replay-webhook` no crean pedidos ni enrutan a otro comercio **y** `tenant_a_unchanged`. Eso no autoriza
producción ni certifica devoluciones reales.
