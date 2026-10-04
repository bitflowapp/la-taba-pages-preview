-- TABA · LA FRONTERA DE LA API CONTESTA UNA NEGATIVA DE NEGOCIO CON 409 Y UN «NO EXISTE» CON 404
--
-- QUÉ ESTABA ROTO (certificador e-commerce contra un PostgREST 14.5 real; hallazgo API-01 y defecto C-2)
--
--   PostgREST traduce el SQLSTATE a un estado HTTP con una tabla fija. La base usa 55000 para «esto no se
--   puede hacer en el estado en que están las cosas» (comercio cerrado, fuera de zona, producto no
--   disponible, pedido ya cerrado, exigencia bloqueada...) y P0002 para «no existe». PostgREST contesta
--   HTTP 500 a los dos (clase 55 y clase P0 salvo P0001): una negativa normal parecía una caída, los
--   clientes que deciden por el estado la reintentaban y el monitoreo de 5xx era ruido.
--
-- QUÉ CAMBIA
--
--   109 funciones de entrada (las elige scripts/db/wrap-api-boundary.mjs con la regla escrita en
--   docs/ecommerce-hardening/http-contract.md) llevan su cuerpo, letra por letra, como bloque anidado dentro
--   de un bloque con UN manejador para 55000 y P0002 (marcador «la-taba:api-boundary v1»). El manejador convierte
--   SÓLO si la llamada entra por la API (request.method) y la función es el marco PL/pgSQL más externo:
--   raise sqlstate 'PGRST' con el MISMO cuerpo (code, message, details, hint) y el estado 409 (55000) o
--   404 (P0002). En cualquier otro caso re-lanza el error original sin tocarlo.
--
-- QUÉ NO CAMBIA
--
--   · Lo que hace cada función: el cuerpo es el vigente, generado de la definición viva.
--   · El cuerpo de la respuesta: el mismo code, message, details y hint. Sólo cambia el estado HTTP.
--   · Llamadas sin request.method (pgTAP, cron, arneses, migraciones): el SQLSTATE original, como antes.
--   · Una función PL/pgSQL que llama a otra y atrapa 55000 o P0002 los sigue atrapando (la de adentro no es
--     el marco más externo y re-lanza el original).
--   · Firma, tipo de retorno, lenguaje, SECURITY, volatilidad, STRICT, search_path y demás SET, dueño,
--     permisos y comentario: CREATE OR REPLACE con el encabezado que imprime pg_get_functiondef; no se
--     reescribe ningún permiso.
--   · Quedan afuera, por dueño, 40 entradas de otras líneas (Caja/POS, fiscal, agente de impresión y los seis
--     cobros heredados que retira el contrato A1-A4): siguen contestando 500 para estos códigos. Ver
--     docs/ecommerce-hardening/http-contract.json.
--
-- Se niega a correr si alguna función ya no tiene el cuerpo del que se generó (ni el envuelto): otra
-- migración la redefinió y esta la pisaría; regenerar con el script.
--
-- Costo: una subtransacción por llamada a una función envuelta (ninguna se usa por fila en una política o
-- una vista; ver el informe del generador).
--
-- Forward-only. No toca filas. Reversión: docs/migrations/rollback/20261002090000_api_boundary_answers_refusals_as_4xx.rollback.sql

do $guard$
declare
  v_row record;
  v_actual text;
begin
  for v_row in
    select * from (values
      ('public.accept_rider_order_offer(uuid,bigint,text)', '697ddef8d84ebca7f7bd202f69cadfb1', '05a9da5e2b506cf0343bf823bd7e71fb'),
      ('public.acknowledge_order(uuid,bigint,text)', '1a3bb556f44d2fc398478e20fe6519af', 'e162cc33b8e20f5fa141c42a223c19cb'),
      ('public.apply_commercial_catalog_batch(uuid,jsonb)', '5913a2c958e60e41b7f6beebb2b7a6fb', '6adbd0e78ab73e9721381b778f107381'),
      ('public.apply_commercial_catalog_plan(uuid,jsonb,jsonb)', 'f6877552434671acf796bde2de848d8a', '8024e544469a597f8fc3260adc774986'),
      ('public.apply_inventory_movement(uuid,uuid,uuid,text,integer,integer,text,uuid,text,text)', 'ec7df9aef9bc61b73ca1c78f72e386d6', '11bcf111ab4cbf55097ef9f77c5ecaa7'),
      ('public.approve_catalog_image_upload(uuid,uuid,text,text)', '172eb990b85ad09f3bfa94b0598d5664', '6de231133a42ccaf7ab8aee478f5674d'),
      ('public.assign_order_rider(uuid,text,uuid,uuid)', '2834dc5510c971541b026a86fcde6764', 'd3ad3806f728fd9a17d8280ac6af61e2'),
      ('public.cancel_order(uuid,bigint,text,text)', '78d5d6b6fb66947e5458d00849e9e05e', 'e1f6e5abdcadadf9e50cca1f0115d5e8'),
      ('public.cancel_own_order(uuid,text,text)', '7e97241ddb55f8a47f00b8732bdc239a', 'f86b792f815c48f96c4d8a36a14dc4d2'),
      ('public.claim_delivery_order(uuid,text,bigint,text)', '3b35e48c20ee763581df86b627aea22f', '43bd9ee3aaa35aa4469a397b6a115e04'),
      ('public.claim_payment_outbox_v2(text,integer,integer)', '96606fefdf740668703af5545f11357d', '63393330988bb6544123874b04d67b80'),
      ('public.classify_order_as_qa(uuid,text)', 'e82fb92bb83302fe520b696e42df5307', '91a303bb174f67bd1b458f1f1c2f7ceb'),
      ('public.close_expired_qa_windows()', '935a84ddc76e8100f533d431e0d373ea', '71bb35ae7d5c373e048ba30a12938134'),
      ('public.close_qa_window(uuid)', '16a130da6f92d17aaa7c5580050266d8', '15bf2ab3d67f0862f32103ebf7ca3fe3'),
      ('public.complete_catalog_image_upload(uuid,uuid,text,text,text,bigint,bigint,bigint)', '8be9b9d0ba93941b2b2a021580ae03e5', 'ab412a20ac32e4a6113eeec186b4bf95'),
      ('public.complete_delivery_without_code(uuid,bigint,text,text,text)', '250de1937ebfb24a2cf5fb079dae7c66', 'e0f03e008fa8c0611f1d8bf8684cf0bc'),
      ('public.complete_payment_outbox_job(uuid,text)', 'b1053d6c5b29cc1ecf7982fe96dd26db', '39d7f4bf7fdc21f99792dfb241c6f454'),
      ('public.complete_scanned_product(uuid,jsonb)', '18c30c2c65dba7b4fb13115b00f1bcc3', 'e8add2632c2ecff4ace4cf9a20f161d5'),
      ('public.configure_mercadopago_settings(uuid,jsonb)', 'dcb9546e29bafd7fbabab5035575a8fd', '462101276a806ff629ed72dcbeb55d48'),
      ('public.confirm_business_delivery_code(uuid,bigint,text,text)', '8d7b069a989f111cd2d926a6d9a0df45', 'b17430b9419c558f631f01e25e349118'),
      ('public.confirm_delivery_code(uuid,bigint,text,text)', 'ef51162ada2ca1a428a696954fd7f9dc', 'e0fac51ea3b7a9ce9aad106caadba995'),
      ('public.confirm_manual_order_payment(uuid,bigint,text,text)', '5ef7699c0847ed2442e5d7d75e17957b', '7d3773d113e76af80fa623304b753674'),
      ('public.confirm_packing_session_once(uuid,text,text)', 'e1167d3bdf867dce934a3f9e17027dfe', '3e62cc26c7927377dcc85f1973735d32'),
      ('public.create_checkout_session_reserving(uuid,jsonb)', '82c1fbee033992238ee608232373859a', '61af7e6f8db7f4b03efe03545768049d'),
      ('public.create_checkout_session(uuid,jsonb)', '393d9c9bb3ee85f19ce0c87796048aca', 'e96ffb07337693949db7fa44ec8e4e9f'),
      ('public.create_order_with_items_confirmed_location(jsonb)', 'ff1f667843f24717f18f273b4b1ec570', '8bdd77b70de94661901b952d60e9e5b6'),
      ('public.create_order_with_items(jsonb)', '29ff31f85a2ae7b9d66dfdef2b9a0951', '73ceacf443e1b8c5776095ad46e81af3'),
      ('public.delete_business_service_exception(uuid,uuid)', 'aa2b995955bcf6b9db1a78f48ff610df', '33bfadced91360d838759539ad6278ac'),
      ('public.delete_delivery_zone(uuid,uuid)', '082710d63af10d529bcd23b0d78320dc', 'f7dc652b31ff21acce3983bb9db3292e'),
      ('public.dispatch_payment_outbox_worker(text)', 'a2526eaff08371fca25e776ee17b896d', 'dc943734cf2d93b07cebb98a3445ffb6'),
      ('public.enqueue_checkout_provider_probes(integer)', '7f7c7c918a74ff675a250e688cd2367f', '24eb443ab5e712f436f17a4d67803686'),
      ('public.enqueue_payment_reconciliation(uuid)', 'edcd50d3fe34378cd2e8fadecb11a6a8', '1342ccf4d78739fc78cb5f98e2e1b355'),
      ('public.expire_unattended_manual_orders(integer)', '5d7ae402392d37ef23e9594a5246ea9a', '05be53fe26811b377b809d92236d6c76'),
      ('public.fail_payment_outbox_job(uuid,text,text)', '712cf0cd7924db9bd0a98f4b56d54ec6', '61f8db2f6813675e86d1eae37e232547'),
      ('public.finalize_paid_checkout_session(uuid)', '39479da4bf1003386dbd1d27c8c1a71c', 'cbd73875ad923e9996ac16115a199291'),
      ('public.find_payment_intent_by_external_reference(text,text)', 'f02af4e8d8455ac57ee2e56bf0e1fcc9', 'eef1e4f15617aa4ed98d169b18d60e73'),
      ('public.get_business_finished_today(uuid,text)', '3a4147a2b861cd99e3f25ffd5b8358db', '48a3d08d52e98baec29ff2d9493902b5'),
      ('public.get_business_opening_status(uuid)', '312fa8ba9c0551ded81d81fb28eacba3', '582b2e26e7632bd0ef0ad04a52dfb0b6'),
      ('public.get_business_operations_config(uuid)', 'd5c3e03338bb948f7b5119cfc107967e', '9c9a608da589e31814a6064f3779e673'),
      ('public.get_packing_manifest(uuid)', '914aa2dd99b5c6042a72361bdb3244d6', '1589efb3140d6b0075619ecc9d72d6a4'),
      ('public.get_scanned_product_readiness(uuid)', 'f982ecaaa791e794771405b39158dbad', 'aac8795e83c21a1513d2d5cb60731f9a'),
      ('public.get_store_opening_readiness(uuid,integer)', 'e9cc00b30a29881b4de0880807ca5189', '5ed36ed5f4b858d4e8e572867407204c'),
      ('public.guard_business_currency_code()', '411605832d74587c4c3a63f34f09cbff', '2305dc92f8c08388af31f6146bdcdb95'),
      ('public.identity_revoke_all_sessions(uuid,uuid)', 'd3463cb4a835652d47458eac73e852f0', '62b0032a0ae2eda195b9001382dea71e'),
      ('public.identity_revoke_session(uuid)', 'b9d3d1f7e6e7b1a9487365b6c3e3adcc', 'abbeb5c6674d1a37f7659a548101cfd0'),
      ('public.identity_set_member_active(uuid,uuid,boolean,text)', '2663c505ec6a5f9c566d9c5a492d74d2', 'b2e40db2712bc9340f4b92c24df7e903'),
      ('public.identity_set_member_role(uuid,uuid,text)', 'a27456d8c30cba03d868bb9979bb8123', 'a28746a4ad5d3a4e83b51397e3ad7abd'),
      ('public.issue_order_delivery_code(uuid,text)', '252ec83858ee839f080ab8c9beec1a87', '7d4302527cfc8f507de0d1c6a4841199'),
      ('public.mark_delivery_picked_up(uuid,bigint,text)', '55324812e1c86049f3b93f4be45daff1', '2c233d11c0e4164583522fca7db2eda0'),
      ('public.mark_payment_cancellation_ambiguous(uuid,text,text)', 'ff91b4a55a222ec4c53ecfe7fff36122', 'e28baefd197ee8edf6e60f2517b90c2a'),
      ('public.mark_payment_refund_ambiguous(uuid,text,text)', '203ae47d94f277cec9937753e132432c', 'bf329b83143bde1d8b90d1e7efdd3b83'),
      ('public.mark_rider_arrived(uuid,bigint,text)', '5671f69a59c736aea88e179f07128202', '5aec6781e19efc441ae38d73445e49d2'),
      ('public.mp_begin_oauth(uuid,uuid,text,text,text)', '3ad8015a307efd12c93e8f1bcc61bcc3', 'e0a42e3251c92c4dfacc6d5be16fd3a2'),
      ('public.mp_disconnect(uuid,text)', '64557815d36b9fb1f51a3314eec674f6', '8c193b66f83f17c2b0582847970e4fd2'),
      ('public.mp_finish_oauth(uuid,text,uuid,text,text,text,text,timestamp with time zone)', '977d4249978e7549e29711a403168a41', 'c5bcab7e107f7338a17ce5cb29895a64'),
      ('public.mp_finish_refresh(uuid,text,uuid,uuid,text,timestamp with time zone,text)', 'bce848f130d217bc349f909239d99b2b', '4e667fcbe480bfbd0792cd6e781c3cc5'),
      ('public.mp_record_seller_webhook(text,text,text,text,boolean,text,text,uuid)', '363776ea3c81537cec9c47820ad982e8', '4ba2b85a83db437e1d6f78976f404194'),
      ('public.offer_order_to_rider(uuid,text,uuid,uuid)', '6bc42d658ef631b1942b33a19c5bf1f9', 'bea9710f88fa880f036d525660a2ee0f'),
      ('public.open_qa_window(uuid,integer)', 'a9de697ace99478e61d32532746e2481', 'c015103d6afaabd7424e45e6b0e818ed'),
      ('public.operator_set_mercadopago_for_business(uuid,text,boolean,text,boolean)', 'b2759068b15810e7d58930b89d950003', 'f7f233a5099c9ccf2d69bee5721ad125'),
      ('public.platform_revoke_business_ordering(uuid,text,text,text)', '00e192c2650a39075b4db67519e4b70f', 'b3e464a82b382b66d60a411d49977183'),
      ('public.platform_verify_business_ordering(uuid,text,text,integer,text)', '95e5be452e94c29b0b81181f3476d1b9', 'e3938db207d69fc2404add2244c4d067'),
      ('public.prepare_mercadopago_preference_v2(uuid,uuid,boolean)', '19c1a765d8cfa1079c799368f103cf4d', 'daa764a69fdd5468bba54bca1a398713'),
      ('public.prepare_payment_cancellation(uuid,uuid)', 'de5dae0a172d5166a01d63f23ede5fe3', '97a78991bb2d03c57b1eb6d6b6d272e2'),
      ('public.prepare_payment_refund_v2(uuid,numeric,uuid,text)', '359c95ad71fe5b02a9231e15151c3626', 'c8ed7abbc449d46c7f2d84c5ba872162'),
      ('public.publish_catalog_product_draft(uuid,text,text,numeric,text,integer)', '7342746000b4b91e687f6dd43bf3e45c', 'bcf11d2e9d7353ce43ee822643946ddd'),
      ('public.publish_catalog_product(uuid,text,boolean)', 'f974442a56d10e25293fb44262866223', '7af0c9b73b3cb6c8f4c405cea05af3b2'),
      ('public.purge_payment_request_traces(integer)', 'eee482cc079077f87624c2ed4951df22', '80d1a64fbf76d96baa3c0fc4371cdb73'),
      ('public.record_mercadopago_dispute_snapshot(uuid,text,jsonb)', 'f67f31252057aae4750baa63cb360c67', 'a87e9fca178fd043a7bb1afa45f31d07'),
      ('public.record_mercadopago_payment_snapshot(uuid,jsonb,text,uuid)', 'b80f697b7c27b78d058503c8223fca01', '560027fa01289e378e0c72492ae159d5'),
      ('public.record_mercadopago_preference_created_v2(uuid,text,uuid,uuid,uuid,text,text,text,text,text,text)', '651fb83f28b1036f3ee3ed3b6ab5001c', '6f8cfc5185f7fc5b8229a9b88c709b09'),
      ('public.record_mercadopago_preference_failed(uuid,text,text)', '5858ee6c7dfffc1ea2e7805ad541ee65', '33151131c00dfd647dcac779b321b2ef'),
      ('public.record_mercadopago_preference_uncertain(uuid,text,text)', '92c4738db58eb59ac040c87778e2808c', '5c836e9163fb29a219b0f2ecae80f92c'),
      ('public.record_mercadopago_webhook_receipt(text,text,text,text,boolean,text,text)', '14c4761aea9f7170ba9b6f2fec973678', '9c1fd35542bb558196b7f83b1beac416'),
      ('public.record_packing_scan(uuid,text,text)', '147d5aad0f16bed359cbb9f39fe1a359', '319ecc19ef4041df411b751402e0a297'),
      ('public.record_payment_cancellation_response(uuid,text,text)', '38115d8d3fa7ad5e520a34b754f711e3', 'b7e1b327cf4931f1ce8bb6268fe9e7e1'),
      ('public.record_payment_refund_identity(uuid,uuid,text,uuid,text)', 'f1fdfa7b75cb7dffe82f2f81817e96c3', 'b80980db6c226b800282df77179d596d'),
      ('public.record_payment_refund_response_v2(uuid,text,text,numeric,text)', '86f803d6cbf832162c8ffaef24dc4ff7', 'acb22c8e935941115da8a5b5c1b3754c'),
      ('public.record_provider_probe_empty(uuid)', '7bb66530bb292c06c5daba55142f45c1', 'e1ebd740b95adc2bb8a4fda69460266b'),
      ('public.recover_order_tracking_access(uuid,text)', '1f053b39e2073eeb96b51aad4cf17dba', 'f89345eb5951871d28c5fd1650850fcb'),
      ('public.recover_paid_checkout_order(uuid)', 'dad78f6dbe3fed197f5d25d64029923d', '297fe2243d67491f86c80b4df2bc1489'),
      ('public.reject_catalog_image_upload(uuid,uuid,text)', 'bc475bf12f2452130e855c91b45350c6', 'e47bd4366497e619fd696bb781db227c'),
      ('public.reject_rider_order_offer(uuid,bigint,text,text)', '0c9d1d60cb9ec81e8dd4691b49933523', '4303e13325c44cb8c5ebcd449e894eee'),
      ('public.release_manual_review_checkout_inventory(uuid,text,boolean)', 'da544142e707ee02dafae7fdccb81420', '7e35d6b317e189049c0e6d80f968a6d8'),
      ('public.resolve_stuck_payment_refund(uuid)', '81a9c521c235490f16160e46e5ad5e5c', 'a2b139475f64879a8ac69e9b8a1ca12f'),
      ('public.reverse_manual_order_payment(uuid,bigint,text,text)', '5842f5333e33049162931cb23f80d730', '9432ba5ab406f3765742461d91c0f998'),
      ('public.revert_packing_scan(uuid,text,text)', '8c37926708f4b9155216dee6c9640ebc', 'e65e93ee15dd317a0bb2b4ac5c5e506b'),
      ('public.revive_payment_outbox_job(uuid,text)', '9c7b7c83813cac79bf7989ae52b34051', '138386fa717d3a1b1444d1adf04c5821'),
      ('public.rollback_commercial_catalog_batch(uuid,uuid)', 'e7a6d56e454665582e01ab99e4ed320d', 'c85727289334693fb2c3165725b9c347'),
      ('public.set_business_address(uuid,text)', '506f1faf59bac48e8b0cc8b1a83e2253', '6007b2a2ca6b1eeb879848cf5b78f043'),
      ('public.set_business_fulfillment(uuid,boolean,boolean)', '2d5c0a8371d5bd51f0a5158308c00aef', '0cc547d26e7a28e683440ea4731816f0'),
      ('public.set_business_open_state(uuid,text)', '618c2d4dec8b60f1ad797fc6f0757780', '70e16c160a431d360c27b220a951bd66'),
      ('public.set_business_rider_presence_policy(uuid,boolean)', 'c92fa2f5441172e751e2c2668d71f980', 'ceb542c2b03458057ce790a0496fb365'),
      ('public.set_business_whatsapp_contact(uuid,text,boolean)', '35a1d1de33489ce46e46e825c09a6149', '2460319f0788f5fa04727db690215471'),
      ('public.set_commercial_product_publication(uuid,text,boolean)', 'ae8d2bc62feb15c169af8f661ea1c922', '2579b9572e39f4da31aad31d8bead8f6'),
      ('public.set_commercial_settings_delegation(uuid,uuid,boolean)', '47e5c16c27529b33c07238693378319b', 'da6b9cecf5f99af00f67d58d7a538fd8'),
      ('public.set_delivery_pricing(uuid,numeric,numeric,integer)', '4dd75a87b69829488d6ae2d0ff69b508', '285f595a52d56327c3cca85ec6b1026d'),
      ('public.set_delivery_zone_active(uuid,uuid,boolean)', '6d3b39b2d5e51853b914070703554453', '9532c40f4da5b5b321f58c9d3b0f0641'),
      ('public.set_preparation_estimate(uuid,bigint,integer,text)', '83793471cb78378d81ef7586fdb1bcc4', 'ca8a8e57454697d15f90afc5a8ab809d'),
      ('public.set_service_enforcement(uuid,boolean,boolean,boolean,text)', '3c45cfa84d54474808944194c0097e2e', '945685a1b019ed36000431c359323085'),
      ('public.start_packing_session(uuid,bigint,text)', 'fd3d1a0ad711eb7673bcea1048b4ea29', '7273666a3019510e44a05766044b589c'),
      ('public.start_payment_outbox_job(uuid,text)', '2ff8b55b1268d19575f96132ac834da8', '4120636635e340b60d131ea7c0bd776c'),
      ('public.start_rider_delivery(uuid,bigint,text)', '85c2d6a36aa0c132427bfc8b05e99d25', 'de369e5180f322f1c25b07d709282a0a'),
      ('public.sweep_expired_checkout_sessions()', 'c587cfd2557a9c3b1808381cb06b3ce3', '19767a9f396f296ea5a4217f1203b3aa'),
      ('public.transition_operational_alert(uuid,text,text)', 'bb0ed75913a78fe4060c954cb1222934', 'b45ae2164b6519a6b4642d2f64cac45a'),
      ('public.transition_order(uuid,bigint,text,text)', '089f6626cd93450dd634c73c3ab4d4f5', 'c49fdb84658e76da23e5b0b4bba796f3'),
      ('public.unpublish_catalog_product(uuid,text)', '75a191c01f54470696fe8dde16474618', '9388ebf1bfe2892212ada7317a104950'),
      ('public.upsert_delivery_zone(uuid,jsonb)', '6c4c8a2ada9a7f664c02c562d2fac018', '686ef763d7924c2132482436dac46e3a'),
      ('public.withdraw_rider_order_offer(uuid)', '338566e8589b015b40c1af5bcc2f28fa', '02762f144486123898d84b196e414492')
    ) as t(signature, previous, applied)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into v_actual
      from pg_proc p where p.oid = to_regprocedure(v_row.signature);
    if v_actual is null or v_actual not in (v_row.previous, v_row.applied) then
      raise exception 'ROLLOUT_BLOCKED: % no tiene el cuerpo del que se genero 20261002090000; otra migracion la redefinio: regenerar con scripts/db/wrap-api-boundary.mjs', v_row.signature
        using errcode = 'P0001';
    end if;
  end loop;
end
$guard$;

CREATE OR REPLACE FUNCTION public.accept_rider_order_offer(p_offer_id uuid, p_expected_version bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_offer public.rider_order_offers%rowtype;v_prior jsonb;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode='42501'; end if;
  perform public.lock_rider_capacity(auth.uid());
  select * into v_offer from public.rider_order_offers
   where id=p_offer_id and rider_user_id=auth.uid();
  if not found then return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key); end if;
  perform public.rider_require_active_membership(v_offer.business_id);
  -- Pedido -> oferta, el orden de offer_order_to_rider. La funcion de adentro toma la
  -- oferta y despues el pedido: si en ese momento el comercio ofrecia el pedido a otro
  -- repartidor (pedido -> oferta pendiente), una de las dos llamadas terminaba en
  -- deadlock. Aca se toma primero el pedido, que se conoce por la oferta leida sin
  -- candado, y despues la oferta; adentro los dos ya estan tomados.
  -- El pedido va FOR NO KEY UPDATE y no FOR UPDATE: rechazar y retirar una oferta toman
  -- la oferta y despues anotan un evento del pedido, que pide KEY SHARE sobre el pedido;
  -- con FOR UPDATE esas dos se trabarian con esta. La oferta se comprueba ya tomada: sigue
  -- siendo de ese pedido.
  perform 1 from public.orders o where o.id=v_offer.order_id for no key update;
  perform 1 from public.rider_order_offers f where f.id=v_offer.id and f.order_id=v_offer.order_id for update;
  if not found then raise exception 'la oferta cambio de pedido mientras se aceptaba' using errcode='PT409'; end if;
  if (select b.rider_presence_required from public.businesses b where b.id=v_offer.business_id)
     and not public.rider_availability_effective(v_offer.business_id,auth.uid()) then
    select result into v_prior from public.rider_delivery_operations
    where order_id=v_offer.order_id and rider_user_id=auth.uid()
      and operation='accept_offer' and idempotency_key=p_idempotency_key;
    if found or v_offer.status <> 'pending' then
      return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key);
    end if;
    return jsonb_build_object('ok',false,'code','rider_unavailable');
  end if;
  return public.accept_rider_order_offer_pre_presence(p_offer_id,p_expected_version,p_idempotency_key);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.acknowledge_order(p_order_id uuid, p_expected_revision bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'expected_revision requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;

  v_hash := public.business_command_request_hash('acknowledge_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = 'PT409'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'pedido no reconocible en estado actual' using errcode = 'P0001'; end if;

  update public.orders set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by = coalesce(acknowledged_by, auth.uid()) where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_acknowledged', 'business_acknowledged', 'Pedido reconocido por el negocio.', '{}'::jsonb);
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'acknowledge_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_commercial_catalog_batch(p_business_id uuid, p_rows jsonb)
 RETURNS TABLE(applied_sku text, applied_price numeric, applied_stock integer, applied_available boolean, applied_is_verified boolean, applied_republished boolean, applied_price_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_row jsonb;
  v_sku text;
  v_product public.products%rowtype;
  v_price numeric(12, 2);
  v_stock integer;
  v_publish boolean;
  v_price_pending boolean;
  v_next_price numeric(12, 2);
  v_next_stock integer;
  v_next_available boolean;
  v_next_verified boolean;
  v_next_price_status text;
  v_was_published boolean;
  v_was_held boolean;
  v_asset_ok boolean;
  v_alcohol_open boolean;
  v_seen text[] := '{}';
  v_batch_id uuid;
  v_expected_stock integer;
  v_reserved integer;
  v_missing text;
  v_settled jsonb;
  v_after public.products%rowtype;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can apply commercial catalog values.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Commercial rows must be a non-null JSON array.';
  end if;
  if jsonb_array_length(p_rows) < 1 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Commercial rows must be a JSON array with 1 to 500 entries.';
  end if;

  -- La compuerta de licencia es la misma que usa set_commercial_product_publication.
  select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
    from public.businesses b where b.id = p_business_id;
  v_alcohol_open := coalesce(v_alcohol_open, false);

  -- El rastro nace con el lote y muere con él: si una fila falla, la excepción se
  -- lleva las dos cosas. No existe un lote aplicado sin rastro ni al revés.
  v_batch_id := private.catalog_change_begin(p_business_id, 'commercial_batch', p_rows);

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_sku := btrim(coalesce(v_row ->> 'sku', ''));
    if v_sku = '' then
      raise exception 'Commercial row without sku.';
    end if;
    if v_sku = any (v_seen) then
      raise exception 'Duplicated sku % in the same batch.', v_sku;
    end if;
    v_seen := v_seen || v_sku;

    if v_sku ~* '(-staging-only$)|(^qa[-_])|(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking sku in the commercial catalog: %.', v_sku;
    end if;

    select * into v_product
      from public.products p
     where p.business_id = p_business_id
       and p.sku = v_sku
     for update;
    if not found then
      raise exception 'Unknown sku % for this business. Commercial import never creates products.', v_sku;
    end if;

    -- ── precio ────────────────────────────────────────────────────────────────
    if nullif(btrim(coalesce(v_row ->> 'price', '')), '') is null then
      v_price := null;
    elsif coalesce(v_row ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for sku %.', v_sku;
    else
      v_price := (v_row ->> 'price')::numeric;
      if v_price <= 0 or v_price > 9999999999.99 then
        raise exception 'Invalid price value for sku %: must be greater than zero.', v_sku;
      end if;
    end if;

    -- ── volver a pendiente ────────────────────────────────────────────────────
    if v_row -> 'price_pending' is null or jsonb_typeof(v_row -> 'price_pending') = 'null' then
      v_price_pending := null;
    elsif jsonb_typeof(v_row -> 'price_pending') is distinct from 'boolean' then
      raise exception 'Invalid price_pending flag for sku %.', v_sku;
    else
      v_price_pending := (v_row ->> 'price_pending')::boolean;
    end if;
    if coalesce(v_price_pending, false) and v_price is not null then
      raise exception 'Row for sku % sets a price and marks it pending at the same time.', v_sku;
    end if;

    -- ── stock ─────────────────────────────────────────────────────────────────
    if nullif(btrim(coalesce(v_row ->> 'stock', '')), '') is null then
      v_stock := null;
    elsif coalesce(v_row ->> 'stock', '') !~ '^[0-9]+$' then
      raise exception 'Invalid stock format for sku %.', v_sku;
    else
      if (v_row ->> 'stock')::numeric > 2147483647 then
        raise exception 'Invalid stock range for sku %.', v_sku;
      end if;
      v_stock := (v_row ->> 'stock')::integer;
    end if;

    -- ── stock que el cliente tenía a la vista (opcional) ──────────────────────
    -- La fila ya está bloqueada: lo que se compara es el disponible de ESTE
    -- instante. `null` o vacío quiere decir «lo vi sin contar». El mensaje va en
    -- castellano y sin jerga porque el Panel lo muestra tal cual.
    if v_row ? 'expected_stock' then
      if jsonb_typeof(v_row -> 'expected_stock') = 'null' or btrim(v_row ->> 'expected_stock') = '' then
        v_expected_stock := null;
      elsif (v_row ->> 'expected_stock') !~ '^[0-9]+$' or (v_row ->> 'expected_stock')::numeric > 2147483647 then
        raise exception 'Invalid expected_stock format for sku %.', v_sku;
      else
        v_expected_stock := (v_row ->> 'expected_stock')::integer;
      end if;
      if v_product.stock is distinct from v_expected_stock then
        raise exception 'El stock de % (%) cambió mientras lo editabas: la pantalla mostraba % y ahora hay %. Actualizá el catálogo y volvé a contar; no se guardó ningún cambio del lote.',
          v_product.name, v_sku,
          coalesce(v_expected_stock::text, 'sin contar'), coalesce(v_product.stock::text, 'sin contar')
          using errcode = 'PT409';
      end if;
    end if;

    -- ── publicación ───────────────────────────────────────────────────────────
    if v_row -> 'publish' is null or jsonb_typeof(v_row -> 'publish') = 'null' then
      v_publish := null;
    elsif jsonb_typeof(v_row -> 'publish') is distinct from 'boolean' then
      raise exception 'Invalid publish flag for sku %.', v_sku;
    else
      v_publish := (v_row ->> 'publish')::boolean;
    end if;

    if v_price is null and v_stock is null and v_publish is null and v_price_pending is null then
      raise exception 'Commercial row for sku % does not decide anything.', v_sku;
    end if;

    -- Cargar un precio ES confirmarlo. Marcarlo pendiente lo devuelve al otro
    -- estado. Sin ninguna de las dos cosas, el estado no se toca.
    v_next_price_status := case
      when v_price is not null then 'confirmed'
      when coalesce(v_price_pending, false) then 'pending'
      else v_product.price_status
    end;
    v_next_price := coalesce(v_price, v_product.price);
    -- El stock de la fila es un CONTEO FÍSICO. `products.stock` es el disponible:
    -- lo que hay en la góndola menos lo que ya está comprometido con pedidos que
    -- todavía no salieron y con checkouts vivos. Escribir el conteo tal cual volvía
    -- a poner en venta unidades reservadas.
    if v_stock is null then
      v_reserved := null;
      v_next_stock := v_product.stock;
    else
      v_reserved := private.pos_reserved_quantity(v_product.id);
      v_next_stock := greatest(v_stock - v_reserved, 0);
    end if;
    v_next_verified := v_product.is_verified;
    v_was_published := v_product.is_verified and v_product.available;
    -- Retenido por el sistema: verificado, el comercio lo quiere a la venta, y lo
    -- único que lo tiene afuera es un conflicto de stock abierto.
    v_was_held := v_product.is_verified and v_product.merchant_available and not v_product.available
      and exists (select 1 from public.pos_stock_conflicts c
                   where c.product_id = v_product.id and c.status = 'open');

    -- Un producto sin precio confirmado no puede quedar disponible, pase lo que
    -- pase con el resto de la fila.
    if v_next_price_status <> 'confirmed' or coalesce(v_next_price, 0) <= 0 then
      v_next_available := false;
    else
      v_next_available := coalesce(v_publish, v_product.available);
    end if;

    -- La autoridad de imagen de la 108, invocada — no recalculada acá.
    v_asset_ok := public.product_commercial_image_valid(v_product);

    if coalesce(v_publish, false) then
      if v_next_price_status <> 'confirmed' then
        raise exception 'Refusing to publish sku % without a confirmed price state.', v_sku;
      end if;
      if v_next_price is null or v_next_price <= 0 then
        raise exception 'Refusing to publish sku % without a price.', v_sku;
      end if;
      if coalesce(v_next_stock, 0) <= 0 then
        if coalesce(v_stock, 0) > 0 then
          raise exception 'Refusing to publish sku % without stock: the % counted units are all reserved by open orders (% reserved).',
            v_sku, v_stock, v_reserved;
        end if;
        raise exception 'Refusing to publish sku % without stock.', v_sku;
      end if;
      if not v_product.is_active then
        raise exception 'Refusing to publish inactive sku %.', v_sku;
      end if;
      if not v_asset_ok then
        raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset — no partial or mismatched image state.', v_sku;
      end if;
      if coalesce(v_product.is_alcoholic, false) and not v_alcohol_open then
        raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku;
      end if;
      -- Publicar verifica la ficha. Si a la ficha le falta un dato, la base lo
      -- rechaza con el nombre de una restricción; acá se dice cuál, antes.
      if v_product.catalog_origin = 'commercial' then
        v_missing := concat_ws(', ',
          case when nullif(btrim(coalesce(v_product.brand, '')), '') is null then 'brand' end,
          case when nullif(btrim(coalesce(v_product.category, '')), '') is null then 'category' end,
          case when nullif(btrim(coalesce(v_product.subcategory, '')), '') is null then 'subcategory' end,
          case when nullif(btrim(coalesce(v_product.variant, '')), '') is null
                 or v_product.presentation is distinct from v_product.variant then 'variant' end,
          case when coalesce(v_product.capacity_value, 0) <= 0
                 or v_product.capacity_unit is null
                 or v_product.capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad')
                 or v_product.capacity is distinct from (v_product.capacity_value::text || ' ' || v_product.capacity_unit)
               then 'capacity' end,
          case when nullif(btrim(coalesce(v_product.packaging_type, '')), '') is null then 'packaging_type' end,
          case when nullif(btrim(coalesce(v_product.external_id, '')), '') is null then 'external_id' end,
          case when v_product.is_alcoholic is null then 'is_alcoholic' end);
        if v_missing <> '' then
          raise exception 'Refusing to publish sku %: its product data is incomplete (missing: %). Complete the product before publishing.',
            v_sku, v_missing;
        end if;
      end if;
      v_next_verified := true;
    end if;

    update public.products p
       set price = v_next_price,
           price_status = v_next_price_status,
           stock = v_next_stock,
           available = v_next_available
             and p.is_active
             and coalesce(v_next_stock, 0) > 0
             and v_next_price_status = 'confirmed'
             and coalesce(v_next_price, 0) > 0,
           -- La intención del comercio: publicar la enciende, ocultar la apaga y
           -- una fila que no decide publicación la deja como estaba. Sin esto,
           -- un borrador de CP (merchant_available = false) no se publicaba nunca.
           merchant_available = coalesce(v_publish, p.merchant_available),
           is_verified = v_next_verified,
           verified_at = case
             when v_next_verified and not v_product.is_verified then statement_timestamp()
             else p.verified_at
           end,
           verified_by = case
             when v_next_verified and not v_product.is_verified then auth.uid()
             else p.verified_by
           end,
           updated_at = statement_timestamp()
     where p.id = v_product.id
    returning p.sku, p.price, p.stock, p.available, p.is_verified, p.price_status
      into applied_sku, applied_price, applied_stock, applied_available,
           applied_is_verified, applied_price_status;

    -- ── REPUBLICACIÓN EXPLÍCITA ───────────────────────────────────────────────
    -- `products_fail_close_master_change` cuenta el precio como dato maestro y
    -- despublica al cambiarlo. El disparador está bien y no se toca; acá se
    -- vuelve a publicar lo que YA estaba publicado y lo que ESTA fila pidió
    -- publicar, siempre que siga cumpliendo TODAS las compuertas, incluida la de
    -- imagen y la de licencia de alcohol. Antes sólo se miraba lo ya publicado:
    -- «precio nuevo + publicar» sobre un producto verificado y agotado terminaba
    -- oculto y sin verificar, sin error.
    applied_republished := false;
    -- Una fila que pide OCULTAR no se republica aunque el precio haya cambiado.
    if (v_was_published or v_was_held or coalesce(v_publish, false)) and not applied_is_verified and v_publish is distinct from false then
      if applied_price_status = 'confirmed'
         and applied_price > 0
         and v_product.is_active
         and v_asset_ok
         and (not coalesce(v_product.is_alcoholic, false) or v_alcohol_open) then
        if coalesce(applied_stock, 0) > 0 and (v_was_published or coalesce(v_publish, false)) then
          update public.products p
             set is_verified = true,
                 available = true,
                 merchant_available = true,
                 verified_at = statement_timestamp(),
                 verified_by = auth.uid(),
                 updated_at = statement_timestamp()
           where p.id = v_product.id
          returning p.price, p.stock, p.available, p.is_verified, p.price_status
            into applied_price, applied_stock, applied_available,
                 applied_is_verified, applied_price_status;
          applied_republished := true;
        else
          -- No puede quedar a la venta en este paso: el conteo de la fila no dejó
          -- disponible (todo lo contado está reservado), o lo retiene un conflicto.
          -- Pero estaba verificado y a la venta, y el precio lo cambió el dueño por
          -- esta misma puerta: conserva la verificación. Medido antes: quedaba SIN
          -- VERIFICAR sin aviso, y no volvía cuando se liberaban los pedidos, se
          -- recibía mercadería o un conteo cerraba el conflicto. Acá no se enciende
          -- `available`: eso lo hace quien devuelva el stock o cierre el conflicto.
          update public.products p
             set is_verified = true,
                 verified_at = statement_timestamp(),
                 verified_by = auth.uid(),
                 updated_at = statement_timestamp()
           where p.id = v_product.id
          returning p.price, p.stock, p.available, p.is_verified, p.price_status
            into applied_price, applied_stock, applied_available,
                 applied_is_verified, applied_price_status;
        end if;
      end if;
    end if;

    -- ── CONTEO: libro y conflicto ─────────────────────────────────────────────
    v_settled := null;
    if v_stock is not null then
      v_settled := private.catalog_stock_count_settle(
        p_business_id, v_product.id, v_product.stock, v_next_stock, v_stock, v_reserved,
        format('Conteo físico desde el catálogo comercial: contado %s, reservado %s', v_stock, v_reserved),
        'catalog_change_batch', v_batch_id,
        'ccb_' || md5(v_batch_id::text || ':' || v_product.id::text),
        v_publish is distinct from false);
    end if;

    select * into v_after from public.products p where p.id = v_product.id;
    applied_price := v_after.price;
    applied_stock := v_after.stock;
    applied_available := v_after.available;
    applied_is_verified := v_after.is_verified;
    applied_price_status := v_after.price_status;

    -- Publicar es publicar: una fila que lo pidió y pasó las compuertas no puede
    -- volver «aplicada» con el producto escondido.
    if coalesce(v_publish, false) and not v_after.available then
      if exists (select 1 from public.pos_stock_conflicts c where c.product_id = v_product.id and c.status = 'open') then
        raise exception 'Refusing to publish sku %: it is held by an open stock conflict. Count its physical stock first.', v_sku;
      end if;
      raise exception 'Refusing to publish sku %: it passed the gates but did not end available. Nothing was applied.', v_sku;
    end if;

    perform private.catalog_change_log_item(
      v_batch_id, 'updated', v_product, v_after, v_stock, v_reserved,
      (v_settled ->> 'movement_id')::uuid,
      jsonb_build_object(
        -- Si la fila decidió la publicación (`publish` true o false). La reversión lo
        -- necesita: `available` también lo mueve el sistema, y por la imagen sola no
        -- se distingue «la planilla lo publicó» de «un conteo lo reofreció».
        'publish', v_publish,
        'republished', applied_republished,
        'shortfall', nullif((v_settled ->> 'shortfall')::integer, 0),
        'conflict_id', v_settled ->> 'conflict_id',
        'conflict_resolved', case when (v_settled ->> 'conflict_resolved')::boolean then true end,
        'reoffered', case when (v_settled ->> 'reoffered')::boolean then true end));
    return next;
  end loop;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_commercial_catalog_plan(p_business_id uuid, p_creates jsonb DEFAULT '[]'::jsonb, p_updates jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_row jsonb;
  v_sku text;
  v_name text;
  v_category text;
  v_subcategory text;
  v_alcoholic boolean;
  v_minimum_age integer;
  v_price numeric(12, 2);
  v_stock integer;
  v_seen text[] := '{}';
  v_created integer := 0;
  v_updated integer := 0;
  v_creadas jsonb := '[]'::jsonb;
  v_batch_id uuid;
  v_new public.products%rowtype;
  v_update_rows jsonb := '[]'::jsonb;
  v_settled jsonb;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can apply a commercial catalog plan.'
      using errcode = '42501';
  end if;
  if p_creates is null or jsonb_typeof(p_creates) is distinct from 'array'
     or p_updates is null or jsonb_typeof(p_updates) is distinct from 'array' then
    raise exception 'Both creates and updates must be JSON arrays.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_creates) > 500 then
    raise exception 'A plan proposes at most 500 new products.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_creates) = 0 and jsonb_array_length(p_updates) = 0 then
    raise exception 'A plan that decides nothing is not applied.' using errcode = '22023';
  end if;

  v_batch_id := private.catalog_change_begin(p_business_id, 'commercial_plan',
    jsonb_build_object('creates', p_creates, 'updates', p_updates));

  -- ── ALTAS ──────────────────────────────────────────────────────────────────
  for v_row in select value from jsonb_array_elements(p_creates)
  loop
    v_sku := btrim(coalesce(v_row ->> 'sku', ''));
    if v_sku !~ '^[a-z0-9][a-z0-9-]{2,79}$' then
      raise exception 'Unstable sku for a new product: %. Use lowercase letters, digits and dashes.', v_sku
        using errcode = '22023';
    end if;
    if v_sku = any (v_seen) then
      raise exception 'Duplicated new sku % in the same plan.', v_sku using errcode = '22023';
    end if;
    v_seen := v_seen || v_sku;

    -- Un fixture de QA nunca entra al catálogo comercial. Es la misma regla que
    -- ya aplica el lote de modificaciones, con el mismo patrón.
    if v_sku ~* '(-staging-only$)|(^qa[-_])|(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking sku in the commercial catalog: %.', v_sku
        using errcode = '22023';
    end if;
    -- El pack con el que el local se surte no es un producto de góndola.
    if v_sku ~* '-(pack|bulto|caja)-[0-9]+$' then
      raise exception 'Sku % looks like a procurement pack, not a shelf product.', v_sku
        using errcode = '22023';
    end if;

    if exists (select 1 from public.products p
                where p.business_id = p_business_id and p.sku = v_sku) then
      raise exception 'Sku % already exists for this business. A plan never overwrites by creating.', v_sku
        using errcode = '23505';
    end if;

    v_name := btrim(coalesce(v_row ->> 'name', ''));
    if char_length(v_name) not between 2 and 160 then
      raise exception 'Invalid name for new sku %.', v_sku using errcode = '22023';
    end if;
    -- El importador mira SKU y nombre juntos; el servidor miraba sólo el SKU, así
    -- que una llamada directa podía dar de alta «coca-500» con nombre «QA TEST».
    if v_name ~* '(\yqa\y)|(\y(test|prueba|sintetica|sintetico|synthetic|fixture|dummy)\y)' then
      raise exception 'Refusing a QA-looking name in the commercial catalog for new sku %.', v_sku
        using errcode = '22023';
    end if;

    v_category := btrim(coalesce(v_row ->> 'category', ''));
    if v_category not in (
      'Gaseosas', 'Jugos', 'Mixers', 'Energizantes', 'Aguas', 'Aguas saborizadas', 'Isotónicas', 'Hielo',
      'Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados',
      'Snacks', 'Golosinas', 'Almacén', 'Limpieza', 'Higiene personal', 'Hogar', 'Mascotas', 'Otros'
    ) then
      raise exception 'Unknown category % for new sku %.', v_category, v_sku using errcode = '22023';
    end if;

    if jsonb_typeof(v_row -> 'is_alcoholic') is distinct from 'boolean' then
      raise exception 'New sku % must declare is_alcoholic explicitly as a boolean.', v_sku
        using errcode = '22023';
    end if;
    v_alcoholic := (v_row ->> 'is_alcoholic')::boolean;

    -- La góndola y la bandera tienen que decir lo mismo: es la misma partición
    -- que exige `products_verified_alcohol_coherence`, adelantada al alta para
    -- que el producto no nazca imposible de verificar.
    if v_alcoholic <> (v_category in ('Cervezas', 'Fernet', 'Aperitivos', 'Vinos', 'Espumantes', 'Destilados')) then
      raise exception 'Category % and is_alcoholic=% disagree for new sku %.', v_category, v_alcoholic, v_sku
        using errcode = '22023';
    end if;

    if v_alcoholic then
      v_minimum_age := coalesce(nullif(btrim(coalesce(v_row ->> 'minimum_age', '')), '')::integer, 18);
      if v_minimum_age not between 18 and 99 then
        raise exception 'Invalid minimum_age for new sku %.', v_sku using errcode = '22023';
      end if;
    else
      v_minimum_age := null;
      if nullif(btrim(coalesce(v_row ->> 'minimum_age', '')), '') is not null then
        raise exception 'New sku % is not alcoholic and cannot carry a minimum age.', v_sku
          using errcode = '22023';
      end if;
    end if;

    if nullif(btrim(coalesce(v_row ->> 'price', '')), '') is null then
      v_price := null;
    elsif coalesce(v_row ->> 'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'Invalid price format for new sku %.', v_sku using errcode = '22023';
    else
      v_price := (v_row ->> 'price')::numeric;
      if v_price <= 0 or v_price > 9999999999.99 then
        raise exception 'Invalid price value for new sku %.', v_sku using errcode = '22023';
      end if;
    end if;

    v_stock := public.commercial_catalog_parse_stock(v_row);

    -- Publicar no viaja en un alta. Si alguien lo manda igual, se dice por qué
    -- no, en vez de ignorar la clave en silencio.
    if coalesce((v_row ->> 'publish')::text, 'false') not in ('false', '') then
      raise exception 'A newly proposed product is always created hidden: publish sku % in a second pass.', v_sku
        using errcode = '22023';
    end if;

    v_subcategory := nullif(btrim(coalesce(v_row ->> 'subcategory', '')), '');
    if v_subcategory is not null and char_length(v_subcategory) > 80 then
      raise exception 'Invalid subcategory for new sku %.', v_sku using errcode = '22023';
    end if;

    insert into public.products (
      business_id, sku, external_id, name, category, subcategory,
      price, price_status, stock,
      -- Nace ACTIVO pero NO disponible y NO verificado: existe para el Panel,
      -- no existe para la góndola. `available` es lo que decide si se puede
      -- comprar, y sólo lo enciende la segunda pasada con sus compuertas.
      is_active, available, is_verified,
      is_alcoholic, minimum_age, catalog_origin
    ) values (
      p_business_id, v_sku, v_sku, v_name, v_category, v_subcategory,
      coalesce(v_price, 0),
      case when v_price is null then 'pending' else 'confirmed' end,
      v_stock,
      true, false, false,
      v_alcoholic, v_minimum_age, 'commercial'
    )
    returning * into v_new;

    -- Un producto que nace no tiene imagen de antes ni reservas: su stock es el
    -- primer conteo, sin nada que restar. Deja su fila en el libro como cualquier
    -- otro conteo, para que el libro del producto arranque en cero y encadene.
    v_settled := null;
    if v_stock is not null then
      v_settled := private.catalog_stock_count_settle(
        p_business_id, v_new.id, 0, v_stock, v_stock, 0,
        format('Primer conteo al dar de alta el producto: contado %s', v_stock),
        'catalog_change_batch', v_batch_id,
        'cca_' || md5(v_batch_id::text || ':' || v_new.id::text),
        false);
    end if;
    perform private.catalog_change_log_item(
      v_batch_id, 'created', null::public.products, v_new, v_stock, 0,
      (v_settled ->> 'movement_id')::uuid, null);

    v_created := v_created + 1;
    v_creadas := v_creadas || jsonb_build_array(jsonb_build_object(
      'sku', v_sku, 'name', v_name, 'category', v_category,
      'is_alcoholic', v_alcoholic, 'available', false, 'is_verified', false
    ));
  end loop;

  -- ── MODIFICACIONES ─────────────────────────────────────────────────────────
  -- Se delegan tal cual. La misma transacción, las mismas compuertas. El lote
  -- adopta el rastro de este plan (ver private.catalog_change_begin) y la variable
  -- se limpia enseguida para que no la herede otra llamada de la misma transacción.
  if jsonb_array_length(p_updates) > 0 then
    perform set_config('taba.catalog_change_batch', v_batch_id::text, true);
    select count(*), coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      into v_updated, v_update_rows
      from public.apply_commercial_catalog_batch(p_business_id, p_updates) r;
    perform set_config('taba.catalog_change_batch', '', true);
  end if;

  return jsonb_build_object(
    'ok', true,
    'created', v_created,
    'updated', v_updated,
    'rows', v_creadas,
    -- Nuevo, aditivo: con qué id se revierte este plan y cómo quedó cada
    -- modificación. Antes el plan tiraba ese resultado y devolvía sólo la cuenta.
    'batch_id', v_batch_id,
    'update_rows', v_update_rows
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_inventory_movement(p_business_id uuid, p_product_id uuid, p_barcode_id uuid, p_movement_type text, p_package_quantity integer, p_direction integer, p_reference_type text, p_reference_id uuid, p_reason text, p_idempotency_key text)
 RETURNS public.inventory_movements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_product public.products%rowtype;
  v_barcode public.product_barcodes%rowtype;
  v_existing public.inventory_movements%rowtype;
  v_result public.inventory_movements%rowtype;
  v_factor integer := 1;
  v_delta integer;
  v_new integer;
  v_reserved integer;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  if p_movement_type not in ('purchase_receipt','manual_adjustment','stock_count','sale','online_order_reservation','online_order_release','cancellation_return','damage','loss','expiration','supplier_return') then raise exception 'tipo de movimiento invalido' using errcode = '22023'; end if;
  if p_package_quantity < 1 or p_direction not in (-1, 1) then raise exception 'cantidad o direccion invalida' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select m.* into v_existing from public.inventory_movements m where m.business_id = p_business_id and m.idempotency_key = p_idempotency_key;
  if found then return v_existing; end if;
  select p.* into v_product from public.products p where p.id = p_product_id and p.business_id = p_business_id for update;
  if not found then raise exception 'producto inexistente' using errcode = 'P0002'; end if;
  if p_barcode_id is not null then
    select b.* into v_barcode from public.product_barcodes b where b.id = p_barcode_id and b.business_id = p_business_id and b.product_id = p_product_id and b.is_active;
    if not found then raise exception 'barcode no corresponde al producto' using errcode = '22023'; end if;
    v_factor := v_barcode.unit_factor;
  end if;
  v_delta := p_package_quantity * v_factor * p_direction;
  -- El conteo del escáner del Panel (el único que llega con el código escaneado) manda
  -- la diferencia entre lo que la persona contó en la góndola y el DISPONIBLE. Lo que
  -- contó incluye las unidades apartadas para pedidos y checkouts abiertos, y acá no
  -- llega el conteo sino la diferencia: aplicarla volvería a poner a la venta lo
  -- apartado (3 disponibles + 2 apartadas, cuenta 5, quedaban 5 disponibles). Mientras
  -- haya unidades apartadas se rechaza, sin escribir nada, y se dice por dónde se cuenta
  -- bien. Un ajuste sin código escaneado (una restitución, un script) no cambia.
  if p_movement_type = 'stock_count' and p_barcode_id is not null then
    v_reserved := private.pos_reserved_quantity(p_product_id);
    if v_reserved > 0 then
      raise exception 'Este producto tiene % unidades apartadas para pedidos abiertos y el conteo del escáner las volvería a poner a la venta. Cargá el conteo desde Catálogo (Stock contado), que las descuenta, o contá de nuevo cuando esos pedidos se entreguen.', v_reserved
        using errcode = '22023', detail = 'STOCK_COUNT_HAS_RESERVED';
    end if;
  end if;
  if coalesce(v_product.stock, 0) + v_delta < 0 then raise exception 'stock negativo bloqueado' using errcode = '23514'; end if;
  if p_movement_type in ('manual_adjustment','stock_count','damage','loss','expiration','supplier_return') and char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo requerido' using errcode = '22023'; end if;
  v_new := coalesce(v_product.stock, 0) + v_delta;
  -- Llevar a 0 un producto publicado lo saca de la venta en el mismo UPDATE (la
  -- restricción de disponibilidad exige stock > 0; antes esto era un 23514 crudo y
  -- la última unidad rota seguía ofrecida). Este UPDATE sólo puede apagar.
  update public.products set stock = v_new, available = available and v_new > 0 where id = p_product_id;
  insert into public.inventory_movements(business_id, product_id, barcode_id, movement_type, quantity_delta, previous_stock, resulting_stock, unit_factor, reference_type, reference_id, reason, operator_id, idempotency_key)
  values (p_business_id, p_product_id, p_barcode_id, p_movement_type, v_delta, coalesce(v_product.stock,0), coalesce(v_product.stock,0)+v_delta, v_factor, nullif(btrim(coalesce(p_reference_type,'')),''), p_reference_id, nullif(btrim(coalesce(p_reason,'')),''), auth.uid(), p_idempotency_key)
  returning * into v_result;
  -- Cuando vuelve a haber disponible se reofrece con la misma regla que usan los
  -- movimientos de Caja Clara: sólo si el comercio lo quería a la venta y se
  -- cumplen todas las compuertas (verificado, activo, precio confirmado, imagen
  -- válida, licencia de alcohol, sin conflicto de stock abierto).
  if coalesce(v_product.stock, 0) <= 0 and v_new > 0 then
    perform private.pos_try_reoffer(p_product_id);
  end if;
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_catalog_image_upload(p_upload_id uuid, p_actor_user_id uuid, p_rights_status text, p_rights_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_upload public.catalog_image_uploads%rowtype;
  v_product public.products%rowtype;
  v_asset_id uuid;
  v_external_id text;
  v_safe_sku text;
  v_identity_sha256 text;
  v_master_path text;
  v_thumbnail_path text;
  v_master_storage_path text;
  v_thumbnail_storage_path text;
  v_master_binding_sha256 text;
  v_thumbnail_binding_sha256 text;
  v_old_master_storage_path text;
  v_old_thumbnail_storage_path text;
begin
  select * into v_upload from public.catalog_image_uploads where id = p_upload_id for update;
  if not found
     or not public.catalog_image_upload_actor_allowed(v_upload.business_id, v_upload.product_id, p_actor_user_id) then
    raise exception 'catalog image upload not found' using errcode = 'no_data_found';
  end if;
  if v_upload.status <> 'pending' or v_upload.upload_completed_at is null
     or v_upload.license_status <> 'pending'
     or v_upload.review_previewed_by is distinct from p_actor_user_id
     or v_upload.review_previewed_at is null
     or v_upload.review_previewed_at < statement_timestamp() - interval '5 minutes' then
    raise exception 'catalog image upload is not ready for approval' using errcode = 'check_violation';
  end if;
  if p_rights_status not in ('PROPIO', 'LICENCIA_COMERCIAL', 'PERMISO_DOCUMENTADO')
     or btrim(coalesce(p_rights_reference, '')) = '' then
    raise exception 'documented image rights are required for approval' using errcode = 'check_violation';
  end if;
  if v_upload.source_type = 'business_owned_photo'
     and (p_rights_status <> 'PROPIO' or v_upload.source_url is not null) then
    raise exception 'business-owned photos require PROPIO rights and no external URL' using errcode = 'check_violation';
  end if;
  if v_upload.source_type <> 'business_owned_photo'
     and (p_rights_status = 'PROPIO' or v_upload.source_url is null) then
    raise exception 'external image sources require commercial license or written permission' using errcode = 'check_violation';
  end if;

  select * into v_product from public.products
   where id = v_upload.product_id and business_id = v_upload.business_id
   for update;
  if not found or v_product.catalog_origin <> 'commercial'
     or v_product.available or v_product.is_verified then
    raise exception 'catalog images can only be associated to unpublished, unverified commercial products'
      using errcode = 'check_violation';
  end if;
  v_external_id := coalesce(nullif(v_product.external_id, ''), v_product.sku);
  if btrim(coalesce(v_external_id, '')) = '' or btrim(coalesce(v_product.sku, '')) = '' then
    raise exception 'catalog image target has no stable product identity' using errcode = 'check_violation';
  end if;
  v_safe_sku := 'c_' || lower(v_product.business_id::text) || '_' || lower(v_product.id::text);
  v_identity_sha256 := public.catalog_image_identity_sha256(v_external_id, v_product.sku, v_upload.source_sha256);
  v_master_path := public.catalog_asset_path(v_safe_sku, v_identity_sha256, 'master', v_upload.master_sha256);
  v_thumbnail_path := public.catalog_asset_path(v_safe_sku, v_identity_sha256, 'thumbnail', v_upload.thumbnail_sha256);
  v_master_storage_path := public.catalog_product_storage_path(v_upload.business_id, v_upload.product_id, 'master', v_upload.master_sha256);
  v_thumbnail_storage_path := public.catalog_product_storage_path(v_upload.business_id, v_upload.product_id, 'thumbnail', v_upload.thumbnail_sha256);
  v_master_binding_sha256 := public.catalog_asset_binding_sha256(
    v_identity_sha256, 'master', v_upload.source_sha256, v_upload.master_sha256, 1000, 1000, v_master_path
  );
  v_thumbnail_binding_sha256 := public.catalog_asset_binding_sha256(
    v_identity_sha256, 'thumbnail', v_upload.source_sha256, v_upload.thumbnail_sha256, 400, 400, v_thumbnail_path
  );

  select master_storage_path, thumbnail_storage_path
    into v_old_master_storage_path, v_old_thumbnail_storage_path
    from public.catalog_assets
   where business_id = v_upload.business_id and sku = v_product.sku
   for update;

  insert into public.catalog_assets (
    business_id, external_id, sku, safe_sku, identity_sha256, product_id,
    master_path, master_sha256, master_binding_sha256, master_width, master_height,
    thumbnail_path, thumbnail_sha256, thumbnail_binding_sha256, thumbnail_width, thumbnail_height,
    master_storage_path, thumbnail_storage_path, source_sha256, source_url,
    rights_status, rights_reference, approved_at, approved_by, catalog_origin
  ) values (
    v_upload.business_id, v_external_id, v_product.sku, v_safe_sku, v_identity_sha256, v_upload.product_id,
    v_master_path, v_upload.master_sha256, v_master_binding_sha256, 1000, 1000,
    v_thumbnail_path, v_upload.thumbnail_sha256, v_thumbnail_binding_sha256, 400, 400,
    v_master_storage_path, v_thumbnail_storage_path, v_upload.source_sha256, v_upload.source_url,
    p_rights_status, btrim(p_rights_reference), statement_timestamp(), p_actor_user_id, 'commercial'
  )
  on conflict (business_id, sku) do update set
    external_id = excluded.external_id,
    safe_sku = excluded.safe_sku,
    identity_sha256 = excluded.identity_sha256,
    product_id = excluded.product_id,
    master_path = excluded.master_path,
    master_sha256 = excluded.master_sha256,
    master_binding_sha256 = excluded.master_binding_sha256,
    master_width = excluded.master_width,
    master_height = excluded.master_height,
    thumbnail_path = excluded.thumbnail_path,
    thumbnail_sha256 = excluded.thumbnail_sha256,
    thumbnail_binding_sha256 = excluded.thumbnail_binding_sha256,
    thumbnail_width = excluded.thumbnail_width,
    thumbnail_height = excluded.thumbnail_height,
    master_storage_path = excluded.master_storage_path,
    thumbnail_storage_path = excluded.thumbnail_storage_path,
    source_sha256 = excluded.source_sha256,
    source_url = excluded.source_url,
    rights_status = excluded.rights_status,
    rights_reference = excluded.rights_reference,
    approved_at = excluded.approved_at,
    approved_by = excluded.approved_by,
    catalog_origin = excluded.catalog_origin,
    updated_at = statement_timestamp()
  returning id into v_asset_id;

  update public.products
     set catalog_asset_id = v_asset_id,
         image_url = v_master_path,
         image_sha256 = v_upload.master_sha256,
         image_thumbnail_url = v_thumbnail_path,
         image_thumbnail_sha256 = v_upload.thumbnail_sha256,
         source_image_sha256 = v_upload.source_sha256
   where id = v_product.id
     and business_id = v_upload.business_id
     and not available
     and not is_verified;
  if not found then
    raise exception 'catalog image target changed before association' using errcode = 'serialization_failure';
  end if;

  update public.catalog_image_uploads
     set status = 'approved',
         license_status = 'approved',
         rights_status = p_rights_status,
         rights_reference = btrim(p_rights_reference),
         reviewed_at = statement_timestamp(),
    reviewed_by = p_actor_user_id,
    catalog_asset_id = v_asset_id,
    public_master_path = v_master_storage_path,
    public_thumbnail_path = v_thumbnail_storage_path,
    previous_master_path = v_old_master_storage_path,
    previous_thumbnail_path = v_old_thumbnail_storage_path,
         cleanup_status = 'pending',
         updated_at = statement_timestamp()
   where id = p_upload_id;

  return jsonb_build_object(
    'catalog_asset_id', v_asset_id,
    'master_path', v_master_storage_path,
    'thumbnail_path', v_thumbnail_storage_path,
    'old_master_path', v_old_master_storage_path,
    'old_thumbnail_path', v_old_thumbnail_storage_path,
    'business_id', v_upload.business_id,
    'product_id', v_upload.product_id
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.assign_order_rider(p_order_id uuid, p_expected_status text, p_expected_rider_user_id uuid, p_new_rider_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_business_id uuid;
  v_user_id uuid := auth.uid();
  v_expected_status text := lower(btrim(coalesce(p_expected_status, '')));
  v_active integer;
  v_max integer := public.rider_max_active_orders();
begin
  if v_user_id is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null or p_new_rider_user_id is null then
    raise exception 'order_id y rider requeridos' using errcode = '22023';
  end if;

  select o.business_id
    into v_business_id
    from public.orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  if not public.has_business_role(v_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;

  -- Capacidad del destinatario, antes de tocar la fila. Dos operadores que
  -- asignan pedidos distintos al mismo Rider 2/3 se ordenan aca.
  perform public.lock_rider_capacity(p_new_rider_user_id);

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  if v_order.delivery_mode <> 'delivery' then
    raise exception 'los pedidos con retiro no admiten rider' using errcode = '42501';
  end if;

  perform 1
    from public.business_members bm
   where bm.business_id = v_order.business_id
     and bm.user_id = p_new_rider_user_id
     and bm.role = 'rider'
     and bm.is_active = true
   for share;
  if not found then
    raise exception 'rider activo del negocio requerido' using errcode = '42501';
  end if;

  if v_expected_status not in ('ready', 'assigned')
    or v_order.status <> v_expected_status
    or v_order.status not in ('ready', 'assigned')
    or v_order.assigned_rider_user_id is distinct from p_expected_rider_user_id then
    raise exception 'conflicto de asignacion: estado o rider esperado cambio'
      using errcode = 'PT409';
  end if;

  if v_order.assigned_rider_user_id = p_new_rider_user_id
    and v_order.status = 'assigned' then
    return public.rider_order_rpc_payload(v_order.id);
  end if;

  v_active := public.count_rider_active_orders(v_order.business_id, p_new_rider_user_id, v_order.id);
  if v_active >= v_max then
    raise exception 'el rider ya tiene % entregas activas, el maximo es %', v_active, v_max
      using errcode = '23514';
  end if;

  update public.orders
     set assigned_rider_user_id = p_new_rider_user_id,
         status = 'assigned'
   where id = v_order.id;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_user_id,
    'business',
    'business',
    v_user_id,
    case when v_order.assigned_rider_user_id is null then 'order.rider_assigned' else 'order.rider_reassigned' end,
    case when v_order.assigned_rider_user_id is null then 'order.rider_assigned' else 'order.rider_reassigned' end,
    case when v_order.assigned_rider_user_id is null then 'Rider asignado por el negocio' else 'Rider reasignado por el negocio' end,
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id,
      'rider_active_orders', v_active + 1,
      'rider_max_active_orders', v_max
    ),
    jsonb_build_object(
      'previous_rider_user_id', v_order.assigned_rider_user_id,
      'next_rider_user_id', p_new_rider_user_id
    )
  );

  return public.rider_order_rpc_payload(v_order.id);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_order(p_order_id uuid, p_expected_revision bigint, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 300 then raise exception 'motivo de cancelacion requerido' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  -- Cancelar pide el permiso `orders.cancel` del catálogo (`identity_role_permissions`),
  -- no un rol de una lista: el catálogo es lo que el Panel le muestra a cada persona y
  -- tiene que ser lo mismo que el servidor hace valer. Va acá, antes de mirar el cobro,
  -- la clave de idempotencia o la revisión: quien no puede cancelar no se entera de
  -- nada más del pedido.
  if not public.identity_has_permission(v_order.business_id, 'orders.cancel') then
    raise exception 'operador sin permiso para cancelar o rechazar pedidos'
      using errcode = '42501', detail = 'PERMISSION_REQUIRED: orders.cancel';
  end if;

  if lower(btrim(coalesce(v_order.payment_method, ''))) = 'mercadopago'
     or exists (
       select 1 from public.payment_intents pi
        where pi.order_id = v_order.id
          and pi.internal_status in (
            'approved', 'approved_order_pending', 'completed',
            'partially_refunded', 'refunded', 'security_review_required'
          )
     ) then
    if not public.order_payment_is_financially_reversed(v_order.id) then
    raise exception 'pedido cobrado por Mercado Pago: gestionar reembolso antes de cancelar'
      using errcode = '55000';
    end if;
  end if;

  v_hash := public.business_command_request_hash('cancel_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'reason', btrim(p_reason)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  v_result := public.transition_order(p_order_id, p_expected_revision, 'canceled');
  -- Ya estaba cancelado: esta llamada no canceló nada, así que no deja motivo ni
  -- recibo. El motivo que queda en el historial es el de quien sí canceló.
  if coalesce((v_result ->> 'idempotent_no_op')::boolean, false) then
    return v_result || jsonb_build_object('idempotent_replay', false);
  end if;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'business_cancel_reason', 'business_cancel_reason', 'Cancelacion registrada.', jsonb_build_object('reason', btrim(p_reason)));
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'cancel_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_own_order(p_order_id uuid, p_idempotency_key text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_customer_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_status text;
  v_reason text;
  v_prior_key text;
  v_cancelled_here boolean;
  v_result jsonb;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;
  -- El tope va sobre lo que llegó, antes de limpiarlo: un texto enorme se rechaza
  -- sin recorrerlo. Limpiar sólo puede acortarlo.
  if char_length(p_reason) > 300 then
    raise exception 'motivo de cancelacion demasiado largo' using errcode = '22023';
  end if;
  v_reason := nullif(btrim(regexp_replace(coalesce(p_reason, ''), '[[:cntrl:]]+', ' ', 'g')), '');

  -- El dueño va en el WHERE, no en un IF posterior: un pedido ajeno no se bloquea ni
  -- se distingue de uno inexistente, ni por la respuesta ni por la espera de un lock.
  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.customer_user_id = v_customer_id
   for update;

  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  v_status := public.normalize_order_status_vocabulary(v_order.status);

  if v_status = 'cancelled' then
    select e.metadata ->> 'idempotency_key'
      into v_prior_key
      from public.order_events e
     where e.order_id = v_order.id
       and e.event_type = 'order.cancelled_by_customer'
     order by e.sequence desc
     limit 1;
    v_cancelled_here := found;

    select to_jsonb(o)
           || jsonb_build_object(
                'order_items',
                coalesce(
                  (
                    select jsonb_agg(to_jsonb(oi) order by oi.created_at, oi.id)
                      from public.order_items oi
                     where oi.order_id = o.id
                  ),
                  '[]'::jsonb
                ),
                'rider_locations', '[]'::jsonb
              )
      into v_result
      from public.orders o
     where o.id = v_order.id;

    return v_result || jsonb_build_object(
      'idempotent_no_op', true,
      'idempotent_replay', coalesce(v_prior_key = btrim(p_idempotency_key), false),
      'cancelled_by_customer', v_cancelled_here
    );
  end if;

  if lower(btrim(coalesce(v_order.payment_method, ''))) = 'mercadopago'
     or exists (select 1 from public.payment_intents pi where pi.order_id = v_order.id) then
    raise exception 'pedido pagado por Mercado Pago: pedir la cancelacion al comercio, que gestiona el reembolso'
      using errcode = '55000', detail = 'ORDER_PAID_ONLINE';
  end if;
  if lower(btrim(coalesce(v_order.payment_method, ''))) not in ('cash', 'coordinate') then
    raise exception 'este pedido no se puede cancelar desde la aplicacion'
      using errcode = '55000', detail = 'ORDER_NOT_CANCELLABLE';
  end if;
  if v_status in ('delivered', 'rejected') then
    raise exception 'el pedido ya esta cerrado'
      using errcode = '55000', detail = 'ORDER_CLOSED';
  end if;
  if v_status <> 'submitted' then
    raise exception 'el comercio ya tomo el pedido: pedir la cancelacion al comercio'
      using errcode = '55000', detail = 'ORDER_ALREADY_TAKEN';
  end if;
  if v_order.manual_payment_status is distinct from 'pending' then
    raise exception 'el pedido ya tiene un cobro registrado: pedir la cancelacion al comercio'
      using errcode = '55000', detail = 'MANUAL_PAYMENT_RECORDED';
  end if;

  v_result := public.change_order_status(v_order.id, v_order.status, 'cancelled');

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id, v_order.business_id, v_customer_id, 'customer', 'customer', v_customer_id,
    'order.cancelled_by_customer', 'order.cancelled_by_customer',
    'Pedido cancelado por el cliente.',
    jsonb_build_object(
      'reason', v_reason,
      'previous_status', v_order.status,
      'idempotency_key', btrim(p_idempotency_key)
    ),
    jsonb_build_object(
      'reason', v_reason,
      'previous_status', v_order.status,
      'idempotency_key', btrim(p_idempotency_key)
    )
  );

  return v_result || jsonb_build_object(
    'idempotent_no_op', false,
    'idempotent_replay', false,
    'cancelled_by_customer', true
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_delivery_order(p_business_id uuid, p_public_code text, p_expected_revision bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
  v_fingerprint bytea;
  v_active integer;
  v_max integer := public.rider_max_active_orders();
begin
  perform public.rider_require_active_membership(p_business_id);
  if p_expected_revision is null or p_expected_revision < 1 or btrim(coalesce(p_public_code, '')) = '' then
    raise exception 'claim invalido' using errcode = '22023';
  end if;

  -- El lock de capacidad, ANTES de bloquear el pedido. Dos claims simultaneos
  -- del mismo Rider se ordenan aca.
  perform public.lock_rider_capacity(auth.uid());

  select o.* into v_order
    from public.orders o
   where o.business_id = p_business_id
     and o.public_code = btrim(p_public_code)
   for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_available'); end if;
  if v_order.origin <> 'production' then
    return jsonb_build_object('ok', false, 'code', 'not_available');
  end if;
  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid()
     and operation = 'claim' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;

  v_active := public.count_rider_active_orders(p_business_id, auth.uid(), v_order.id);
  if v_active >= v_max then
    return jsonb_build_object(
      'ok', false,
      'code', 'at_capacity',
      'active_orders', v_active,
      'max_active_orders', v_max
    );
  end if;

  if v_order.revision <> p_expected_revision then
    return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision);
  end if;
  if v_order.delivery_mode <> 'delivery' or v_order.status <> 'ready' or v_order.assigned_rider_user_id is not null then
    return jsonb_build_object('ok', false, 'code', 'taken_by_other', 'revision', v_order.revision);
  end if;
  update public.orders
     set assigned_rider_user_id = auth.uid(), status = 'assigned'
   where id = v_order.id
     and revision = p_expected_revision
     and assigned_rider_user_id is null
     and status = 'ready';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'taken_by_other', 'revision', v_order.revision);
  end if;
  v_result := jsonb_build_object(
    'ok', true,
    'outcome', 'claimed',
    'idempotent_no_op', false,
    'order', public.rider_active_delivery_payload(v_order.id)
  );
  v_fingerprint := digest(jsonb_build_object('public_code', v_order.public_code, 'revision', p_expected_revision)::text, 'sha256');
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'claim', v_key, v_fingerprint, v_result);
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_payment_outbox_v2(p_owner text, p_limit integer DEFAULT 20, p_lease_seconds integer DEFAULT 90)
 RETURNS SETOF public.payment_outbox
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

begin
  if nullif(btrim(p_owner), '') is null then raise exception 'owner requerido' using errcode = '22023'; end if;
  return query
  with candidate as (
    select o.id
      from public.payment_outbox o
     where (
       (o.status in ('pending', 'retry_wait') and o.next_attempt_at <= clock_timestamp())
       or (o.status in ('claimed', 'processing') and coalesce(o.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp())
     )
     order by o.next_attempt_at, o.created_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.payment_outbox o
     set status = 'claimed', owner = left(btrim(p_owner), 200),
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(15, least(coalesce(p_lease_seconds, 90), 600))),
         attempts = o.attempts + 1
    from candidate c
   where o.id = c.id
  returning o.*;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.classify_order_as_qa(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor uuid := auth.uid();
begin
  if v_reason is null or char_length(v_reason) > 120 or v_reason !~ '^[a-z0-9_]+$' then
    raise exception 'motivo requerido en snake_case de hasta 120 caracteres' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;

  -- El service_role certifica sin sesión; una persona necesita rol del negocio.
  if v_actor is not null
     and not public.has_business_role(v_order.business_id, array['owner', 'admin']) then
    raise exception 'solo owner o admin pueden reclasificar un pedido' using errcode = '42501';
  end if;

  if v_order.origin = 'qa' then
    return jsonb_build_object(
      'ok', true,
      'order_id', v_order.id,
      'public_code', v_order.public_code,
      'origin', 'qa',
      'origin_reason', v_order.origin_reason,
      'idempotent_no_op', true
    );
  end if;

  -- Sólo se toca la clasificación: estado, rider, stock y tiempos quedan como
  -- están, y `bump_order_revision` deja la revisión intacta para no invalidar
  -- la vista de quien esté operando.
  update public.orders
     set origin = 'qa',
         origin_reason = v_reason,
         origin_classified_at = clock_timestamp()
   where id = v_order.id;

  update public.notification_outbox n
     set state = 'processed',
         processed_at = coalesce(n.processed_at, clock_timestamp()),
         payload = n.payload || jsonb_build_object('suppressed', true, 'suppressed_reason', v_reason)
   where n.aggregate_id = v_order.id
     and n.event_type = 'new_order'
     and n.state = 'pending';

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id,
    v_order.business_id,
    v_actor,
    case when v_actor is null then 'system' else 'business' end,
    case when v_actor is null then 'system' else 'business' end,
    'order.origin_classified',
    'order.origin_classified',
    'Pedido reclasificado como QA; se conserva como evidencia y sale de la operación real.',
    jsonb_build_object('origin', 'qa', 'origin_reason', v_reason, 'previous_origin', v_order.origin),
    jsonb_build_object('origin', 'qa', 'origin_reason', v_reason, 'previous_origin', v_order.origin)
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'public_code', v_order.public_code,
    'origin', 'qa',
    'origin_reason', v_reason,
    'idempotent_no_op', false
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_expired_qa_windows()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_closed integer;
begin
  update public.businesses
     set status = 'closed', qa_window_until = null, updated_at = now()
   where qa_fixture
     and status <> 'closed'
     and (qa_window_until is null or qa_window_until <= clock_timestamp());
  get diagnostics v_closed = row_count;
  return v_closed;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.close_qa_window(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'cerrar una ventana QA requiere owner o admin' using errcode = '42501';
  end if;
  update public.businesses
     set status = 'closed', qa_window_until = null, updated_at = now()
   where id = p_business_id and qa_fixture
  returning * into v_business;
  if not found then
    raise exception 'sólo un tenant QA cierra ventana QA' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'status', v_business.status);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_catalog_image_upload(p_upload_id uuid, p_actor_user_id uuid, p_source_sha256 text, p_master_sha256 text, p_thumbnail_sha256 text, p_source_bytes bigint, p_master_bytes bigint, p_thumbnail_bytes bigint)
 RETURNS public.catalog_image_uploads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_upload public.catalog_image_uploads%rowtype;
begin
  select * into v_upload from public.catalog_image_uploads where id = p_upload_id for update;
  if not found
     or not public.catalog_image_upload_actor_allowed(v_upload.business_id, v_upload.product_id, p_actor_user_id) then
    raise exception 'catalog image upload not found' using errcode = 'no_data_found';
  end if;
  if v_upload.status <> 'pending' or v_upload.upload_completed_at is not null then
    raise exception 'catalog image upload cannot be finalized in its current state' using errcode = 'check_violation';
  end if;
  if p_source_sha256 is null or p_source_sha256 !~ '^[a-f0-9]{64}$'
     or p_master_sha256 is null or p_master_sha256 !~ '^[a-f0-9]{64}$'
     or p_thumbnail_sha256 is null or p_thumbnail_sha256 !~ '^[a-f0-9]{64}$'
     or p_source_bytes is null or p_source_bytes not between 1 and 5242880
     or p_master_bytes is null or p_master_bytes not between 1 and 5242880
     or p_thumbnail_bytes is null or p_thumbnail_bytes not between 1 and 5242880 then
    raise exception 'catalog image upload metadata is invalid' using errcode = 'check_violation';
  end if;

  update public.catalog_image_uploads
     set source_sha256 = p_source_sha256,
         master_sha256 = p_master_sha256,
         thumbnail_sha256 = p_thumbnail_sha256,
         original_bytes = p_source_bytes,
         master_bytes = p_master_bytes,
         thumbnail_bytes = p_thumbnail_bytes,
         master_width = 1000,
         master_height = 1000,
         thumbnail_width = 400,
         thumbnail_height = 400,
         upload_completed_at = statement_timestamp(),
         updated_at = statement_timestamp()
   where id = p_upload_id
   returning * into v_upload;
  return v_upload;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_delivery_without_code(p_order_id uuid, p_expected_revision bigint, p_reason_code text, p_idempotency_key text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_reason text := lower(btrim(coalesce(p_reason_code, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_status text;
  v_member_role text;
  v_hash text;
  v_now timestamptz;
  v_handoff_state text;
  v_failed_attempts integer;
  v_detail jsonb;
  v_updated integer;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  -- Dueño o encargado. Ni el empleado ni el repartidor, tampoco el que lleva este
  -- pedido: que quien entrega o quien atiende el mostrador pueda cerrar sin el código
  -- es justo lo que el código le garantiza al cliente que no pasa.
  if not public.has_business_role(v_order.business_id, array['owner', 'admin']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'este cierre es para pedidos con envio' using errcode = '42501';
  end if;
  if v_reason not in ('customer_lost_code', 'customer_without_device', 'rider_unavailable', 'code_locked', 'other') then
    raise exception 'motivo de cierre sin codigo invalido' using errcode = '22023';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'la nota admite hasta 200 caracteres' using errcode = '22023';
  end if;

  -- La idempotencia del Panel: la misma tabla y la misma huella que el resto de sus
  -- comandos. La huella incluye el motivo y la nota: la misma clave con otro motivo
  -- es otro comando, no un reintento.
  v_hash := public.business_command_request_hash(
    'complete_delivery_without_code', p_order_id,
    jsonb_build_object('expected_revision', p_expected_revision, 'reason_code', v_reason, 'note', v_note));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505';
    end if;
    return (v_existing.result - 'operator_note') || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Doble toque sobre un pedido ya entregado: exito, sin tocar nada.
  v_status := public.normalize_order_status_vocabulary(v_order.status);
  if v_status = 'delivered' then
    select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
    return v_result || jsonb_build_object('ok', true, 'outcome', 'already_delivered', 'idempotent_replay', false);
  end if;

  if p_expected_revision is null
    or v_order.revision is distinct from p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision, v_order.revision using errcode = 'PT409';
  end if;
  -- Sólo mientras la mercadería está afuera. Antes de salir, el pedido se cancela o
  -- se despacha por el camino de siempre; no hay nada que cerrar a mano.
  if v_status not in ('picked_up', 'on_the_way', 'arrived') then
    raise exception 'el pedido tiene que haber salido del local para cerrarlo sin codigo' using errcode = '23514';
  end if;
  -- Misma regla que arriba, leída una sola vez para anotarla. Si el rol cambió entre
  -- las dos lecturas, se niega: no se anota un rol que no autorizaba.
  v_member_role := public.identity_member_role(v_order.business_id);
  if v_member_role is null or v_member_role not in ('owner', 'admin') then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  -- Cómo estaba el código, sólo para dejarlo dicho. La fila NO se toca: un bloqueo por
  -- intentos fallidos no frena este cierre (no usa el código) y tampoco se borra.
  v_now := clock_timestamp();
  select h.* into v_handoff from public.order_delivery_handoffs h where h.order_id = v_order.id;
  v_handoff_state := case
    when v_handoff.order_id is null then 'not_issued'
    when v_handoff.confirmed_at is not null then 'confirmed'
    when v_handoff.expires_at <= v_now then 'expired'
    when v_handoff.locked_until is not null and v_handoff.locked_until > v_now then 'locked'
    else 'active'
  end;
  v_failed_attempts := coalesce(v_handoff.failed_attempts, 0);

  -- La marca va ANTES del update: `prevent_unverified_delivery` la busca para esta
  -- revisión del pedido.
  insert into public.order_delivery_overrides (
    order_id, order_revision, business_id, reason_code, actor_user_id, actor_member_role,
    previous_status, rider_assigned, code_required, handoff_state, failed_attempts, created_at)
  values (
    v_order.id, v_order.revision, v_order.business_id, v_reason, auth.uid(), v_member_role,
    v_status, v_order.assigned_rider_user_id is not null, v_order.delivery_code_required,
    v_handoff_state, v_failed_attempts, v_now);

  -- El mismo UPDATE que usa el cierre con código, con el mismo pase de transacción:
  -- `prevent_business_delivery_over_rider` no deja que nadie del comercio escriba
  -- `delivered` fuera de una función de cierre. El pase no dice que hubo código; lo
  -- que hubo queda en la marca y en el evento.
  perform set_config('taba.delivery_code_confirmed', 'true', true);
  update public.orders set status = 'delivered' where id = v_order.id and status = v_order.status;
  get diagnostics v_updated = row_count;
  perform set_config('taba.delivery_code_confirmed', '', true);
  if v_updated <> 1 then
    raise exception 'conflicto de estado: el pedido cambio durante el cierre' using errcode = 'PT409';
  end if;

  -- Sin la nota, sin el código y sin ningún id de persona que no sea el del operador,
  -- que va en la columna de siempre.
  v_detail := jsonb_build_object(
    'previous_status', v_order.status,
    'delivery_mode', v_order.delivery_mode,
    'reason_code', v_reason,
    'code_verified', false,
    'code_required', v_order.delivery_code_required,
    'rider_assigned', v_order.assigned_rider_user_id is not null,
    'handoff_state', v_handoff_state,
    'failed_attempts', v_failed_attempts,
    'actor_member_role', v_member_role);
  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_order.id, v_order.business_id, auth.uid(), 'business', 'business', auth.uid(),
    'order.delivered_without_code', 'order.delivered_without_code',
    'Entrega cerrada por el dueno o el encargado sin el codigo del cliente.',
    v_detail, v_detail
  );

  select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
  v_result := v_result || jsonb_build_object(
    'ok', true, 'outcome', 'completed_without_code',
    'code_verified', false, 'reason_code', v_reason,
    'idempotent_replay', false);

  -- La nota queda SÓLO acá: puede traer datos de una persona escritos a mano.
  insert into public.business_command_receipts(
    business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'complete_delivery_without_code',
          p_idempotency_key, v_hash,
          v_result || jsonb_strip_nulls(jsonb_build_object('operator_note', v_note)));

  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_payment_outbox_job(p_job_id uuid, p_owner text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_receipt_id uuid;
begin
  update public.payment_outbox set status = 'completed', completed_at = clock_timestamp(), lease_expires_at = null
   where id = p_job_id and owner = p_owner and status = 'processing'
   returning webhook_receipt_id into v_receipt_id;
  if not found then return false; end if;
  if v_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = 'completed', processed_at = clock_timestamp() where id = v_receipt_id;
  end if;
  return true;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.complete_scanned_product(p_product_id uuid, p_details jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_product public.products%rowtype;
  v_allowed text[] := array['name', 'brand', 'category', 'variant', 'capacity_value', 'capacity_unit', 'units_per_pack', 'price', 'price_pending', 'unit_cost', 'stock',
    'subcategory', 'packaging_type', 'expected_stock'];
  v_price numeric(12, 2);
  v_price_pending boolean;
  v_stock integer;
  v_units integer;
  v_capacity_value numeric;
  v_capacity_unit text;
  v_before public.products%rowtype;
  v_expected_stock integer;
  v_reserved integer;
  v_new_stock integer;
  v_settled jsonb;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_product.business_id, array['owner', 'admin']) then
    raise exception 'completar el producto requiere owner o admin' using errcode = '42501';
  end if;
  if coalesce(p_details, '{}'::jsonb) - v_allowed <> '{}'::jsonb then
    raise exception 'payload no permitido' using errcode = '22023';
  end if;
  v_before := v_product;

  v_price_pending := coalesce((p_details->>'price_pending')::boolean, false);
  v_price := case when v_price_pending then 0 else round(coalesce((p_details->>'price')::numeric, -1), 2) end;
  -- Sin la clave `stock` (o con null) la ficha no trae conteo. Sobre un producto ya
  -- contado eso quiere decir «no toqué el stock»: antes era obligatorio reenviarlo, y
  -- reenviar el DISPONIBLE como si fuera un conteo le resta lo reservado cada vez.
  v_stock := (p_details->>'stock')::integer;
  v_units := coalesce((p_details->>'units_per_pack')::integer, 0);
  v_capacity_value := coalesce((p_details->>'capacity_value')::numeric, 0);
  v_capacity_unit := btrim(coalesce(p_details->>'capacity_unit', ''));

  if char_length(btrim(coalesce(p_details->>'name', ''))) not between 2 and 160
     or char_length(btrim(coalesce(p_details->>'brand', ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_details->>'category', ''))) not between 2 and 80
     or char_length(btrim(coalesce(p_details->>'variant', ''))) not between 1 and 80 then
    raise exception 'faltan datos obligatorios del producto' using errcode = '22023';
  end if;
  -- Envase y subfamilia son opcionales acá (el alta escaneada no los manda), pero
  -- sin ellos la ficha no se puede verificar. Antes sólo los escribía el import
  -- técnico: un alta de planilla no tenía por dónde completarlos.
  if (p_details ? 'subcategory' and char_length(btrim(coalesce(p_details->>'subcategory', ''))) not between 1 and 80)
     or (p_details ? 'packaging_type' and char_length(btrim(coalesce(p_details->>'packaging_type', ''))) not between 1 and 80) then
    raise exception 'envase o subfamilia invalidos' using errcode = '22023';
  end if;
  if v_capacity_value <= 0 or v_capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad') then
    raise exception 'presentacion invalida' using errcode = '22023';
  end if;
  if v_units < 1 then
    raise exception 'unidades por pack invalidas' using errcode = '22023';
  end if;
  if v_stock < 0 or (v_stock is null and v_product.stock is null) then
    raise exception 'stock invalido' using errcode = '22023';
  end if;
  if not v_price_pending and v_price <= 0 then
    raise exception 'precio invalido' using errcode = '22023';
  end if;

  -- La misma guarda optimista del lote comercial, opcional.
  if p_details ? 'expected_stock' then
    if jsonb_typeof(p_details -> 'expected_stock') = 'null' or btrim(p_details ->> 'expected_stock') = '' then
      v_expected_stock := null;
    elsif (p_details ->> 'expected_stock') !~ '^[0-9]+$' or (p_details ->> 'expected_stock')::numeric > 2147483647 then
      raise exception 'stock esperado invalido' using errcode = '22023';
    else
      v_expected_stock := (p_details ->> 'expected_stock')::integer;
    end if;
    if v_product.stock is distinct from v_expected_stock then
      raise exception 'El stock de % cambió mientras lo editabas: la pantalla mostraba % y ahora hay %. Actualizá el producto y volvé a contar; no se guardó nada.',
        v_product.name, coalesce(v_expected_stock::text, 'sin contar'), coalesce(v_product.stock::text, 'sin contar')
        using errcode = 'PT409';
    end if;
  end if;

  -- El stock de la ficha es un conteo físico: se traduce a disponible igual que
  -- en el lote comercial y en Caja Clara.
  if v_stock is null then
    v_reserved := null;
    v_new_stock := v_product.stock;
  else
    v_reserved := private.pos_reserved_quantity(v_product.id);
    v_new_stock := greatest(v_stock - v_reserved, 0);
  end if;

  update public.products set
    name = btrim(p_details->>'name'),
    brand = btrim(p_details->>'brand'),
    category = btrim(p_details->>'category'),
    subcategory = case when p_details ? 'subcategory' then btrim(p_details->>'subcategory') else subcategory end,
    variant = btrim(p_details->>'variant'),
    presentation = btrim(p_details->>'variant'),
    capacity_value = v_capacity_value,
    capacity_unit = v_capacity_unit,
    capacity = v_capacity_value::text || ' ' || v_capacity_unit,
    packaging_type = case when p_details ? 'packaging_type' then btrim(p_details->>'packaging_type') else packaging_type end,
    units_per_pack = v_units,
    price = v_price,
    price_status = case when v_price_pending then 'pending' else 'confirmed' end,
    unit_cost = nullif(p_details->>'unit_cost', '')::numeric,
    stock = v_new_stock,
    -- Completar la ficha nunca publica: sólo conserva lo que ya estaba a la venta
    -- y lo apaga si deja de poder venderse. Antes escribía `true` sin mirar la
    -- intención del comercio, y sobre un producto verificado que el comercio
    -- había ocultado fallaba con un 23514 crudo.
    available = available and (not v_price_pending) and v_new_stock > 0 and is_verified,
    updated_at = now()
  where id = v_product.id
  returning * into v_product;

  if v_stock is not null then
    v_settled := private.catalog_stock_count_settle(
      v_product.business_id, v_product.id, v_before.stock, v_new_stock, v_stock, v_reserved,
      format('Conteo físico al completar la ficha: contado %s, reservado %s', v_stock, v_reserved),
      'scanned_product', v_product.id,
      'csp_' || md5(v_product.id::text || ':' || txid_current()::text || ':' || clock_timestamp()::text),
      true);
    select * into v_product from public.products where id = v_product.id;
  end if;

  insert into public.scanned_product_audit (business_id, product_id, gtin, action, actor_id, detail)
  values (
    v_product.business_id,
    v_product.id,
    coalesce((select pb.gtin from public.product_barcodes pb where pb.product_id = v_product.id and pb.is_primary limit 1), ''),
    case when v_price_pending then 'completed' else 'price_confirmed' end,
    auth.uid(),
    jsonb_build_object('price_status', v_product.price_status, 'stock', v_product.stock)
  );

  perform private.catalog_change_record_single(
    'scanned_product', v_before, coalesce(p_details, '{}'::jsonb) - 'unit_cost',
    v_stock, v_reserved, (v_settled ->> 'movement_id')::uuid,
    jsonb_build_object(
      'shortfall', nullif((v_settled ->> 'shortfall')::integer, 0),
      'conflict_id', v_settled ->> 'conflict_id',
      'conflict_resolved', case when (v_settled ->> 'conflict_resolved')::boolean then true end,
      'reoffered', case when (v_settled ->> 'reoffered')::boolean then true end));

  return public.get_scanned_product_readiness(v_product.id);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.configure_mercadopago_settings(p_business_id uuid, p_settings jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_settings public.business_payment_settings%rowtype;
  v_allowed text[] := array['collector_id', 'application_id', 'installments_limit', 'preference_expiration_minutes', 'reserve_stock', 'enabled'];
  v_collector text;
  v_application text;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'configuracion de cobros requiere owner o admin' using errcode = '42501';
  end if;
  -- Cualquier clave fuera de la lista se rechaza: impide que un secreto entre por esta puerta.
  if coalesce(p_settings, '{}'::jsonb) - v_allowed <> '{}'::jsonb then
    raise exception 'payload no permitido' using errcode = '22023';
  end if;

  v_collector := nullif(btrim(coalesce(p_settings->>'collector_id', '')), '');
  v_application := nullif(btrim(coalesce(p_settings->>'application_id', '')), '');
  if v_collector is not null and v_collector !~ '^[0-9]{6,32}$' then
    raise exception 'identificador de vendedor invalido' using errcode = '22023';
  end if;
  if v_application is not null and v_application !~ '^[0-9]{6,32}$' then
    raise exception 'identificador de aplicacion invalido' using errcode = '22023';
  end if;

  insert into public.business_payment_settings (
    business_id, provider, environment, checkout_mode, currency, reserve_stock,
    collector_id, application_id, configured_at
  )
  values (
    p_business_id, 'mercadopago', 'test', 'checkout_pro', 'ARS', true,
    v_collector, v_application, clock_timestamp()
  )
  on conflict (business_id, provider) do nothing;

  select * into v_settings from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago' for update;

  -- El panel opera únicamente el ambiente de prueba; el pase a dinero real es una decisión aparte.
  if v_settings.environment <> 'test' then
    raise exception 'el panel no configura cobros con dinero real' using errcode = '42501';
  end if;

  update public.business_payment_settings set
    collector_id = coalesce(v_collector, collector_id),
    application_id = coalesce(v_application, application_id),
    installments_limit = case
      when p_settings ? 'installments_limit' then nullif(p_settings->>'installments_limit', '')::integer
      else installments_limit
    end,
    preference_expiration_minutes = case
      when p_settings ? 'preference_expiration_minutes' then (p_settings->>'preference_expiration_minutes')::integer
      else preference_expiration_minutes
    end,
    reserve_stock = case
      when p_settings ? 'reserve_stock' then (p_settings->>'reserve_stock')::boolean
      else reserve_stock
    end,
    enabled = case
      when p_settings ? 'enabled' then (p_settings->>'enabled')::boolean
      else enabled
    end,
    configured_at = coalesce(configured_at, clock_timestamp()),
    updated_at = clock_timestamp()
  where id = v_settings.id
  returning * into v_settings;

  return jsonb_build_object('ok', true, 'enabled', v_settings.enabled, 'environment', v_settings.environment);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_business_delivery_code(p_order_id uuid, p_expected_revision bigint, p_delivery_code text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_code text := regexp_replace(coalesce(p_delivery_code, ''), '[^0-9]', '', 'g');
  v_now timestamptz := clock_timestamp();
  v_attempts integer;
  v_retry_seconds integer;
  v_result jsonb;
  v_attempt_key text;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode = '22023';
  end if;

  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'pedido inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'este cierre es para pedidos con envio' using errcode = '42501';
  end if;
  -- Con repartidor asignado el pedido es suyo: lo cierra el, por su camino.
  if v_order.assigned_rider_user_id is not null then
    raise exception 'la entrega la confirma el repartidor asignado' using errcode = '42501';
  end if;

  -- La idempotencia del Panel: la misma tabla y la misma huella que el resto de
  -- sus comandos. El recibo se guarda cuando la entrega se confirma: el reintento
  -- de un cierre ya hecho devuelve ese recibo. Un codigo equivocado no deja
  -- recibo; su reintento se reconoce mas abajo, por clave y codigo tipeado.
  v_hash := public.business_command_request_hash(
    'confirm_business_delivery_code', p_order_id,
    jsonb_build_object('expected_revision', p_expected_revision));
  select r.* into v_existing from public.business_command_receipts r
   where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505';
    end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;

  -- Doble toque sobre un pedido ya entregado: exito, sin tocar nada.
  if public.normalize_order_status_vocabulary(v_order.status) = 'delivered' then
    select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
    return v_result || jsonb_build_object('ok', true, 'outcome', 'already_delivered', 'idempotent_replay', false);
  end if;

  if p_expected_revision is null
    or v_order.revision is distinct from p_expected_revision then
    raise exception 'revision desactualizada: esperada %, actual %',
      p_expected_revision, v_order.revision using errcode = 'PT409';
  end if;
  if public.normalize_order_status_vocabulary(v_order.status) <> 'on_the_way' then
    raise exception 'el pedido tiene que estar en reparto para cerrarlo' using errcode = '23514';
  end if;

  if v_order.delivery_code_required then
    if v_code !~ '^[0-9]{4}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_format', 'revision', v_order.revision);
    end if;

    select h.* into v_handoff from public.order_delivery_handoffs h
     where h.order_id = v_order.id for update;
    if not found or v_handoff.expires_at <= v_now then
      return jsonb_build_object('ok', false, 'code', 'code_unavailable', 'revision', v_order.revision);
    end if;

    -- La demora vive en la fila del pedido, no en el actor: un intento fallido
    -- del Rider deja esperando tambien al mostrador, y al reves. Una segunda
    -- ventana de intentos por entrar por otra puerta seria justamente el agujero.
    if v_handoff.locked_until is not null and v_handoff.locked_until > v_now then
      v_retry_seconds := greatest(1, ceil(extract(epoch from (v_handoff.locked_until - v_now)))::integer);
      insert into public.delivery_confirmation_attempts(
        business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
      values (v_order.business_id, v_order.id, auth.uid(), left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128),
              'temporarily_locked', greatest(1, v_handoff.failed_attempts - 4), v_retry_seconds)
      on conflict do nothing;
      return jsonb_build_object('ok', false, 'code', 'temporarily_locked',
                                'retry_after_seconds', v_retry_seconds, 'revision', v_order.revision);
    end if;

    if crypt(v_code, v_handoff.code_hash) <> v_handoff.code_hash then
      -- La clave del Panel no lleva el codigo (el mismo comando admite corregirlo),
      -- asi que un intento es la clave MAS el codigo tipeado. El mismo envio repetido
      -- -reintento de red, doble toque, outbox- ya conto el suyo: se contesta con lo
      -- que queda ahora y no gasta otro. Otro codigo equivocado con la misma clave si
      -- es un intento nuevo. Del codigo tipeado se guarda una huella con clave (el
      -- hash del codigo vigente), nunca el codigo: cuatro digitos se adivinan
      -- probando, y una huella sin clave seria el codigo con otro nombre.
      v_attempt_key := left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 111)
        || '-' || substr(encode(hmac(p_idempotency_key || ':' || v_code, v_handoff.code_hash, 'sha256'), 'hex'), 1, 16);
      if exists (
        select 1 from public.delivery_confirmation_attempts a
         where a.order_id = v_order.id and a.rider_id = auth.uid() and a.request_id = v_attempt_key
      ) then
        return jsonb_build_object('ok', false, 'code', 'incorrect_code',
          'remaining_attempts', greatest(0, 5 - v_handoff.failed_attempts),
          'retry_after_seconds', null, 'revision', v_order.revision, 'idempotent_replay', true);
      end if;
      v_attempts := least(20, v_handoff.failed_attempts + 1);
      v_retry_seconds := case when v_attempts < 5 then null
                              else least(86400, 300 * power(2, least(8, v_attempts - 5))::integer) end;
      update public.order_delivery_handoffs
         set failed_attempts = v_attempts,
             locked_until = case when v_retry_seconds is null then null
                                 else v_now + make_interval(secs => v_retry_seconds) end
       where order_id = v_order.id;
      insert into public.delivery_confirmation_attempts(
        business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
      values (v_order.business_id, v_order.id, auth.uid(), v_attempt_key,
              case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end,
              greatest(0, v_attempts - 4), v_retry_seconds)
      on conflict do nothing;
      return jsonb_build_object('ok', false,
        'code', case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end,
        'remaining_attempts', greatest(0, 5 - v_attempts),
        'retry_after_seconds', v_retry_seconds, 'revision', v_order.revision);
    end if;

    -- El codigo es el bueno. Se marca ANTES del update: `prevent_unverified_delivery`
    -- mira esta fila, no una variable de sesion.
    update public.order_delivery_handoffs
       set confirmed_at = v_now, confirmed_by_user_id = auth.uid(),
           failed_attempts = 0, locked_until = null
     where order_id = v_order.id;
    insert into public.delivery_confirmation_attempts(
      business_id, order_id, rider_id, request_id, result)
    values (v_order.business_id, v_order.id, auth.uid(),
            left(regexp_replace(p_idempotency_key, '[^A-Za-z0-9_-]', '-', 'g'), 128), 'confirmed')
    on conflict do nothing;
  end if;

  perform set_config('taba.delivery_code_confirmed', 'true', true);
  update public.orders set status = 'delivered' where id = v_order.id and status = v_order.status;
  perform set_config('taba.delivery_code_confirmed', '', true);

  select to_jsonb(o) into v_result from public.orders o where o.id = v_order.id;
  v_result := v_result || jsonb_build_object(
    'ok', true, 'outcome', 'confirmed',
    'code_verified', v_order.delivery_code_required,
    'idempotent_replay', false);

  insert into public.business_command_receipts(
    business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'confirm_business_delivery_code',
          p_idempotency_key, v_hash, v_result);

  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_delivery_code(p_order_id uuid, p_expected_revision bigint, p_delivery_code text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_code text := regexp_replace(coalesce(p_delivery_code, ''), '[^0-9]', '', 'g');
  v_result jsonb;
  v_now timestamptz;
  v_attempts integer;
  v_lock_level integer;
  v_retry_seconds integer;
begin
  if v_code !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'code', 'invalid_format'); end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'confirm_code' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  select h.* into v_handoff from public.order_delivery_handoffs h where h.order_id = v_order.id for update;
  v_now := clock_timestamp();
  if v_order.status = 'delivered' and v_handoff.confirmed_at is not null then
    v_result := jsonb_build_object('ok', true, 'outcome', 'already_delivered', 'idempotent_no_op', true, 'order', public.rider_active_delivery_payload(v_order.id));
    insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result)
    values (v_order.business_id, v_order.id, auth.uid(), v_key, 'already_delivered') on conflict do nothing;
    insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
    values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
    return v_result;
  end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'arrived' then return jsonb_build_object('ok', false, 'code', 'not_arrived', 'revision', v_order.revision); end if;
  if not found or v_handoff.expires_at <= v_now then return jsonb_build_object('ok', false, 'code', 'code_unavailable'); end if;
  if v_handoff.locked_until is not null and v_handoff.locked_until > v_now then
    v_retry_seconds := greatest(1, ceil(extract(epoch from (v_handoff.locked_until - v_now)))::integer);
    v_result := jsonb_build_object('ok', false, 'code', 'temporarily_locked', 'retry_after_seconds', v_retry_seconds, 'lock_until', v_handoff.locked_until);
    insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
    values (v_order.business_id, v_order.id, auth.uid(), v_key, 'temporarily_locked', greatest(1, v_handoff.failed_attempts - 4), v_retry_seconds);
    insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
    values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
    return v_result;
  end if;
  if crypt(v_code, v_handoff.code_hash) <> v_handoff.code_hash then
    v_attempts := least(20, v_handoff.failed_attempts + 1);
    v_lock_level := greatest(0, v_attempts - 4);
    v_retry_seconds := case when v_attempts < 5 then null else least(86400, 300 * power(2, least(8, v_attempts - 5))::integer) end;
    update public.order_delivery_handoffs set failed_attempts = v_attempts, locked_until = case when v_retry_seconds is null then null else v_now + make_interval(secs => v_retry_seconds) end where order_id = v_order.id;
    v_result := jsonb_build_object('ok', false, 'code', case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end, 'remaining_attempts', greatest(0, 5 - v_attempts), 'retry_after_seconds', v_retry_seconds, 'lock_until', case when v_retry_seconds is null then null else v_now + make_interval(secs => v_retry_seconds) end);
    insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result, lock_level, retry_after_seconds)
    values (v_order.business_id, v_order.id, auth.uid(), v_key, case when v_retry_seconds is null then 'incorrect_code' else 'temporarily_locked' end, v_lock_level, v_retry_seconds);
    insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
    values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
    return v_result;
  end if;
  update public.order_delivery_handoffs set confirmed_at = v_now, confirmed_by_user_id = auth.uid(), failed_attempts = 0, locked_until = null where order_id = v_order.id;
  perform set_config('taba.delivery_code_confirmed', 'true', true);
  update public.orders set status = 'delivered', delivered_at = v_now where id = v_order.id and status = 'arrived';
  insert into public.delivery_outbox(business_id, order_id, event_type, event_key, payload)
  values (v_order.business_id, v_order.id, 'delivery_confirmed', v_key, jsonb_build_object('revision', (select revision from public.orders where id = v_order.id), 'confirmed_at', v_now))
  on conflict (order_id, event_type, event_key) do nothing;
  v_result := jsonb_build_object('ok', true, 'outcome', 'confirmed', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.delivery_confirmation_attempts(business_id, order_id, rider_id, request_id, result)
  values (v_order.business_id, v_order.id, auth.uid(), v_key, 'confirmed');
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'confirm_code', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_manual_order_payment(p_order_id uuid, p_expected_revision bigint, p_actual_method text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
  v_method text := lower(btrim(coalesce(p_actual_method, '')));
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode = '42501'; end if;
  if p_order_id is null or p_expected_revision is null or p_expected_revision < 1
     or btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'Comando de cobro inválido' using errcode = '22023';
  end if;
  if v_method not in ('cash', 'transfer') then
    raise exception 'Medio de cobro manual inválido' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner','admin','staff']) then
    raise exception 'Operador no autorizado' using errcode = '42501';
  end if;
  if v_order.payment_method not in ('cash','coordinate')
     or (v_order.payment_method = 'cash' and v_method <> 'cash') then
    raise exception 'El pedido no admite este cobro manual' using errcode = '22023';
  end if;
  v_hash := public.business_command_request_hash('confirm_manual_order_payment', p_order_id,
    jsonb_build_object('expected_revision',p_expected_revision,'actual_method',v_method));
  select * into v_receipt from public.business_command_receipts
   where business_id = v_order.business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.request_hash <> v_hash then
      raise exception 'Clave de idempotencia reutilizada con otro comando' using errcode = '23505';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay',true,
      'manual_payment_status',v_order.manual_payment_status,'revision',v_order.revision);
  end if;
  if v_order.manual_payment_status = 'reversed' then
    raise exception 'El cobro fue devuelto y no puede confirmarse otra vez' using errcode = '55000';
  end if;
  if v_order.manual_payment_status = 'confirmed' then
    return jsonb_build_object('ok',true,'code','already_confirmed','idempotent_no_op',true,
      'manual_payment_status','confirmed','revision',v_order.revision);
  end if;
  if v_order.status in ('canceled','cancelled','rejected') then
    raise exception 'Pedido terminal sin cobro permitido' using errcode = '55000';
  end if;
  if v_order.revision <> p_expected_revision then
    raise exception 'Revisión de pedido obsoleta' using errcode = 'PT409';
  end if;
  if v_order.total is null or v_order.total <= 0 then
    raise exception 'Monto del pedido inválido' using errcode = '22023';
  end if;
  update public.orders set manual_payment_status = 'confirmed', manual_payment_method = v_method,
    manual_payment_confirmed_at = v_now, manual_payment_confirmed_by = auth.uid()
   where id = p_order_id returning * into v_order;
  insert into public.order_events(order_id,business_id,actor_user_id,actor_role,
    event_type,type,message,metadata)
  values(p_order_id,v_order.business_id,auth.uid(),'business','order.manual_payment_confirmed',
    'order.manual_payment_confirmed','Cobro manual confirmado por el negocio',
    jsonb_build_object('actual_method',v_method,'amount',v_order.total));
  v_result := jsonb_build_object('ok',true,'code','confirmed','manual_payment_status','confirmed',
    'revision',v_order.revision,'amount',v_order.total,'actual_method',v_method);
  insert into public.business_command_receipts(business_id,order_id,actor_user_id,
    command_type,idempotency_key,request_hash,result)
  values(v_order.business_id,p_order_id,auth.uid(),'confirm_manual_order_payment',
    p_idempotency_key,v_hash,v_result);
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_packing_session_once(p_session_id uuid, p_exception_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_session public.order_packing_sessions%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_complete boolean;
  v_hash text;
  v_result jsonb;
begin
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode='22023';
  end if;
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  v_hash:=public.business_command_request_hash(
    'confirm_packing_session',v_session.order_id,
    jsonb_build_object('session_id',p_session_id,'exception_reason',nullif(btrim(coalesce(p_exception_reason,'')),''))
  );
  select r.* into v_receipt from public.business_command_receipts r
  where r.business_id=v_session.business_id and r.idempotency_key=p_idempotency_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode='23505';
    end if;
    return v_receipt.result||jsonb_build_object('idempotent_replay',true);
  end if;
  if v_session.status='confirmed' then
    v_result:=to_jsonb(v_session)||jsonb_build_object('ok',true);
  else
    if v_session.status not in ('in_progress','complete','exception_required') then
      raise exception 'sesion cerrada' using errcode='P0001';
    end if;
    select not exists(
      select 1 from public.order_items oi where oi.order_id=v_session.order_id
        and coalesce((select sum(ps.unit_factor) from public.order_packing_scans ps where ps.session_id=v_session.id and ps.order_item_id=oi.id and ps.reverted_at is null),0)<>oi.quantity
    ) into v_complete;
    if not v_complete and (
      not public.has_business_role(v_session.business_id,array['owner','admin'])
      or char_length(btrim(coalesce(p_exception_reason,''))) not between 3 and 300
    ) then
      raise exception 'faltantes requieren excepcion owner/admin con motivo' using errcode='42501';
    end if;
    update public.order_packing_sessions
    set status='confirmed',exception_reason=case when v_complete then null else btrim(p_exception_reason) end,
        exception_authorized_by=case when v_complete then null else auth.uid() end,
        confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
    where id=p_session_id returning * into v_session;
    v_result:=to_jsonb(v_session)||jsonb_build_object('ok',true);
  end if;
  insert into public.business_command_receipts(
    business_id,order_id,actor_user_id,command_type,idempotency_key,request_hash,result
  ) values (
    v_session.business_id,v_session.order_id,auth.uid(),'confirm_packing_session',p_idempotency_key,v_hash,v_result
  );
  return v_result||jsonb_build_object('idempotent_replay',false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_checkout_session_reserving(p_customer_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_business_id uuid;
  v_business public.businesses%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_client_request_id text;
  v_items jsonb;
  v_contact jsonb;
  v_address jsonb;
  v_fulfillment_type text;
  v_age_confirmed boolean := false;
  v_notes text;
  v_name text;
  v_phone text;
  v_address_id uuid;
  v_saved_address public.customer_addresses%rowtype;
  v_street text;
  v_street_number text;
  v_floor text;
  v_apartment text;
  v_reference text;
  v_city text;
  v_province text;
  v_neighborhood text;
  v_zone jsonb;
  v_minimum numeric(12, 2);
  v_postal_code text;
  v_address_label text;
  v_address_source text;
  v_location_source text;
  v_location_confirmed_at timestamptz;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_geolocation_accuracy numeric(10, 2);
  v_address_snapshot jsonb;
  v_contact_snapshot jsonb;
  v_normalized_items jsonb := '[]'::jsonb;
  v_request_hash text;
  v_session public.checkout_sessions%rowtype;
  v_existing public.checkout_sessions%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_subtotal numeric(12, 2) := 0;
  v_delivery_fee numeric(12, 2) := 0;
  v_total numeric(12, 2) := 0;
  v_contains_alcohol boolean := false;
  v_expires_at timestamptz;
  v_payment_intent_id uuid;
  v_unexpected_key text;
  v_rate_count integer;
  v_normalized_products jsonb := '[]'::jsonb;
  v_normalized_combos jsonb := '[]'::jsonb;
  v_combo record;
  v_combo_row public.product_combos%rowtype;
  v_combo_components jsonb;
  v_combo_component_count integer;
  v_combo_declared_count integer;
  v_combo_list_price numeric(12, 2);
  v_combo_promotional numeric(12, 2);
  v_discount_total numeric(12, 2) := 0;
begin
  if p_customer_id is null then
    raise exception 'cliente autenticado requerido' using errcode = '42501';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'payload de checkout invalido' using errcode = '22023';
  end if;

  select key into v_unexpected_key
    from jsonb_object_keys(p_payload) as keys(key)
   where key not in (
     'business_id', 'client_request_id', 'items', 'fulfillment_type',
     'contact', 'address', 'age_confirmed', 'payment_method',
     -- `notes` faltaba, y la lista blanca rechaza lo que no conoce: mandar las
     -- observaciones desde el cliente habría VOLTEADO el checkout entero.
     'notes'
   )
   limit 1;
  if v_unexpected_key is not null then
    raise exception 'campo no permitido en checkout: %', v_unexpected_key using errcode = '22023';
  end if;

  if coalesce(p_payload ->> 'business_id', '') !~*
     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'business_id invalido' using errcode = '22023';
  end if;
  v_business_id := (p_payload ->> 'business_id')::uuid;
  v_client_request_id := btrim(coalesce(p_payload ->> 'client_request_id', ''));
  v_items := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_contact := p_payload -> 'contact';
  v_address := coalesce(p_payload -> 'address', '{}'::jsonb);
  v_fulfillment_type := lower(btrim(coalesce(p_payload ->> 'fulfillment_type', '')));
  v_age_confirmed := coalesce((p_payload ->> 'age_confirmed')::boolean, false);

  if v_client_request_id !~ '^[A-Za-z0-9_-]{8,128}$' then
    raise exception 'client_request_id invalido' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(p_payload ->> 'payment_method', ''))) <> 'mercadopago' then
    raise exception 'medio de pago invalido para Checkout Pro' using errcode = '22023';
  end if;
  if v_fulfillment_type not in ('delivery', 'pickup') then
    raise exception 'modalidad de entrega invalida' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array'
    or jsonb_array_length(v_items) < 1
    or jsonb_array_length(v_items) > 100 then
    raise exception 'items debe contener entre 1 y 100 productos' using errcode = '22023';
  end if;
  if jsonb_typeof(v_contact) <> 'object' then
    raise exception 'contacto requerido' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_contact) as keys(key)
     where key not in ('name', 'phone')
  ) then
    raise exception 'campo de contacto no permitido' using errcode = '22023';
  end if;
  if jsonb_typeof(v_address) <> 'object' then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_address) as keys(key)
     where key not in (
       'customer_address_id', 'label', 'street', 'street_number', 'floor',
       'apartment', 'reference', 'city', 'province', 'postal_code',
       'neighborhood',
       'latitude', 'longitude', 'geolocation_accuracy', 'source',
       'location_source', 'location_confirmed_at'
     )
  ) then
    raise exception 'campo de direccion no permitido' using errcode = '22023';
  end if;
  -- Una linea es de producto o de combo, nunca las dos. Un combo viaja por su
  -- identificador estable y NUNCA con un precio: el precio lo decide el backend.
  if exists (
    select 1
      from jsonb_array_elements(v_items) as item(value)
     where jsonb_typeof(item.value) <> 'object'
        or not (item.value ? 'quantity')
        or (item.value ->> 'quantity') !~ '^[1-9][0-9]*$'
        or (item.value ? 'product_id') = (item.value ? 'combo_id')
        or (
          (item.value ? 'product_id')
          and (
            (item.value ->> 'product_id') !~*
              '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            or (item.value ->> 'quantity')::numeric > 1000
            or exists (
              select 1 from jsonb_object_keys(item.value) as item_keys(key)
               where item_keys.key not in ('product_id', 'quantity')
            )
          )
        )
        or (
          (item.value ? 'combo_id')
          and (
            (item.value ->> 'combo_id') !~ '^[a-z0-9][a-z0-9-]{2,63}$'
            or (item.value ->> 'quantity')::numeric > 100
            or exists (
              select 1 from jsonb_object_keys(item.value) as item_keys(key)
               where item_keys.key not in ('combo_id', 'quantity')
            )
          )
        )
  ) then
    raise exception 'cada item acepta product_id UUID o combo_id, con quantity entero' using errcode = '22023';
  end if;

  v_name := nullif(regexp_replace(btrim(coalesce(v_contact ->> 'name', '')), '[[:space:]]+', ' ', 'g'), '');
  v_phone := regexp_replace(coalesce(v_contact ->> 'phone', ''), '[^0-9]', '', 'g');
  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 or v_name !~ '[[:alpha:]]' then
    raise exception 'nombre de contacto invalido' using errcode = '22023';
  end if;
  if v_phone !~ '^[0-9]{10,13}$' or v_phone ~ '^([0-9])\1+$' then
    raise exception 'telefono de contacto invalido' using errcode = '22023';
  end if;

  if nullif(v_address ->> 'customer_address_id', '') is not null then
    if (v_address ->> 'customer_address_id') !~*
       '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'identificador de direccion invalido' using errcode = '22023';
    end if;
    v_address_id := (v_address ->> 'customer_address_id')::uuid;
    select * into v_saved_address
      from public.customer_addresses a
     where a.id = v_address_id
       and a.customer_id = p_customer_id
       and a.deleted_at is null;
    if not found then
      raise exception 'direccion guardada no encontrada' using errcode = '42501';
    end if;
    v_address_label := v_saved_address.label;
    v_street := v_saved_address.street;
    v_street_number := v_saved_address.street_number;
    v_floor := v_saved_address.floor;
    v_apartment := v_saved_address.apartment;
    v_reference := v_saved_address.reference;
    v_city := v_saved_address.city;
    v_province := v_saved_address.province;
    v_neighborhood := v_saved_address.neighborhood;
    v_postal_code := v_saved_address.postal_code;
    v_address_source := v_saved_address.source;
    v_latitude := v_saved_address.latitude;
    v_longitude := v_saved_address.longitude;
    v_geolocation_accuracy := v_saved_address.geolocation_accuracy;
    v_location_source := v_saved_address.location_source;
    v_location_confirmed_at := v_saved_address.location_confirmed_at;
    -- Una direccion cuya huella dejo de describir su propio texto no sostiene un
    -- pedido: hay que volver a marcar el pin.
    if v_location_confirmed_at is not null
      and coalesce(v_saved_address.location_confirmed_address, '') <> public.delivery_location_address_fingerprint(
        v_saved_address.street, v_saved_address.street_number,
        v_saved_address.city, v_saved_address.province, v_saved_address.postal_code
      ) then
      v_location_confirmed_at := null;
      v_location_source := null;
    end if;
  else
    v_address_label := nullif(btrim(coalesce(v_address ->> 'label', '')), '');
    v_street := nullif(btrim(coalesce(v_address ->> 'street', '')), '');
    v_street_number := nullif(btrim(coalesce(v_address ->> 'street_number', '')), '');
    v_floor := nullif(btrim(coalesce(v_address ->> 'floor', '')), '');
    v_apartment := nullif(btrim(coalesce(v_address ->> 'apartment', '')), '');
    v_reference := nullif(btrim(coalesce(v_address ->> 'reference', '')), '');
    v_city := nullif(btrim(coalesce(v_address ->> 'city', '')), '');
    v_province := nullif(btrim(coalesce(v_address ->> 'province', '')), '');
    v_neighborhood := nullif(btrim(coalesce(v_address ->> 'neighborhood', '')), '');
    v_postal_code := nullif(btrim(coalesce(v_address ->> 'postal_code', '')), '');
    v_address_source := nullif(btrim(coalesce(v_address ->> 'source', 'manual')), '');
    v_location_source := lower(nullif(btrim(coalesce(v_address ->> 'location_source', '')), ''));
    if nullif(v_address ->> 'latitude', '') is not null or nullif(v_address ->> 'longitude', '') is not null then
      if (v_address ->> 'latitude') !~ '^-?[0-9]+(\.[0-9]+)?$'
        or (v_address ->> 'longitude') !~ '^-?[0-9]+(\.[0-9]+)?$' then
        raise exception 'coordenadas invalidas' using errcode = '22023';
      end if;
      v_latitude := (v_address ->> 'latitude')::numeric(9, 6);
      v_longitude := (v_address ->> 'longitude')::numeric(9, 6);
    end if;
    if nullif(v_address ->> 'geolocation_accuracy', '') is not null then
      if (v_address ->> 'geolocation_accuracy') !~ '^[0-9]+(\.[0-9]+)?$' then
        raise exception 'precision invalida' using errcode = '22023';
      end if;
      v_geolocation_accuracy := (v_address ->> 'geolocation_accuracy')::numeric(10, 2);
    end if;
    if nullif(v_address ->> 'location_confirmed_at', '') is not null then
      begin
        v_location_confirmed_at := (v_address ->> 'location_confirmed_at')::timestamptz;
      exception when others then
        raise exception 'momento de confirmacion invalido' using errcode = '22023';
      end;
    end if;
  end if;

  if v_fulfillment_type = 'delivery'
    and (v_street is null or v_street_number is null or v_city is null) then
    raise exception 'direccion de delivery incompleta' using errcode = '22023';
  end if;
  if char_length(coalesce(v_address_label, '')) > 60
    or char_length(coalesce(v_street, '')) > 120
    or char_length(coalesce(v_street_number, '')) > 24
    or char_length(coalesce(v_floor, '')) > 24
    or char_length(coalesce(v_apartment, '')) > 24
    or char_length(coalesce(v_reference, '')) > 180
    or char_length(coalesce(v_city, '')) > 100
    or char_length(coalesce(v_province, '')) > 100
    or char_length(coalesce(v_postal_code, '')) > 20
    or char_length(coalesce(v_neighborhood, '')) > 100
    or v_address_source not in ('manual', 'gps', 'geocoder', 'previous_order') then
    raise exception 'direccion invalida' using errcode = '22023';
  end if;
  if v_location_source is not null
    and v_location_source not in ('gps', 'map_pin', 'geocoded_confirmed') then
    raise exception 'origen de ubicacion invalido' using errcode = '22023';
  end if;
  if v_location_confirmed_at is not null
    and v_location_confirmed_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'momento de confirmacion en el futuro' using errcode = '22023';
  end if;
  if (v_latitude is null) <> (v_longitude is null) then
    raise exception 'coordenadas incompletas' using errcode = '22023';
  end if;
  if v_latitude is not null
    and (v_latitude not between -90 and 90 or v_longitude not between -180 and 180) then
    raise exception 'coordenadas fuera de rango' using errcode = '22023';
  end if;
  -- Una confirmacion son cuatro piezas juntas o no es nada.
  if v_latitude is null or v_location_source is null or v_location_confirmed_at is null then
    v_location_source := null;
    v_location_confirmed_at := null;
  end if;

  -- LA COMPUERTA. Antes de la sesion, antes de la reserva de stock y antes de la
  -- intencion de pago: si la entrega no tiene punto confirmado, no pasa nada.
  if v_fulfillment_type = 'delivery' and v_location_confirmed_at is null then
    raise exception 'DELIVERY_LOCATION_REQUIRED'
      using errcode = '22023',
            detail = 'la entrega necesita un punto confirmado por el cliente',
            hint = 'confirmar la ubicacion en el mapa antes de pagar';
  end if;

  -- Sin punto, el origen no puede afirmar que hubo uno. Se degrada en vez de
  -- abortar: la direccion postal sigue siendo valida y un pedido de retiro tiene
  -- que poder avanzar; lo que no puede es viajar diciendo `gps` sin coordenadas.
  if v_latitude is null and v_address_source in ('gps', 'geocoder') then
    v_address_source := 'manual';
  end if;
  if v_geolocation_accuracy is not null and v_latitude is null then
    v_geolocation_accuracy := null;
  end if;
  -- El origen del contrato manda sobre la columna historica, cuyo vocabulario no
  -- se amplia porque un consumidor remoto lo restringe.
  if v_location_confirmed_at is not null then
    v_address_source := case v_location_source
      when 'gps' then 'gps'
      when 'geocoded_confirmed' then 'geocoder'
      else 'manual'
    end;
  end if;

  -- Las observaciones del cliente («tocar timbre», «dejar en portería») se
  -- sanean con el mismo criterio que el resto del texto libre: sin caracteres
  -- de control y con tope de largo. Viajan dentro del snapshot de contacto para
  -- no agregar una columna a `checkout_sessions`.
  v_notes := nullif(btrim(regexp_replace(coalesce(p_payload ->> 'notes', ''), '[[:cntrl:]]', ' ', 'g')), '');
  if v_notes is not null and char_length(v_notes) > 280 then
    v_notes := substr(v_notes, 1, 280);
  end if;

  v_contact_snapshot := jsonb_strip_nulls(jsonb_build_object('name', v_name, 'phone', v_phone, 'notes', v_notes));
  v_address_snapshot := jsonb_strip_nulls(jsonb_build_object(
    'address_id', v_address_id,
    'label', v_address_label,
    'street', v_street,
    'street_number', v_street_number,
    'floor', v_floor,
    'apartment', v_apartment,
    'reference', v_reference,
    'city', v_city,
    'province', v_province,
    'postal_code', v_postal_code,
    'neighborhood', v_neighborhood,
    'source', v_address_source,
    'latitude', v_latitude,
    'longitude', v_longitude,
    'geolocation_accuracy', v_geolocation_accuracy,
    'location_source', v_location_source,
    'location_confirmed_at', v_location_confirmed_at
  ));

  select coalesce(jsonb_agg(
    jsonb_build_object('product_id', normalized.product_id, 'quantity', normalized.quantity)
    order by normalized.product_id
  ), '[]'::jsonb)
    into v_normalized_products
    from (
      select (item.value ->> 'product_id')::uuid as product_id,
             sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item(value)
       where item.value ? 'product_id'
       group by (item.value ->> 'product_id')::uuid
    ) as normalized;

  select coalesce(jsonb_agg(
    jsonb_build_object('combo_id', normalized.combo_id, 'quantity', normalized.quantity)
    order by normalized.combo_id
  ), '[]'::jsonb)
    into v_normalized_combos
    from (
      select (item.value ->> 'combo_id') as combo_id,
             sum((item.value ->> 'quantity')::integer)::integer as quantity
        from jsonb_array_elements(v_items) as item(value)
       where item.value ? 'combo_id'
       group by (item.value ->> 'combo_id')
    ) as normalized;

  if exists (
    select 1 from jsonb_to_recordset(v_normalized_combos) as normalized(combo_id text, quantity integer)
     where quantity > 100
  ) then
    raise exception 'quantity total demasiado alta para combo' using errcode = '22023';
  end if;

  -- El hash de intencion incluye los combos: reintentar el mismo carrito
  -- devuelve la misma sesion, y reusar el client_request_id con otros combos se
  -- rechaza igual que si hubieran cambiado los productos.
  v_request_hash := encode(digest(jsonb_build_object(
    'business_id', v_business_id,
    'items', v_normalized_products,
    'combos', v_normalized_combos,
    'fulfillment_type', v_fulfillment_type,
    'contact', v_contact_snapshot,
    'address', v_address_snapshot,
    'age_confirmed', v_age_confirmed
  )::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtext(v_business_id::text), hashtext(v_client_request_id));
  select * into v_existing
    from public.checkout_sessions s
   where s.business_id = v_business_id
     and s.customer_id = p_customer_id
     and s.client_request_id = v_client_request_id
   for update;
  if found then
    if v_existing.normalized_intent_hash <> v_request_hash then
      raise exception 'client_request_id reutilizado con un checkout diferente' using errcode = '23505';
    end if;
    return public.checkout_session_customer_payload(v_existing.id, p_customer_id);
  end if;

  select b.* into v_business
    from public.businesses b
   where b.id = v_business_id
   for share;
  if not found
    or not v_business.is_active
    or v_business.status <> 'open'
    or not v_business.ordering_enabled
    or not v_business.ordering_verified
    or upper(coalesce(v_business.currency_code, '')) <> 'ARS' then
    raise exception 'negocio no habilitado para pagos online' using errcode = '55000';
  end if;
  if (v_fulfillment_type = 'delivery' and not v_business.delivery_enabled)
    or (v_fulfillment_type = 'pickup' and not v_business.pickup_enabled) then
    raise exception 'modalidad de entrega no habilitada' using errcode = '55000';
  end if;

  select s.* into v_settings
    from public.business_payment_settings s
   where s.business_id = v_business_id
     and s.provider = 'mercadopago'
   for share;
  if not found
    or not v_settings.enabled
    or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro'
    or v_settings.currency <> 'ARS'
    or nullif(btrim(v_settings.collector_id), '') is null
    or nullif(btrim(v_settings.application_id), '') is null
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta configurado para este negocio' using errcode = '55000';
  end if;

  if v_business.order_rate_limit_per_10_minutes is not null then
    select count(*) into v_rate_count
      from public.checkout_sessions s
     where s.business_id = v_business_id
       and s.customer_id = p_customer_id
       and s.created_at >= clock_timestamp() - interval '10 minutes';
    if v_rate_count >= v_business.order_rate_limit_per_10_minutes then
      raise exception 'demasiados intentos de checkout; reintenta mas tarde' using errcode = '54000';
    end if;
  end if;

  -- Los combos se expanden a componentes DESPUES de verificar que el negocio
  -- esta habilitado y ANTES de tomar los locks de producto, para que el bucle de
  -- reserva vea una sola cantidad consolidada por producto y no pueda sobrevender
  -- entre una linea suelta y la misma lata dentro de un combo.
  for v_combo in
    select * from jsonb_to_recordset(v_normalized_combos) as c(combo_id text, quantity integer)
     order by combo_id
  loop
    select * into v_combo_row
      from public.product_combos c
     where c.business_id = v_business_id
       and c.combo_id = v_combo.combo_id
     for share;
    if not found or not v_combo_row.is_active then
      raise exception 'combo no disponible: %', v_combo.combo_id using errcode = '55000';
    end if;
    if v_combo_row.approval_status <> 'APROBADO_COMERCIAL' then
      raise exception 'combo sin aprobacion comercial: %', v_combo.combo_id using errcode = '55000';
    end if;
    select count(*)::integer into v_combo_declared_count
      from public.product_combo_components cc
     where cc.combo_id = v_combo_row.id;
    if v_combo_declared_count = 0 then
      raise exception 'combo sin componentes: %', v_combo.combo_id using errcode = '55000';
    end if;
  end loop;

  select coalesce(jsonb_agg(
    jsonb_build_object('product_id', totals.product_id, 'quantity', totals.quantity)
    order by totals.product_id
  ), '[]'::jsonb)
    into v_normalized_items
    from (
      select merged.product_id, sum(merged.quantity)::integer as quantity
        from (
          select (p.value ->> 'product_id')::uuid as product_id,
                 (p.value ->> 'quantity')::integer as quantity
            from jsonb_array_elements(v_normalized_products) as p(value)
          union all
          select cc.product_id,
                 cc.quantity * (c.value ->> 'quantity')::integer
            from jsonb_array_elements(v_normalized_combos) as c(value)
            join public.product_combos pc
              on pc.business_id = v_business_id
             and pc.combo_id = (c.value ->> 'combo_id')
            join public.product_combo_components cc on cc.combo_id = pc.id
        ) as merged
       group by merged.product_id
    ) as totals;

  if jsonb_array_length(v_normalized_items) < 1 then
    raise exception 'el checkout quedo sin productos' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     where quantity > 1000
  ) then
    raise exception 'quantity total demasiado alta para producto' using errcode = '22023';
  end if;

  v_expires_at := clock_timestamp() + make_interval(mins => v_settings.preference_expiration_minutes);
  insert into public.checkout_sessions (
    business_id, customer_id, client_request_id, normalized_intent_hash,
    fulfillment_type, address_snapshot, contact_snapshot, currency,
    subtotal, discount_total, delivery_fee, total, status, expires_at
  ) values (
    v_business_id, p_customer_id, v_client_request_id, v_request_hash,
    v_fulfillment_type, v_address_snapshot, v_contact_snapshot, 'ARS',
    0, 0, 0, 0, 'validating', v_expires_at
  ) returning * into v_session;

  -- Lock products in deterministic UUID order. Reserving decrements the same
  -- authoritative stock used by the legacy direct-order RPC, so both flows see
  -- active reservations and cannot oversell each other.
  for v_item in
    select * from jsonb_to_recordset(v_normalized_items) as normalized(product_id uuid, quantity integer)
     order by product_id
  loop
    select p.* into v_product
      from public.products p
     where p.id = v_item.product_id
       and p.business_id = v_business_id
     for update;
    if not found
      or not v_product.is_active
      or not v_product.is_verified
      or not v_product.available
      or v_product.price_status <> 'confirmed'
      or v_product.stock is null
      or v_product.price is null
      or v_product.price <= 0 then
      raise exception 'producto no disponible para pago: %', v_item.product_id using errcode = '55000';
    end if;
    if v_product.stock < v_item.quantity then
      raise exception 'stock insuficiente para producto: %', v_item.product_id using errcode = '23514';
    end if;
    if v_product.is_alcoholic then
      v_contains_alcohol := true;
      if v_product.minimum_age is null then
        raise exception 'producto alcoholico sin edad minima configurada' using errcode = '55000';
      end if;
    end if;

    insert into public.checkout_session_items (
      checkout_session_id, product_id, product_snapshot, quantity, unit_price, subtotal
    ) values (
      v_session.id,
      v_product.id,
      jsonb_strip_nulls(jsonb_build_object(
        'name', v_product.name,
        'presentation', v_product.presentation,
        'category', v_product.category,
        'image_url', v_product.image_url,
        'sku', v_product.sku
      )),
      v_item.quantity,
      v_product.price,
      v_product.price * v_item.quantity
    );
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at
    ) values (
      v_session.id, v_product.id, v_item.quantity, v_expires_at
    );
    update public.products p
       set stock = p.stock - v_item.quantity,
           available = case when p.stock - v_item.quantity > 0 then p.available else false end
     where p.id = v_product.id;
    v_subtotal := v_subtotal + (v_product.price * v_item.quantity);
  end loop;

  -- El precio de lista del combo se calcula con los precios BLOQUEADOS recien
  -- ahora: usar el precio leido antes del lock permitiria que una actualizacion
  -- concurrente moviera el ahorro anunciado respecto del cobrado.
  for v_combo in
    select * from jsonb_to_recordset(v_normalized_combos) as c(combo_id text, quantity integer)
     order by combo_id
  loop
    select * into v_combo_row
      from public.product_combos c
     where c.business_id = v_business_id
       and c.combo_id = v_combo.combo_id;

    select
        coalesce(sum(cc.quantity * i.unit_price), 0),
        count(*)::integer,
        coalesce(jsonb_agg(jsonb_build_object(
          'product_id', cc.product_id,
          'sku', i.product_snapshot ->> 'sku',
          'name', i.product_snapshot ->> 'name',
          'quantity', cc.quantity,
          'unit_price', i.unit_price,
          'line_price', cc.quantity * i.unit_price
        ) order by cc.sort_order, cc.product_id), '[]'::jsonb)
      into v_combo_list_price, v_combo_component_count, v_combo_components
      from public.product_combo_components cc
      join public.checkout_session_items i
        on i.checkout_session_id = v_session.id
       and i.product_id = cc.product_id
     where cc.combo_id = v_combo_row.id;

    select count(*)::integer into v_combo_declared_count
      from public.product_combo_components cc
     where cc.combo_id = v_combo_row.id;

    -- Si un componente no llego a reservarse, el combo no se cobra a medias.
    if v_combo_component_count <> v_combo_declared_count or v_combo_list_price <= 0 then
      raise exception 'combo incompleto al reservar: %', v_combo.combo_id using errcode = '55000';
    end if;

    v_combo_promotional := floor(
      (v_combo_list_price * (100 - v_combo_row.discount_percentage) / 100) / v_combo_row.price_rounding
    ) * v_combo_row.price_rounding;
    if v_combo_promotional <= 0 or v_combo_promotional > v_combo_list_price then
      raise exception 'precio promocional invalido para el combo: %', v_combo.combo_id using errcode = '55000';
    end if;

    insert into public.checkout_session_combos (
      checkout_session_id, combo_uuid, combo_id, name, quantity,
      discount_percentage, list_price, promotional_price, discount_amount, combo_snapshot
    ) values (
      v_session.id, v_combo_row.id, v_combo_row.combo_id, v_combo_row.name, v_combo.quantity,
      v_combo_row.discount_percentage, v_combo_list_price, v_combo_promotional,
      (v_combo_list_price - v_combo_promotional) * v_combo.quantity,
      jsonb_build_object(
        'combo_id', v_combo_row.combo_id,
        'name', v_combo_row.name,
        'tagline', v_combo_row.tagline,
        'terms', v_combo_row.terms,
        'discount_percentage', v_combo_row.discount_percentage,
        'price_rounding', v_combo_row.price_rounding,
        'approval_status', v_combo_row.approval_status,
        'approved_at', v_combo_row.approved_at,
        'components', v_combo_components
      )
    );

    v_discount_total := v_discount_total + (v_combo_list_price - v_combo_promotional) * v_combo.quantity;
  end loop;

  if v_discount_total > v_subtotal then
    raise exception 'el descuento de combos supera el subtotal' using errcode = '23514';
  end if;

  if v_contains_alcohol then
    if not v_business.alcohol_sales_enabled
      or v_business.alcohol_minimum_age is null
      or v_business.alcohol_sales_start is null
      or v_business.alcohol_sales_end is null
      or v_business.alcohol_timezone is null
      or not v_age_confirmed then
      raise exception 'politica o confirmacion de edad incompleta' using errcode = '55000';
    end if;
    if v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
      if (clock_timestamp() at time zone v_business.alcohol_timezone)::time
         not between v_business.alcohol_sales_start and v_business.alcohol_sales_end then
        raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
      end if;
    elsif (clock_timestamp() at time zone v_business.alcohol_timezone)::time
      between v_business.alcohol_sales_end and v_business.alcohol_sales_start then
      raise exception 'venta de alcohol fuera de horario' using errcode = '55000';
    end if;
  end if;

  -- ── HORARIO, COBERTURA, ENVÍO Y MÍNIMO ─────────────────────────────────────
  -- Se pregunta DESPUÉS de bloquear los productos y ANTES de dejar la sesión
  -- pagable: acá todavía se puede abortar y la transacción devuelve el stock
  -- sola. Un `raise` después del pago sería lo peor posible, y por eso ninguna
  -- de estas comprobaciones vive en la finalización.
  if not public.business_is_open(v_business_id, v_fulfillment_type, clock_timestamp()) then
    raise exception 'BUSINESS_CLOSED'
      using errcode = '55000',
            detail = 'el comercio no esta abierto para este canal',
            hint = 'reintentar dentro del horario de atencion';
  end if;
  if v_contains_alcohol and coalesce(v_business.alcohol_hours_enforced, false)
    and not public.business_is_open(v_business_id, 'alcohol', clock_timestamp()) then
    raise exception 'ALCOHOL_WINDOW_CLOSED'
      using errcode = '55000',
            detail = 'la venta de alcohol esta fuera de la ventana configurada';
  end if;

  if v_fulfillment_type = 'delivery' then
    -- La cobertura se resuelve con el MISMO punto confirmado que ya pasó la
    -- compuerta de arriba y que viaja en la instantánea de la sesión.
    v_zone := public.resolve_delivery_zone(
      v_business_id, v_latitude::double precision, v_longitude::double precision, v_neighborhood);
    if not coalesce((v_zone ->> 'eligible')::boolean, false) then
      raise exception 'OUT_OF_DELIVERY_ZONE'
        using errcode = '55000',
              detail = 'la direccion no esta dentro de la cobertura declarada',
              hint = 'ofrecer retiro en el local';
    end if;
    v_delivery_fee := (v_zone ->> 'delivery_fee')::numeric(12, 2);
    v_minimum := nullif(v_zone ->> 'minimum_subtotal', '')::numeric(12, 2);
    if v_delivery_fee is null then
      raise exception 'configuracion o minimo de delivery no valido' using errcode = '23514';
    end if;
    if not coalesce((v_zone ->> 'enforced')::boolean, false) and v_minimum is null then
      raise exception 'configuracion o minimo de delivery no valido' using errcode = '23514';
    end if;
    if v_minimum is not null and (v_subtotal - v_discount_total) < v_minimum then
      raise exception 'configuracion o minimo de delivery no valido' using errcode = '23514';
    end if;
  end if;
  v_total := v_subtotal - v_discount_total + v_delivery_fee;

  update public.checkout_sessions
     set subtotal = v_subtotal,
         discount_total = v_discount_total,
         delivery_fee = v_delivery_fee,
         delivery_zone_id = nullif(v_zone ->> 'zone_id', '')::uuid,
         delivery_zone_name = nullif(v_zone ->> 'zone_name', ''),
         delivery_minimum_subtotal = v_minimum,
         total = v_total,
         contains_alcohol = v_contains_alcohol,
         age_confirmed_at = case when v_contains_alcohol then clock_timestamp() else null end,
         age_confirmation_policy = case when v_contains_alcohol then v_business.alcohol_minimum_age else null end,
         status = 'ready_for_payment'
   where id = v_session.id
   returning * into v_session;

  insert into public.payment_intents (
    checkout_session_id, business_id, provider, environment, external_reference,
    internal_status, currency, expected_amount, live_mode
  ) values (
    v_session.id, v_business_id, 'mercadopago', v_settings.environment,
    'taba2:checkout:' || v_session.id::text,
    'created', 'ARS', v_total, v_settings.environment = 'production'
  ) returning id into v_payment_intent_id;

  insert into public.payment_events (
    payment_intent_id, event_type, details
  ) values (
    v_payment_intent_id,
    'checkout.session_created',
    jsonb_build_object('checkout_session_id', v_session.id, 'reservation_expires_at', v_expires_at)
  );

  return public.checkout_session_customer_payload(v_session.id, p_customer_id);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_checkout_session(p_customer_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_business_id uuid;
  v_client_request_id text;
  v_business public.businesses%rowtype;
  v_guarded boolean := false;
  v_units bigint;
  v_block jsonb;
  v_result jsonb;
begin
  -- Misma regla que en la otra puerta: una cantidad en null se rechaza como cualquier
  -- otra cantidad inválida, antes de contar unidades y de reservar.
  if jsonb_typeof(p_payload) = 'object' and private.order_items_have_null_quantity(p_payload -> 'items') then
    raise exception 'cada item acepta product_id UUID o combo_id, con quantity entero' using errcode = '22023';
  end if;

  if p_customer_id is not null
    and p_payload is not null
    and jsonb_typeof(p_payload) = 'object'
    and coalesce(p_payload ->> 'business_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and btrim(coalesce(p_payload ->> 'client_request_id', '')) ~ '^[A-Za-z0-9_-]{8,128}$' then
    v_business_id := (p_payload ->> 'business_id')::uuid;
    v_client_request_id := btrim(p_payload ->> 'client_request_id');
    select b.* into v_business from public.businesses b where b.id = v_business_id;
    if found and v_business.order_intake_guard_mode <> 'off' then
      perform pg_advisory_xact_lock(
        hashtext('taba.order_intake.customer'),
        hashtext(v_business_id::text || ':' || p_customer_id::text));
      v_guarded := not exists (
        select 1 from public.checkout_sessions s
         where s.business_id = v_business_id
           and s.customer_id = p_customer_id
           and s.client_request_id = v_client_request_id);
    end if;
  end if;

  if v_guarded then
    -- Unidades que la sesión va a reservar: productos sueltos más los componentes de
    -- cada combo. Un combo desconocido lo rechaza la capa de adentro.
    if jsonb_typeof(p_payload -> 'items') = 'array' then
      select coalesce(sum(
               case
                 when item.value ? 'combo_id' then
                   (item.value ->> 'quantity')::bigint * coalesce((
                     select sum(cc.quantity)::bigint
                       from public.product_combos pc
                       join public.product_combo_components cc on cc.combo_id = pc.id
                      where pc.business_id = v_business_id
                        and pc.combo_id = (item.value ->> 'combo_id')), 0)
                 else (item.value ->> 'quantity')::bigint
               end), 0)
        into v_units
        from jsonb_array_elements(p_payload -> 'items') as item(value)
       where jsonb_typeof(item.value) = 'object'
         and (item.value ->> 'quantity') ~ '^[1-9][0-9]{0,8}$';
    end if;
    -- Mismo código y mismo mensaje que el freno que ya existía en este canal: la
    -- Edge Function no cambia.
    v_block := private.order_intake_guard(
      v_business, p_customer_id, 'checkout', v_units,
      '54000', 'demasiados intentos de checkout; reintenta mas tarde');
    if v_block is not null then
      return v_block;
    end if;
  end if;

  v_result := public.create_checkout_session_reserving(p_customer_id, p_payload);

  if v_guarded and nullif(v_result ->> 'checkout_session_id', '') is not null then
    perform private.order_intake_record_accept(
      v_business_id, p_customer_id, 'checkout', null, (v_result ->> 'checkout_session_id')::uuid, v_units);
  end if;
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_order_with_items_confirmed_location(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_customer_id uuid := auth.uid();
  v_delivery_mode text;
  v_address_id uuid;
  v_address public.customer_addresses%rowtype;
  v_latitude numeric(9, 6);
  v_longitude numeric(9, 6);
  v_accuracy numeric(10, 2);
  v_location_source text;
  v_confirmed_at timestamptz;
  v_base_payload jsonb;
  v_result jsonb;
  v_order_id uuid;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  v_delivery_mode := lower(coalesce(
    nullif(payload->>'delivery_mode', ''),
    nullif(payload->>'fulfillment_type', ''),
    'delivery'
  ));

  if v_delivery_mode = 'delivery' then
    if nullif(payload->>'customer_address_id', '') is not null then
      if (payload->>'customer_address_id') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception 'identificador de direccion invalido' using errcode = '22023';
      end if;
      v_address_id := (payload->>'customer_address_id')::uuid;
      select * into v_address
        from public.customer_addresses a
       where a.id = v_address_id
         and a.customer_id = v_customer_id
         and a.deleted_at is null;
      if not found then
        raise exception 'direccion guardada no encontrada' using errcode = '42501';
      end if;
      v_latitude := v_address.latitude;
      v_longitude := v_address.longitude;
      v_accuracy := v_address.geolocation_accuracy;
      v_location_source := v_address.location_source;
      v_confirmed_at := v_address.location_confirmed_at;
      -- Una dirección cuya huella dejó de describir su propio texto no sostiene
      -- un pedido: hay que volver a marcar el pin.
      if v_confirmed_at is not null
        and coalesce(v_address.location_confirmed_address, '') <> public.delivery_location_address_fingerprint(
          v_address.street, v_address.street_number, v_address.city, v_address.province, v_address.postal_code
        ) then
        v_confirmed_at := null;
      end if;
    else
      if nullif(payload->>'delivery_latitude', '') is not null
        and (payload->>'delivery_latitude') ~ '^-?[0-9]+(\.[0-9]+)?$'
        and nullif(payload->>'delivery_longitude', '') is not null
        and (payload->>'delivery_longitude') ~ '^-?[0-9]+(\.[0-9]+)?$' then
        v_latitude := (payload->>'delivery_latitude')::numeric(9, 6);
        v_longitude := (payload->>'delivery_longitude')::numeric(9, 6);
      end if;
      if nullif(payload->>'delivery_geolocation_accuracy', '') is not null
        and (payload->>'delivery_geolocation_accuracy') ~ '^[0-9]+(\.[0-9]+)?$' then
        v_accuracy := (payload->>'delivery_geolocation_accuracy')::numeric(10, 2);
      end if;
      v_location_source := lower(nullif(btrim(coalesce(payload->>'delivery_location_source', '')), ''));
      if nullif(payload->>'delivery_location_confirmed_at', '') is not null then
        begin
          v_confirmed_at := (payload->>'delivery_location_confirmed_at')::timestamptz;
        exception when others then
          raise exception 'momento de confirmacion invalido' using errcode = '22023';
        end;
      end if;
    end if;

    if v_location_source is not null
      and v_location_source not in ('gps', 'map_pin', 'geocoded_confirmed') then
      raise exception 'origen de ubicacion invalido' using errcode = '22023';
    end if;
    if v_confirmed_at is not null and v_confirmed_at > clock_timestamp() + interval '5 minutes' then
      raise exception 'momento de confirmacion en el futuro' using errcode = '22023';
    end if;
    if v_latitude is null or v_longitude is null
      or v_location_source is null or v_confirmed_at is null then
      raise exception 'DELIVERY_LOCATION_REQUIRED'
        using errcode = '22023',
              detail = 'la entrega necesita un punto confirmado por el cliente',
              hint = 'confirmar la ubicacion en el mapa antes de pedir';
    end if;
    if v_latitude not between -90 and 90 or v_longitude not between -180 and 180 then
      raise exception 'coordenadas fuera de rango' using errcode = '22023';
    end if;
  end if;

  -- Las claves del contrato nuevo no llegan a las capas anteriores: la más
  -- profunda rechaza cualquier clave que no conozca.
  v_base_payload := payload - array[
    'delivery_location_source',
    'delivery_location_confirmed_at'
  ];

  -- El punto viaja al INSERT por un ajuste local a la transacción, para que la
  -- instantánea inmutable que lee el Rider —tomada en el AFTER INSERT— no salga
  -- vacía. Ver `apply_pending_delivery_location`.
  if v_delivery_mode = 'delivery' then
    perform set_config('taba.pending_delivery_location', jsonb_build_object(
      'latitude', v_latitude,
      'longitude', v_longitude,
      'accuracy', v_accuracy,
      'location_source', v_location_source,
      'confirmed_at', v_confirmed_at,
      'address_source', case v_location_source
        when 'gps' then 'gps'
        when 'geocoded_confirmed' then 'geocoder'
        else 'manual'
      end
    )::text, true);
  end if;

  v_result := public.create_order_with_items_profile_v2(v_base_payload);
  -- Se apaga apenas deja de hacer falta: ningún otro alta de la misma
  -- transacción debe heredar este punto.
  perform set_config('taba.pending_delivery_location', '', true);
  v_order_id := nullif(v_result->>'id', '')::uuid;
  if v_order_id is null then
    raise exception 'el pedido no devolvio un identificador valido' using errcode = '22023';
  end if;

  -- Nunca reemplaza la instantánea de un reintento idempotente ni la de un
  -- pedido anterior: sólo completa la que todavía no fue sellada.
  if v_delivery_mode = 'delivery' then
    update public.orders
       set delivery_location_source = v_location_source,
           delivery_location_confirmed_at = v_confirmed_at,
           delivery_latitude = coalesce(delivery_latitude, v_latitude),
           delivery_longitude = coalesce(delivery_longitude, v_longitude)
     where id = v_order_id
       and delivery_location_confirmed_at is null;
  end if;

  select v_result || to_jsonb(o) into v_result
    from public.orders o
   where o.id = v_order_id;
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_order_with_items(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_customer_id uuid := auth.uid();
  v_business_id uuid;
  v_client_request_id text;
  v_business public.businesses%rowtype;
  v_guarded boolean := false;
  v_units bigint;
  v_block jsonb;
  v_payload jsonb := payload;
  v_key text;
  v_result jsonb;
begin
  if v_customer_id is null then
    raise exception 'autenticacion de cliente requerida' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'payload invalido' using errcode = '22023';
  end if;

  -- Higiene de entrada. Lo que el resto de las capas no mide.
  if octet_length(payload::text) > 32768 then
    raise exception 'payload demasiado grande' using errcode = '22023';
  end if;
  if char_length(coalesce(payload ->> 'address_label', '')) > 300 then
    raise exception 'datos del cliente demasiado largos' using errcode = '22023';
  end if;
  -- Una cantidad en null no es «sin cantidad». El validador de renglones de adentro
  -- compara un texto, y con null esa comparación no da ni verdadero ni falso: el
  -- renglón se le escapaba. Se rechaza acá, con el código y el mensaje de cualquier
  -- otra cantidad inválida.
  if private.order_items_have_null_quantity(payload -> 'items') then
    raise exception 'cada item acepta solo product_id UUID y quantity entero' using errcode = '22023';
  end if;
  -- Los caracteres de control no llegan al Panel ni a la comandera (misma regla que
  -- ya aplicaba el checkout de Mercado Pago a sus observaciones).
  foreach v_key in array array['customer_notes', 'notes', 'customer_reference'] loop
    if jsonb_typeof(v_payload -> v_key) = 'string' and (v_payload ->> v_key) ~ '[[:cntrl:]]' then
      v_payload := jsonb_set(v_payload, array[v_key],
        to_jsonb(btrim(regexp_replace(v_payload ->> v_key, '[[:cntrl:]]+', ' ', 'g'))));
    end if;
  end loop;

  -- El guardián sólo actúa sobre un pedido que se puede identificar. Todo lo demás lo
  -- rechazan las capas de adentro con sus errores de siempre.
  if coalesce(payload ->> 'business_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and btrim(coalesce(payload ->> 'client_request_id', '')) ~ '^[A-Za-z0-9_-]{8,128}$' then
    v_business_id := (payload ->> 'business_id')::uuid;
    v_client_request_id := btrim(payload ->> 'client_request_id');
    select b.* into v_business from public.businesses b where b.id = v_business_id;
    if found and v_business.order_intake_guard_mode <> 'off' then
      -- Un cliente, una admisión a la vez por negocio: el conteo queda exacto aunque
      -- lleguen veinte pedidos juntos con veinte claves distintas.
      perform pg_advisory_xact_lock(
        hashtext('taba.order_intake.customer'),
        hashtext(v_business_id::text || ':' || v_customer_id::text));
      -- Un reintento idempotente no es una admisión nueva: no se cuenta ni se frena.
      -- Se mira DESPUÉS del lock, para que el segundo de dos envíos iguales ya vea
      -- el pedido del primero.
      v_guarded := not exists (
        select 1 from public.orders o
         where o.business_id = v_business_id
           and o.client_request_id = v_client_request_id);
    end if;
  end if;

  if v_guarded then
    if jsonb_typeof(payload -> 'items') = 'array' then
      select sum((item.value ->> 'quantity')::bigint) into v_units
        from jsonb_array_elements(payload -> 'items') as item(value)
       where jsonb_typeof(item.value) = 'object'
         and (item.value ->> 'quantity') ~ '^[1-9][0-9]{0,8}$';
    end if;
    v_block := private.order_intake_guard(
      v_business, v_customer_id, 'manual', v_units, 'PT429', 'ORDER_RATE_LIMITED');
    if v_block is not null then
      return v_block;
    end if;
  end if;

  v_result := public.create_order_with_items_confirmed_location(v_payload);

  if v_guarded and nullif(v_result ->> 'id', '') is not null then
    perform private.order_intake_record_accept(
      v_business_id, v_customer_id, 'manual', (v_result ->> 'id')::uuid, null, v_units);
  end if;
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_business_service_exception(p_business_id uuid, p_exception_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_row public.business_service_exceptions%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar excepciones' using errcode = '42501';
  end if;
  delete from public.business_service_exceptions
   where id = p_exception_id and business_id = p_business_id
  returning * into v_row;
  if not found then
    raise exception 'excepcion inexistente' using errcode = 'P0002';
  end if;
  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'exception', 'deleted',
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          to_jsonb(v_row), null);
  return jsonb_build_object('ok', true);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_delivery_zone(p_business_id uuid, p_zone_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_row public.delivery_zones%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar zonas' using errcode = '42501';
  end if;
  delete from public.delivery_zones
   where id = p_zone_id and business_id = p_business_id
  returning * into v_row;
  if not found then
    raise exception 'zona inexistente' using errcode = 'P0002';
  end if;
  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'zone', 'deleted',
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          to_jsonb(v_row), null);
  return jsonb_build_object('ok', true);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.dispatch_payment_outbox_worker(p_source text DEFAULT 'cron'::text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

begin
  if not private.a1_a4_financial_open_v5() then return null; end if;
  return private.dispatch_payment_outbox_worker_v3_body(p_source);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_checkout_provider_probes(p_limit integer DEFAULT 50)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_inserted integer;
begin
  with candidatos as (
    select pi.id, pi.provider_payment_id, pi.provider_status
      from public.payment_intents pi
      join public.checkout_sessions cs on cs.id = pi.checkout_session_id
     where cs.completed_order_id is null
       and pi.order_id is null
       -- El comprador llego a ver Mercado Pago: sin preferencia no hay nada que
       -- preguntar, porque nunca hubo donde pagar.
       and nullif(btrim(coalesce(pi.preference_id, '')), '') is not null
       and nullif(btrim(coalesce(pi.external_reference, '')), '') is not null
       and pi.internal_status not in (
         'completed', 'refunded', 'partially_refunded', 'charged_back',
         'security_review_required'
       )
       -- 48 horas, igual que la alerta CHECKOUT_PROVIDER_UNVERIFIED. Las dos
       -- ventanas tienen que coincidir: si la alerta abarcara mas que la sonda,
       -- habria checkouts marcados como «no sabemos» que nadie va a consultar.
       and cs.created_at > clock_timestamp() - interval '48 hours'
       and cs.created_at < clock_timestamp() - interval '90 seconds'
       and not exists (
         select 1 from public.payment_outbox po
          where po.payment_intent_id = pi.id
            and po.topic = 'payment_reconcile'
            and po.status in ('pending', 'claimed', 'processing', 'retry_wait')
       )
       -- Hasta 8 vacíos CONCLUYENTES, uno cada 2 minutos, como antes. Después, tres
       -- sondas tardías (a las 2, 6 y 24 horas del checkout): un vacío temprano no
       -- prueba que no haya pago — el índice de búsqueda del proveedor puede venir
       -- atrasado y la conexión del vendedor puede cambiar en el medio. Un vacío NO
       -- concluyente no gasta el tope, pero espera 30 minutos para volver a
       -- preguntar (20261002060000; medido en Staging: 8 vacíos en 30 minutos y un
       -- pago aprobado que la misma búsqueda encuentra después).
       and private.provider_probe_is_due(pi.id, cs.created_at)
     order by cs.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  )
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  -- Un pago rechazado o cancelado no es el que hay que volver a leer: el
  -- comprador pudo pagar con otro medio en la misma preferencia, y fijar el id
  -- rechazado en el trabajo dejaba a la sonda ciega al reintento.
  -- Esto solo NO alcanza. Con el trabajo sin `resource_id` el worker lee hoy
  -- `payment_intents.provider_payment_id`, que sigue siendo el pago rechazado;
  -- la busqueda por referencia externa (que prefiere un pago aprobado) empieza
  -- cuando el worker deja de usar ese id si el estado guardado es rechazado o
  -- cancelado. Hasta ese cambio la sonda se comporta igual que antes.
  select c.id, 'payment_reconcile',
         case when c.provider_status in ('rejected', 'cancelled', 'canceled') then null else c.provider_payment_id end
    from candidatos c
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_payment_reconciliation(p_payment_intent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_job uuid;
begin
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or v_actor is null
    or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reconciliacion no autorizada' using errcode = '42501';
  end if;
  if v_intent.internal_status in ('completed', 'refunded', 'partially_refunded', 'charged_back') then
    return jsonb_build_object(
      'queued', false,
      'terminal', true,
      'idempotent', true,
      'internal_status', v_intent.internal_status,
      'order_id', v_intent.order_id
    );
  end if;
  -- Basta la referencia externa: el worker resuelve el pago por ella cuando
  -- todavía no conocemos el identificador del proveedor.
  if v_intent.provider_payment_id is null
    and nullif(btrim(coalesce(v_intent.external_reference, '')), '') is null then
    raise exception 'pago sin referencia consultable' using errcode = '55000';
  end if;
  insert into public.payment_outbox (payment_intent_id, topic, resource_id)
  values (v_intent.id, 'payment_reconcile', v_intent.provider_payment_id)
  returning id into v_job;
  return jsonb_build_object('queued', true, 'job_id', v_job, 'idempotent', false);
exception when unique_violation then
  return jsonb_build_object('queued', true, 'idempotent', true);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.expire_unattended_manual_orders(p_limit integer DEFAULT 100)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 100), 500));
  v_candidate record;
  v_released integer;
  v_expired integer := 0;
  v_failed integer := 0;
  v_sqlstate text;
  v_error text;
  v_now timestamptz;
begin
  for v_candidate in
    select o.id, o.business_id, o.status, b.abandoned_order_minutes,
           (f.order_id is not null) as failed_before
      from public.orders o
      join public.businesses b on b.id = o.business_id
      left join private.unattended_order_expiry_failures f on f.order_id = o.id
     where o.status in ('received', 'submitted')
       and o.payment_method in ('cash', 'coordinate')
       and o.manual_payment_status = 'pending'
       and o.acknowledged_at is null
       and b.abandoned_order_minutes is not null
       and o.created_at < clock_timestamp() - make_interval(mins => b.abandoned_order_minutes)
       -- Un pedido con un intento de pago no es «sin cobrar»: su cancelación pasa
       -- por el flujo de reembolso, y el trigger de pedidos pagados lo frenaría acá
       -- en cada corrida.
       and not exists (select 1 from public.payment_intents pi where pi.order_id = o.id)
       and (f.order_id is null or f.retry_after <= clock_timestamp())
     -- Primero lo que nunca falló, del más viejo al más nuevo; los reintentos van
     -- al final. Así el tope de fallos de una corrida nunca se gasta en los mismos
     -- pedidos mientras hay otros esperando.
     order by (f.order_id is not null), o.created_at, o.id
     for update of o skip locked
  loop
    -- Dos topes separados: cuántos vencen y cuántos fallos se toleran por corrida.
    exit when v_expired >= v_limit or v_failed >= v_limit;
    begin
      v_released := private.release_order_inventory(v_candidate.id);

      -- La marca de stock devuelto va en el mismo UPDATE que el estado: la revisión
      -- avanza una vez y el evento de estado dice `inventory_released: true`.
      update public.orders
         set status = 'cancelled',
             inventory_released_at = coalesce(inventory_released_at, clock_timestamp())
       where id = v_candidate.id;

      insert into public.order_events (
        order_id, business_id, actor_user_id, actor_role, actor_type,
        event_type, type, message, metadata, payload
      ) values (
        v_candidate.id, v_candidate.business_id, null, 'system', 'system',
        'order.expired_unattended', 'order.expired_unattended',
        'Pedido cancelado automaticamente: el comercio no lo atendio a tiempo.',
        jsonb_build_object(
          'reason', 'unattended_timeout',
          'abandoned_order_minutes', v_candidate.abandoned_order_minutes,
          'previous_status', v_candidate.status,
          'products_released', v_released
        ),
        jsonb_build_object(
          'reason', 'unattended_timeout',
          'abandoned_order_minutes', v_candidate.abandoned_order_minutes,
          'previous_status', v_candidate.status,
          'products_released', v_released
        )
      );

      if v_candidate.failed_before then
        delete from private.unattended_order_expiry_failures where order_id = v_candidate.id;
      end if;

      v_expired := v_expired + 1;
    exception
      when others then
        get stacked diagnostics v_sqlstate = returned_sqlstate, v_error = message_text;
        v_failed := v_failed + 1;
        raise warning 'el pedido % no pudo vencer y sigue como estaba: % (%)',
          v_candidate.id, v_error, v_sqlstate;
        -- Anotar el fallo es accesorio: si esto falla, el lote sigue igual.
        begin
          v_now := clock_timestamp();
          insert into private.unattended_order_expiry_failures as f (
            order_id, attempts, first_failed_at, last_failed_at, retry_after, last_sqlstate, last_error
          ) values (
            v_candidate.id, 1, v_now, v_now, v_now + interval '2 minutes', v_sqlstate, left(v_error, 300)
          )
          on conflict (order_id) do update
             set attempts = f.attempts + 1,
                 last_failed_at = v_now,
                 retry_after = v_now + make_interval(mins => least(60, (2 ^ least(f.attempts + 1, 6))::integer)),
                 last_sqlstate = excluded.last_sqlstate,
                 last_error = excluded.last_error;
        exception
          when others then
            raise warning 'no se pudo anotar el fallo del pedido %: % (%)', v_candidate.id, sqlerrm, sqlstate;
        end;
    end;
  end loop;

  -- Lo que ya no es candidato —el comercio lo tomó, lo cobró o lo cerró— deja de
  -- figurar como fallo pendiente.
  delete from private.unattended_order_expiry_failures f
   where not exists (
     select 1
       from public.orders o
      where o.id = f.order_id
        and o.status in ('received', 'submitted')
        and o.manual_payment_status = 'pending'
        and o.acknowledged_at is null
   );

  return v_expired;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fail_payment_outbox_job(p_job_id uuid, p_owner text, p_error_code text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_job public.payment_outbox%rowtype; v_status text;
begin
  select * into v_job from public.payment_outbox o where o.id = p_job_id and o.owner = p_owner for update;
  if not found or v_job.status <> 'processing' then return null; end if;
  v_status := case when v_job.attempts >= 8 then 'dead_letter' else 'retry_wait' end;
  update public.payment_outbox set status = v_status, lease_expires_at = null,
    last_error = left(coalesce(p_error_code, 'worker_failed'), 160),
    next_attempt_at = case when v_status = 'dead_letter' then next_attempt_at
      else clock_timestamp() + make_interval(secs => least(3600, 15 * (2 ^ least(v_job.attempts, 8))::integer)) end
   where id = v_job.id;
  if v_job.webhook_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = v_status, last_error = left(coalesce(p_error_code, 'worker_failed'), 160)
     where id = v_job.webhook_receipt_id;
  end if;
  return v_status;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_paid_checkout_session(p_checkout_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_order public.orders%rowtype;
  v_item record;
  v_reservation public.inventory_reservations%rowtype;
  v_code text;
  v_tracking_token text;
  v_age_confirmed boolean;
  v_business public.businesses%rowtype;
  v_channel_open boolean;
  v_alcohol_open boolean;
  v_closed_reasons text[];
  v_closing_mark jsonb;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found then raise exception 'checkout inexistente' using errcode = 'P0002'; end if;
  if v_session.completed_order_id is not null or v_session.status = 'completed' then
    return jsonb_build_object('ok', true, 'order_id', v_session.completed_order_id, 'idempotent', true);
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  -- `is distinct from`: un NULL en el estado o en el importe tiene que frenar,
  -- no pasar de largo.
  if not found or v_intent.internal_status not in ('approved_order_pending', 'approved')
    or v_intent.provider_status is distinct from 'approved' or v_intent.paid_amount is distinct from v_session.total
    or v_intent.currency is distinct from 'ARS' then
    raise exception 'pago no aprobado verificadamente' using errcode = '55000';
  end if;
  if v_session.expires_at <= clock_timestamp() or not exists (
    select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()
  ) then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_active_reservation' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_active_reservation' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true);
  end if;
  -- El dinero ya se movio: aca no se aborta. Una sesion delivery sin punto
  -- confirmado es imposible por construccion -`create_checkout_session` la
  -- rechaza antes de reservar stock-, asi que si aparece es una anomalia y la
  -- decide una persona, no un raise que revierta el pago en loop.
  if v_session.fulfillment_type = 'delivery' and (
    nullif(v_session.address_snapshot ->> 'latitude', '') is null
    or nullif(v_session.address_snapshot ->> 'longitude', '') is null
    or nullif(v_session.address_snapshot ->> 'location_source', '') is null
    or nullif(v_session.address_snapshot ->> 'location_confirmed_at', '') is null
  ) then
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'finalization_without_confirmed_delivery_location' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'finalization_without_confirmed_delivery_location' where id = v_session.id;
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'code', 'DELIVERY_LOCATION_REQUIRED');
  end if;
  update public.checkout_sessions set status = 'finalizing_order' where id = v_session.id;
  loop
    v_code := public.next_order_public_code();
    exit when not exists (select 1 from public.orders o where o.code = v_code or o.public_code = v_code);
  end loop;
  -- La confirmacion de edad viaja como par completo o no viaja: el pedido exige
  -- las dos columnas juntas, y un par a medias no puede abortar un cobro hecho.
  v_age_confirmed := v_session.contains_alcohol
    and v_session.age_confirmed_at is not null
    and coalesce(v_session.age_confirmation_policy between 18 and 99, false);
  insert into public.orders (
    business_id, code, public_code, status, fulfillment_type, delivery_mode,
    customer_user_id, client_request_id, client_request_fingerprint, currency_code,
    customer_name, customer_phone, customer_whatsapp, address_label,
    customer_street_address, customer_neighborhood, customer_reference,
    customer_address_id, delivery_address_formatted, delivery_street, delivery_street_number,
    delivery_floor, delivery_apartment, delivery_reference, delivery_city, delivery_province,
    delivery_postal_code, delivery_address_label, delivery_address_source, delivery_snapshot_created_at,
    delivery_latitude, delivery_longitude, delivery_geolocation_accuracy,
    delivery_location_source, delivery_location_confirmed_at,
    delivery_zone_id, delivery_zone_name, delivery_area_declared,
    payment_method, subtotal, discount_total, delivery_fee, total,
    customer_notes,
    age_confirmed_at, age_confirmation_policy
  ) values (
    v_session.business_id, v_code, v_code, 'received', v_session.fulfillment_type, v_session.fulfillment_type,
    v_session.customer_id, 'mp_' || replace(v_session.id::text, '-', ''), v_session.normalized_intent_hash, 'ARS',
    v_session.contact_snapshot ->> 'name', v_session.contact_snapshot ->> 'phone', v_session.contact_snapshot ->> 'phone',
    coalesce(v_session.address_snapshot ->> 'label', case when v_session.fulfillment_type = 'delivery' then 'Entrega' else null end),
    btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))),
    v_session.address_snapshot ->> 'city', v_session.address_snapshot ->> 'reference',
    nullif(v_session.address_snapshot ->> 'address_id', '')::uuid,
    case when v_session.fulfillment_type = 'delivery' then nullif(btrim(concat_ws(', ',
      nullif(btrim(concat_ws(' ', nullif(v_session.address_snapshot ->> 'street', ''), nullif(v_session.address_snapshot ->> 'street_number', ''))), ''),
      nullif(v_session.address_snapshot ->> 'city', ''),
      nullif(v_session.address_snapshot ->> 'province', ''))), '') end,
    v_session.address_snapshot ->> 'street', v_session.address_snapshot ->> 'street_number',
    v_session.address_snapshot ->> 'floor', v_session.address_snapshot ->> 'apartment',
    v_session.address_snapshot ->> 'reference', v_session.address_snapshot ->> 'city',
    v_session.address_snapshot ->> 'province', v_session.address_snapshot ->> 'postal_code',
    v_session.address_snapshot ->> 'label',
    case when v_session.fulfillment_type = 'delivery'
      then coalesce(nullif(v_session.address_snapshot ->> 'source', ''), 'checkout_session') end,
    case when v_session.fulfillment_type = 'delivery' then clock_timestamp() end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'latitude', '')::numeric(9, 6) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'longitude', '')::numeric(9, 6) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'geolocation_accuracy', '')::numeric(10, 2) end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'location_source', '') end,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'location_confirmed_at', '')::timestamptz end,
    v_session.delivery_zone_id, v_session.delivery_zone_name,
    case when v_session.fulfillment_type = 'delivery'
      then nullif(v_session.address_snapshot ->> 'neighborhood', '') end,
    'mercadopago', v_session.subtotal, v_session.discount_total, v_session.delivery_fee, v_session.total,
    -- Lo que el cliente escribió llega al Panel y al rider. Antes se perdía acá.
    nullif(v_session.contact_snapshot ->> 'notes', ''),
    -- El rider arma «verificar mayoría de edad» a partir del pedido, no de la sesión.
    case when v_age_confirmed then v_session.age_confirmed_at end,
    case when v_age_confirmed then v_session.age_confirmation_policy end
  ) returning * into v_order;
  for v_item in select * from public.checkout_session_items i where i.checkout_session_id = v_session.id order by i.product_id loop
    insert into public.order_items (order_id, product_id, product_uuid, name, quantity, unit, unit_price, subtotal)
    values (v_order.id, v_item.product_id::text, v_item.product_id, coalesce(v_item.product_snapshot ->> 'name', 'Producto TABA2'),
      v_item.quantity, nullif(v_item.product_snapshot ->> 'presentation', ''), v_item.unit_price, v_item.subtotal);
  end loop;
  insert into public.order_combos (
    order_id, combo_uuid, combo_id, name, quantity, discount_percentage,
    list_price, promotional_price, discount_amount, combo_snapshot
  )
  select v_order.id, c.combo_uuid, c.combo_id, c.name, c.quantity, c.discount_percentage,
         c.list_price, c.promotional_price, c.discount_amount, c.combo_snapshot
    from public.checkout_session_combos c
   where c.checkout_session_id = v_session.id
   order by c.combo_id;
  for v_reservation in select * from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' order by r.product_id for update loop
    update public.inventory_reservations set status = 'converted', converted_at = clock_timestamp() where id = v_reservation.id and status = 'active';
  end loop;
  insert into public.order_events (order_id, business_id, actor_user_id, actor_role, actor_type, event_type, type, message, metadata, payload)
  values (v_order.id, v_session.business_id, v_session.customer_id, 'customer', 'customer', 'order.received', 'order.received',
    'Pedido recibido y pago aprobado', jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id),
    jsonb_build_object('source', 'mercadopago_checkout_pro', 'payment_intent_id', v_intent.id));
  -- El pedido se crea igual: el cliente pago mientras la sesion valia. Lo que
  -- faltaba era que el Panel y la traza pudieran distinguirlo. Se lee el comercio
  -- SIN lock (`set_business_open_state` lo toma FOR UPDATE; un lock aca abriria
  -- un orden nuevo) y con las mismas compuertas que `create_checkout_session`.
  -- Todo va en su propio bloque: si el horario no se puede evaluar, el pedido
  -- pagado nace igual y sin marca.
  begin
    select * into v_business from public.businesses b where b.id = v_session.business_id;
    v_channel_open := public.business_is_open(v_session.business_id, v_session.fulfillment_type, clock_timestamp());
    if v_session.contains_alcohol then
      v_alcohol_open := coalesce(
        v_business.alcohol_sales_enabled
        and v_business.alcohol_sales_start is not null
        and v_business.alcohol_sales_end is not null
        and v_business.alcohol_timezone is not null
        and case
          when v_business.alcohol_sales_start <= v_business.alcohol_sales_end then
            (clock_timestamp() at time zone v_business.alcohol_timezone)::time
              between v_business.alcohol_sales_start and v_business.alcohol_sales_end
          else
            (clock_timestamp() at time zone v_business.alcohol_timezone)::time
              not between v_business.alcohol_sales_end and v_business.alcohol_sales_start
        end
        and (not coalesce(v_business.alcohol_hours_enforced, false)
          or public.business_is_open(v_session.business_id, 'alcohol', clock_timestamp())),
        false);
    end if;
    v_closed_reasons := array_remove(array[
      case when v_business.status is distinct from 'open' then 'business_' || coalesce(v_business.status, 'unknown') end,
      case when not coalesce(v_business.is_active, false) then 'business_inactive' end,
      case when not coalesce(v_business.ordering_enabled, false) then 'ordering_disabled' end,
      case when not coalesce(v_business.ordering_verified, false) then 'ordering_unverified' end,
      case when not coalesce(
        case v_session.fulfillment_type
          when 'delivery' then v_business.delivery_enabled
          when 'pickup' then v_business.pickup_enabled
        end, false) then 'channel_disabled' end,
      case when not coalesce(v_channel_open, false) then 'channel_closed' end,
      case when v_session.contains_alcohol and not coalesce(v_alcohol_open, false) then 'alcohol_window_closed' end
    ], null);
    if cardinality(v_closed_reasons) > 0 then
      -- La marca se evalua al crear el pedido, no al cobrar: `payment_approved_at`
      -- deja ver cuando el cobro entro antes del cierre y el pedido despues.
      v_closing_mark := jsonb_build_object(
        'source', 'mercadopago_checkout_pro',
        'channel', v_session.fulfillment_type,
        'closed_reasons', to_jsonb(v_closed_reasons),
        'business_status', v_business.status,
        'channel_open', coalesce(v_channel_open, false),
        'contains_alcohol', v_session.contains_alcohol,
        'alcohol_open', case when v_session.contains_alcohol then coalesce(v_alcohol_open, false) end,
        'payment_intent_id', v_intent.id,
        'payment_approved_at', v_intent.approved_at,
        'checkout_session_id', v_session.id,
        'checkout_created_at', v_session.created_at
      );
      insert into public.order_events (order_id, business_id, actor_user_id, actor_role, actor_type, event_type, type, message, metadata, payload)
      values (v_order.id, v_session.business_id, null, 'system', 'system', 'order.created_after_closing', 'order.created_after_closing',
        'Pedido pagado que entro con el comercio cerrado o en pausa', v_closing_mark, v_closing_mark);
    end if;
  exception when others then
    -- Sin marca, pero con rastro: el aviso queda en el log de Postgres con el
    -- pedido y el codigo de error, sin datos del cliente.
    raise warning 'order.created_after_closing: no se pudo evaluar o escribir la marca del pedido % (%)', v_order.id, sqlstate;
  end;
  v_tracking_token := encode(gen_random_bytes(32), 'hex');
  insert into public.order_public_tokens (order_id, token, token_hash, expires_at)
  values (v_order.id, null, digest(v_tracking_token, 'sha256'), clock_timestamp() + interval '30 days');
  update public.payment_intents set order_id = v_order.id, internal_status = 'completed' where id = v_intent.id;
  update public.checkout_sessions set completed_order_id = v_order.id, status = 'completed' where id = v_session.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_intent.id, 'payment.order_completed', jsonb_build_object('order_id', v_order.id));
  return jsonb_build_object('ok', true, 'order_id', v_order.id, 'order_code', v_order.public_code, 'idempotent', false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.find_payment_intent_by_external_reference(p_environment text, p_external_reference text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_intent public.payment_intents%rowtype;
begin
  select * into v_intent from public.payment_intents pi
   where pi.environment = lower(btrim(coalesce(p_environment, '')))
     and pi.external_reference = btrim(coalesce(p_external_reference, ''))
   for share;
  if not found then raise exception 'referencia de pago desconocida' using errcode = 'P0002'; end if;
  return jsonb_build_object('payment_intent_id', v_intent.id, 'checkout_session_id', v_intent.checkout_session_id);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_business_finished_today(p_business_id uuid, p_timezone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_timezone text;
  v_date date;
  v_start timestamptz;
  v_end timestamptz;
  v_delivered integer;
  v_cancelled integer;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  -- La misma compuerta de rol que el resto del Panel. `security definer` hace
  -- que esta funcion vea la tabla entera, asi que el filtro por negocio tiene
  -- que ser explicito y estar ANTES de contar: sin esto, cualquier cuenta
  -- autenticada podria contar los pedidos de otro comercio.
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  select nullif(btrim(coalesce(b.operating_timezone, '')), '')
    into v_timezone
    from public.businesses b
   where b.id = p_business_id;
  if v_timezone is null then
    raise exception 'el negocio no tiene huso horario configurado: no se puede contar el dia'
      using errcode = '55000',
            detail = 'businesses.operating_timezone esta vacio',
            hint = 'configurar el huso del negocio antes de contar pedidos cerrados';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
    raise exception 'el huso horario del negocio no es valido: %', v_timezone using errcode = '22023';
  end if;
  -- El parametro del cliente no decide, pero tampoco se ignora: si pide otra
  -- zona esta pidiendo otro dia, y devolverle el del comercio como si fuera el
  -- suyo seria contestar otra pregunta.
  if p_timezone is not null and btrim(p_timezone) <> '' and btrim(p_timezone) <> v_timezone then
    raise exception 'la zona pedida no es la del negocio' using errcode = '22023';
  end if;

  -- "Hoy" no recibe una fecha del cliente. Se calcula siempre con el reloj de
  -- PostgreSQL y el huso persistido por el negocio. Una consulta historica, si
  -- alguna vez se necesita, debe ser otra RPC con otro nombre y otro contrato.
  v_date := (now() at time zone v_timezone)::date;
  v_start := v_date::timestamp at time zone v_timezone;
  v_end := (v_date + 1)::timestamp at time zone v_timezone;

  -- Los timestamps terminales son estables. `updated_at` no lo es: una nota o
  -- una reparacion posterior no puede mover un cierre a otro dia. El trigger
  -- historico `set_order_status_timestamps` mantiene delivered_at y los dos
  -- nombres legacy de cancelacion.
  select
    count(*) filter (where public.normalize_order_status_vocabulary(o.status) = 'delivered'),
    count(*) filter (where public.normalize_order_status_vocabulary(o.status) in ('cancelled', 'rejected'))
    into v_delivered, v_cancelled
    from public.orders o
   where o.business_id = p_business_id
     and o.origin = 'production'
     and case public.normalize_order_status_vocabulary(o.status)
           when 'delivered' then o.delivered_at
           when 'rejected' then o.rejected_at
           else coalesce(o.cancelled_at, o.canceled_at)
         end >= v_start
     and case public.normalize_order_status_vocabulary(o.status)
           when 'delivered' then o.delivered_at
           when 'rejected' then o.rejected_at
           else coalesce(o.cancelled_at, o.canceled_at)
         end < v_end
     and public.normalize_order_status_vocabulary(o.status) in ('delivered', 'cancelled', 'rejected');

  return jsonb_build_object(
    'ok', true,
    'business_id', p_business_id,
    'business_date', v_date,
    'timezone', v_timezone,
    'window_start', v_start,
    'window_end', v_end,
    'delivered', coalesce(v_delivered, 0),
    'cancelled', coalesce(v_cancelled, 0),
    'generated_at', now()
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_business_opening_status(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_business public.businesses%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_profile public.fiscal_profiles%rowtype;
  v_stalled integer;
  v_riders integer;
  v_open_orders integer;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;
  select * into v_settings from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago';
  select * into v_profile from public.fiscal_profiles where business_id = p_business_id;

  select
    (select count(*) from public.payment_outbox po
      join public.payment_intents pi on pi.id = po.payment_intent_id
     where pi.business_id = p_business_id and po.status in ('failed', 'dead_letter'))
    + (select count(*) from public.fiscal_outbox fo
        join public.fiscal_documents fd on fd.id = fo.fiscal_document_id
       where fd.business_id = p_business_id and fo.state = 'dead_letter')
    into v_stalled;

  -- Los repartidores reales son integrantes del equipo con su disponibilidad; la
  -- tabla `public.riders` es anterior y nadie le escribe. Se cuenta igual que la
  -- preparación de la apertura.
  select count(*) into v_riders
    from public.business_members bm
    left join public.identity_user_security us on us.business_id = bm.business_id and us.user_id = bm.user_id
   where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active and us.disabled_at is null
     and public.rider_availability_effective(p_business_id, bm.user_id);

  select count(*) into v_open_orders from public.orders o
   where o.business_id = p_business_id
     and o.status not in ('delivered', 'canceled', 'cancelled', 'rejected');

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'business_status', v_business.status,
    'backend', jsonb_build_object('status', 'ok', 'detail', 'El sistema del negocio respondió.'),
    'payments', jsonb_build_object(
      'status', case
        when coalesce(v_settings.enabled, false)
          and v_business.ordering_enabled and v_business.ordering_verified then 'ok'
        -- Sin Mercado Pago la tienda cobra en efectivo o por transferencia, que
        -- no dependen de ninguna configuración: no es una falla.
        when v_settings.id is null then 'ok'
        else 'degraded'
      end,
      'detail', case
        when v_settings.id is null then 'La tienda cobra en efectivo o por transferencia. Mercado Pago no está configurado.'
        when not coalesce(v_settings.enabled, false) then 'Los cobros por la web están apagados.'
        when not (v_business.ordering_enabled and v_business.ordering_verified) then 'La web todavía no acepta pedidos.'
        else 'Los cobros por la web están activos.'
      end
    ),
    'fiscal', jsonb_build_object(
      'status', case
        when coalesce(v_profile.is_enabled, false) and coalesce(v_profile.environment, 'disabled') <> 'disabled' then 'ok'
        when v_profile.business_id is null then 'failed'
        else 'degraded'
      end,
      'detail', case
        when v_profile.business_id is null then 'Todavía no se cargaron los datos de facturación.'
        when not coalesce(v_profile.is_enabled, false) then 'La facturación está apagada.'
        else 'La facturación está activa.'
      end
    ),
    'riders', jsonb_build_object(
      'status', case when v_riders > 0 then 'ok' else 'degraded' end,
      'detail', case
        when v_riders > 0 then v_riders || ' repartidor(es) disponible(s).'
        else 'No hay repartidores disponibles ahora.'
      end
    ),
    'queues', jsonb_build_object(
      'status', case when v_stalled > 0 then 'degraded' else 'ok' end,
      'detail', case
        when v_stalled > 0 then v_stalled || ' cosa(s) quedaron esperando de antes.'
        else 'No quedó nada trabado de antes.'
      end
    ),
    'open_orders', v_open_orders
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_business_operations_config(p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_business public.businesses%rowtype;
  v_can_manage boolean := public.can_manage_commercial_settings(p_business_id);
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'sin autorizacion para leer la configuracion' using errcode = '42501';
  end if;
  select * into v_business from public.businesses where id = p_business_id;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'business_id', p_business_id,
    'can_manage', v_can_manage,
    'operating_timezone', v_business.operating_timezone,
    'hours_enforced', v_business.hours_enforced,
    'delivery_zone_enforced', v_business.delivery_zone_enforced,
    'alcohol_hours_enforced', v_business.alcohol_hours_enforced,
    -- Las cinco que `create_order` exige juntas. Se devuelven juntas, y con el
    -- mismo nombre que tienen en la tabla, para que quien lea esto pueda
    -- comparar contra el mensaje de error sin traducir nada.
    'alcohol_sales_enabled', v_business.alcohol_sales_enabled,
    'alcohol_minimum_age', v_business.alcohol_minimum_age,
    'alcohol_sales_start', to_char(v_business.alcohol_sales_start, 'HH24:MI'),
    'alcohol_sales_end', to_char(v_business.alcohol_sales_end, 'HH24:MI'),
    'alcohol_timezone', v_business.alcohol_timezone,
    -- Y la conclusión ya sacada, que es lo que de verdad se quiere saber: si un
    -- pedido con alcohol puede entrar AHORA. Calcularla acá evita que cada
    -- superficie la reimplemente y se equivoque distinto.
    'alcohol_policy_complete', (
      v_business.alcohol_minimum_age is not null
      and v_business.alcohol_sales_start is not null
      and v_business.alcohol_sales_end is not null
      and v_business.alcohol_timezone is not null
      and btrim(coalesce(v_business.alcohol_timezone, '')) <> ''
    ),
    'delivery_enabled', v_business.delivery_enabled,
    'pickup_enabled', v_business.pickup_enabled,
    -- Los datos del local que ve el cliente: dirección para retirar y WhatsApp.
    -- El WhatsApp lo confirma sólo el dueño o el encargado (set_business_whatsapp_contact).
    'address', v_business.address,
    'whatsapp_phone', v_business.whatsapp_phone,
    'whatsapp_verified', coalesce(v_business.whatsapp_verified, false),
    'can_manage_contact', public.has_business_role(p_business_id, array['owner', 'admin']),
    'delivery_fee', v_business.delivery_fee,
    'minimum_delivery_subtotal', v_business.minimum_delivery_subtotal,
    'delivery_max_radius_meters', v_business.delivery_max_radius_meters,
    'is_open_delivery', public.business_is_open(p_business_id, 'delivery', now()),
    'is_open_pickup', public.business_is_open(p_business_id, 'pickup', now()),
    'next_open_at', public.business_next_open_at(p_business_id, 'delivery', now()),
    'hours', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', h.id, 'channel', h.channel, 'weekday', h.weekday,
               'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
             order by h.channel, h.weekday, h.opens_at), '[]'::jsonb)
        from public.business_service_hours h where h.business_id = p_business_id),
    'exceptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', e.id, 'channel', e.channel, 'on_date', e.on_date, 'is_closed', e.is_closed,
               'opens_at', to_char(e.opens_at, 'HH24:MI'), 'closes_at', to_char(e.closes_at, 'HH24:MI'),
               'note', e.note)
             order by e.on_date, e.channel), '[]'::jsonb)
        from public.business_service_exceptions e
       where e.business_id = p_business_id and e.on_date >= (now() - interval '30 days')::date),
    'zones', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', z.id, 'name', z.name, 'is_active', z.is_active, 'match_kind', z.match_kind,
               'area', z.area_normalized, 'boundary_points', case when z.boundary is null then 0 else npoints(z.boundary) end,
               'delivery_fee', z.delivery_fee, 'minimum_subtotal', z.minimum_subtotal,
               'priority', z.priority, 'notes', z.notes)
             order by z.priority, z.name), '[]'::jsonb)
        from public.delivery_zones z where z.business_id = p_business_id),
    -- La auditoría la ve quien puede cambiar la configuración. Un staff sin
    -- delegación no ve quién movió los precios.
    'audit', case when v_can_manage then (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'scope', a.scope, 'action', a.action,
               'actor_kind', a.actor_kind, 'actor_id', a.actor_id,
               'before', a.before, 'after', a.after, 'created_at', a.created_at)
             order by a.created_at desc), '[]'::jsonb)
        from (select * from public.business_config_audit
               where business_id = p_business_id
               order by created_at desc limit 50) a
    ) else '[]'::jsonb end);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_packing_manifest(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_session public.order_packing_sessions%rowtype;
begin
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  return jsonb_build_object(
    'schema_version',1,
    'session',jsonb_build_object(
      'id',v_session.id,
      'business_id',v_session.business_id,
      'order_id',v_session.order_id,
      'order_revision',v_session.order_revision,
      'status',v_session.status,
      'operator_id',v_session.operator_id,
      'updated_at',v_session.updated_at
    ),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'product_id',oi.product_uuid,
        'name',left(oi.name,100),
        'quantity',oi.quantity,
        'barcodes',coalesce((
          select jsonb_agg(jsonb_build_object('gtin',b.gtin,'unit_factor',b.unit_factor) order by b.gtin)
          from public.product_barcodes b
          where b.business_id=v_session.business_id and b.product_id=oi.product_uuid and b.is_active
        ),'[]'::jsonb)
      ) order by oi.created_at,oi.id)
      from public.order_items oi where oi.order_id=v_session.order_id
    ),'[]'::jsonb),
    'scans',coalesce((
      select jsonb_agg(jsonb_build_object(
        'scan_key',ps.scan_key,
        'gtin',b.gtin,
        'product_id',ps.product_id,
        'unit_factor',ps.unit_factor,
        'created_at',ps.created_at,
        'reverted_at',ps.reverted_at
      ) order by ps.created_at,ps.id)
      from public.order_packing_scans ps
      join public.product_barcodes b on b.id=ps.barcode_id
      where ps.session_id=v_session.id
    ),'[]'::jsonb)
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_scanned_product_readiness(p_product_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_product public.products%rowtype;
  v_barcode boolean;
  v_image boolean;
  v_details boolean;
begin
  select * into v_product from public.products where id = p_product_id;
  if not found then
    raise exception 'producto inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_product.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;

  v_barcode := exists (
    select 1 from public.product_barcodes pb
     where pb.product_id = v_product.id and pb.is_active
  );
  v_image := v_product.catalog_asset_id is not null
    and nullif(btrim(coalesce(v_product.image_url, '')), '') is not null;
  v_details := nullif(btrim(coalesce(v_product.brand, '')), '') is not null
    and nullif(btrim(coalesce(v_product.variant, '')), '') is not null
    and coalesce(v_product.capacity_value, 0) > 0
    and coalesce(v_product.units_per_pack, 0) > 0;

  return jsonb_build_object(
    'product_id', v_product.id,
    'details_complete', v_details,
    'barcode_bound', v_barcode,
    'image_bound', v_image,
    'price_status', v_product.price_status,
    'stock_positive', coalesce(v_product.stock, 0) > 0,
    'published', coalesce(v_product.is_verified, false),
    'visible', v_details and v_barcode and v_image and coalesce(v_product.is_verified, false),
    'purchasable', coalesce(v_product.available, false)
      and v_product.price_status = 'confirmed'
      and coalesce(v_product.stock, 0) > 0
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_store_opening_readiness(p_business_id uuid, p_min_products integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_b public.businesses%rowtype;
  v_min integer := coalesce(p_min_products, 1);
  v_items jsonb := '[]'::jsonb;
  v_pending text[] := '{}';
  v_status text;
  v_blocking boolean;
  v_address text;
  v_address_ok boolean;
  v_contact_digits text;
  v_contact_ok boolean;
  v_tz_ok boolean;
  v_windows_delivery integer;
  v_windows_pickup integer;
  v_checked_channels text[];
  v_missing_channels text[] := '{}';
  v_zones_active integer := 0;
  v_zones_with_fee integer := 0;
  v_point_verified boolean := false;
  v_riders integer := 0;
  v_riders_available integer := 0;
  v_alcohol_open boolean;
  v_image_required boolean;
  v_total integer;
  v_alcoholic integer;
  v_candidates integer;
  v_with_price integer;
  v_with_stock integer;
  v_uncounted integer;
  v_sold_out integer;
  v_with_photo integer;
  v_verified integer;
  v_published integer;
  v_ready_to_publish integer;
  v_settings public.business_payment_settings%rowtype;
  v_seller text;
  v_mp_ready boolean;
  v_ready_for_verification boolean;
  v_can_open boolean;
  v_accepting boolean;
  v_owners integer := 0;
  v_team integer := 0;
  v_commercial_managers integer := 0;
  v_declared_zones integer := 0;
  v_polygon_zones integer := 0;
  v_zones_own_fee integer := 0;
  v_declared_prices integer := 0;
  v_hours_ready boolean;
  v_coverage_ready boolean;
  v_delivery boolean;
  v_pickup boolean;
  v_fiscal_enabled boolean := false;
  v_fiscal_environment text;
  v_auto_print boolean := false;
  v_print_devices integer := 0;
  v_configuration jsonb := '[]'::jsonb;
  v_config_gates text[] := '{}';
  v_verification_blockers text[] := '{}';
begin
  if v_min < 1 or v_min > 500 then
    raise exception 'el mínimo de productos va de 1 a 500' using errcode = '22023';
  end if;
  -- EXECUTE lo tienen sólo `authenticated` y `service_role`. Una sesión de
  -- persona siempre trae `sub`: sin `sub` sólo puede ser la clave de servicio.
  if auth.uid() is not null
     and not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'sin autorizacion para ver la preparacion de la apertura' using errcode = '42501';
  end if;

  select * into v_b from public.businesses where id = p_business_id;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  -- ── Comercio ────────────────────────────────────────────────────────────────
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'BUSINESS_ACTIVE', 'group', 'business', 'blocking', true,
    'status', case when v_b.is_active then 'pass' else 'pending' end,
    'facts', '{}'::jsonb));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CURRENCY', 'group', 'business', 'blocking', true,
    'status', case when coalesce(v_b.currency_code, '') ~ '^[A-Z]{3}$' then 'pass' else 'pending' end,
    'facts', jsonb_build_object('currency', v_b.currency_code)));

  v_address := regexp_replace(btrim(coalesce(v_b.address, '')), '\s+', ' ', 'g');
  v_address_ok := char_length(v_address) >= 5 and v_address !~* '(a confirmar|no publicad|sin direcci)';
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'BUSINESS_ADDRESS', 'group', 'business', 'blocking', coalesce(v_b.pickup_enabled, false),
    'status', case when v_address_ok then 'pass' when coalesce(v_b.pickup_enabled, false) then 'pending' else 'warn' end,
    'facts', jsonb_build_object('present', v_address_ok, 'required_for_pickup', coalesce(v_b.pickup_enabled, false))));

  v_contact_digits := regexp_replace(coalesce(v_b.whatsapp_phone, ''), '[^0-9]', '', 'g');
  v_contact_ok := coalesce(v_b.whatsapp_verified, false) and char_length(v_contact_digits) between 8 and 15;
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'BUSINESS_CONTACT', 'group', 'business', 'blocking', false,
    'status', case when v_contact_ok then 'pass' else 'warn' end,
    'facts', jsonb_build_object('configured', char_length(v_contact_digits) > 0, 'confirmed', v_contact_ok)));

  -- ── Entrega ─────────────────────────────────────────────────────────────────
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'FULFILLMENT_MODE', 'group', 'fulfillment', 'blocking', true,
    'status', case when coalesce(v_b.delivery_enabled, false) or coalesce(v_b.pickup_enabled, false) then 'pass' else 'pending' end,
    'facts', jsonb_build_object('delivery', coalesce(v_b.delivery_enabled, false), 'pickup', coalesce(v_b.pickup_enabled, false))));

  v_tz_ok := v_b.operating_timezone is not null
    and exists (select 1 from pg_catalog.pg_timezone_names where name = v_b.operating_timezone);
  select count(*) filter (where h.channel = 'delivery'), count(*) filter (where h.channel = 'pickup')
    into v_windows_delivery, v_windows_pickup
    from public.business_service_hours h
   where h.business_id = p_business_id;
  v_checked_channels := array_remove(array[
    case when coalesce(v_b.delivery_enabled, false) then 'delivery' end,
    case when coalesce(v_b.pickup_enabled, false) then 'pickup' end], null);
  if cardinality(v_checked_channels) = 0 then
    v_checked_channels := array['delivery', 'pickup'];
  end if;
  if 'delivery' = any (v_checked_channels) and v_windows_delivery = 0 then
    v_missing_channels := array_append(v_missing_channels, 'delivery');
  end if;
  if 'pickup' = any (v_checked_channels) and v_windows_pickup = 0 then
    v_missing_channels := array_append(v_missing_channels, 'pickup');
  end if;
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'SERVICE_HOURS', 'group', 'fulfillment', 'blocking', coalesce(v_b.hours_enforced, false),
    'status', case
      when not coalesce(v_b.hours_enforced, false) then 'warn'
      when v_tz_ok and cardinality(v_missing_channels) = 0 then 'pass'
      else 'pending' end,
    'facts', jsonb_build_object(
      'enforced', coalesce(v_b.hours_enforced, false),
      'timezone_ok', v_tz_ok,
      'delivery_windows', v_windows_delivery,
      'pickup_windows', v_windows_pickup,
      'missing_channels', to_jsonb(v_missing_channels),
      'open_now_delivery', public.business_is_open(p_business_id, 'delivery', now()),
      'open_now_pickup', public.business_is_open(p_business_id, 'pickup', now()),
      'next_open_delivery', public.business_next_open_at(p_business_id, 'delivery', now()),
      'next_open_pickup', public.business_next_open_at(p_business_id, 'pickup', now()))));

  if coalesce(v_b.delivery_enabled, false) then
    -- `businesses_ordering_verified_configuration`: con delivery encendido el
    -- comercio verificado necesita envío y mínimo propios (el mínimo puede ser 0).
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'DELIVERY_PRICING', 'group', 'fulfillment', 'blocking', true,
      'status', case when v_b.delivery_fee is not null and v_b.minimum_delivery_subtotal is not null then 'pass' else 'pending' end,
      'facts', jsonb_build_object(
        'fee_set', v_b.delivery_fee is not null, 'minimum_set', v_b.minimum_delivery_subtotal is not null,
        'fee', v_b.delivery_fee, 'minimum', v_b.minimum_delivery_subtotal)));

    select count(*) filter (where z.is_active),
           count(*) filter (where z.is_active and coalesce(z.delivery_fee, v_b.delivery_fee) is not null)
      into v_zones_active, v_zones_with_fee
      from public.delivery_zones z
     where z.business_id = p_business_id;
    select exists (
      select 1 from private.rider_map_business_locations l
       where l.business_id = p_business_id and l.human_verified
         and l.latitude is not null and l.longitude is not null)
      into v_point_verified;
    if v_b.delivery_max_radius_meters is not null and not v_point_verified then
      v_status := 'pending';
      v_blocking := true;
    elsif coalesce(v_b.delivery_zone_enforced, false) then
      v_status := case when v_zones_with_fee > 0 then 'pass' else 'pending' end;
      v_blocking := true;
    else
      -- Sin exigir zonas, `resolve_delivery_zone` acepta cualquier dirección
      -- con el envío del comercio. Es legítimo, pero conviene decidirlo.
      v_status := 'warn';
      v_blocking := false;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'DELIVERY_COVERAGE', 'group', 'fulfillment', 'blocking', v_blocking, 'status', v_status,
      'facts', jsonb_build_object(
        'enforced', coalesce(v_b.delivery_zone_enforced, false),
        'active_zones', v_zones_active, 'zones_with_fee', v_zones_with_fee,
        'max_radius_set', v_b.delivery_max_radius_meters is not null, 'point_verified', v_point_verified)));

    select count(*) into v_riders
      from public.business_members bm
      left join public.identity_user_security us on us.business_id = bm.business_id and us.user_id = bm.user_id
     where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active and us.disabled_at is null;
    select count(*) into v_riders_available
      from public.business_members bm
     where bm.business_id = p_business_id and bm.role = 'rider' and bm.is_active
       and public.rider_availability_effective(p_business_id, bm.user_id);
    -- Sin repartidores el comercio puede entregar por su cuenta y cerrar con
    -- el código del cliente (20260919120000): no es una compuerta.
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'code', 'RIDERS', 'group', 'fulfillment', 'blocking', false,
      'status', case when v_riders > 0 then 'pass' else 'warn' end,
      'facts', jsonb_build_object('riders', v_riders, 'available_now', v_riders_available,
        'presence_required', coalesce(v_b.rider_presence_required, false))));
  else
    v_items := v_items
      || jsonb_build_array(jsonb_build_object('code', 'DELIVERY_PRICING', 'group', 'fulfillment', 'blocking', false,
           'status', 'na', 'facts', '{}'::jsonb))
      || jsonb_build_array(jsonb_build_object('code', 'DELIVERY_COVERAGE', 'group', 'fulfillment', 'blocking', false,
           'status', 'na', 'facts', '{}'::jsonb))
      || jsonb_build_array(jsonb_build_object('code', 'RIDERS', 'group', 'fulfillment', 'blocking', false,
           'status', 'na', 'facts', '{}'::jsonb));
  end if;

  -- ── Catálogo ────────────────────────────────────────────────────────────────
  -- Misma política de alcohol que exige `create_order_with_items`.
  v_alcohol_open := coalesce(v_b.alcohol_sales_enabled, false)
    and v_b.alcohol_minimum_age is not null and v_b.alcohol_sales_start is not null
    and v_b.alcohol_sales_end is not null and v_b.alcohol_timezone is not null;
  -- Espejo exacto de `cp_published_requires_approved_image`: sólo el comercio
  -- real de CONTROLLED_PRODUCTION publica con foto aprobada obligatoria.
  v_image_required := p_business_id = 'e7850ad2-a447-402c-8375-3fd74e9466ba'::uuid;

  with catalog as (
    select p.*,
           p.is_active and (not coalesce(p.is_alcoholic, false) or v_alcohol_open) as sellable,
           p.price_status = 'confirmed' and coalesce(p.price, 0) > 0 as priced,
           p.stock is not null and p.stock > 0 as stocked,
           p.catalog_asset_id is not null and p.image_url is not null and public.product_commercial_image_valid(p) as with_image
      from public.products p
     where p.business_id = p_business_id
  )
  select count(*),
         count(*) filter (where coalesce(is_alcoholic, false)),
         count(*) filter (where sellable),
         count(*) filter (where sellable and priced),
         count(*) filter (where sellable and stocked),
         count(*) filter (where sellable and stock is null),
         count(*) filter (where sellable and stock = 0),
         count(*) filter (where sellable and with_image),
         count(*) filter (where sellable and is_verified),
         count(*) filter (where sellable and available),
         count(*) filter (where sellable and not available and priced and stocked
                           and (with_image or not v_image_required))
    into v_total, v_alcoholic, v_candidates, v_with_price, v_with_stock, v_uncounted, v_sold_out,
         v_with_photo, v_verified, v_published, v_ready_to_publish
    from catalog;

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CATALOG_PRICES', 'group', 'catalog', 'blocking', true,
    'status', case when v_with_price >= v_min then 'pass' else 'pending' end,
    'facts', jsonb_build_object('with_price', v_with_price, 'candidates', v_candidates, 'min', v_min)));
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CATALOG_STOCK', 'group', 'catalog', 'blocking', true,
    'status', case when v_with_stock >= v_min then 'pass' else 'pending' end,
    'facts', jsonb_build_object('with_stock', v_with_stock, 'uncounted', v_uncounted, 'sold_out', v_sold_out,
      'candidates', v_candidates, 'min', v_min)));
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CATALOG_PHOTOS', 'group', 'catalog', 'blocking', v_image_required,
    'status', case when not v_image_required then 'na' when v_with_photo >= v_min then 'pass' else 'pending' end,
    'facts', jsonb_build_object('required', v_image_required, 'with_photo', v_with_photo,
      'candidates', v_candidates, 'min', v_min)));
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'CATALOG_PUBLISHED', 'group', 'catalog', 'blocking', true,
    'status', case when v_published >= v_min then 'pass' else 'pending' end,
    'facts', jsonb_build_object('published', v_published, 'verified', v_verified,
      'ready_to_publish', v_ready_to_publish, 'min', v_min)));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'ALCOHOL_POLICY', 'group', 'catalog', 'blocking', false,
    'status', case when v_alcohol_open then 'pass' else 'info' end,
    'facts', jsonb_build_object('enabled', v_alcohol_open, 'alcoholic_products', v_alcoholic)));

  -- ── Pagos ───────────────────────────────────────────────────────────────────
  -- Efectivo y «a coordinar» (que el comercio confirma como efectivo o
  -- transferencia) no dependen de ninguna configuración.
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'PAYMENT_MANUAL', 'group', 'payments', 'blocking', true, 'status', 'pass',
    'facts', jsonb_build_object('methods', jsonb_build_array('cash', 'coordinate'))));

  select * into v_settings from public.business_payment_settings s
   where s.business_id = p_business_id and s.provider = 'mercadopago';
  select c.status into v_seller
    from public.mp_seller_connections c
   where c.business_id = p_business_id
   order by (c.status = 'connected') desc, (c.environment = coalesce(v_settings.environment, 'production')) desc
   limit 1;
  v_mp_ready := coalesce((public.get_mercadopago_checkout_availability(p_business_id) ->> 'available')::boolean, false)
    or (
      coalesce(v_settings.enabled, false)
      and v_settings.checkout_mode = 'checkout_pro'
      and v_settings.currency = 'ARS'
      and (v_settings.environment <> 'production' or v_settings.production_review_status = 'approved')
      and exists (
        select 1 from public.mp_seller_connections c
         where c.business_id = p_business_id and c.environment = v_settings.environment
           and c.status = 'connected' and c.protected_tokens is not null
           and c.seller_id = v_settings.collector_id and c.application_id = v_settings.application_id)
    );
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'PAYMENT_MERCADOPAGO', 'group', 'payments', 'blocking', false,
    'status', case when v_mp_ready then 'pass' else 'info' end,
    'facts', jsonb_build_object(
      'seller', coalesce(v_seller, 'none'),
      'platform_enabled', coalesce(v_settings.enabled, false),
      'review_approved', coalesce(v_settings.production_review_status, '') = 'approved',
      'ready', v_mp_ready)));

  -- ── Plataforma y apertura ───────────────────────────────────────────────────
  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'PLATFORM_VERIFICATION', 'group', 'platform', 'blocking', true,
    'status', case when v_b.ordering_verified and v_b.ordering_enabled then 'pass' else 'pending' end,
    'facts', jsonb_build_object('verified', v_b.ordering_verified, 'enabled', v_b.ordering_enabled,
      'verified_at', v_b.ordering_verified_at)));

  v_items := v_items || jsonb_build_array(jsonb_build_object(
    'code', 'STORE_OPEN', 'group', 'open', 'blocking', false,
    'status', case when v_b.status = 'open' then 'pass' else 'info' end,
    'facts', jsonb_build_object('status', v_b.status)));

  select coalesce(array_agg(item ->> 'code' order by ordinality), '{}')
    into v_pending
    from jsonb_array_elements(v_items) with ordinality as e(item, ordinality)
   where (item ->> 'blocking')::boolean and item ->> 'status' <> 'pass';

  v_ready_for_verification := not exists (
    select 1 from unnest(v_pending) as code where code <> 'PLATFORM_VERIFICATION');
  v_can_open := cardinality(v_pending) = 0;
  v_accepting := v_can_open and v_b.status = 'open' and v_b.is_active and (
    (coalesce(v_b.delivery_enabled, false) and public.business_is_open(p_business_id, 'delivery', now()))
    or (coalesce(v_b.pickup_enabled, false) and public.business_is_open(p_business_id, 'pickup', now())));

  -- ── Configuración que el comercio tiene que tener antes de tomar pedidos ────
  -- Es ADITIVO: `items`, `pending`, `ready_for_platform_verification`, `can_open`
  -- y `accepting_orders` salen exactamente como salían. Acá cada dato se dice con
  -- tres estados (CONFIGURED, MISSING, NOT_REQUIRED) y con `blocks_opening`, que
  -- es verdadero sólo donde `platform_verify_business_ordering` se niega mientras
  -- falte. `gate` es el código con el que esa negativa lo nombra.
  v_delivery := coalesce(v_b.delivery_enabled, false);
  v_pickup := coalesce(v_b.pickup_enabled, false);

  select count(*) filter (where bm.role = 'owner'),
         count(*) filter (where bm.role in ('admin', 'staff'))
    into v_owners, v_team
    from public.business_members bm
    left join public.identity_user_security us on us.business_id = bm.business_id and us.user_id = bm.user_id
   where bm.business_id = p_business_id and bm.is_active and us.disabled_at is null;
  select count(*) into v_commercial_managers
    from public.business_commercial_managers m
   where m.business_id = p_business_id;

  -- Sin horario exigido el comercio toma pedidos a cualquier hora mientras esté
  -- abierto a mano; sin cobertura exigida, a cualquier dirección. Las dos cosas
  -- eran una advertencia y la plataforma verificaba igual.
  v_hours_ready := coalesce(v_b.hours_enforced, false) and v_tz_ok and cardinality(v_missing_channels) = 0;
  v_coverage_ready := coalesce(v_b.delivery_zone_enforced, false) and v_zones_with_fee > 0
    and (v_b.delivery_max_radius_meters is null or v_point_verified);

  select count(*) filter (where z.match_kind = 'declared_area'),
         count(*) filter (where z.match_kind = 'polygon'),
         count(*) filter (where z.delivery_fee is not null),
         count(distinct coalesce(coalesce(z.delivery_fee, v_b.delivery_fee)::text, '-') || '|'
                        || coalesce(coalesce(z.minimum_subtotal, v_b.minimum_delivery_subtotal)::text, '-'))
           filter (where z.match_kind = 'declared_area')
    into v_declared_zones, v_polygon_zones, v_zones_own_fee, v_declared_prices
    from public.delivery_zones z
   where z.business_id = p_business_id and z.is_active;

  select coalesce(fp.is_enabled, false) and coalesce(fp.environment, 'disabled') <> 'disabled', fp.environment
    into v_fiscal_enabled, v_fiscal_environment
    from public.fiscal_profiles fp
   where fp.business_id = p_business_id;
  v_fiscal_enabled := coalesce(v_fiscal_enabled, false);

  select coalesce(ps.auto_print_enabled, false) into v_auto_print
    from public.business_print_settings ps
   where ps.business_id = p_business_id;
  v_auto_print := coalesce(v_auto_print, false);
  select count(*) into v_print_devices
    from public.local_devices ld
   where ld.business_id = p_business_id and ld.status = 'active';

  v_configuration := jsonb_build_array(
    -- Sin un dueño activo nadie puede cerrar el negocio, cambiar horarios o
    -- zonas, ni responder por la caja.
    jsonb_build_object('code', 'OWNER', 'gate', 'BUSINESS_OWNER', 'blocks_opening', true,
      'status', case when v_owners > 0 then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('owners', v_owners)),
    jsonb_build_object('code', 'SERVICE_HOURS', 'gate', 'SERVICE_HOURS', 'blocks_opening', true,
      'status', case when v_hours_ready then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object(
        'enforced', coalesce(v_b.hours_enforced, false),
        'timezone_ok', v_tz_ok,
        'delivery_windows', v_windows_delivery,
        'pickup_windows', v_windows_pickup,
        'missing_channels', to_jsonb(v_missing_channels))),
    jsonb_build_object('code', 'DELIVERY_ZONES', 'gate', 'DELIVERY_COVERAGE', 'blocks_opening', v_delivery,
      'status', case when not v_delivery then 'NOT_REQUIRED' when v_coverage_ready then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object(
        'enforced', coalesce(v_b.delivery_zone_enforced, false),
        'active_zones', v_zones_active,
        'zones_with_fee', v_zones_with_fee,
        'declared_zones', v_declared_zones,
        'polygon_zones', v_polygon_zones,
        'max_radius_set', v_b.delivery_max_radius_meters is not null,
        'point_verified', v_point_verified,
        -- Con barrios declarados de distinto precio el cliente elige el barrio y
        -- con él el envío y el mínimo; el tope de distancia no distingue zonas.
        'declared_prices', v_declared_prices,
        'customer_selects_price', coalesce(v_b.delivery_zone_enforced, false) and v_declared_prices > 1)),
    jsonb_build_object('code', 'DELIVERY_FEES', 'gate', 'DELIVERY_PRICING', 'blocks_opening', v_delivery,
      'status', case when not v_delivery then 'NOT_REQUIRED' when v_b.delivery_fee is not null then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('business_fee_set', v_b.delivery_fee is not null, 'fee', v_b.delivery_fee,
        'zones_with_own_fee', v_zones_own_fee)),
    jsonb_build_object('code', 'MINIMUM_ORDER', 'gate', 'DELIVERY_PRICING', 'blocks_opening', v_delivery,
      'status', case when not v_delivery then 'NOT_REQUIRED' when v_b.minimum_delivery_subtotal is not null then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('minimum_set', v_b.minimum_delivery_subtotal is not null,
        'minimum', v_b.minimum_delivery_subtotal)),
    jsonb_build_object('code', 'PICKUP', 'gate', 'BUSINESS_ADDRESS', 'blocks_opening', v_pickup,
      'status', case when not v_pickup then 'NOT_REQUIRED' when v_address_ok then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('enabled', v_pickup, 'address_present', v_address_ok)),
    -- El dueño puede operar solo: el equipo no es una compuerta.
    jsonb_build_object('code', 'STAFF', 'gate', null, 'blocks_opening', false,
      'status', case when v_team > 0 then 'CONFIGURED' else 'NOT_REQUIRED' end,
      'facts', jsonb_build_object('members', v_team, 'commercial_managers', v_commercial_managers)),
    -- Sin repartidores el comercio entrega por su cuenta (20260919120000). Sólo
    -- faltan si el propio comercio pidió repartidor presente.
    jsonb_build_object('code', 'RIDERS', 'gate', null, 'blocks_opening', false,
      'status', case
        when not v_delivery then 'NOT_REQUIRED'
        when v_riders > 0 then 'CONFIGURED'
        when coalesce(v_b.rider_presence_required, false) then 'MISSING'
        else 'NOT_REQUIRED' end,
      'facts', jsonb_build_object('riders', v_riders, 'available_now', v_riders_available,
        'presence_required', coalesce(v_b.rider_presence_required, false))),
    -- Efectivo y «a coordinar» no dependen de configuración: Mercado Pago sólo
    -- falta cuando la plataforma lo encendió y la cuenta no está lista.
    jsonb_build_object('code', 'MERCADOPAGO_SELLER', 'gate', null, 'blocks_opening', false,
      'status', case
        when v_mp_ready then 'CONFIGURED'
        when coalesce(v_settings.enabled, false) then 'MISSING'
        else 'NOT_REQUIRED' end,
      'facts', jsonb_build_object('seller', coalesce(v_seller, 'none'),
        'platform_enabled', coalesce(v_settings.enabled, false), 'ready', v_mp_ready)),
    -- La facturación electrónica se enciende después de abrir.
    jsonb_build_object('code', 'FISCAL_CONFIG', 'gate', null, 'blocks_opening', false,
      'status', case when v_fiscal_enabled then 'CONFIGURED' else 'NOT_REQUIRED' end,
      'facts', jsonb_build_object('enabled', v_fiscal_enabled, 'environment', coalesce(v_fiscal_environment, 'none'))),
    jsonb_build_object('code', 'PRINTER_CONFIG', 'gate', null, 'blocks_opening', false,
      'status', case
        when not v_auto_print then 'NOT_REQUIRED'
        when v_print_devices > 0 then 'CONFIGURED'
        else 'MISSING' end,
      'facts', jsonb_build_object('auto_print_enabled', v_auto_print, 'active_devices', v_print_devices)),
    -- El valor es del comercio: acá no se inventa un plazo.
    jsonb_build_object('code', 'ABANDONED_ORDER_POLICY', 'gate', null, 'blocks_opening', false,
      'status', case when v_b.abandoned_order_minutes is not null then 'CONFIGURED' else 'MISSING' end,
      'facts', jsonb_build_object('minutes', v_b.abandoned_order_minutes)));

  select coalesce(array_agg(distinct entry ->> 'gate'), '{}')
    into v_config_gates
    from jsonb_array_elements(v_configuration) as c(entry)
   where (entry ->> 'blocks_opening')::boolean and entry ->> 'status' = 'MISSING';

  -- Lo que hace que la plataforma se niegue a verificar, en el orden de la lista:
  -- lo que ya bloqueaba más lo que falta de la configuración.
  select coalesce(array_agg(code order by ord), '{}')
    into v_verification_blockers
    from (
      select 'BUSINESS_OWNER'::text as code, 0::bigint as ord
       where 'BUSINESS_OWNER' = any (v_config_gates)
      union all
      select item ->> 'code', ordinality
        from jsonb_array_elements(v_items) with ordinality as e(item, ordinality)
       where item ->> 'code' <> 'PLATFORM_VERIFICATION'
         and (((item ->> 'blocking')::boolean and item ->> 'status' <> 'pass')
              or item ->> 'code' = any (v_config_gates))
    ) blockers;

  return jsonb_build_object(
    'generated_at', clock_timestamp(),
    'business_id', p_business_id,
    'business', jsonb_build_object('slug', v_b.slug, 'name', v_b.name, 'status', v_b.status),
    'min_products', v_min,
    'items', v_items,
    'counts', jsonb_build_object(
      'products', v_total, 'alcoholic', v_alcoholic, 'candidates', v_candidates,
      'with_price', v_with_price, 'with_stock', v_with_stock, 'uncounted', v_uncounted, 'sold_out', v_sold_out,
      'with_photo', v_with_photo, 'verified', v_verified, 'published', v_published,
      'ready_to_publish', v_ready_to_publish),
    'pending', to_jsonb(v_pending),
    'ready_for_platform_verification', v_ready_for_verification,
    'can_open', v_can_open,
    'accepting_orders', v_accepting,
    'configuration', v_configuration,
    'verification_blockers', to_jsonb(v_verification_blockers),
    'verification_ready', cardinality(v_verification_blockers) = 0
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.guard_business_currency_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

begin
  raise exception 'la moneda de un comercio con pedidos verificados no se cambia'
    using errcode = '55000',
          detail = format('currency_code %s -> %s', old.currency_code, coalesce(new.currency_code, 'NULL')),
          hint = 'revocar primero la verificacion de pedidos del comercio';
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.identity_revoke_all_sessions(p_business_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_actor uuid := auth.uid();
  v_actor_role text;
  v_check jsonb;
  v_revoked integer := 0;
  v_killed boolean := false;
begin
  if p_user_id = v_actor then
    v_actor_role := public.identity_member_role(p_business_id);
    if v_actor_role is null then
      return jsonb_build_object('ok', false, 'code', 'not_authorized');
    end if;
  else
    v_check := public.identity_assert_can_administer_member(
      p_business_id, p_user_id, 'identity.sessions.revoke');
    v_actor_role := v_check ->> 'actor_role';
  end if;

  insert into public.identity_user_security (business_id, user_id)
  values (p_business_id, p_user_id)
  on conflict (business_id, user_id) do nothing;

  update public.identity_user_security
     set sessions_valid_from = now()
   where business_id = p_business_id and user_id = p_user_id;

  update public.identity_sessions
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'revoke_all'
   where business_id = p_business_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  v_killed := public.identity_kill_auth_sessions_for_user(p_user_id);

  perform public.identity_record_audit_event(
    p_event_type => 'sessions_revoked_all',
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => p_user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('sessions_revoked', v_revoked, 'auth_sessions_killed', v_killed)
  );

  return jsonb_build_object('ok', true, 'sessions_revoked', v_revoked);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.identity_revoke_session(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_actor uuid := auth.uid();
  v_session public.identity_sessions%rowtype;
  v_check jsonb;
  v_actor_role text;
begin
  select * into v_session from public.identity_sessions where session_id = p_session_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;

  -- Cerrar la propia sesion no exige permiso de administracion.
  if v_session.user_id = v_actor then
    v_actor_role := public.identity_member_role(v_session.business_id);
  else
    v_check := public.identity_assert_can_administer_member(
      v_session.business_id, v_session.user_id, 'identity.sessions.revoke');
    v_actor_role := v_check ->> 'actor_role';
  end if;

  if v_session.revoked_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already_revoked');
  end if;

  update public.identity_sessions
     set revoked_at = now(),
         revoked_by = v_actor,
         revoked_reason = case when v_session.user_id = v_actor then 'self_logout' else 'owner_revoked' end
   where session_id = p_session_id;

  perform public.identity_kill_auth_session(p_session_id);

  perform public.identity_record_audit_event(
    p_event_type => 'session_revoked',
    p_business_id => v_session.business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => v_session.user_id,
    p_session_id => p_session_id,
    p_metadata => jsonb_build_object('client', v_session.client, 'device_label', v_session.device_label)
  );

  return jsonb_build_object('ok', true, 'code', 'revoked');
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.identity_set_member_active(p_business_id uuid, p_user_id uuid, p_is_active boolean, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_actor uuid := auth.uid();
  v_check jsonb := public.identity_assert_can_administer_member(
    p_business_id, p_user_id, 'identity.members.write');
  v_actor_role text := v_check ->> 'actor_role';
  v_target_role text := v_check ->> 'target_role';
  v_revoked integer := 0;
  v_killed boolean := false;
begin
  if p_is_active is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_state');
  end if;

  if not p_is_active
     and v_target_role = 'owner'
     and public.identity_count_active_owners(p_business_id) <= 1 then
    return jsonb_build_object('ok', false, 'code', 'last_owner');
  end if;

  perform set_config('taba.identity_write', 'on', true);
  update public.business_members
     set is_active = p_is_active
   where business_id = p_business_id
     and user_id = p_user_id;
  perform set_config('taba.identity_write', 'off', true);

  insert into public.identity_user_security (business_id, user_id)
  values (p_business_id, p_user_id)
  on conflict (business_id, user_id) do nothing;

  if p_is_active then
    update public.identity_user_security
       set disabled_at = null, disabled_by = null, disabled_reason = null
     where business_id = p_business_id and user_id = p_user_id;
    update public.staff_profiles set status = 'active'
     where business_id = p_business_id and user_id = p_user_id;
    update public.rider_profiles set status = 'active'
     where business_id = p_business_id and user_id = p_user_id;
  else
    update public.identity_user_security
       set disabled_at = now(),
           disabled_by = v_actor,
           disabled_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           -- Corte por fecha: aunque exista un token de una sesion que nunca
           -- se registro, queda del lado viejo de la linea.
           sessions_valid_from = now()
     where business_id = p_business_id and user_id = p_user_id;
    update public.staff_profiles set status = 'suspended'
     where business_id = p_business_id and user_id = p_user_id;
    update public.rider_profiles set status = 'suspended'
     where business_id = p_business_id and user_id = p_user_id;

    update public.identity_sessions
       set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'member_disabled'
     where business_id = p_business_id
       and user_id = p_user_id
       and revoked_at is null;
    get diagnostics v_revoked = row_count;

    v_killed := public.identity_kill_auth_sessions_for_user(p_user_id);
  end if;

  perform public.identity_record_audit_event(
    p_event_type => case when p_is_active then 'member_activated' else 'member_disabled' end,
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => p_user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object(
      'target_role', v_target_role,
      'sessions_revoked', v_revoked,
      'auth_sessions_killed', v_killed,
      'reason', nullif(btrim(coalesce(p_reason, '')), '')
    )
  );

  return jsonb_build_object('ok', true, 'is_active', p_is_active, 'sessions_revoked', v_revoked);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.identity_set_member_role(p_business_id uuid, p_user_id uuid, p_role text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_actor uuid := auth.uid();
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_actor_role text;
  v_target_role text;
  v_check jsonb;
  v_revoked integer := 0;
begin
  if v_role not in ('owner', 'admin', 'staff', 'rider') then
    return jsonb_build_object('ok', false, 'code', 'invalid_role');
  end if;

  -- Otorgar owner o admin es un acto de conduccion: exige identity.roles.write,
  -- que solo tiene el owner. Mover a alguien entre staff y rider alcanza con
  -- identity.members.write.
  v_check := public.identity_assert_can_administer_member(
    p_business_id,
    p_user_id,
    case when v_role in ('owner', 'admin') then 'identity.roles.write' else 'identity.members.write' end
  );
  v_actor_role := v_check ->> 'actor_role';
  v_target_role := v_check ->> 'target_role';

  if v_target_role = v_role then
    return jsonb_build_object('ok', true, 'code', 'unchanged', 'role', v_role);
  end if;

  if v_target_role = 'owner' and v_role <> 'owner'
     and public.identity_count_active_owners(p_business_id) <= 1 then
    return jsonb_build_object('ok', false, 'code', 'last_owner');
  end if;

  perform set_config('taba.identity_write', 'on', true);
  update public.business_members
     set role = v_role
   where business_id = p_business_id
     and user_id = p_user_id;
  perform set_config('taba.identity_write', 'off', true);

  -- El perfil sigue al rol: quien pasa a Rider no conserva su ficha de Panel.
  if v_role = 'rider' then
    delete from public.staff_profiles where business_id = p_business_id and user_id = p_user_id;
    insert into public.rider_profiles (business_id, user_id, full_name, created_by)
    select p_business_id, p_user_id,
           coalesce((select sp.full_name from public.staff_profiles sp
                      where sp.business_id = p_business_id and sp.user_id = p_user_id), 'Sin nombre'),
           v_actor
    on conflict (business_id, user_id) do update set status = 'active';
  else
    delete from public.rider_profiles where business_id = p_business_id and user_id = p_user_id;
    insert into public.staff_profiles (business_id, user_id, full_name, created_by)
    select p_business_id, p_user_id,
           coalesce((select rp.full_name from public.rider_profiles rp
                      where rp.business_id = p_business_id and rp.user_id = p_user_id), 'Sin nombre'),
           v_actor
    on conflict (business_id, user_id) do update set status = 'active';
  end if;

  -- Un cambio de rol invalida las sesiones abiertas: la persona vuelve a
  -- entrar y su cliente descarga los permisos nuevos desde cero.
  update public.identity_sessions
     set revoked_at = now(), revoked_by = v_actor, revoked_reason = 'role_changed'
   where business_id = p_business_id
     and user_id = p_user_id
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  perform public.identity_kill_auth_sessions_for_user(p_user_id);

  perform public.identity_record_audit_event(
    p_event_type => 'member_role_changed',
    p_business_id => p_business_id,
    p_actor_user_id => v_actor,
    p_actor_role => v_actor_role,
    p_subject_user_id => p_user_id,
    p_session_id => public.identity_session_id(),
    p_metadata => jsonb_build_object('from', v_target_role, 'to', v_role, 'sessions_revoked', v_revoked)
  );

  return jsonb_build_object('ok', true, 'role', v_role, 'sessions_revoked', v_revoked);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.issue_order_delivery_code(p_order_id uuid, p_tracking_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_token public.order_public_tokens%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_random bytea;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_tracking_token is null
    or p_tracking_token !~ '^[A-Za-z0-9_-]{32,255}[A-Za-z0-9_-]?$' then
    raise exception 'credenciales de entrega invalidas' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.customer_user_id = auth.uid()
   for update;

  if not found then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;
  if v_order.delivery_mode <> 'delivery' then
    raise exception 'codigo no requerido para retiro' using errcode = '22023';
  end if;
  if v_order.status in ('delivered', 'canceled', 'cancelled', 'rejected') then
    raise exception 'pedido terminal' using errcode = '55000';
  end if;

  select opt.*
    into v_token
    from public.order_public_tokens opt
   where opt.order_id = v_order.id
     and opt.token_hash = digest(p_tracking_token, 'sha256')
     and opt.revoked_at is null
     and opt.expires_at > clock_timestamp()
   limit 1;

  if not found then
    raise exception 'token de seguimiento invalido' using errcode = '42501';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  if found then
    if v_handoff.expires_at <= clock_timestamp() then
      raise exception 'codigo de entrega vencido' using errcode = '55000';
    end if;
    return jsonb_build_object(
      'delivery_code',
      pgp_sym_decrypt(v_handoff.code_ciphertext, p_tracking_token),
      'expires_at',
      v_handoff.expires_at
    );
  end if;

  v_random := gen_random_bytes(3);
  v_code := (
    1000 + (
      get_byte(v_random, 0)::bigint * 65536
      + get_byte(v_random, 1)::bigint * 256
      + get_byte(v_random, 2)::bigint
    ) % 9000
  )::text;

  insert into public.order_delivery_handoffs (
    order_id,
    code_hash,
    code_ciphertext,
    expires_at
  ) values (
    v_order.id,
    crypt(v_code, gen_salt('bf', 10)),
    pgp_sym_encrypt(v_code, p_tracking_token, 'cipher-algo=aes256,compress-algo=0'),
    least(v_token.expires_at, clock_timestamp() + interval '48 hours')
  )
  returning * into v_handoff;

  return jsonb_build_object(
    'delivery_code', v_code,
    'expires_at', v_handoff.expires_at
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_delivery_picked_up(p_order_id uuid, p_expected_revision bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'picked_up' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'assigned' then return jsonb_build_object('ok', false, 'code', 'not_ready_for_pickup', 'revision', v_order.revision); end if;
  update public.orders set status = 'picked_up' where id = v_order.id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'picked_up', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'picked_up', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_payment_cancellation_ambiguous(p_cancellation_id uuid, p_request_hash text, p_error_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
  v_intent_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  -- Cobro -> solicitud, el orden de prepare_payment_cancellation. Al revés, esta marca y
  -- un segundo pedido de cancelación del mismo cobro terminaban en deadlock. No toca la
  -- sesión, así que no la toma. El id del cobro se lee sin candado y se comprueba después.
  select c.payment_intent_id into v_intent_id from public.payment_cancellations c where c.id = p_cancellation_id;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = v_intent_id for share;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  if v_cancellation.payment_intent_id is distinct from v_intent_id then
    raise exception 'la cancelacion cambio de cobro mientras se marcaba' using errcode = 'PT409';
  end if;
  -- Lo que el proveedor ya confirmó no vuelve a estar en duda.
  if v_cancellation.status in ('cancelled', 'rejected') then return true; end if;
  update public.payment_cancellations set status = 'ambiguous', raw_response_hash = p_request_hash where id = v_cancellation.id;
  if not exists (
    select 1 from public.payment_outbox o
     where o.cancellation_id = v_cancellation.id and o.topic = 'cancellation_reconcile'
       and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
  ) then
    insert into public.payment_outbox (payment_intent_id, cancellation_id, topic, resource_id, last_error)
    values (v_cancellation.payment_intent_id, v_cancellation.id, 'cancellation_reconcile', v_intent.provider_payment_id, left(coalesce(p_error_code, 'network_or_timeout'), 160));
  end if;
  return true;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_payment_refund_ambiguous(p_refund_id uuid, p_request_hash text, p_error_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_refund public.payment_refunds%rowtype; v_intent_id uuid;
begin
  if p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'hash invalido' using errcode='22023';
  end if;
  select payment_intent_id into v_intent_id from public.payment_refunds where id=p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode='P0002'; end if;
  perform 1 from public.payment_intents where id=v_intent_id for update;
  select * into v_refund from public.payment_refunds where id=p_refund_id for update;
  if not found or v_refund.payment_intent_id is distinct from v_intent_id then
    raise exception 'solicitud de reembolso cambio' using errcode='22023';
  end if;
  if v_refund.status in ('approved','rejected') then return true; end if;
  update public.payment_refunds set status='ambiguous',raw_response_hash=p_request_hash where id=p_refund_id;
  if not exists(select 1 from public.payment_outbox where refund_id=p_refund_id and topic='refund_reconcile'
    and status in ('pending','claimed','processing','retry_wait')) then
    insert into public.payment_outbox(payment_intent_id,refund_id,topic,resource_id,last_error)
      values(v_intent_id,p_refund_id,'refund_reconcile',null,left(coalesce(p_error_code,'network_or_timeout'),160));
  end if;
  return true;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_rider_arrived(p_order_id uuid, p_expected_revision bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'arrived' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'on_the_way' then return jsonb_build_object('ok', false, 'code', 'not_on_the_way', 'revision', v_order.revision); end if;
  update public.orders set status = 'arrived', arrived_at = clock_timestamp() where id = v_order.id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'arrived', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'arrived', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mp_begin_oauth(p_business_id uuid, p_user_id uuid, p_environment text, p_state_hash text, p_protected_verifier text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_generation uuid := gen_random_uuid();
begin
  insert into public.mp_seller_connections(business_id,environment) values(p_business_id,p_environment) on conflict do nothing;
  update public.mp_seller_connections set generation=v_generation, updated_at=now()
    where business_id=p_business_id and environment=p_environment and refresh_owner is null;
  if not found then raise exception 'connection_busy'; end if;
  delete from public.mp_oauth_states where (business_id=p_business_id and environment=p_environment) or expires_at < now();
  insert into public.mp_oauth_states values(p_state_hash,p_business_id,p_user_id,p_environment,v_generation,p_protected_verifier,now()+interval '10 minutes',now());
  return v_generation;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mp_disconnect(p_business_id uuid, p_environment text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

begin
  update public.mp_seller_connections set protected_tokens=null,status='disconnected',generation=gen_random_uuid(),
    refresh_owner=null,refresh_started_at=null,updated_at=now() where business_id=p_business_id and environment=p_environment;
  delete from public.mp_oauth_states where business_id=p_business_id and environment=p_environment;
  update public.business_payment_settings set enabled=false,updated_at=now() where business_id=p_business_id and environment=p_environment;
  return true;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mp_finish_oauth(p_business_id uuid, p_environment text, p_generation uuid, p_seller_id text, p_application_id text, p_scopes text, p_protected_tokens text, p_expires_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

begin
  perform 1 from public.mp_seller_connections where business_id=p_business_id and environment=p_environment and generation=p_generation for update;
  if not found then return false; end if;
  -- Once bound, a connection cannot silently switch seller, even without payments.
  -- Disconnect retains seller_id deliberately; reconnecting the same seller is allowed.
  if exists(select 1 from public.mp_seller_connections c where c.business_id=p_business_id
    and c.environment=p_environment and c.seller_id is not null and c.seller_id<>p_seller_id)
  then raise exception 'seller_change_requires_migration'; end if;
  -- Changing the receiving account while historical intents exist would corrupt reconciliation.
  if exists(select 1 from public.business_payment_settings s where s.business_id=p_business_id and s.collector_id is not null and s.collector_id<>p_seller_id
    and exists(select 1 from public.payment_intents i where i.business_id=p_business_id)) then raise exception 'seller_change_requires_migration'; end if;
  update public.mp_seller_connections set seller_id=p_seller_id,application_id=p_application_id,scopes=p_scopes,
    protected_tokens=p_protected_tokens,expires_at=p_expires_at,status='connected',connected_at=now(),updated_at=now(),refresh_owner=null,refresh_started_at=null
    where business_id=p_business_id and environment=p_environment and generation=p_generation;
  insert into public.business_payment_settings(business_id,environment,collector_id,application_id,configured_at,verified_at,enabled)
    values(p_business_id,p_environment,p_seller_id,p_application_id,now(),now(),p_environment='test')
  on conflict(business_id,provider) do update set collector_id=excluded.collector_id,application_id=excluded.application_id,
    configured_at=now(),verified_at=now(),updated_at=now(),
    enabled=case when business_payment_settings.environment=p_environment then business_payment_settings.enabled or p_environment='test' else false end,
    environment=p_environment;
  return true;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mp_finish_refresh(p_business_id uuid, p_environment text, p_owner uuid, p_generation uuid, p_protected_tokens text, p_expires_at timestamp with time zone, p_scopes text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

begin
  update public.mp_seller_connections set protected_tokens=p_protected_tokens,expires_at=p_expires_at,scopes=p_scopes,
    refresh_owner=null,refresh_started_at=null,last_refresh_at=now(),updated_at=now()
    where business_id=p_business_id and environment=p_environment and refresh_owner=p_owner and generation=p_generation and status='connected';
  return found;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mp_record_seller_webhook(p_environment text, p_webhook_event_id text, p_event_type text, p_resource_id text, p_signature_valid boolean, p_request_id text, p_payload_hash text, p_business_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_result jsonb;
begin
  if not exists(select 1 from public.mp_seller_connections where business_id=p_business_id and environment=p_environment and status='connected') then raise exception 'seller_not_connected'; end if;
  v_result := public.record_mercadopago_webhook_receipt(p_environment,p_webhook_event_id,p_event_type,p_resource_id,p_signature_valid,p_request_id,p_payload_hash);
  update public.payment_webhook_receipts set seller_business_id=p_business_id where id=(v_result->>'receipt_id')::uuid and seller_business_id is null;
  if exists(select 1 from public.payment_webhook_receipts where id=(v_result->>'receipt_id')::uuid and seller_business_id<>p_business_id) then raise exception 'webhook_business_mismatch'; end if;
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.offer_order_to_rider(p_order_id uuid, p_expected_status text, p_expected_rider_user_id uuid, p_new_rider_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_business_id uuid;v_required boolean;
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode='42501'; end if;
  select o.business_id,b.rider_presence_required into v_business_id,v_required
    from public.orders o join public.businesses b on b.id=o.business_id where o.id=p_order_id;
  if v_business_id is null then raise exception 'Pedido inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_business_id,array['owner','admin','staff']) then
    raise exception 'Rol de negocio requerido' using errcode='42501';
  end if;
  if p_new_rider_user_id is null then
    return public.offer_order_to_rider_pre_presence(p_order_id,p_expected_status,
      p_expected_rider_user_id,p_new_rider_user_id);
  end if;
  if v_required then
    perform public.lock_rider_capacity(p_new_rider_user_id);
    if not public.rider_availability_effective(v_business_id,p_new_rider_user_id) then
      return jsonb_build_object('ok',false,'code','rider_unavailable');
    end if;
  end if;
  return public.offer_order_to_rider_pre_presence(p_order_id,p_expected_status,
    p_expected_rider_user_id,p_new_rider_user_id);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.open_qa_window(p_business_id uuid, p_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'abrir una ventana QA requiere owner o admin' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 60 then
    raise exception 'la ventana QA dura entre 1 y 60 minutos' using errcode = '22023';
  end if;
  select * into v_business from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;
  if not v_business.qa_fixture then
    raise exception 'sólo un tenant QA abre ventana QA' using errcode = '42501';
  end if;
  update public.businesses
     set status = 'open', qa_window_until = clock_timestamp() + make_interval(mins => p_minutes),
         updated_at = now()
   where id = p_business_id
  returning * into v_business;
  return jsonb_build_object('ok', true, 'status', v_business.status, 'qa_window_until', v_business.qa_window_until);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.operator_set_mercadopago_for_business(p_business_id uuid, p_environment text, p_enabled boolean, p_expected_application_id text, p_production_review_approved boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_before public.business_payment_settings%rowtype;
  v_after public.business_payment_settings%rowtype;
  v_status text;
  v_seller text;
  v_application text;
  v_has_credential boolean;
begin
  if p_environment is null or p_environment not in ('test', 'production') then
    raise exception 'entorno inválido' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'falta indicar encendido o apagado' using errcode = '22023';
  end if;
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;
  select * into v_before from public.business_payment_settings
   where business_id = p_business_id and provider = 'mercadopago' for update;

  if not p_enabled then
    if v_before.id is null or not v_before.enabled then
      return jsonb_build_object('ok', true, 'changed', false, 'enabled', false,
        'environment', v_before.environment, 'offered', false);
    end if;
    update public.business_payment_settings set enabled = false, updated_at = clock_timestamp()
     where id = v_before.id
    returning * into v_after;
  else
    select c.status, c.seller_id, c.application_id, c.protected_tokens is not null
      into v_status, v_seller, v_application, v_has_credential
      from public.mp_seller_connections c
     where c.business_id = p_business_id and c.environment = p_environment
     for update;
    if not found or v_status <> 'connected' or not v_has_credential
      or nullif(btrim(coalesce(v_seller, '')), '') is null then
      raise exception 'la cuenta de Mercado Pago del negocio no está conectada en %', p_environment
        using errcode = 'P0001';
    end if;
    if v_application is distinct from nullif(btrim(coalesce(p_expected_application_id, '')), '') then
      raise exception 'la conexión pertenece a otra aplicación' using errcode = 'P0001';
    end if;
    if p_environment = 'production' and not coalesce(p_production_review_approved, false) then
      raise exception 'cobro real sin revisión productiva confirmada' using errcode = 'P0001';
    end if;
    insert into public.business_payment_settings(
      business_id, provider, environment, checkout_mode, currency, reserve_stock,
      collector_id, application_id, production_review_status, enabled, configured_at, verified_at
    ) values (
      p_business_id, 'mercadopago', p_environment, 'checkout_pro', 'ARS', true,
      v_seller, v_application,
      case when p_environment = 'production' then 'approved' else 'not_requested' end,
      true, clock_timestamp(), clock_timestamp()
    )
    on conflict (business_id, provider) do update set
      environment = excluded.environment,
      reserve_stock = true,
      collector_id = excluded.collector_id,
      application_id = excluded.application_id,
      production_review_status = case
        when excluded.environment = 'production' then 'approved'
        else business_payment_settings.production_review_status
      end,
      enabled = true,
      configured_at = coalesce(business_payment_settings.configured_at, clock_timestamp()),
      verified_at = clock_timestamp(),
      updated_at = clock_timestamp()
    returning * into v_after;
  end if;

  insert into public.business_config_audit(business_id, scope, action, actor_kind, before, after)
  values (
    p_business_id, 'payments', case when p_enabled then 'enabled' else 'disabled' end, 'service',
    case when v_before.id is null then null else jsonb_build_object(
      'provider', 'mercadopago', 'enabled', v_before.enabled, 'environment', v_before.environment,
      'production_review_status', v_before.production_review_status) end,
    jsonb_build_object(
      'provider', 'mercadopago', 'enabled', v_after.enabled, 'environment', v_after.environment,
      'production_review_status', v_after.production_review_status)
  );

  return jsonb_build_object(
    'ok', true, 'changed', true, 'enabled', v_after.enabled, 'environment', v_after.environment,
    'offered', coalesce((public.get_mercadopago_checkout_availability(p_business_id)->>'available')::boolean, false)
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_revoke_business_ordering(p_business_id uuid, p_actor_email text, p_confirm_slug text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_b public.businesses%rowtype;
  v_actor uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is not null then
    raise exception 'la verificacion de plataforma no se hace desde una sesion de persona' using errcode = '42501';
  end if;
  if v_reason is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    raise exception 'el motivo va de 3 a 300 caracteres' using errcode = '22023';
  end if;
  select * into v_b from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_confirm_slug), '') <> v_b.slug then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023',
      detail = 'para confirmar hay que escribir el identificador exacto del comercio';
  end if;
  select u.id into v_actor
    from auth.users u
   where lower(btrim(coalesce(u.email, ''))) = lower(btrim(coalesce(p_actor_email, '')))
     and btrim(coalesce(p_actor_email, '')) <> ''
     and not coalesce(u.is_anonymous, false)
     and u.email_confirmed_at is not null
     and u.deleted_at is null
   limit 1;
  if v_actor is null then
    raise exception 'VERIFIER_NOT_FOUND' using errcode = '22023',
      detail = 'quien revoca tiene que tener una cuenta confirmada';
  end if;
  if not v_b.ordering_verified and not v_b.ordering_enabled then
    return jsonb_build_object('ok', true, 'changed', false, 'status', v_b.status);
  end if;

  update public.businesses
     set ordering_enabled = false,
         ordering_verified = false,
         ordering_verified_at = null,
         ordering_verified_by = null,
         updated_at = now()
   where id = p_business_id
  returning * into v_b;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (
    p_business_id, 'platform_verification', 'disabled', 'user', v_actor,
    jsonb_build_object('ordering_verified', true, 'ordering_enabled', true),
    jsonb_build_object('ordering_verified', false, 'ordering_enabled', false, 'reason', v_reason)
  );
  return jsonb_build_object('ok', true, 'changed', true, 'status', v_b.status);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_verify_business_ordering(p_business_id uuid, p_verifier_email text, p_confirm_slug text, p_min_products integer DEFAULT 1, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_b public.businesses%rowtype;
  v_verifier uuid;
  v_readiness jsonb;
  v_pending text[];
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- EXECUTE es sólo de `service_role`. Una sesión de persona nunca llega acá.
  if auth.uid() is not null then
    raise exception 'la verificacion de plataforma no se hace desde una sesion de persona' using errcode = '42501';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'la nota va hasta 300 caracteres' using errcode = '22023';
  end if;

  select * into v_b from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;
  if coalesce(btrim(p_confirm_slug), '') <> v_b.slug then
    raise exception 'CONFIRMATION_MISMATCH' using errcode = '22023',
      detail = 'para confirmar hay que escribir el identificador exacto del comercio';
  end if;

  select u.id into v_verifier
    from auth.users u
   where lower(btrim(coalesce(u.email, ''))) = lower(btrim(coalesce(p_verifier_email, '')))
     and btrim(coalesce(p_verifier_email, '')) <> ''
     and not coalesce(u.is_anonymous, false)
     and u.email_confirmed_at is not null
     and u.deleted_at is null
     and (u.banned_until is null or u.banned_until <= now())
   limit 1;
  if v_verifier is null then
    raise exception 'VERIFIER_NOT_FOUND' using errcode = '22023',
      detail = 'quien verifica tiene que tener una cuenta confirmada y activa';
  end if;

  if v_b.ordering_verified and v_b.ordering_enabled then
    return jsonb_build_object('ok', true, 'changed', false, 'status', v_b.status,
      'verified_at', v_b.ordering_verified_at);
  end if;

  v_readiness := public.get_store_opening_readiness(p_business_id, p_min_products);
  -- `verification_blockers` trae lo que ya bloqueaba (las compuertas de `pending`)
  -- más lo que antes era sólo una advertencia: horario sin exigir, cobertura sin
  -- exigir con el delivery encendido, comercio sin dueño. Si la preparación no
  -- trae esa lista no se verifica a ciegas: se falla cerrado.
  if jsonb_typeof(v_readiness -> 'verification_blockers') is distinct from 'array' then
    raise exception 'OPENING_NOT_READY' using errcode = '55000', detail = 'READINESS_CONTRACT';
  end if;
  select coalesce(array_agg(code order by ord), '{}') into v_pending
    from jsonb_array_elements_text(v_readiness -> 'verification_blockers') with ordinality as blockers(code, ord);
  if cardinality(v_pending) > 0 then
    raise exception 'OPENING_NOT_READY' using errcode = '55000', detail = array_to_string(v_pending, ',');
  end if;

  update public.businesses
     set ordering_verified = true,
         ordering_verified_at = now(),
         ordering_verified_by = v_verifier,
         ordering_enabled = true,
         updated_at = now()
   where id = p_business_id
  returning * into v_b;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (
    p_business_id, 'platform_verification', 'enabled', 'user', v_verifier,
    jsonb_build_object('ordering_verified', false, 'ordering_enabled', false),
    jsonb_build_object('ordering_verified', true, 'ordering_enabled', true,
      'min_products', v_readiness -> 'min_products', 'note', v_note,
      'counts', v_readiness -> 'counts',
      'configuration', v_readiness -> 'configuration')
  );

  -- No abre el comercio: abrir es el botón del dueño.
  return jsonb_build_object('ok', true, 'changed', true, 'status', v_b.status,
    'verified_at', v_b.ordering_verified_at, 'ordering_enabled', v_b.ordering_enabled);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_mercadopago_preference_v2(p_checkout_session_id uuid, p_customer_id uuid, p_new_attempt boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_number integer;
  v_items jsonb;
begin
  select * into v_session from public.checkout_sessions s where s.id = p_checkout_session_id for update;
  if not found or v_session.customer_id <> p_customer_id then
    raise exception 'checkout no autorizado' using errcode = '42501';
  end if;
  if v_session.expires_at <= clock_timestamp() then
    -- Sin liberacion aca: la excepcion de abajo la deshacia. El stock de un
    -- checkout vencido lo devuelve el barrido (taba-checkout-expiry-sweep).
    raise exception 'checkout vencido' using errcode = '55000';
  end if;
  select * into v_intent from public.payment_intents pi where pi.checkout_session_id = v_session.id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_settings from public.business_payment_settings s
   where s.business_id = v_session.business_id and s.provider = 'mercadopago' for share;
  if not found or not v_settings.enabled or not v_settings.reserve_stock
    or v_settings.checkout_mode <> 'checkout_pro' or v_settings.currency <> 'ARS'
    or (v_settings.environment = 'production' and v_settings.production_review_status <> 'approved') then
    raise exception 'Mercado Pago no esta habilitado' using errcode = '55000';
  end if;
  if v_session.status in ('completed', 'payment_approved', 'finalizing_order', 'manual_review_required') then
    raise exception 'checkout no admite otra preferencia' using errcode = '55000';
  end if;
  -- Los items de la preferencia tienen que ser lo que se VENDE, no lo que se
  -- reserva. Un combo se reserva como sus componentes —el mostrador arma latas,
  -- no combos— pero se cobra como combo. Listar los componentes a precio de
  -- lista hacia que la suma de los items superara el total autoritativo, y el
  -- armador de la preferencia lanzaba
  -- `Preference items exceed the server-side checkout total`, que el Edge
  -- Function clasificaba como `network_or_timeout`. Ademas el comprador veria
  -- en Checkout Pro un total distinto del que su pedido cobra.
  select coalesce(jsonb_agg(lineas.linea order by lineas.linea ->> 'id'), '[]'::jsonb)
    into v_items
    from (
      select jsonb_build_object(
        'id', c.combo_id,
        'title', c.name,
        'description', 'Combo',
        'quantity', c.quantity,
        'currency_id', 'ARS',
        'unit_price', c.promotional_price
      ) as linea
        from public.checkout_session_combos c
       where c.checkout_session_id = v_session.id
      union all
      -- De cada producto queda lo que NO consume ningun combo: quien suma dos
      -- latas sueltas ademas del combo las paga aparte, a precio de lista.
      select jsonb_build_object(
        'id', i.product_id::text,
        'title', coalesce(i.product_snapshot ->> 'name', 'Producto TABA2'),
        'description', nullif(i.product_snapshot ->> 'presentation', ''),
        'quantity', suelto.quantity,
        'currency_id', 'ARS',
        'unit_price', i.unit_price
      )
        from public.checkout_session_items i
        cross join lateral (
          select i.quantity - coalesce((
            select sum(cc.quantity * c.quantity)
              from public.checkout_session_combos c
              join public.product_combo_components cc on cc.combo_id = c.combo_uuid
             where c.checkout_session_id = v_session.id
               and cc.product_id = i.product_id
          ), 0) as quantity
        ) as suelto
       where i.checkout_session_id = v_session.id
         and suelto.quantity > 0
    ) as lineas;
  select * into v_attempt from public.payment_attempts pa
   where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference'
   order by pa.attempt_number desc limit 1 for update;
  if found and not p_new_attempt and v_attempt.status in ('prepared', 'request_sent', 'created', 'ambiguous') then
    return jsonb_build_object(
      'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
      'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
      'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
      'preference_id', v_attempt.preference_id, 'init_point', v_attempt.init_point,
      'sandbox_init_point', v_attempt.sandbox_init_point, 'external_reference', v_intent.external_reference,
      'environment', v_intent.environment, 'currency', 'ARS', 'total', v_intent.expected_amount,
      'expires_at', v_session.expires_at, 'items', v_items,
      'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
      'installments_limit', v_settings.installments_limit
    );
  end if;
  if p_new_attempt then
    if v_intent.internal_status not in ('rejected', 'cancelled', 'expired', 'failed') then
      raise exception 'el pago actual no admite un nuevo intento controlado' using errcode = '55000';
    end if;
    if v_session.status in ('cancelled', 'expired', 'retrying') then
      perform public.reacquire_checkout_session_inventory(v_session.id, 'payment_retry');
      select * into v_session from public.checkout_sessions s where s.id = v_session.id for update;
    end if;
  elsif found and v_attempt.status in ('failed', 'cancelled') then
    raise exception 'solicita un nuevo intento de pago' using errcode = '55000';
  end if;
  if not exists (select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()) then
    raise exception 'reserva de stock no valida' using errcode = '55000';
  end if;
  select coalesce(max(pa.attempt_number), 0) + 1 into v_number
    from public.payment_attempts pa where pa.payment_intent_id = v_intent.id and pa.attempt_type = 'preference';
  insert into public.payment_attempts (payment_intent_id, attempt_number, attempt_type, status)
  values (v_intent.id, v_number, 'preference', 'prepared') returning * into v_attempt;
  update public.payment_intents
     set current_payment_attempt_id=v_attempt.id,
         internal_status = case when p_new_attempt or internal_status in ('created', 'ambiguous', 'preference_creating', 'preference_created', 'redirected')
                                then 'preference_creating' else internal_status end
   where id = v_intent.id;
  return jsonb_build_object(
    'checkout_session_id', v_session.id, 'payment_intent_id', v_intent.id,
    'payment_attempt_id', v_attempt.id, 'attempt_status', v_attempt.status,
    'attempt_number', v_attempt.attempt_number, 'idempotency_key', v_attempt.idempotency_key,
    'preference_id', null, 'init_point', null, 'sandbox_init_point', null,
    'external_reference', v_intent.external_reference, 'environment', v_intent.environment,
    'currency', 'ARS', 'total', v_intent.expected_amount, 'expires_at', v_session.expires_at,
    'items', v_items, 'allow_offline_payment_methods', v_settings.allow_offline_payment_methods,
    'installments_limit', v_settings.installments_limit
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_payment_cancellation(p_payment_intent_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_actor uuid := auth.uid(); v_intent public.payment_intents%rowtype; v_cancellation public.payment_cancellations%rowtype;
begin
  if v_actor is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then raise exception 'cancelacion no autorizada' using errcode = '42501'; end if;
  if v_intent.provider_payment_id is null or v_intent.internal_status not in ('pending', 'in_process') then raise exception 'pago no cancelable en su estado actual' using errcode = '55000'; end if;
  select * into v_cancellation from public.payment_cancellations c where c.idempotency_key = p_idempotency_key for update;
  if found then
    if v_cancellation.payment_intent_id <> v_intent.id then raise exception 'idempotency key pertenece a otra cancelacion' using errcode = '23505'; end if;
    return jsonb_build_object('cancellation_id', v_cancellation.id, 'provider_payment_id', v_intent.provider_payment_id, 'idempotency_key', v_cancellation.idempotency_key, 'idempotent', true, 'reconciliation_required', v_cancellation.status = 'ambiguous');
  end if;
  select * into v_cancellation from public.payment_cancellations c where c.payment_intent_id = v_intent.id and c.status in ('requested', 'processing', 'ambiguous') order by c.requested_at asc limit 1 for update;
  if found then
    return jsonb_build_object('cancellation_id', v_cancellation.id, 'provider_payment_id', v_intent.provider_payment_id, 'idempotency_key', v_cancellation.idempotency_key, 'idempotent', true, 'reconciliation_required', true);
  end if;
  insert into public.payment_cancellations (payment_intent_id, idempotency_key, requested_by)
  values (v_intent.id, p_idempotency_key, v_actor) returning * into v_cancellation;
  return jsonb_build_object('cancellation_id', v_cancellation.id, 'provider_payment_id', v_intent.provider_payment_id, 'idempotency_key', v_cancellation.idempotency_key, 'idempotent', false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_payment_refund_v2(p_payment_intent_id uuid, p_amount numeric, p_idempotency_key uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_remaining numeric(12, 2);
  v_amount numeric(12, 2);
  v_refundable_without_order boolean;
  v_local_approved numeric(12, 2);
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reembolso no autorizado' using errcode = '42501';
  end if;
  -- Sin pedido se devuelve sólo dinero que consta: los dos motivos de siempre, o
  -- un cobro que un snapshot válido dejó aprobado por el importe esperado. El
  -- `coalesce` no es decorativo: con un motivo distinto y `provider_status` nulo
  -- la expresión daría NULL, y un NULL acá dejaba pasar la condición de abajo.
  v_refundable_without_order := coalesce(
    v_intent.order_id is null
    and v_intent.internal_status = 'security_review_required'
    and (
      v_intent.security_review_reason in ('approved_after_reservation_expired', 'finalization_without_active_reservation')
      or (v_intent.provider_status = 'approved' and v_intent.paid_amount = v_intent.expected_amount)
    ),
    false
  );
  if v_intent.provider_payment_id is null
    or (
      not v_refundable_without_order
      and (v_intent.order_id is null or v_intent.internal_status not in ('completed', 'partially_refunded'))
    )
    or (v_refundable_without_order is false and v_intent.internal_status not in ('completed', 'partially_refunded')) then
    raise exception 'pago no reembolsable en su estado actual' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.payment_disputes d
     where d.payment_intent_id = v_intent.id
       and d.dispute_type = 'chargeback'
       and d.resolved_at is null
  ) then
    raise exception 'reembolso bloqueado por contracargo abierto' using errcode = '55000';
  end if;
  select * into v_refund
    from public.payment_refunds r
   where r.idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_refund.payment_intent_id <> v_intent.id then
      raise exception 'idempotency key pertenece a otro reembolso' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      -- A caller that sees an existing outbound request must never POST it
      -- again. This is what keeps the deployed legacy handler safe if the
      -- provider answered but its recorder call failed.
      'reconciliation_required', v_refund.status not in ('approved', 'rejected')
        or v_refund.provider_refund_id is not null
    );
  end if;
  v_remaining := coalesce(v_intent.paid_amount, v_intent.expected_amount) - v_intent.refunded_amount;
  -- Never replace an ambiguous outbound financial request with a new UUID.
  select * into v_refund
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id
     and r.status in ('requested', 'processing', 'ambiguous')
   order by r.requested_at asc
   limit 1
   for update;
  if found then
    -- Reintento autorizado por `resolve_stuck_payment_refund`: la MISMA solicitud
    -- con la MISMA clave, una sola vez, y sólo si lo que se pide ahora es ese
    -- mismo importe. La evidencia se vuelve a mirar acá: entre la autorización y
    -- este momento pudo llegar un aviso del proveedor con una devolución de más,
    -- o el cobro pudo pasar a apuntar a otro pago del mismo checkout (ahí el
    -- reenvío saldría contra un pago que no es el de esta solicitud).
    if v_refund.resolution_mode = 'provider_retry'
      and v_refund.provider_refund_id is null
      and v_refund.provider_payment_id = v_intent.provider_payment_id
      and coalesce(p_amount, v_remaining) = v_refund.amount then
      select coalesce(sum(r.amount), 0) into v_local_approved
        from public.payment_refunds r
       where r.payment_intent_id = v_intent.id and r.status = 'approved';
      if v_intent.refunded_amount <= v_local_approved then
        update public.payment_refunds
           set resolution_mode = null,
               provider_attempts = provider_attempts + 1,
               last_provider_attempt_at = clock_timestamp()
         where id = v_refund.id;
        insert into public.payment_events (payment_intent_id, event_type, details)
        values (
          v_intent.id,
          'payment.refund_retry_started',
          jsonb_build_object(
            'refund_id', v_refund.id,
            'actor_user_id', v_actor,
            'provider_attempt', v_refund.provider_attempts + 1
          )
        );
        return jsonb_build_object(
          'refund_id', v_refund.id,
          'provider_payment_id', v_intent.provider_payment_id,
          'amount', v_refund.amount,
          'idempotency_key', v_refund.idempotency_key,
          'full_refund', v_refund.amount = coalesce(v_intent.paid_amount, v_intent.expected_amount),
          'idempotent', false,
          'provider_retry', true
        );
      end if;
    end if;
    return jsonb_build_object(
      'refund_id', v_refund.id,
      'provider_payment_id', v_intent.provider_payment_id,
      'amount', v_refund.amount,
      'idempotency_key', v_refund.idempotency_key,
      'idempotent', true,
      'reconciliation_required', true
    );
  end if;
  v_amount := coalesce(p_amount, v_remaining);
  if v_amount <= 0 or v_amount > v_remaining then
    raise exception 'importe de reembolso invalido' using errcode = '22023';
  end if;
  insert into public.payment_refunds (
    payment_intent_id, order_id, idempotency_key, amount, requested_by, reason,
    provider_payment_id
  ) values (
    v_intent.id, v_intent.order_id, p_idempotency_key, v_amount, v_actor,
    nullif(left(btrim(coalesce(p_reason, '')), 300), ''),
    v_intent.provider_payment_id
  ) returning * into v_refund;
  return jsonb_build_object(
    'refund_id', v_refund.id,
    'provider_payment_id', v_intent.provider_payment_id,
    'amount', v_refund.amount,
    'idempotency_key', v_refund.idempotency_key,
    'full_refund', v_refund.amount = coalesce(v_intent.paid_amount, v_intent.expected_amount),
    'idempotent', false
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_catalog_product_draft(p_draft_id uuid, p_name text, p_category text, p_price numeric, p_package_type text, p_unit_factor integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_draft public.catalog_product_drafts%rowtype;
  v_product public.products%rowtype;
  v_barcode_type text;
begin
  select d.* into v_draft from public.catalog_product_drafts d where d.id = p_draft_id for update;
  if not found then raise exception 'borrador inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_draft.business_id, array['owner', 'admin']) then raise exception 'revision owner/admin requerida' using errcode = '42501'; end if;
  if v_draft.status <> 'pending_review' then raise exception 'borrador ya revisado' using errcode = 'P0001'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 160 or char_length(btrim(coalesce(p_category, ''))) not between 2 and 80 or p_price < 0 or p_unit_factor < 1 then raise exception 'datos de producto invalidos' using errcode = '22023'; end if;
  -- Antes el valor viajaba sin filtrar al insert y el operador recibía el
  -- nombre del constraint de PostgreSQL en vez de un motivo operable.
  if coalesce(p_package_type, '') not in ('unit', 'pack', 'case', 'internal') then
    raise exception 'presentacion invalida (unit, pack, case o internal)' using errcode = '22023';
  end if;
  insert into public.products(business_id, name, category, price, stock, available, is_active, is_verified, catalog_origin)
  values (v_draft.business_id, btrim(p_name), btrim(p_category), p_price, 0, false, false, false, 'commercial')
  returning * into v_product;
  v_barcode_type := case length(v_draft.scanned_gtin) when 8 then 'EAN-8' when 12 then 'UPC-A' when 13 then 'EAN-13' else 'GTIN-14' end;
  insert into public.product_barcodes(business_id, product_id, gtin, barcode_type, package_type, unit_factor, is_primary, source, verified_at, created_by)
  values (v_draft.business_id, v_product.id, v_draft.scanned_gtin, v_barcode_type, p_package_type, p_unit_factor, true, 'manual', now(), auth.uid());
  update public.catalog_product_drafts set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), product_id = v_product.id where id = v_draft.id;
  return jsonb_build_object('draft_id', v_draft.id, 'product_id', v_product.id, 'gtin', v_draft.scanned_gtin, 'published', false, 'requires_catalog_verification', true);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_catalog_product(p_business_id uuid, p_external_id text, p_available boolean DEFAULT false)
 RETURNS TABLE(product_id uuid, published_external_id text, published_sku text, published_is_verified boolean, published_available boolean, published_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_product public.products%rowtype;
  v_asset public.catalog_assets%rowtype;
  v_alcohol_open boolean;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish catalog products.' using errcode = '42501';
  end if;

  select *
    into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id)
   for update;
  if not found then raise exception 'Catalog product not found.'; end if;

  if btrim(coalesce(v_product.variant, '')) = ''
     or v_product.capacity_value is null
     or v_product.capacity_value <= 0
     or v_product.capacity_unit not in ('ml', 'l', 'g', 'kg', 'unidad')
     or v_product.presentation is distinct from v_product.variant
     or v_product.capacity is distinct from (
       v_product.capacity_value::text || ' ' || v_product.capacity_unit
     ) then
    raise exception 'Catalog product has invalid structured presentation or capacity.';
  end if;

  select *
    into v_asset
    from public.catalog_assets ca
   where ca.id = v_product.catalog_asset_id
     and ca.business_id = p_business_id
     and ca.external_id = v_product.external_id
     and ca.sku = v_product.sku;
  if not found
     or v_product.image_url is distinct from v_asset.master_path
     or v_product.image_sha256 is distinct from v_asset.master_sha256
     or v_product.image_thumbnail_url is distinct from v_asset.thumbnail_path
     or v_product.image_thumbnail_sha256 is distinct from v_asset.thumbnail_sha256
     or v_product.source_image_sha256 is distinct from v_asset.source_sha256
     then
    raise exception 'Catalog product asset authority does not match.';
  end if;

  select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
    from public.businesses b where b.id = p_business_id;
  v_alcohol_open := coalesce(v_alcohol_open, false);

  update public.products p
     set is_verified = true,
         verified_at = statement_timestamp(),
         verified_by = auth.uid(),
         -- Verificar no es vender: queda disponible sólo si además se puede vender
         -- (precio confirmado, licencia de alcohol). Sin esas dos condiciones un
         -- precio pendiente daba un 23514 crudo y un alcohólico quedaba ofrecido
         -- con la licencia cerrada.
         available = coalesce(p_available, false) and p.is_active and coalesce(p.stock, 0) > 0
           and p.price_status = 'confirmed' and p.price > 0
           and (not coalesce(p.is_alcoholic, false) or v_alcohol_open),
         -- Pedir que quede disponible ES la intención del comercio, y sacar de la
         -- venta algo que hoy se vende también (si no, la próxima reserva vencida lo
         -- volvía a ofrecer). Sobre un producto que ya no estaba a la venta,
         -- `p_available = false` no toca la intención: esta puerta también se usa para
         -- volver a verificar sin decidir qué se vende.
         merchant_available = case
           when coalesce(p_available, false) then true
           when p.available then false
           else p.merchant_available
         end,
         updated_at = statement_timestamp()
   where p.id = v_product.id
  returning
    p.id,
    p.external_id,
    p.sku,
    p.is_verified,
    p.available,
    p.verified_at
  into
    product_id,
    published_external_id,
    published_sku,
    published_is_verified,
    published_available,
    published_at;
  perform private.catalog_change_record_single('verification', v_product,
    jsonb_build_object('external_id', btrim(p_external_id), 'available', coalesce(p_available, false)));
  return next;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.purge_payment_request_traces(p_keep_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_keep_days integer := greatest(2, least(coalesce(p_keep_days, 30), 365));
  v_buckets integer := 0;
  v_receipts integer := 0;
  v_receipts_skipped boolean := false;
begin
  delete from public.payment_rate_limit_buckets b
   where b.bucket_started_at < clock_timestamp() - interval '1 day';
  get diagnostics v_buckets = row_count;

  -- Los recibos están detrás del candado de entrega (`a1_a4_financial_interlock_v5`):
  -- con una entrega en pausa, cualquier escritura sobre la tabla se rechaza con
  -- TABA_RELEASE_QUIESCED, aunque no borre ninguna fila. Esa pausa es deliberada y
  -- dura poco: la poda de ese día se saltea y no deja la tarea en falla. Los cupos
  -- de arriba no están detrás del candado y se podan igual.
  begin
    delete from public.payment_webhook_receipts r
     where r.processing_status = 'rejected_signature'
       and r.signature_valid is false
       and r.received_at < clock_timestamp() - make_interval(days => v_keep_days)
       and not exists (select 1 from public.payment_outbox o where o.webhook_receipt_id = r.id)
       and not exists (select 1 from public.payment_events e where e.webhook_receipt_id = r.id);
    get diagnostics v_receipts = row_count;
  exception
    when sqlstate '55000' then
      if sqlerrm <> 'TABA_RELEASE_QUIESCED' then
        raise;
      end if;
      v_receipts_skipped := true;
  end;

  return jsonb_build_object(
    'rate_limit_buckets', v_buckets,
    'rejected_receipts', v_receipts,
    'rejected_receipts_skipped', v_receipts_skipped,
    'kept_days', v_keep_days
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_mercadopago_dispute_snapshot(p_payment_intent_id uuid, p_dispute_type text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_intent public.payment_intents%rowtype; v_type text := lower(btrim(coalesce(p_dispute_type, '')));
declare v_dispute public.payment_disputes%rowtype;
begin
  if v_type not in ('chargeback', 'claim') or p_snapshot is null
    or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$'
    or nullif(btrim(coalesce(p_snapshot ->> 'provider_dispute_id', '')), '') is null then
    raise exception 'snapshot de disputa invalido' using errcode = '22023';
  end if;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found or p_snapshot ->> 'provider_payment_id' is distinct from v_intent.provider_payment_id then
    raise exception 'disputa no coincide con el pago' using errcode = '22023';
  end if;
  insert into public.payment_disputes (
    payment_intent_id, provider_dispute_id, dispute_type, status, coverage_eligible,
    documentation_required, documentation_status, due_at, raw_response_hash, opened_at, resolved_at
  ) values (
    v_intent.id, left(btrim(p_snapshot ->> 'provider_dispute_id'), 200), v_type,
    left(lower(coalesce(p_snapshot ->> 'status', 'open')), 120),
    coalesce((p_snapshot ->> 'coverage_eligible')::boolean, false),
    coalesce((p_snapshot ->> 'documentation_required')::boolean, false),
    nullif(left(btrim(coalesce(p_snapshot ->> 'documentation_status', '')), 120), ''),
    nullif(p_snapshot ->> 'due_at', '')::timestamptz,
    p_snapshot ->> 'raw_response_hash', nullif(p_snapshot ->> 'opened_at', '')::timestamptz,
    nullif(p_snapshot ->> 'resolved_at', '')::timestamptz
  ) on conflict (provider_dispute_id, dispute_type) do update
    set status = excluded.status, coverage_eligible = excluded.coverage_eligible,
      documentation_required = excluded.documentation_required, documentation_status = excluded.documentation_status,
      due_at = excluded.due_at, raw_response_hash = excluded.raw_response_hash,
      opened_at = coalesce(public.payment_disputes.opened_at, excluded.opened_at), resolved_at = excluded.resolved_at
  returning * into v_dispute;
  if v_type = 'chargeback' and v_dispute.resolved_at is null then
    update public.payment_intents set internal_status = 'charged_back' where id = v_intent.id;
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
  values (v_intent.id, 'payment.' || v_type, jsonb_build_object('dispute_id', v_dispute.id, 'status', v_dispute.status), p_snapshot ->> 'raw_response_hash');
  return jsonb_build_object('ok', true, 'dispute_id', v_dispute.id);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_mercadopago_payment_snapshot(p_payment_intent_id uuid, p_snapshot jsonb, p_source text, p_webhook_receipt_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_intent public.payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_settings public.business_payment_settings%rowtype;
  v_session_id uuid;
  v_status text;
  v_next text;
  v_effective text;
  v_amount numeric(12,2);
  v_refunded numeric(12,2);
  v_currency text;
  v_provider_time timestamptz;
  v_valid boolean := true;
  v_reason text;
  v_finalize boolean := false;
  v_payment_id text;
  v_hash text;
  v_other_payment boolean := false;
  v_pinned boolean := false;
  v_takeover boolean := false;
  v_replay boolean := false;
  v_receipt_types text[] := '{}'::text[];
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'object'
    or coalesce(p_snapshot ->> 'raw_response_hash', '') !~ '^[a-f0-9]{64}$' then
    raise exception 'snapshot de pago invalido' using errcode = '22023';
  end if;
  -- Sesion primero, intent despues: el mismo orden que finalize, recover, prepare
  -- y el barrido. El id de la sesion se lee sin lock porque un intent no cambia
  -- de checkout; si alguna vez cambiara entre las dos lecturas, se rechaza.
  select pi.checkout_session_id into v_session_id from public.payment_intents pi where pi.id = p_payment_intent_id;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  select * into v_session from public.checkout_sessions s where s.id = v_session_id for update;
  select * into v_intent from public.payment_intents pi where pi.id = p_payment_intent_id for update;
  if not found then raise exception 'payment intent inexistente' using errcode = 'P0002'; end if;
  if v_intent.checkout_session_id is distinct from v_session.id then
    raise exception 'el payment intent cambio de checkout durante el snapshot' using errcode = 'PT409';
  end if;
  select * into v_settings from public.business_payment_settings ps where ps.business_id = v_intent.business_id and ps.provider = 'mercadopago' for share;
  -- Tipos de evento que este recibo ya dejo en este intent. La clave unica es
  -- (intent, recibo, tipo): el recibo se ata al primer evento de cada tipo y lo
  -- que el mismo recibo traiga despues se escribe sin recibo. Con DO NOTHING a
  -- secas ese segundo evento se perdia, y sin su fila el mismo snapshot no se
  -- reconocia como ya registrado en el reintento siguiente.
  if p_webhook_receipt_id is not null then
    select coalesce(array_agg(pe.event_type), '{}'::text[]) into v_receipt_types
      from public.payment_events pe
     where pe.payment_intent_id = v_intent.id and pe.webhook_receipt_id = p_webhook_receipt_id;
  end if;
  v_status := lower(btrim(coalesce(p_snapshot ->> 'status', '')));
  v_currency := upper(btrim(coalesce(p_snapshot ->> 'currency', '')));
  v_amount := nullif(p_snapshot ->> 'transaction_amount', '')::numeric(12,2);
  v_refunded := coalesce(nullif(p_snapshot ->> 'refunded_amount', '')::numeric(12,2), 0);
  v_payment_id := p_snapshot ->> 'provider_payment_id';
  v_hash := p_snapshot ->> 'raw_response_hash';
  begin
    v_provider_time := coalesce(nullif(p_snapshot ->> 'provider_occurred_at', '')::timestamptz, clock_timestamp());
  exception when others then
    v_provider_time := clock_timestamp();
  end;
  if nullif(btrim(coalesce(p_snapshot ->> 'provider_payment_id', '')), '') is null then
    v_valid := false; v_reason := 'payment_id_missing';
  elsif p_snapshot ->> 'external_reference' is distinct from v_intent.external_reference then
    v_valid := false; v_reason := 'external_reference_mismatch';
  -- La preferencia de un intento anterior de ESTE intent tambien es nuestra: la
  -- creo el backend para este mismo checkout y este mismo importe. Sin esto, el
  -- pago rechazado del primer intento -que el proveedor sigue devolviendo-
  -- mandaba a revision el reintento que el cliente acababa de pedir.
  elsif nullif(btrim(coalesce(v_intent.preference_id, '')), '') is not null
    and nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '') is distinct from v_intent.preference_id
    and not exists (
      select 1 from public.payment_attempts pa
       where pa.payment_intent_id = v_intent.id
         and pa.attempt_type = 'preference'
         and pa.preference_id = nullif(btrim(coalesce(p_snapshot ->> 'preference_id', '')), '')
    ) then
    v_valid := false; v_reason := 'preference_mismatch';
  elsif v_settings.collector_id is null or p_snapshot ->> 'collector_id' is distinct from v_settings.collector_id then
    v_valid := false; v_reason := 'collector_mismatch';
  -- Mercado Pago exposes no application_id on payments or merchant orders, so
  -- the assertion runs only when the provider actually supplies one. collector_id
  -- stays mandatory and is what pins a payment to the configured account.
  elsif nullif(btrim(coalesce(p_snapshot ->> 'application_id', '')), '') is not null
    and p_snapshot ->> 'application_id' is distinct from coalesce(v_settings.application_id, '') then
    v_valid := false; v_reason := 'application_mismatch';
  elsif v_currency <> 'ARS' or v_currency <> v_intent.currency then
    v_valid := false; v_reason := 'currency_mismatch';
  elsif v_amount is null or v_amount <> v_intent.expected_amount then
    v_valid := false; v_reason := 'amount_mismatch';
  -- Checkout Pro test credentials are a Mercado Pago sandbox test user whose
  -- payments report live_mode = true, so equality with the environment can only
  -- be demanded in production. In test the collector_id assertion above already
  -- pins the payment to the sandbox user, which cannot move real money.
  elsif v_intent.environment = 'production'
    and coalesce((p_snapshot ->> 'live_mode')::boolean, false) is not true then
    v_valid := false; v_reason := 'live_mode_mismatch';
  elsif v_status not in ('approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled', 'canceled', 'expired', 'refunded', 'charged_back') then
    v_valid := false; v_reason := 'unknown_provider_status';
  end if;
  if not v_valid then
    -- `completed` es terminal. Con el pedido ya creado, un snapshot que no pasa la
    -- validacion no puede reabrir nada: bajaria el pago del pedido a «pendiente» y
    -- cerraria el reembolso y la cancelacion justo cuando hacen falta. Queda el
    -- evento, que es la senal para operaciones.
    if v_session.status = 'completed' or v_session.completed_order_id is not null or v_intent.order_id is not null then
      insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
      select v_intent.id, case when 'payment.post_completion_anomaly' = any(v_receipt_types) then null else p_webhook_receipt_id end,
        nullif(btrim(coalesce(v_payment_id, '')), ''), 'payment.post_completion_anomaly', v_status,
        nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, v_hash,
        jsonb_build_object('reason', v_reason, 'source', p_source, 'operational_review_required', true)
       where not exists (
         select 1 from public.payment_events pe
          where pe.payment_intent_id = v_intent.id
            and pe.event_type = 'payment.post_completion_anomaly'
            and pe.raw_response_hash = v_hash
            and pe.details ->> 'reason' = v_reason
       )
      on conflict (payment_intent_id, webhook_receipt_id, event_type) do nothing;
      return jsonb_build_object('ok', false, 'manual_review_required', false, 'reason', v_reason, 'finalize_required', false,
        'post_completion', true, 'operational_review_required', true);
    end if;
    update public.payment_intents set internal_status = 'security_review_required', security_review_reason = v_reason,
      raw_response_hash = p_snapshot ->> 'raw_response_hash' where id = v_intent.id;
    update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = v_reason where id = v_session.id and status <> 'completed';
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, p_webhook_receipt_id, 'payment.security_review_required', v_status,
      nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('reason', v_reason, 'source', p_source))
    on conflict (payment_intent_id, webhook_receipt_id, event_type) do nothing;
    return jsonb_build_object('ok', false, 'manual_review_required', true, 'reason', v_reason, 'finalize_required', false);
  end if;
  v_next := case v_status
    when 'approved' then case when v_refunded >= v_amount then 'refunded' when v_refunded > 0 then 'partially_refunded' else 'approved_order_pending' end
    when 'pending' then 'pending'
    when 'in_process' then 'in_process'
    when 'authorized' then 'in_process'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    when 'canceled' then 'cancelled'
    when 'expired' then 'expired'
    when 'refunded' then 'refunded'
    when 'charged_back' then 'charged_back'
    else 'ambiguous'
  end;
  -- Identidad del pago. El intent guarda UN pago del proveedor.
  --   v_other_payment  el snapshot habla de un pago distinto del guardado
  --   v_pinned         el intent ya tiene un pago aprobado: su identidad no se pisa
  --   v_replay         este mismo pago, estado y respuesta ya quedaron registrados
  -- El pago guardado tiene que ser el que cobro (`approved`, o lo que le sigue:
  -- `refunded`, `charged_back`). Una fila anterior a esta migracion puede haber
  -- quedado apuntando a un rechazado posterior; esa no se fija, y el proximo
  -- snapshot del pago real vuelve a tomar la identidad como siempre.
  v_other_payment := v_intent.provider_payment_id is not null and v_intent.provider_payment_id <> v_payment_id;
  v_pinned := coalesce(
    (v_intent.approved_at is not null
      or v_intent.internal_status in ('approved', 'approved_order_pending', 'completed', 'partially_refunded', 'refunded', 'charged_back'))
    and v_intent.provider_status in ('approved', 'refunded', 'charged_back'),
    false);
  v_replay := exists (
    select 1 from public.payment_events pe
     where pe.payment_intent_id = v_intent.id
       and pe.provider_event_id = v_payment_id
       and pe.provider_status = v_status
       and pe.raw_response_hash = v_hash
       and pe.event_type in ('payment.' || v_status, 'payment.duplicate_approved', 'payment.secondary_payment')
  );
  if v_other_payment and v_pinned then
    -- Otro pago sobre un intent que ya cobro. Si esta aprobado es un cobro
    -- duplicado: el dinero entro dos veces y alguien tiene que devolverlo. No se
    -- fusiona ni se pisa nada; el pago original sigue siendo el del pedido.
    if not v_replay then
      insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
      values (v_intent.id,
        case when (case when v_status = 'approved' then 'payment.duplicate_approved' else 'payment.secondary_payment' end) = any(v_receipt_types)
          then null else p_webhook_receipt_id end,
        v_payment_id,
        case when v_status = 'approved' then 'payment.duplicate_approved' else 'payment.secondary_payment' end,
        v_status, nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, v_hash,
        -- Lo que falta devolver es lo que hay que revisar: un duplicado que ya
        -- llega devuelto entero queda en la traza sin pedir otra devolucion.
        jsonb_build_object('source', p_source, 'pinned_provider_payment_id', v_intent.provider_payment_id,
          'amount', v_amount, 'refunded_amount', v_refunded,
          'refund_review_required', v_status = 'approved' and v_refunded < v_amount))
      on conflict (payment_intent_id, webhook_receipt_id, event_type) do nothing;
    end if;
    return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'internal_status', v_intent.internal_status,
      'manual_review_required', false, 'finalize_required', false,
      'secondary_payment', true, 'duplicate_approved', v_status = 'approved',
      'refund_review_required', v_status = 'approved' and v_refunded < v_amount);
  end if;
  -- Sin pago aprobado todavia, el primer `approved` se queda con la identidad
  -- aunque su fecha sea anterior a la del pago guardado (un rechazado o un
  -- pendiente mas nuevo no puede dejar el estado del proveedor en otra cosa).
  v_takeover := v_other_payment and v_status = 'approved';
  v_effective := case
    when v_replay then v_intent.internal_status
    when public.payment_internal_status_rank(v_next) >= public.payment_internal_status_rank(v_intent.internal_status) then v_next
    else v_intent.internal_status end;
  if not v_replay then
    update public.payment_intents set
      provider_payment_id = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then p_snapshot ->> 'provider_payment_id' else provider_payment_id end,
      provider_merchant_order_id = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'merchant_order_id', '') else provider_merchant_order_id end,
      provider_status = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then v_status else provider_status end,
      provider_status_detail = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'status_detail', '') else provider_status_detail end,
      provider_payment_method = case when v_takeover or provider_event_at is null or v_provider_time >= provider_event_at then nullif(p_snapshot ->> 'payment_method', '') else provider_payment_method end,
      provider_event_at = case when v_takeover then v_provider_time else greatest(coalesce(provider_event_at, '-infinity'::timestamptz), v_provider_time) end,
      paid_amount = case when v_status = 'approved' then v_amount else paid_amount end,
      payer_email_hash = nullif(p_snapshot ->> 'payer_email_hash', ''), live_mode = (p_snapshot ->> 'live_mode')::boolean,
      approved_at = case when v_status = 'approved' then coalesce(approved_at, v_provider_time) else approved_at end,
      rejected_at = case when v_status in ('rejected', 'cancelled', 'canceled', 'expired') then coalesce(rejected_at, v_provider_time) else rejected_at end,
      refunded_amount = greatest(refunded_amount, v_refunded), internal_status = v_effective,
      raw_response_hash = p_snapshot ->> 'raw_response_hash'
    where id = v_intent.id;
    insert into public.payment_events (payment_intent_id, webhook_receipt_id, provider_event_id, event_type, provider_status, provider_status_detail, provider_occurred_at, raw_response_hash, details)
    values (v_intent.id, case when ('payment.' || v_status) = any(v_receipt_types) then null else p_webhook_receipt_id end,
      p_snapshot ->> 'provider_payment_id', 'payment.' || v_status,
      v_status, nullif(p_snapshot ->> 'status_detail', ''), v_provider_time, p_snapshot ->> 'raw_response_hash', jsonb_build_object('source', p_source))
    on conflict (payment_intent_id, webhook_receipt_id, event_type) do nothing;
  end if;
  if v_status = 'approved' and v_effective = 'approved_order_pending' then
    if v_session.expires_at <= clock_timestamp() or not exists (
      select 1 from public.inventory_reservations r where r.checkout_session_id = v_session.id and r.status = 'active' and r.expires_at > clock_timestamp()
    ) then
      update public.payment_intents set internal_status = 'security_review_required', security_review_reason = 'approved_after_reservation_expired' where id = v_intent.id;
      update public.checkout_sessions set status = 'manual_review_required', manual_review_reason = 'approved_after_reservation_expired' where id = v_session.id and status <> 'completed';
      insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash)
      values (v_intent.id, 'payment.manual_review_required', jsonb_build_object('reason', 'approved_after_reservation_expired'), p_snapshot ->> 'raw_response_hash');
      return jsonb_build_object('ok', true, 'manual_review_required', true, 'finalize_required', false);
    end if;
    update public.checkout_sessions set status = 'payment_approved' where id = v_session.id and status <> 'payment_approved';
    v_finalize := true;
  elsif v_status in ('pending', 'in_process', 'authorized') then
    update public.checkout_sessions set status = 'payment_pending' where id = v_session.id and status in ('ready_for_payment', 'redirected');
  elsif v_status = 'expired' then
    perform public.release_checkout_session_inventory(v_session.id, 'provider_expired', 'expired');
  elsif v_status in ('rejected', 'cancelled', 'canceled') and p_source = 'cancellation' then
    -- Solo nuestra propia cancelacion libera. Un rechazo del proveedor deja la
    -- reserva: el comprador sigue en Checkout Pro y puede pagar con otro medio en
    -- la misma preferencia. El stock vuelve cuando vence la sesion.
    perform public.release_checkout_session_inventory(v_session.id, 'provider_' || v_status, 'cancelled');
  end if;
  -- El proveedor informa devuelto TODO el dinero de este cobro (reembolso hecho en
  -- Mercado Pago, o contracargo) y no hay pedido: las unidades que la sesión retiene
  -- ya no pueden terminar en un pedido —la finalización y el rearmado se niegan
  -- sobre dinero devuelto— y nadie del comercio las puede soltar. Una sesión pagada
  -- que no llegó a finalizarse pasa primero a revisión: es el estado en el que la
  -- liberación actúa, y el que impide pedir otra preferencia sobre ese checkout.
  -- La liberación es la del reembolso propio: decide sola si corresponde (sin
  -- pedido, en revisión, dinero afuera) y no libera dos veces. Un pago que el
  -- proveedor cerró sin haberlo aprobado nunca no entra acá: de ese no volvió
  -- ningún importe, y lo sigue atendiendo soporte.
  if v_next in ('refunded', 'charged_back')
    and v_intent.order_id is null and v_session.completed_order_id is null
    and v_session.status in ('manual_review_required', 'payment_approved', 'finalizing_order') then
    update public.checkout_sessions
       set status = 'manual_review_required', manual_review_reason = 'money_returned_before_order'
     where id = v_session.id and status in ('payment_approved', 'finalizing_order');
    perform public.release_manual_review_checkout_inventory(v_intent.id, 'provider_' || v_next || '_without_order', false);
  end if;
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'internal_status', v_effective,
    'manual_review_required', false, 'finalize_required', v_finalize);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_mercadopago_preference_created_v2(p_business_id uuid, p_environment text, p_checkout_session_id uuid, p_customer_id uuid, p_payment_attempt_id uuid, p_expected_authority text, p_preference_id text, p_init_point text, p_sandbox_init_point text, p_response_hash text, p_provider_request_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
 v_snapshot jsonb; v_intent public.payment_intents%rowtype; v_attempt public.payment_attempts%rowtype;
begin
 if p_preference_id is null or length(p_preference_id) not between 1 and 200
   or p_init_point is null or length(p_init_point) not between 1 and 2048
   or p_init_point !~ '^https://(www[.])?mercadopago[.]com[.]ar/'
   or p_response_hash is null or p_response_hash !~ '^[a-f0-9]{64}$'
   or p_expected_authority is null or p_expected_authority !~ '^[a-f0-9]{64}$' then
   raise exception 'respuesta de preferencia invalida' using errcode='22023';
 end if;
 perform 1 from public.checkout_sessions where id=p_checkout_session_id and customer_id=p_customer_id for update;
 if not found then raise exception 'checkout no autorizado' using errcode='42501'; end if;
 select * into v_intent from public.payment_intents where checkout_session_id=p_checkout_session_id for update;
 select * into v_attempt from public.payment_attempts where id=p_payment_attempt_id for update;
 -- Freeze the non-written authority rows while crossing the intentional
 -- persistence transition. Keep seller before settings: mp_finish_oauth and
 -- mp_disconnect acquire those rows in that order too, avoiding inversion.
 perform 1 from public.businesses where id=p_business_id for share;
 perform 1 from public.mp_seller_connections where business_id=p_business_id and environment=p_environment for share;
 perform 1 from public.business_payment_settings where business_id=p_business_id and provider='mercadopago' for share;
 v_snapshot := public.get_mercadopago_payment_authority_v2(
   p_business_id,p_environment,p_checkout_session_id,p_customer_id,p_payment_attempt_id);
 if v_snapshot is null or v_snapshot->>'authority_version' is distinct from p_expected_authority
   or v_attempt.status not in ('prepared','request_sent','ambiguous','created')
   or v_intent.internal_status not in ('created','preference_creating','preference_created','redirected','ambiguous')
   or v_snapshot#>>'{checkout,status}' not in ('ready_for_payment','redirected','payment_pending')
   or (v_snapshot#>>'{checkout,expires_at}')::timestamptz <= clock_timestamp()
   or v_snapshot#>>'{checkout,reservation_valid}' is distinct from 'true'
   or v_snapshot#>>'{checkout,business_open}' is distinct from 'true'
   or v_snapshot#>>'{settings,enabled}' is distinct from 'true'
   or v_snapshot#>>'{seller,status}' is distinct from 'connected'
   or (v_attempt.preference_id is not null and
     (v_attempt.preference_id is distinct from p_preference_id or v_attempt.init_point is distinct from p_init_point)) then
   raise exception 'autoridad del intento cambio' using errcode='55000';
 end if;
 update public.payment_attempts set preference_id=p_preference_id,init_point=p_init_point,
   sandbox_init_point=p_sandbox_init_point,response_hash=p_response_hash,provider_request_id=p_provider_request_id,
   seller_generation=(v_snapshot#>>'{seller,generation}')::uuid,seller_id=v_snapshot#>>'{seller,seller_id}',status='created'
 where id=p_payment_attempt_id;
 update public.payment_intents set preference_id=p_preference_id,current_payment_attempt_id=p_payment_attempt_id,
   preference_created_at=coalesce(preference_created_at,clock_timestamp()),raw_response_hash=p_response_hash,
   internal_status=case when internal_status in ('created','ambiguous','preference_creating') then 'preference_created' else internal_status end
 where id=v_intent.id;
 update public.checkout_sessions set status=case when status='ready_for_payment' then 'redirected' else status end
 where id=p_checkout_session_id;
 return public.get_mercadopago_payment_authority_v2(
   p_business_id,p_environment,p_checkout_session_id,p_customer_id,p_payment_attempt_id);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_mercadopago_preference_failed(p_payment_attempt_id uuid, p_response_hash text, p_error_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

begin
  if p_response_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  update public.payment_attempts set status = 'failed', response_hash = p_response_hash,
    last_error_code = left(coalesce(p_error_code, 'provider_error'), 120) where id = p_payment_attempt_id;
  if not found then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  return true;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_mercadopago_preference_uncertain(p_payment_attempt_id uuid, p_request_hash text, p_error_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_intent_id uuid;
begin
  if p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'hash invalido' using errcode = '22023'; end if;
  -- Mismo orden de candados que el resto de la preferencia (sesión → cobro → intento,
  -- prepare/record_mercadopago_preference_*_v2): primero el cobro, después el intento.
  -- Antes actualizaba el intento y después el cobro, y con la llegada fijada se trababa
  -- (40P01) contra volver a pedir o asentar la preferencia (20261002061000).
  select pa.payment_intent_id into v_intent_id
    from public.payment_attempts pa where pa.id = p_payment_attempt_id;
  if v_intent_id is null then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  perform 1 from public.payment_intents where id = v_intent_id for no key update;
  update public.payment_attempts set status = 'ambiguous', request_hash = p_request_hash,
    last_error_code = left(coalesce(p_error_code, 'network_or_timeout'), 120)
   where id = p_payment_attempt_id and payment_intent_id = v_intent_id;
  if not found then raise exception 'attempt inexistente' using errcode = 'P0002'; end if;
  update public.payment_intents set internal_status = case when internal_status = 'preference_creating' then 'ambiguous' else internal_status end where id = v_intent_id;
  return true;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_mercadopago_webhook_receipt(p_environment text, p_webhook_event_id text, p_event_type text, p_resource_id text, p_signature_valid boolean, p_request_id text, p_payload_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

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
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_packing_scan(p_session_id uuid, p_gtin text, p_scan_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_session public.order_packing_sessions%rowtype;
  v_barcode public.product_barcodes%rowtype;
  v_item public.order_items%rowtype;
  v_existing public.order_packing_scans%rowtype;
  v_scanned integer;
  v_complete boolean;
begin
  if btrim(coalesce(p_scan_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'scan_key invalida' using errcode='22023';
  end if;
  select s.* into v_session
  from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;

  select b.* into v_barcode
  from public.product_barcodes b
  where b.business_id=v_session.business_id and b.gtin=p_gtin and b.is_active;
  if not found then raise exception 'producto desconocido' using errcode='P0002'; end if;

  select s.* into v_existing
  from public.order_packing_scans s
  where s.session_id=v_session.id and s.scan_key=p_scan_key;
  if found then
    if v_existing.barcode_id<>v_barcode.id then
      raise exception 'scan_key reutilizada con otro codigo' using errcode='23505';
    end if;
    return jsonb_build_object(
      'ok',v_existing.reverted_at is null,
      'idempotent_replay',true,
      'reverted',v_existing.reverted_at is not null,
      'scan_key',v_existing.scan_key,
      'product_id',v_existing.product_id,
      'unit_factor',v_existing.unit_factor
    );
  end if;

  if v_session.status not in ('in_progress','complete') then
    raise exception 'sesion cerrada' using errcode='P0001';
  end if;
  select oi.* into v_item
  from public.order_items oi
  where oi.order_id=v_session.order_id and oi.product_uuid=v_barcode.product_id
  order by oi.id limit 1;
  if not found then raise exception 'producto equivocado' using errcode='23514'; end if;
  select coalesce(sum(s.unit_factor),0)::integer into v_scanned
  from public.order_packing_scans s
  where s.session_id=v_session.id and s.order_item_id=v_item.id and s.reverted_at is null;
  if v_scanned+v_barcode.unit_factor>v_item.quantity then
    raise exception 'cantidad excedida' using errcode='23514';
  end if;

  insert into public.order_packing_scans(
    session_id,order_item_id,product_id,barcode_id,unit_factor,operator_id,scan_key
  ) values (
    v_session.id,v_item.id,v_barcode.product_id,v_barcode.id,v_barcode.unit_factor,auth.uid(),p_scan_key
  );
  select not exists(
    select 1 from public.order_items oi
    where oi.order_id=v_session.order_id
      and coalesce((select sum(ps.unit_factor) from public.order_packing_scans ps where ps.session_id=v_session.id and ps.order_item_id=oi.id and ps.reverted_at is null),0)<>oi.quantity
  ) into v_complete;
  update public.order_packing_sessions
  set status=case when v_complete then 'complete' else 'in_progress' end,updated_at=now()
  where id=v_session.id;
  return jsonb_build_object(
    'ok',true,'complete',v_complete,'idempotent_replay',false,
    'scan_key',p_scan_key,'product_id',v_barcode.product_id,'unit_factor',v_barcode.unit_factor
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_payment_cancellation_response(p_cancellation_id uuid, p_status text, p_response_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_cancellation public.payment_cancellations%rowtype; v_intent public.payment_intents%rowtype;
  v_intent_id uuid; v_session_id uuid;
begin
  -- Sin estado no hay respuesta que asentar. Antes lo frenaba el NOT NULL de la
  -- columna; con el retorno idempotente de abajo un NULL habría pasado por confirmado.
  if p_status is null or p_status not in ('cancelled', 'rejected', 'ambiguous', 'failed') or p_response_hash !~ '^[a-f0-9]{64}$' then raise exception 'respuesta de cancelacion invalida' using errcode = '22023'; end if;
  -- Candados en el orden de todo lo que toca un cobro: sesión -> cobro -> solicitud.
  -- Antes eran solicitud -> cobro -> sesión, y esta llamada cruzada con el asiento de un
  -- pago (sesión -> cobro) o con un segundo pedido de cancelación (cobro -> solicitud)
  -- terminaba en deadlock. Los dos ids se leen sin candado, que es lo que permite tomar
  -- primero la sesión; después se comprueba, con las filas ya tomadas, que siguen siendo
  -- los de esta solicitud.
  select c.payment_intent_id into v_intent_id from public.payment_cancellations c where c.id = p_cancellation_id;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  select pi.checkout_session_id into v_session_id from public.payment_intents pi where pi.id = v_intent_id;
  perform 1 from public.checkout_sessions s where s.id = v_session_id for update;
  select * into v_intent from public.payment_intents pi where pi.id = v_intent_id for update;
  select * into v_cancellation from public.payment_cancellations c where c.id = p_cancellation_id for update;
  if not found then raise exception 'cancelacion inexistente' using errcode = 'P0002'; end if;
  if v_cancellation.payment_intent_id is distinct from v_intent_id
    or v_intent.checkout_session_id is distinct from v_session_id then
    raise exception 'la cancelacion cambio de cobro o de checkout mientras se asentaba' using errcode = 'PT409';
  end if;
  if v_cancellation.status in ('cancelled', 'rejected') then
    if v_cancellation.status <> p_status then
      raise exception 'resultado de cancelacion ya confirmado' using errcode = '55000';
    end if;
    return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'idempotent', true);
  end if;
  if v_cancellation.status = p_status and v_cancellation.raw_response_hash = p_response_hash then
    return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'idempotent', true);
  end if;
  update public.payment_cancellations set status = p_status, raw_response_hash = p_response_hash,
    completed_at = case when p_status in ('cancelled', 'rejected') then clock_timestamp() else completed_at end where id = v_cancellation.id;
  if p_status = 'cancelled' then
    update public.payment_intents set internal_status = case when public.payment_internal_status_rank(internal_status) < public.payment_internal_status_rank('cancelled') then 'cancelled' else internal_status end where id = v_intent.id;
    perform public.release_checkout_session_inventory(v_intent.checkout_session_id, 'owner_cancelled_payment', 'cancelled');
  end if;
  insert into public.payment_events (payment_intent_id, event_type, details, raw_response_hash) values (v_intent.id, 'payment.cancellation_' || p_status, jsonb_build_object('cancellation_id', v_cancellation.id), p_response_hash);
  return jsonb_build_object('ok', true, 'payment_intent_id', v_intent.id, 'idempotent', false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_payment_refund_identity(p_refund_id uuid, p_payment_intent_id uuid, p_provider_payment_id text, p_idempotency_key uuid, p_provider_refund_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_refund public.payment_refunds%rowtype; v_intent public.payment_intents%rowtype;
begin
  if p_provider_refund_id is null or p_provider_refund_id !~ '^[1-9][0-9]{0,31}$' then
    raise exception 'identidad de reembolso invalida' using errcode='22023';
  end if;
  -- Same lock order as prepare_payment_refund: intent, then refund.
  select * into v_intent from public.payment_intents where id=p_payment_intent_id for update;
  if not found or v_intent.provider_payment_id is distinct from p_provider_payment_id then
    raise exception 'pago del reembolso no coincide' using errcode='22023';
  end if;
  select * into v_refund from public.payment_refunds where id=p_refund_id for update;
  if not found or v_refund.payment_intent_id is distinct from p_payment_intent_id
    or v_refund.idempotency_key is distinct from p_idempotency_key then
    raise exception 'solicitud de reembolso no coincide' using errcode='22023';
  end if;
  if v_refund.provider_refund_id is not null then
    if v_refund.provider_refund_id<>p_provider_refund_id then
      raise exception 'identidad de reembolso no coincide' using errcode='23505';
    end if;
    return true;
  end if;
  if v_refund.status not in ('requested','processing','ambiguous') then
    raise exception 'reembolso ya resuelto' using errcode='55000';
  end if;
  update public.payment_refunds set provider_refund_id=p_provider_refund_id where id=p_refund_id;
  return true;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_payment_refund_response_v2(p_refund_id uuid, p_provider_refund_id text, p_status text, p_amount numeric, p_response_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_refund public.payment_refunds%rowtype;
  v_intent public.payment_intents%rowtype;
  v_intent_id uuid;
  v_total numeric(12,2);
  v_next text;
  v_provider_id text := nullif(btrim(coalesce(p_provider_refund_id,'')),'');
begin
  if p_response_hash is null or p_response_hash !~ '^[a-f0-9]{64}$'
    or p_status is null or p_status not in ('approved','rejected','ambiguous','failed')
    or p_amount is null or p_amount<=0 then
    raise exception 'respuesta de reembolso invalida' using errcode='22023';
  end if;
  select payment_intent_id into v_intent_id from public.payment_refunds where id=p_refund_id;
  if not found then raise exception 'reembolso inexistente' using errcode='P0002'; end if;
  select * into v_intent from public.payment_intents where id=v_intent_id for update;
  select * into v_refund from public.payment_refunds where id=p_refund_id for update;
  if not found or v_refund.payment_intent_id is distinct from v_intent_id then
    raise exception 'solicitud de reembolso cambio' using errcode='22023';
  end if;
  if p_amount is distinct from v_refund.amount then
    raise exception 'importe de reembolso no coincide' using errcode='22023';
  end if;
  if v_provider_id is distinct from v_refund.provider_refund_id
    or (p_status='approved' and v_provider_id is null) then
    raise exception 'identidad de reembolso no confirmada' using errcode='23505';
  end if;
  if v_refund.status in ('approved','rejected') then
    if v_refund.status<>p_status then
      raise exception 'resultado de reembolso ya confirmado' using errcode='55000';
    end if;
    return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',true);
  end if;
  if v_refund.status=p_status and v_refund.raw_response_hash=p_response_hash then
    return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',true);
  end if;
  update public.payment_refunds set status=p_status, raw_response_hash=p_response_hash,
    completed_at=case when p_status in ('approved','rejected') then clock_timestamp() else completed_at end
    where id=p_refund_id;
  if p_status='approved' then
    select coalesce(sum(amount),0) into v_total from public.payment_refunds
      where payment_intent_id=v_intent_id and status='approved';
    -- Lo que el proveedor ya informó (devoluciones hechas en Mercado Pago, o el
    -- aviso de este mismo reembolso que llegó antes que su respuesta) no se pisa
    -- con la suma local, que puede ser menor.
    v_total := greatest(v_total, v_intent.refunded_amount);
    if v_intent.internal_status='security_review_required' then
      update public.payment_intents set refunded_amount=v_total where id=v_intent_id;
    else
      -- El estado sólo avanza: un cobro que el proveedor ya dio por devuelto o
      -- contracargado no retrocede por asentar un reembolso propio.
      v_next := case when v_total>=coalesce(v_intent.paid_amount,v_intent.expected_amount) then 'refunded' else 'partially_refunded' end;
      update public.payment_intents set refunded_amount=v_total,
        internal_status=case
          when public.payment_internal_status_rank(v_next)>public.payment_internal_status_rank(internal_status) then v_next
          else internal_status end
        where id=v_intent_id;
    end if;
    -- Dinero devuelto por completo y ningún pedido: las unidades que esa sesión
    -- retenía en revisión vuelven al producto. La función decide sola si aplica
    -- (sesión en revisión, sin pedido) y no libera dos veces.
    if v_intent.order_id is null
      and v_total>=coalesce(v_intent.paid_amount,v_intent.expected_amount) then
      perform public.release_manual_review_checkout_inventory(v_intent_id,'refund_approved_without_order',false);
    end if;
  end if;
  insert into public.payment_events(payment_intent_id,event_type,details,raw_response_hash)
    values(v_intent_id,'payment.refund_'||p_status,jsonb_build_object('refund_id',p_refund_id,'amount',p_amount),p_response_hash);
  return jsonb_build_object('ok',true,'payment_intent_id',v_intent_id,'idempotent',false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_provider_probe_empty(p_payment_intent_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_attempt_generation uuid;
  v_probe_generation uuid;
  v_probe_status text;
begin
  -- Con qué conexión del vendedor se creó la preferencia (el intento la guarda), y
  -- cuál es la vigente: el worker buscó el pago con el token de la vigente segundos
  -- antes de llamar acá. Un «vacío» sólo prueba que no hubo pago si se buscó con la
  -- MISMA conexión que creó la preferencia (o en modo directo, sin conexión de
  -- vendedor: generación nula). Empezar a reconectar rota la generación
  -- (mp_begin_oauth) y desconectar también; refrescar el token no la cambia.
  select pa.seller_generation
    into v_attempt_generation
    from public.payment_intents pi
    left join public.payment_attempts pa on pa.id = pi.current_payment_attempt_id
   where pi.id = p_payment_intent_id;

  select c.generation, c.status
    into v_probe_generation, v_probe_status
    from public.payment_intents pi
    join public.mp_seller_connections c
      on c.business_id = pi.business_id
     and c.environment = pi.environment
   where pi.id = p_payment_intent_id;

  insert into public.payment_events (payment_intent_id, event_type, details)
  values (
    p_payment_intent_id,
    'payment.provider_probe_empty',
    jsonb_build_object(
      'source', 'provider_truth_sweep',
      'attempt_seller_generation', v_attempt_generation,
      'probe_seller_generation', v_probe_generation,
      'probe_connection_status', v_probe_status,
      'conclusive', v_attempt_generation is null
        or (v_probe_generation is not distinct from v_attempt_generation and v_probe_status = 'connected')
    )
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recover_order_tracking_access(p_order_id uuid, p_new_tracking_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_handoff public.order_delivery_handoffs%rowtype;
  v_random bytea;
  v_code text;
  v_token_expires_at timestamptz;
  v_code_expires_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if p_order_id is null
    or p_new_tracking_token is null
    or p_new_tracking_token !~ '^[A-Za-z0-9_-]{32,255}[A-Za-z0-9_-]?$' then
    raise exception 'credenciales de seguimiento invalidas' using errcode = '22023';
  end if;

  select o.*
    into v_order
    from public.orders o
   where o.id = p_order_id
     and o.customer_user_id = auth.uid()
     and o.delivery_mode = 'delivery'
     and o.status not in ('delivered', 'canceled', 'cancelled', 'rejected')
   for update;

  if not found then
    raise exception 'pedido no encontrado o acceso denegado' using errcode = '42501';
  end if;

  select h.*
    into v_handoff
    from public.order_delivery_handoffs h
   where h.order_id = v_order.id
   for update;

  if found and v_handoff.confirmed_at is not null then
    raise exception 'entrega ya confirmada' using errcode = '55000';
  end if;

  v_token_expires_at := clock_timestamp() + interval '30 days';
  v_code_expires_at := clock_timestamp() + interval '48 hours';

  v_random := gen_random_bytes(3);
  v_code := (
    1000 + (
      get_byte(v_random, 0)::bigint * 65536
      + get_byte(v_random, 1)::bigint * 256
      + get_byte(v_random, 2)::bigint
    ) % 9000
  )::text;

  update public.order_public_tokens
     set revoked_at = coalesce(revoked_at, clock_timestamp())
   where order_id = v_order.id
     and revoked_at is null;

  insert into public.order_public_tokens (
    order_id,
    token_hash,
    expires_at
  ) values (
    v_order.id,
    digest(p_new_tracking_token, 'sha256'),
    v_token_expires_at
  );

  -- A rotated digest has no operational value. Remove prior revoked digests for
  -- this order so repeated recovery does not create indefinite bearer history.
  delete from public.order_public_tokens
   where order_id = v_order.id
     and revoked_at is not null;

  insert into public.order_delivery_handoffs (
    order_id,
    code_hash,
    code_ciphertext,
    failed_attempts,
    locked_until,
    confirmed_at,
    confirmed_by_user_id,
    expires_at
  ) values (
    v_order.id,
    crypt(v_code, gen_salt('bf', 10)),
    pgp_sym_encrypt(v_code, p_new_tracking_token, 'cipher-algo=aes256,compress-algo=0'),
    0,
    null,
    null,
    null,
    least(v_token_expires_at, v_code_expires_at)
  )
  on conflict (order_id) do update
     set code_hash = excluded.code_hash,
         code_ciphertext = excluded.code_ciphertext,
         failed_attempts = 0,
         locked_until = null,
         confirmed_at = null,
         confirmed_by_user_id = null,
         expires_at = excluded.expires_at;

  -- ── EL ARREGLO DE 2026-08-22 ─────────────────────────────────────────────
  -- Este UPDATE era incondicional, y ahí estaba el defecto. `delivery_code_required`
  -- ya vale `true` en todo pedido con entrega desde que se creó, así que escribirlo
  -- de nuevo no cambiaba nada... salvo que `orders_set_updated_at` mueve `updated_at`
  -- en cada UPDATE, con lo cual `orders_zz_bump_revision` veía la fila distinta y
  -- subía `orders.revision`.
  --
  -- Consecuencia medida en LT-0002: la oferta al repartidor se emitió esperando la
  -- revisión 7; el cliente abrió su pantalla de seguimiento; esta función corrió;
  -- la revisión pasó a 8; y desde entonces el botón «Aceptar» del teléfono llamaba
  -- al servidor y volvía rechazado —«La solicitud cambió»— para siempre, porque la
  -- revisión no vuelve atrás. Un cliente mirando dónde viene su pedido dejaba al
  -- repartidor sin poder aceptarlo.
  --
  -- La condición no debilita nada: la garantía sigue siendo la misma —al salir de
  -- acá el pedido exige código de entrega— y sólo se escribe cuando hace falta
  -- escribir. La concurrencia optimista queda intacta: un cambio REAL del pedido
  -- sigue subiendo la revisión e invalidando ofertas viejas, que es para lo que
  -- está.
  update public.orders
     set delivery_code_required = true
   where id = v_order.id
     and delivery_code_required is distinct from true;

  insert into public.order_events (
    order_id,
    business_id,
    actor_user_id,
    actor_role,
    actor_type,
    actor_id,
    event_type,
    type,
    message,
    metadata,
    payload
  ) values (
    v_order.id,
    v_order.business_id,
    auth.uid(),
    'customer',
    'customer',
    auth.uid(),
    'order.tracking_access_recovered',
    'order.tracking_access_recovered',
    'Acceso de seguimiento recuperado por el cliente',
    jsonb_build_object('rotated_at', clock_timestamp()),
    jsonb_build_object('rotated_at', clock_timestamp())
  );

  return jsonb_build_object(
    'ok', true,
    'public_code', v_order.public_code,
    'delivery_code', v_code,
    'token_expires_at', v_token_expires_at,
    'code_expires_at', least(v_token_expires_at, v_code_expires_at)
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.recover_paid_checkout_order(p_checkout_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_actor uuid := auth.uid();
  v_session public.checkout_sessions%rowtype;
  v_intent public.payment_intents%rowtype;
  v_item record;
  v_product public.products%rowtype;
  v_generation integer;
  v_expires timestamptz;
  v_faltantes jsonb := '[]'::jsonb;
  v_resultado jsonb;
  v_rereservados integer := 0;
begin
  select * into v_session
    from public.checkout_sessions s
   where s.id = p_checkout_session_id
   for update;
  if not found then
    raise exception 'checkout inexistente' using errcode = 'P0002';
  end if;
  if v_actor is null
    or not public.has_business_role(v_session.business_id, array['owner', 'admin']) then
    raise exception 'recuperacion no autorizada' using errcode = '42501';
  end if;

  -- Tocar dos veces no puede crear dos pedidos.
  if v_session.completed_order_id is not null then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'order_id', v_session.completed_order_id
    );
  end if;

  select * into v_intent
    from public.payment_intents pi
   where pi.checkout_session_id = v_session.id
   for update;
  if not found
    or v_intent.provider_status <> 'approved'
    or v_intent.paid_amount is distinct from v_session.total
    or v_intent.currency <> 'ARS' then
    raise exception 'este checkout no tiene un cobro aprobado y verificado' using errcode = '55000';
  end if;
  if v_intent.order_id is not null then
    return jsonb_build_object('ok', true, 'idempotent', true, 'order_id', v_intent.order_id);
  end if;
  if v_intent.internal_status in ('refunded', 'partially_refunded', 'charged_back') then
    raise exception 'el dinero de este cobro ya se movio' using errcode = '55000';
  end if;
  -- El reembolso de un cobro en revisión no cambia `internal_status`: hay que
  -- mirar el importe y las solicitudes. Todos los que escriben `payment_refunds`
  -- toman antes el candado del cobro que esta función ya tiene, así que la
  -- consulta no corre contra un reembolso que se está creando.
  if coalesce(v_intent.refunded_amount, 0) > 0 or exists (
    select 1 from public.payment_refunds r
     where r.payment_intent_id = v_intent.id and r.status = 'approved'
  ) then
    raise exception 'este cobro ya tiene dinero devuelto' using
      errcode = '55000', detail = 'PAYMENT_REFUND_RECORDED';
  end if;
  if exists (
    select 1 from public.payment_refunds r
     where r.payment_intent_id = v_intent.id
       and r.status in ('requested', 'processing', 'ambiguous')
  ) then
    raise exception 'este cobro tiene un reembolso en curso' using
      errcode = '55000', detail = 'PAYMENT_REFUND_IN_FLIGHT';
  end if;

  -- Si la reserva sigue viva no hace falta nada de esto: el camino normal
  -- alcanza y es el que tiene que correr.
  if exists (
    select 1 from public.inventory_reservations r
     where r.checkout_session_id = v_session.id
       and r.status = 'active'
       and r.expires_at > clock_timestamp()
  ) then
    update public.payment_intents
       set internal_status = 'approved_order_pending', security_review_reason = null
     where id = v_intent.id
       and internal_status = 'security_review_required';
    update public.checkout_sessions
       set status = 'payment_approved', manual_review_reason = null
     where id = v_session.id;
    return public.finalize_paid_checkout_session(v_session.id) || jsonb_build_object('reused_reservation', true);
  end if;

  -- Se mira TODO el pedido antes de descontar nada: media recuperación deja el
  -- stock movido y el pedido igual de inexistente.
  -- Una reserva `active` de esta sesión es stock que ya se descontó para ella,
  -- aunque esté vencida: mientras nadie la libere, esas unidades no volvieron al
  -- producto. Sólo se pide al stock lo que no tiene reserva activa (`pendientes`).
  for v_item in
    select i.product_id, i.quantity, i.product_snapshot,
           greatest(i.quantity - coalesce((
             select sum(r.quantity)
               from public.inventory_reservations r
              where r.checkout_session_id = v_session.id
                and r.product_id = i.product_id
                and r.status = 'active'
           ), 0), 0)::integer as pendientes
      from public.checkout_session_items i
     where i.checkout_session_id = v_session.id
     order by i.product_id
  loop
    select * into v_product
      from public.products p
     where p.id = v_item.product_id
     for update;
    if v_item.pendientes > 0 and (
      not found or not v_product.is_active or v_product.stock is null
      or v_product.stock < v_item.pendientes
    ) then
      v_faltantes := v_faltantes || jsonb_build_object(
        'product_id', v_item.product_id,
        'name', coalesce(v_item.product_snapshot ->> 'name', 'Producto'),
        'necesarias', v_item.pendientes,
        'disponibles', coalesce(v_product.stock, 0)
      );
    end if;
  end loop;

  if jsonb_array_length(v_faltantes) > 0 then
    return jsonb_build_object(
      'ok', false,
      'reason', 'stock_insuficiente',
      'missing', v_faltantes,
      'action', 'devolver_el_dinero_desde_el_panel'
    );
  end if;

  v_expires := clock_timestamp() + interval '10 minutes';
  select coalesce(max(r.reservation_generation), 0) + 1
    into v_generation
    from public.inventory_reservations r
   where r.checkout_session_id = v_session.id;

  for v_item in
    select i.product_id,
           greatest(i.quantity - coalesce((
             select sum(r.quantity)
               from public.inventory_reservations r
              where r.checkout_session_id = v_session.id
                and r.product_id = i.product_id
                and r.status = 'active'
           ), 0), 0)::integer as pendientes
      from public.checkout_session_items i
     where i.checkout_session_id = v_session.id
     order by i.product_id
  loop
    continue when v_item.pendientes = 0;
    update public.products p
       set stock = p.stock - v_item.pendientes,
           available = case when p.stock - v_item.pendientes > 0 then p.available else false end
     where p.id = v_item.product_id;
    insert into public.inventory_reservations (
      checkout_session_id, product_id, quantity, expires_at, reservation_generation
    ) values (
      v_session.id, v_item.product_id, v_item.pendientes, v_expires, v_generation
    );
    v_rereservados := v_rereservados + 1;
  end loop;

  -- `finalize_paid_checkout_session` exige sesión y reserva sin vencer: lo que
  -- ya estaba retenido se extiende en lugar de volver a descontarse.
  update public.inventory_reservations r
     set expires_at = v_expires
   where r.checkout_session_id = v_session.id
     and r.status = 'active'
     and r.expires_at < v_expires;

  update public.checkout_sessions
     set expires_at = v_expires,
         status = 'payment_approved',
         manual_review_reason = null
   where id = v_session.id;
  update public.payment_intents
     set internal_status = 'approved_order_pending',
         security_review_reason = null
   where id = v_intent.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (
    v_intent.id,
    'payment.order_recovered_by_operator',
    jsonb_build_object(
      'actor_user_id', v_actor,
      'reservation_generation', case when v_rereservados > 0 then v_generation else v_generation - 1 end,
      'reused_reservation', v_rereservados = 0
    )
  );

  v_resultado := public.finalize_paid_checkout_session(v_session.id);
  return v_resultado || jsonb_build_object(
    'recovered', true,
    'reservation_generation', case when v_rereservados > 0 then v_generation else v_generation - 1 end,
    'reused_reservation', v_rereservados = 0
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_catalog_image_upload(p_upload_id uuid, p_actor_user_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_upload public.catalog_image_uploads%rowtype;
begin
  select * into v_upload from public.catalog_image_uploads where id = p_upload_id for update;
  if not found
     or not public.catalog_image_upload_actor_allowed(v_upload.business_id, v_upload.product_id, p_actor_user_id) then
    raise exception 'catalog image upload not found' using errcode = 'no_data_found';
  end if;
  if v_upload.status <> 'pending' or btrim(coalesce(p_reason, '')) = '' or length(p_reason) > 300 then
    raise exception 'catalog image rejection is invalid' using errcode = 'check_violation';
  end if;

  update public.catalog_image_uploads
     set status = 'rejected',
         reviewed_at = statement_timestamp(),
         reviewed_by = p_actor_user_id,
         rejection_reason = btrim(p_reason),
         cleanup_status = 'pending',
         updated_at = statement_timestamp()
   where id = p_upload_id;

  return jsonb_build_object(
    'upload_id', p_upload_id,
    'business_id', v_upload.business_id,
    'product_id', v_upload.product_id,
    'source_path', v_upload.staging_source_path,
    'master_path', v_upload.staging_master_path,
    'thumbnail_path', v_upload.staging_thumbnail_path
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reject_rider_order_offer(p_offer_id uuid, p_expected_version bigint, p_reason_code text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_offer public.rider_order_offers%rowtype;
  v_order_id uuid;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_reason text := nullif(lower(btrim(coalesce(p_reason_code, ''))), '');
  v_result jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_offer_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception 'reject invalido' using errcode = '22023';
  end if;
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if v_reason is not null
    and v_reason not in ('too_far', 'vehicle_problem', 'load_too_big', 'ending_shift', 'other') then
    raise exception 'motivo de rechazo invalido' using errcode = '22023';
  end if;

  -- Mismo orden de candados que ofrecer el pedido (offer_order_to_rider: pedido → oferta) y que aceptar la
  -- oferta (20261002043000): primero el pedido, después la oferta. Antes tomaba la oferta y, al escribir el
  -- evento, el pedido: con la llegada fijada se trababa (40P01) contra ofrecer el pedido a otro repartidor
  -- (20261002062000).
  select f.order_id into v_order_id from public.rider_order_offers f where f.id = p_offer_id;
  if v_order_id is null then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  perform 1 from public.orders where id = v_order_id for no key update;
  select f.* into v_offer from public.rider_order_offers f where f.id = p_offer_id for update;
  if not found or v_offer.rider_user_id <> auth.uid() then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  if v_offer.order_id is distinct from v_order_id then
    raise exception 'la oferta cambio de pedido' using errcode = 'PT409';
  end if;

  perform public.rider_require_active_membership(v_offer.business_id);

  select result into v_result
    from public.rider_delivery_operations
   where order_id = v_offer.order_id and rider_user_id = auth.uid()
     and operation = 'reject_offer' and idempotency_key = v_key
   for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;

  if v_offer.status = 'rejected' then
    return jsonb_build_object('ok', true, 'code', 'already_rejected', 'idempotent_no_op', true);
  end if;
  if v_offer.status = 'accepted' then
    return jsonb_build_object('ok', false, 'code', 'already_accepted');
  end if;
  if v_offer.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'offer_not_available', 'offer_status', v_offer.status);
  end if;
  if v_offer.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'stale_version', 'version', v_offer.version);
  end if;

  update public.rider_order_offers
     set status = 'rejected', responded_at = v_now, response_reason = v_reason, version = version + 1
   where id = v_offer.id and status = 'pending'
  returning * into v_offer;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'offer_not_available');
  end if;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_offer.order_id, v_offer.business_id, auth.uid(), 'rider', 'rider', auth.uid(),
    'order.rider_rejected_offer', 'order.rider_rejected_offer', 'El rider rechazo la entrega',
    jsonb_build_object('offer_id', v_offer.id, 'reason_code', v_reason),
    jsonb_build_object('offer_id', v_offer.id, 'reason_code', v_reason)
  );

  v_result := jsonb_build_object('ok', true, 'code', 'rejected', 'idempotent_no_op', false);

  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (
    v_offer.order_id, auth.uid(), 'reject_offer', v_key,
    digest(jsonb_build_object('offer_id', v_offer.id, 'version', p_expected_version)::text, 'sha256'),
    v_result
  );

  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.release_manual_review_checkout_inventory(p_payment_intent_id uuid, p_reason text DEFAULT 'money_returned_without_order'::text, p_money_verified_out boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_intent public.payment_intents%rowtype;
  v_session public.checkout_sessions%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_released integer := 0;
begin
  -- El candado es el del COBRO, no el de la sesión. Quien llama desde el asiento
  -- de un reembolso ya lo tiene; tomar además el de la sesión invertiría el orden
  -- de `recover_paid_checkout_order` y `finalize_paid_checkout_session`
  -- (sesión -> cobro) y un rearmado simultáneo terminaría en deadlock. Alcanza:
  -- los únicos que tocan las reservas de una sesión en revisión son esas dos
  -- funciones y el asiento de un snapshot, y las tres toman este candado antes.
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found then
    raise exception 'payment intent inexistente' using errcode = 'P0002';
  end if;
  select * into v_session
    from public.checkout_sessions s
   where s.id = v_intent.checkout_session_id;

  if v_intent.order_id is not null or v_session.completed_order_id is not null then
    return jsonb_build_object('released', 0, 'skipped', true, 'reason', 'order_exists');
  end if;
  if v_session.status <> 'manual_review_required' then
    return jsonb_build_object('released', 0, 'skipped', true, 'reason', 'not_in_manual_review',
      'status', v_session.status);
  end if;
  if not private.checkout_payment_money_is_out(v_intent) then
    -- Lo que la base no puede saber sola: un cobro que nunca pudo validarse
    -- (importe o cuenta que no coinciden) y que alguien devolvió desde Mercado
    -- Pago. Soporte lo atestigua, pero sólo si acá no figura un cobro aprobado
    -- (ese se reembolsa desde el Panel y se libera solo) y la reserva ya venció.
    if not coalesce(p_money_verified_out, false)
      or v_intent.provider_status is not distinct from 'approved'
      or v_session.expires_at > clock_timestamp() then
      return jsonb_build_object('released', 0, 'skipped', true, 'reason', 'money_not_returned');
    end if;
  end if;

  -- Mismo orden de candados por producto que el resto del inventario.
  perform 1
    from public.products p
    join public.inventory_reservations r on r.product_id = p.id
   where r.checkout_session_id = v_session.id and r.status = 'active'
   order by p.id
   for update of p;
  for v_reservation in
    select * from public.inventory_reservations r
     where r.checkout_session_id = v_session.id and r.status = 'active'
     order by r.product_id, r.reservation_generation
     for update
  loop
    update public.products p
       set stock = p.stock + v_reservation.quantity,
           available = p.merchant_available
                       and p.is_active
                       and p.is_verified
                       and (p.stock + v_reservation.quantity) > 0
                       and p.price_status = 'confirmed'
                       and p.price > 0
     where p.id = v_reservation.product_id;
    update public.inventory_reservations
       set status = 'released', released_at = clock_timestamp(),
           release_reason = left(coalesce(nullif(btrim(p_reason), ''), 'money_returned_without_order'), 120)
     where id = v_reservation.id and status = 'active';
    v_released := v_released + 1;
  end loop;

  if v_released > 0 then
    insert into public.payment_events (payment_intent_id, event_type, details)
    values (
      v_intent.id,
      'payment.manual_review_stock_released',
      jsonb_build_object(
        'released', v_released,
        'reason', left(coalesce(nullif(btrim(p_reason), ''), 'money_returned_without_order'), 120),
        'attested_by_support', not private.checkout_payment_money_is_out(v_intent)
      )
    );
  end if;
  -- La sesión queda en `manual_review_required`: es lo que impide pedir otra
  -- preferencia de pago sobre un checkout cuyo dinero ya se devolvió.
  return jsonb_build_object('released', v_released, 'skipped', false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_stuck_payment_refund(p_payment_intent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  -- La llamada al proveedor se corta a los 12 s. Cinco minutos después ya no
  -- puede haber una respuesta en camino ni un asiento a medio hacer.
  c_settle constant interval := interval '5 minutes';
  v_actor uuid := auth.uid();
  v_intent public.payment_intents%rowtype;
  v_refund public.payment_refunds%rowtype;
  v_target text;
  v_last_attempt timestamptz;
  v_checked_at timestamptz;
  v_local_approved numeric(12, 2);
  v_unmatched numeric(12, 2);
  v_queued boolean := false;
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  -- Mismo orden de candados que el resto del reembolso: cobro, después solicitud.
  select * into v_intent
    from public.payment_intents pi
   where pi.id = p_payment_intent_id
   for update;
  if not found or not public.has_business_role(v_intent.business_id, array['owner', 'admin']) then
    raise exception 'reembolso no autorizado' using errcode = '42501';
  end if;
  select * into v_refund
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id
     and r.status in ('requested', 'processing', 'ambiguous')
   order by r.requested_at asc
   limit 1
   for update;
  if not found then
    return jsonb_build_object('ok', true, 'action', 'none', 'reason', 'no_refund_in_flight');
  end if;

  -- Con identidad no hay nada que adivinar: se consulta ese reembolso. La cola lo
  -- abandona a los 8 intentos; esto la vuelve a poner en marcha.
  if v_refund.provider_refund_id is not null then
    if not exists (
      select 1 from public.payment_outbox o
       where o.refund_id = v_refund.id and o.topic = 'refund_reconcile'
         and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
    ) then
      insert into public.payment_outbox (payment_intent_id, refund_id, topic, resource_id, last_error)
      values (v_intent.id, v_refund.id, 'refund_reconcile', null, 'operator_requested_reconcile');
      v_queued := true;
    end if;
    update public.payment_refunds
       set resolution_requested_at = clock_timestamp(), resolution_requested_by = v_actor
     where id = v_refund.id;
    return jsonb_build_object(
      'ok', true, 'refund_id', v_refund.id,
      'action', case when v_queued then 'reconcile_enqueued' else 'reconcile_already_queued' end
    );
  end if;

  -- El pago del proveedor contra el que salió ESTA solicitud. Un cobro puede
  -- conocer varios pagos del mismo checkout: la lectura de otro no dice nada de
  -- este reembolso, y si el cobro pasó a apuntar a otro, reenviar sería pedirle
  -- la devolución a un pago que no es. Una solicitud anterior a la columna no lo
  -- tiene anotado: se deduce (y se anota) sólo si el cobro conoció un único pago;
  -- `provider_event_id` lo escribe únicamente el asiento de un snapshot válido.
  v_target := v_refund.provider_payment_id;
  if v_target is null and v_intent.provider_payment_id is not null and not exists (
    select 1 from public.payment_events e
     where e.payment_intent_id = v_intent.id
       and e.provider_event_id is not null
       and e.provider_event_id <> v_intent.provider_payment_id
  ) then
    v_target := v_intent.provider_payment_id;
    update public.payment_refunds set provider_payment_id = v_target where id = v_refund.id;
  end if;
  if v_target is null or v_target is distinct from v_intent.provider_payment_id then
    return jsonb_build_object(
      'ok', false, 'refund_id', v_refund.id,
      'reason', case when v_target is null then 'provider_payment_unknown' else 'provider_payment_changed' end,
      'action', 'resolver_en_mercado_pago_con_soporte'
    );
  end if;

  if v_refund.resolution_mode = 'provider_retry' then
    return jsonb_build_object(
      'ok', true, 'idempotent', true, 'action', 'retry_authorized',
      'refund_id', v_refund.id, 'amount', v_refund.amount
    );
  end if;

  v_last_attempt := coalesce(v_refund.last_provider_attempt_at, v_refund.requested_at);
  if clock_timestamp() < v_last_attempt + c_settle then
    return jsonb_build_object(
      'ok', false, 'reason', 'refund_request_in_flight', 'refund_id', v_refund.id,
      'retry_after_seconds', ceil(extract(epoch from (v_last_attempt + c_settle - clock_timestamp())))::integer
    );
  end if;

  -- Evidencia: la última vez que se LEYÓ ese pago en el proveedor y el resultado
  -- pasó todas las verificaciones (la única fila de `payment_events` con ese
  -- nombre, ese estado y el identificador del pago). Tiene que ser posterior al
  -- envío más su plazo. La lectura de otro pago del mismo checkout no cuenta.
  select max(e.server_recorded_at) into v_checked_at
    from public.payment_events e
   where e.payment_intent_id = v_intent.id
     and e.provider_event_id = v_target
     and e.provider_status is not null
     and e.event_type = 'payment.' || e.provider_status;
  if v_checked_at is null or v_checked_at < v_last_attempt + c_settle then
    if not exists (
      select 1 from public.payment_outbox o
       where o.payment_intent_id = v_intent.id and o.topic = 'payment_reconcile'
         and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
    ) then
      begin
        insert into public.payment_outbox (payment_intent_id, topic, resource_id)
        values (v_intent.id, 'payment_reconcile', v_target);
      exception when unique_violation then
        null;  -- otra lectura del mismo pago se encoló recién
      end;
    end if;
    update public.payment_refunds
       set resolution_requested_at = clock_timestamp(), resolution_requested_by = v_actor
     where id = v_refund.id;
    return jsonb_build_object(
      'ok', false, 'reason', 'provider_check_pending',
      'action', 'provider_check_enqueued', 'refund_id', v_refund.id
    );
  end if;

  select coalesce(sum(r.amount), 0) into v_local_approved
    from public.payment_refunds r
   where r.payment_intent_id = v_intent.id and r.status = 'approved';
  v_unmatched := v_intent.refunded_amount - v_local_approved;

  if v_unmatched > 0 then
    if v_unmatched <> v_refund.amount then
      -- Hay devoluciones en el proveedor que no son (sólo) ésta. Reintentar o
      -- adoptar una identidad sería adivinar con dinero.
      return jsonb_build_object(
        'ok', false, 'reason', 'provider_refunds_do_not_match', 'refund_id', v_refund.id,
        'unmatched_amount', v_unmatched, 'refund_amount', v_refund.amount,
        'action', 'resolver_en_mercado_pago_con_soporte'
      );
    end if;
    -- El proveedor muestra exactamente este importe sin dueño: lo más probable es
    -- que el envío sí se ejecutó y se perdió la respuesta. No se reenvía. Queda
    -- pedida, por una persona, la búsqueda de su identidad.
    if not exists (
      select 1 from public.payment_outbox o
       where o.refund_id = v_refund.id and o.topic = 'refund_reconcile'
         and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
    ) then
      insert into public.payment_outbox (payment_intent_id, refund_id, topic, resource_id, last_error)
      values (v_intent.id, v_refund.id, 'refund_reconcile', null, 'operator_requested_identity_lookup');
    end if;
    update public.payment_refunds
       set resolution_mode = 'provider_lookup',
           resolution_requested_at = clock_timestamp(), resolution_requested_by = v_actor
     where id = v_refund.id;
    -- Insistir mientras la búsqueda sigue pendiente no deja un evento por toque.
    if v_refund.resolution_mode is distinct from 'provider_lookup' then
      insert into public.payment_events (payment_intent_id, event_type, details)
      values (v_intent.id, 'payment.refund_identity_lookup_requested',
        jsonb_build_object('refund_id', v_refund.id, 'actor_user_id', v_actor, 'amount', v_refund.amount));
    end if;
    return jsonb_build_object(
      'ok', false, 'reason', 'provider_reports_unmatched_refund',
      'action', 'identity_lookup_enqueued', 'refund_id', v_refund.id,
      'idempotent', v_refund.resolution_mode is not distinct from 'provider_lookup'
    );
  end if;

  update public.payment_refunds
     set resolution_mode = 'provider_retry',
         resolution_requested_at = clock_timestamp(), resolution_requested_by = v_actor
   where id = v_refund.id;
  insert into public.payment_events (payment_intent_id, event_type, details)
  values (v_intent.id, 'payment.refund_retry_authorized',
    jsonb_build_object('refund_id', v_refund.id, 'actor_user_id', v_actor, 'amount', v_refund.amount,
      'provider_checked_at', v_checked_at));
  return jsonb_build_object(
    'ok', true, 'action', 'retry_authorized',
    'refund_id', v_refund.id, 'amount', v_refund.amount
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_manual_order_payment(p_order_id uuid, p_expected_revision bigint, p_reason text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
  v_reason text := btrim(coalesce(p_reason,''));
  v_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then raise exception 'Autenticación requerida' using errcode = '42501'; end if;
  if p_order_id is null or p_expected_revision is null or p_expected_revision < 1
     or char_length(v_reason) not between 8 and 200
     or btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'Comando de devolución inválido' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner','admin']) then
    raise exception 'Sólo dueño o administrador puede registrar una devolución manual'
      using errcode = '42501';
  end if;
  v_hash := public.business_command_request_hash('reverse_manual_order_payment',p_order_id,
    jsonb_build_object('expected_revision',p_expected_revision,'reason',v_reason));
  select * into v_receipt from public.business_command_receipts
   where business_id = v_order.business_id and idempotency_key = p_idempotency_key;
  if found then
    if v_receipt.request_hash <> v_hash then
      raise exception 'Clave de idempotencia reutilizada con otro comando' using errcode = '23505';
    end if;
    return v_receipt.result || jsonb_build_object('idempotent_replay',true,
      'manual_payment_status',v_order.manual_payment_status,'revision',v_order.revision);
  end if;
  if v_order.payment_method not in ('cash','coordinate') then
    raise exception 'El pedido no tiene cobro manual' using errcode = '22023';
  end if;
  if v_order.manual_payment_status = 'reversed' then
    return jsonb_build_object('ok',true,'code','already_reversed','idempotent_no_op',true,
      'manual_payment_status','reversed','revision',v_order.revision);
  end if;
  if v_order.manual_payment_status is distinct from 'confirmed' then
    raise exception 'No existe un cobro manual confirmado para devolver' using errcode = '55000';
  end if;
  if v_order.revision <> p_expected_revision then
    raise exception 'Revisión de pedido obsoleta' using errcode = 'PT409';
  end if;
  update public.orders set manual_payment_status = 'reversed',
    manual_payment_reversed_at = v_now, manual_payment_reversed_by = auth.uid(),
    manual_payment_reversal_reason = v_reason
   where id = p_order_id returning * into v_order;
  insert into public.order_events(order_id,business_id,actor_user_id,actor_role,
    event_type,type,message,metadata)
  values(p_order_id,v_order.business_id,auth.uid(),'business','order.manual_payment_reversed',
    'order.manual_payment_reversed','Devolución manual registrada por el negocio',
    jsonb_build_object('actual_method',v_order.manual_payment_method,'amount',v_order.total));
  v_result := jsonb_build_object('ok',true,'code','reversed','manual_payment_status','reversed',
    'revision',v_order.revision,'amount',v_order.total);
  insert into public.business_command_receipts(business_id,order_id,actor_user_id,
    command_type,idempotency_key,request_hash,result)
  values(v_order.business_id,p_order_id,auth.uid(),'reverse_manual_order_payment',
    p_idempotency_key,v_hash,v_result);
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revert_packing_scan(p_session_id uuid, p_scan_key text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_session public.order_packing_sessions%rowtype;
  v_scan public.order_packing_scans%rowtype;
  v_receipt public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then
    raise exception 'idempotency_key invalida' using errcode='22023';
  end if;
  select s.* into v_session from public.order_packing_sessions s where s.id=p_session_id for update;
  if not found then raise exception 'sesion inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_session.business_id,array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode='42501';
  end if;
  v_hash:=public.business_command_request_hash(
    'revert_packing_scan',v_session.order_id,
    jsonb_build_object('session_id',p_session_id,'scan_key',p_scan_key)
  );
  select r.* into v_receipt from public.business_command_receipts r
  where r.business_id=v_session.business_id and r.idempotency_key=p_idempotency_key;
  if found then
    if v_receipt.request_hash<>v_hash then
      raise exception 'idempotency_key reutilizada con otro payload' using errcode='23505';
    end if;
    return v_receipt.result||jsonb_build_object('idempotent_replay',true);
  end if;
  if v_session.status not in ('in_progress','complete') then
    raise exception 'sesion cerrada' using errcode='P0001';
  end if;
  select s.* into v_scan from public.order_packing_scans s
  where s.session_id=p_session_id and s.scan_key=p_scan_key for update;
  if not found then raise exception 'lectura inexistente' using errcode='P0002'; end if;
  update public.order_packing_scans set reverted_at=coalesce(reverted_at,now()) where id=v_scan.id;
  update public.order_packing_sessions set status='in_progress',updated_at=now() where id=p_session_id;
  v_result:=jsonb_build_object('ok',true,'scan_key',p_scan_key,'reverted',true);
  insert into public.business_command_receipts(
    business_id,order_id,actor_user_id,command_type,idempotency_key,request_hash,result
  ) values (
    v_session.business_id,v_session.order_id,auth.uid(),'revert_packing_scan',p_idempotency_key,v_hash,v_result
  );
  return v_result||jsonb_build_object('idempotent_replay',false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revive_payment_outbox_job(p_job_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_actor uuid := auth.uid();
  v_reason text := btrim(regexp_replace(coalesce(p_reason, ''), '[[:space:]]+', ' ', 'g'));
  v_job public.payment_outbox%rowtype;
  v_job_found boolean;
  v_receipt public.payment_webhook_receipts%rowtype;
  v_business_id uuid;
  v_intent_id uuid;
  v_intent_business uuid;
  v_other_job uuid;
  v_revival_id uuid;
begin
  if v_actor is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 3 and 200 then
    raise exception 'motivo requerido (3 a 200 caracteres)' using errcode = '22023';
  end if;
  -- El motivo queda escrito para siempre. Lo que se parece a un correo o a un
  -- teléfono no entra: es rastro de la operación, no del cliente.
  if v_reason ~ '@' or v_reason ~ '[0-9]{7,}' then
    raise exception 'el motivo no puede llevar datos de contacto' using errcode = '22023';
  end if;

  select * into v_job from public.payment_outbox o where o.id = p_job_id for update;
  v_job_found := found;
  if v_job_found then
    if v_job.payment_intent_id is not null then
      select pi.id, pi.business_id into v_intent_id, v_business_id
        from public.payment_intents pi
       where pi.id = v_job.payment_intent_id;
    elsif v_job.webhook_receipt_id is not null then
      -- El trabajo de un aviso nace sin cobro. El comercio es el que confirmó la
      -- lectura del pago al recibirlo; con credencial directa ese dato no existe y
      -- se usa el del cobro que tiene guardado ese pago, si hay uno.
      select * into v_receipt
        from public.payment_webhook_receipts r
       where r.id = v_job.webhook_receipt_id;
      if v_job.topic = 'payment' and v_job.resource_id is not null then
        select pi.id, pi.business_id into v_intent_id, v_intent_business
          from public.payment_intents pi
         where pi.provider = 'mercadopago'
           and pi.environment = v_receipt.environment
           and pi.provider_payment_id = v_job.resource_id;
      end if;
      v_business_id := coalesce(v_receipt.seller_business_id, v_intent_business);
      if v_intent_business is distinct from v_business_id then
        v_intent_id := null;
      end if;
    end if;
  end if;
  -- Una sola respuesta para «no existe», «no se sabe de quién es» y «no es tuyo».
  if not v_job_found or v_business_id is null
    or not public.has_business_role(v_business_id, array['owner', 'admin']) then
    raise exception 'reanimacion no autorizada' using errcode = '42501';
  end if;

  -- Sólo lo que relee al proveedor. Un reembolso o una cancelación a medias tienen
  -- su propia salida, con sus propias comprobaciones.
  if v_job.topic not in ('payment', 'chargeback', 'claim', 'payment_reconcile') then
    return jsonb_build_object(
      'ok', false, 'reason', 'topic_not_revivable', 'job_id', v_job.id, 'topic', v_job.topic,
      'action', case v_job.topic
        when 'refund_reconcile' then 'resolve_stuck_payment_refund'
        when 'cancellation_reconcile' then 'enqueue_payment_reconciliation'
        else 'resolver_con_soporte'
      end
    );
  end if;
  if v_job.status in ('pending', 'retry_wait', 'claimed', 'processing') then
    return jsonb_build_object(
      'ok', true, 'action', 'already_active', 'idempotent', true,
      'job_id', v_job.id, 'status', v_job.status
    );
  end if;
  if v_job.status not in ('dead_letter', 'failed') then
    return jsonb_build_object(
      'ok', false, 'reason', 'job_not_dead_lettered', 'job_id', v_job.id, 'status', v_job.status
    );
  end if;
  -- Una consulta de pago por cobro, como mucho, activa a la vez (índice único). Si
  -- ya hay otra en la cola, esa es la lectura que hace falta.
  if v_job.topic = 'payment_reconcile' then
    select o.id into v_other_job
      from public.payment_outbox o
     where o.payment_intent_id = v_job.payment_intent_id
       and o.topic = 'payment_reconcile'
       and o.status in ('pending', 'claimed', 'processing', 'retry_wait')
       and o.id <> v_job.id
     limit 1;
    if found then
      return jsonb_build_object(
        'ok', true, 'action', 'already_active', 'idempotent', true,
        'job_id', v_other_job, 'superseded_job_id', v_job.id
      );
    end if;
  end if;

  -- Un intento más, no una ronda nueva: con la cuenta en ocho o más, el próximo
  -- fallo lo devuelve a `dead_letter`. Un trabajo que falla siempre no puede quedar
  -- reintentando solo.
  begin
    update public.payment_outbox
       set status = 'pending', owner = null, lease_expires_at = null,
           next_attempt_at = clock_timestamp(),
           attempts = greatest(attempts, 8)
     where id = v_job.id;
  exception when unique_violation then
    -- Otra consulta del mismo cobro se encoló recién.
    return jsonb_build_object(
      'ok', true, 'action', 'already_active', 'idempotent', true, 'superseded_job_id', v_job.id
    );
  end;
  if v_job.webhook_receipt_id is not null then
    update public.payment_webhook_receipts
       set processing_status = 'queued'
     where id = v_job.webhook_receipt_id;
  end if;
  insert into public.payment_outbox_revivals (
    job_id, business_id, payment_intent_id, topic, actor_user_id, reason,
    previous_status, previous_attempts, previous_last_error
  ) values (
    v_job.id, v_business_id, v_intent_id, v_job.topic, v_actor, v_reason,
    v_job.status, v_job.attempts, left(v_job.last_error, 160)
  ) returning id into v_revival_id;
  if v_intent_id is not null then
    insert into public.payment_events (payment_intent_id, event_type, details)
    values (
      v_intent_id,
      'payment.outbox_job_revived',
      jsonb_build_object(
        'job_id', v_job.id, 'topic', v_job.topic, 'revival_id', v_revival_id,
        'actor_user_id', v_actor, 'previous_attempts', v_job.attempts
      )
    );
  end if;
  return jsonb_build_object(
    'ok', true, 'action', 'revived', 'idempotent', false,
    'job_id', v_job.id, 'topic', v_job.topic, 'revival_id', v_revival_id,
    'attempts', greatest(v_job.attempts, 8)
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rollback_commercial_catalog_batch(p_business_id uuid, p_batch_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_batch public.catalog_change_batches%rowtype;
  v_rollback_id uuid;
  v_item public.catalog_change_items%rowtype;
  v_product public.products%rowtype;
  v_now public.products%rowtype;
  v_alcohol_open boolean;
  v_result jsonb;
  v_items jsonb := '[]'::jsonb;
  v_changed text[];
  v_outcome text;
  v_stock_outcome text;
  v_publication text;
  v_t_price numeric(12, 2);
  v_t_price_status text;
  v_t_merchant boolean;
  v_t_verified boolean;
  v_t_stock integer;
  v_want_available boolean;
  v_publication_changed boolean;
  v_restore_stock boolean;
  v_reserved integer;
  v_movement uuid;
  v_can_sell boolean;
  v_had_open boolean;
  v_recounted boolean;
  v_ledger_rows integer;
  v_count_receipts integer;
  v_publication_decided boolean;
  v_hold text;
  v_closed public.pos_stock_conflicts%rowtype;
  v_new_conflict uuid;
  v_restored integer := 0;
  v_skipped_changed integer := 0;
  v_skipped_created integer := 0;
  v_unchanged integer := 0;
  v_holds_reopened integer := 0;
  v_off_sale_intent_on integer := 0;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can roll back a commercial catalog batch.'
      using errcode = '42501';
  end if;
  if p_batch_id is null then
    raise exception 'Missing batch id.' using errcode = '22023';
  end if;

  select * into v_batch
    from public.catalog_change_batches b
   where b.id = p_batch_id
     and b.business_id = p_business_id
   for update;
  if not found then
    raise exception 'Unknown catalog batch for this business.' using errcode = 'P0002';
  end if;
  if v_batch.source not in ('commercial_batch', 'commercial_plan') then
    raise exception 'Only a commercial batch or plan can be rolled back (this one is %).', v_batch.source
      using errcode = '22023';
  end if;

  -- Idempotente: el lote ya fue revertido. Se devuelve aquel resultado.
  if v_batch.rollback_batch_id is not null then
    select b.result into v_result
      from public.catalog_change_batches b where b.id = v_batch.rollback_batch_id;
    return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('replay', true);
  end if;

  select coalesce(b.alcohol_sales_enabled, false) into v_alcohol_open
    from public.businesses b where b.id = p_business_id;
  v_alcohol_open := coalesce(v_alcohol_open, false);

  insert into public.catalog_change_batches (
    business_id, source, actor_id, session_id, request, request_sha256, reverts_batch_id)
  values (
    p_business_id, 'rollback', auth.uid(), public.identity_session_id(),
    jsonb_build_object('batch_id', p_batch_id),
    encode(sha256(convert_to(jsonb_build_object('batch_id', p_batch_id)::text, 'UTF8')), 'hex'),
    p_batch_id)
  returning id into v_rollback_id;

  -- Los productos se bloquean en orden determinista antes de mirar nada.
  perform 1
    from public.products p
   where p.id in (select i.product_id from public.catalog_change_items i where i.batch_id = p_batch_id)
   order by p.id
   for update;

  for v_item in
    select * from public.catalog_change_items i
     where i.batch_id = p_batch_id
     order by i.id desc
  loop
    select * into v_product from public.products p where p.id = v_item.product_id;
    v_changed := '{}';
    v_stock_outcome := null;
    v_publication := null;
    v_movement := null;
    v_hold := null;
    v_new_conflict := null;
    v_had_open := false;
    v_recounted := false;
    v_reserved := null;

    if v_item.action <> 'created' then
      v_reserved := private.pos_reserved_quantity(v_product.id);
      v_had_open := exists (
        select 1 from public.pos_stock_conflicts c where c.product_id = v_product.id and c.status = 'open');
      -- ¿Alguien volvió a contar este producto después del lote? Otro lote, la ficha
      -- o Caja Clara. Un conteo posterior es la última palabra sobre el stock, aunque
      -- haya dado el mismo número y no haya dejado fila en el libro. Los conteos de
      -- Caja Clara se comparan por cantidad contra los que había al contar: su recibo
      -- lleva la hora de inicio de SU transacción, que puede ser anterior a la del lote
      -- aunque el conteo haya sido posterior. Cualquier diferencia cuenta como
      -- recuento (falla cerrada: el stock no se devuelve).
      select count(*)::integer into v_count_receipts
        from public.pos_stock_receipts r where r.product_id = v_product.id and r.kind = 'count';
      v_recounted := exists (
          select 1 from public.catalog_change_items i2
           where i2.product_id = v_product.id and i2.id > v_item.id and i2.stock_count is not null)
        or (v_item.stock_count is not null and v_count_receipts is distinct from v_item.count_receipts);

      -- ── retención: el conteo del lote había cerrado un conflicto ──
      if coalesce((v_item.detail ->> 'conflict_resolved')::boolean, false) then
        if v_had_open then
          v_hold := 'already_held';
        elsif v_recounted then
          v_hold := 'kept_recounted_since';
        else
          select * into v_closed
            from public.pos_stock_conflicts c
           where c.id = (v_item.detail ->> 'conflict_id')::uuid
             and c.product_id = v_product.id;
          if found then
            v_new_conflict := private.pos_record_conflict(
              p_business_id, v_product.id, v_closed.kind,
              v_closed.requested_delta, v_closed.applied_delta, v_closed.shortfall, v_reserved);
            v_hold := 'reopened';
            v_holds_reopened := v_holds_reopened + 1;
          else
            -- Sin el conflicto original no hay con qué reabrirlo. Falla cerrada: el
            -- stock de ese conteo no se devuelve.
            v_hold := 'conflict_record_missing';
          end if;
        end if;
      end if;
    end if;

    if v_item.action = 'created' then
      v_outcome := 'skipped_created';
      v_skipped_created := v_skipped_created + 1;
    elsif v_item.before = v_item.after then
      v_outcome := 'unchanged';
      v_unchanged := v_unchanged + 1;
    else
      if v_product.price is distinct from (v_item.after ->> 'price')::numeric then v_changed := array_append(v_changed, 'price'); end if;
      if v_product.price_status is distinct from (v_item.after ->> 'price_status') then v_changed := array_append(v_changed, 'price_status'); end if;
      if v_product.merchant_available is distinct from (v_item.after ->> 'merchant_available')::boolean then v_changed := array_append(v_changed, 'merchant_available'); end if;
      if v_product.is_verified is distinct from (v_item.after ->> 'is_verified')::boolean then v_changed := array_append(v_changed, 'is_verified'); end if;

      -- ── stock: qué se puede hacer con él ──
      v_t_stock := v_product.stock;
      v_restore_stock := false;
      if cardinality(v_changed) = 0 then
        if (v_item.before -> 'stock') is distinct from (v_item.after -> 'stock') then
          -- El libro no se borra y todos los que lo escriben bloquean antes la fila
          -- del producto: si tiene las mismas filas que al contar, no hubo movimientos.
          select count(*)::integer into v_ledger_rows
            from public.inventory_movements m where m.product_id = v_product.id;
          if v_had_open then
            v_stock_outcome := 'kept_open_conflict';
          elsif v_hold = 'conflict_record_missing' then
            v_stock_outcome := 'kept_conflict_closed_by_batch';
          elsif v_recounted then
            v_stock_outcome := 'kept_recounted_since';
          elsif v_product.stock is distinct from (v_item.after ->> 'stock')::integer
             or v_reserved is distinct from v_item.reserved_at_count
             or v_ledger_rows is distinct from v_item.ledger_rows then
            v_stock_outcome := 'kept_moved_since';
          else
            v_stock_outcome := 'restored';
            v_restore_stock := true;
            v_t_stock := (v_item.before ->> 'stock')::integer;
          end if;
        else
          v_stock_outcome := 'not_changed_by_batch';
        end if;
        -- ¿La fila decidió la publicación y la cambió? Sólo cuenta lo que pidió la
        -- planilla (`publish`): el disponible que movió el sistema (un conteo que
        -- agota, o que cierra un conflicto y reofrece) no es una decisión del lote, y
        -- deshacerlo sacaría de la venta lo que un conteo posterior reofreció bien.
        v_publication_decided := (v_item.detail ? 'publish')
          and (v_item.before -> 'available') is distinct from (v_item.after -> 'available');
        -- Una fila que sólo contó stock, y cuyo stock ya se movió, no tiene nada
        -- que devolver: se informa como cambiada y no se toca. No vale para la fila
        -- que decidió la publicación: esa decisión se deshace igual.
        if not v_restore_stock
           and not v_publication_decided
           and (v_item.before -> 'price') is not distinct from (v_item.after -> 'price')
           and (v_item.before -> 'price_status') is not distinct from (v_item.after -> 'price_status')
           and (v_item.before -> 'merchant_available') is not distinct from (v_item.after -> 'merchant_available')
           and (v_item.before -> 'is_verified') is not distinct from (v_item.after -> 'is_verified') then
          v_changed := array['stock'];
        end if;
      end if;

      if cardinality(v_changed) > 0 then
        v_outcome := 'skipped_changed';
        v_skipped_changed := v_skipped_changed + 1;
      else
        v_outcome := 'restored';
        v_restored := v_restored + 1;

        v_t_price := (v_item.before ->> 'price')::numeric;
        v_t_price_status := v_item.before ->> 'price_status';
        v_t_merchant := (v_item.before ->> 'merchant_available')::boolean;
        v_t_verified := (v_item.before ->> 'is_verified')::boolean and v_product.is_verified;
        v_publication_changed :=
          (v_item.before -> 'available') is distinct from (v_item.after -> 'available')
          or (v_item.before -> 'merchant_available') is distinct from (v_item.after -> 'merchant_available')
          or (v_item.before -> 'is_verified') is distinct from (v_item.after -> 'is_verified');
        v_want_available := case when v_publication_changed
          then (v_item.before ->> 'available')::boolean else v_product.available end;

        update public.products p
           set price = v_t_price,
               price_status = v_t_price_status,
               stock = v_t_stock,
               merchant_available = v_t_merchant,
               is_verified = v_t_verified,
               verified_at = case when v_t_verified then p.verified_at else null end,
               verified_by = case when v_t_verified then p.verified_by else null end,
               -- Este UPDATE sólo puede apagar. Encender es el paso siguiente, con
               -- todas las compuertas.
               available = p.available and v_want_available and v_t_verified and v_t_merchant
                 and p.is_active and coalesce(v_t_stock, 0) > 0
                 and v_t_price_status = 'confirmed' and coalesce(v_t_price, 0) > 0,
               updated_at = statement_timestamp()
         where p.id = v_product.id;

        if v_restore_stock and coalesce(v_t_stock, 0) - coalesce(v_product.stock, 0) <> 0 then
          insert into public.inventory_movements (
            business_id, product_id, barcode_id, movement_type, quantity_delta, previous_stock, resulting_stock,
            unit_factor, reference_type, reference_id, reason, operator_id, idempotency_key)
          values (
            p_business_id, v_product.id, null, 'stock_count',
            coalesce(v_t_stock, 0) - coalesce(v_product.stock, 0), coalesce(v_product.stock, 0), coalesce(v_t_stock, 0),
            1, 'catalog_change_batch', v_rollback_id,
            format('Reversión del lote comercial %s: el stock vuelve al valor anterior', p_batch_id),
            auth.uid(), 'ccr_' || md5(v_rollback_id::text || ':' || v_product.id::text))
          returning id into v_movement;
        end if;

        -- ── publicación ──
        select * into v_now from public.products p where p.id = v_product.id;
        v_can_sell := v_now.is_active
          and coalesce(v_now.stock, 0) > 0
          and v_now.price_status = 'confirmed'
          and v_now.price > 0
          and v_now.merchant_available
          and public.product_commercial_image_valid(v_now)
          and (not coalesce(v_now.is_alcoholic, false) or v_alcohol_open)
          -- Retenido por un conflicto (el que ya había o el que esta reversión acaba
          -- de reabrir): no se ofrece. El disparador de retención lo impediría igual;
          -- acá se decide a propósito, no por rebote.
          and not v_had_open
          and v_hold is distinct from 'reopened';
        begin
          if v_t_verified and not v_now.is_verified then
            -- El disparador de dato maestro la bajó por restaurar el precio. Estaba
            -- verificada al entrar: se conserva verificada si la imagen sigue en regla.
            if public.product_commercial_image_valid(v_now) then
              update public.products p
                 set is_verified = true,
                     verified_at = statement_timestamp(),
                     verified_by = auth.uid(),
                     available = v_want_available and v_can_sell,
                     updated_at = statement_timestamp()
               where p.id = v_product.id;
            else
              v_publication := 'left_unverified_image_state';
            end if;
          elsif v_t_verified and v_want_available and not v_now.available and v_can_sell then
            update public.products p
               set available = true, updated_at = statement_timestamp()
             where p.id = v_product.id;
          end if;
        exception when check_violation then
          -- Una restricción (por ejemplo la foto obligatoria de un comercio) no deja
          -- volver a ofrecerlo: queda oculto y se informa. Falla cerrada.
          v_publication := 'left_hidden_by_constraint';
        end;
        if v_publication is null
           and (v_item.before ->> 'is_verified')::boolean and not v_product.is_verified then
          v_publication := 'left_unverified';
        end if;
      end if;
    end if;
    if v_publication is null and v_hold = 'reopened' then
      v_publication := 'held_by_stock_conflict';
    end if;

    select * into v_now from public.products p where p.id = v_product.id;
    -- Esta reversión lo sacó de la venta y el comercio lo sigue queriendo vender: es la
    -- misma condición con la que el sistema reofrece al liberar una reserva, cancelar
    -- un pedido o recibir mercadería. No se le apaga la intención (el lote no la tocó);
    -- se avisa, para que quien revierte decida si además lo oculta.
    if v_outcome = 'restored' and v_publication is null
       and v_product.available and not v_now.available
       and v_now.merchant_available and v_now.is_active and v_now.is_verified
       and coalesce(v_now.stock, 0) > 0
       and v_now.price_status = 'confirmed' and v_now.price > 0 then
      v_publication := 'off_sale_intent_on';
      v_off_sale_intent_on := v_off_sale_intent_on + 1;
    end if;
    perform private.catalog_change_log_item(
      v_rollback_id, case when v_outcome = 'skipped_created' then 'skipped_created'
                          when v_outcome = 'restored' then 'restored'
                          when v_outcome = 'skipped_changed' then 'skipped_changed'
                          else 'unchanged' end,
      v_product, v_now, null, null, v_movement,
      jsonb_build_object(
        'reverts_item', v_item.id,
        'changed_fields', case when cardinality(v_changed) > 0 then to_jsonb(v_changed) end,
        'stock', v_stock_outcome,
        'publication', v_publication,
        'hold', v_hold,
        'conflict_id', v_new_conflict,
        'reverts_conflict_id', case when v_hold is not null then v_item.detail ->> 'conflict_id' end));
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'sku', v_now.sku,
      'product_id', v_now.id,
      'outcome', v_outcome,
      'changed_fields', case when cardinality(v_changed) > 0 then to_jsonb(v_changed) end,
      'stock', v_stock_outcome,
      'publication', v_publication,
      'hold', v_hold,
      'conflict_id', v_new_conflict,
      'price', v_now.price,
      'price_status', v_now.price_status,
      'available_stock', v_now.stock,
      'available', v_now.available,
      'is_verified', v_now.is_verified)));
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'batch_id', v_rollback_id,
    'reverts_batch_id', p_batch_id,
    'replay', false,
    'restored', v_restored,
    'skipped_changed', v_skipped_changed,
    'skipped_created', v_skipped_created,
    'unchanged', v_unchanged,
    'holds_reopened', v_holds_reopened,
    'off_sale_intent_on', v_off_sale_intent_on,
    'items', v_items);

  update public.catalog_change_batches b
     set result = v_result
   where b.id = v_rollback_id;
  update public.catalog_change_batches b
     set rolled_back_at = clock_timestamp(),
         rolled_back_by = auth.uid(),
         rollback_batch_id = v_rollback_id
   where b.id = p_batch_id;

  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_address(p_business_id uuid, p_address text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_address text := regexp_replace(btrim(coalesce(p_address, '')), '\s+', ' ', 'g');
  v_before text;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'Sólo el dueño o el encargado pueden cambiar la dirección del local.' using errcode = '42501';
  end if;
  if char_length(v_address) < 5 or char_length(v_address) > 180 then
    raise exception 'Escribí la dirección del local: calle, número y ciudad (entre 5 y 180 caracteres).' using errcode = '22023';
  end if;
  -- Un marcador de «todavía no» no es una dirección: la tienda lo escondería y
  -- el retiro quedaría sin lugar al que ir.
  if v_address ~* '(a confirmar|no publicad|sin direcci)' then
    raise exception 'Escribí la dirección real del local, no un texto provisorio.' using errcode = '22023';
  end if;

  select address into v_before from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  update public.businesses set address = v_address, updated_at = now() where id = p_business_id;

  if v_before is distinct from v_address then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      p_business_id, 'contact', 'updated',
      case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
      jsonb_build_object('address', v_before),
      jsonb_build_object('address', v_address)
    );
  end if;

  return jsonb_build_object('ok', true, 'address', v_address);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_fulfillment(p_business_id uuid, p_delivery_enabled boolean, p_pickup_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_before public.businesses%rowtype;
  v_after public.businesses%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'Sólo el dueño o el encargado pueden cambiar cómo entrega el comercio.' using errcode = '42501';
  end if;
  if p_delivery_enabled is null or p_pickup_enabled is null then
    raise exception 'Indicá si hay delivery y si hay retiro en el local.' using errcode = '22023';
  end if;

  select * into v_before from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  -- Con los pedidos online verificados, la base prohíbe un comercio que no
  -- entrega de ninguna forma (businesses_ordering_verified_configuration). Para
  -- dejar de vender se pausa o se cierra: se dice eso antes de chocar el CHECK.
  if v_before.ordering_verified and not p_delivery_enabled and not p_pickup_enabled then
    raise exception 'Con los pedidos online habilitados tiene que quedar delivery o retiro. Para dejar de vender, pausá o cerrá el negocio.'
      using errcode = '22023';
  end if;
  -- Y con delivery encendido exige el envío y el mínimo DEL COMERCIO, aunque
  -- las zonas tengan los suyos. El mínimo puede ser 0.
  if v_before.ordering_verified and p_delivery_enabled
     and (v_before.delivery_fee is null or v_before.minimum_delivery_subtotal is null) then
    raise exception 'Para encender el delivery primero cargá el costo de envío y el pedido mínimo del comercio (el mínimo puede ser 0).'
      using errcode = '22023';
  end if;

  update public.businesses
     set delivery_enabled = p_delivery_enabled,
         pickup_enabled = p_pickup_enabled,
         updated_at = now()
   where id = p_business_id
  returning * into v_after;

  if v_before.delivery_enabled is distinct from v_after.delivery_enabled
     or v_before.pickup_enabled is distinct from v_after.pickup_enabled then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      p_business_id, 'fulfillment', 'updated',
      case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
      jsonb_build_object('delivery_enabled', v_before.delivery_enabled, 'pickup_enabled', v_before.pickup_enabled),
      jsonb_build_object('delivery_enabled', v_after.delivery_enabled, 'pickup_enabled', v_after.pickup_enabled)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'delivery_enabled', v_after.delivery_enabled,
    'pickup_enabled', v_after.pickup_enabled
  );
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_open_state(p_business_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_business public.businesses%rowtype;
  v_before text;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin', 'staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_status not in ('open', 'paused', 'closed') then
    raise exception 'estado de negocio invalido' using errcode = '22023';
  end if;
  -- Abrir o pausar es operación del día y lo puede hacer el equipo; cerrar el
  -- negocio es una decisión comercial del mismo calibre que firmar el cierre.
  if p_status = 'closed' and not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'cerrar el negocio requiere owner o admin' using errcode = '42501';
  end if;

  select status into v_before from public.businesses where id = p_business_id for update;

  update public.businesses set status = p_status, updated_at = now()
   where id = p_business_id
  returning * into v_business;
  if not found then
    raise exception 'negocio inexistente' using errcode = 'P0002';
  end if;

  if v_before is distinct from v_business.status then
    insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
    values (
      p_business_id, 'open_state', 'updated',
      case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
      jsonb_build_object('status', v_before),
      jsonb_build_object('status', v_business.status)
    );
  end if;

  return jsonb_build_object('ok', true, 'status', v_business.status);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_rider_presence_policy(p_business_id uuid, p_required boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_old boolean;
begin
  if auth.uid() is null or p_business_id is null or p_required is null
     or not public.has_business_role(p_business_id,array['owner','admin']) then
    raise exception 'Dueño o administrador requerido' using errcode='42501';
  end if;
  select rider_presence_required into v_old from public.businesses where id=p_business_id for update;
  if not found then raise exception 'Negocio inexistente' using errcode='P0002'; end if;
  if v_old is distinct from p_required then
    update public.businesses set rider_presence_required=p_required where id=p_business_id;
  end if;
  return jsonb_build_object('ok',true,'required',p_required,'changed',v_old is distinct from p_required);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_business_whatsapp_contact(p_business_id uuid, p_whatsapp_phone text, p_verified boolean DEFAULT false)
 RETURNS TABLE(whatsapp_phone text, whatsapp_verified boolean, whatsapp_verified_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_digits text;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can authorize the business contact channel.' using errcode = '42501';
  end if;

  v_digits := regexp_replace(coalesce(p_whatsapp_phone, ''), '[^0-9]', '', 'g');
  if v_digits <> '' and char_length(v_digits) not between 8 and 15 then
    raise exception 'WhatsApp phone must contain between 8 and 15 digits.';
  end if;
  if coalesce(p_verified, false) and v_digits = '' then
    raise exception 'A valid WhatsApp phone is required before verification.';
  end if;

  -- First rotate the number and invalidate the previous authority stamp.
  update public.businesses b
     set whatsapp_phone = nullif(v_digits, ''),
         whatsapp_verified = false,
         whatsapp_verified_at = null,
         whatsapp_verified_by = null,
         updated_at = statement_timestamp()
   where b.id = p_business_id;
  if not found then
    raise exception 'Business not found.';
  end if;

  -- Verification is a separate update so the phone-change trigger cannot
  -- preserve an old stamp or override this newly authenticated decision.
  if coalesce(p_verified, false) then
    update public.businesses b
       set whatsapp_verified = true,
           whatsapp_verified_at = statement_timestamp(),
           whatsapp_verified_by = auth.uid(),
           updated_at = statement_timestamp()
     where b.id = p_business_id;
  end if;

  return query
  select b.whatsapp_phone, b.whatsapp_verified, b.whatsapp_verified_at
    from public.businesses b
   where b.id = p_business_id;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_commercial_product_publication(p_business_id uuid, p_sku text, p_publish boolean)
 RETURNS TABLE(applied_sku text, applied_available boolean, applied_is_verified boolean, applied_price numeric, applied_stock integer, applied_price_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_sku text := btrim(coalesce(p_sku, ''));
  v_product public.products%rowtype;
  v_business public.businesses%rowtype;
begin
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can publish or hide a commercial product.'
      using errcode = '42501';
  end if;
  if v_sku = '' then
    raise exception 'Missing sku.' using errcode = '22023';
  end if;
  if p_publish is null then
    raise exception 'p_publish must be true or false.' using errcode = '22023';
  end if;

  select * into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.sku = v_sku
   for update;
  if not found then
    raise exception 'Unknown sku % for this business.', v_sku using errcode = 'P0002';
  end if;

  -- ── ocultar: siempre permitido para owner/admin, marca tanto available como merchant_available ──
  if not p_publish then
    return query
      update public.products p
         set available = false,
             merchant_available = false,
             updated_at = statement_timestamp()
       where p.id = v_product.id
      returning p.sku, p.available, p.is_verified, p.price, p.stock, p.price_status;
    perform private.catalog_change_record_single('publication', v_product,
      jsonb_build_object('sku', v_sku, 'publish', false));
    return;
  end if;

  -- La publicación desde el Panel sólo opera sobre la autoridad comercial.
  if coalesce(v_product.catalog_origin, '') <> 'commercial' then
    raise exception 'Refusing to publish non-commercial sku %.', v_sku;
  end if;

  -- ── publicar: producto YA verificado, nunca se verifica acá por primera vez ─
  if not v_product.is_verified then
    raise exception 'Sku % is not verified yet. Verify its master data first (commercial import), then publish.', v_sku;
  end if;
  if not v_product.is_active then
    raise exception 'Refusing to publish inactive sku %.', v_sku;
  end if;
  if v_product.price_status <> 'confirmed' or coalesce(v_product.price, 0) <= 0 then
    raise exception 'Refusing to publish sku % without a confirmed price.', v_sku;
  end if;
  if coalesce(v_product.stock, 0) <= 0 then
    raise exception 'Refusing to publish sku % without stock.', v_sku;
  end if;
  if not public.product_commercial_image_valid(v_product) then
    raise exception 'Refusing to publish sku %: it must have no image at all, or a complete image bound to an approved commercial asset.', v_sku;
  end if;
  if v_product.is_alcoholic then
    select * into v_business from public.businesses b where b.id = p_business_id;
    if not found or coalesce(v_business.alcohol_sales_enabled, false) is not true then
      raise exception 'Refusing to publish sku %: alcohol sales are not enabled for this business (license gate).', v_sku;
    end if;
  end if;

  return query
    update public.products p
       set available = true,
           merchant_available = true,
           updated_at = statement_timestamp()
     where p.id = v_product.id
    returning p.sku, p.available, p.is_verified, p.price, p.stock, p.price_status;
  perform private.catalog_change_record_single('publication', v_product,
    jsonb_build_object('sku', v_sku, 'publish', true));
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_commercial_settings_delegation(p_business_id uuid, p_user_id uuid, p_can_manage boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_row public.business_members%rowtype;
begin
  -- La delegación no se delega: sólo owner o admin. Un staff con el permiso
  -- encendido puede editar la configuración, pero no repartirlo.
  if not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'solo owner o admin delegan la configuracion comercial' using errcode = '42501';
  end if;
  -- Tiene que ser miembro del comercio, y eso se pregunta sin escribir su fila:
  -- `business_members` la administra la capa de identidad.
  select * into v_row
    from public.business_members
   where business_id = p_business_id and user_id = p_user_id and is_active;
  if not found then
    raise exception 'miembro inexistente' using errcode = 'P0002';
  end if;
  if v_row.role not in ('staff', 'admin', 'owner') then
    raise exception 'ese rol no administra configuracion comercial' using errcode = '22023';
  end if;

  if coalesce(p_can_manage, false) then
    insert into public.business_commercial_managers (business_id, user_id, granted_by)
    values (p_business_id, p_user_id, auth.uid())
    on conflict (business_id, user_id) do update
      set granted_by = excluded.granted_by, granted_at = clock_timestamp();
  else
    delete from public.business_commercial_managers
     where business_id = p_business_id and user_id = p_user_id;
  end if;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'permission',
          case when coalesce(p_can_manage, false) then 'enabled' else 'disabled' end,
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          jsonb_build_object('user_id', p_user_id, 'role', v_row.role,
            'can_manage_commercial_settings', not coalesce(p_can_manage, false)),
          jsonb_build_object('user_id', p_user_id, 'role', v_row.role,
            'can_manage_commercial_settings', coalesce(p_can_manage, false)));

  return jsonb_build_object('ok', true, 'user_id', p_user_id,
                            'can_manage_commercial_settings', coalesce(p_can_manage, false));
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_delivery_pricing(p_business_id uuid, p_delivery_fee numeric DEFAULT NULL::numeric, p_minimum_subtotal numeric DEFAULT NULL::numeric, p_max_radius_meters integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_row public.businesses%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar precios de envio' using errcode = '42501';
  end if;
  if p_delivery_fee is not null and p_delivery_fee < 0 then
    raise exception 'costo de envio invalido' using errcode = '22023';
  end if;
  if p_minimum_subtotal is not null and p_minimum_subtotal < 0 then
    raise exception 'minimo invalido' using errcode = '22023';
  end if;
  if p_max_radius_meters is not null then
    if p_max_radius_meters <= 0 then
      raise exception 'tope de distancia invalido' using errcode = '22023';
    end if;
    -- El tope se mide desde el punto del local. Encenderlo contra un punto que
    -- nadie confirmó pararía pedidos legítimos por un pin que puede estar a
    -- cientos de metros. Se exige la verificación humana ANTES.
    if not exists (
      select 1 from private.rider_map_business_locations l
       where l.business_id = p_business_id and l.human_verified
         and l.latitude is not null and l.longitude is not null
    ) then
      raise exception 'el tope de distancia necesita el punto del local verificado por una persona'
        using errcode = '55000';
    end if;
  end if;

  update public.businesses
     set delivery_fee = p_delivery_fee,
         minimum_delivery_subtotal = p_minimum_subtotal,
         delivery_max_radius_meters = p_max_radius_meters,
         updated_at = now()
   where id = p_business_id
  returning * into v_row;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  -- La auditoría la escribe el trigger de `businesses`, que atrapa este cambio
  -- y también cualquier UPDATE suelto que no pase por acá.
  return jsonb_build_object(
    'ok', true,
    'delivery_fee', v_row.delivery_fee,
    'minimum_delivery_subtotal', v_row.minimum_delivery_subtotal,
    'delivery_max_radius_meters', v_row.delivery_max_radius_meters);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_delivery_zone_active(p_business_id uuid, p_zone_id uuid, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_before jsonb;
  v_row public.delivery_zones%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar zonas' using errcode = '42501';
  end if;
  select to_jsonb(z) into v_before from public.delivery_zones z
   where z.id = p_zone_id and z.business_id = p_business_id;
  if v_before is null then
    raise exception 'zona inexistente' using errcode = 'P0002';
  end if;
  update public.delivery_zones
     set is_active = coalesce(p_active, false), updated_at = clock_timestamp()
   where id = p_zone_id and business_id = p_business_id
  returning * into v_row;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'zone', case when v_row.is_active then 'enabled' else 'disabled' end,
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          v_before, to_jsonb(v_row));

  return jsonb_build_object('ok', true, 'zone_id', v_row.id, 'is_active', v_row.is_active);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_preparation_estimate(p_order_id uuid, p_expected_revision bigint, p_minutes integer, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if p_minutes not between 1 and 240 then raise exception 'minutos fuera de rango' using errcode = '22023'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  v_hash := public.business_command_request_hash('set_preparation_estimate', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'minutes', p_minutes));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  if v_order.revision <> p_expected_revision then raise exception 'revision desactualizada' using errcode = 'PT409'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('submitted', 'accepted', 'preparing') then raise exception 'estado no permite estimacion' using errcode = 'P0001'; end if;
  update public.orders set preparation_estimate_minutes = p_minutes where id = p_order_id;
  insert into public.order_events(order_id, business_id, actor_user_id, actor_role, event_type, type, message, metadata)
  values (p_order_id, v_order.business_id, auth.uid(), 'business', 'preparation_estimate_set', 'preparation_estimate_set', 'Tiempo de preparacion actualizado.', jsonb_build_object('minutes', p_minutes));
  select to_jsonb(o) into v_result from public.orders o where o.id = p_order_id;
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'set_preparation_estimate', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_service_enforcement(p_business_id uuid, p_hours_enforced boolean, p_delivery_zone_enforced boolean, p_alcohol_hours_enforced boolean DEFAULT NULL::boolean, p_timezone text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_row public.businesses%rowtype;
  v_timezone text;
  v_hours boolean;
  v_zones boolean;
  v_alcohol boolean;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para cambiar la exigencia' using errcode = '42501';
  end if;
  select * into v_row from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'comercio inexistente' using errcode = 'P0002';
  end if;

  -- NULL es «no toco esto», para las tres banderas y para el huso.
  v_timezone := coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), v_row.operating_timezone);
  v_hours := coalesce(p_hours_enforced, v_row.hours_enforced);
  v_zones := coalesce(p_delivery_zone_enforced, v_row.delivery_zone_enforced);
  v_alcohol := coalesce(p_alcohol_hours_enforced, v_row.alcohol_hours_enforced);

  -- Un comercio verificado no se queda sin reglas: apagar el horario lo deja tomando
  -- pedidos a cualquier hora y apagar la cobertura, a cualquier dirección. No se revoca
  -- la verificación por un clic: se contesta qué hacer.
  if v_row.ordering_verified
     and ((v_row.hours_enforced and not v_hours) or (v_row.delivery_zone_enforced and not v_zones)) then
    raise exception 'ENFORCEMENT_LOCKED'
      using errcode = '55000',
            detail = 'un comercio verificado no apaga la exigencia de horarios ni la de cobertura',
            hint = 'para dejar de vender, pausar o cerrar el negocio; para operar sin estas reglas la plataforma revoca antes la verificacion';
  end if;

  if (v_hours or v_alcohol) then
    if v_timezone is null then
      raise exception 'para exigir horarios hace falta declarar el huso horario' using errcode = '22023';
    end if;
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then
      raise exception 'huso horario desconocido' using errcode = '22023';
    end if;
  end if;

  -- Encender la exigencia sin una sola franja cargada declara el comercio
  -- cerrado para siempre con un clic. Se contesta qué falta.
  if v_hours and not v_row.hours_enforced then
    if not exists (
      select 1 from public.business_service_hours h
       where h.business_id = p_business_id and h.channel in ('delivery', 'pickup')
    ) then
      raise exception 'no hay horarios cargados: exigirlos dejaria el comercio cerrado'
        using errcode = '55000';
    end if;
  end if;
  -- Lo mismo del otro lado: sin una zona activa, exigir cobertura cancela todos
  -- los envíos.
  if v_zones and not v_row.delivery_zone_enforced then
    if not exists (
      select 1 from public.delivery_zones z
       where z.business_id = p_business_id and z.is_active
    ) then
      raise exception 'no hay zonas activas: exigir cobertura cancelaria todos los envios'
        using errcode = '55000';
    end if;
  end if;

  update public.businesses
     set hours_enforced = v_hours,
         delivery_zone_enforced = v_zones,
         alcohol_hours_enforced = v_alcohol,
         operating_timezone = v_timezone,
         updated_at = now()
   where id = p_business_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'hours_enforced', v_row.hours_enforced,
    'delivery_zone_enforced', v_row.delivery_zone_enforced,
    'alcohol_hours_enforced', v_row.alcohol_hours_enforced,
    'operating_timezone', v_row.operating_timezone);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_packing_session(p_order_id uuid, p_expected_revision bigint, p_idempotency_key text)
 RETURNS public.order_packing_sessions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_session public.order_packing_sessions%rowtype;
begin
  if btrim(coalesce(p_idempotency_key,'')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode='22023'; end if;
  select o.* into v_order from public.orders o where o.id=p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode='P0002'; end if;
  if not public.has_business_role(v_order.business_id,array['owner','admin','staff']) then raise exception 'operador no autorizado' using errcode='42501'; end if;
  select s.* into v_session from public.order_packing_sessions s where s.business_id=v_order.business_id and s.idempotency_key=p_idempotency_key;
  if found then return v_session; end if;
  if v_order.revision<>p_expected_revision then raise exception 'conflicto de revision' using errcode='PT409'; end if;
  if public.normalize_order_status_vocabulary(v_order.status) not in ('accepted','preparing') then raise exception 'estado no permite packing' using errcode='P0001'; end if;
  insert into public.order_packing_sessions(business_id,order_id,order_revision,status,operator_id,idempotency_key)
  values(v_order.business_id,v_order.id,v_order.revision,'in_progress',auth.uid(),p_idempotency_key)
  returning * into v_session;
  return v_session;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_payment_outbox_job(p_job_id uuid, p_owner text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare v_receipt_id uuid;
begin
  update public.payment_outbox set status = 'processing'
   where id = p_job_id and owner = p_owner and status = 'claimed' and lease_expires_at > clock_timestamp()
   returning webhook_receipt_id into v_receipt_id;
  if not found then return false; end if;
  if v_receipt_id is not null then
    update public.payment_webhook_receipts set processing_status = 'processing', attempt_count = attempt_count + 1 where id = v_receipt_id;
  end if;
  return true;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_rider_delivery(p_order_id uuid, p_expected_revision bigint, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_key text := public.rider_validate_idempotency_key(p_idempotency_key);
  v_result jsonb;
begin
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  perform public.rider_require_active_membership(v_order.business_id);
  if v_order.assigned_rider_user_id is distinct from auth.uid() then return jsonb_build_object('ok', false, 'code', 'not_assigned'); end if;
  select result into v_result from public.rider_delivery_operations
   where order_id = v_order.id and rider_user_id = auth.uid() and operation = 'start_route' and idempotency_key = v_key for share;
  if found then return v_result || jsonb_build_object('idempotent_no_op', true); end if;
  if v_order.revision <> p_expected_revision then return jsonb_build_object('ok', false, 'code', 'stale_revision', 'revision', v_order.revision); end if;
  if v_order.status <> 'picked_up' then return jsonb_build_object('ok', false, 'code', 'not_picked_up', 'revision', v_order.revision); end if;
  update public.orders set status = 'on_the_way' where id = v_order.id;
  v_result := jsonb_build_object('ok', true, 'outcome', 'route_started', 'idempotent_no_op', false, 'order', public.rider_active_delivery_payload(v_order.id));
  insert into public.rider_delivery_operations(order_id, rider_user_id, operation, idempotency_key, request_fingerprint, result)
  values (v_order.id, auth.uid(), 'start_route', v_key, digest(jsonb_build_object('revision', p_expected_revision)::text, 'sha256'), v_result);
  return v_result;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sweep_expired_checkout_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_released integer;
begin
  -- `expire_checkout_sessions` toma las sesiones con `for update skip locked`,
  -- así que dos barridos concurrentes no se pisan ni bloquean un checkout vivo.
  v_released := public.expire_checkout_sessions(200);
  return coalesce(v_released, 0);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transition_operational_alert(p_alert_id uuid, p_target_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_alert public.operational_alerts%rowtype;
begin
  select * into v_alert
  from public.operational_alerts
  where id = p_alert_id
  for update;
  if not found then raise exception 'alerta inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_alert.business_id, array['owner','admin','staff']) then
    raise exception 'operador no autorizado' using errcode = '42501';
  end if;
  if p_target_status not in ('acknowledged','resolved') then
    raise exception 'transicion de alerta invalida' using errcode = '22023';
  end if;
  if p_target_status = 'resolved' and char_length(btrim(coalesce(p_note, ''))) not between 5 and 500 then
    raise exception 'la resolucion requiere una nota' using errcode = '22023';
  end if;
  if v_alert.status = 'resolved' then
    return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', v_alert.status, 'idempotent_replay', true);
  end if;
  -- El reconocimiento registra QUIÉN la vio primero: un reintento (u otro
  -- operador repitiendo el gesto) no reescribe al actor ni la hora.
  if p_target_status = 'acknowledged' and v_alert.status = 'acknowledged' then
    return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', v_alert.status, 'idempotent_replay', true);
  end if;
  if p_target_status = 'acknowledged' then
    update public.operational_alerts
    set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = clock_timestamp(), updated_at = clock_timestamp()
    where id = v_alert.id;
  else
    update public.operational_alerts
    set status = 'resolved', resolved_by = auth.uid(), resolved_at = clock_timestamp(), resolution_note = btrim(p_note), updated_at = clock_timestamp()
    where id = v_alert.id;
  end if;
  insert into public.operational_alert_events(business_id, alert_id, event_type, actor_id, detail)
  values (v_alert.business_id, v_alert.id, p_target_status, auth.uid(), jsonb_build_object('note', nullif(btrim(coalesce(p_note,'')),'')));
  return jsonb_build_object('ok', true, 'alert_id', v_alert.id, 'status', p_target_status, 'idempotent_replay', false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.transition_order(p_order_id uuid, p_expected_revision bigint, p_new_status text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_order public.orders%rowtype;
  v_existing public.business_command_receipts%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'autenticacion requerida' using errcode = '42501'; end if;
  if btrim(coalesce(p_idempotency_key, '')) !~ '^[A-Za-z0-9:_-]{8,128}$' then raise exception 'idempotency_key invalida' using errcode = '22023'; end if;
  select o.* into v_order from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'pedido inexistente' using errcode = 'P0002'; end if;
  if not public.has_business_role(v_order.business_id, array['owner', 'admin', 'staff']) then raise exception 'operador no autorizado' using errcode = '42501'; end if;
  -- Cancelar y rechazar piden el permiso `orders.cancel` del catálogo. Son el mismo
  -- acto —cerrar un pedido que el comercio no va a entregar, devolviendo su stock— y el
  -- catálogo no tiene un permiso aparte para rechazar. El destino se normaliza con la
  -- misma función que usa la transición, así `canceled` y `cancelled` son lo mismo.
  -- Las demás transiciones no piden nada nuevo.
  if public.normalize_order_status_vocabulary(p_new_status) in ('cancelled', 'rejected')
     and not public.identity_has_permission(v_order.business_id, 'orders.cancel') then
    raise exception 'operador sin permiso para cancelar o rechazar pedidos'
      using errcode = '42501', detail = 'PERMISSION_REQUIRED: orders.cancel';
  end if;
  v_hash := public.business_command_request_hash('transition_order', p_order_id, jsonb_build_object('expected_revision', p_expected_revision, 'new_status', public.normalize_order_status_vocabulary(p_new_status)));
  select r.* into v_existing from public.business_command_receipts r where r.business_id = v_order.business_id and r.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_hash <> v_hash then raise exception 'idempotency_key reutilizada con otro payload' using errcode = '23505'; end if;
    return v_existing.result || jsonb_build_object('idempotent_replay', true);
  end if;
  v_result := public.transition_order(p_order_id, p_expected_revision, p_new_status);
  insert into public.business_command_receipts(business_id, order_id, actor_user_id, command_type, idempotency_key, request_hash, result)
  values (v_order.business_id, p_order_id, auth.uid(), 'transition_order', p_idempotency_key, v_hash, v_result);
  return v_result || jsonb_build_object('idempotent_replay', false);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.unpublish_catalog_product(p_business_id uuid, p_external_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_updated integer;
  v_product public.products%rowtype;
begin
  if auth.uid() is null
     or not public.has_business_role(p_business_id, array['owner', 'admin']) then
    raise exception 'Only an active owner/admin can unpublish catalog products.' using errcode = '42501';
  end if;
  -- La fila se lee bloqueada antes de escribir para poder guardar su imagen previa.
  select * into v_product
    from public.products p
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id)
   for update;
  update public.products p
     set available = false,
         merchant_available = false,
         is_verified = false,
         verified_at = null,
         verified_by = null,
         updated_at = statement_timestamp()
   where p.business_id = p_business_id
     and p.external_id = btrim(p_external_id);
  get diagnostics v_updated = row_count;
  if v_updated = 1 then
    perform private.catalog_change_record_single('unpublish', v_product,
      jsonb_build_object('external_id', btrim(p_external_id)));
  end if;
  return v_updated = 1;
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_delivery_zone(p_business_id uuid, p_zone jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_id uuid;
  v_name text;
  v_match_kind text;
  v_area text;
  v_boundary polygon;
  v_boundary_text text;
  v_points integer;
  v_fee numeric(12, 2);
  v_minimum numeric(12, 2);
  v_priority integer;
  v_notes text;
  v_active boolean;
  v_before jsonb;
  v_row public.delivery_zones%rowtype;
begin
  if not public.can_manage_commercial_settings(p_business_id) then
    raise exception 'sin autorizacion para configurar zonas' using errcode = '42501';
  end if;
  if p_zone is null or jsonb_typeof(p_zone) <> 'object' then
    raise exception 'zona invalida' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_zone) as k(key)
     where k.key not in ('id', 'name', 'match_kind', 'area', 'boundary',
                         'delivery_fee', 'minimum_subtotal', 'priority', 'notes', 'is_active')
  ) then
    raise exception 'campo de zona no permitido' using errcode = '22023';
  end if;

  v_id := nullif(p_zone ->> 'id', '')::uuid;
  v_name := nullif(regexp_replace(btrim(coalesce(p_zone ->> 'name', '')), '[[:space:]]+', ' ', 'g'), '');
  v_match_kind := lower(btrim(coalesce(p_zone ->> 'match_kind', '')));
  v_notes := nullif(btrim(coalesce(p_zone ->> 'notes', '')), '');
  v_active := coalesce((p_zone ->> 'is_active')::boolean, true);
  v_priority := coalesce(nullif(p_zone ->> 'priority', '')::integer, 100);

  if v_name is null or char_length(v_name) < 2 or char_length(v_name) > 80 then
    raise exception 'nombre de zona invalido' using errcode = '22023';
  end if;
  if v_match_kind not in ('declared_area', 'polygon') then
    raise exception 'tipo de zona invalido: solo declared_area o polygon' using errcode = '22023';
  end if;
  if v_priority < 0 or v_priority > 10000 then
    raise exception 'prioridad fuera de rango' using errcode = '22023';
  end if;

  if nullif(p_zone ->> 'delivery_fee', '') is not null then
    if (p_zone ->> 'delivery_fee') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'costo de envio invalido' using errcode = '22023';
    end if;
    v_fee := (p_zone ->> 'delivery_fee')::numeric(12, 2);
  end if;
  if nullif(p_zone ->> 'minimum_subtotal', '') is not null then
    if (p_zone ->> 'minimum_subtotal') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'minimo invalido' using errcode = '22023';
    end if;
    v_minimum := (p_zone ->> 'minimum_subtotal')::numeric(12, 2);
  end if;

  if v_match_kind = 'declared_area' then
    v_area := public.normalize_zone_name(coalesce(nullif(p_zone ->> 'area', ''), v_name));
    if v_area is null then
      raise exception 'el barrio de la zona no puede quedar vacio' using errcode = '22023';
    end if;
    if p_zone ? 'boundary' and jsonb_typeof(p_zone -> 'boundary') <> 'null' then
      raise exception 'una zona por barrio no lleva borde' using errcode = '22023';
    end if;
  else
    -- `jsonb_typeof` de una clave ausente devuelve NULL, y `NULL <> 'array'` no
    -- es verdadero: sin el coalesce, una zona sin borde se colaba hasta el
    -- conteo de vértices y salía con el mensaje equivocado.
    if coalesce(jsonb_typeof(p_zone -> 'boundary'), 'null') <> 'array' then
      raise exception 'una zona por poligono necesita un borde' using errcode = '22023';
    end if;
    select count(*)::integer into v_points from jsonb_array_elements(p_zone -> 'boundary');
    if v_points < 3 or v_points > 200 then
      raise exception 'el borde necesita entre 3 y 200 vertices' using errcode = '22023';
    end if;
    -- Cada vértice es [lng, lat] y se valida antes de armar el polígono. El
    -- texto se construye a partir de números ya casteados: no hay forma de que
    -- entre otra cosa.
    if exists (
      select 1 from jsonb_array_elements(p_zone -> 'boundary') as v(value)
       where jsonb_typeof(v.value) <> 'array'
          or jsonb_array_length(v.value) <> 2
          or jsonb_typeof(v.value -> 0) <> 'number'
          or jsonb_typeof(v.value -> 1) <> 'number'
          or (v.value ->> 0)::double precision not between -180 and 180
          or (v.value ->> 1)::double precision not between -90 and 90
    ) then
      raise exception 'vertice invalido: se espera [lng, lat] dentro de rango' using errcode = '22023';
    end if;
    select '(' || string_agg(format('(%s,%s)', (v.value ->> 0)::double precision, (v.value ->> 1)::double precision), ',' order by v.ord) || ')'
      into v_boundary_text
      from jsonb_array_elements(p_zone -> 'boundary') with ordinality as v(value, ord);
    v_boundary := v_boundary_text::polygon;
  end if;

  if v_id is not null then
    select to_jsonb(z) into v_before from public.delivery_zones z
     where z.id = v_id and z.business_id = p_business_id;
    if v_before is null then
      raise exception 'zona inexistente' using errcode = 'P0002';
    end if;
    update public.delivery_zones
       set name = v_name, is_active = v_active, match_kind = v_match_kind,
           area_normalized = v_area, boundary = v_boundary,
           delivery_fee = v_fee, minimum_subtotal = v_minimum,
           priority = v_priority, notes = v_notes, updated_at = clock_timestamp()
     where id = v_id and business_id = p_business_id
    returning * into v_row;
  else
    insert into public.delivery_zones (
      business_id, name, is_active, match_kind, area_normalized, boundary,
      delivery_fee, minimum_subtotal, priority, notes
    ) values (
      p_business_id, v_name, v_active, v_match_kind, v_area, v_boundary,
      v_fee, v_minimum, v_priority, v_notes
    ) returning * into v_row;
  end if;

  insert into public.business_config_audit (business_id, scope, action, actor_kind, actor_id, before, after)
  values (p_business_id, 'zone', case when v_before is null then 'created' else 'updated' end,
          case when auth.uid() is null then 'service' else 'user' end, auth.uid(),
          v_before, to_jsonb(v_row));

  return jsonb_build_object('ok', true, 'zone_id', v_row.id, 'zone_name', v_row.name);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;

CREATE OR REPLACE FUNCTION public.withdraw_rider_order_offer(p_offer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  -- la-taba:api-boundary v1: 55000 -> 409 y P0002 -> 404 sólo por la API (request.method) y sólo en el marco más externo.
  -- El cuerpo de la función es el bloque anidado, letra por letra. Generado por scripts/db/wrap-api-boundary.mjs.
  _api_state text;
  _api_message text;
  _api_detail text;
  _api_hint text;
  _api_context text;
begin

declare
  v_offer public.rider_order_offers%rowtype;
begin
  if auth.uid() is null then
    raise exception 'autenticacion requerida' using errcode = '42501';
  end if;
  select f.* into v_offer from public.rider_order_offers f where f.id = p_offer_id;
  if not found then
    raise exception 'oferta inexistente' using errcode = 'P0002';
  end if;
  if not public.has_business_role(v_offer.business_id, array['owner', 'admin', 'staff']) then
    raise exception 'rol de negocio requerido' using errcode = '42501';
  end if;
  -- Primero el pedido, después la oferta, como ofrecerla (offer_order_to_rider) y aceptarla: antes la
  -- actualización tomaba la oferta y el evento el pedido, y se trababa (40P01) contra ofrecer el pedido a
  -- otro repartidor (20261002062000).
  perform 1 from public.orders where id = v_offer.order_id for no key update;

  update public.rider_order_offers
     set status = 'withdrawn', responded_at = clock_timestamp(), version = version + 1
   where id = p_offer_id and status = 'pending'
  returning * into v_offer;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'offer_not_pending');
  end if;

  insert into public.order_events (
    order_id, business_id, actor_user_id, actor_role, actor_type, actor_id,
    event_type, type, message, metadata, payload
  ) values (
    v_offer.order_id, v_offer.business_id, auth.uid(), 'business', 'business', auth.uid(),
    'order.rider_offer_withdrawn', 'order.rider_offer_withdrawn', 'Oferta retirada por el negocio',
    jsonb_build_object('offer_id', v_offer.id, 'rider_user_id', v_offer.rider_user_id),
    jsonb_build_object('offer_id', v_offer.id, 'rider_user_id', v_offer.rider_user_id)
  );

  return jsonb_build_object('ok', true, 'code', 'withdrawn', 'offer_id', v_offer.id);
end;
exception
  when sqlstate '55000' or sqlstate 'P0002' then
    get stacked diagnostics _api_state = returned_sqlstate, _api_message = message_text,
                            _api_detail = pg_exception_detail, _api_hint = pg_exception_hint;
    get diagnostics _api_context = pg_context;
    if nullif(pg_catalog.current_setting('request.method', true), '') is not null
       and pg_catalog.array_length(pg_catalog.string_to_array(_api_context, E'\n'), 1) = 1 then
      raise sqlstate 'PGRST' using
        message = pg_catalog.json_build_object('code', _api_state, 'message', _api_message,
                                               'details', nullif(_api_detail, ''), 'hint', nullif(_api_hint, ''))::text,
        detail = pg_catalog.json_build_object('status', case _api_state when 'P0002' then 404 else 409 end,
                                              'headers', pg_catalog.json_build_object())::text;
    end if;
    raise;
end;
$function$;
