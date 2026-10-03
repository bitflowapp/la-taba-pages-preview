> ## ⬆ ESTADO ACTUAL (2026-08-06): BRECHA-01 RESUELTA
>
> El diagnóstico de abajo (resultado B) sigue siendo correcto y se conserva como registro de lo
> que se observó el 2026-08-05. Pero ya **no** es el estado final: se implementó el fixture de
> clúster propuesto en la sección "Propuesta", sin modificar la migración histórica.
>
> `scripts/run-mercadopago-local-db.mjs` ahora apunta `cron.database_name` del contenedor local a
> la base efímera y lo restaura al terminar (editando `/etc/postgresql-custom/conf.d/pg_cron.conf`
> como root, porque el rol `postgres` de Supabase no es superusuario y `ALTER SYSTEM` da
> `permission denied`). También se agregó `create schema if not exists vault;` al bootstrap de
> plataforma y se excluyó el esquema `cron` del restore drill.
>
> **Resultado medido**: `20260803120000` se aplica tal como está escrita, la suite de contrato de
> Mercado Pago corre, y las cuatro suites pgTAP emiten planes completos —`1..30`, `1..41`,
> `1..32`, `1..28`— con **131 `ok` y 0 `not ok`**.
>
> La propuesta alternativa de condicionar `cron.schedule` dentro de la migración **no se aplicó**:
> el fixture de clúster resolvió el problema sin tocar SQL desplegable.

---

# BRECHA-01 — Reproducción del gate local de base de datos

**Fecha**: 2026-08-05
**Agente**: TABA2_E2E_TEST_STAGING
**Objetivo**: reejecutar el gate local de DB de Mercado Pago con el runner canónico y registrar la salida real.

---

## 1. Comando exacto

**Entrypoint canónico** (`package.json:11`):
```json
"test:payments:local-db": "node scripts/run-mercadopago-local-db.mjs"
```

Invocación:
```
npm run test:payments:local-db
```

**Guarda obligatoria del runner** (`scripts/run-mercadopago-local-db.mjs:9-12`):
```js
if (process.env.TABA_LOCAL_PAYMENT_DB !== '1') {
  console.error('Refusing to run database tests without TABA_LOCAL_PAYMENT_DB=1. This suite is local-only.');
  process.exit(2);
}
```
Sin esa variable el runner sale con **exit 2** sin ejecutar nada. No es una desviación del entrypoint: es su precondición declarada.

## 2. HEAD

```
PRODUCT_E2E_HEAD = a0189bf85ae3cae68503408473c6c5fffe86f8e5
WORKTREE         = D:\1212\la-taba-e2e-test-staging-rc
RAMA             = release/taba2-e2e-test-staging-rc
git status       = limpio (0 líneas)
```

Lock adquirido antes de ejecutar (`mkdir` atómico sobre `D:\1212\_claude-locks\heavy-compute.lock`):
```
OWNER=TABA2_E2E_TEST_STAGING
PID=26480
HEAD=a0189bf85ae3cae68503408473c6c5fffe86f8e5
PURPOSE=BRECHA01_LOCAL_DB_GATE_REPRODUCTION
ACQUIRED=2026-08-05T23:27:46-03:00
```

## 3. Bootstrap

Estado inicial observado:
- Docker Server **29.6.2**, operativo.
- **Ningún contenedor Supabase activo.** Los 11 existentes pertenecían al proyecto `la-taba-pages` y estaban todos `Exited` (~11 h).
- El runner espera por defecto el contenedor `supabase_db_la-taba-real-orders-staging` (`scripts/run-mercadopago-local-db.mjs:15`), que se deriva de `project_id = "la-taba-real-orders-staging"` (`supabase/config.toml:5`).

Se levantó la pila desde el worktree del RC para que el nombre de contenedor coincidiera con el default, evitando cualquier override de `TABA_SUPABASE_DB_CONTAINER`:
```
cd D:\1212\la-taba-e2e-test-staging-rc
supabase start        # CLI 2.110.0 (C:\1212\scripts\supabase.exe)
```

Recursos previos: C: 13.7 GB libres · D: 68.1 GB · E: 2.1 GB · RAM libre 5.8 GB · imágenes Docker 13.86 GB.

## 4. Secuencia real del runner (leída del código, no inferida)

| Paso | Línea | Acción |
|---|---|---|
| 1 | 93-94 | `dropdb --if-exists` + `createdb` de `taba2_mp_verify_<pid>` |
| 2 | 95-100 | `pg_dump --schema=auth --schema=storage` desde `postgres` → aplicado a la base efímera |
| 3 | 101-104 | `create schema extensions` + `pgcrypto` |
| 4 | **105** | **bucle: aplica las 38 migraciones en orden alfabético** |
| 5 | **106** | suite `mercadopago_checkout_pro.local.sql` |
| 6 | **107** | pgTAP `business_windows_scanner_fiscal_test.sql` |
| 7 | **108** | pgTAP `fiscal_document_closure_test.sql` |
| 8 | **109** | pgTAP `production_operations_control_plane_test.sql` |
| 9 | **110** | pgTAP `durable_offline_packing_test.sql` |
| 10 | 111-146 | restore drill (`pg_dump --format=custom` → `pg_restore --exit-on-error`) |
| 11 | 148-156 | `finally`: `dropdb --if-exists` de ambas bases temporales |

