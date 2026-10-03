# Preflight de aplicación a STAGING — TABA2_BUSINESS_OPERATIONS_DELIVERY_CONFIG

**Medido el 2026-08-12 entre 05:13Z y 05:22Z. Sólo lecturas. Staging NO fue mutado.**

Paquete: `20260812100000` … `20260812140000` (5 migraciones), HEAD local `353ebd0`,
rama `feature/taba2-business-operations-delivery`.

---

## 1 · Ledger remoto (lectura)

| | |
|---|---|
| Aplicadas en staging | **81** |
| Pendientes | **5, y son exactamente las de este paquete** |
| **Pendientes ajenas a este paquete** | **NINGUNA** |
| Sólo en el remoto (aplicadas, ausentes de este árbol) | **8**: `20260812010000`…`20260812080000` |

Las 8 ajenas son la capa de identidad de
`feature/taba2-identity-session-biometrics`. **Están realmente aplicadas**, no es
un ledger mentiroso: el volcado de esquema que tomé contiene `staff_profiles`
(8 referencias), `rider_profiles` (8) e `identity_user_security` (9).

**El orden acompaña:** la primera mía (`20260812100000`) es posterior a la última
aplicada (`20260812080000`). Las cinco se agregan a la cola sin intercalarse.

La divergencia es **al revés** de lo que anticipaba mi informe anterior: no hay
nada ajeno que `db push` pudiera arrastrar, porque lo ajeno ya está aplicado. Lo
que falta es al revés — historia aplicada que este árbol no tiene.

---

## 2 · Los dos bloqueos

### A · El lock exclusivo está TOMADO y la sesión sigue activa

`taba2-staging-mutation.lock` → `STATUS=HOLDING`,
`OWNER=TABA2_IDENTITY_STAGING_CERTIFICATION`, tomado 04:27Z.

Durante esta misma ventana esa sesión **pasó de 6 a 8 migraciones**, y su alcance
declarado todavía incluye desplegar el frontend a staging y certificar el Rider.
El slot `20260812090000` sigue libre: si aplico `100000` y después ellos agregan
`090000`, el ledger queda **fuera de orden**, que es exactamente el daño de
trazabilidad que este encargo prohíbe.

### B · `supabase db push` se niega a correr

```
LegacyDbPushMissingLocalError:
  Remote migration versions not found in local migrations directory.
```

Y la solución que sugiere el propio CLI es:

```
supabase migration repair --status reverted 20260812010000 … 20260812080000
```

**Rechazada.** Marcar como `reverted` ocho migraciones que están aplicadas —y
cuyas tablas puedo ver en el volcado— sería escribir una mentira en el ledger
compartido y borrar la trazabilidad de otra sesión. No es correcto ni
reversible, así que no cumple la excepción que el encargo permite.

La otra sugerencia, `supabase db pull`, importaría las 8 migraciones ajenas a
este árbol como si fueran propias. Tampoco.

El CLI 2.110 no expone ningún subcomando de SQL crudo (`db` sólo tiene `diff`,
`dump`, `push`, `pull`, `reset`, `lint`), así que `db push` es el único camino de
escritura de esquema disponible.

---

## 3 · La vía controlada que sí preserva el ledger

Hacer que **el árbol local contenga las 8 migraciones ya aplicadas**, fusionando
`feature/taba2-identity-session-biometrics`. Verificado sin mutar nada:

- `merge-base` = `0a5f6d0`
- **cero archivos en común** entre los dos diffs
- `git merge-tree --write-tree` → **MERGE LIMPIO**, sin conflictos

Después de la fusión el árbol tiene 86 migraciones, las 81 aplicadas existen
todas localmente, y `db push` encuentra **exactamente 5 pendientes: las mías**.
El ledger queda verdadero, sin un solo `repair`.

**Sigue necesitando el lock.**

---

## 4 · Evidencia guardada para rollback

| Archivo | Qué es |
|---|---|
| `ledger-antes.json` | ledger remoto completo antes de tocar nada |
| `schema-antes.sql` | volcado de esquema de staging, 964 131 B, sha256 `79b91dfd7f9ab28229d1e42f5ab5432e79a260fbd39c4ebc4bceef67fb4c79c2` |

Estado previo confirmado en el volcado: **ninguna** de mis tablas existe todavía
(`business_service_hours`, `delivery_zones`, `business_config_audit`: 0
referencias) y **ninguna** de mis columnas está en `businesses`.

Falta, y se toma recién con el lock en mano y antes de mutar: instantánea de
datos de `businesses` y de la configuración comercial relacionada.

**Rollback del paquete**, si alguna vez hiciera falta: las 5 migraciones son
aditivas y no borran ni modifican nada existente, así que revertir es
`drop table` de las cuatro tablas nuevas, `drop function` de las nueve funciones
nuevas, `drop trigger` de los dos triggers, y `alter table … drop column` de las
cinco columnas de `businesses`, la de `business_members`, las tres de `orders`,
las tres de `checkout_sessions` y la de `customer_addresses`; más el borrado de
las 5 filas del ledger. Ningún dato de negocio se pierde porque ninguno se
escribe.

---

## 5 · Gates locales, corridos en esta pasada

| Gate | Resultado |
|---|---|
| `npm run check` | **verde** (corrigió 4 rutas de máquina que yo mismo había metido en el informe) |
| `npm test` | **1360 / 1360** |
| `migrations:validate` | **verde** |
| `secrets:scan` | **limpio** |
| pgTAP focal + cadena real | **128 afirmaciones**, 78 migraciones, base creada vacía |

---

## 6 · Estado

**NO SE MUTÓ STAGING.** Ni una migración aplicada, ni un `repair`, ni un `pull`,
ni un dato escrito. El paquete queda listo y esperando dos cosas: que se libere
el lock, y una decisión sobre cómo resolver la divergencia de árbol.
