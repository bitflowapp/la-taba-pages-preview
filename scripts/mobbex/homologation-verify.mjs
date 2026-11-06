#!/usr/bin/env node
/**
 * Verificador de EVIDENCIA de la homologación Mobbex de La Taba (sólo lectura).
 *
 * No paga, no devuelve, no escribe y no habla con Mobbex: lee la base del entorno de PRUEBA (staging) del comercio ya homologado y
 * decide, con criterios escritos, si la evidencia que dejaron los pasos manuales alcanza. Los pasos manuales están en
 * docs/payments/mobbex/HOMOLOGACION.md.
 *
 *   MOBBEX_VERIFY_DB_URL=postgresql://... node scripts/mobbex/homologation-verify.mjs --business <uuid> [--json]
 *
 * La URL de la base viene del entorno, nunca se imprime y se abre en modo sólo lectura (`default_transaction_read_only=on`). Si la
 * base apunta a producción (el comercio configurado en `production`), el veredicto es FAIL: esta verificación es sólo para sandbox.
 * Necesita `psql` en el PATH. Código de salida: 0 = APROBADA, 1 = hay algún FAIL, 3 = faltan evidencias (INCOMPLETA), 2 = uso.
 *
 * La evaluación (`evaluateHomologation`) es una función pura y está probada en tests/mobbex-homologation.test.mjs con instantáneas
 * sintéticas; esto NO es una certificación hasta que se corra contra una cuenta propia con pagos de prueba reales.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money = (value) => (value === null || value === undefined ? null : Math.round(Number(value) * 100));

export const SNAPSHOT_SQL = (business) => `select jsonb_build_object(
  'settings', (select to_jsonb(s) - 'changed_by' from public.mobbex_business_settings s where s.business_id = '${business}'),
  'intents', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'environment', i.environment, 'internal_status', i.internal_status,
      'expected_amount', i.expected_amount, 'paid_amount', i.paid_amount, 'refunded_amount', i.refunded_amount, 'order_id', i.order_id,
      'provider_payment_id_set', i.provider_payment_id is not null, 'review_reason', i.review_reason, 'attention_reason', i.attention_reason,
      'created_at', i.created_at) order by i.created_at desc)
    from (select * from public.mobbex_payment_intents where business_id = '${business}' order by created_at desc limit 200) i), '[]'::jsonb),
  'refunds', coalesce((select jsonb_agg(jsonb_build_object('payment_intent_id', r.payment_intent_id, 'status', r.status, 'amount', r.amount))
    from public.mobbex_refunds r join public.mobbex_payment_intents i on i.id = r.payment_intent_id where i.business_id = '${business}'), '[]'::jsonb),
  'events', coalesce((select jsonb_object_agg(event_type, n) from (select e.event_type, count(*) n from public.mobbex_payment_events e
      join public.mobbex_payment_intents i on i.id = e.payment_intent_id where i.business_id = '${business}' group by 1) t), '{}'::jsonb),
  'receipts', (select count(*) from public.mobbex_webhook_receipts w join public.mobbex_payment_intents i on i.id = w.payment_intent_id where i.business_id = '${business}'),
  'dead_letter_jobs', (select count(*) from public.mobbex_jobs j join public.mobbex_payment_intents i on i.id = j.payment_intent_id where i.business_id = '${business}' and j.status = 'dead_letter'),
  'health', public.mobbex_pipeline_health()
)::text`;

// pg_cron puede no existir (bases locales sin la extensión): se consulta aparte y sólo si la tabla está.
export const CRON_EXISTS_SQL = "select to_regclass('cron.job') is not null";
export const CRON_SQL = "select coalesce(jsonb_agg(jsonb_build_object('jobname', jobname, 'active', active)), '[]'::jsonb)::text from cron.job where jobname like '%mobbex%'";

const OK_STATUSES = new Set(['completed', 'partially_refunded', 'refunded']);

/**
 * @param {object} snapshot resultado de SNAPSHOT_SQL
 * @param {{ requireCron?: boolean }} [options] en staging el cron del worker tiene que estar programado
 */
