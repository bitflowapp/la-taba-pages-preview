// FASE performance — latencia de las operaciones del e-commerce, medida en el cliente, con carga controlada.
//
// Ocho operaciones, las llamadas que hacen de verdad la tienda, las Edge Functions y el Panel:
//
//   catalog_read          anon         la consulta de góndola de la tienda
//   order_creation_cash   cliente      create_order_with_items en efectivo: valida, pasa el guardián de
//                                      admisión, descuenta el stock y crea el pedido en UNA transacción
//                                      (es el «stock commit» de la puerta en efectivo)
//   order_query           cliente      el historial de la tienda: sus pedidos con renglones
//   tracking_query        anon+token   get_public_order_tracking con el token del pedido
//   panel_query           operador     la bandeja del Panel (la consulta del repositorio de pedidos)
//   checkout_creation     servicio     create_checkout_session: la sesión de Mercado Pago, con stock reservado
//   payment_intent        servicio     prepare_mercadopago_preference_v2: el intento de cobro
//   stock_commit_paid     servicio     finalize_paid_checkout_session: la reserva se convierte en pedido
//
// Las tres de servicio son la cadena que maneja la Edge Function DESPUÉS de hablar con el
// proveedor (`payments.mjs`): nunca se llama a Mercado Pago.
//
// Cada operación se mide en una línea de base en serie y en cada nivel de concurrencia que
// admite el destino (10, 30 y 100; en Staging, que es compartido, sólo 10 y 30). Después de
// cada paso que mueve stock se afirma la conservación EXACTA del producto de carga: stock +
// reservado por sesiones vivas + unidades en pedidos que no las devolvieron = lo del
// principio. Un error en cualquier request de carga es un FAIL, no una muestra de menos.
//
// LA COMPUERTA no inventa números: lee los techos del destino en el archivo versionado
// (`load.mjs`, THRESHOLDS_FILE). Sin techos para el destino, la fase mide, contesta
// MEASURED_NO_GATE y deja en performance.json el bloque propuesto con la regla escrita.
import { performance as clock } from 'node:perf_hooks';
import path from 'node:path';
import { STAGING_ROLE_SETTINGS, nowIso } from '../env.mjs';
import { brief, pool } from '../http.mjs';
import { GATE, THRESHOLDS_FILE, THRESHOLD_RULE, evaluateGate, proposeThresholds, readThresholds, roleTimeouts, runStep, stepName, stepResult } from '../load.mjs';
import { customerHistoryQuery, storefrontCatalogQuery } from '../orders.mjs';
import { BUSINESS_INBOX_DATABASE_STATUSES } from '../../../../js/core/business-order-intake.js';

const P = 'performance';
const ROOT = path.resolve(import.meta.dirname, '../../../..');
// Con qué rol llama cada operación: el techo propuesto nunca supera el `statement_timeout` de ese rol.
export const OPERATIONS = Object.freeze({ catalog_read: 'anon', order_creation_cash: 'authenticated', order_query: 'authenticated', tracking_query: 'anon',
  panel_query: 'authenticated', checkout_creation: 'service_role', payment_intent: 'service_role', stock_commit_paid: 'service_role' });
const PAID_OPERATIONS = Object.freeze(['checkout_creation', 'payment_intent', 'stock_commit_paid']);
// Requests por ítem de un paso: cinco lecturas/escrituras sueltas y la cadena de pago (sesión, intento, autoridad,
// preferencia, aviso, finalización).
const CALLS_PER_ITEM = 5 + 6;
const strip = ({ answers, ...rest }) => rest;

