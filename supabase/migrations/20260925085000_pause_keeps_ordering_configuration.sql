-- PAUSAR Y CERRAR NO PUEDEN FALLAR CON LOS PEDIDOS ONLINE HABILITADOS
--
-- `businesses_ordering_enabled_requires_verification` (20260725030000) exigía
-- `status = 'open'` para tener `ordering_enabled`. Pero el Panel pausa y cierra
-- con `set_business_open_state`, que cambia sólo `status`: con los pedidos
-- online habilitados, «Pausar pedidos» y «Cerrar» chocaban con el CHECK
-- (23514) y el comercio no podía dejar de recibir pedidos desde el Panel. Es el
-- primer paso de PAUSE ALL SYSTEM en el runbook de producción controlada.
--
-- `ordering_enabled` es configuración (el comercio vende online); `status` es el
-- estado del día. Quien decide si se puede pedir AHORA ya exige las dos cosas:
-- create_order y el checkout piden `status = 'open'` y `ordering_enabled`
-- (20260812220000), commerce_availability también, y las políticas públicas de
-- products piden `status = 'open'`. El CHECK conserva lo que sí es invariante:
-- no hay pedidos online sin verificación ni en un negocio inactivo.
--
-- Forward-only; no cambia filas. REVERSIÓN: volver a agregar `and status = 'open'`
-- al CHECK (fallaría si hay negocios pausados o cerrados con ordering_enabled).

alter table public.businesses drop constraint if exists businesses_ordering_enabled_requires_verification;
alter table public.businesses add constraint businesses_ordering_enabled_requires_verification check (
  not ordering_enabled
  or (
    ordering_verified
    and is_active
  )
);
