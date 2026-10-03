# Plan de promoción a CONTROLLED PRODUCTION

**Estado: escrito, no ejecutado.** Esta rama no aplica nada en CONTROLLED PRODUCTION (CP, proyecto `tkanbadcglszlcyfjvpv`). Ejecutar este plan es una decisión del dueño y se hace recién cuando la rama está integrada a la rama de release, con su CI en verde y la certificación de Staging en verde sobre el mismo commit.

Ningún paso enciende ventas ni cobros: el comercio real sigue cerrado hasta que el dueño cargue sus datos y la plataforma lo verifique, y el cobro real de Mercado Pago sigue cerrado.

**Cómo está cerrado el cobro real HOY (verificado en el código el 2026-10-03):** en producción una preferencia sólo se crea si están las tres cosas a la vez: `MERCADOPAGO_ENVIRONMENT=production`, `MERCADOPAGO_PRODUCTION_REVIEW_STATUS=approved` y el secreto `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` con su valor exacto (`requireRealPaymentSmokeAuthorization`, `supabase/functions/_shared/payment-runtime.ts`); además, el comercio necesita su vendedor conectado y su interruptor propio. En CP, leído en sólo lectura el 2026-10-03, el secreto smoke NO está: el cobro real falla cerrado. El interruptor permanente que decidió el dueño (EDGE-03, opción A: un secreto explícito propio del cobro real) **todavía no está implementado** en esta rama; hasta que lo esté, el secreto smoke es la única llave y no se carga sin una decisión del dueño.

Convenciones de los comandos:

- `<privado>` es una carpeta FUERA del repositorio (por ejemplo `~/.taba-backups/cp/<fecha>`). Ahí van backups, manifiestos y salidas; nada de eso se commitea.
- Las credenciales no se escriben en ningún comando: las herramientas las leen del Credential Manager de Windows o del CLI de Supabase.
- `npx supabase@2.101.0` es la misma versión del CLI que fija el CI.
- Cada paso tiene un criterio para seguir. Si no se cumple, se para y se va al paso 10.

## 0. Precondiciones

| Qué | Cómo se comprueba |
|---|---|
| La rama está integrada al commit que se va a promover | `git rev-parse HEAD` en el árbol de release |
| CI en verde sobre ese commit: base de datos, pgTAP, Node, Deno, Web, Windows, carreras e idempotencia, y el stack efímero de Supabase | `gh run list --branch <rama> --limit 5` (los dos workflows: «Validate release candidate» y «Ecommerce certification on an ephemeral Supabase stack») |
| Certificación de Staging en verde sobre el mismo commit | la evidencia `artifacts/taba-ecommerce-final-*/staging-certification.md` |
| Ventana sin pedidos abiertos en el comercio real | hoy está cerrado y sin productos publicados; confirmarlo con el paso 3 |
| El ledger de CP: le falta `20261001010000` además de las migraciones de esta rama | paso 3 |
| **Decisión del dueño sobre AUTHZ-04 aplicado** (`20261002050000`): al aplicarla, el empleado pierde cancelar y RECHAZAR pedidos en el acto, también en una caja de Caja Clara atendida por un empleado, mientras el Panel y la caja siguen mostrando los botones; el catálogo da permisos por rol y para toda la plataforma | confirmación escrita del dueño; en CP hoy sólo hay empleados en los comercios de QA (`preflight-2`, consulta `staff_losing_cancel_and_reject`) |
| Los scripts piloto que todavía cancelan como empleado (`deploy/run-commercial-pilot-e2e.mjs`, `e2e-staging/{cancel-rider-soak-qa,rider-canonical-qa,run-pilot-full-ui-signed,stock-concurrency-pilot}.mjs`) no se corren contra CP después de aplicar | revisión del operador |

## 1. Backup real

```bash
node scripts/controlled-production/restore-drill.mjs --target controlled-production \
  --pg-bin <carpeta con pg_dump, pg_restore, initdb y pg_ctl de PostgreSQL 17> \
  --pooler-host <host del pooler de CP> --out <privado>/restore-drill.json
```

Hace el backup bajo un único snapshot (pg_dump de los esquemas de la aplicación y de los usuarios de auth), escribe el manifiesto con hashes y la huella del esquema, y en el mismo paso lo restaura (paso 2).

Para seguir: el manifiesto existe en `<privado>` y lista los archivos con su sha256.

## 2. Ensayo de restauración

Lo hace el mismo comando del paso 1: restaura en un PostgreSQL 17 descartable y compara categoría por categoría (tablas, columnas, restricciones, índices, funciones, políticas RLS, triggers, permisos), el ledger de migraciones, las filas de cada tabla y sondas de RLS como `anon`.

Para seguir: 0 diferencias en `<privado>/restore-drill.json`.

## 3. Verificación previa (sólo lectura)

```bash
node scripts/release/run-readonly-checks.mjs --target controlled-production \
  --file docs/migrations/checks/20261001_ecommerce_hardening_preflight.sql \
  --out <privado>/preflight-cp-antes.json
node scripts/release/run-readonly-checks.mjs --target controlled-production \
  --file docs/migrations/checks/20261002_ecommerce_hardening_preflight.sql \
  --out <privado>/preflight-2-cp-antes.json
node scripts/release/ecommerce-release-gates.mjs --target controlled-production \
  --business-id <uuid del comercio real> --out <privado>/gates-cp-antes.json
```

