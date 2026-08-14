-- REVERSIÓN de 20260814060000_commercial_contract_remediation_is_private.sql (B3)
--
-- Devuelve `public.commercial_contract_remediation` a su estado anterior: sin
-- RLS y con los privilegios por defecto del esquema. En el proyecto de staging
-- eso significaba SELECT e INSERT para `anon`, es decir escritura sin
-- autenticar. Revertir REABRE esa exposición.
--
-- ESTE ARCHIVO NO ES UNA MIGRACIÓN y vive fuera de supabase/migrations a
-- propósito, para que `supabase db push` no pueda aplicarlo por accidente.
--
-- No hay pérdida de datos en ninguno de los dos sentidos.

begin;

alter table public.commercial_contract_remediation disable row level security;

-- Se restituye lo que daban los privilegios por defecto del esquema público.
-- Es intencionalmente amplio: es lo que había, y el objetivo de una reversión es
-- volver al estado anterior, no a uno mejor.
grant select, insert, update, delete on table public.commercial_contract_remediation
  to anon, authenticated;

comment on table public.commercial_contract_remediation is
  'Audit trail of rows switched to available=false when the commercial price contract was hardened. Empty means the catalog was already coherent.';

commit;
