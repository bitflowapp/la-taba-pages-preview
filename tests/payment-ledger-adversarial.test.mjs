import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepLedgerWindow } from '../supabase/functions/_shared/ledger-sweep.ts';
import { Deadline } from '../supabase/functions/_shared/worker-deadline.ts';

const at = '2026-10-25T00:00:00.000Z';
const window = { business_id: 'synthetic-only', environment: 'test', begin: at,
  end: '2026-10-25T01:00:00.000Z', offset: 0 };

test('reordered equal timestamps cannot silently complete with unseen payments', async () => {
  const handled = new Set();
  let calls = 0;
  let completion = false;
  let failure;
  try {
    await sweepLedgerWindow({
      search: async (_window, cursor, limit) => {
        if (cursor.at > at || _window.end < at) return { total: 0, results: [] };
        // Both answers respect the documented ascending date sort. Ties have no secondary ordering guarantee.
        const order = calls++ === 0 ? ['A','B','C','D'] : ['C','D','A','B'];
        return { total: 4, results: order.slice(cursor.skip, cursor.skip + limit)
          .map(id => ({ id, date_last_updated: at })) };
      },
      handle: async row => { handled.add(row.id); return { orphan: false, finalizeSessionId: null }; },
      finalize: async () => {},
      checkpoint: async row => { completion ||= row.done; return true; },
    }, window, new Deadline(Date.now(), 60000), { pageSize: 2 });
  } catch (error) { failure = error; }
  console.log(JSON.stringify({ case: 'equal_timestamp_reorder', uniqueHandled: [...handled], completion,
    failure: failure?.name || null }));
  assert.ok(!completion || handled.size === 4, 'completed a financial ledger window after reading only A/B; C/D were silently skipped');
  assert.equal(failure, undefined);
  assert.equal(completion, true);
  assert.equal(handled.size, 4);
});

test('ordinary distinct timestamps still reconcile all payments', async () => {
  const rows = ['A','B','C','D'].map((id,i) => ({ id, date_last_updated: new Date(Date.parse(at)+i*1000).toISOString() }));
  const handled = new Set();
  const result = await sweepLedgerWindow({
    search: async (_window,cursor,limit) => {
      const remaining = rows.filter(row => row.date_last_updated >= cursor.at);
      return { total: remaining.length, results: remaining.slice(cursor.skip,cursor.skip+limit) };
    },
    handle: async row => { handled.add(row.id); return { orphan: false, finalizeSessionId: null }; },
    finalize: async () => {}, checkpoint: async () => true,
  }, window, new Deadline(Date.now(),60000), { pageSize: 2 });
  assert.equal(result.stopped,'complete');
  assert.equal(handled.size,4);
});

test('a dense group at the end closes without searching beyond the window', async () => {
  const handled=new Set();
  const result=await sweepLedgerWindow({
    search:async(w,cursor,limit)=>{
      assert.ok(cursor.at<=w.end,'provider refuses an inverted date range');
      return {total:4,results:['A','B','C','D'].slice(cursor.skip,cursor.skip+limit).map(id=>({id,date_last_updated:at}))};
    },
    handle:async row=>{handled.add(row.id);return {orphan:false,finalizeSessionId:null};},
    finalize:async()=>{},checkpoint:async()=>true,
  },{...window,end:at},new Deadline(Date.now(),60000),{pageSize:2});
  assert.equal(result.stopped,'complete');assert.equal(handled.size,4);
});

for(const mode of ['empty exact window','changing total']) test(`dense pagination refuses ${mode} without closing`,async()=>{
  let searches=0,closed=false;
  await assert.rejects(sweepLedgerWindow({
    search:async(_w,cursor,limit)=>{
      searches++;
      const total=mode==='empty exact window' && searches>1 ? 0 : searches>2 ? 3 : 4;
      return {total,results:total ? ['A','B','C','D'].slice(cursor.skip,cursor.skip+limit).map(id=>({id,date_last_updated:at})) : []};
    },
    handle:async()=>({orphan:false,finalizeSessionId:null}),finalize:async()=>{},
    checkpoint:async row=>{closed ||= row.done;assert.equal(row.cursor.skip,0);return true;},
  },window,new Deadline(Date.now(),60000),{pageSize:2}));
  assert.equal(closed,false);
});