Para seguir: ninguna consulta de las que esperan cero filas devuelve filas; las informativas se leen y se anotan los comercios alcanzados. El gate de release DEBE dar NOT_READY en este punto (faltan migraciones y funciones): sirve para tener el estado de partida.

## 4. Migraciones

En una carpeta de trabajo aislada que tenga sólo `supabase/config.toml` y `supabase/migrations/` del commit que se promueve:

```bash
npx supabase@2.101.0 link --project-ref tkanbadcglszlcyfjvpv
npx supabase@2.101.0 migration list --linked
npx supabase@2.101.0 db push --linked --dry-run
npx supabase@2.101.0 db push --linked
npx supabase@2.101.0 migration list --linked
```

Si CP tuviera una migración de otra línea con una versión menor que la última aplicada, `db push` la rechaza: se agrega `--include-all` sólo después de leer cuál es.

Para seguir: el ledger de CP es igual al del repo (misma cantidad, mismas versiones, mismo orden).

## 5. Edge Functions

Las nueve funciones de Mercado Pago, juntas (todas importan un módulo compartido que cambió) y DESPUÉS de las migraciones (`mercadopago-payment-worker` lee columnas que agrega `20261001204000`; `mercadopago-webhook` usa la operación que agrega `20261001230000`). Desde el árbol del commit que se promueve:

```bash
for f in mercadopago-webhook mercadopago-payment-worker mercadopago-checkout-status \
         mercadopago-create-checkout-session mercadopago-create-preference mercadopago-refund \
         mercadopago-cancel-payment mercadopago-connect mercadopago-oauth-callback; do
  npx supabase@2.101.0 functions deploy "$f" --project-ref tkanbadcglszlcyfjvpv || break
done
npx supabase@2.101.0 functions list --project-ref tkanbadcglszlcyfjvpv
```

`verify_jwt` sale de `supabase/config.toml`: `true` sólo en `mercadopago-refund` y `mercadopago-cancel-payment`.

Para seguir: cada función ACTIVE con la versión nueva; el hash del bundle de cada una igual al que quedó en Staging con el mismo commit; `verify_jwt` igual al de la configuración.

## 6. Secretos

```bash
npx supabase@2.101.0 secrets list --project-ref tkanbadcglszlcyfjvpv
```

Sólo nombres. Esta rama no agrega secretos obligatorios. Para seguir: `MERCADOPAGO_REAL_PAYMENT_SMOKE_CONFIRMATION` NO está. Hoy es la llave del cobro real (ver arriba): si aparece sin una decisión escrita del dueño, se para acá.

## 7. Salud

```bash
node scripts/controlled-production/ops-pulse.mjs --target controlled-production --business-id <uuid del comercio real> --hours 24
```

Y `public.get_ecommerce_health()` con la clave de servicio: base, auth, checkout, pedidos, cola de pagos, webhooks y tareas programadas.

Para seguir: ningún componente `down`; las nueve tareas programadas presentes y activas.

## 8. Prueba de humo

Sobre el comercio de QA de control de CP (`qa-control-cp`), nunca sobre el real:

```bash
node scripts/controlled-production/opening-orders-cert.mjs --out <privado>/opening-orders-cp.json
```

Para seguir: todas las verificaciones en PASS. El comercio de QA queda cerrado al terminar.

## 9. Gates de release

```bash
node scripts/release/run-readonly-checks.mjs --target controlled-production \
  --file docs/migrations/checks/20261001_ecommerce_hardening_preflight.sql \
  --out <privado>/preflight-cp-despues.json
node scripts/release/run-readonly-checks.mjs --target controlled-production \
  --file docs/migrations/checks/20261002_ecommerce_hardening_preflight.sql \
  --out <privado>/preflight-2-cp-despues.json
node scripts/release/ecommerce-release-gates.mjs --target controlled-production \
  --business-id <uuid del comercio real> --out <privado>/gates-cp-despues.json
```

Para seguir: los gates de software (migraciones, Edge Functions, P0/P1) en PASS. (El gate del interruptor de dinero real llega con EDGE-03 opción A, que todavía no está implementado.) Los comerciales (catálogo aprobado, precios, horarios, zonas, equipo, vendedor de Mercado Pago, certificación de pagos) siguen cerrados hasta que el dueño entregue sus datos: el gate dice NOT_READY por esos motivos y está bien que lo diga.

## 10. Si algo falla

1. **Edge Functions**: volver a desplegar la versión anterior de cada función desde el commit anterior (la versión y el hash de cada una quedan en la salida del paso 5 de la promoción anterior: hoy, en CP, todas las de Mercado Pago están en v6).
2. **Migraciones**: revertir en orden inverso con `docs/migrations/rollback/<versión>_<nombre>.rollback.sql`, una por una, con `psql` como `postgres`. Cada archivo dice qué no puede restaurar (las tablas con filas de auditoría se conservan sin permisos de cliente). El ensayo completo de la cadena (todas las reversiones de la rama en orden inverso) dio 0 diferencias contra el esquema anterior en `5b3491d` (31 reversiones); se repite sobre el commit que se promueve, porque la rama sumó migraciones después.
3. **Si el esquema no vuelve a la huella del paso 1**: restaurar el backup del paso 1 siguiendo el mismo procedimiento del ensayo del paso 2, sobre el proyecto.

Criterio de cierre: la huella del esquema igual a la del paso 1 y `ops-pulse` sin alertas nuevas.
