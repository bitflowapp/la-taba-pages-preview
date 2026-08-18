-- TABA2 · La góndola y la base dejan de hablar dos idiomas distintos.
--
-- ## El defecto
--
-- Hay DOS vocabularios de categoría y no coinciden.
--
-- La base acepta doce nombres desde la 20260725070000 —`Promos`, `Gaseosas`,
-- `Aguas`, `Jugos`, `Energéticas`, `Isotónicas`, `Cervezas`,
-- `Vinos y espumantes`, `Gins y vodkas`, `Whisky y destilados`,
-- `Picadas y deli`, `Hielo y extras`—.
--
-- La vitrina, en cambio, trabaja con trece ids que salieron de la autoridad del
-- catálogo (`scripts/taba2-catalog-authority.mjs`, `js/core/catalog-store.js`,
-- `js/core/beverage-home-sections.js`): `gaseosas`, `mixers`, `energizantes`,
-- `cervezas`, `aguas`, `aguas-saborizadas`, `isotonicas`, `fernet`,
-- `aperitivos`, `vinos`, `espumantes`, `destilados`, `hielo`.
--
-- El puente entre los dos es `slugifyCategory()`, que pasa el nombre de la base
-- a un id. Y ahí es donde se rompe: de los doce nombres que la base admite,
-- **sólo cuatro** aterrizan en un id que la vitrina conoce —`Gaseosas`,
-- `Aguas`, `Cervezas` e `Isotónicas`—. Los otros ocho caen en ids huérfanos:
--
--     'Vinos y espumantes'  -> vinos-y-espumantes   <- no existe en la vitrina
--     'Gins y vodkas'       -> gins-y-vodkas        <- no existe
--     'Whisky y destilados' -> whisky-y-destilados  <- no existe
--     'Energéticas'         -> energeticas          <- la vitrina dice energizantes
--     'Hielo y extras'      -> hielo-y-extras       <- la vitrina dice hielo
--
-- Un producto guardado con uno de esos nombres se dibuja igual, pero **fuera de
-- toda sección de la home**, sin chip de filtro, y con el slug crudo de nombre
-- de categoría —«vinos-y-espumantes»— porque
-- `categories.find(c => c.id === categoryId)?.name` no encuentra nada y cae al
-- id. O sea: se publica y no se encuentra.
--
-- Nadie lo vio porque el comercio abrió con cuatro gaseosas, y `Gaseosas` es
-- justo uno de los cuatro nombres que sí coinciden.
--
-- La consecuencia práctica: **hoy no hay forma de publicar un fernet, un vino,
-- un aperitivo, un destilado, un energizante, un mixer ni un agua saborizada
-- en la categoría que le corresponde.** La compuerta que lo impide no es una
-- regla de negocio: es un vocabulario desactualizado.
--
-- ## Lo que cambia
--
-- La base pasa a aceptar TAMBIÉN los trece nombres cuyo slug es exactamente un
-- id de la vitrina. La correspondencia es uno a uno y verificable a ojo:
--
--     Gaseosas            -> gaseosas            Cervezas     -> cervezas
--     Mixers              -> mixers              Fernet       -> fernet
--     Energizantes        -> energizantes        Aperitivos   -> aperitivos
--     Aguas               -> aguas               Vinos        -> vinos
--     Aguas saborizadas   -> aguas-saborizadas   Espumantes   -> espumantes
--     Isotónicas          -> isotonicas          Destilados   -> destilados
--     Hielo               -> hielo
--
-- La coherencia con el alcohol se extiende con el mismo criterio que ya regía:
-- `Cervezas`, `Fernet`, `Aperitivos`, `Vinos`, `Espumantes` y `Destilados`
-- exigen `is_alcoholic = true` y edad mínima entre 18 y 99; las otras siete
-- exigen `is_alcoholic = false` y edad mínima nula. Es la MISMA lista que
-- `ALCOHOLIC_CATEGORY_IDS` del cliente, así que las dos capas clasifican igual.
--
-- ## Lo que NO cambia
--
--   · los doce nombres anteriores **siguen siendo válidos**. Hay filas
--     guardadas, importadores y pruebas que los usan, y esta migración no es
--     una mudanza: es una ampliación. Nada se renombra ni se reescribe;
--   · ninguna fila se toca. No hay `update`, no hay despublicación, no hay
--     reverificación. Un catálogo que hoy pasa el contrato lo sigue pasando;
--   · las compuertas de precio, stock, verificación, imagen y derechos quedan
--     idénticas. Esta migración sólo habla de vocabulario;
--   · `Aguas saborizadas` es la única de las trece que no lleva tilde ni
--     mayúscula intermedia: se escribe así a propósito, porque
--     `slugifyCategory` la tiene que llevar a `aguas-saborizadas` y no a
--     `aguas-saborizadas-` ni a nada distinto.
--
-- Forward-only. No toca 1..109.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Vocabulario canónico: los doce de siempre más los trece de la góndola.
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
      -- Vocabulario de la góndola. Cada uno slugifica a un id de la vitrina.
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
      'Destilados'
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
            -- Sin alcohol: siete de la góndola más los cuatro anteriores.
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
            'Hielo y extras'
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
  'Vocabulario de categoría de un producto verificado: los trece nombres de la góndola —cada uno slugifica a un id que la vitrina conoce— más los doce anteriores, conservados para datos ya guardados.';

comment on constraint products_verified_alcohol_coherence on public.products is
  'La categoría y la bandera de alcohol tienen que decir lo mismo, con la misma partición que ALCOHOLIC_CATEGORY_IDS del cliente. Con alcohol, edad mínima entre 18 y 99; sin alcohol, edad mínima nula.';
