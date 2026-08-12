# La línea canónica de esquema

**Rama: `integration/taba2-schema-canonical`.**

Es la única línea desde la que se debe hablar con la base de staging. Contiene,
con su ancestría intacta, las dos tandas que hoy forman el esquema:

- la **capa de identidad** (`feature/taba2-identity-session-biometrics`), y
- el paquete de **operación comercial y cobertura**
  (`feature/taba2-business-operations-delivery`).

## Por qué existe

Porque el proyecto ya se lastimó tres veces con lo mismo, el mismo día:

1. **Migraciones aplicadas sin commit.** Una sesión aplicó a staging archivos que
   no estaban versionados. `supabase db push` quedó inutilizable **para todos**
   desde un árbol limpio, y lo único que el CLI ofrecía era marcarlas
   `reverted` — mentir sobre migraciones que sí estaban aplicadas.
2. **Colisión de número de versión.** Dos ramas usaron `20260812100000` con
   contenido distinto. El CLI casa por versión, no por contenido: da por
   aplicada una migración que nunca corrió, la saltea, y las siguientes corren
   contra un esquema que no existe. Lo mismo pasa hoy entre las ramas de ARCA y
   de pilot-ops, que comparten `20260807110000`…`150000`.
3. **Ramas con migraciones que staging no tiene.** Un `db push` desde cualquiera
   aplica trabajo ajeno de arrastre.

## La compuerta

```
npm run migrations:parity
```

Compara el conjunto de versiones del árbol contra el ledger remoto y **falla
cerrado** si no son exactamente iguales. También falla cuando **no puede
comprobarlo** —sin token, sin red, respuesta rara—: «no pude verificarlo» y
«está bien» no son lo mismo.

Detecta además dos archivos con la misma versión dentro del propio árbol, que es
la colisión del punto 2 antes de que salga de la máquina.

Está enchufada como primer paso de `scripts/apply-business-operations-to-staging.mjs`,
y cualquier script futuro que mute staging debería empezar por
`assertLedgerParity()`.

## Ramas que NO se deben usar para `db push`

Cada una tiene migraciones que staging no tiene. Empujar desde ellas aplica
trabajo que nadie certificó:

| Rama | Migraciones que staging no tiene |
|---|---|
| `feature/taba2-arca-fiscal-automation` | `20260807110000`…`150000` (ARCA) |
| `feature/taba2-pilot-ops` | `20260807110000`…`150000` (pilot-ops) |
| `fix/taba2-location-truth` | las mismas cinco de pilot-ops |
| `release/taba2-pilot-rc2` | las mismas cinco de pilot-ops |
| `feature/taba2-automated-rider-dispatch` | `20260811100000`, `101000`, `102000` |
| `feature/taba2-whatsapp-commerce` | `20260807170000` |

**Ojo con las dos primeras:** usan los mismos cinco números con contenido
distinto. Cuando esos frentes se integren, uno de los dos tendrá que renumerar.

Las ramas anteriores a la capa de identidad —incluida
`feature/taba2-commercial-production-hardening`— tampoco sirven: les faltan las
once migraciones de identidad, así que no pueden reconstruir staging y el CLI se
va a negar.

## Qué se verificó en esta línea

Base creada **vacía**, cadena completa de migraciones en orden:

- **141 afirmaciones** — 112 pgTAP, 24 de la cadena real (crea sesiones de
  checkout y un pedido de verdad) y 5 de la sonda que entra como `authenticator`,
  el rol con el que PostgREST entra de verdad.
- `migrations:validate`, `npm test` (1374/1374), `npm run check` y
  `secrets:scan`: todos en verde.

Y las seis supervivencias que importan cuando dos tandas conviven:

| | |
|---|---|
| Revocación de identidad del Rider | rider vigente resuelve su rol; revocado → `NULL` |
| `has_business_role` como gate comercial | owner revocado → `can_manage_commercial_settings` = `false` |
| `business_commercial_managers` separado | existe, y `business_members` **no** tiene la columna |
| Horarios/zonas con enforcement OFF | abierto = `true`, barrio inventado elegible, `enforced` = `false` |
| `delivery_fee` / mínimo | 150 / 350, sin cambios |
| LT-0030 / LT-0142 | sin ninguna mutación |

## Cómo se mantiene

Cuando una sesión aplique algo a staging, **el commit es parte de aplicar**, no
un trámite posterior. Mientras el archivo no esté versionado, la línea canónica
no reproduce staging y `npm run migrations:parity` lo dice.
