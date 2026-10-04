import { assertEquals } from 'jsr:@std/assert@1.0.19';
import { correlateProviderRefund, locateRefundWithLostResponse, refundAmountCents } from './refund-correlation.ts';

const requestedAt = '2026-09-08T12:00:00.000Z';
const old = { id: '10000', payment_id: '90001', amount: 100, status: 'approved', date_created: '2026-09-01T12:00:00.000Z' };
const current = { id: '10001', payment_id: '90001', amount: 100, status: 'approved', date_created: '2026-09-08T12:00:02.000Z' };
const other = { id: '10002', payment_id: '90001', amount: 100, status: 'approved', date_created: '2026-09-08T12:00:03.000Z' };
const local = { amount: 100, requestedAt };
const known = { ...local, paymentId: '90001', providerRefundId: '10001' };
const now = Date.parse('2026-09-08T12:01:00Z');

Deno.test('refund correlation requires durable request identity even with one new refund', () => {
  assertEquals(correlateProviderRefund([current], local, new Set()).kind, 'ambiguous');
});

Deno.test('known refund identity selects the exact resource independently of older refunds', () => {
  assertEquals(correlateProviderRefund([old, current], known, new Set(), now), { kind: 'matched', outcome: current });
});

Deno.test('refund correlation excludes provider IDs associated with other local refunds', () => {
  assertEquals(correlateProviderRefund([old, current], known, new Set(['10001']), now).kind, 'rejected');
});

Deno.test('refund correlation preserves ambiguity when two candidates remain', () => {
  assertEquals(correlateProviderRefund([current, other], local, new Set()), { kind: 'ambiguous' });
});

Deno.test('refund correlation is independent of provider array order', () => {
  const first = correlateProviderRefund([old, current], known, new Set(), now);
  const second = correlateProviderRefund([current, old], known, new Set(), now);
  assertEquals(first, second);
});

Deno.test('known provider refund ID is idempotent and authoritative', () => {
  assertEquals(correlateProviderRefund([other, current], known, new Set(), now), { kind: 'matched', outcome: current });
});

for (const [name, mutation, expected] of [
  ['wrong payment', { payment_id: '90002' }, 'rejected'],
  ['wrong amount', { amount: 200 }, 'rejected'],
  ['missing amount', { amount: null }, 'rejected'],
  ['missing timestamp', { date_created: undefined }, 'ambiguous'],
  ['pre-request', { date_created: '2026-09-08T11:59:00Z' }, 'ambiguous'],
  ['future', { date_created: '2099-01-01T12:00:00Z' }, 'ambiguous'],
  ['missing status', { status: undefined }, 'ambiguous'],
] as const) {
  Deno.test('specific refund validation: ' + name, () => {
    assertEquals(correlateProviderRefund([{ ...current, ...mutation }], known, new Set(), now).kind, expected);
  });
}

Deno.test('same-time unassociated refunds remain ambiguous under concurrent reconciliation', () => {
  const results = Array.from({ length: 2 }, () => correlateProviderRefund([current, other], local, new Set()));
  assertEquals(results, [{ kind: 'ambiguous' }, { kind: 'ambiguous' }]);
});

// ── Búsqueda pedida por una persona de una devolución cuya respuesta se perdió ──
// `correlateProviderRefund` sigue sin elegir nada de una lista (arriba). Esto es
// la otra función, la que sólo corre con `provider_lookup` o antes de un
// reintento autorizado, y aun así exige una única candidata.
const search = { amount: 100, paymentId: '90001', requestedAt };

Deno.test('respuesta perdida: una única candidata del pago, del importe y de la ventana se encuentra', () => {
  assertEquals(locateRefundWithLostResponse([old, current], search, new Set(), now), { kind: 'matched', outcome: current });
});

Deno.test('respuesta perdida: el resultado no depende del orden de la lista', () => {
  assertEquals(
    locateRefundWithLostResponse([current, old], search, new Set(), now),
    locateRefundWithLostResponse([old, current], search, new Set(), now),
  );
});

Deno.test('respuesta perdida: con dos candidatas no se elige ninguna', () => {
  assertEquals(locateRefundWithLostResponse([current, other], search, new Set(), now), { kind: 'ambiguous' });
  assertEquals(locateRefundWithLostResponse([other, current], search, new Set(), now), { kind: 'ambiguous' });
});

Deno.test('respuesta perdida: la devolución de otra solicitud local no es candidata', () => {
  assertEquals(locateRefundWithLostResponse([current], search, new Set(['10001']), now), { kind: 'none' });
  assertEquals(locateRefundWithLostResponse([current, other], search, new Set(['10002']), now), { kind: 'matched', outcome: current });
});

// «No es la de esta solicitud» se dice sólo de un renglón que se pudo LEER y que
// algo descarta: es de otro pago, de otro importe, está rechazado o se creó
// fuera de la ventana del envío.
for (const [name, mutation] of [
  ['otro pago', { payment_id: '90002' }],
  ['otro importe', { amount: 99.99 }],
  ['rechazada', { status: 'rejected' }],
  ['cancelada', { status: 'cancelled' }],
  ['anterior a la solicitud', { date_created: '2026-09-08T11:59:00Z' }],
  ['posterior al plazo del envío', { date_created: '2026-09-08T12:00:43Z' }],
] as const) {
  Deno.test('respuesta perdida: no es candidata si es ' + name, () => {
    assertEquals(locateRefundWithLostResponse([{ ...current, ...mutation }], search, new Set(), now), { kind: 'none' });
  });
}

