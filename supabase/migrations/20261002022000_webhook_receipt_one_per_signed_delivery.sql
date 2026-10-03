-- TABA · UNA ENTREGA FIRMADA DE MERCADO PAGO DEJA UN SOLO RECIBO Y UN SOLO TRABAJO, DIGA LO QUE DIGA EL CUERPO
--
-- QUÉ ESTABA ROTO (medido el 2026-10-02 sobre las 190 migraciones de la rama)
--
--   La firma de un aviso cubre tres cosas: el recurso (`data.id`), el `x-request-id`
--   y el `ts`. La clave del recibo es otra: entorno, id del evento, tipo y recurso;
--   y el id del evento y el tipo salen del CUERPO, que no está firmado.
--
--   Quien tiene una entrega válida capturada puede repetirla mientras la firma valga
--   (cinco minutos hacia atrás y uno hacia adelante) cambiando el `id` del cuerpo:
--   cada repetición era un recibo nuevo y un trabajo nuevo en la cola. Medido, con
--   conexiones reales: la misma entrega firmada con otros 240 ids dejó 241 recibos y
--   241 trabajos, y 40 repeticiones a la vez, 41 y 41. Con el tipo cambiado a
--   `chargeback` esta función dejó además un trabajo de contracargo sobre el id de
--   un pago (el webhook hoy sólo deja pasar el tipo `payment`; la base no puede
--   depender de eso). El cupo no lo acota: es de 240 por minuto POR DIRECCIÓN (hasta
--   1.440 por dirección mientras vale la firma), y los recibos con firma válida no
--   se podan nunca.
--
--   No mueve dinero: cada trabajo relee el pago en el proveedor y el asiento de un
--   snapshot idéntico no escribe. Lo que hace es crecer dos tablas sin tope, gastar
--   lecturas del proveedor por cada trabajo y demorar los avisos reales, que esperan
--   en la misma cola.
--
-- QUÉ CAMBIA
--
--   `record_mercadopago_webhook_receipt`, un bloque al principio. Una entrega con
--   firma válida cuyo recurso y cuyo `x-request-id` ya están en un recibo válido es
--   esa misma entrega, traiga el id y el tipo que traiga:
--     · no crea otro recibo ni otro trabajo: suma un intento al recibo que ya existe
--       y contesta `duplicate` (con `signed_replay`);
--     · si el trabajo de ese recibo todavía no leyó al proveedor (`pending`,
--       `retry_wait`, `claimed`), no hace nada más: esa lectura está por venir;
--     · si ya leyó (`processing`, `completed`), lo vuelve a poner en la cola para una
--       lectura más y contesta `queued`.
--   Dos repeticiones simultáneas se ordenan con un candado de transacción sobre ese
--   par, así que ninguna de las dos se escapa.
--   El resto de la función es su definición vigente, generada de la definición viva
--   con esa única inserción, contada.
--
--   POR QUÉ RELEE EN VEZ DE DESCARTAR. Descartar a secas exigía suponer que Mercado
--   Pago nunca manda dos avisos DISTINTOS del mismo pago con el mismo `x-request-id`.
--   Eso no está verificado (ningún aviso firmado de un pago real pasó todavía por
--   esta arquitectura), y si fuera falso el segundo aviso —el de un reembolso, por
--   ejemplo— se perdía en silencio. Releyendo no hace falta suponer nada: el cuerpo
--   no está firmado, así que una repetición y un aviso nuevo con la misma firma son
--   indistinguibles, y a los dos les corresponde lo mismo, una lectura del pago.
--
--   LA COTA QUE QUEDA. Por cada entrega firmada: un recibo y un trabajo, siempre.
--   Repetirla sólo consigue que ese único trabajo vuelva a leer, a lo sumo una vez
--   por corrida del worker (el cron corre cada 30 s) y sólo mientras la firma vale:
--   unas doce lecturas en vez de mil cuatrocientas filas.
--
-- QUÉ NO CAMBIA
--
--   · La clave única del recibo y todo lo que hace: la reentrega del mismo aviso (el
--     mismo id, con otro `x-request-id` o con el mismo) sigue siendo `duplicate` y no
--     relee nada; un aviso NUEVO del mismo pago (otro id y otro `x-request-id`)
--     sigue dejando su recibo y su trabajo; un recibo rechazado se sigue promoviendo
--     cuando llega la misma notificación con firma válida.
--   · Los recibos sin firma válida: quien no tiene el secreto no puede ocupar el
--     lugar de una entrega firmada, porque sólo cuentan los recibos válidos.
--   · Un trabajo en `dead_letter` no vuelve solo a la cola por una repetición: eso
--     lo decide una persona (`revive_payment_outbox_job`, con su rastro).
--   · Lo que pasa ANTES de llegar acá: el webhook sigue gastando el cupo de la
--     dirección y leyendo el pago en el proveedor para confirmar de qué comercio es,
--     una vez por entrega. Esa lectura la acota el cupo (240 por minuto por
--     dirección), como hasta ahora; lo que deja de crecer son las filas y la cola.
--   · `mp_record_seller_webhook`, las funciones de la cola, la firma, SECURITY
--     DEFINER, `search_path` y los permisos. No hay índice nuevo: la búsqueda entra
--     por `payment_webhook_receipts_resource_idx`, y un índice único podía hacer
--     fallar la migración sobre filas que ya existieran.
--   · No toca filas.
--
-- ORDEN CON LAS EDGE FUNCTIONS
--
--   No depende del orden: `mercadopago-webhook` no cambia y sigue mandando lo mismo.
--
-- Forward-only. Reversión:
--   docs/migrations/rollback/20261002022000_webhook_receipt_one_per_signed_delivery.rollback.sql

