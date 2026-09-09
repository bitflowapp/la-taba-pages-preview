import assert from 'node:assert/strict';
import { PROJECT, INVENTORY, FUNCTIONS, sha256, remoteFunction } from '../../scripts/release-v5/model.mjs';
import { Platform } from '../../scripts/release-v5/platform.mjs';

export function baselineFunctions() {
  return INVENTORY.map((slug, i) => ({ slug, name: slug, id: `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
    version: 9, status: 'ACTIVE', created_at: 1787870408066, updated_at: 1788852540895,
    verify_jwt: ['mercadopago-refund','mercadopago-cancel-payment'].includes(slug),
    ezbr_sha256: sha256(`legacy:${slug}`),
    entrypoint_path: `file:///tmp/user_fn_${PROJECT}/source/supabase/functions/${slug}/index.ts`,
  }));
}
// Verified API contract: CLI v2.101.0 apps/cli-go/pkg/function/deploy.go,
// pkg/api/client.gen.go and internal/functions/download/download.go.
// It rejects every unrecognized route/method/body; it is not a permissive CLI.
export function platformFixture(query = async () => []) {
  const state = { remote: baselineFunctions(), sources: new Map(), calls: [], stageCount: 0, activateCount: 3, hooks: {} };
  const environment={MERCADOPAGO_CLIENT_ID:'7677852968049976',MERCADOPAGO_CREDENTIAL_MODE:'oauth',MERCADOPAGO_ENVIRONMENT:'production',TABA_DEPLOYMENT_ENV:'production',MERCADOPAGO_OAUTH_PROJECT_REF:PROJECT,
    MERCADOPAGO_CLIENT_SECRET:'fixture',MERCADOPAGO_OAUTH_WEBHOOK_SECRET:'fixture',MERCADOPAGO_TOKEN_ENCRYPTION_KEY:'fixture',PAYMENT_LOG_HASH_SALT:'fixture',PAYMENT_WORKER_SECRET:'fixture-worker-hmac-only-for-local-tests'};
  state.secrets=Object.entries(environment).map(([name,value])=>({name,value:sha256(value)}));
  const fetcher = async (input, init = {}) => {
    assert.equal(init.redirect, 'error');
    const url = new URL(input), method = init.method || 'GET';
    if(url.origin===`https://${PROJECT}.supabase.co`){
      assert.equal(method,'GET');
      const match=/^\/functions\/v1\/([^/]+)\/__taba_release_v5$/.exec(url.pathname);assert.ok(match);
      const current=state.remote.find(v=>v.slug===match[1]);assert.ok(current);
      const source=state.sources.get(`${current.slug}:${current.version}`);
      if(!source)return new Response(null,{status:405});
      const marker=JSON.parse(/Object.freeze\((\{[^\n]*?\})\)/.exec(source)[1]);
      return Response.json({...marker,nonce:state.staleRuntime?'old-nonce':url.searchParams.get('nonce'),deployment_id:`${PROJECT}_${current.id}_${state.wrongRuntimeVersion?9:current.version}`});
    }
    assert.equal(url.origin, 'https://api.supabase.com');
    state.calls.push({ method, path: url.pathname, query: url.search });
    const base = `/v1/projects/${PROJECT}`;
    if(method==='GET'&&url.pathname===`${base}/api-keys`){
      const claims=Buffer.from(JSON.stringify({role:'anon',ref:PROJECT,exp:Date.now()/1000+3600})).toString('base64url');
      return Response.json([{name:'anon',api_key:`eyJhbGciOiJIUzI1NiJ9.${claims}.fixture-signature`}]);
    }
    if (method === 'GET' && url.pathname === `${base}/secrets`) return Response.json(state.secrets);
    if (method === 'GET' && url.pathname === base) return Response.json({ id: state.wrongProject || PROJECT, status: 'ACTIVE_HEALTHY', database: { host: `db.${PROJECT}.supabase.co` } });
    if (method === 'POST' && url.pathname === `${base}/database/query/read-only`) {
      const { query: sql, parameters } = JSON.parse(init.body);
      assert.match(sql, /^select a.pid/);
      return Response.json(await query(sql, parameters), { status: 201 });
    }
    if (method === 'GET' && url.pathname === `${base}/functions`) {
      await state.hooks.inventory?.();
      return Response.json(state.remote);
    }
    if (method === 'POST' && url.pathname === `${base}/functions/deploy`) {
      assert.equal(url.searchParams.get('bundleOnly'), 'true');
      const slug = url.searchParams.get('slug'); assert.ok(FUNCTIONS.includes(slug));
      const metadata = JSON.parse(init.body.get('metadata'));
      assert.equal(metadata.name, slug); assert.equal(metadata.entrypoint_path, `supabase/functions/${slug}/index.js`);
      assert.equal(init.body.getAll('file').length, 1);
      const source = await init.body.get('file').text();
      assert.match(source, /__TABA_RELEASE_V5__/);
      state.stageCount++;
      await state.hooks.stage?.(slug);
      if (state.failStage === state.stageCount) return new Response('synthetic failure', { status: 500 });
      const old = state.remote.find(v => v.slug === slug);
      const result = { ...old, version: 10 + state.stageCount, verify_jwt: metadata.verify_jwt,
        entrypoint_path: `file:///tmp/user_fn_${PROJECT}/source/${metadata.entrypoint_path}`,
        ezbr_sha256: sha256(`EZBR_TEST_DOMAIN:${source}`) };
      state.sources.set(`${slug}:${result.version}`, source);
      return Response.json(result, { status: 201 });
    }
    if (method === 'PUT' && url.pathname === `${base}/functions`) {
      const staged = JSON.parse(init.body);
      assert.deepEqual(staged.map(v => v.slug).sort(), [...FUNCTIONS].sort());
      assert.equal(staged.length, 3);
      await state.hooks.activate?.(staged);
      for (const item of staged.slice(0,state.activateCount)) {
        assert.ok(state.sources.has(`${item.slug}:${item.version}`), 'activation without reserved bundle');
        state.remote = state.remote.map(old => old.slug === item.slug ? { ...item, updated_at: Date.now() } : old);
      }
      if (state.lostActivationResponse) throw new Error('synthetic lost response');
      return Response.json({ functions: staged.map(s => remoteFunction(state.remote.find(v => v.slug === s.slug))) });
    }
    if (method === 'GET' && url.pathname.startsWith(`${base}/functions/`)) {
      const segments = url.pathname.slice(`${base}/functions/`.length).split('/');
      const item = state.remote.find(v => v.slug === segments[0]); assert.ok(item);
      if (segments.length === 1) return Response.json(item);
      assert.deepEqual(segments.slice(1), ['body']);
      assert.equal(init.headers.Accept, 'multipart/form-data');
      await state.hooks.source?.(item.slug);
      const form = new FormData();
      form.append('metadata', JSON.stringify({ deno2_entrypoint_path: item.entrypoint_path }));
      form.append('file', new Blob([state.tamperedSource || state.sources.get(`${item.slug}:${item.version}`)]), 'index.js');
      return new Response(form);
    }
    throw new Error(`unrecognized verified-platform fixture route: ${method} ${url.pathname}`);
  };
  return { platform: new Platform('fixture-token', { fetcher }), state, fetcher };
}