export function evaluateHomologation(snapshot, { requireCron = true } = {}) {
  const checks = [];
  const add = (id, title, status, detail) => checks.push({ id, title, status, detail });
  const settings = snapshot?.settings || null;
  const intents = Array.isArray(snapshot?.intents) ? snapshot.intents : [];
  const refunds = Array.isArray(snapshot?.refunds) ? snapshot.refunds : [];
  const events = snapshot?.events || {};

  // 1. Identidad del titular y entorno
  if (!settings) add('H01', 'Comercio configurado para Mobbex', 'FAIL', 'no hay fila en mobbex_business_settings');
  else {
    add('H01', 'Comercio configurado para Mobbex', 'PASS', `environment=${settings.environment}, enabled=${settings.enabled}`);
    add('H02', 'Entorno de PRUEBA (nunca producción en una homologación)', settings.environment === 'test' ? 'PASS' : 'FAIL', `environment=${settings.environment}`);
    add('H03', 'Entidad Mobbex del titular registrada (entity_uid) y cobros atados a ella', settings.entity_uid ? 'PASS' : 'FAIL',
      settings.entity_uid ? 'entity_uid cargado' : 'sin entity_uid: el control entity_mismatch está apagado');
  }
  // 2. Segregación: nada de otro entorno en este comercio
  const foreign = intents.filter((i) => i.environment !== (settings?.environment || 'test'));
  add('H04', 'Segregación de entornos: ningún cobro de otro entorno', foreign.length === 0 ? 'PASS' : 'FAIL', `${foreign.length} cobro(s) de otro entorno`);
  // 3. Pagos
  const approved = intents.filter((i) => OK_STATUSES.has(i.internal_status) && i.paid_amount !== null);
  const rejected = intents.filter((i) => i.internal_status === 'rejected' || i.internal_status === 'failed');
  const pending = intents.filter((i) => ['pending', 'in_process', 'checkout_created'].includes(i.internal_status) || i.internal_status === 'expired');
  add('H05', 'Pago APROBADO con tarjeta oficial de prueba: pedido creado y cobro = importe del servidor',
    approved.length === 0 ? 'PENDING'
      : approved.every((i) => i.order_id && money(i.paid_amount) === money(i.expected_amount)) ? 'PASS' : 'FAIL',
    `${approved.length} aprobado(s); ${approved.filter((i) => !i.order_id).length} sin pedido; ${approved.filter((i) => money(i.paid_amount) !== money(i.expected_amount)).length} con importe distinto`);
  add('H06', 'Pago RECHAZADO sin pedido ni stock retenido', rejected.length === 0 ? 'PENDING' : rejected.some((i) => i.order_id || i.paid_amount) ? 'FAIL' : 'PASS', `${rejected.length} rechazado(s)`);
  add('H07', 'Pago PENDIENTE (o vencido) sin pedido', pending.length === 0 ? 'PENDING' : pending.some((i) => i.order_id || i.paid_amount) ? 'FAIL' : 'PASS', `${pending.length} pendiente(s)/vencido(s)`);
  // 4. Confirmación autenticada y webhook
  add('H08', 'Confirmación por consulta autenticada registrada (eventos payment.*)', Number(events['payment.approved']) > 0 ? 'PASS' : approved.length ? 'FAIL' : 'PENDING',
    `eventos: ${Object.keys(events).filter((k) => k.startsWith('payment.')).join(', ') || 'ninguno'}`);
  add('H09', 'Avisos (webhook) recibidos y autenticados con el token propio', Number(snapshot?.receipts) > 0 ? 'PASS' : 'PENDING', `${Number(snapshot?.receipts) || 0} aviso(s) registrados`);
  // 5. Devolución
  const refundOk = refunds.filter((r) => r.status === 'approved');
  const refundedIntents = intents.filter((i) => Number(i.refunded_amount) > 0);
  add('H10', 'Devolución de prueba autorizada y confirmada por Mobbex', refundOk.length === 0 ? 'PENDING'
    : refundOk.every((r) => refundedIntents.some((i) => i.id === r.payment_intent_id)) ? 'PASS' : 'FAIL', `${refundOk.length} devolución(es) aprobada(s)`);
  add('H11', 'Ninguna devolución quedó sin resolver', refunds.some((r) => ['requested', 'processing', 'ambiguous'].includes(r.status)) ? 'FAIL' : 'PASS',
    `${refunds.filter((r) => ['requested', 'processing', 'ambiguous'].includes(r.status)).length} sin resolver`);
  add('H12', 'Auditoría de la devolución (refund.requested en el libro de eventos)', refunds.length === 0 ? 'PENDING' : Number(events['refund.requested']) > 0 ? 'PASS' : 'FAIL', `refund.requested=${Number(events['refund.requested']) || 0}`);
  // 6. Operación
  const attention = intents.filter((i) => i.attention_reason || i.review_reason);
  add('H13', 'Sin cobros en revisión ni con atención abierta', attention.length === 0 ? 'PASS' : 'FAIL', `${attention.length} con motivo abierto`);
  add('H14', 'Conciliación sana: sin trabajos agotados y salud sin alarma', Number(snapshot?.dead_letter_jobs) === 0 && snapshot?.health?.needs_attention === false ? 'PASS' : 'FAIL',
    `dead_letter=${Number(snapshot?.dead_letter_jobs) || 0}, needs_attention=${snapshot?.health?.needs_attention}`);
  const cron = Array.isArray(snapshot?.cron) ? snapshot.cron : [];
  add('H15', 'Cron del worker programado y activo en STAGING', !requireCron ? 'PASS' : cron.length === 0 ? 'PENDING' : cron.every((c) => c.active) ? 'PASS' : 'FAIL', `${cron.length} trabajo(s) cron de Mobbex`);

  const failed = checks.filter((c) => c.status === 'FAIL');
  const pendingChecks = checks.filter((c) => c.status === 'PENDING');
  const verdict = failed.length ? 'REJECTED' : pendingChecks.length ? 'INCOMPLETE' : 'APPROVED';
  return { verdict, failed: failed.map((c) => c.id), pending: pendingChecks.map((c) => c.id), checks,
    note: 'Evidencia de SANDBOX. No habilita producción: eso exige además KYC, credenciales y autorización del titular.' };
}

