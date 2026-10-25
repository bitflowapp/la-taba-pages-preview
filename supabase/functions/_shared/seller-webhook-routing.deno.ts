import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.19';
import { resolveSellerWebhookBusiness, WEBHOOK_ROUTING_CANDIDATES } from './seller-webhook-routing.ts';

const APP = '7677852968049976';
const OWNER = '721168650';
const connection = (business: string, seller: string, extra: Record<string, string> = {}) =>
  ({ business_id: business, seller_id: seller, application_id: APP, environment: 'production', status: 'connected', ...extra });
const A = connection('business-a', '4100000101');
const B = connection('business-b', '4100000102');

class ProviderError extends Error {
  constructor(public status: number) { super('Mercado Pago API request failed'); }
}

// Un proveedor como el real: cada pago lo lee sólo el vendedor que lo cobró (otro token recibe 404).
function world(options: { collector?: string; reference?: string; intentBusiness?: string; liveMode?: boolean;
  failFor?: string; payerView?: string; sellers?: Array<ReturnType<typeof connection>> } = {}) {
  const collector = options.collector ?? B.seller_id;
  const sellers = options.sellers ?? [A, B];
  const reads: string[] = [];
  let listed = 0;
  return {
    reads, listed: () => listed,
    dependencies: {
      connectionForSeller: async (seller: string) => sellers.find((row) => row.seller_id === seller) ?? null,
      connectedSellers: async () => { listed += 1; return sellers; },
      paymentForBusiness: async (paymentId: string, business: string) => {
        reads.push(business);
        const reader = sellers.find((row) => row.business_id === business)!;
        if (options.failFor === business) throw new ProviderError(503);
        if (reader.seller_id !== collector && options.payerView !== business) throw new ProviderError(404);
        return { id: Number(paymentId), collector_id: Number(collector), live_mode: options.liveMode ?? true,
          external_reference: options.reference ?? 'taba2:checkout:session-b' };
      },
      intentForReference: async () => ({ business_id: options.intentBusiness ?? sellers.find((row) => row.seller_id === collector)?.business_id ?? 'nobody', environment: 'production' }),
    },
  };
}
const notice = (sellerId: unknown) => ({ signatureValid: true, eventType: 'payment', resourceId: '190000000123', sellerId,
  applicationId: APP, environment: 'production' as const });

Deno.test('ruta habitual: user_id es el vendedor, una sola lectura con su token y sin listar vendedores', async () => {
  const w = world();
  assertEquals(await resolveSellerWebhookBusiness(notice(Number(B.seller_id)), w.dependencies), 'business-b');
  assertEquals(w.reads, ['business-b']);
  assertEquals(w.listed(), 0);
});

Deno.test('R-MKT-1: user_id del dueño de la integradora → se busca entre los vendedores conectados y gana el que cobró', async () => {
  const w = world();
  assertEquals(await resolveSellerWebhookBusiness(notice(OWNER), w.dependencies), 'business-b');
  assertEquals(w.reads, ['business-a', 'business-b']);
  assertEquals(w.listed(), 1);
});

Deno.test('una pista de OTRO vendedor no acredita nada a ese vendedor: el pago queda en quien lo cobró', async () => {
  const w = world();
  assertEquals(await resolveSellerWebhookBusiness(notice(A.seller_id), w.dependencies), 'business-b');
  assertEquals(w.reads, ['business-a', 'business-b']);
});

Deno.test('sin pista o con una pista ilegible también se busca, sin confiar en el cuerpo', async () => {
  for (const hint of [undefined, '', 'abc', 1.5, { id: B.seller_id }]) {
    const w = world();
    assertEquals(await resolveSellerWebhookBusiness(notice(hint), w.dependencies), 'business-b');
  }
});

