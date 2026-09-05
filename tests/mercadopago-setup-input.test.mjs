import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const [label, input] of [
  ['MCP no devuelve Client Secret', {clientId:'1234567890123456',clientSecret:'—',webhookSecret:'example_fixture_secret'}],
  ['MCP devuelve la firma truncada', {clientId:'1234567890123456',clientSecret:'example_fixture_secret',webhookSecret:'abc1234…'}],
  ['Client ID numérico pierde precisión', {clientId:1234567890123456,clientSecret:'example_fixture_secret',webhookSecret:'example_fixture_secret'}],
  ['JSON inválido', 'invalid-json'],
]) {
  test('setup falla antes de escribir secretos: '+label, () => {
    const result=spawnSync(process.execPath,['scripts/mercadopago/configurar-oauth-staging.mjs','--stdin'],{
      input:typeof input==='string'?input:JSON.stringify(input),encoding:'utf8',
      env:{...process.env,TABA_SETUP_CLIENT_ID:'',TABA_SETUP_CLIENT_SECRET:'',TABA_SETUP_WEBHOOK_SECRET:''},
    });
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/No se modificó staging/);
    assert.doesNotMatch(result.stdout+result.stderr,/example_fixture_secret|abc1234/);
  });
}
