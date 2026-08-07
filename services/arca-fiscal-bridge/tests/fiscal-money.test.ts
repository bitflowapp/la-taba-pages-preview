// Las invariantes monetarias, contra las validaciones que ARCA aplica de verdad
// sobre FECAESolicitar. Cada caso cita el código de error del manual WSFEv1:
// nada de esto es una regla inventada de este lado.
//
// El principio es uno solo: un comprobante que no cierra no puede salir. Fallar
// acá es gratis; fallar en ARCA consume un número de la secuencia.
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFiscalRequest } from '../src/wsfe.js';
import { isValidCuit } from '../src/cuit.js';
import { buildCertificateSubject } from '../src/create-csr.js';
import { loadArcaConfig } from '../src/config.js';
import { rowToRequest } from '../src/store.js';
import { FiscalWorker } from '../src/worker.js';
import { MemoryFiscalStore, testConfig, testRequest, testTicket } from './fixtures.js';

const config = testConfig();
const cuit = config.cuit;

// ===== 10048: ImpTotal = ImpTotConc + ImpNeto + ImpOpEx + ImpTrib + ImpIVA =====

test('el total tiene que ser exactamente la suma de sus componentes (10048)', () => {
  assert.doesNotThrow(() => validateFiscalRequest(testRequest(), cuit));
  assert.throws(
    () => validateFiscalRequest(testRequest({ totalAmount: 121.5 }), cuit),
    /ARCA 10048/,
    'un peso de más en el total no puede pasar',
  );
  assert.throws(
    () => validateFiscalRequest(testRequest({ netAmount: 99 }), cuit),
    /ARCA 10048/,
    'ni un peso de menos en el neto',
  );
});

test('el margen de 10048 es el del manual: un centavo, no más', () => {
  // "Error relativo porcentual deberá ser <= 0.01% o el error absoluto <= 0.01"
  assert.doesNotThrow(() => validateFiscalRequest(testRequest({ totalAmount: 121.01 }), cuit));
  assert.throws(() => validateFiscalRequest(testRequest({ totalAmount: 121.03 }), cuit), /ARCA 10048/);
});

test('exento y no gravado entran en el total como cualquier otro componente', () => {
  const withExempt = testRequest({
    netAmount: 100, vatAmount: 21, exemptAmount: 50, nonTaxedAmount: 30, otherTaxesAmount: 9,
    totalAmount: 210,
  });
  assert.doesNotThrow(() => validateFiscalRequest(withExempt, cuit));
  // El mismo caso con el exento olvidado en el total ya no cierra.
  assert.throws(() => validateFiscalRequest({ ...withExempt, totalAmount: 160 }, cuit), /ARCA 10048/);
});

test('un importe negativo no es un importe fiscal', () => {
  assert.throws(() => validateFiscalRequest(testRequest({ exemptAmount: -1 }), cuit), /Importe fiscal inválido/);
  assert.throws(() => validateFiscalRequest(testRequest({ totalAmount: Number.NaN }), cuit), /Importe fiscal inválido/);
});

// ===== El CUIT: once dígitos no alcanzan =====

test('el dígito verificador del CUIT se calcula, no se asume', () => {
  // El fixture es sintético y su dígito cierra; el anterior no cerraba.
  assert.ok(isValidCuit('20123456786'));
  assert.ok(!isValidCuit('20123456789'), 'el CUIT viejo del fixture era inválido');
  assert.ok(!isValidCuit('20123456780'), 'cambiar el dígito verificador lo invalida');
  assert.ok(!isValidCuit('2012345678'), 'diez dígitos no son un CUIT');
  assert.ok(!isValidCuit('2012345678a'));
  // El dígito verificador es necesario, no suficiente: once ceros lo cumplen y
  // no son el CUIT de nadie. Quien decide eso es el padrón de ARCA, no esta
  // función, y por eso no se inventa acá una regla que ARCA no publicó.
  assert.ok(isValidCuit('00000000000'), 'módulo 11 acepta once ceros');
  // Formatos reales conocidos, para que el algoritmo no quede probado sólo
  // contra sí mismo.
  for (const valid of ['30500010912', '27230938607', '33693450239']) {
    assert.ok(isValidCuit(valid), `${valid} tiene que ser válido`);
  }
});

