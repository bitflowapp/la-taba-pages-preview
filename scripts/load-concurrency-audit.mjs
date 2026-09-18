#!/usr/bin/env node
/*
 * SIMULATED_CONCURRENCY_CONTRACT_TEST — NO ES UN BENCHMARK
 * =============================================================
 *
 * ESTO NO MIDE TABA. Leer antes de citar cualquier número de acá.
 *
 * QUÉ ES: un modelo en memoria (`MockOrderEngine`, definido más abajo EN ESTE
 * MISMO ARCHIVO) que describe la forma esperada del ciclo de vida de un
 * pedido. Sirve para razonar sobre el contrato y para que un cambio de forma
 * se note. Nada más.
 *
 * QUÉ NO ES:
 *   · NO toca PostgreSQL, ni Supabase, ni una RPC, ni la red;
 *   · NO ejercita `create_checkout_session` ni `create_order_with_items`;
 *   · NO ejercita `orders_business_client_request_key` ni
 *     `pg_advisory_xact_lock`, que son las defensas REALES contra duplicados;
 *   · NO mide capacidad de infraestructura.
 *
 * SOBRE «req/s»: lo que imprime es cuántas veces por segundo Node resuelve los
 * `setTimeout` de 5–25 ms de este archivo. Es una propiedad del planificador de
 * Node, no de TABA. Citarlo como capacidad de producción es un error; se citó
 * así antes —«967 req/s»— y era falso.
 *
 * SOBRE «0 duplicados»: la deduplicación que comprueba es `Map.has(key)`. No
 * puede fallar. Que no haya duplicados EN PRODUCCIÓN lo garantiza el índice
 * único de la base, y eso se verifica contra una base real.
 *
 * DÓNDE ESTÁ LA MEDICIÓN DE VERDAD:
 *   · base real aislada ........... npm run test:db:isolated
 *   · circuito contra staging ..... scripts/certify-real-order-pipeline.mjs
 */

import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Deterministic in-memory order store simulating backend RPC
class MockOrderEngine {
  constructor() {
    this.orders = new Map(); // order_id -> order
    this.idempotencyIndex = new Map(); // client_request_id -> order_id
    this.stock = new Map(); // product_id -> available stock
    this.activeLocks = new Set(); // business_id + client_request_id
    this.metrics = {
      totalSubmits: 0,
      successfulOrders: 0,
      deduplicatedReplays: 0,
      rejectedStock: 0,
      raceCollisionsPrevented: 0,
    };
  }

  setStock(productId, count) {
    this.stock.set(productId, count);
  }

  async submitOrder({ clientRequestId, businessId, items, customerNotes = '' }) {
    this.metrics.totalSubmits += 1;
    const lockKey = `${businessId}:${clientRequestId}`;

    // Simular advisory lock a nivel de transacción
    if (this.activeLocks.has(lockKey)) {
      this.metrics.raceCollisionsPrevented += 1;
      // Esperar brevemente a que termine la transacción en vuelo
      await new Promise((r) => setTimeout(r, 15));
    }
    this.activeLocks.add(lockKey);

    try {
      // Simular latencia de red / base de datos entre 5ms y 25ms
      const delay = Math.floor(Math.random() * 20) + 5;
      await new Promise((r) => setTimeout(r, delay));

      // 1. Idempotency Check
      if (this.idempotencyIndex.has(clientRequestId)) {
        this.metrics.deduplicatedReplays += 1;
        const existingOrderId = this.idempotencyIndex.get(clientRequestId);
        return {
          ok: true,
          replayed: true,
          order: this.orders.get(existingOrderId),
        };
      }

      // 2. Stock Check
      for (const item of items) {
        const available = this.stock.get(item.productId) || 0;
        if (available < item.quantity) {
          this.metrics.rejectedStock += 1;
          return {
            ok: false,
            code: 'INSUFFICIENT_STOCK',
            message: `Stock insuficiente para producto ${item.productId}`,
          };
        }
      }

      // 3. Stock Deduct
      for (const item of items) {
        const available = this.stock.get(item.productId) || 0;
        this.stock.set(item.productId, available - item.quantity);
      }

      // 4. Create Order
      const orderId = crypto.randomUUID();
      const publicCode = 'TAB' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const order = {
        id: orderId,
        public_code: publicCode,
        client_request_id: clientRequestId,
        business_id: businessId,
        items: [...items],
        status: 'created',
        created_at: new Date().toISOString(),
      };

      this.orders.set(orderId, order);
      this.idempotencyIndex.set(clientRequestId, orderId);
      this.metrics.successfulOrders += 1;

      return {
        ok: true,
        replayed: false,
        order,
      };
    } finally {
      this.activeLocks.delete(lockKey);
    }
  }
}

