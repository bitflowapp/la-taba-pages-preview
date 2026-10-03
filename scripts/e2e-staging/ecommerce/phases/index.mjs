// Registro de fases, en el orden en que corren. Cada módulo exporta
// `{ id, title, requires: [capacidades], async run(ctx) }`.
//
// El orden importa en tres puntos:
//   · `abuse` deja frenos anotados contra el origen de red de la corrida (que en
//     Staging es uno solo): va después de las fases que sólo crean pedidos sanos y
//     gasta pocos frenos manuales, para no acercar ese origen al enfriamiento;
//   · `expiry` espera al planificador real (hasta unos 70 s por caso): va al final,
//     donde no demora a nadie;
//   · `performance` es la carga: va última, con el tenant ya probado.
import catalog from './catalog.mjs';
import pricing from './pricing.mjs';
import snapshot from './snapshot.mjs';
import delivery from './delivery.mjs';
import hours from './hours.mjs';
import status from './status.mjs';
import inventory from './inventory.mjs';
import idempotency from './idempotency.mjs';
import lifecycle from './lifecycle.mjs';
import cancellation from './cancellation.mjs';
import customerCancel from './customer-cancel.mjs';
import rider from './rider.mjs';
import privacy from './privacy.mjs';
import rls from './rls.mjs';
import trace from './trace.mjs';
import health from './health.mjs';
import abuse from './abuse.mjs';
import payments from './payments.mjs';
import lostAck from './lost-ack.mjs';
import edgeFunctions from './edge-functions.mjs';
import expiry from './expiry.mjs';
import performance from './performance.mjs';

export const PHASES = Object.freeze([catalog, pricing, snapshot, delivery, hours, status, inventory, idempotency, lifecycle, cancellation,
  customerCancel, rider, privacy, rls, trace, health, abuse, payments, lostAck, edgeFunctions, expiry, performance]);
export const PHASE_IDS = Object.freeze(PHASES.map((phase) => phase.id));