test('un CUIT que no cierra no llega a ARCA, ni al certificado, ni al worker', () => {
  assert.throws(() => validateFiscalRequest(testRequest({ cuit: '20123456789' }), '20123456789'), /dígito verificador/);
  assert.throws(
    () => buildCertificateSubject({ cuit: '20123456789', organization: 'TABA', system: 'taba-fiscal' }),
    /dígito verificador/,
  );
  assert.throws(
    () => loadArcaConfig({
      ARCA_ENVIRONMENT: 'homologation', ARCA_CUIT: '20123456789',
      ARCA_CERTIFICATE_PATH: '/secrets/cert.pem', ARCA_PRIVATE_KEY_PATH: '/secrets/key.pem',
    } as NodeJS.ProcessEnv),
    /dígito verificador/,
  );
});

// ===== 10023 / 10022 / 10018 / 10020: el detalle de IVA =====

test('la suma del detalle de IVA tiene que dar ImpIVA (10023)', () => {
  assert.throws(
    () => validateFiscalRequest(testRequest({ vatItems: [{ id: 5, baseAmount: 100, amount: 20 }] }), cuit),
    /ARCA 10023/,
  );
  assert.doesNotThrow(() => validateFiscalRequest(testRequest({
    netAmount: 100, vatAmount: 15.5, totalAmount: 115.5,
    vatItems: [{ id: 5, baseAmount: 50, amount: 10.5 }, { id: 4, baseAmount: 50, amount: 5 }],
  }), cuit));
});

test('el margen de 10023 crece con la cantidad de alícuotas informadas', () => {
  // "el error absoluto <= 0.01 * cantidad de alícuotas de IVA ingresadas"
  const twoRates = (amount: number) => testRequest({
    netAmount: 100, vatAmount: 15.5, totalAmount: 115.5,
    vatItems: [{ id: 5, baseAmount: 50, amount: 10.5 }, { id: 4, baseAmount: 50, amount: amount }],
  });
  assert.doesNotThrow(() => validateFiscalRequest(twoRates(5.02), cuit), 'dos centavos con dos alícuotas entran');
  assert.throws(() => validateFiscalRequest(twoRates(5.05), cuit), /ARCA 10023/, 'cinco no');
});

test('la alícuota no se puede repetir; se totaliza (10022)', () => {
  assert.throws(
    () => validateFiscalRequest(testRequest({
      netAmount: 100, vatAmount: 21, totalAmount: 121,
      vatItems: [{ id: 5, baseAmount: 50, amount: 10.5 }, { id: 5, baseAmount: 50, amount: 10.5 }],
    }), cuit),
    /ARCA 10022/,
  );
});

test('con IVA mayor a cero el detalle es obligatorio, y con IVA cero sólo va la alícuota 0% (10018)', () => {
  assert.throws(() => validateFiscalRequest(testRequest({ vatItems: [] }), cuit), /ARCA 10018/);
  const zeroVat = testRequest({ netAmount: 121, vatAmount: 0, totalAmount: 121, vatItems: [] });
  assert.doesNotThrow(() => validateFiscalRequest(zeroVat, cuit));
  assert.doesNotThrow(() => validateFiscalRequest({ ...zeroVat, vatItems: [{ id: 3, baseAmount: 121, amount: 0 }] }, cuit));
  assert.throws(
    () => validateFiscalRequest({ ...zeroVat, vatItems: [{ id: 5, baseAmount: 121, amount: 0 }] }, cuit),
    /ARCA 10018/,
  );
});

test('BaseImp debe ser mayor a cero salvo en las notas de débito y crédito que el manual exceptúa (10020)', () => {
  assert.throws(
    () => validateFiscalRequest(testRequest({ vatItems: [{ id: 5, baseAmount: 0, amount: 21 }] }), cuit),
    /ARCA 10020/,
  );
  // Tipos 2, 3, 7, 8, 52 y 53: "puede ser cero o no ser informado".
  assert.doesNotThrow(() => validateFiscalRequest(testRequest({
    documentType: 8, vatItems: [{ id: 5, baseAmount: 0, amount: 21 }],
  }), cuit));
});

// ===== Comprobantes clase C: 1434, 1435, 1438, 1439, 1443 =====

const classC = () => testRequest({
  documentType: 11, netAmount: 121, vatAmount: 0, totalAmount: 121, vatItems: [],
});

test('un comprobante clase C cierra con neto más tributos y sin nada de IVA', () => {
  assert.doesNotThrow(() => validateFiscalRequest(classC(), cuit));
  assert.doesNotThrow(() => validateFiscalRequest({ ...classC(), otherTaxesAmount: 9, totalAmount: 130 }, cuit));
  assert.throws(() => validateFiscalRequest({ ...classC(), totalAmount: 130 }, cuit), /ARCA 1439/);
});

