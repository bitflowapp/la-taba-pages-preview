import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PROJECT, FUNCTIONS, VERIFY_JWT, LOCK, inventory, remoteFunction, exactFunctions, sha256 } from './model.mjs';
import { assertEnvironmentSecrets } from '../mercadopago/sincronizar-worker-hmac.mjs';

// No endpoint/profile override exists in the production entrypoint. Test
// transports are injected into this class without production credentials.
export class Platform {
  constructor(token, { fetcher = fetch, signal } = {}) {
    assert.ok(typeof token === 'string' && token.length > 0, 'SUPABASE_ACCESS_TOKEN required');
    this.token = token;
    this.fetcher = fetcher;
    this.signal = signal;
  }
  async request(route, { method = 'GET', body, status = 200 } = {}) {
    const headers = { Authorization: `Bearer ${this.token}`, 'Cache-Control': 'no-cache, no-store' };
    if (body && !(body instanceof FormData)) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(body); }
    const response = await this.fetcher(`https://api.supabase.com/v1/${route}`, {
      method, headers, body, redirect: 'error', cache: 'no-store',
      signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    // Never print API bodies, request headers, or nested transport errors.
    assert.equal(response.status, status, `Supabase ${method} failed (HTTP ${response.status})`);
    return response.json();
  }
  async project() {
    const project = await this.request(`projects/${PROJECT}`);
    assert.equal(project.id, PROJECT, 'remote project mismatch');
    if (project.ref !== undefined) assert.equal(project.ref, PROJECT, 'remote ref mismatch');
    assert.equal(project.database?.host, `db.${PROJECT}.supabase.co`, 'remote database host mismatch');
    assert.equal(project.status, 'ACTIVE_HEALTHY', 'project is not healthy');
    return project;
  }
  async inventory() { return inventory(await this.request(`projects/${PROJECT}/functions`)); }
  async configuration(session) {
    const rows = await this.request(`projects/${PROJECT}/secrets`);
    assert.ok(Array.isArray(rows), 'secret inventory unavailable');
    const secrets = new Map(rows.map(row => [row.name,row.value]));
    assert.equal(secrets.size,rows.length,'duplicate server secret');
    assertEnvironmentSecrets({ ref: PROJECT, environment: 'production', deployment: 'production', clientId: '7677852968049976' }, secrets);
    assert.ok(!secrets.has('DENO_DEPLOYMENT_ID') && !secrets.has('SB_EXECUTION_ID'),'reserved runtime identity override');
    const digest = secrets.get('PAYMENT_WORKER_SECRET');
    assert.match(digest || '', /^[a-f0-9]{64}$/, 'worker secret digest unavailable');
    const aligned = await session.value(`select
      coalesce((select count(*)=1 and bool_and(length(decrypted_secret)>=32 and encode(extensions.digest(decrypted_secret,'sha256'),'hex')=$1)
        from vault.decrypted_secrets where name='taba_payment_worker_hmac_secret'),false)
      and coalesce((select count(*)=1 and bool_and(decrypted_secret=$2)
        from vault.decrypted_secrets where name='taba_payment_worker_url'),false)`,
    [digest,`https://${PROJECT}.supabase.co/functions/v1/mercadopago-payment-worker`]);
    assert.equal(aligned,true,'production worker URL/HMAC mismatch');
    if (!this.anonKey) {
      const keys = await this.request(`projects/${PROJECT}/api-keys`);
      const selected = keys.filter(key=>key.name==='anon');
      assert.equal(selected.length,1,'public legacy anon JWT required for gateway health probe');
      const key=selected[0].api_key;
      assert.equal(typeof key,'string','public anon JWT unavailable');
      const claims=JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString());
      assert.equal(claims.role,'anon');assert.equal(claims.ref,PROJECT);
      assert.ok(claims.exp>Date.now()/1000,'public anon JWT expired');
      this.anonKey=key;
    }
    return true; // Never return, print or persist credential material/digests.
  }
  async verifyIndividual(expected) {
    const observed = [];
    for (const item of expected) {
      const actual = remoteFunction(await this.request(`projects/${PROJECT}/functions/${item.slug}`));
      assert.deepEqual(actual, item, 'individual endpoint and inventory disagree');
      observed.push(actual);
    }
    return observed;
  }
  async bindSession({ pid, applicationName }, requireLock) {
    const result = await this.request(`projects/${PROJECT}/database/query/read-only`, {
      method: 'POST', status: 201, body: {
        query: `select a.pid, a.application_name, a.datname, a.usename,
          exists(select 1 from pg_catalog.pg_locks l where l.pid=a.pid and l.locktype='advisory'
            and l.classid=${LOCK[0]} and l.objid=${LOCK[1]} and l.objsubid=2
            and l.granted and l.mode='ExclusiveLock') as release_lock
          from pg_catalog.pg_stat_activity a where a.pid=$1 and a.application_name=$2 and a.datname='postgres'`,
        parameters: [pid, applicationName],
      },
    });
    assert.ok(Array.isArray(result) && result.length === 1, 'DB/project cross-plane binding failed');
    assert.equal(result[0].pid, pid, 'DB backend mismatch');
    assert.equal(result[0].application_name, applicationName, 'DB session challenge mismatch');
    assert.equal(result[0].datname, 'postgres', 'DB name mismatch');
    assert.equal(result[0].usename, 'postgres', 'DB release role mismatch');
    if (requireLock) assert.equal(result[0].release_lock, true, 'production DB does not own release lock');
  }
  async stage(slug, source, baseline) {
    assert.ok(FUNCTIONS.includes(slug));
    const entrypoint = `supabase/functions/${slug}/index.js`;
    const form = new FormData();
    form.append('metadata', JSON.stringify({ name: slug, entrypoint_path: entrypoint, verify_jwt: VERIFY_JWT[slug], static_patterns: [] }));
    form.append('file', new Blob([source], { type: 'application/javascript' }), entrypoint);
    const response = await this.request(`projects/${PROJECT}/functions/deploy?slug=${slug}&bundleOnly=true`, { method: 'POST', body: form, status: 201 });
    const result = remoteFunction({...response,verify_jwt:response.verify_jwt??VERIFY_JWT[slug],created_at:response.created_at??baseline?.created_at}, { staged: true });
    assert.equal(result.slug, slug, 'stage response belongs to wrong function');
    return result;
  }
  async activate(staged) {
    exactFunctions(staged.map(v => v.slug));
    // This PUT and metadata schema are the pinned CLI's V1BulkUpdateFunctions.
    // All retries reuse the SAME durable version IDs. No --prune or single
    // function activation path exists in the repository controller.
    const body = staged.map(({ updated_at: _updated, ...item }) => item);
    const response = await this.request(`projects/${PROJECT}/functions`, { method: 'PUT', body });
    assert.ok(Array.isArray(response.functions), 'activation response missing functions');
    exactFunctions(response.functions.map(v => v.slug));
    for (const item of staged) {
      const raw=response.functions.find(v => v.slug === item.slug);
      const actual = remoteFunction({...raw,verify_jwt:raw.verify_jwt??item.verify_jwt},{staged:true});
      for (const field of ['id', 'slug', 'version', 'verify_jwt', 'ezbr_sha256']) {
        if(actual[field]!==undefined&&item[field]!==undefined)assert.equal(actual[field], item[field], 'activation response mismatch');
      }
    }
    return response;
  }
  async verifySource(slug, expectedSource) {
    assert.ok(FUNCTIONS.includes(slug));
    const response = await this.fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/functions/${slug}/body`, {
      headers: { Authorization: `Bearer ${this.token}`, Accept: 'multipart/form-data', 'Cache-Control': 'no-cache, no-store' },
      redirect: 'error', cache: 'no-store', signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200, 'remote source download failed');
    assert.match(response.headers.get('content-type') || '', /^multipart\/form-data;/i, 'remote source format mismatch');
    const form = await response.formData();
    const files = [...form.values()].filter(value => typeof value !== 'string');
    assert.equal(files.length, 1, 'unexpected remote runtime dependency');
    assert.equal(sha256(Buffer.from(await files[0].arrayBuffer())), sha256(expectedSource), 'remote executable source differs from uploaded release');
  }
  async verifyRuntime(expected, releaseId, sourceIdentity) {
    assert.ok(this.anonKey,'public gateway key not checked');
    const nonce=randomUUID();
    const response=await this.fetcher(`https://${PROJECT}.supabase.co/functions/v1/${expected.slug}/__taba_release_v5?nonce=${nonce}`,{
      method:'GET',headers:{Authorization:`Bearer ${this.anonKey}`,apikey:this.anonKey,'Cache-Control':'no-cache, no-store'},
      redirect:'error',cache:'no-store',signal:this.signal?AbortSignal.any([this.signal,AbortSignal.timeout(30_000)]):AbortSignal.timeout(30_000),
    });
    assert.equal(response.status,200,'runtime release probe failed');
    const actual=await response.json();
    assert.equal(actual.protocol,'taba-a1-a4-v5');assert.equal(actual.project,PROJECT);
    assert.equal(actual.function,expected.slug);assert.equal(actual.release_id,releaseId);
    assert.equal(actual.source_identity,sourceIdentity);assert.equal(actual.nonce,nonce,'stale runtime response');
    assert.equal(actual.deployment_id,`${PROJECT}_${expected.id}_${expected.version}`,'runtime version differs from deployment response');
    return actual;
  }
}