Deno.test('si nadie cobró ese pago, el aviso se rechaza (y lo encuentran los barridos del proveedor)', async () => {
  const w = world({ collector: '999' });
  await assertRejects(() => resolveSellerWebhookBusiness(notice(OWNER), w.dependencies), Error, 'Provider payment routing mismatch');
  const none = world({ sellers: [] });
  await assertRejects(() => resolveSellerWebhookBusiness(notice(OWNER), none.dependencies), Error, 'Seller connection unavailable');
});

Deno.test('un proveedor que no puede contestar es un reintento, nunca una adivinanza', async () => {
  const w = world({ failFor: 'business-a' });
  await assertRejects(() => resolveSellerWebhookBusiness(notice(OWNER), w.dependencies), ProviderError);
  assertEquals(w.reads, ['business-a']);
});

Deno.test('un token que ve el pago como PAGADOR no es el vendedor: se sigue buscando al cobrador', async () => {
  const w = world({ payerView: 'business-a' });
  assertEquals(await resolveSellerWebhookBusiness(notice(A.seller_id), w.dependencies), 'business-b');
});

Deno.test('el pago cobrado por B con la referencia de un checkout de A sigue siendo un rechazo', async () => {
  const w = world({ intentBusiness: 'business-a' });
  await assertRejects(() => resolveSellerWebhookBusiness(notice(B.seller_id), w.dependencies), Error, 'Payment intent routing mismatch');
});

Deno.test('producción exige live_mode verdadero en el pago leído', async () => {
  const w = world({ liveMode: false });
  await assertRejects(() => resolveSellerWebhookBusiness(notice(B.seller_id), w.dependencies), Error, 'Provider payment routing mismatch');
});

Deno.test('conexiones de otra aplicación, otro entorno o no conectadas no son candidatas', async () => {
  const other = [connection('x', '1', { application_id: '1' }), connection('y', '2', { environment: 'test' }),
    connection('z', '3', { status: 'disconnected' })];
  const w = world({ sellers: [...other, B] });
  assertEquals(await resolveSellerWebhookBusiness(notice(OWNER), w.dependencies), 'business-b');
  assertEquals(w.reads, ['business-b']);
});

Deno.test(`la búsqueda está acotada a ${WEBHOOK_ROUTING_CANDIDATES} vendedores`, async () => {
  const many = Array.from({ length: WEBHOOK_ROUTING_CANDIDATES + 5 }, (_, index) => connection(`business-${index}`, String(5_000_000 + index)));
  const w = world({ sellers: many, collector: many.at(-1)!.seller_id });
  await assertRejects(() => resolveSellerWebhookBusiness(notice(OWNER), w.dependencies), Error, 'Provider payment routing mismatch');
  assertEquals(w.reads.length, WEBHOOK_ROUTING_CANDIDATES);
});

Deno.test('un aviso sin firma válida o que no es de un pago no busca a nadie', async () => {
  const w = world();
  await assertRejects(() => resolveSellerWebhookBusiness({ ...notice(OWNER), signatureValid: false }, w.dependencies), Error, 'Invalid signed payment notification');
  await assertRejects(() => resolveSellerWebhookBusiness({ ...notice(OWNER), eventType: 'merchant_order' }, w.dependencies), Error, 'Invalid signed payment notification');
  assertEquals(w.reads, []);
  assertEquals(w.listed(), 0);
});

Deno.test('la búsqueda alternativa respeta el tiempo de respuesta de Mercado Pago: pasado el presupuesto pide reintento', async () => {
  const many = Array.from({ length: 10 }, (_, index) => connection(`business-${index}`, String(6_000_000 + index)));
  const w = world({ sellers: many, collector: many.at(-1)!.seller_id });
  let now = 0;
  const slow = { ...w.dependencies, paymentForBusiness: async (paymentId: string, business: string) => {
    now += 3_000; // cada lectura tarda 3 s
    return w.dependencies.paymentForBusiness(paymentId, business);
  } };
  await assertRejects(() => resolveSellerWebhookBusiness(notice(OWNER), slow, () => now), Error, 'Seller routing time budget exhausted');
  assertEquals(w.reads.length, 4);
});
