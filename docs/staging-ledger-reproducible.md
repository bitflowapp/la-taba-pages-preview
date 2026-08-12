# El ledger de staging vuelve a reproducirse desde Git

**Verificado el 2026-08-12 ~06:2xZ. Sólo lecturas contra staging: no se aplicó,
revirtió ni reparó nada.**

---

## 1 · Qué estaba roto

Staging tenía dos migraciones aplicadas que no existían en ningún commit
alcanzable: eran **archivos sin versionar** en el worktree de
`TABA2_IDENTITY_STAGING_CERTIFICATION`. Mientras siguieran así,
`supabase db push` no podía correr **para nadie** desde un árbol limpio: el CLI
se niega cuando hay versiones remotas sin archivo local, y lo único que ofrece es
`migration repair --status reverted`, que sería declarar revertidas dos
migraciones que sí están aplicadas.

## 2 · Quién lo cerró

**Su propio autor**, en `89fff62` — que es como correspondía. Este trabajo no
creó migraciones sustitutas, no renumeró, no reparó, no revirtió y no reaplicó
nada. Lo que hizo fue **demostrar que lo commiteado es lo que está aplicado**, y
traerlo a un árbol donde conviva con el paquete de operación y cobertura.

## 3 · La prueba de que el commit representa lo aplicado

### 3.1 · Contra el texto literal que se ejecutó

El ledger de Supabase guarda en `schema_migrations.statements` el SQL que se
mandó. Comparado carácter por carácter contra el archivo commiteado:

| Versión | Diferencias | Dónde caen | SQL ejecutable |
|---|---|---|---|
| `20260812090000` | 5 | **todas dentro de comentarios `--`** | **idéntico**, sha256 `357214b98bdbb210…` |
| `20260812100000` | 3 | **todas dentro de comentarios `--`** | **idéntico**, sha256 `bb023aa5bdade917…` |

Las ocho diferencias son de dos clases, y las dos son tipográficas:

- `—` (raya, U+2014) → `-` (guion, U+002D)
- `·` (punto medio, U+00B7) → `�` (carácter de reemplazo, U+FFFD)

Es pérdida de puntuación no-ASCII en el transporte. **Ninguna toca un
identificador, un literal ni un token de SQL.** Quitando los comentarios de línea
—la misma transformación aplicada a los dos lados— el SQL es byte a byte igual.

### 3.2 · Contra el estado que quedó alojado

Más fuerte que comparar textos: comparar lo que la base **tiene**. Ocho
definiciones de función, tomadas del staging alojado y de una base construida
desde cero sólo con Git:

```
IGUAL  rider_require_active_membership(uuid)          f794450452a4
IGUAL  get_active_rider_delivery()                    a59bcbe8ef05
IGUAL  has_business_role(uuid,text[])                 c5203406fc7b
IGUAL  identity_member_role(uuid)                     4a949051d114
IGUAL  business_is_open(uuid,text,timestamptz)        6c07e46af34b
IGUAL  resolve_delivery_zone(uuid,float8,float8,text) 2526cc7cb3fb
IGUAL  commerce_availability(uuid,text,jsonb)         1eaada244d94
IGUAL  can_manage_commercial_settings(uuid)           b879476db3b0
```

### 3.3 · Y el esquema entero

| | Git desde cero | Staging | |
|---|---|---|---|
| Tablas | 84 | 84 | idéntico |
| Columnas | 1145 | 1145 | idéntico |
| Constraints | 678 | 678 | idéntico |
| Policies | 69 | 69 | idéntico |
| Funciones | 259 | 259 | idéntico |
| Triggers | 66 | 67 | **una diferencia, explicada abajo** |

La única diferencia es `realtime.subscription:tr_check_filters`. No es del
esquema de la aplicación ni la crea ninguna migración: la instala el servicio
**Realtime** de Supabase. El arnés local copia sólo los esquemas `auth` y
`storage` de la plataforma, así que ese trigger no existe en la base efímera. No
es un hueco de reproducibilidad: es una pieza de plataforma que ninguna migración
declara.

## 4 · El ledger, conjunto contra conjunto

```
migraciones en Git : 88
filas en el ledger : 88
CONJUNTOS IDENTICOS: True
aplicadas que Git no tiene: NINGUNA
en Git sin aplicar        : NINGUNA
```

## 5 · Orden y convivencia

Las diez de identidad corren primero (`20260812010000`…`100000`) y las cinco de
operación y cobertura después (`20260812200000`…`240000`). Sobre una base creada
**vacía** con las 88 en ese orden: **141 afirmaciones en verde** — 112 pgTAP, 24
de la cadena real (que crea sesiones de checkout y un pedido de verdad) y 5 de la
sonda que entra como `authenticator`, el rol con el que PostgREST entra.

## 6 · Identidad de los archivos

| | |
|---|---|
| `20260812090000_rider_rpcs_consult_the_gate.sql` | sha256 `751d377a1dc0b93a9e7367afc81af4956891fa4fdf1b79f8235353f322380fe9` · blob git `73797f021e52fce643e4544cc6fef7beb12fc9e1` · 5327 B |
| `20260812100000_active_delivery_checks_the_session_first.sql` | sha256 `2b3297810b01f2278566341f7c2bd5e638f23f6bafef695e615ed41b4bffd6a1` · blob git `dd26ae5fd964cfac443d00d0ef1618bfbdff49cc` · 2468 B |

Ancestría: entraron en `89fff62` (rama `feature/taba2-identity-session-biometrics`),
que es ancestro de `7bfd12b` en `feature/taba2-business-operations-delivery`.

## 7 · Lo que NO se hizo

No se crearon migraciones sustitutas · no se renumeró ninguna de las dos · no se
usó `migration repair` · no se revirtió · no se reaplicó · **no se tocó staging**:
todo lo de este tramo fueron lecturas.
