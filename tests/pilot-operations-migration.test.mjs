import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

const health = read('20260807110000_pilot_operations_thresholds_and_health.sql');
const dashboard = read('20260807120000_pilot_operations_dashboard.sql');
const alerts = read('20260807130000_pilot_operational_alert_coverage.sql');
const trace = read('20260807140000_pilot_incident_trace.sql');
const report = read('20260807150000_pilot_commercial_report.sql');
const qaOrigin = read('20260806160000_order_qa_origin_classification.sql');

const all = [health, dashboard, alerts, trace, report];
const branch = all.join('\n');

test('ninguna migración de operaciones destruye evidencia', () => {
  for (const sql of all) {
    assert.doesNotMatch(sql, /drop table|truncate table/i);
    assert.doesNotMatch(sql, /delete from public[.](orders|order_items|order_events|checkout_sessions|payment_intents|rider_locations|operational_alerts)/i);
  }
});

test('toda función nueva es SECURITY DEFINER con search_path fijado', () => {
  const definitions = [...branch.matchAll(/create or replace function (public\.[a-z_]+)\(/g)].map((match) => match[1]);
  assert.ok(definitions.length >= 8, `se esperaban al menos ocho funciones, hay ${definitions.length}`);
  for (const block of branch.split('create or replace function ').slice(1)) {
    if (!/security definer/.test(block)) continue;
    assert.match(block.slice(0, 900), /set search_path = pg_catalog, public/);
  }
});

test('ninguna función operativa queda ejecutable por anónimos', () => {
  const exposed = [
    'get_pilot_service_health(uuid)',
    'configure_pilot_ops_thresholds(uuid, jsonb)',
    'get_pilot_operations_dashboard(uuid, text)',
    'trace_pilot_order(uuid, text)',
    'get_pilot_commercial_report(uuid, date, date, text)',
  ];
  for (const signature of exposed) {
    assert.match(branch, new RegExp(`revoke execute on function public\\.${escape(signature)} from public, anon`));
    assert.match(branch, new RegExp(`grant execute on function public\\.${escape(signature)} to authenticated`));
  }
  // Las auxiliares no llegan siquiera a `authenticated`: sólo las usa el servidor.
  for (const helper of ['pilot_ops_thresholds(uuid)', 'pilot_health_verdict(boolean, boolean, boolean)']) {
    assert.match(branch, new RegExp(`revoke execute on function public\\.${escape(helper)} from public, anon, authenticated`));
  }
});

test('cada lectura del piloto exige rol del negocio antes de leer un solo dato', () => {
  for (const sql of [health, dashboard, trace, report]) {
    assert.match(sql, /has_business_role\(p_business_id, array\['owner', 'admin', 'staff'\]\)[\s\S]{0,120}operador no autorizado/);
  }
  // Cambiar un umbral es una decisión del dueño, no del mostrador.
  assert.match(health, /has_business_role\(p_business_id, array\['owner', 'admin'\]\)[\s\S]{0,160}configurar umbrales requiere owner o admin/);
});

test('healthy exige evidencia; sin evidencia el veredicto es unknown', () => {
  assert.match(health, /when not coalesce\(p_has_evidence, false\) then 'unknown'/);
  // El orden importa: `down` gana sobre la falta de evidencia, y `healthy` es
  // el último recurso, nunca el default.
  assert.match(health, /when coalesce\(p_is_down, false\) then 'down'[\s\S]{0,200}else 'healthy'/);
  assert.match(health, /'unknown' = any \(p_statuses\) then 'unknown'/);
});

test('la salud cubre los ocho servicios del contrato del piloto', () => {
  for (const service of [
    "'service', 'database'", "'service', 'supabase'", "'service', 'functions'",
    "'service', 'webhook'", "'service', 'scheduler'", "'service', 'worker'",
    "'service', 'panel'", "'service', 'rider_contracts'",
  ]) assert.ok(health.includes(service), `falta el servicio ${service}`);
});

test('la agenda y pg_net se consultan por nombre para que su ausencia sea un estado', () => {
  assert.match(health, /to_regclass\('cron\.job'\) is not null/);
  assert.match(health, /execute \$cron\$/);
  assert.match(health, /'installed', v_cron_present/);
});

test('los contratos del Rider se verifican por privilegio, no por fe', () => {
  assert.match(health, /has_function_privilege\('authenticated', to_regprocedure\('public\.' \|\| required\.signature\), 'execute'\)/);
  assert.match(health, /has_function_privilege\('anon', to_regprocedure\('public\.' \|\| exposed\.signature\), 'execute'\)/);
  for (const rpc of [
    'get_rider_queue(uuid)', 'claim_delivery_order(uuid,text,bigint,text)',
    'confirm_delivery_code(uuid,bigint,text,text)', 'get_active_rider_delivery()',
  ]) assert.ok(health.includes(`('${rpc}')`), `falta el contrato ${rpc}`);
});

test('recrear get_rider_queue restituye su postura de privilegios', () => {
  // El `drop` hace replayable la cadena; sin el revoke posterior, recrear la
  // función la devolvería al default de PostgreSQL: EXECUTE para PUBLIC.
  assert.match(qaOrigin, /drop function if exists public\.get_rider_queue\(uuid\);/);
  assert.match(qaOrigin, /revoke all on function public\.get_rider_queue\(uuid\) from public, anon;[\s\S]{0,200}grant execute on function public\.get_rider_queue\(uuid\) to authenticated;/);
});

test('todo número comercial excluye los pedidos de prueba y lo declara', () => {
  for (const sql of [dashboard, report]) {
    assert.match(sql, /'excludes', 'qa'/);
    assert.match(sql, /o\.origin = 'production'/);
  }
  assert.match(dashboard, /'qa_orders_excluded'/);
  assert.match(report, /'qa_orders_excluded'/);
  // Los pagos se filtran por el origen de su checkout: el intento no lo lleva.
  assert.match(dashboard, /join public\.checkout_sessions s on s\.id = pi\.checkout_session_id[\s\S]{0,200}s\.origin = 'production'/);
});

test('el tablero cubre las catorce señales que el piloto tiene que ver', () => {
  for (const key of [
    "'orders',", "'revenue_booked'", "'ticket_average'", "'open_by_state'",
    "'approved_today'", "'pending'", "'failed_today'", "'approved_without_order'",
    "'paid_checkouts_without_order'", "'amount_mismatch'", "'unaccepted_orders'",
    "'ready_without_rider'", "'delayed_deliveries'", "'riders_without_signal'",
    "'dead_letter'", "'expired_reservations'", "'low'", "'out_of_stock'",
    "'alerts'", "'last_activity'", "'health'",
  ]) assert.ok(dashboard.includes(key), `falta la señal ${key}`);
});

test('el ticket promedio es null sin pedidos, no cero', () => {
  // Dividir por cero devuelve un número; no dividir devuelve la verdad.
  assert.match(dashboard, /'ticket_average', case when live\.billable > 0[\s\S]{0,160}else null end/);
  assert.match(report, /'ticket_average', case when count\(\*\) filter[\s\S]{0,400}?else null end/);
  assert.doesNotMatch(report, /'ticket_average', coalesce/);
});

test('los umbrales viajan con su procedencia y se validan al configurarlos', () => {
  assert.match(health, /'source', case when b\.low_stock_threshold is null then 'default' else 'business' end/);
  assert.match(health, /if coalesce\(p_thresholds, '\{\}'::jsonb\) - v_allowed <> '\{\}'::jsonb then[\s\S]{0,120}umbral desconocido/);
  assert.match(health, /v_raw !~ '\^\[0-9\]\{1,5\}\$'[\s\S]{0,120}umbral invalido/);
});

test('las alertas nuevas cubren las condiciones que el piloto rompe todos los días', () => {
  for (const code of [
    'ORDER_NOT_ACCEPTED', 'ORDER_READY_WITHOUT_RIDER', 'DELIVERY_OVERDUE',
    'CHECKOUT_PAID_WITHOUT_ORDER', 'PAYMENT_AMOUNT_MISMATCH', 'LOW_STOCK',
    'STOCK_RESERVATION_EXPIRED', 'WEBHOOK_SIGNATURE_REJECTED', 'WEBHOOK_PROCESSING_FAILED',
    'NOTIFICATION_OUTBOX_STALLED', 'RIDER_SIGNAL_STALE', 'PAYMENT_APPROVED_WITHOUT_ORDER',
    'PAYMENT_OUTBOX_STALLED', 'FISCAL_OUTBOX_STALLED', 'FISCAL_AUTHORIZATION_AMBIGUOUS',
    'FISCAL_ARTIFACT_STALLED', 'PRINT_JOB_FAILED', 'PAYMENT_RECONCILIATION_REQUIRED',
  ]) assert.ok(alerts.includes(`'${code}'`), `falta el detector ${code}`);
});

test('las condiciones masivas emiten una alerta agregada, no una por fila', () => {
  // Cuarenta productos bajo mínimo tienen que ser una alerta con cuarenta
  // adentro, no cuarenta alertas que tapan todo lo demás.
  assert.match(alerts, /'LOW_STOCK', 'inventory',\s*\n\s*null::uuid, null::uuid/);
  assert.match(alerts, /'STOCK_RESERVATION_EXPIRED', 'inventory',\s*\n\s*null::uuid, null::uuid/);
  assert.match(alerts, /'WEBHOOK_SIGNATURE_REJECTED', 'webhook',\s*\n\s*null::uuid, null::uuid/);
  assert.match(alerts, /rank <= 10/);
});

test('una alerta reconocida no vuelve a gritar mientras la condición siga', () => {
  assert.match(alerts, /status = case when operational_alerts\.status = 'resolved' then 'open' else operational_alerts\.status end/);
  // El evento de auditoría sólo se escribe al cambiar de estado o tras 15 min.
  assert.match(alerts, /or v_previous_seen < clock_timestamp\(\) - interval '15 minutes' then/);
  assert.match(alerts, /operational_alerts\.last_seen_at < clock_timestamp\(\) - interval '1 minute' then 1 else 0 end/);
});

test('los sujetos QA quedan fuera de la bandeja y su cierre queda auditado', () => {
  assert.match(alerts, /cs\.origin = 'production'/);
  assert.match(alerts, /'Sujeto de origen QA: queda fuera de la operación real\.'/);
  assert.match(alerts, /insert into public\.operational_alert_events \(business_id, alert_id, event_type, detail\)/);
  assert.match(alerts, /'qa_subject_excluded'/);
});

test('la traza no expone PII ni secretos', () => {
  assert.match(trace, /'pii_included', false/);
  // Se mira el código, no los comentarios: el encabezado nombra a propósito los
  // campos que NO se leen, y esa mención no puede hacer fallar la prueba.
  const code = trace.replace(/--.*$/gm, '');
  for (const forbidden of [
    'customer_name', 'customer_phone', 'customer_whatsapp', 'delivery_street',
    'delivery_latitude', 'delivery_longitude', 'payer_email_hash', 'tracking_token',
    'delivery_code', 'address_label', 'contact_snapshot', 'address_snapshot',
  ]) assert.ok(!code.includes(forbidden), `la traza no puede leer ${forbidden}`);
  // La cronología publica el tipo de evento y el rol, nunca el mensaje libre.
  assert.match(code, /'type', coalesce\(e\.event_type, e\.type\)/);
  assert.ok(!code.includes('e.message'), 'el mensaje del evento puede llevar texto libre');
  // El id del rider identifica a una persona: se informa si hay rider, no cuál.
  assert.match(code, /'rider_assigned', v_order\.assigned_rider_user_id is not null/);
  assert.ok(!/'rider_user_id'|'assigned_rider_user_id',/.test(code), 'el id del rider no se publica');
});

test('la traza recorre las ocho etapas del circuito y señala una sola ruptura', () => {
  for (const stage of [
    "'stage', 'storefront'", "'stage', 'checkout'", "'stage', 'payment'",
    "'stage', 'provider_notice'", "'stage', 'order'", "'stage', 'panel'",
    "'stage', 'rider'", "'stage', 'delivery'",
  ]) assert.ok(trace.includes(stage), `falta la etapa ${stage}`);
  assert.match(trace, /where stage_row\.value ->> 'status' in \('failed', 'stalled', 'missing'\)/);
  assert.match(trace, /limit 1;/);
});

test('la traza acepta código público, correlation id y sesión de checkout', () => {
  assert.match(trace, /upper\(o\.public_code\) = upper\(v_reference\)/);
  assert.match(trace, /o\.id = v_uuid or o\.correlation_id = v_uuid/);
  assert.match(trace, /s\.id = v_uuid or s\.correlation_id = v_uuid/);
});

test('el reporte se niega a coronar un más vendido sin muestra suficiente', () => {
  assert.match(report, /v_min_orders constant integer := 20;/);
  assert.match(report, /v_min_units constant integer := 10;/);
  assert.match(report, /'best_seller', case\s*\n\s*when v_period_orders >= v_min_orders and coalesce\(\(select max\(units\) from sold\), 0\) >= v_min_units/);
  assert.match(report, /else null end/);
  assert.match(report, /Muestra insuficiente: se informan las cantidades, no un más vendido/);
});

test('los tiempos del reporte usan percentiles y declaran su muestra', () => {
  for (const metric of ['acceptance_minutes', 'preparation_minutes', 'delivery_minutes', 'end_to_end_minutes']) {
    assert.ok(report.includes(`'${metric}'`), `falta el tiempo ${metric}`);
  }
  assert.match(report, /percentile_cont\(0\.5\) within group/);
  assert.match(report, /percentile_cont\(0\.9\) within group/);
  assert.match(report, /'sample', count\(\*\) filter/);
  // Un promedio simple dejaría que un pedido de tres horas mueva la medida.
  assert.doesNotMatch(report, /avg\(extract\(epoch/);
});

test('el reporte no transcribe el motivo de cancelación escrito a mano', () => {
  assert.match(report, /'documented_reason'/);
  assert.ok(!report.includes("metadata ->> 'reason'"), 'el motivo es texto libre y no se publica');
});

test('el reporte informa el stock como foto del instante, no del período', () => {
  assert.match(report, /'note', 'El stock es una foto del instante de la consulta, no del período\.'/);
  assert.match(report, /'measured_at', v_now/);
});

function escape(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
