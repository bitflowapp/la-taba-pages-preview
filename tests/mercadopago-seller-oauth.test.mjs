import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizationUrl, digest, randomSecret, seal, unseal, parseCallback } from '../supabase/functions/_shared/seller-oauth-crypto.ts';

test('OAuth uses the official endpoint and PKCE S256 with opaque random state', async()=>{
  const state=randomSecret(), verifier=randomSecret();
  const url=new URL(authorizationUrl('123456','https://example.com/callback',state,await digest(verifier)));
  assert.equal(url.origin,'https://auth.mercadopago.com');
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('state'),state);
  assert.equal(url.searchParams.get('scope'),'read write offline_access');
  assert.equal(new Set(Array.from({length:100},randomSecret)).size,100);
  assert.ok(!url.toString().includes(verifier));
});
test('PKCE matches RFC 7636 vector',async()=>{
  assert.equal(await digest('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});
test('OAuth rejects HTTP callbacks and invalid application/state',()=>{
  assert.throws(()=>authorizationUrl('123','http://example.com',randomSecret(),'x'));
  assert.throws(()=>authorizationUrl('bad','https://example.com',randomSecret(),'x'));
  assert.throws(()=>authorizationUrl('123','https://example.com','tenant-id','x'));
});
test('encrypted material round trips and uses a different nonce each time',async()=>{
  const key=randomSecret(), material={access_token:'fixture-access',refresh_token:'fixture-refresh'};
  const first=await seal(material,key,'staging:tenant-a');
  assert.deepEqual(await unseal(first,key,'staging:tenant-a'),material);
  assert.notEqual(first,await seal(material,key,'staging:tenant-a'));
  assert.ok(!first.includes('fixture'));
});
test('ciphertext rejects wrong tenant, environment, key and tampering',async()=>{
  const key=randomSecret(), encrypted=await seal({value:'private'},key,'staging:a');
  await assert.rejects(()=>unseal(encrypted,key,'staging:b'));
  await assert.rejects(()=>unseal(encrypted,key,'production:a'));
  await assert.rejects(()=>unseal(encrypted,randomSecret(),'staging:a'));
  await assert.rejects(()=>unseal(encrypted.slice(0,20)+'x'+encrypted.slice(21),key,'staging:a'));
  await assert.rejects(()=>seal({},'short','staging:a'));
});
test('callback accepts success/denial and rejects ambiguous or missing parameters',()=>{
  const state=randomSecret();
  assert.equal(parseCallback(new URL(`https://example.com/?state=${state}&code=fixture`)).code,'fixture');
  assert.equal(parseCallback(new URL(`https://example.com/?state=${state}&error=access_denied`)).denied,true);
  for(const query of ['',`state=${state}`,`state=${state}&state=${state}&code=x`,`state=${state}&code=x&code=y`,`state=${state}&code=x&error=denied`]) {
    assert.throws(()=>parseCallback(new URL('https://example.com/?'+query)));
  }
});
