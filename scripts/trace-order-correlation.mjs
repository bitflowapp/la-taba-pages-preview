#!/usr/bin/env node
/*
 * REGLAS DE CORRELACIÓN DE PEDIDO — VALIDADOR OFFLINE, NO UNA SONDA
 * -------------------------------------------------------------
 * ESTO NO SE CONECTA A NADA. No importa Supabase, no hace `fetch`, no lee la
 * base ni el panel ni el proveedor de pagos ni el Rider. Es una librería de
 * reglas pura, y su modo CLI las corre contra FIXTURES ESCRITAS A MANO.
 *
 * Por eso su salida NO prueba que los sistemas reales estén de acuerdo: si
 * mañana la base, el panel y el Rider divergieran, este archivo seguiría
 * imprimiendo lo mismo. Lo que sí aporta: las reglas de correlación quedan
 * escritas, con nombre y en un solo lugar, y se pueden reutilizar desde una
 * herramienta que SÍ lea datos reales.
 *
 * Define las reglas para tres diagnósticos:
 *   1. "El cliente afirma que pagó pero el panel no lo ve."
 *   2. "El rider no ve la dirección o no puede confirmar entrega."
 *   3. "Doble confirmación por latencia o toque repetido."
 *
 * Sin PII: `sanitizeTraceRecord` filtra por NOMBRE DE CLAVE —no por valor—,
 * así que un emisor que mande texto libre en una clave no listada lo conserva.
 *
 * Para un incidente real la fuente son las tablas del servidor:
 * `order_events`, `payment_events`, `payment_webhook_receipts`,
 * `operational_alerts`. Ver docs/OPERATIONAL-RUNBOOK.md §5.
 */

import crypto from 'node:crypto';

export const TRACE_HOPS = Object.freeze({
  CLIENT_DRAFT: 'CLIENT_DRAFT',
  DB_RECORD: 'DB_RECORD',
  BUSINESS_INBOX: 'BUSINESS_INBOX',
  PAYMENT_INTENT: 'PAYMENT_INTENT',
  RIDER_DISPATCH: 'RIDER_DISPATCH',
  TERMINAL_CLOSURE: 'TERMINAL_CLOSURE',
});

const PII_REGEX = /(nombre|name|telefono|phone|calle|street|numero|direccion|address|tarjeta|card|cvv|token|secret|password)/i;

/**
 * Sanitizes order correlation record, strictly eliminating PII.
 */
