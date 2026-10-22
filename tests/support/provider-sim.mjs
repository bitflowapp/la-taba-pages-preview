// A stateful Mercado Pago simulator: SIMULATED provider, never a real one. It answers the exact paths the adapter
// uses and can inject faults (5xx, timeouts, lost responses) so recovery code can be driven deterministically.
export class ProviderSim {
  constructor({ collectorId = 'collector-retry' } = {}) {
    this.collectorId = collectorId;
    this.payments = new Map();
    this.merchantOrders = new Map();
    this.refunds = new Map(); // paymentId -> [{id, amount, status, date_created}]
    this.faults = []; // {match: RegExp, status, times}
    this.calls = [];
    this.clock = Date.now() - 3_600_000; // events happened in the past, like a real ledger
  }

  tick(ms = 1000) { this.clock += ms; return new Date(this.clock).toISOString(); }

  addPayment({ id, reference, status = 'approved', amount = 2500, order = `mo-${id}`, preference = 'FORENSIC-PREF', created, collector, refunds = [] }) {
    const date = created || this.tick();
    this.payments.set(String(id), {
      id: Number(id), external_reference: reference, status, status_detail: status === 'approved' ? 'accredited' : 'cc_rejected_other_reason',
      transaction_amount: amount, currency_id: 'ARS', collector_id: collector || this.collectorId, date_created: date,
      date_last_updated: date, live_mode: true, payment_method_id: 'visa', order: { id: order }, payer: { email: 'buyer@example.invalid' },
      refunds: refunds.map(r => ({ ...r })),
    });
    this.merchantOrders.set(String(order), { id: order, preference_id: preference });
    return this.payments.get(String(id));
  }

  setStatus(id, status) { const p = this.payments.get(String(id)); p.status = status; p.date_last_updated = this.tick(); }

  addRefundTo(paymentId, refund) {
    const p = this.payments.get(String(paymentId));
    p.refunds.push({ status: 'approved', date_created: this.tick(), ...refund });
    p.date_last_updated = this.tick();
  }

  failNext(match, status = 503, times = 1) { this.faults.push({ match, status, times }); }

  fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const method = (init.method || 'GET').toUpperCase();
    this.calls.push({ method, path });
    if (url.hostname !== 'api.mercadopago.com') throw new Error('Unexpected host ' + url.hostname);
    const fault = this.faults.find(f => f.times > 0 && f.match.test(path));
    if (fault) { fault.times -= 1; return Response.json({ message: 'injected fault' }, { status: fault.status }); }
    if (url.pathname === '/v1/payments/search') {
      const reference = url.searchParams.get('external_reference');
      const begin = url.searchParams.get('begin_date');
      const end = url.searchParams.get('end_date');
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || 30);
      let all = [...this.payments.values()].filter(p => p.collector_id === this.collectorId);
      if (reference) all = all.filter(p => p.external_reference === reference);
      if (begin) all = all.filter(p => Date.parse(p.date_created) >= Date.parse(begin));
      if (end) all = all.filter(p => Date.parse(p.date_created) <= Date.parse(end));
      all.sort((a, b) => Date.parse(a.date_created) - Date.parse(b.date_created) || a.id - b.id);
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
