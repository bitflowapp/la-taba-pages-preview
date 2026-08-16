# TABA2 · `la-taba-production` · ESTADO DE SEGURIDAD DESPUES DE LA REMEDIACION

| | |
|---|---|
| Proyecto | `la-taba-production` |
| Ref | `wwcpogltfgzgkrlilbcd` |
| Region | `sa-east-1` |
| Ledger | **103** (100 historicas + 3 forward-only) |
| Ultima migracion | `20260816122000` |
| Digest de las 100 historicas | `e45f69cdb9c939e29620278450984cd2f4e42ad52cf79295470437c35f5cf2a9` (**sin cambios**) |

Todo lo que sigue esta medido contra la base, no inferido de los nombres de las
migraciones. Retratos completos en `PRODUCTION-PORTRAIT-BEFORE.json` y
`PRODUCTION-PORTRAIT-AFTER.json`.

## Resumen

| Eje | Antes | Despues |
|---|---|---|
| Ledger | 100 | **103** |
| Tablas | 85 | 85 |
| Tablas sin RLS | 0 | **0** |
| Policies | 66 | 66 |
| SECURITY DEFINER | 222 | **220** |
| SECURITY DEFINER sin `search_path` | 0 | **0** |
| SECURITY DEFINER ejecutables por `anon` | 18 | **8** |
| Funciones QA vivas | 3 | **1** |
| Comentarios `STAGING ONLY` | 2 | **0** |
| Tablas con escritura para `anon`/`authenticated` | 1 | **0** |
| Secretos en vault | 0 | 0 |
| Jobs de pg_cron activos | 4 | 4 |
| `auth.users` | 0 | **0** |
| Datos humanos / comerciales | 0 | **0** |

## 1 · Superficie QA — CERRADA

```
anon puede invocar la RPC de fixtures QA          = NO
authenticated puede invocar la RPC de fixtures QA = NO
runtime normal puede crear UNAPPROVED_QA          = NO
```

`import_qa_fixture_catalog` y `publish_qa_fixture_product` **ya no existen**.

La cadena que habilitaban, y que ahora esta cortada de raiz: un owner/admin
autenticado de cualquier negocio insertaba `catalog_assets` con
`rights_status = 'UNAPPROVED_QA'` y sin sello de aprobacion, marcaba el producto
`is_verified` + `available` salteando los requisitos comerciales, y la policy
`production verified products are public` lo mostraba en la vidriera anonima
como un producto real y ordenable.

Se borraron en vez de revocarles el permiso porque **ningun rol podia usarlas**:
las dos exigen `auth.uid()` + `has_business_role(owner/admin)`, y `service_role`
no tiene `auth.uid()` (medido: devuelve `Only an active owner/admin can import
staging QA fixtures.`). Un REVOKE habria dejado dos RPC publicables por PostgREST
que nadie puede ejecutar y que dependen de que nadie vuelva a otorgar el permiso.

`product_is_qa_fixture` **sigue viva a proposito**: no es superficie QA sino la
red de seguridad que marca `origin = 'qa'` en el pedido para que un rider nunca
salga a repartir a una direccion inventada.

### Por que no se tocaron los CHECK

Las ramas QA de `catalog_assets_rights_valid`,
`products_verified_publication_authority` y `products_verified_master_data` se
dejan como estan. Son el vocabulario del que depende `product_is_qa_fixture`, y
staging tiene filas reales con esos valores. Lo que se cerro es el **camino de
escritura**, que es donde estaba la vulnerabilidad:

- `anon` y `authenticated` no tienen INSERT ni UPDATE sobre `catalog_assets`.
- `anon` y `authenticated` no tienen INSERT sobre `products`.
- El UNICO UPDATE de `authenticated` sobre `products` es por columna, y son
  `available`, `is_active`, `sort_order` y `stock`. **No** `catalog_origin`,
  **no** `is_verified`.

Sin las dos RPC no queda ninguna via de cliente para introducir `UNAPPROVED_QA`.

## 2 · `fiscal_profile_events` — CERRADA

| Rol | Antes | Despues |
|---|---|---|
| `anon` | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | **(ninguno)** |
| `authenticated` | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | **SELECT** |
| `service_role` | DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE | sin cambios |