/**
 * Runs a concurrency wave with given worker pool size.
 */
async function runWave({ name, totalOrders, concurrency, doubleTapRate = 0.2 }) {
  const engine = new MockOrderEngine();
  engine.setStock('PROD-1', 1000);
  engine.setStock('PROD-2', 1000);

  const latencies = [];
  const start = Date.now();

  let ordersScheduled = 0;
  let activeWorkers = 0;

  async function simulateCustomerOrder() {
    const t0 = Date.now();
    const clientRequestId = crypto.randomUUID();
    const isDoubleTap = Math.random() < doubleTapRate;

    const items = [
      { productId: 'PROD-1', quantity: 1 },
      { productId: 'PROD-2', quantity: 1 },
    ];

    if (isDoubleTap) {
      // Dos peticiones casi simultáneas con la misma clave idempotente
      const [res1, res2] = await Promise.all([
        engine.submitOrder({ clientRequestId, businessId: 'BIZ-1', items }),
        engine.submitOrder({ clientRequestId, businessId: 'BIZ-1', items }),
      ]);
      latencies.push(Date.now() - t0);
      return [res1, res2];
    } else {
      const res = await engine.submitOrder({ clientRequestId, businessId: 'BIZ-1', items });
      latencies.push(Date.now() - t0);
      return [res];
    }
  }

  // Ejecución concurrente con límite de workers
  const tasks = [];
  while (ordersScheduled < totalOrders) {
    ordersScheduled++;
    tasks.push(simulateCustomerOrder);
  }

  const results = [];
  let index = 0;
  const workerLoop = async () => {
    while (index < tasks.length) {
      const taskIndex = index++;
      results[taskIndex] = await tasks[taskIndex]();
    }
  };

  const pool = Array.from({ length: concurrency }, () => workerLoop());
  await Promise.all(pool);

  const durationMs = Date.now() - start;
  latencies.sort((a, b) => a - b);

  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const max = latencies[latencies.length - 1] || 0;

  return {
    name,
    concurrency,
    totalOrders,
    durationMs,
    throughputRps: Number(((totalOrders / durationMs) * 1000).toFixed(1)),
    p50,
    p95,
    max,
    metrics: engine.metrics,
    duplicatesDetected: engine.metrics.deduplicatedReplays,
    successfulOrders: engine.metrics.successfulOrders,
    exactOrderMatch: engine.orders.size === engine.metrics.successfulOrders,
  };
}

export async function runAllConcurrencyAudits() {
  const waves = [
    { name: 'Wave 1 (Baseline)', totalOrders: 10, concurrency: 1 },
    { name: 'Wave 2 (Moderate Load)', totalOrders: 30, concurrency: 10 },
    { name: 'Wave 3 (Peak Concurrency)', totalOrders: 60, concurrency: 30 },
  ];

  const results = [];
  for (const wave of waves) {
    const res = await runWave(wave);
    results.push(res);
  }
  return results;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  console.log('================================================================');
  console.log('SIMULATED CONCURRENCY CONTRACT TEST — modelo en memoria');
  console.log('NO mide TABA: no hay base, ni RPC, ni red. Ver cabecera.');
  console.log('================================================================\n');

  runAllConcurrencyAudits().then((results) => {
    console.table(results.map((r) => ({
      Scenario: r.name,
      Concurrency: r.concurrency,
      Orders: r.totalOrders,
      // Velocidad del planificador de Node sobre los sleeps de este archivo.
      // NO es capacidad de TABA. Ver la cabecera.
      'Sim ops/s (NOT capacity)': r.throughputRps,
      'p50 (ms)': r.p50,
      'p95 (ms)': r.p95,
      'Max (ms)': r.max,
      'Created OK': r.successfulOrders,
      'Deduped (Replay)': r.duplicatesDetected,
      'Exact Consistency': r.exactOrderMatch ? 'YES (0 Anomaly)' : 'NO',
    })));

    const allConsistent = results.every((r) => r.exactOrderMatch && r.successfulOrders === r.totalOrders);
    console.log('\nConcurrency Audit Result: ' + (allConsistent ? 'PASS (100% IDEMPOTENT & CONSISTENT)' : 'FAIL'));
    process.exit(allConsistent ? 0 : 1);
  });
}