Todo `psql` corre con `-v ON_ERROR_STOP=1` (L34). `execFileSync` lanza excepción ante exit ≠ 0, por lo que **un fallo en el paso 4 aborta antes de cualquier suite**.

Validación pgTAP (L58-65): exige que la salida **no** contenga `^not ok` **y** que contenga un plan `^1\.\.[0-9]+$`. Un archivo sin plan TAP se considera fallo.

---

## Resultado

# B. LOCAL_SCHEDULER_MIGRATION_BLOCKED

La migración `20260803120000_mercadopago_staging_worker_scheduler.sql` **no puede ejecutarse en la base aislada** y el runner aborta **antes de toda suite**.

---

## 5. ¿Se aplica `20260803120000` localmente? — **NO**

Falla en su **línea 6**, la primera sentencia del archivo:
```sql
create extension if not exists pg_cron with schema pg_catalog;
```

**Error literal emitido por PostgreSQL** (stdout/stderr del runner, líneas 203-206):
```
ERROR:  can only create extension in database postgres
DETAIL:  Jobs must be scheduled from the database configured in cron.database_name,
         since the pg_cron background worker reads job descriptions from this database.
HINT:   Add cron.database_name = 'taba2_mp_verify_11128' in postgresql.conf to use the current database.
CONTEXT: PL/pgSQL function inline_code_block line 4 at RAISE
```

**Causa raíz confirmada empíricamente contra el clúster local**:
```
show cron.database_name;                                   ->  postgres
select extname from pg_extension where extname in (...);   ->  pg_net, pg_cron   (en la base 'postgres')
```
pg_cron está instalado y operativo **en `postgres`**. La base efímera del runner es `taba2_mp_verify_11128`. `IF NOT EXISTS` no ayuda: la extensión no existe *en esa base* y crearla ahí está prohibido por diseño de pg_cron (lanzador de base única).

**Posición en el bucle**: archivo **35 de 38** en orden alfabético.
- Migraciones 1-34: **aplicadas con éxito**.
- Migración 35: **ERROR** → aborta.
- Migraciones 36, 37, 38 (`payment_recovery_p0`, `business_operations_panel`, `fiscal_homologation_authorization_split`): **nunca aplicadas**.

## 6. Suite `mercadopago_checkout_pro.local.sql` — **NOT_RUN**

Se invoca en `run-mercadopago-local-db.mjs:106`. El runner murió en **L105**. La suite **no llegó a ejecutarse**. No hay salida que reportar.

## 7. Sus 21 comprobaciones — **NOT_RUN (0 ejecutadas)**

Las 21 aserciones (`raise exception`) fueron enumeradas por **lectura estática del archivo**, no por ejecución. No se reporta ninguna como pasada ni fallada. Cubren: RLS de `payment_intents`, mínimo privilegio de `create_checkout_session`, reserva de stock exactamente una vez, doble-tap idempotente, rechazo de total provisto por el cliente, snapshot de preferencia, finalización idempotente sin segundo pedido, liberación de reserva idempotente, webhook encolado/deduplicado y **firma inválida que no encola**.

## 8. Cuatro suites pgTAP — **NOT_RUN (0 de 4)**

Invocadas en L107-110, todas posteriores a L106. Ninguna se ejecutó:
`business_windows_scanner_fiscal_test.sql` · `fiscal_document_closure_test.sql` · `production_operations_control_plane_test.sql` · `durable_offline_packing_test.sql`

## 9. Planes completos — **NINGUNO EMITIDO**

Los `plan(N)` declarados en el código fuente son 30, 28, 41 y 32 (suma 131). **Ninguno se emitió como salida TAP en esta corrida.** El número 131 es una **suma de declaraciones leídas del fuente, no un resultado observado**.

> **Esto cierra BRECHA-01**: el registro previo de "131 aserciones PASS (4/5 suites, la 5ª SKIP)" **no pudo ser producido por este runner**. Queda formalmente retractado.

## 10. Exit code real

```
EXIT_CODE_REAL = 1
```
(`psql` devolvió `status: 3`; `execFileSync` lanzó y Node terminó en 1.)

Traza literal, que confirma el punto exacto de aborto:
```
at docker (.../run-mercadopago-local-db.mjs:25:10)
at psql  (.../run-mercadopago-local-db.mjs:34:3)
at       (.../run-mercadopago-local-db.mjs:105:39)   <-- bucle de migraciones
```

**No hubo SKIP.** El runner no tiene mecanismo de SKIP: aborta. Cualquier "SKIP" en registros anteriores fue una interpretación humana, no una salida del runner.