Era la unica de las 85 tablas con escritura para un rol de cliente. No fue una
decision: `20260805120000` la creo y le puso el `grant select` que necesita su
policy, pero se salteo el `revoke all privileges ... from public, anon,
authenticated` que el resto del repositorio hace en cada tabla nueva.

**Por que no alcanzaba con "RLS hoy lo bloquea".** Reproduciendo los grants
exactos de produccion sobre una base local:

```
anon SELECT   -> 0 filas          RLS contiene
anon DELETE   -> 0 filas          RLS contiene
anon TRUNCATE -> tabla vacia      RLS NO aplica
```

TRUNCATE no pasa por row level security: lo gobierna unicamente el privilegio
TRUNCATE. El rastro de quien autorizo una homologacion fiscal era borrable por un
rol que ni siquiera podia leerlo. Eso RLS no lo iba a contener nunca.

Se mantiene `service_role` porque tiene DML sobre **las 85 tablas**: es el patron
uniforme del rol de servidor de Supabase, no una anomalia de esta tabla. El unico
escritor real sigue siendo `authorize_arca_homologation()`, SECURITY DEFINER
propiedad de `postgres`, que no se ve afectado por el revoke.

## 3 · SECURITY DEFINER ejecutables por `anon` — 18 → 8

Las 8 que quedan tienen `grant execute ... to anon` escrito por alguien y razon
funcional comprobada:

```
can_access_order              check_scheduler_watchdog     commerce_availability
get_public_business_contact   get_public_order_tracking    list_business_combos
resolve_business_combo        scheduler_heartbeat
```

`can_access_order` **no se podia tocar**: se evalua dentro de las policies
`production orders readable by owner` y `production order items readable with
order`, las dos para `{anon, authenticated}`. Una policy se evalua con el rol que
consulta, asi que revocarle `anon` habria roto el seguimiento publico de pedidos.

Las 10 que perdieron `anon` **no tenian ninguna linea de grant** en ninguna
migracion: llegaron ahi por el `GRANT EXECUTE ... TO PUBLIC` que PostgreSQL
aplica por defecto a toda funcion nueva.

- **5 RPC fiscales del Panel** (`authorize_fiscal_artifact_access`,
  `list_fiscal_document_artifacts`, `request_fiscal_artifact_regeneration`,
  `request_fiscal_print_job`, `update_fiscal_print_job`) → ahora solo
  `authenticated`. Las 5 ya validaban `has_business_role` adentro, asi que no
  tapan un agujero abierto; sacan un privilegio que nunca hizo falta y cierran
  dos detalles reales: que un anonimo pudiera distinguir "artefacto inexistente"
  de "no autorizado", y que `request_fiscal_artifact_regeneration` tomara un
  `for update` sobre `fiscal_documents` antes de comprobar el rol.
- **5 funciones de trigger** (`assert_fiscal_execution_authorized`,
  `assert_order_payment_modality`, `enqueue_authorized_fiscal_artifact`,
  `enqueue_new_order_notification`, `prevent_unverified_delivery`) → ningun rol
  de cliente. No son invocables (`trigger functions can only be called as
  triggers`, medido como `anon`) y sus triggers siguen atados: el privilegio se
  comprueba al `CREATE TRIGGER`, no cuando el trigger dispara.

Clasificacion completa, con proposito, owner, search_path, grants, caller y
riesgo de cada una: `SECURITY-DEFINER-AUDIT.json`.

## 4 · Invariantes conservados

```
SECURITY DEFINER sin search_path fijado     = 0        (222/222 antes, 220/220 despues)
CREATE sobre schema public para anon        = denegado
CREATE sobre schema public para authenticated = denegado
vault USAGE para anon / authenticated       = NO
secretos en vault                           = 0
tablas sin RLS                              = 0 de 85
policies                                    = 66, sin cambios
```

## 5 · pg_cron — 4 jobs, sin cambios, deliberado