test('la clase C no admite no gravado, exento, IVA ni array de IVA', () => {
  assert.throws(() => validateFiscalRequest({ ...classC(), nonTaxedAmount: 10, totalAmount: 131 }, cuit), /ARCA 1434/);
  assert.throws(() => validateFiscalRequest({ ...classC(), exemptAmount: 10, totalAmount: 131 }, cuit), /ARCA 1435/);
  assert.throws(() => validateFiscalRequest({ ...classC(), netAmount: 100, vatAmount: 21 }, cuit), /ARCA 1438/);
  assert.throws(
    () => validateFiscalRequest({ ...classC(), vatItems: [{ id: 3, baseAmount: 121, amount: 0 }] }, cuit),
    /ARCA 1443/,
  );
});

test('los siete tipos clase C del manual se tratan como clase C', () => {
  for (const documentType of [11, 12, 13, 15, 211, 212, 213]) {
    assert.throws(
      () => validateFiscalRequest(testRequest({ documentType, netAmount: 100, vatAmount: 21, totalAmount: 121 }), cuit),
      /ARCA 1438/,
      `el tipo ${documentType} tiene que rechazar IVA distinto de cero`,
    );
  }
});

// ===== La fuente del detalle de IVA: totalización por alícuota =====

test('dos líneas a la misma alícuota viajan como una sola AlicIva (10022 en origen)', () => {
  const request = rowToRequest({
    cuit, point_of_sale: 5, document_type: 6, concept: 1,
    recipient_document_type: 99, recipient_document_number: '0', recipient_vat_condition_id: 5,
    document_number: 7, issue_date: '2026-08-02',
    total_amount: 3630, net_amount: 3000, tax_amount: 630,
    exempt_amount: 0, non_taxed_amount: 0, other_taxes_amount: 0,
    currency: 'PES', currency_rate: 1, document_intent: 'invoice',
    fiscal_document_items: [
      { tax_code: 5, net_amount: 1000, tax_amount: 210 },
      { tax_code: 5, net_amount: 1500, tax_amount: 315 },
      { tax_code: 4, net_amount: 500, tax_amount: 105 },
    ],
  });
  assert.deepEqual(request.vatItems, [
    { id: 4, baseAmount: 500, amount: 105 },
    { id: 5, baseAmount: 2500, amount: 525 },
  ]);
  assert.doesNotThrow(() => validateFiscalRequest(request, cuit));
});

test('la totalización por alícuota no arrastra el error de coma flotante', () => {
  const request = rowToRequest({
    cuit, point_of_sale: 5, document_type: 6, concept: 1,
    recipient_document_type: 99, recipient_document_number: '0', recipient_vat_condition_id: 5,
    document_number: 8, issue_date: '2026-08-02',
    total_amount: 363, net_amount: 300, tax_amount: 63,
    exempt_amount: 0, non_taxed_amount: 0, other_taxes_amount: 0,
    currency: 'PES', currency_rate: 1, document_intent: 'invoice',
    fiscal_document_items: Array.from({ length: 3 }, () => ({ tax_code: 5, net_amount: 100, tax_amount: 21 })),
  });
  assert.deepEqual(request.vatItems, [{ id: 5, baseAmount: 300, amount: 63 }]);
  assert.equal(request.vatItems[0]!.amount, 63, 'no 62.99999999999999');
});

// ===== La consecuencia: un comprobante que no cierra no consume un número =====

test('si los importes no cierran no se reserva número ni se llama a ARCA', async () => {
  const store = new MemoryFiscalStore({
    state: 'queued',
    request: testRequest({ documentNumber: 0, vatItems: [{ id: 5, baseAmount: 100, amount: 19 }] }),
  });
  let arcaCalls = 0;
  const worker = new FiscalWorker({
    config,
    store,
    wsaa: { login: async () => testTicket },
    wsfe: {
      lastAuthorized: async () => { arcaCalls += 1; return 41; },
      authorize: async () => { arcaCalls += 1; throw new Error('no debería llegar acá'); },
      consult: async () => { arcaCalls += 1; return null; },
    },
    logger: { info() {}, warn() {} },
  });

  await worker.runOnce();

  assert.equal(arcaCalls, 0, 'ARCA no se entera de un comprobante que no cierra');
  assert.equal(store.reserveCalls, 0, 'y la secuencia de números queda intacta');
  assert.equal(store.completed[0]?.errorCode, 'REQUIRES_FISCAL_REVIEW');
  assert.match(String(store.completed[0]?.errorMessage), /ARCA 10023/);
});
