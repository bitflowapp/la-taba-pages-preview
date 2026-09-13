import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PROJECT, FUNCTIONS, EXPAND, EMPTY_TABLES, CONTRACT, PROTOCOL, assertInert, inventory, verifyRelease, canonical, sha256, reviewedMigrationStage } from './model.mjs';
import { markedSource } from './identity.mjs';
import { assertCompatibility } from './compatibility.mjs';

export class Lifecycle {
  constructor({ session, platform, context, built, root = ROOT, signal, report = () => {} }) {
    Object.assign(this, { session, platform, context, built, root, signal, report });
  }
  async protectedGate(id) {
    this.signal?.throwIfAborted();
    await this.session.ownership();
    const snapshot = await this.session.value('select private.assert_a1_a4_inert_v5($1::uuid)', [id]);
    assertInert(snapshot);
    assert.equal(snapshot.release_id, id, 'release quiescence identity changed');
    return snapshot;
  }
  async record(id) {
    assert.match(id || '', /^[a-f0-9-]{36}$/i, 'release ID required');
    const row = await this.session.value('select to_jsonb(r) from private.a1_a4_releases_v5 r where id=$1::uuid', [id]);
    assert.equal(row.project_ref, PROJECT); assert.equal(row.protocol, PROTOCOL);
    assert.equal(row.commit_sha, this.context.commit, 'release belongs to a different immutable commit');
    assert.equal(row.source_sha, this.built.sourceIdentity, 'release executable bytes changed');
    assert.equal(row.expand_sha, this.context.expand_sha, 'EXPAND files changed');
    assert.equal(row.contract_sha, this.context.contract_sha, 'CONTRACT file changed');
    return row;
  }
  async verifyExpand() {
    const versions = this.context.expand.map(v => path.basename(v.path).slice(0, 14));
    const rows = await this.session.value('select coalesce(jsonb_agg(version order by version),\'[]\') from supabase_migrations.schema_migrations where version >= $1', [versions[0]]);
    assert.deepEqual(rows, versions, 'EXPAND ledger incomplete or contains unreviewed migrations');
    const artifacts = await this.session.value(`select jsonb_agg(jsonb_build_object('version',version,'count',cardinality(statements),
      'sha256',encode(extensions.digest(statements[1],'sha256'),'hex')) order by version)
      from supabase_migrations.schema_migrations where version >= $1`,[versions[0]]);
    assert.deepEqual(artifacts,this.context.expand.map(file=>({version:path.basename(file.path).slice(0,14),count:1,sha256:file.sha256})),
      'EXPAND ledger does not contain the exact repository-executed SQL');
    await assertCompatibility(this.session,this.root,this.context.compatibility_sha);
    const ok = await this.session.value(`select schema_sha=private.a1_a4_schema_sha_v5() and contract_sha=$1
      from private.a1_a4_release_control_v5 where singleton`, [this.context.contract_sha]);
    assert.equal(ok, true, 'EXPAND database definition/CONTRACT fingerprint mismatch');
    return { expand_verified: true, versions };
  }
  async preflight() {
    await this.platform.project();
    await this.platform.configuration(this.session);
    const remote = await this.platform.inventory();
    await this.platform.verifyIndividual(remote);
    const versions = await this.session.value("select jsonb_agg(version order by version) from supabase_migrations.schema_migrations");
    const local = fs.readdirSync(path.join(this.root, 'supabase/migrations')).filter(v => v.endsWith('.sql')).sort().map(v => v.slice(0, 14));
    await assertCompatibility(this.session,this.root,this.context.compatibility_sha,reviewedMigrationStage(local, versions));
    const statements = EMPTY_TABLES.map(table => `'${table}',(select count(*) from public.${table})`);
    statements.push("'settings',(select count(*) from public.business_payment_settings where enabled is distinct from false)",
      "'sellers',(select count(*) from public.mp_seller_connections where status is distinct from 'disconnected' or protected_tokens is not null or refresh_owner is not null or refresh_started_at is not null)",
      "'oauth_states',(select count(*) from public.mp_oauth_states where expires_at>clock_timestamp())");
    const counts = await this.session.value(`select jsonb_build_object(${statements.join(',')})`);
    for (const [key, count] of Object.entries(counts)) assert.equal(count, 0, `pre-onboarding state required: ${key}`);
    return { project: PROJECT, migrations: versions.length, financial_counts: counts, remote };
  }
  async expand() {
    await this.preflight();
    await this.session.ownership();
    for (const file of this.context.expand) {
      const version = path.basename(file.path).slice(0, 14);
      const exists = await this.session.value('select exists(select 1 from supabase_migrations.schema_migrations where version=$1)', [version]);
      if (exists) continue;
      this.signal?.throwIfAborted();
      const sql = fs.readFileSync(path.join(this.root, file.path), 'utf8');
      assert.equal(sha256(sql),file.sha256,'EXPAND bytes changed after preflight');
      await this.session.query('begin');
      try {
        await this.session.query(sql);
        await this.session.query('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)', [version, path.basename(file.path).slice(15, -4), [sql]]);
        await this.session.query('commit');
      } catch (error) { await this.session.query('rollback').catch(() => {}); throw error; }
      this.report({ stage: 'expand', version });
    }
    await this.verifyExpand();
    return { expanded: true };
  }
  async quiesce() {
    await this.verifyExpand();
    await this.preflight();
    await this.session.ownership();
    const id = await this.session.value('select private.quiesce_a1_a4_release_v5($1,$2,$3,$4)', [this.context.commit, this.built.sourceIdentity, this.context.expand_sha, this.context.contract_sha]);
    return { release_id: id, phase: 'quiesced', ...(await this.drain(id)) };
  }
  async drain(id) {
    await this.record(id);
    await this.session.ownership();
    const pending = await this.session.value('select count(*)::integer from net.http_request_queue');
    if (pending === 0) await this.session.value('select private.seal_a1_a4_drain_v5($1::uuid)', [id]);
    const snapshot = await this.session.value('select private.a1_a4_inert_snapshot_v5()');
    assert.equal(snapshot.release_id, id, 'quiescence belongs to another release');
    const post = await this.session.one("select verified_at+interval '430 seconds' as post_release_not_before,coalesce(clock_timestamp()>=verified_at+interval '430 seconds',false) as post_release_ready from private.a1_a4_releases_v5 where id=$1", [id]);
    return { snapshot, ...post, ready: snapshot.drained === true && Object.values(snapshot.counts).every(v => v === 0) && snapshot.schema_ok === true && snapshot.paused === true };
  }
  async release(id) {
    let row = await this.record(id);
    await this.platform.configuration(this.session);
    await this.verifyExpand();
    await this.protectedGate(id);
    if (row.phase === 'quiesced') {
      const baseline = await this.platform.inventory();
      await this.platform.verifyIndividual(baseline);
      await this.protectedGate(id);
      await this.session.value('select private.capture_a1_a4_baseline_v5($1::uuid,$2::jsonb)', [id, JSON.stringify(baseline)]);
      row = await this.record(id);
    }
    if (row.phase === 'staging') {
      assert.deepEqual(await this.platform.inventory(), inventory(row.baseline), 'remote changed before staging');
      const staged = [];
      // bundleOnly versions never route live traffic. An interrupted staging
      // retry may create orphan versions, which cannot perform provider I/O.
      for (const slug of FUNCTIONS) {
        await this.protectedGate(id);
        const result = await this.platform.stage(slug, markedSource(this.built, slug, id),row.baseline.find(v=>v.slug===slug));
        staged.push(result);
        this.report({ stage: 'bundle-only', function: slug, version: result.version });
      }
      assert.deepEqual(await this.platform.inventory(), inventory(row.baseline), 'bundleOnly unexpectedly changed live inventory');
      await this.protectedGate(id);
      await this.session.value('select private.stage_a1_a4_release_v5($1::uuid,$2::jsonb)', [id, JSON.stringify(staged)]);
      row = await this.record(id);
    }
    assert.equal(row.phase, 'activation_pending', 'use verify/attest for a completed release');
    await this.protectedGate(id);
    const response = await this.platform.activate(row.staged);
    // Failure remains activation_pending durably. Recovery reuses only these
    // immutable version IDs, even after Ctrl+C, SIGKILL or lost HTTP responses.
    await this.verify(id, response);
    return { release_id: id, phase: 'verified', source_identity: this.built.sourceIdentity };
  }
  async verify(id, response = null) {
    const row = await this.record(id);
    await this.platform.configuration(this.session);
    await this.protectedGate(id);
    const observed = verifyRelease(row.baseline, row.staged, await this.platform.inventory());
    await this.platform.verifyIndividual(observed);
    for (const slug of FUNCTIONS) await this.platform.verifySource(slug, markedSource(this.built, slug, id));
    const runtime = [];
    for (const expected of row.staged) runtime.push(await this.platform.verifyRuntime(expected,id,this.built.sourceIdentity));
    assert.equal(canonical(await this.platform.inventory()), canonical(observed), 'remote changed during verification');
    await this.protectedGate(id);
    await this.session.value('select private.verify_a1_a4_release_v5($1::uuid,$2::jsonb,$3::jsonb,$4::jsonb)', [id, JSON.stringify(observed), response === null ? null : JSON.stringify(response), JSON.stringify(runtime)]);
    return { release_id: id, verified: true };
  }
  async attest(id) {
    await this.verify(id);
    const attestation = await this.session.value('select private.attest_a1_a4_release_v5($1::uuid)', [id]);
    return { release_id: id, attestation_id: attestation };
  }
  async contract(id) {
    const row = await this.record(id);
    if (['contracted', 'resumed'].includes(row.phase)) throw new Error('ALREADY_APPLIED');
    await this.verify(id);
    await this.protectedGate(id);
    const contractSql = fs.readFileSync(path.join(this.root, CONTRACT), 'utf8');
    assert.equal(sha256(contractSql),this.context.contract_sha,'CONTRACT bytes changed after preflight');
    const result = await this.session.value(contractSql, [id, this.context.contract_sha]);
    await this.verifyContract(id);
    return result;
  }
  async verifyContract(id) {
    const row = await this.record(id);
    assert.ok(['contracted', 'resumed'].includes(row.phase), 'CONTRACT not recorded');
    const ok = await this.session.value(`select exists(select 1 from private.deployment_contract_executions e
      join private.deployment_drain_attestations a on a.id=e.attestation_id where e.attestation_id=$1::uuid
      and e.contract_sha=$2 and a.status='consumed' and a.evidence->>'release_id'=$3)`, [row.attestation_id, this.context.contract_sha, id]);
    assert.equal(ok, true, 'CONTRACT ledger/attestation mismatch');
    await this.verifyExpand();
    return { contract_verified: true };
  }
  async finish(id, abort = false) {
    const row = await this.record(id);
    if (abort) {
      assert.ok(['quiesced', 'staging'].includes(row.phase), 'activation started; recover the same release');
      if (row.baseline) assert.deepEqual(await this.platform.inventory(), inventory(row.baseline), 'remote changed; cannot abort');
    } else { await this.verifyContract(id); await this.verify(id); }
    await this.session.ownership();
    await this.session.value('select private.finish_a1_a4_release_v5($1::uuid,$2)', [id, abort]);
    return { release_id: id, phase: abort ? 'aborted' : 'resumed', payments_enabled: false, seller_connected: false };
  }
  async health(id) {
    await this.verifyContract(id);
    const row = await this.record(id);
    assert.equal(row.phase,'resumed','dispatch has not resumed');
    const current = await this.preflight();
    verifyRelease(row.baseline,row.staged,current.remote);
    for (const slug of FUNCTIONS) await this.platform.verifySource(slug,markedSource(this.built,slug,id));
    for (const expected of row.staged) await this.platform.verifyRuntime(expected,id,this.built.sourceIdentity);
    const snapshot = await this.session.value('select private.a1_a4_inert_snapshot_v5()');
    assert.equal(snapshot.schema_ok,true);assert.equal(snapshot.paused,false);
    assert.equal(snapshot.counts.pg_net_pending,0);
    assert.equal(snapshot.counts.scheduler_active,row.scheduler_before.filter(v=>v.active).length);
    return { release_id:id,healthy:true,financially_inert:true,ready_for_walter:false };
  }
}