Los 4 siguen programados y activos. Tres son **demostrablemente inertes** sin
configuracion y sin trabajo: salen por un guard antes de escribir nada y no hacen
ninguna llamada externa. El cuarto escribe una fila por minuto en
`operational_sweep_runs`, y **esa fila es el trabajo**: `scheduler_heartbeat()` la
lee para decidir si el planificador esta vivo, y `check_scheduler_watchdog()`
abre una alerta CRITICAL cuando no lo esta.

Suprimirla habria envejecido el heartbeat mas alla de sus 600 segundos y abierto
una alerta CRITICAL en produccion cada minuto: fabricar un incidente para borrar
una fila. Detalle, mediciones y evidencia en `CRON-AUDIT.json`.

## 6 · Drift shadow ↔ produccion

Comparacion sobre los ejes de seguridad, con el shadow reconstruido 0 → 103 desde
cero y produccion en 100 + 3 forward-only:

| Eje | Shadow (0→103) | Produccion (100+3) | |
|---|---|---|---|
| Ledger | 103 | 103 | = |
| SECURITY DEFINER total | 220 | 220 | = |
| SECURITY DEFINER anon | 8 | 8 | = |
| SECURITY DEFINER sin search_path | 0 | 0 | = |
| Funciones QA | 0 de 2 | 0 de 2 | = |
| `fiscal_profile_events` anon | (ninguno) | (ninguno) | = |
| `fiscal_profile_events` authenticated | SELECT | SELECT | = |
| Grants de escritura a cliente | 0 | 0 | = |
| Tablas / sin RLS | 85 / 0 | 85 / 0 | = |

**Sin drift inexplicado.**

Vale la pena registrar un detalle que la remediacion **corrigio**: antes, sobre la
migration 100, el stack local y el hosted **no** coincidian en
`fiscal_profile_events`. El hosted daba a `anon` el DML completo y el local solo
`REFERENCES, TRIGGER, TRUNCATE`, porque los privilegios por defecto del proyecto
hosted y los de la CLI local no son los mismos. Al hacer el REVOKE explicito, los
dos entornos convergen al mismo estado: es exactamente la clase de divergencia
que un permiso heredado produce y un permiso escrito elimina.

El diff automatizado final no llego a correr porque el daemon de Docker de la
maquina quedo colgado por un error de E/S de disco, posterior a la suite completa.
Los valores del shadow de esta tabla son los medidos mientras estuvo vivo.

## 7 · Auth — SIN TOCAR (fuera de alcance)

No se modifico nada. Estado pendiente, para la mision siguiente:

- `site_url` = `http://localhost:3000` — hay que ponerle el dominio real.
- `additional_redirect_urls` = `[]` — vacia; hay que declarar los destinos
  exactos de Web, Panel y Rider.
- `enable_signup` = `true` — con captcha apagado, cualquiera puede crear cuenta
  en produccion. Recomendado cerrarlo o exigir captcha **antes** de conectar
  clientes.
- `enable_anonymous_sign_ins` = `true` — revisar si el producto lo necesita.
- captcha = apagado.

## 8 · Identidad de negocio (auditoria de solo lectura)

La fila canonica es `00000000-0000-4000-8000-000000000001` / "La Taba", con
`address`, `phone` y `currency_code` vacios y `ordering_enabled`,
`ordering_verified`, `delivery_enabled`, `pickup_enabled` todos en `false`.

Dos observaciones para el cutover, **ninguna corregida** (esta prohibido tocar
datos comerciales y configuracion de clientes en esta mision):

1. `runtime-config.example.js`, el comentario de `runtime-config.js` y
   `js/core/runtime-config.js` muestran de ejemplo
   `businessId: '00000000-0000-4000-8000-000000000000'` — terminado en **000**,
   mientras que la fila real termina en **001**. `DEFAULT_SUPABASE_BUSINESS_ID`
   en `js/repositories/supabase_order_repository.js` si tiene el `...001`
   correcto. Copiar el ejemplo tal cual apunta a un negocio inexistente.
2. Con `ordering_verified = false` y `ordering_enabled = false`, la policy
   `production verified products are public` no publica **ningun** producto.
   Produccion falla cerrado, que es lo correcto prelaunch, pero es un requisito
   de cutover: sin configurar el negocio, la vidriera queda vacia.

Las dos fallan cerrado. Ninguna es un blocker de seguridad.