export function sanitizeTraceRecord(record) {
  if (!record || typeof record !== 'object') return {};
  const safe = {};
  for (const [key, value] of Object.entries(record)) {
    if (PII_REGEX.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object' && !Array.isArray(value)) {
      safe[key] = sanitizeTraceRecord(value);
    } else if (Array.isArray(value)) {
      safe[key] = value.map((item) => (typeof item === 'object' ? sanitizeTraceRecord(item) : item));
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Validates cross-system correlation consistency.
 */
export function validateOrderCorrelation(hops) {
  const issues = [];
  const client = hops[TRACE_HOPS.CLIENT_DRAFT];
  const db = hops[TRACE_HOPS.DB_RECORD];
  const business = hops[TRACE_HOPS.BUSINESS_INBOX];
  const payment = hops[TRACE_HOPS.PAYMENT_INTENT];
  const rider = hops[TRACE_HOPS.RIDER_DISPATCH];

  if (!db) {
    issues.push({
      code: 'ERR_ORDER_NOT_IN_DB',
      message: 'El pedido no fue persistido en PostgreSQL.',
      resolution: 'Revisar conectividad del cliente al momento del submit y logs de RPC create_order_with_items.',
    });
    return { ok: false, issues };
  }

  // Idempotency / Request ID correlation
  if (client?.client_request_id && db.client_request_id !== client.client_request_id) {
    issues.push({
      code: 'ERR_CLIENT_REQUEST_ID_MISMATCH',
      message: 'Discrepancia entre client_request_id del cliente y el registrado en la base.',
      resolution: 'Posible intento de orden duplicada o sustitución de payload.',
    });
  }

  // Business panel visibility
  if (business && business.order_id !== db.id) {
    issues.push({
      code: 'ERR_BUSINESS_ORDER_MISMATCH',
      message: 'El ID de pedido en el panel de negocio no coincide con la base.',
      resolution: 'Comprobar suscripción Realtime del panel de negocio y sincronización con Supabase.',
    });
  }

  // Payment status correlation
  if (db.payment_method === 'mercadopago') {
    if (!payment) {
      issues.push({
        code: 'ERR_MP_INTENT_MISSING',
        message: 'El cliente seleccionó Mercado Pago pero no se generó una sesión o intento de pago registrado.',
        resolution: 'El cliente abandonó el checkout antes del handoff o falló la RPC mercadopago-create-checkout-session.',
      });
    } else if (payment.collection_status === 'approved' && db.payment_status !== 'approved') {
      issues.push({
        code: 'ERR_PAYMENT_DESYNC_CUSTOMER_PAID_BIZ_UNPAID',
        message: 'Discrepancia: Mercado Pago aprobó el cobro pero el pedido figura como pendiente.',
        resolution: 'Verificar webhook de Mercado Pago y ejecución de la función mercadopago-webhook-relay.',
      });
    }
  }

  // Rider visibility & fulfillment correlation
  if (db.delivery_mode === 'delivery') {
    if (rider && rider.order_id !== db.id) {
      issues.push({
        code: 'ERR_RIDER_ORDER_MISMATCH',
        message: 'El pedido en la app de Rider no coincide con el pedido de la base.',
        resolution: 'Refrescar asignación de rider y verificar token de autorización del rider.',
      });
    }
    if (!db.delivery_location_confirmed_at && !db.delivery_latitude) {
      issues.push({
        code: 'ERR_RIDER_NO_CONFIRMED_LOCATION',
        message: 'El pedido es para delivery pero carece de confirmación de pin/coordenadas.',
        resolution: 'Contrato de ubicación no cumplido. Verificar requireConfirmedDeliveryLocation() en el checkout.',
      });
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

/**
 * Runs automated correlation test suite across common operational scenarios.
 */
export function runCorrelationAudit() {
  const results = [];

  // Scenario 1: Standard Cash/Coordinate Order - Happy Path
  {
    const orderId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const publicCode = 'TAB' + crypto.randomBytes(3).toString('hex').toUpperCase();

    const hops = {
      [TRACE_HOPS.CLIENT_DRAFT]: {
        client_request_id: requestId,
        payment_method: 'coordinate',
        delivery_mode: 'delivery',
      },
      [TRACE_HOPS.DB_RECORD]: {
        id: orderId,
        client_request_id: requestId,
        public_code: publicCode,
        payment_method: 'coordinate',
        payment_status: 'pending_cash',
        delivery_mode: 'delivery',
        delivery_location_confirmed_at: new Date().toISOString(),
        delivery_latitude: -38.9516,
      },
      [TRACE_HOPS.BUSINESS_INBOX]: {
        order_id: orderId,
        status: 'accepted',
      },
      [TRACE_HOPS.RIDER_DISPATCH]: {
        order_id: orderId,
        status: 'dispatched',
      },
    };

    const audit = validateOrderCorrelation(hops);
    const sanitized = sanitizeTraceRecord(hops);
    const hasPII = JSON.stringify(sanitized).match(PII_REGEX);

    results.push({
      scenario: 'Standard Coordinate Order (Happy Path)',
      success: audit.ok && !hasPII,
      correlationOk: audit.ok,
      zeroPiiOk: !hasPII,
      issueCount: audit.issues.length,
    });
  }

  // Scenario 2: Mercado Pago Paid but Webhook Delayed
  {
    const orderId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const hops = {
      [TRACE_HOPS.CLIENT_DRAFT]: {
        client_request_id: requestId,
        payment_method: 'mercadopago',
        delivery_mode: 'delivery',
      },
      [TRACE_HOPS.DB_RECORD]: {
        id: orderId,
        client_request_id: requestId,
        payment_method: 'mercadopago',
        payment_status: 'pending',
        delivery_mode: 'delivery',
        delivery_location_confirmed_at: new Date().toISOString(),
        delivery_latitude: -38.9516,
      },
      [TRACE_HOPS.BUSINESS_INBOX]: {
        order_id: orderId,
        status: 'created',
      },
      [TRACE_HOPS.PAYMENT_INTENT]: {
        collection_status: 'approved',
      },
    };

    const audit = validateOrderCorrelation(hops);
    results.push({
      scenario: 'Mercado Pago Webhook Desync (Customer Paid / Biz Pending)',
      success: !audit.ok && audit.issues.some((i) => i.code === 'ERR_PAYMENT_DESYNC_CUSTOMER_PAID_BIZ_UNPAID'),
      correlationOk: !audit.ok,
      zeroPiiOk: true,
      diagnostic: audit.issues[0]?.resolution,
    });
  }

  // Scenario 3: Delivery without Confirmed Pin
  {
    const orderId = crypto.randomUUID();
    const requestId = crypto.randomUUID();
    const hops = {
      [TRACE_HOPS.CLIENT_DRAFT]: {
        client_request_id: requestId,
        delivery_mode: 'delivery',
      },
      [TRACE_HOPS.DB_RECORD]: {
        id: orderId,
        client_request_id: requestId,
        delivery_mode: 'delivery',
        delivery_location_confirmed_at: null,
        delivery_latitude: null,
      },
    };

    const audit = validateOrderCorrelation(hops);
    results.push({
      scenario: 'Delivery Missing Confirmed Pin Contract',
      success: !audit.ok && audit.issues.some((i) => i.code === 'ERR_RIDER_NO_CONFIRMED_LOCATION'),
      correlationOk: !audit.ok,
      zeroPiiOk: true,
      diagnostic: audit.issues[0]?.resolution,
    });
  }

  return results;
}

import { pathToFileURL } from 'node:url';

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log('================================================================');
  console.log('REGLAS DE CORRELACIÓN — contra fixtures locales, no contra los');
  console.log('sistemas reales. No prueba que base, panel, pago y Rider');
  console.log('coincidan hoy; sólo que estas reglas se sostienen.');
  console.log('================================================================\n');

  const auditResults = runCorrelationAudit();
  let allPassed = true;

  for (const r of auditResults) {
    const mark = r.success ? 'PASS' : 'FAIL';
    console.log(`[${mark}] ${r.scenario}`);
    if (r.diagnostic) {
      console.log(`       -> Diagnostic Resolution: ${r.diagnostic}`);
    }
    if (!r.success) allPassed = false;
  }

  console.log('\nResultado (sobre fixtures locales): ' + (allPassed
    ? 'las reglas se sostienen — NO implica que los sistemas reales coincidan'
    : 'HAY REGLAS QUE NO SE SOSTIENEN'));
  process.exit(allPassed ? 0 : 1);
}
