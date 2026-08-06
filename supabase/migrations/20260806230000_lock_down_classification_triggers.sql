-- Cierra el execute de las funciones de trigger de clasificación.
--
-- `classify_order_qa_origin` y `classify_checkout_session_qa_origin` se
-- crearon en 20260806160000/20260806200000 como `security definer` sin revocar
-- el execute por defecto, que en PostgreSQL es PUBLIC. Invocarlas fuera de un
-- trigger falla igual — no hay fila NEW —, así que el riesgo práctico es nulo,
-- pero el resto del backend no deja ninguna función `security definer` abierta
-- y esta no tiene por qué ser la excepción.

revoke all on function public.classify_order_qa_origin() from public, anon, authenticated;
revoke all on function public.classify_checkout_session_qa_origin() from public, anon, authenticated;

comment on function public.classify_checkout_session_qa_origin() is
  'Marca el checkout como QA cuando entra un producto fixture de prueba.';
