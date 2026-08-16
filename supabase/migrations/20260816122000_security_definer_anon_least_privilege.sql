-- ============================================================================
--  anon deja de tener EXECUTE sobre lo que nunca fue suyo.
-- ============================================================================
--
--  QUE SE MIDIO (2026-08-16): 222 funciones SECURITY DEFINER en produccion, 18
--  ejecutables por anon. Se leyo el cuerpo de las 18 y se busco quien las llama.
--  Se parten en dos grupos, y la evidencia es documental: cuales tienen un
--  `grant execute ... to anon` escrito por alguien, y cuales no tienen NINGUNA
--  linea de grant y solo llegaron a anon por el `GRANT EXECUTE ... TO PUBLIC`
--  que PostgreSQL le pone por defecto a toda funcion nueva.
--
--  ── A · CONTRATO PUBLICO REQUERIDO · 8, no se tocan ────────────────────────
--  Las 8 tienen grant explicito y razon funcional comprobada:
--
--    can_access_order(uuid)                 se evalua DENTRO de las policies
--                                           «production orders readable by owner»
--                                           y «production order items readable
--                                           with order», ambas para {anon,
--                                           authenticated}. Una policy corre con
--                                           el rol que consulta: sin este EXECUTE
--                                           se rompe el seguimiento publico.
--    get_public_order_tracking(text)        seguimiento por token, sin sesion.
--    get_public_business_contact(uuid)      vidriera publica.
--    commerce_availability(uuid,text,jsonb) vidriera publica.
--    list_business_combos(uuid)             catalogo publico.
--    resolve_business_combo(uuid,text,int)  carrito publico.
--    scheduler_heartbeat()                  sonda anonima deliberada (20260810150000):
--                                           devuelve un reloj, ningun dato de negocio.
--    check_scheduler_watchdog(text)         idem; mide contra la base y no confia
--                                           en el llamador.
--
--  ── B · SOLO AUTHENTICATED · 5, se le saca anon ────────────────────────────
--  Ninguna tiene linea de grant. Las 5 son RPC del Panel: las llama
--  js/repositories/supabase-fiscal-repository.js con la sesion del operador, y
--  supabase/functions/fiscal-artifact-access reenvia el Authorization del
--  usuario (no service_role). Las 5 ya validan has_business_role() adentro, asi
--  que anon hoy recibe 42501 igual: esto no tapa un agujero abierto, saca un
--  privilegio que nunca hizo falta y de paso cierra dos detalles reales -que un
--  anonimo pueda distinguir «artefacto inexistente» de «no autorizado», y que
--  request_fiscal_artifact_regeneration tome un `for update` sobre
--  fiscal_documents antes de comprobar el rol-.
--
--  No se otorga service_role: las 5 dependen de auth.uid() via has_business_role,
--  que para service_role es null, asi que el permiso seria decorativo.
--
--  ── C · INTERNAS · 5 funciones de trigger, no las ejecuta nadie ────────────
--  Tampoco tienen linea de grant. Cada una esta atada a exactamente 1 trigger y
--  no es invocable: PostgreSQL responde «trigger functions can only be called as
--  triggers» (se probo como anon). El EXECUTE es puro residuo del default. Se
--  revoca sin grant posterior porque el privilegio se controla al CREATE TRIGGER,
--  no cuando el trigger dispara: los triggers siguen funcionando igual.
--
--  ── D · OBSOLETAS · ninguna.  ── E · SIN CONTRATO CLARO · ninguna. ─────────
--
--  Resultado esperado: SECURITY DEFINER ejecutables por anon 18 -> 8, y las 8
--  que quedan tienen una razon escrita, no una herencia.
-- ============================================================================

-- ── B · RPC fiscales del Panel: authenticated y nadie mas ──────────────────
revoke all on function public.authorize_fiscal_artifact_access(uuid, text)
  from public, anon;
grant execute on function public.authorize_fiscal_artifact_access(uuid, text)
  to authenticated;

revoke all on function public.list_fiscal_document_artifacts(uuid)
  from public, anon;
grant execute on function public.list_fiscal_document_artifacts(uuid)
  to authenticated;

revoke all on function public.request_fiscal_artifact_regeneration(uuid)
  from public, anon;
grant execute on function public.request_fiscal_artifact_regeneration(uuid)
  to authenticated;

revoke all on function public.request_fiscal_print_job(uuid, uuid, text, text, integer, text)
  from public, anon;
grant execute on function public.request_fiscal_print_job(uuid, uuid, text, text, integer, text)
  to authenticated;

revoke all on function public.update_fiscal_print_job(uuid, text, text)
  from public, anon;
grant execute on function public.update_fiscal_print_job(uuid, text, text)
  to authenticated;

-- ── C · funciones de trigger: ningun rol de cliente ────────────────────────
revoke all on function public.assert_fiscal_execution_authorized()
  from public, anon, authenticated;
revoke all on function public.assert_order_payment_modality()
  from public, anon, authenticated;
revoke all on function public.enqueue_authorized_fiscal_artifact()
  from public, anon, authenticated;
revoke all on function public.enqueue_new_order_notification()
  from public, anon, authenticated;
revoke all on function public.prevent_unverified_delivery()
  from public, anon, authenticated;
