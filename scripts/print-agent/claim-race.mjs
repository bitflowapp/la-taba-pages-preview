// TABA · Impresión del mostrador · CARRERAS REALES
//
// pgTAP corre en una sola transacción: no puede probar qué pasa cuando dos
// agentes reclaman AL MISMO TIEMPO. Esto abre una conexión por llamada.
//
//   1. Dos agentes del mismo negocio lanzan 12 reclamos simultáneos sobre 20
//      trabajos. Esperado: cada trabajo reclamado exactamente una vez, con un
//      solo claim_token; nunca el mismo trabajo en dos respuestas.
//   2. El mismo agente manda «printing» dos veces a la vez (reintento de red).
//      Esperado: un solo evento «printing» por trabajo.
//   3. El Panel pide la misma impresión 8 veces a la vez (doble toque, dos
//      pestañas). Esperado: un solo trabajo.
//
// La usan scripts/run-release-v5-db.mjs (CI, contenedor sin red) y la corrida
// local contra una base descartable:
//   TABA_LOCAL_PRINT_DB=1 node scripts/print-agent/claim-race.mjs postgres://postgres@127.0.0.1:55432/taba
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const BUSINESS = 'b7100000-0000-4000-8000-0000000000a1';
const OWNER = 'a7100000-0000-4000-8000-0000000000a1';
const SESSION = 'c7100000-0000-4000-8000-0000000000a1';
const ORDER = 'd7100000-0000-4000-8000-0000000000a1';
const DEVICES = [
  { id: 'e7100000-0000-4000-8000-0000000000a1', secret: 'race-secret-counter' },
  { id: 'e7100000-0000-4000-8000-0000000000a2', secret: 'race-secret-kitchen' },
];
const JOBS = 20;

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

