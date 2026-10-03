# Gate de PostgreSQL: FALLA sobre `8028dcc`

En la certificación anterior este gate quedó `NOT_RUN` porque el demonio de Docker estaba
apagado y el disco no daba. Esta vez Docker levantó y el stack local arrancó, así que el gate
se pudo ejecutar **por primera vez** — y falla.

No es un problema del arreglo cosmético de `8028dcc`. Es un defecto que entró antes, en
`d1ddec6` (`feat(database): expose sanitized panel contracts…`), y que ningún gate anterior
podía ver porque este era justamente el que no corría.

## Cómo se reproduce

```
npm run test:db:isolated        (con TABA_LOCAL_PAYMENT_DB=1 y el stack local arriba)
```

Salida, después de 30 asserciones en verde:

```
ERROR:  new row for relation "fiscal_profiles" violates check constraint
        "fiscal_profiles_homologation_gate"
DETAIL:  Failing row contains (42000000-…-000000000001, TABA Fiscal Fixture, 20123456789,
         Responsable Inscripto, null, Direccion fiscal fixture, homologation, 1, PES, 1,
         manual, t, pending, blocked, null, null, …)
```

## Qué lo causa

`supabase/migrations/20260804090000_business_operations_panel.sql` agrega:

```sql
alter table public.fiscal_profiles add constraint fiscal_profiles_homologation_gate check (
  environment <> 'homologation'
  or (homologation_authorized_at is not null and homologation_authorized_by is not null)
);
```

La intención era que el panel no pudiera pasar a homologación sin dejar registrada la
autorización. El problema es que la restricción no distingue *quién* hace el cambio: aplica a
toda la tabla, siempre.

## Alcance real

1. **Rompe un camino del panel que ya existía.** `configure_fiscal_profile` — la RPC detrás de
   la pantalla "Datos fiscales", presente desde el RC1 — acepta explícitamente
   `environment in ('disabled','homologation')` y **nunca** escribe
   `homologation_authorized_at` / `_by`. Con la restricción puesta, un dueño que use esa
   pantalla para pasar a homologación recibe una violación de constraint. Es decir: el panel
   muestra un error crudo de base en la única situación que más cuidamos.

2. **Rompe la fixture de cierre fiscal.** `supabase/tests/fiscal_document_closure_test.sql`
   inserta un perfil en homologación sin autorización. Por eso cae el gate.

3. **Puede hacer fallar la migración en una base con datos.** `ADD CONSTRAINT` valida las filas
   existentes al aplicarse. Cualquier base que ya tenga un perfil en homologación —
   exactamente el estado en el que quedaría un negocio que ya estaba probando con ARCA — hace
   que la migración no aplique.

## Qué no rompe

- La autorización por frase sigue funcionando: `authorize_arca_homologation` exige
  `I_AUTHORIZE_ARCA_HOMOLOGATION`, valida contador, datos y certificado, y escribe ambas
  columnas. Ese camino es correcto y está cubierto por los tests de contrato.
- Nada de esto afecta la producción fiscal, que sigue sin ruta de activación desde el panel.

## Arreglo recomendado

La garantía que importa ya la da la función, no la tabla. La restricción a nivel tabla, tal
como está, prohíbe estados legítimos y preexistentes. Dos opciones sensatas:

1. **Quitar la restricción** y dejar que `authorize_arca_homologation` sea la única vía que
   registra la autorización. Es la más simple y no invalida datos existentes.
2. **Conservarla pero acotada**, si se quiere defensa en profundidad: hacer que
   `configure_fiscal_profile` no pueda pasar a `homologation` (que sólo deje `disabled`) y
   agregar la restricción como `NOT VALID`, validándola recién después de un backfill
   deliberado. Esto cambia el comportamiento de una pantalla existente, así que es una
   decisión de producto, no sólo técnica.

No apliqué ninguna de las dos: esta rama certifica `8028dcc` tal como está y la consigna pedía
no modificar la rama fuente.