export default {
  id: P,
  title: 'rendimiento: p50/p95/p99 por operación en serie y con concurrencia controlada, stock conservado tras cada paso, compuerta por umbrales versionados',
  requires: [],
  async run(ctx) {
    const C = ctx.rec.check;
    const id = ctx.tenant.id;
    const target = ctx.env.target;
    const profile = target.load;
    const { staff } = ctx.actors;
    const product = ctx.orders.product('PERF');
    const levels = [1, ...profile.levels];
    const maxLevel = Math.max(...profile.levels);
    const sizeOf = (concurrency) => (concurrency === 1 ? profile.baselineSamples : profile.requestsPerLevel(concurrency));
    const planned = levels.reduce((sum, concurrency) => sum + sizeOf(concurrency) * CALLS_PER_ITEM, 0);
    // El plan entero tiene que caber en el presupuesto del destino ANTES de mandar una sola request de carga.
    ctx.budget.take(planned);
    const notes = [];
    if (profile.note) notes.push(profile.note);
    if (!target.canChooseOrigin) notes.push('un solo origen de red para toda la carga: los pedidos manuales esperan el candado de admisión de ese origen (en producción cada cliente trae el suyo)');
    if (target.kind === 'local') notes.push('destino local: a lo sumo 16 requests a la vez dentro de PostgREST; la espera por un lugar entra en la latencia medida');

    // ── Quiénes cargan ────────────────────────────────────────────────────────
    // Un cliente distinto por request simultánea (el candado de admisión es por cliente) y, donde el origen se
    // puede declarar, un origen por cliente (el guardián también toma un candado por origen).
    ctx.log(`performance: ${maxLevel} clientes y ${ctx.caps.checkout_payments ? Math.min(profile.payers, maxLevel) : 0} pagadores para la carga; plan de ${planned} requests`);
    const crowd = await ctx.identities.crowd('perf', maxLevel);
    const payers = ctx.caps.checkout_payments ? await ctx.identities.payers(Math.min(profile.payers, maxLevel), { signIn: false }) : [];
    if (payers.length) await ctx.payments.ensureFixture();
    const originFor = (index) => (target.canChooseOrigin ? { origin: target.originOf(`perf-${index}`) } : {});
    const catalog = storefrontCatalogQuery(id);
    const panelQuery = `orders?select=*,order_items(*),order_combos(*)&business_id=eq.${id}&origin=eq.production`
      + `&status=in.(${BUSINESS_INBOX_DATABASE_STATUSES.join(',')})&order=created_at.asc,id.asc&limit=501`;
    const units = () => ctx.orders.unitsOf(product.id);
    const total = (u) => Number(u.stock) + Number(u.reserved) + Number(u.in_orders);
    const start = await units();
    const conservation = [];
    const conserve = async (after) => {
      const u = await units();
      const entry = { after, stock: u.stock, reserved: u.reserved, inOrders: u.in_orders, total: total(u), expected: total(start), exact: total(u) === total(start) && Number(u.stock) >= 0 };
      conservation.push(entry);
      return entry;
    };
    const tracked = [];
    const breaks = [];

    // La cadena de la Edge Function para UN pago, con la respuesta de cada operación medida.
    const paidChain = async (payer, label) => {
      const out = { checkout_creation: null, payment_intent: null, stock_commit_paid: null };
      const created = await ctx.payments.createSession(payer, { role: 'PERF', quantity: 1, label, quiet: true });
      out.checkout_creation = created.r;
      if (!created.session) return out;
      const redirected = await ctx.payments.redirect(created.session);
      out.payment_intent = redirected.prepared ?? (redirected.step === 'prepare' ? redirected.r : null);
      if (!redirected.ok) { if (redirected.step !== 'prepare') breaks.push({ label, step: redirected.step, ...brief(redirected.r) }); return out; }
      const approved = await ctx.payments.snapshot(created.session, 'approved');
      if (!approved.ok || approved.data?.finalize_required !== true) { breaks.push({ label, step: 'snapshot', ...brief(approved) }); return out; }
      out.stock_commit_paid = await ctx.payments.finalize(created.session);
      return out;
    };

    const results = [];
    for (const concurrency of levels) {
      const n = sizeOf(concurrency);
      const items = Array.from({ length: n }, (_, index) => index);
      const step = stepName(concurrency);
      const run = async (operation, task) => {
        const result = strip(await runStep({ operation, concurrency, items, task, maxConcurrency: profile.maxConcurrency }));
        results.push(result);
        ctx.log(`performance ${step} ${operation}: n=${result.requests} p50=${result.p50} p95=${result.p95} p99=${result.p99} errores=${result.errors}`);
        return result;
      };
      await run('catalog_read', () => ctx.http.restGet(null, catalog));
      await run('order_creation_cash', async (index) => {
        const customer = crowd[index % crowd.length];
        const created = await ctx.orders.create(customer, { mode: 'pickup', role: 'PERF', quantity: 1, label: `perf-${step}`, quiet: true, call: originFor(index % crowd.length) });
        if (created.order) tracked.push({ code: created.order.public_code, token: created.token });
        return created.r;
      });
      await conserve(`order_creation_cash:${step}`);
      await run('order_query', (index) => ctx.http.restGet(crowd[index % crowd.length], customerHistoryQuery(id)));
      if (tracked.length) await run('tracking_query', (index) => { const t = tracked[index % tracked.length]; return ctx.orders.tracking(t.code, t.token); });
      await run('panel_query', () => ctx.http.restGet(staff, panelQuery));
      if (payers.length) {
        const started = clock.now();
        const chains = await pool(items, Math.min(concurrency, n), (index) => paidChain(payers[index % payers.length], `perf-${step}`), profile.maxConcurrency);
        const wallMs = clock.now() - started;
        for (const operation of PAID_OPERATIONS) {
          const result = stepResult({ operation, concurrency, answers: chains.map((chain) => chain[operation]), wallMs, peak: chains.peak });
          results.push(result);
          ctx.log(`performance ${step} ${operation}: n=${result.requests} p50=${result.p50} p95=${result.p95} p99=${result.p99} errores=${result.errors}`);
        }
        await conserve(`paid_path:${step}`);
      }
      ctx.persist();
    }

    // ── Lo que dice la carga ──────────────────────────────────────────────────
    const errors = results.filter((r) => r.errors > 0).map((r) => ({ operation: r.operation, step: r.step, errors: r.errors, statuses: r.statuses }));
    // Sin el contrato de pagos desplegado la cadena de pago no se mide (y la compuerta, si tiene techos para ella, lo dice).
    const expectedOperations = Object.keys(OPERATIONS).filter((operation) => !PAID_OPERATIONS.includes(operation) || payers.length > 0);
    const missing = expectedOperations.filter((operation) => !results.some((r) => r.operation === operation && r.ok > 0));
    C(P, 'EVERY_LOAD_REQUEST_IS_ANSWERED_WITHOUT_ERROR', errors.length === 0 && breaks.length === 0 && missing.length === 0,
      { errors, chainBreaks: breaks.slice(0, 10), operationsWithoutAGoodAnswer: missing, requests: results.reduce((sum, r) => sum + r.requests, 0) },
      'ninguna respuesta de error en ningún paso, ninguna cadena de pago cortada, y las ocho operaciones medidas');
    C(P, 'STOCK_IS_CONSERVED_EXACTLY_AFTER_EVERY_LOAD_STEP', conservation.length > 0 && conservation.every((entry) => entry.exact),
      conservation.filter((entry) => !entry.exact).length ? conservation.filter((entry) => !entry.exact) : { steps: conservation.length, conserved: total(start) },
      'stock + reservado + en pedidos = lo del principio, después de cada paso que mueve stock');

    // ── La compuerta ──────────────────────────────────────────────────────────
    const gateFile = path.join(ROOT, THRESHOLDS_FILE);
    const { found, thresholds } = readThresholds(gateFile, target.kind);
    const gate = evaluateGate(results, thresholds);
    const timeouts = roleTimeouts(ctx.environmentFacts?.roleSettings ?? STAGING_ROLE_SETTINGS);
    const proposed = gate.verdict === GATE.NO_GATE ? proposeThresholds(results, { roles: OPERATIONS, timeouts, runId: ctx.runId, measuredAt: nowIso() }) : null;
    if (gate.verdict === GATE.NO_GATE) {
      ctx.rec.notGated(P, 'PERFORMANCE_IS_WITHIN_THE_COMMITTED_THRESHOLDS',
        `MEASURED_NO_GATE: ${THRESHOLDS_FILE} ${found ? `no tiene umbrales para «${target.kind}»` : 'no existe'}; el bloque propuesto (regla: p95 × ${THRESHOLD_RULE.multiplier}, `
        + `redondeado a ${THRESHOLD_RULE.round_up_to_ms} ms, piso ${THRESHOLD_RULE.floor_ms} ms, tope el statement_timeout del rol) está en performance.json`);
      ctx.log(`performance: MEASURED_NO_GATE — umbrales propuestos para targets.${target.kind}:\n${JSON.stringify(proposed, null, 2)}`);
    } else {
      C(P, 'PERFORMANCE_IS_WITHIN_THE_COMMITTED_THRESHOLDS', gate.verdict === GATE.PASS,
        { verdict: gate.verdict, checked: gate.checked, violations: gate.violations, notMeasured: gate.notMeasured, withoutThreshold: gate.withoutThreshold },
        `cada p95 medido por debajo de su techo en ${THRESHOLDS_FILE} (targets.${target.kind})`);
    }
    ctx.benchmark = {
      benchmark: { target: target.kind, levels, baselineSamples: profile.baselineSamples, requestsPerLevel: Object.fromEntries(profile.levels.map((level) => [level, profile.requestsPerLevel(level)])),
        customers: crowd.length, payers: payers.length, originsPerCustomer: target.canChooseOrigin, product: { sku: product.sku, start }, steps: results, conservation, chainBreaks: breaks, notes,
        operations: OPERATIONS },
      gate: { verdict: gate.verdict, thresholdsFile: THRESHOLDS_FILE, target: target.kind, checked: gate.checked, violations: gate.violations, notMeasured: gate.notMeasured,
        withoutThreshold: gate.withoutThreshold, rule: THRESHOLD_RULE, roleTimeoutsMs: timeouts, ...(proposed ? { proposed } : {}) },
    };
    ctx.evidence.write('phase-performance.json', ctx.benchmark);
  },
};
