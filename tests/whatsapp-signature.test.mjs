import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  hashIdentifier,
  resolveVerificationChallenge,
  timingSafeEqualText,
  verifyMetaSignature,
} from '../supabase/functions/_shared/whatsapp/signature.js';

const APP_SECRET = 'app-secret-de-prueba';
const BODY = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

function sign(body, secret = APP_SECRET) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

test('la firma válida de Meta se acepta', async () => {
  assert.equal(await verifyMetaSignature({ rawBody: BODY, header: sign(BODY), appSecret: APP_SECRET }), true);
});

test('un cuerpo alterado invalida la firma', async () => {
  const header = sign(BODY);
  assert.equal(await verifyMetaSignature({ rawBody: `${BODY} `, header, appSecret: APP_SECRET }), false);
  // Reserializar el JSON cambia bytes: por eso el webhook firma el cuerpo crudo.
  const reserialized = JSON.stringify(JSON.parse(BODY).entry ? JSON.parse(BODY) : {});
  assert.equal(
    await verifyMetaSignature({ rawBody: `${reserialized}\n`, header, appSecret: APP_SECRET }),
    false,
  );
});

test('otro app secret invalida la firma', async () => {
  assert.equal(
    await verifyMetaSignature({ rawBody: BODY, header: sign(BODY, 'otro'), appSecret: APP_SECRET }),
    false,
  );
});

test('una firma sin prefijo, vacía o mal formada se rechaza', async () => {
  const digest = crypto.createHmac('sha256', APP_SECRET).update(BODY).digest('hex');
  for (const header of ['', digest, `sha1=${digest}`, 'sha256=', `sha256=${digest.slice(0, 60)}`, 'sha256=zz']) {
    assert.equal(await verifyMetaSignature({ rawBody: BODY, header, appSecret: APP_SECRET }), false, header);
  }
});

test('sin app secret nada valida', async () => {
  assert.equal(await verifyMetaSignature({ rawBody: BODY, header: sign(BODY), appSecret: '' }), false);
});

test('la verificación del webhook sólo responde al token exacto', () => {
  const base = { mode: 'subscribe', challenge: 'reto-1234', verifyToken: 'token-secreto' };
  assert.equal(resolveVerificationChallenge({ ...base, token: 'token-secreto' }), 'reto-1234');
  assert.equal(resolveVerificationChallenge({ ...base, token: 'token-secret' }), null);
  assert.equal(resolveVerificationChallenge({ ...base, token: '' }), null);
  assert.equal(resolveVerificationChallenge({ ...base, token: 'token-secreto', mode: 'unsubscribe' }), null);
  assert.equal(resolveVerificationChallenge({ ...base, token: 'token-secreto', verifyToken: '' }), null);
});

test('el challenge devuelto no puede ser un cuerpo arbitrario', () => {
  const base = { mode: 'subscribe', token: 't', verifyToken: 't' };
  assert.equal(resolveVerificationChallenge({ ...base, challenge: '<script>alert(1)</script>' }), null);
  assert.equal(resolveVerificationChallenge({ ...base, challenge: 'a'.repeat(129) }), null);
  assert.equal(resolveVerificationChallenge({ ...base, challenge: 'ABC-123_xyz' }), 'ABC-123_xyz');
});

test('la comparación de tokens no se corta en el primer carácter distinto', () => {
  assert.equal(timingSafeEqualText('abcdef', 'abcdef'), true);
  assert.equal(timingSafeEqualText('abcdef', 'abcdeg'), false);
  assert.equal(timingSafeEqualText('abcdef', 'abcde'), false);
});

test('el identificador del cliente sólo sale hasheado y con sal', async () => {
  const hash = await hashIdentifier('5492995550101', 'whatsapp-contact', 'sal');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.notEqual(hash, await hashIdentifier('5492995550101', 'whatsapp-contact', 'otra-sal'));
  assert.notEqual(hash, await hashIdentifier('5492995550102', 'whatsapp-contact', 'sal'));
  await assert.rejects(() => hashIdentifier('5492995550101', 'whatsapp-contact', ''));
});