// Un renglón vivo que NADA descarta pero al que le falta un dato (o lo trae
// ilegible) puede ser la devolución perdida. Contestar «no hay ninguna» dejaba
// salir el reintento: un segundo envío de plata por un renglón que no se supo
// leer. La respuesta es «no se sabe», que no reenvía ni asocia nada.
for (const [name, mutation] of [
  ['sin fecha', { date_created: undefined }],
  ['con la fecha en null', { date_created: null }],
  ['con la fecha como número', { date_created: 1_788_868_805_000 }],
  ['con una fecha ilegible', { date_created: 'ayer a la tarde' }],
  ['sin importe', { amount: null }],
  ['con un importe ilegible', { amount: 'cien' }],
  ['sin identificador', { id: undefined }],
  ['con un identificador que no es del proveedor', { id: 'abc' }],
  ['con un pago ilegible', { payment_id: 'abc' }],
] as const) {
  Deno.test('respuesta perdida: un renglón ' + name + ' que nada descarta no se da por inexistente', () => {
    assertEquals(locateRefundWithLostResponse([{ ...current, ...mutation }], search, new Set(), now), { kind: 'ambiguous' });
    // Tampoco se elige la otra candidata, legible, mientras ese renglón esté sin leer.
    assertEquals(
      locateRefundWithLostResponse([{ ...current, ...mutation }, other], search, new Set(), now),
      { kind: 'ambiguous' },
    );
  });
}

Deno.test('respuesta perdida: a un renglón ilegible lo descarta lo que sí se pudo leer', () => {
  // Sin fecha pero de otro importe, rechazado, de otro pago o ya asociado a otra
  // solicitud local: no es la devolución perdida, y la búsqueda sigue.
  for (const row of [
    { ...current, date_created: undefined, amount: 60 },
    { ...current, date_created: undefined, status: 'rejected' },
    { ...current, date_created: undefined, payment_id: '90002' },
    { ...current, amount: null, date_created: '2026-09-08T11:00:00Z' },
  ]) {
    assertEquals(locateRefundWithLostResponse([row], search, new Set(), now), { kind: 'none' });
  }
  assertEquals(
    locateRefundWithLostResponse([{ ...current, date_created: undefined }], search, new Set(['10001']), now),
    { kind: 'none' },
  );
});

Deno.test('respuesta perdida: la ventana se extiende hasta el último envío autorizado', () => {
  const late = { ...current, date_created: '2026-09-08T12:10:05Z' };
  const later = Date.parse('2026-09-08T12:20:00Z');
  assertEquals(locateRefundWithLostResponse([late], search, new Set(), later), { kind: 'none' });
  assertEquals(
    locateRefundWithLostResponse([late], { ...search, lastAttemptAt: '2026-09-08T12:10:00Z' }, new Set(), later),
    { kind: 'matched', outcome: late },
  );
});

Deno.test('respuesta perdida: una devolución todavía en proceso se encuentra (su identidad sirve para consultarla)', () => {
  const pending = { ...current, status: 'in_process' };
  assertEquals(locateRefundWithLostResponse([pending], search, new Set(), now), { kind: 'matched', outcome: pending });
});

for (const [name, broken] of [
  ['sin pago', { ...search, paymentId: '' }],
  ['importe inválido', { ...search, amount: Number.NaN }],
  ['fecha de solicitud inválida', { ...search, requestedAt: 'ayer' }],
  ['solicitud en el futuro', { ...search, requestedAt: '2099-01-01T00:00:00Z' }],
  ['último envío inválido', { ...search, lastAttemptAt: 'ayer' }],
] as const) {
  Deno.test('respuesta perdida: una solicitud local incoherente no busca nada (' + name + ')', () => {
    assertEquals(locateRefundWithLostResponse([current], broken, new Set(), now), { kind: 'rejected' });
  });
}

// ── Importe del reembolso en centavos enteros (EDGE-11) ─────────────────────
Deno.test('importe de reembolso: todos los importes de dos decimales entre 0.01 y 500.00 son válidos', () => {
  let rejectedByTheOldRule = 0;
  for (let cents = 1; cents <= 50_000; cents++) {
    const amount = cents / 100;
    assertEquals(refundAmountCents(amount), cents, `número ${amount}`);
    assertEquals(refundAmountCents(amount.toFixed(2)), cents, `texto ${amount.toFixed(2)}`);
    // La comparación que había antes, para dejar medido qué rechazaba.
    if (Math.round(amount * 100) !== amount * 100) rejectedByTheOldRule++;
  }
  // Si esto diera 0 la prueba no estaría midiendo el defecto que vino a cerrar.
  assertEquals(rejectedByTheOldRule > 4000, true, `la regla anterior rechazaba ${rejectedByTheOldRule} de 50000`);
});

Deno.test('importe de reembolso: lo que no es un importe positivo de dos decimales no pasa', () => {
  for (const value of [0, -1, -0.01, 0.001, 0.005, 1.005, 12.345, 1e-9, Number.NaN, Number.POSITIVE_INFINITY,
    10_000_000.01, 1e12, '', ' ', 'abc', '1e3', '1,50', '12.345', '-5', '+5', '0x10', '.5', '5.',
    true, false, null, undefined, [5], { amount: 5 }]) {
    assertEquals(refundAmountCents(value), null, JSON.stringify(value) ?? String(value));
  }
});

Deno.test('importe de reembolso: los bordes válidos', () => {
  assertEquals(refundAmountCents(0.01), 1);
  assertEquals(refundAmountCents('0.01'), 1);
  assertEquals(refundAmountCents(10_000_000), 1_000_000_000);
  assertEquals(refundAmountCents('10000000.00'), 1_000_000_000);
  assertEquals(refundAmountCents(' 15.5 '), 1550);
  // Lo que sale de sumar en coma flotante sigue siendo el mismo importe.
  assertEquals(refundAmountCents(0.1 + 0.2), 30);
});
