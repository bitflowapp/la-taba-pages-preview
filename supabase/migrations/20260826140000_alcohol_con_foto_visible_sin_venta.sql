-- El alcohol con fotografía se puede MIRAR sin poder comprarse.
--
-- EL PROBLEMA, MEDIDO CONTRA PRODUCCIÓN EL 2026-08-26
-- ---------------------------------------------------
-- La única política pública de lectura sobre `products` es
-- «production verified products are public», y exige, entre otras cosas:
--
--     is_active AND is_verified AND available AND stock > 0
--
-- Es decir: la tabla acopla «se puede ver» a «se puede comprar». Mientras esas
-- dos frases quisieron decir lo mismo, la política estuvo bien. Dejaron de
-- querer decir lo mismo el día que el comercio cargó veintisiete bebidas
-- alcohólicas con precio confirmado y `available = false`, a la espera de la
-- habilitación de expendio: doce de ellas ya tienen packshot real y NADIE puede
-- verlas, ni el dueño desde su propio teléfono.
--
-- Medido con la clave publicable, sin ningún filtro del cliente: la consulta
-- devuelve 33 filas y ninguna alcohólica. No es la tienda la que las esconde;
-- es RLS.
--
-- QUÉ HACE ESTA MIGRACIÓN
-- -----------------------
-- Agrega UNA política de SELECT, aditiva, que expone exactamente el caso que
-- hoy no se ve y ningún otro:
--
--     alcohólico · activo · verificado · NO disponible · con fotografía real
--
-- Las políticas de RLS se combinan con OR, así que esto no relaja la política
-- existente: la deja intacta y suma un segundo camino, más angosto.
--
-- POR QUÉ ESTO NO HABILITA UNA VENTA
-- ----------------------------------
-- Porque `available` sigue en false, y de ahí cuelga todo lo demás:
--
--   · `products_available_requires_verification` impide por CHECK que un
--     producto sea `available` sin stock, sin precio confirmado y sin
--     verificación. Esta política no escribe nada: no puede volver comprable a
--     nadie.
--   · En el cliente, `isPurchasableBeverageProduct` exige `available === true`.
--     Un producto visible y no disponible ya existía como concepto —es el que
--     tiene el precio pendiente— y la góndola sabe dibujarlo: tarjeta con foto,
--     botón inhabilitado y su aviso.
--   · Y sobre todo: `create_order` valida la política de alcohol COMPLETA al
--     cobrar y hoy la rechaza con «politica de alcohol no configurada», porque
--     `alcohol_sales_enabled` está en false y la edad mínima, la ventana
--     horaria y el huso están en null. Aunque alguien fabricara el pedido a
--     mano contra la API, el servidor no lo crea.
--
-- La condición `not available` es deliberada y no es cosmética: si mañana el
-- comercio habilita la venta, estas filas dejan de entrar por acá y pasan a
-- entrar por la política de siempre, que es la que corresponde a un producto a
-- la venta. La política nueva se apaga sola.
--
-- POR QUÉ SE EXIGE FOTOGRAFÍA
-- ---------------------------
-- Porque el objetivo es una vidriera presentable, no un listado. Quince de los
-- veintisiete alcohólicos todavía no tienen packshot exacto —y varios no lo van
-- a tener hasta que se resuelva si el formato sigue existiendo—. Mostrarlos con
-- el respaldo dibujado sería publicar un catálogo a medias. Cuando cada uno
-- consiga su fotografía, entra solo: la condición es sobre el dato, no una
-- lista escrita a mano.
--
-- LO QUE NO CAMBIA
-- ----------------
--   · Ningún grant, ninguna columna nueva, ninguna fila escrita.
--   · `alcohol_sales_enabled` sigue donde estaba.
--   · Los 45 productos no alcohólicos no tocan esta política.
--   · Los 15 alcohólicos sin fotografía siguen invisibles.
--
-- REVERSIÓN
-- ---------
--     drop policy if exists "alcohol verificado con foto se puede mirar"
--       on public.products;
--
-- No hay dato que restaurar.

drop policy if exists "alcohol verificado con foto se puede mirar" on public.products;

create policy "alcohol verificado con foto se puede mirar"
  on public.products
  for select
  to anon, authenticated
  using (
    is_active
    and is_verified
    and is_alcoholic is true
    and available is false
    and image_url is not null
    and catalog_asset_id is not null
    and exists (
      select 1
      from public.businesses b
      where b.id = products.business_id
        and b.is_active
        and b.status = 'open'
        and b.ordering_verified
        and b.ordering_enabled
    )
  );

comment on policy "alcohol verificado con foto se puede mirar" on public.products is
  'Vidriera: deja MIRAR el alcohol verificado que ya tiene packshot real y todavía no está a la venta. No habilita comprarlo: available sigue en false, el CHECK products_available_requires_verification impide que deje de estarlo sin stock ni precio confirmado, y create_order rechaza cualquier pedido con alcohol mientras la política del comercio esté incompleta.';
