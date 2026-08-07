-- Los comprobantes fiscales no son para el rider.
--
-- Todas las superficies fiscales leían con public.is_business_member(), que es
-- verdadero para CUALQUIER miembro activo del negocio: owner, admin, staff y
-- también rider. Un repartidor —muchas veces un tercero— podía leer CUIT, CAE,
-- tipo y número de documento del receptor, importes, la huella del certificado y
-- la ruta de storage del PDF fiscal de todos los comprobantes del negocio.
--
-- El bucket 'fiscal-documents' ya era privado y service_role, así que los bytes
-- del PDF nunca estuvieron expuestos; lo que estaba expuesto era todo lo demás.
--
-- La regla vive ahora en una sola función. Agregar un rol nuevo a
-- business_members no vuelve a ensanchar el acceso fiscal por descuido.

create or replace function public.can_read_fiscal_documents(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.has_business_role(target_business_id, array['owner', 'admin', 'staff'])
$$;

comment on function public.can_read_fiscal_documents(uuid) is
  'Lectura de comprobantes fiscales: owner, admin y staff. El rider queda afuera por diseño.';

revoke execute on function public.can_read_fiscal_documents(uuid) from public, anon, authenticated;
grant execute on function public.can_read_fiscal_documents(uuid) to authenticated;

drop policy if exists "business reads fiscal documents" on public.fiscal_documents;
create policy "business reads fiscal documents" on public.fiscal_documents
for select to authenticated using (public.can_read_fiscal_documents(business_id));

drop policy if exists "business reads fiscal items" on public.fiscal_document_items;
create policy "business reads fiscal items" on public.fiscal_document_items
for select to authenticated using (exists (
  select 1 from public.fiscal_documents d
   where d.id = fiscal_document_id and public.can_read_fiscal_documents(d.business_id)
));

drop policy if exists "business reads fiscal events" on public.fiscal_events;
create policy "business reads fiscal events" on public.fiscal_events
for select to authenticated using (exists (
  select 1 from public.fiscal_documents d
   where d.id = fiscal_document_id and public.can_read_fiscal_documents(d.business_id)
));

drop policy if exists "business reads fiscal artifact metadata" on public.fiscal_document_artifacts;
create policy "business reads fiscal artifact metadata" on public.fiscal_document_artifacts
for select to authenticated using (public.can_read_fiscal_documents(business_id));

drop policy if exists "business reads fiscal print audit" on public.fiscal_print_jobs;
create policy "business reads fiscal print audit" on public.fiscal_print_jobs
for select to authenticated using (public.can_read_fiscal_documents(business_id));

drop policy if exists "business reads fiscal credit allocations" on public.fiscal_credit_allocations;
create policy "business reads fiscal credit allocations" on public.fiscal_credit_allocations
for select to authenticated using (public.can_read_fiscal_documents(business_id));

-- El perfil fiscal lleva CUIT, punto de venta, huella del certificado y su
-- vencimiento: es configuración fiscal, no información de reparto.
drop policy if exists "business reads fiscal profiles" on public.fiscal_profiles;
create policy "business reads fiscal profiles" on public.fiscal_profiles
for select to authenticated using (public.can_read_fiscal_documents(business_id));

drop policy if exists "business reads fiscal profile events" on public.fiscal_profile_events;
create policy "business reads fiscal profile events" on public.fiscal_profile_events
for select to authenticated using (public.can_read_fiscal_documents(business_id));

drop policy if exists "business reads fiscal intents" on public.fiscal_emission_intents;
create policy "business reads fiscal intents" on public.fiscal_emission_intents
for select to authenticated using (public.can_read_fiscal_documents(business_id));
