-- PLANTILLA — NO es una migración y NO se aplica sola. Vive fuera de supabase/migrations a propósito: `supabase db push`
-- jamás la ejecuta. La corre una persona, en el entorno que corresponda, cuando se decida habilitar Mobbex (ver
-- docs/payments/mobbex/CERTIFICATION.md, «Programar la conciliación»).
--
-- Qué programa: la llamada periódica a la Edge Function `mobbex-worker`, que (1) devuelve a la cola los cobros que quedaron
-- sin lectura reciente, (2) lee cada uno en Mobbex y (3) entrega la respuesta CONFIRMADA al libro. Sin ella siguen
-- funcionando el webhook y la lectura al volver de Mobbex, pero un aviso perdido solo se recupera cuando la persona vuelve.
--
-- Cómo se autentica (importante, fácil de equivocar): `mobbex-worker` usa `requireWorkerAuthorization`, el MISMO validador
-- que el worker de Mercado Pago. Ese validador firma el manifiesto
--     <timestamp>.<nonce>.POST./functions/v1/mercadopago-payment-worker
-- con el secreto PAYMENT_WORKER_SECRET, sea cual sea la función llamada (PAYMENT_WORKER_CANONICAL_PATH). Firmar con la ruta
-- de mobbex-worker da 401 en silencio. Por eso esta función firma con la ruta canónica y reutiliza el secreto de Vault
-- `taba_payment_worker_hmac_secret`; sólo la URL de destino es propia (`taba_mobbex_worker_url`).
-- tests/mobbex-worker-cron-template.test.mjs fija esa correspondencia contra el validador real.
--
-- Estado seguro por construcción:
--   * crear la función no programa nada: la programación (cron.schedule) está COMENTADA al final;
--   * con Mobbex apagado en todos los comercios, o sin secretos en Vault, la función no hace ninguna llamada de red;
--   * sin cobros abiertos ni trabajos vencidos tampoco llama.
-- Requisitos del entorno: extensiones pg_cron, pg_net y supabase_vault; los dos secretos de Vault de arriba.
-- Verificado en banco local con stubs de esas extensiones; la llamada de red real no se probó.

create or replace function public.dispatch_mobbex_worker(p_source text default 'cron')
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, vault, net, pg_temp
as $$
declare
  v_worker_url text;
  v_worker_secret text;
  v_timestamp text;
  v_nonce text;
  v_manifest text;
  v_signature text;
  v_request_id bigint;
begin
  if p_source not in ('cron', 'manual') then
    raise exception 'invalid mobbex worker dispatch source' using errcode = '22023';
  end if;

  -- Apagado = ningún tráfico: si ningún comercio tiene Mobbex habilitado, no hay nada que conciliar.
  if not exists (select 1 from public.mobbex_business_settings s where s.enabled) then return null; end if;
  -- Sólo si hay algo abierto o vencido (el barrido del worker necesita correr aunque no haya jobs, para recoger cobros sin lectura).
  if not exists (select 1 from public.mobbex_payment_intents pi
                  where pi.internal_status in ('checkout_created', 'pending', 'in_process', 'ambiguous', 'approved_order_pending', 'rejected'))
     and not exists (select 1 from public.mobbex_jobs j
                      where (j.status in ('pending', 'retry_wait') and j.next_attempt_at <= clock_timestamp())
                         or (j.status = 'claimed' and coalesce(j.lease_expires_at, '-infinity'::timestamptz) < clock_timestamp())) then
    return null;
  end if;

  select ds.decrypted_secret into v_worker_url from vault.decrypted_secrets ds where ds.name = 'taba_mobbex_worker_url' limit 1;
  select ds.decrypted_secret into v_worker_secret from vault.decrypted_secrets ds where ds.name = 'taba_payment_worker_hmac_secret' limit 1;

  -- Falta de configuración en Vault = no-op seguro; el preflight de despliegue debe probar que ambos nombres existen.
  if nullif(btrim(v_worker_url), '') is null or nullif(v_worker_secret, '') is null then return null; end if;
  if v_worker_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1/mobbex-worker$' then
    raise exception 'invalid mobbex worker URL' using errcode = '22023';
  end if;
  if length(v_worker_secret) < 32 then
    raise exception 'payment worker secret is too short' using errcode = '22023';
  end if;

  v_timestamp := floor(extract(epoch from clock_timestamp()))::bigint::text;
  v_nonce := gen_random_uuid()::text;
  -- Ruta canónica del validador compartido (NO la de mobbex-worker): ver la cabecera.
  v_manifest := v_timestamp || '.' || v_nonce || '.POST./functions/v1/mercadopago-payment-worker';
  v_signature := encode(hmac(v_manifest, v_worker_secret, 'sha256'), 'hex');

  select net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-taba-worker-timestamp', v_timestamp,
      'x-taba-worker-nonce', v_nonce,
      'x-taba-worker-signature', v_signature
    ),
    body := jsonb_build_object('source', p_source, 'scheduled_at', clock_timestamp()),
    timeout_milliseconds := 10000
  ) into v_request_id;
  return v_request_id;
end;
$$;

revoke all on function public.dispatch_mobbex_worker(text) from public, anon, authenticated;
grant execute on function public.dispatch_mobbex_worker(text) to service_role;

-- ── ACTIVAR (decisión humana; una sola vez por entorno). Mantener comentado en esta plantilla. ──────────────────────────
-- select cron.schedule('taba-mobbex-worker', '60 seconds', 'select public.dispatch_mobbex_worker(''cron'');');
--
-- ── DESACTIVAR / VOLVER ATRÁS ──────────────────────────────────────────────────────────────────────────────────────
-- select cron.unschedule('taba-mobbex-worker');
-- drop function if exists public.dispatch_mobbex_worker(text);