function main() {
  const args = process.argv.slice(2);
  const business = args[args.indexOf('--business') + 1] || '';
  const url = process.env.MOBBEX_VERIFY_DB_URL || '';
  if (!UUID.test(business) || !url) { console.error('Uso: MOBBEX_VERIFY_DB_URL=... node scripts/mobbex/homologation-verify.mjs --business <uuid> [--json]'); process.exit(2); }
  const query = (input) => {
    const run = spawnSync('psql', [url, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      input, encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' }, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    });
    if (run.status !== 0) { console.error(`psql falló (${String(run.stderr).split('\n')[0].replace(/postgres(ql)?:\/\/\S+/gi, '<url>')})`); process.exit(2); }
    return run.stdout.trim().split('\n').pop();
  };
  const snapshot = JSON.parse(query(SNAPSHOT_SQL(business)));
  snapshot.cron = query(CRON_EXISTS_SQL) === 't' ? JSON.parse(query(CRON_SQL)) : [];
  const report = evaluateHomologation(snapshot);
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    for (const check of report.checks) console.log(`${check.status.padEnd(7)} ${check.id} ${check.title} — ${check.detail}`);
    console.log(`\nVEREDICTO: ${report.verdict}${report.failed.length ? ` (fallan ${report.failed.join(', ')})` : ''}${report.pending.length ? ` (pendientes ${report.pending.join(', ')})` : ''}\n${report.note}`);
  }
  process.exit(report.verdict === 'APPROVED' ? 0 : report.verdict === 'REJECTED' ? 1 : 3);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