export async function runPrintClaimRace(connect, { log = console.log } = {}) {
  const admin = await connect();
  try {
    await admin.query(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      values ('${OWNER}','authenticated','authenticated','print-race-owner@example.invalid','',now(),'{}','{}',now(),now())`);
    await admin.query(`insert into public.businesses(id,name,status,slug,is_active,operating_timezone)
      values ('${BUSINESS}','TABA CARRERA DE IMPRESION','open','taba-carrera-impresion',true,'America/Argentina/Buenos_Aires')`);
    await admin.query(`insert into public.business_members(business_id,user_id,role,is_active) values ('${BUSINESS}','${OWNER}','owner',true)`);
    await admin.query(`insert into public.identity_sessions(session_id,user_id,business_id,role_at_login,client)
      values ('${SESSION}','${OWNER}','${BUSINESS}','owner','panel_web')`);
    await admin.query(`insert into public.orders(id,business_id,code,public_code,status,fulfillment_type,delivery_mode,client_request_id,
        customer_name,customer_neighborhood,customer_street_address,customer_phone,payment_method,subtotal,delivery_fee,total)
      values ('${ORDER}','${BUSINESS}','RACE-1','RACE-1','accepted','pickup','pickup','print-race-order','CLIENTE_SINTETICO',
        'Centro','Mendoza 1','+540000000000','cash',1000,0,1000)`);
    for (const device of DEVICES) {
      await admin.query(`insert into public.local_devices(id,business_id,device_name,agent_version,status,secret_hash)
        values ($1,$2,$3,'0.1.0','active',$4)`, [device.id, BUSINESS, `Agente ${device.id.slice(-2)}`, sha256(device.secret)]);
    }
    for (let index = 0; index < JOBS; index += 1) {
      await admin.query(`insert into public.print_jobs(business_id,document_type,source_entity_id,payload,request_source,idempotency_key,created_at)
        values ($1,'kitchen_ticket',$2,'{"reprint":false}'::jsonb,'operator',$3, now() - make_interval(secs => $4))`,
      [BUSINESS, ORDER, `race:job:${String(index).padStart(2, '0')}`, JOBS - index]);
    }

    // ── 1 · reclamos simultáneos ───────────────────────────────────────────
    const claimCalls = Array.from({ length: 12 }, (_, index) => DEVICES[index % 2]);
    const responses = await Promise.all(claimCalls.map(async (device) => {
      const client = await connect();
      try {
        const { rows } = await client.query('select public.agent_claim_print_jobs($1,$2,$3,$4) as result',
          [device.id, sha256(device.secret), ['kitchen_ticket'], 3]);
        return { device, jobs: rows[0].result.jobs };
      } finally { await client.end(); }
    }));
    const claimed = responses.flatMap(({ device, jobs }) => jobs.map((job) => ({ ...job, device: device.id })));
    const ids = claimed.map((job) => job.id);
    assert.equal(new Set(ids).size, ids.length, 'ningun trabajo aparece en dos respuestas');
    assert.equal(ids.length, JOBS, 'los 20 trabajos quedan reclamados (capacidad 36)');
    const { rows: state } = await admin.query(`select count(*)::int as claimed, count(distinct claim_token)::int as tokens,
        count(*) filter (where attempt_count = 1)::int as first_attempt
      from public.print_jobs where business_id = $1 and status = 'claimed'`, [BUSINESS]);
    assert.deepEqual(state[0], { claimed: JOBS, tokens: JOBS, first_attempt: JOBS });
    for (const job of claimed) {
      const { rows } = await admin.query('select claimed_by_device_id, claim_token from public.print_jobs where id = $1', [job.id]);
      assert.equal(rows[0].claimed_by_device_id, job.device, 'el ganador registrado es el que recibio el trabajo');
      assert.equal(rows[0].claim_token, job.claim_token);
    }
    log(`PRINT_CLAIM_RACE: 12 reclamos simultaneos de 2 agentes -> ${JOBS} trabajos, cada uno una sola vez: PASS`);

    // ── 2 · «printing» duplicado por reintento ─────────────────────────────
    const sample = claimed.slice(0, 5);
    const printing = await Promise.all(sample.flatMap((job) => [0, 1].map(async () => {
      const client = await connect();
      const device = DEVICES.find((candidate) => candidate.id === job.device);
      try {
        const { rows } = await client.query('select public.agent_update_print_job($1,$2,$3,$4,$5) as result',
          [device.id, sha256(device.secret), job.id, job.claim_token, 'printing']);
        return rows[0].result;
      } finally { await client.end(); }
    })));
    assert.equal(printing.filter((result) => result.idempotent_replay === false).length, sample.length,
      'exactamente una transicion real por trabajo');
    const { rows: events } = await admin.query(`select print_job_id, count(*)::int as n from public.print_job_events
      where business_id = $1 and event_type = 'printing' group by print_job_id`, [BUSINESS]);
    assert.equal(events.length, sample.length);
    assert.ok(events.every((row) => row.n === 1), 'un solo evento printing por trabajo');
    log('PRINT_PRINTING_RETRY_RACE: dos «printing» simultaneos -> un solo evento por trabajo: PASS');

    // ── 3 · doble toque del Panel ──────────────────────────────────────────
    const claims = JSON.stringify({ sub: OWNER, role: 'authenticated', session_id: SESSION });
    const enqueue = await Promise.all(Array.from({ length: 8 }, async () => {
      const client = await connect();
      try {
        await client.query('begin');
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [claims]);
        const { rows } = await client.query(`select public.request_order_print_job($1,'order_ticket','panel-race-0001') as result`, [ORDER]);
        await client.query('commit');
        return rows[0].result;
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally { await client.end(); }
    }));
    assert.equal(new Set(enqueue.map((result) => result.print_job_id)).size, 1, 'los 8 pedidos devuelven el mismo trabajo');
    const { rows: tickets } = await admin.query(`select count(*)::int as n from public.print_jobs
      where business_id = $1 and document_type = 'order_ticket'`, [BUSINESS]);
    assert.equal(tickets[0].n, 1, 'un solo ticket en la cola');
    log('PRINT_PANEL_DOUBLE_TAP_RACE: 8 pedidos simultaneos con la misma clave -> 1 trabajo: PASS');
  } finally {
    await admin.end();
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (invoked) {
  if (process.env.TABA_LOCAL_PRINT_DB !== '1') {
    console.error('Refusing to run without TABA_LOCAL_PRINT_DB=1: this suite writes fixtures into a disposable database.');
    process.exit(2);
  }
  const url = process.argv[2];
  const parsed = new URL(url || 'invalid:');
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname), 'solo contra una base local descartable');
  const { default: pg } = await import('pg');
  await runPrintClaimRace(async () => {
    const client = new pg.Client({ connectionString: url, statement_timeout: 30_000 });
    await client.connect();
    return client;
  });
}
