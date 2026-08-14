-- ─────────────────────────────────────────────────────────────────────────────
-- B3 · `commercial_contract_remediation` deja de ser escribible sin autenticar
--
-- MEDIDO EN VIVO contra staging con la clave publicable pública, el 2026-08-14:
--
--   POST /rest/v1/commercial_contract_remediation  {}
--     → 400 · 23502 · null value in column "migration" violates not-null
--   POST /rest/v1/orders  {}                                      ← control
--     → 401 · 42501 · permission denied for table orders
--
-- La primera ATRAVESÓ la comprobación de privilegios y murió recién contra un
-- NOT NULL. La segunda murió en el privilegio. Esa diferencia —23502 frente a
-- 42501— es la prueba de que `anon` tiene INSERT. El SELECT también: devuelve
-- 200 mientras las demás devuelven 401. Ninguna fila se creó: el cuerpo violaba
-- la restricción a propósito.
--
-- CÓMO PASÓ. La tabla se creó sin `enable row level security` y sin `revoke`,
-- así que quedó a merced de los privilegios por defecto del esquema `public`.
-- De las 84 tablas del esquema es la ÚNICA sin RLS.
--
-- QUIÉN LA USA. Nadie. La única referencia en todo el repositorio es
-- `tests/commercial-price-contract.test.mjs`, y lee el TEXTO de la migración que
-- la creó, no la tabla. No hay lectura ni escritura desde el cliente web, ni
-- desde la app del Rider, ni desde ninguna Edge Function. Es una constancia de
-- auditoría que escribió una migración una sola vez.
--
-- Por eso el criterio es PRIVILEGIO MÍNIMO y no una policy: no hay a quién
-- habilitar. RLS encendida sin una sola policy niega a todo el mundo salvo al
-- dueño de la tabla, que es quien corre las migraciones. Si algún día aparece un
-- consumidor legítimo, se le escribe su policy; hasta entonces, ninguna.
--
-- REVERSIÓN: docs/migrations/rollback/20260814060000_*.rollback.sql
-- No se toca una sola fila: la tabla conserva su contenido, que hoy además está
-- vacío porque la remediación de 20260809060000 fue un no-op.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.commercial_contract_remediation enable row level security;

-- Sin policies: nadie lee y nadie escribe. Deliberado, no un olvido.
-- El `revoke` no es redundante con la RLS: son dos capas distintas y la de
-- privilegios es la que hoy falta. Con las dos, el estado ya no depende de qué
-- privilegios por defecto tenga el esquema en el proyecto donde se aplique —que
-- es exactamente lo que hizo que staging y las migraciones no coincidieran—.
revoke all privileges on table public.commercial_contract_remediation
  from public, anon, authenticated;

comment on table public.commercial_contract_remediation is
  'Audit trail of rows switched to available=false when the commercial price contract was hardened. Empty means the catalog was already coherent. Privada: RLS sin policies y sin privilegios para anon/authenticated — no tiene consumidores.';
