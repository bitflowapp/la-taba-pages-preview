-- La Taba - seed local seguro para Supabase CLI
-- No depende de auth.users y no contiene datos sensibles.

insert into public.businesses (
  id,
  slug,
  name,
  address,
  phone,
  whatsapp_phone,
  is_active
) values (
  '00000000-0000-4000-8000-000000000001',
  'la-taba',
  'La Taba',
  'Mendoza 851, Centro',
  null,
  null,
  true
)
on conflict (id) do update
set slug = excluded.slug,
    name = excluded.name,
    address = excluded.address,
    phone = excluded.phone,
    whatsapp_phone = excluded.whatsapp_phone,
    is_active = excluded.is_active,
    updated_at = now();

insert into public.products (
  id,
  business_id,
  name,
  description,
  category,
  price,
  image_url,
  is_active,
  sort_order
) values
  (
    '10000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    'Vacio especial',
    'Corte principal para pedido demo.',
    'Carnes',
    9800.00,
    'assets/products/cortes-crudos.webp',
    true,
    10
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000001',
    'Milanesas',
    'Producto familiar para checkout demo.',
    'Preparados',
    6400.00,
    'assets/products/milanesas.webp',
    true,
    20
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
    'Chorizos parrilleros',
    'Producto de parrilla para pedido demo.',
    'Parrilla',
    4200.00,
    'assets/products/chorizos-parrilla.webp',
    true,
    30
  )
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    price = excluded.price,
    image_url = excluded.image_url,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order,
    updated_at = now();
