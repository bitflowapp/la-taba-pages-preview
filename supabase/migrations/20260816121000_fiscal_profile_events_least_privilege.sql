-- ============================================================================
--  fiscal_profile_events deja de depender de que RLS llegue a tiempo.
-- ============================================================================
--
--  QUE SE MIDIO (2026-08-16, schema final de la-taba-production):
--
--    anon           DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--    authenticated  DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
--
--  Es la UNICA tabla de las 85 con permisos de escritura para un rol de cliente.
--  No fue una decision: 20260805120000 la creo y le puso el `grant select ... to
--  authenticated` que necesita su policy, pero se salteo el `revoke all
--  privileges ... from public, anon, authenticated` que el resto del repositorio
--  hace en cada tabla nueva (20260725030000, 20260725110000, 20260728090000,
--  20260802090000, ...). Sin ese revoke la tabla se queda con lo que PostgreSQL
--  y el proyecto hosted le dan por defecto.
--
--  POR QUE NO ALCANZA CON «RLS HOY LO BLOQUEA»:
--
--  Se probo, con los grants exactos de produccion reproducidos sobre una base
--  local, que RLS SI contiene el DML por fila:
--
--    anon SELECT   -> 0 filas   (no hay policy para anon)
--    anon DELETE   -> 0 filas   (no hay policy de DELETE)
--
--  y que NO contiene esto:
--
--    anon TRUNCATE -> la tabla queda vacia
--
--  TRUNCATE no pasa por row level security: lo gobierna unicamente el privilegio
--  TRUNCATE. O sea que el rastro de quien autorizo una homologacion fiscal
--  -la unica evidencia de ese acto- era borrable por un rol que ni siquiera
--  puede leerlo. RLS no podia protegerlo y nunca iba a poder.
--
--  CONTRATO QUE SE RESTITUYE, que es el que la tabla siempre quiso tener:
--
--    anon           -> nada
--    authenticated  -> SELECT, y encima la policy «business reads fiscal profile
--                      events» (20260814050000) que lo limita a is_business_member
--    escritura      -> solo authorize_arca_homologation(), SECURITY DEFINER
--                      propiedad de postgres, que es hoy el unico escritor.
--
--  Por eso revocar no rompe nada: el INSERT de la homologacion corre como el
--  definer, no como el llamador.
-- ============================================================================

revoke all privileges on table public.fiscal_profile_events
  from public, anon, authenticated;

grant select on table public.fiscal_profile_events to authenticated;

comment on table public.fiscal_profile_events is
  'Rastro de autorizaciones sobre el perfil fiscal. Lectura: authenticated miembro del negocio. Escritura: solo authorize_arca_homologation (SECURITY DEFINER). anon no tiene ningun privilegio.';
