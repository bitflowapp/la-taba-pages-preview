import { leerSecreto, guardarSecreto } from '../e2e-production-sale/secretos-windows.mjs';

const orderId = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(orderId || '')) {
  throw Error('EXACT_QA_ORDER_ID_REQUIRED');
}
const name = `RIDER CANONICAL QA RUN 20260922 PREVIOUS ${orderId}`;
const stored = leerSecreto(name);
if (!stored?.secreto) throw Error('QA_ARCHIVE_NOT_FOUND');
const state = JSON.parse(stored.secreto);
if (state.orderId !== orderId || !state.productId || !state.riderId) throw Error('QA_ARCHIVE_IDENTITY_MISMATCH');
const ephemeralPresent = Boolean(state.tracking || state.deliveryCode || state.offer);
delete state.tracking;
delete state.deliveryCode;
delete state.offer;
state.sealedAt ||= new Date().toISOString();
guardarSecreto(name, 'staging', JSON.stringify(state));
const reread = JSON.parse(leerSecreto(name)?.secreto || '{}');
if (reread.tracking || reread.deliveryCode || reread.offer) throw Error('QA_ARCHIVE_NOT_SEALED');
console.log(JSON.stringify({ qaArchive: orderId, ephemeralWasPresent: ephemeralPresent,
  ephemeralRemoved: true, credentialsUnprinted: true }));
