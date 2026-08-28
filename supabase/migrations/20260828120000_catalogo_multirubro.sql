-- TABA 24/7 · La base deja de aceptar solamente bebida.
--
-- ## EL DEFECTO
--
-- `products_verified_canonical_beverage_category` es un vocabulario CERRADO de
-- veinticinco nombres, y los veinticinco son bebida o accesorio de bebida:
-- gaseosas, aguas, cervezas, fernet, vinos, destilados, hielo, picadas.
--
-- La consecuencia práctica: **hoy no se puede publicar una lavandina.** Ni un
-- shampoo, ni un paquete de galletitas, ni un alimento para perro. No porque
-- falte una decisión comercial ni una habilitación: porque la fila muere con
--
--     23514 · new row for relation "products" violates check constraint
--             "products_verified_canonical_beverage_category"
--
-- en cuanto el producto se verifica. Un comercio que quiere abrir el rubro
-- limpieza tiene que desplegar una migración para nombrar la categoría, que es
-- exactamente lo que este archivo viene a hacer por última vez para los ocho
-- rubros del encargo.
--
-- ## LO QUE CAMBIA
--
-- El vocabulario acepta TAMBIÉN los ocho nombres del resto de la tienda. La
-- correspondencia con el id de la vitrina es uno a uno y verificable a ojo,
-- porque cada nombre slugifica exactamente a su id —el cliente guarda el nombre
-- y lo slugifica al leerlo—:
--
--     Snacks            -> snacks              Limpieza  -> limpieza
--     Golosinas         -> golosinas           Hogar     -> hogar
--     Almacén           -> almacen             Mascotas  -> mascotas
--     Higiene personal  -> higiene-personal    Otros     -> otros
--
-- Los ocho son SIN ALCOHOL en `products_verified_alcohol_coherence`, con la
-- misma partición que ya regía: sin alcohol exige `is_alcoholic = false` y edad
-- mínima nula.
--
-- La lista de estos ocho nombres es la misma que declara
-- `js/core/store-taxonomy.js`, y `tests/store-taxonomy.test.mjs` cruza los dos
-- archivos nombre por nombre: si mañana alguien suma un rubro en el cliente y no
-- acá, el test falla antes de que un producto muera contra el CHECK. Es el mismo
-- desfase que la 20260818040000 documentó y arregló a mano.
--
-- ## LO QUE NO CAMBIA
--
--   · **el alcohol.** Las seis categorías con alcohol siguen exigiendo
--     `is_alcoholic = true` y edad entre 18 y 99, y ninguno de los ocho rubros
--     nuevos puede llevar alcohol. Este archivo NO toca `alcohol_sales_enabled`,
--     ni la ventana horaria, ni la edad mínima del comercio: la compuerta de
--     alcohol es independiente de la góndola y de este vocabulario;
--   · **los veinticinco nombres anteriores siguen siendo válidos.** Hay filas
--     guardadas, importadores y pruebas que los usan. Esto es una ampliación, no
--     una mudanza: nada se renombra ni se reescribe;
--   · **ninguna fila se toca.** No hay `update`, no hay despublicación, no hay
--     reverificación. Un catálogo que hoy pasa el contrato lo sigue pasando;
--   · **las compuertas de precio, stock, verificación, imagen y derechos quedan
--     idénticas.** Esta migración sólo habla de vocabulario. Un producto de
--     limpieza sin precio sigue sin poder venderse, igual que una gaseosa;
--   · **el nombre de las dos restricciones.** Dice «beverage» y ya no es cierto,
--     pero lo referencian otras migraciones, dos scripts de plan y el ensayo
--     pgTAP. Renombrar no agrega una garantía y sí rompe referencias; el
--     comentario, que es lo que una persona lee, sí se corrige.
--
-- ## REVERSIÓN
--
-- Volver a declarar las dos restricciones sin los ocho nombres. Sólo es posible
-- mientras ninguna fila verificada los use; si alguna los usa, revertir sería
-- romperla, y la reversión honesta es despublicar ese rubro primero.
--
-- Forward-only. No toca 1..115.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Vocabulario canónico: bebida, vocabulario anterior, y el resto de la tienda.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.products
  drop constraint if exists products_verified_canonical_beverage_category;