## 11. stdout / stderr

Transcripción completa en `E:\DevCache\Temp\claude\...\tasks\bvl8m0d33.output` (235 líneas). Composición:
- L8-202: `NOTICE` de idempotencia de las 34 migraciones aplicadas (`does not exist, skipping`, `already exists, skipping`) — ruido normal, ningún error.
- L203-206: el `ERROR` de pg_cron transcrito arriba.
- L207: `NOTICE: database "taba2_mp_verify_11128_restore" does not exist, skipping` — bloque `finally` ejecutándose.
- L208-231: excepción de Node con la traza.
- L232-234: marcas de fin, exit code y duración.

## 12. Residuos — **NINGUNO**

```sql
select datname from pg_database where datname like 'taba2_mp_verify%';
```
→ **conjunto vacío**. Ninguna base temporal sobrevivió.

Alcance de escritura: el runner opera **exclusivamente** sobre su base efímera. No tocó `postgres` ni ninguna base de negocio. Sin datos humanos involucrados, sin relación con LT-0030.

## 13. Cleanup — **CORRECTO**

El bloque `finally` (L148-156) ejecutó `dropdb --if-exists` sobre `taba2_mp_verify_11128` y `taba2_mp_verify_11128_restore` pese al fallo. Confirmado por el `NOTICE` de L207 y por la verificación de residuos. **El manejo de errores del runner es sano**: falla ruidosamente y limpia igual.

## 14. Duración

```
INICIO   2026-08-05T23:30:09.274-03:00
FIN      2026-08-05T23:30:16.253-03:00
DURACION 7 segundos
```

---

## Propuesta: runner local reproducible sin debilitar producción

**Diagnóstico**: la migración mezcla dos responsabilidades — el **contrato de Mercado Pago** (funciones, trigger, grants: portable a cualquier base) y el **registro del scheduler hosted** (`create extension pg_cron` + `cron.schedule`: estructuralmente atado a `cron.database_name`). Esa mezcla es la que rompe el gate.

**Opción descartada — saltear la migración en modo aislado**: dejaría la base local sin `dispatch_payment_outbox_worker`, `kick_payment_outbox_worker`, el trigger y los grants. **Debilita** el contrato local en vez de separarlo.

**Opción recomendada — guardar sólo la parte atada al clúster, dentro del mismo archivo**:

```sql
-- Portable: se crea en cualquier base
create extension if not exists pg_net    with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- ... funciones, trigger y grants: SIN CAMBIOS, se crean siempre ...

-- Sólo el registro del job queda condicionado a la base que pg_cron vigila
do $$
declare
  v_cron_db text := current_setting('cron.database_name', true);
begin
  if v_cron_db is null then
    raise notice 'pg_cron ausente en este cluster: scheduler omitido (base aislada)';
  elsif current_database() <> v_cron_db then
    raise notice 'base % no es la base de cron (%): scheduler omitido', current_database(), v_cron_db;
  else
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule(
      'taba-payment-outbox-worker',
      '30 seconds',
      'select public.dispatch_payment_outbox_worker(''cron'');'
    );
  end if;
end $$;
```

**Por qué no debilita producción**:
- En staging/hosted la migración corre contra `postgres`, y `cron.database_name = 'postgres'` → se toma la rama `else` y el comportamiento es **byte-idéntico al actual**. No se pierde ni una garantía.
- La rama de omisión sólo puede tomarse en una base que, por diseño de pg_cron, **es incapaz** de alojar el job. Omitir ahí no oculta nada: expresa un hecho estructural.
- **`HOSTED_PG_CRON_GATE` sigue siendo obligatorio y es exactamente el control que impide un falso verde**: su mitad 4a consulta `cron.job` y exige la fila `taba-payment-outbox-worker` con `active = true`. Si el guard se omitiera indebidamente en hosted, ese gate lo detecta y bloquea la compra.

**Efecto sobre el gate local**: con ese cambio, `npm run test:payments:local-db` aplicaría las 38 migraciones, correría la suite de Mercado Pago (21 comprobaciones) y las 4 pgTAP (131 aserciones), y el "4/5 + 1 hosted-only" pasaría a ser un resultado **real y reproducible** en vez de una reconstrucción.

**No aplicado en esta sesión**: la instrucción fue reejecutar y registrar, modificando código sólo ante defecto demostrado. El defecto está demostrado; el cambio queda **propuesto**, pendiente de decisión, porque toca una migración que ya forma parte del RC.

---

## Estado de HOSTED_PG_CRON_GATE

**Obligatorio y bloqueante, sin cambios.** Esta corrida lo refuerza: la porción de Mercado Pago del contrato de base **no tiene ninguna verificación local vigente**, de modo que el gate hosted es hoy la única evidencia posible de ese contrato. Sin `HOSTED_PG_CRON_GATE=PASS` no se solicita compra.
