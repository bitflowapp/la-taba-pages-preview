import fs from 'node:fs';

const SRC = 'D:/1212/la-taba-e2e-test-staging-rc/supabase/migrations/20260802093000_mercadopago_checkout_pro_lifecycle.sql';
const OUT = 'D:/1212/la-taba-e2e-test-staging-rc/supabase/migrations/20260806140000_mercadopago_provider_snapshot_contract.sql';

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
// record_mercadopago_payment_snapshot spans 511..638 (1-indexed) in the original.
let body = lines.slice(510, 638).join('\n');

const edits = [
  [
    `  elsif v_settings.application_id is null or p_snapshot ->> 'application_id' is distinct from v_settings.application_id then
    v_valid := false; v_reason := 'application_mismatch';`,
    `  -- Mercado Pago exposes no application_id on payments or merchant orders, so
  -- the assertion runs only when the provider actually supplies one. collector_id
  -- stays mandatory and is what pins a payment to the configured account.
  elsif nullif(btrim(coalesce(p_snapshot ->> 'application_id', '')), '') is not null
    and p_snapshot ->> 'application_id' is distinct from coalesce(v_settings.application_id, '') then
    v_valid := false; v_reason := 'application_mismatch';`,
  ],
  [
    `  elsif coalesce((p_snapshot ->> 'live_mode')::boolean, false) is distinct from (v_intent.environment = 'production') then
    v_valid := false; v_reason := 'live_mode_mismatch';`,
    `  -- Checkout Pro test credentials are a Mercado Pago sandbox test user whose
  -- payments report live_mode = true, so equality with the environment can only
  -- be demanded in production. In test the collector_id assertion above already
  -- pins the payment to the sandbox user, which cannot move real money.
  elsif v_intent.environment = 'production'
    and coalesce((p_snapshot ->> 'live_mode')::boolean, false) is not true then
    v_valid := false; v_reason := 'live_mode_mismatch';`,
  ],
];

for (const [from, to] of edits) {
  if (!body.includes(from)) throw new Error(`no encontrado:\n${from}`);
  body = body.replace(from, to);
}

const header = `-- Corrige el contrato de validacion del snapshot de pago contra lo que Mercado
-- Pago devuelve realmente en Checkout Pro. Medido el 2026-08-06 sobre pagos
-- sandbox reales del proyecto la-taba-staging:
--   * GET /v1/payments/{id} no incluye application_id (ni el merchant order).
--   * Las credenciales de prueba de la aplicacion son un usuario de prueba, y
--     sus pagos informan live_mode = true.
-- Sin estos dos ajustes ningun pago real de Mercado Pago podia finalizar: la
-- validacion terminaba en application_mismatch o live_mode_mismatch y dejaba la
-- sesion en manual_review_required. La resolucion de preference_id se corrigio
-- en la Edge Function (_shared/mercadopago.ts), que ahora lo toma del merchant
-- order, de modo que esa asercion vuelve a ser efectiva en vez de vacia.

`;

fs.writeFileSync(OUT, `${header}${body}\n`);
console.log('escrita:', OUT);
console.log('lineas:', body.split('\n').length);