CREATE OR REPLACE FUNCTION public.record_mercadopago_webhook_receipt(p_environment text, p_webhook_event_id text, p_event_type text, p_resource_id text, p_signature_valid boolean, p_request_id text, p_payload_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_receipt public.payment_webhook_receipts%rowtype;
  v_topic text;
  v_job_id uuid;
  v_inserted boolean := false;
begin
  if lower(btrim(coalesce(p_environment, ''))) not in ('test', 'production')
    or nullif(btrim(p_webhook_event_id), '') is null
    or nullif(btrim(p_event_type), '') is null
    or nullif(btrim(p_resource_id), '') is null
    or p_payload_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'receipt de webhook invalido' using errcode = '22023';
  end if;

  -- La firma cubre el recurso, el `x-request-id` y el `ts`; el id del evento y el
  -- tipo salen del cuerpo, que no está firmado. Una entrega válida cuyo recurso y
  -- cuyo `x-request-id` ya están en un recibo válido es esa misma entrega con otro
  -- cuerpo: no deja otro recibo ni otro trabajo. El candado ordena dos repeticiones
  -- simultáneas; sin él las dos podían no verse entre sí. Sólo cuentan los recibos
  -- válidos: quien no tiene el secreto no puede ocupar este lugar.
  if p_signature_valid and nullif(btrim(coalesce(p_request_id, '')), '') is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'taba:mercadopago:signed-delivery:' || lower(btrim(p_environment)) || chr(31)
        || left(btrim(p_resource_id), 200) || chr(31) || left(btrim(p_request_id), 200), 0));
    select * into v_receipt
      from public.payment_webhook_receipts r
     where r.provider = 'mercadopago'
       and r.environment = lower(btrim(p_environment))
       and r.resource_id = left(btrim(p_resource_id), 200)
       and r.request_id = left(btrim(p_request_id), 200)
       and r.signature_valid
       and (r.webhook_event_id <> left(btrim(p_webhook_event_id), 200)
         or r.event_type <> left(lower(btrim(p_event_type)), 120))
     order by r.received_at, r.id
     limit 1;
    if found then
      -- El cuerpo no está firmado: esto puede ser una repetición o un aviso nuevo
      -- que el proveedor mandó con la misma firma, y no hay cómo distinguirlos. A
      -- los dos les corresponde lo mismo, una lectura del pago. Si el trabajo
      -- todavía no leyó, esa lectura está por venir; si ya leyó, vuelve a la cola.
      -- Uno en `dead_letter` no: eso lo decide una persona. Primero el trabajo y
      -- después el recibo, el mismo orden de candados que el worker.
      update public.payment_outbox
         set status = 'pending', owner = null, lease_expires_at = null,
             next_attempt_at = clock_timestamp(), attempts = 0, completed_at = null
       where webhook_receipt_id = v_receipt.id
         and status in ('processing', 'completed')
      returning id into v_job_id;
      update public.payment_webhook_receipts
         set attempt_count = attempt_count + 1,
             processing_status = case when v_job_id is not null then 'queued' else processing_status end,
             processed_at = case when v_job_id is not null then null else processed_at end
       where id = v_receipt.id;
      return jsonb_build_object(
        'receipt_id', v_receipt.id,
        'duplicate', true,
        'queued', v_job_id is not null,
        'signature_valid', true,
        'signed_replay', true
      );
    end if;
  end if;

  insert into public.payment_webhook_receipts (
    environment, webhook_event_id, event_type, resource_id, signature_valid,
    request_id, payload_hash, processing_status
  ) values (
    lower(btrim(p_environment)), left(btrim(p_webhook_event_id), 200),
    left(lower(btrim(p_event_type)), 120), left(btrim(p_resource_id), 200),
    p_signature_valid, nullif(left(btrim(coalesce(p_request_id, '')), 200), ''), p_payload_hash,
    case when p_signature_valid then 'received' else 'rejected_signature' end
  ) on conflict (provider, environment, webhook_event_id, event_type, resource_id) do nothing
  returning * into v_receipt;
  v_inserted := found;

  if not v_inserted then
    select * into v_receipt
      from public.payment_webhook_receipts r
     where r.provider = 'mercadopago'
       and r.environment = lower(btrim(p_environment))
       and r.webhook_event_id = left(btrim(p_webhook_event_id), 200)
       and r.event_type = left(lower(btrim(p_event_type)), 120)
       and r.resource_id = left(btrim(p_resource_id), 200)
     for update;
    if not found then raise exception 'receipt de webhook no disponible'; end if;

    if v_receipt.signature_valid or not p_signature_valid then
      update public.payment_webhook_receipts
         set attempt_count = attempt_count + 1
       where id = v_receipt.id;
      return jsonb_build_object(
        'receipt_id', v_receipt.id,
        'duplicate', true,
        'queued', false,
        'signature_valid', v_receipt.signature_valid
      );
    end if;

    update public.payment_webhook_receipts
       set signature_valid = true,
           request_id = nullif(left(btrim(coalesce(p_request_id, '')), 200), ''),
           payload_hash = p_payload_hash,
           processing_status = 'received',
           attempt_count = attempt_count + 1
     where id = v_receipt.id
     returning * into v_receipt;
  end if;

  if not p_signature_valid then
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', false, 'queued', false);
  end if;

  v_topic := case
    when lower(p_event_type) like '%chargeback%' then 'chargeback'
    when lower(p_event_type) like '%claim%' then 'claim'
    when lower(p_event_type) like '%payment%' then 'payment'
    else null
  end;
  if v_topic is null then
    update public.payment_webhook_receipts
       set processing_status = 'completed', processed_at = clock_timestamp()
     where id = v_receipt.id;
    return jsonb_build_object('receipt_id', v_receipt.id, 'duplicate', not v_inserted, 'queued', false);
  end if;

  insert into public.payment_outbox (webhook_receipt_id, topic, resource_id)
  values (v_receipt.id, v_topic, left(btrim(p_resource_id), 200))
  on conflict (webhook_receipt_id) where webhook_receipt_id is not null do nothing
  returning id into v_job_id;
  update public.payment_webhook_receipts set processing_status = 'queued' where id = v_receipt.id;
  return jsonb_build_object(
    'receipt_id', v_receipt.id,
    'duplicate', not v_inserted,
    'queued', v_job_id is not null,
    'promoted', not v_inserted
  );
end;
$function$;

revoke all on function public.record_mercadopago_webhook_receipt(text, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.record_mercadopago_webhook_receipt(text, text, text, text, boolean, text, text) to service_role;