alter table public.products
  add constraint products_verified_canonical_beverage_category check (
    not is_verified
    or category in (
      -- Vocabulario anterior, conservado para datos ya guardados.
      'Promos',
      'Jugos',
      'Energéticas',
      'Vinos y espumantes',
      'Gins y vodkas',
      'Whisky y destilados',
      'Picadas y deli',
      'Hielo y extras',
      -- Bebida. Cada uno slugifica a un id de la vitrina.
      'Gaseosas',
      'Mixers',
      'Energizantes',
      'Aguas',
      'Aguas saborizadas',
      'Isotónicas',
      'Hielo',
      'Cervezas',
      'Fernet',
      'Aperitivos',
      'Vinos',
      'Espumantes',
      'Destilados',
      -- El resto de la tienda 24/7. Mismo criterio: cada nombre slugifica a su id.
      'Snacks',
      'Golosinas',
      'Almacén',
      'Limpieza',
      'Higiene personal',
      'Hogar',
      'Mascotas',
      'Otros'
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Coherencia de alcohol, con la misma partición que usa el cliente.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.products
  drop constraint if exists products_verified_alcohol_coherence;
alter table public.products
  add constraint products_verified_alcohol_coherence check (
    not is_verified
    or (
      (
        (
          category in (
            -- Con alcohol: seis de la góndola más los tres nombres anteriores.
            'Cervezas',
            'Fernet',
            'Aperitivos',
            'Vinos',
            'Espumantes',
            'Destilados',
            'Vinos y espumantes',
            'Gins y vodkas',
            'Whisky y destilados'
          )
          and is_alcoholic is true
        )
        or (
          category in (
            -- Sin alcohol: la bebida que no lleva, los cuatro nombres anteriores
            -- y los ocho rubros del resto de la tienda. Que TABA abra 24 horas
            -- no convierte a ninguno de estos en un producto con edad mínima.
            'Gaseosas',
            'Mixers',
            'Energizantes',
            'Aguas',
            'Aguas saborizadas',
            'Isotónicas',
            'Hielo',
            'Jugos',
            'Energéticas',
            'Picadas y deli',
            'Hielo y extras',
            'Snacks',
            'Golosinas',
            'Almacén',
            'Limpieza',
            'Higiene personal',
            'Hogar',
            'Mascotas',
            'Otros'
          )
          and is_alcoholic is false
        )
        -- Una promoción puede contener alcohol. Su bandera explícita decide si
        -- corren la edad y la política de alcohol del comercio.
        or (category = 'Promos' and is_alcoholic is not null)
      )
      and (
        (
          is_alcoholic is true
          and minimum_age is not null
          and minimum_age between 18 and 99
        )
        or (is_alcoholic is false and minimum_age is null)
      )
    )
  );

comment on constraint products_verified_canonical_beverage_category on public.products is
  'Vocabulario de categoría de un producto verificado: la bebida de la góndola, los ocho rubros del resto de la tienda 24/7 y el vocabulario anterior, conservado para datos ya guardados. Cada nombre slugifica a un id que la vitrina conoce. El nombre de la restricción dice «beverage» por compatibilidad con lo que ya la referencia.';

comment on constraint products_verified_alcohol_coherence on public.products is
  'La categoría y la bandera de alcohol tienen que decir lo mismo, con la misma partición que ALCOHOLIC_CATEGORY_IDS del cliente. Con alcohol, edad mínima entre 18 y 99; sin alcohol, edad mínima nula. Ningún rubro no-bebida puede llevar alcohol.';
