-- ============================================================================
--  Procedencia del punto de retiro
-- ============================================================================
--
--  POR QUÉ
--  -------
--  El contrato del mapa aceptaba exactamente dos orígenes para el punto del
--  negocio: `business_verified` y `qa_fixture`. Entre «una persona lo confirmó
--  contra la puerta» y «es un valor de prueba» no había nada, y la realidad de
--  esta rama cayó justo en el medio: un punto de un directorio público,
--  contrastado con dos fuentes independientes, que NO es un fixture de QA y
--  tampoco es una verificación del comercio.
--
--  Sin un tercer valor sólo quedaban dos salidas malas: seguir operando con un
--  `qa_fixture` que está a ~900 m del local, o mentir declarando verificado algo
--  que nadie verificó. Este archivo abre el tercer casillero y lo obliga a
--  decir lo que es.
--
--  LA REGLA QUE IMPORTA
--  --------------------
--  `human_verified` sólo puede ser verdadero si el origen es
--  `business_verified`. Es una restricción de base, no una convención: ninguna
--  ruta de escritura puede afirmar una verificación humana sobre un punto que
--  no la tiene.
--
--  LAS DOS RESTRICCIONES
--  ---------------------
--  Hay que extender las DOS. `rider_map_capture_order_location_snapshot` copia
--  el origen del negocio a la instantánea del pedido en el alta; si la
--  instantánea no aceptara el valor nuevo, el trigger abortaría y **ningún
--  pedido podría crearse**. Medido: `business_source` tiene su propio CHECK.
--
--  VERIFICACIÓN POR PRESENCIA
--  --------------------------
--  Se agregan las columnas para el chequeo que ocurre cuando el Rider confirma
--  el retiro parado en el local: se compara su GPS fresco contra el punto y se
--  registra el resultado. Un desvío grande NO pisa el punto: queda anotado como
--  discrepancia para que lo mire una persona. Sobrescribir en silencio un punto
--  operativo con una sola lectura de GPS sería cambiar un dato contrastado por
--  una muestra de una antena.
-- ============================================================================

alter table private.rider_map_business_locations
  drop constraint if exists rider_map_business_locations_source_check;

alter table private.rider_map_business_locations
  add constraint rider_map_business_locations_source_check
  check (source in ('business_verified', 'public_directory_cross_checked', 'qa_fixture'));

alter table private.rider_map_business_locations
  add column if not exists confidence text,
  add column if not exists human_verified boolean not null default false,
  add column if not exists source_note text,
  add column if not exists verified_by_rider_presence boolean not null default false,
  add column if not exists presence_checked_at timestamptz,
  add column if not exists presence_distance_m numeric(10, 2),
  add column if not exists presence_accuracy_m numeric(10, 2),
  add column if not exists presence_status text;

alter table private.rider_map_business_locations
  drop constraint if exists rider_map_business_locations_confidence_check;
alter table private.rider_map_business_locations
  add constraint rider_map_business_locations_confidence_check
  check (confidence is null or confidence in ('low', 'medium', 'high'));

-- La regla: una verificación humana exige un origen verificado por el negocio.
alter table private.rider_map_business_locations
  drop constraint if exists rider_map_business_locations_human_verified_check;
alter table private.rider_map_business_locations
  add constraint rider_map_business_locations_human_verified_check
  check (human_verified = false or source = 'business_verified');

alter table private.rider_map_business_locations
  drop constraint if exists rider_map_business_locations_presence_check;
alter table private.rider_map_business_locations
  add constraint rider_map_business_locations_presence_check
  check (
    (presence_status is null and verified_by_rider_presence = false)
    or (
      presence_status in ('confirmed', 'discrepancy')
      and presence_checked_at is not null
      and presence_distance_m is not null
      and presence_distance_m >= 0
      and (verified_by_rider_presence = false or presence_status = 'confirmed')
    )
  );

-- La instantánea del pedido tiene que aceptar el mismo vocabulario o el trigger
-- del alta aborta y no se puede crear ningún pedido.
alter table private.rider_map_order_location_snapshots
  drop constraint if exists rider_map_order_location_source_check;

alter table private.rider_map_order_location_snapshots
  add constraint rider_map_order_location_source_check
  check (
    business_source is null
    or business_source in ('business_verified', 'public_directory_cross_checked', 'qa_fixture')
  );

comment on column private.rider_map_business_locations.source is
  'Procedencia del punto: business_verified (una persona lo confirmó contra la puerta), public_directory_cross_checked (directorio público contrastado) o qa_fixture (valor de prueba).';
comment on column private.rider_map_business_locations.human_verified is
  'Sólo puede ser verdadero con source=business_verified. Lo impone un CHECK.';
comment on column private.rider_map_business_locations.presence_status is
  'Resultado del chequeo contra el GPS del Rider parado en el local: confirmed o discrepancy. Una discrepancia NO pisa el punto.';
