// A stateful Mercado Pago simulator: SIMULATED provider, never a real one. It answers the exact paths the adapter
// uses and can inject faults (5xx, timeouts, lost responses), latency and ledger quirks so recovery code can be
// driven deterministically.
//
// Search semantics follow Mercado Pago's documentation (payments/search): `range` selects the date field the
// begin/end filter applies to (default date_created), `sort`/`criteria` order the rows, `limit` is capped at 50 and
// `offset` has a hard ceiling (10000 in production; `maxOffset` lowers it so a test can reach it cheaply).
export class ProviderSim {
  constructor({ collectorId = 'collector-retry', clock = null, maxOffset = 10000, strictDates = false } = {}) {
    this.collectorId = collectorId;
    this.payments = new Map();
    this.merchantOrders = new Map();
    this.refunds = new Map(); // paymentId -> [{id, amount, status, date_created}]
    this.faults = []; // {match: RegExp, status, times}
    this.latencies = []; // {match: RegExp, ms}
    this.hooks = []; // {match: RegExp, fn(callIndex)} run BEFORE the answer is built
    this.calls = [];
    this.clock = Date.now() - 3_600_000; // events happened in the past, like a real ledger
    this.virtual = clock; // optional VirtualClock advanced by latencies
    this.maxOffset = maxOffset;
    this.strictDates = strictDates;
    this.searches = [];
  }

  tick(ms = 1000) { this.clock += ms; return new Date(this.clock).toISOString(); }

  addPayment({ id, reference, status = 'approved', amount = 2500, order = `mo-${id}`, preference = 'FORENSIC-PREF', created, updated, collector, refunds = [] }) {
    const date = created || this.tick();
    this.payments.set(String(id), {
      id: Number(id), external_reference: reference, status, status_detail: status === 'approved' ? 'accredited' : 'cc_rejected_other_reason',
      transaction_amount: amount, currency_id: 'ARS', collector_id: collector || this.collectorId, date_created: date,
      date_last_updated: updated || date, live_mode: true, payment_method_id: 'visa', order: { id: order }, payer: { email: 'buyer@example.invalid' },
      refunds: refunds.map(r => ({ ...r })),
    });
    this.merchantOrders.set(String(order), { id: order, preference_id: preference });
    return this.payments.get(String(id));
  }

  setStatus(id, status, at) { const p = this.payments.get(String(id)); p.status = status; p.date_last_updated = at || this.tick(); }

  addRefundTo(paymentId, refund, at) {
    const p = this.payments.get(String(paymentId));
    p.refunds.push({ status: 'approved', date_created: at || this.tick(), ...refund });
    p.date_last_updated = at || this.tick();
  }

  failNext(match, status = 503, times = 1) { this.faults.push({ match, status, times }); }
  slow(match, ms) { this.latencies.push({ match, ms }); }
  onCall(match, fn) { this.hooks.push({ match, fn, n: 0 }); }

  fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const method = (init.method || 'GET').toUpperCase();
    this.virtual?.boundary('provider');
    this.calls.push({ method, path });
    if (url.hostname !== 'api.mercadopago.com') throw new Error('Unexpected host ' + url.hostname);
    for (const l of this.latencies) {
      if (!l.match.test(path)) continue;
      // The provider takes `ms` to answer; if the caller's AbortSignal fires first, the call fails like fetch does.
      this.virtual?.advance(l.ms, { stopWhen: () => init.signal?.aborted === true });
      if (init.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    }
    for (const h of this.hooks) if (h.match.test(path)) { h.n += 1; h.fn(h.n, path); }
    const fault = this.faults.find(f => f.times > 0 && f.match.test(path));
    if (fault) { fault.times -= 1; return Response.json({ message: 'injected fault' }, { status: fault.status }); }
    if (url.pathname === '/v1/payments/search') {
      const reference = url.searchParams.get('external_reference');
      const begin = url.searchParams.get('begin_date');
      const end = url.searchParams.get('end_date');
      const range = url.searchParams.get('range') || 'date_created';
      const sort = url.searchParams.get('sort') || 'date_created';
      const criteria = url.searchParams.get('criteria') || 'desc';
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Math.min(Number(url.searchParams.get('limit') || 30), 50);
      this.searches.push({ range, sort, criteria, begin, end, offset, limit, reference });
      if (offset > this.maxOffset) return Response.json({ message: 'offset exceeds the maximum allowed' }, { status: 400 });
      if (!['date_created', 'date_last_updated', 'date_approved', 'money_release_date'].includes(range)) {
        return Response.json({ message: 'invalid range' }, { status: 400 });
      }
      if (this.strictDates) {
        const iso = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}[:][0-9]{2}[:][0-9]{2}[.][0-9]{3}(Z|[+-][0-9]{2}[:][0-9]{2})$/;
        if ((begin && !iso.test(begin)) || (end && !iso.test(end))) return Response.json({ message: 'invalid date format' }, { status: 400 });
      }
      let all = [...this.payments.values()].filter(p => p.collector_id === this.collectorId);
      if (reference) all = all.filter(p => p.external_reference === reference);
      if (begin) all = all.filter(p => Date.parse(p[range]) >= Date.parse(begin));
      if (end) all = all.filter(p => Date.parse(p[range]) <= Date.parse(end));
      const dir = criteria === 'asc' ? 1 : -1;
      all.sort((a, b) => dir * (Date.parse(a[sort]) - Date.parse(b[sort]) || a.id - b.id));
      return Response.json({ paging: { total: all.length, limit, offset }, results: all.slice(offset, offset + limit) });
    }
    let m = /^\/v1\/payments\/(\d+)\/refunds$/.exec(url.pathname);
    if (m && method === 'GET') return Response.json(this.payments.get(m[1])?.refunds || []);
    m = /^\/v1\/payments\/(\d+)$/.exec(url.pathname);
    if (m) {
      const p = this.payments.get(m[1]);
      return p ? Response.json(p) : Response.json({ message: 'not found' }, { status: 404 });
    }
    m = /^\/merchant_orders\/(.+)$/.exec(url.pathname);
    if (m) {
      const mo = this.merchantOrders.get(decodeURIComponent(m[1]));
      return mo ? Response.json(mo) : Response.json({ message: 'not found' }, { status: 404 });
    }
    throw new Error('Unexpected route ' + method + ' ' + path);
  };
}
